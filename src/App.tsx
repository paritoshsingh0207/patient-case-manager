import { useEffect, useMemo, useState } from 'react';
import { ClinicIcon, type ClinicIconName } from './components/ClinicIcon';
import { onAuthStateChanged, reload, sendEmailVerification, signOut, type User } from 'firebase/auth';
import type {
  CaseInput,
  CaseRecord,
  Patient,
  PatientInput,
  PractitionerAccess,
  SuggestionResult,
} from './types';
import { auth, db, firebaseReady } from './lib/firebase';
import { AuthPanel } from './components/AuthPanel';
import { PatientForm } from './components/PatientForm';
import { CaseEditor } from './components/CaseEditor';
import { AdminConsole } from './components/AdminConsole';
import { MedicineCodeManager } from './components/MedicineCodeManager';
import { PrescriptionPanel } from './components/PrescriptionPanel';
import { FollowUpPanel } from './components/FollowUpPanel';
import { patientInputFromRecord } from './lib/patientEdits';
import { hasWorkspaceAccess, matchesLoginRole, subscribePractitionerAccess, type LoginRole } from './services/accessService';
import {
  createCase,
  createPatient,
  saveSuggestion,
  subscribeCases,
  subscribePatients,
  updatePatient,
} from './services/patientService';

type WorkspaceView = 'overview' | 'patients' | 'medicines' | 'admin';

function initials(firstName: string, lastName: string) {
  return `${firstName[0] ?? ''}${lastName[0] ?? ''}`.toUpperCase();
}

function ageFromDate(dateOfBirth?: string) {
  if (!dateOfBirth) return '—';
  const birth = new Date(`${dateOfBirth}T00:00:00`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return Number.isFinite(age) ? String(age) : '—';
}

function viewTitle(view: WorkspaceView) {
  if (view === 'medicines') return 'Medicine registry';
  if (view === 'admin') return 'Clinic administration';
  if (view === 'patients') return 'Patients';
  return 'Clinic overview';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loginRole, setLoginRole] = useState<LoginRole | null>(null);
  const [verificationRefresh,setVerificationRefresh]=useState(0);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessProfile, setAccessProfile] = useState<PractitionerAccess | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>('overview');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [search, setSearch] = useState('');
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setAuthLoading(false);
      return;
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setDataError('');
      setAccessProfile(null);
      setAccessChecked(false);
      setShowPatientForm(false);
      setEditingPatient(null);
      setActiveView('overview');
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setAccessProfile(null);
      setAccessChecked(false);
      setAccessLoading(false);
      return;
    }

    setAccessLoading(true);
    setAccessChecked(false);

    return subscribePractitionerAccess(
      db,
      user.uid,
      (profile) => {
        setAccessProfile(profile);
        setAccessChecked(true);
        setAccessLoading(false);
      },
      () => {
        setAccessProfile(null);
        setAccessChecked(true);
        setAccessLoading(false);
      },
    );
  }, [user]);

  const verificationNeeded = accessProfile?.registrationMethod === 'self' && user?.emailVerified !== true;
  const authorized = hasWorkspaceAccess(accessProfile) && !verificationNeeded;

  useEffect(() => {
    if (!user || !db || !authorized || !accessProfile) {
      setPatients([]);
      setSelectedPatientId(null);
      setEditingPatient(null);
      return;
    }

    return subscribePatients(
      db,
      user.uid,
      accessProfile.role,
      (nextPatients) => {
        setDataError('');
        setPatients(nextPatients);
        setSelectedPatientId((current) =>
          current && nextPatients.some((patient) => patient.id === current)
            ? current
            : nextPatients[0]?.id ?? null,
        );
      },
      (error) => setDataError('code' in error && error.code === 'permission-denied'
        ? 'Your patient list could not be loaded. Check account approval and ensure the latest Firestore rules are deployed.'
        : error.message),
    );
  }, [user, authorized, accessProfile]);

  useEffect(() => {
    if (!selectedPatientId || !db || !user || !authorized) {
      setCases([]);
      return;
    }

    return subscribeCases(
      db,
      selectedPatientId,
      setCases,
      (error) => setDataError(error.message),
    );
  }, [selectedPatientId, user, authorized]);

  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
  const filteredPatients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return patients;

    return patients.filter((patient) =>
      `${patient.firstName} ${patient.lastName} ${patient.phone ?? ''} ${patient.email ?? ''}`
        .toLowerCase()
        .includes(term),
    );
  }, [patients, search]);

  if (!firebaseReady) {
    return <SetupRequired />;
  }

  if (authLoading || !auth || !db) {
    return <GateLoader message="Preparing secure workspace…" />;
  }

  const activeAuth = auth;
  const activeDb = db;

  if (!user) {
    return <AuthPanel auth={activeAuth} onBeginSignIn={setLoginRole} />;
  }

  if (accessLoading || !accessChecked) {
    return <GateLoader message="Verifying application access…" />;
  }

  if (!authorized || !accessProfile) {
    return <AccessDenied email={user.email} requiresVerification={verificationNeeded}
      onRefresh={async()=>{await reload(user);await user.getIdToken(true);setVerificationRefresh(x=>x+1);}}
      onResend={()=>sendEmailVerification(user)} onSignOut={() => signOut(activeAuth)} />;
  }
  if (!matchesLoginRole(accessProfile, loginRole)) {
    return <RoleMismatch selected={loginRole!} onSignOut={async () => {
      await signOut(activeAuth); setLoginRole(null);
    }} />;
  }

  const activeUser = user;
  const activeProfile = accessProfile;
  const isAdmin = activeProfile.role === 'admin';
  const isDoctor = activeProfile.role === 'doctor';
  const practitionerName =
    activeProfile.displayName ||
    activeUser.displayName ||
    activeUser.email?.split('@')[0] ||
    (isAdmin ? 'Administrator' : 'Doctor');

  async function addPatient(input: PatientInput) {
    const result = await createPatient(activeDb, activeUser.uid, activeProfile.role, input);
    setSelectedPatientId(result.id);
    setShowPatientForm(false);
  }

  async function savePatientEdit(input: PatientInput) {
    if (!editingPatient) return;
    await updatePatient(activeDb, editingPatient.id, input, patientInputFromRecord(editingPatient));
    setEditingPatient(null);
  }

  async function addCase(input: CaseInput) {
    if (!selectedPatient || !isDoctor) return;
    await createCase(activeDb, selectedPatient.id, activeUser.uid, practitionerName, input);
  }

  async function persistSuggestion(input: CaseInput, result: SuggestionResult) {
    if (!selectedPatient || !isDoctor) return;
    await saveSuggestion(activeDb, selectedPatient.id, activeUser.uid, input, result);
  }

  const navItems: {view: WorkspaceView;label:string;icon:ClinicIconName}[] = [
    {view:'overview',label:'Overview',icon:'overview'},
    {view:'patients',label:'Patients',icon:'patients'},
    {view:'medicines',label:'Medicine registry',icon:'book'},
    ...(isAdmin?[{view:'admin' as const,label:'Administration',icon:'shield' as const}]:[]),
  ];
  const navigation = navItems.map(item=>(
    <button key={item.view} type="button" title={item.label} aria-label={item.label}
      aria-current={activeView===item.view?'page':undefined}
      className={activeView===item.view?'active':''}
      onClick={()=>setActiveView(item.view)}>
      <ClinicIcon name={item.icon}/>
      <span className="nav-label">{item.label}</span>
    </button>
  ));

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Workspace sidebar">
        <div className="brand-block">
          <div className="brand-mark small" aria-hidden="true">C</div>
        </div>
        <nav className="side-nav" aria-label="Primary navigation">{navigation}</nav>
        <div className="sidebar-footer">
          <button type="button" className="side-logout" title="Sign out" aria-label="Sign out"
            onClick={()=>signOut(activeAuth)}><ClinicIcon name="logout"/></button>
        </div>
      </aside>
      <div className="workspace-content">
        <div className="workspace-utility">
          <div className="clinic-heading">
            <span className="clinic-identity">{import.meta.env.VITE_CLINIC_NAME?.trim() || 'Clinical Workspace'}</span>
            <span className="clinic-context">{new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(new Date())}</span>
          </div>
          <div className="workspace-account">
            <span className="role-pill">{isAdmin?'Administrator':'Doctor'}</span>
            <span className="account-avatar">{practitionerName[0]?.toUpperCase()??'P'}</span>
            <span className="account-name">{practitionerName}</span>
            <button type="button" title="Sign out" aria-label="Sign out" className="header-logout"
              onClick={()=>signOut(activeAuth)}><ClinicIcon name="logout"/></button>
          </div>
        </div>
        <main className="main-area">
          <header className="topbar">
            <div>
              <p className="eyebrow">{isAdmin ? 'CLINIC ADMINISTRATION' : 'PRACTITIONER WORKSPACE'}</p>
              <h1>{viewTitle(activeView)}</h1>
              <p className="topbar-subtitle">
                {activeView==='overview' ? 'A clear view of your clinic records and everyday work.'
                  : activeView==='patients' ? (isAdmin ? 'Review clinic patients and care teams.' : 'Only patients assigned to you appear here.')
                  : activeView==='medicines' ? 'Find approved codes and verify historical medicine identities.'
                  : 'Manage authorized practitioners and patient access.'}
              </p>
            </div>
            {activeView==='patients' ? <button className="button primary" onClick={()=>setShowPatientForm(true)}>
              <ClinicIcon name="plus"/> Add patient</button>:null}
          </header>
          <nav className="mobile-nav" aria-label="Mobile navigation">{navigation}</nav>

        {dataError ? <div className="page-error" role="alert">{dataError}</div> : null}

        {activeView === 'overview' ? (
          <ClinicOverview patients={patients} cases={cases} selectedPatient={selectedPatient} isAdmin={isAdmin}
            onOpenPatient={(id)=>{setSelectedPatientId(id);setActiveView('patients');}}
            onShowPatients={()=>setActiveView('patients')} onAddPatient={()=>setShowPatientForm(true)}/>
        ) : null}

        {activeView === 'patients' ? (
          <PatientWorkspace
            patients={filteredPatients}
            allPatientCount={patients.length}
            selectedPatient={selectedPatient}
            selectedPatientId={selectedPatientId}
            cases={cases}
            search={search}
            setSearch={setSearch}
            setSelectedPatientId={setSelectedPatientId}
            onAddPatient={() => setShowPatientForm(true)}
            onEditPatient={(patient) => setEditingPatient({ ...patient })}
            isDoctor={isDoctor}
            db={activeDb}
            userId={user.uid}
            practitionerName={practitionerName}
            addCase={addCase}
            persistSuggestion={persistSuggestion}
          />
        ) : null}

        {activeView === 'medicines' ? (
          <MedicineCodeManager
            db={activeDb}
            canManage={isAdmin}
          />
        ) : null}

        {activeView === 'admin' && isAdmin ? (
          <AdminConsole
            db={activeDb}
            patients={patients}
            adminUid={activeUser.uid}
          />
        ) : null}
        </main>
      </div>

      {showPatientForm ? (
        <PatientForm onSubmit={addPatient} onCancel={() => setShowPatientForm(false)} />
      ) : null}
      {editingPatient ? (
        <PatientForm key={editingPatient.id} initialPatient={editingPatient}
          onSubmit={savePatientEdit} onCancel={() => setEditingPatient(null)} />
      ) : null}
    </div>
  );
}


function ClinicOverview({patients,cases,selectedPatient,isAdmin,onOpenPatient,onShowPatients,onAddPatient}:{
  patients:Patient[];cases:CaseRecord[];selectedPatient:Patient|null;isAdmin:boolean;
  onOpenPatient:(id:string)=>void;onShowPatients:()=>void;onAddPatient:()=>void;
}) {
  const recent=[...patients].sort((a,b)=>(b.createdAt?.getTime()??0)-(a.createdAt?.getTime()??0)).slice(0,6);
  const assignments=patients.reduce((n,p)=>n+p.doctorIds.length,0);
  return <div className="clinic-overview">
    <div className="overview-intro"><div><p className="eyebrow">PATIENT CARE</p><h2>Clinic overview</h2>
      <p>Your clinical records and patient directory are available in one place.</p></div>
      <button type="button" className="button primary" onClick={onAddPatient}><ClinicIcon name="plus"/> New patient</button>
    </div>
    <div className="overview-stats">
      <section className="overview-stat"><span className="stat-label"><ClinicIcon name="patients"/> Accessible patients</span>
        <strong>{patients.length}</strong><small>{isAdmin?'Across the clinic':'Assigned to your account'}</small></section>
      <section className="overview-stat"><span className="stat-label"><ClinicIcon name="clipboard"/> Selected patient cases</span>
        <strong>{selectedPatient?cases.length:'—'}</strong>
        <small>{selectedPatient?selectedPatient.firstName+' '+selectedPatient.lastName:'Select a patient to review cases'}</small></section>
      <section className="overview-stat"><span className="stat-label"><ClinicIcon name="shield"/> Care-team assignments</span>
        <strong>{assignments}</strong><small>Across accessible records</small></section>
    </div>
    <div className="overview-sections">
      <section className="workspace-card glass-panel overview-recent">
        <div className="section-heading compact"><div><p className="eyebrow">DIRECTORY</p><h3>Recent patients</h3></div>
          <button className="button secondary" type="button" onClick={onShowPatients}>View all <ClinicIcon name="chevron"/></button></div>
        <div className="overview-patient-list">
          {recent.map(p=><button type="button" key={p.id} className="overview-patient-row" onClick={()=>onOpenPatient(p.id)}>
            <span className="avatar">{initials(p.firstName,p.lastName)}</span>
            <span className="patient-row-copy"><strong>{p.firstName} {p.lastName}</strong><small>{p.phone||p.email||'No contact details'}</small></span>
            <span className="overview-patient-meta">{p.createdAt?new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric'}).format(p.createdAt):'Patient record'}</span>
            <ClinicIcon name="chevron"/></button>)}
          {!recent.length?<div className="empty-list">No accessible patient records yet.</div>:null}
        </div>
      </section>
      <aside className="workspace-card glass-panel overview-quick">
        <p className="eyebrow">QUICK ACTIONS</p><h3>Work efficiently</h3>
        <button type="button" onClick={onShowPatients}><span><ClinicIcon name="search"/></span>
          <div><strong>Find a patient</strong><small>Browse case histories and records</small></div><ClinicIcon name="chevron"/></button>
        <button type="button" onClick={onAddPatient}><span><ClinicIcon name="plus"/></span>
          <div><strong>Add patient</strong><small>Start a secure patient record</small></div><ClinicIcon name="chevron"/></button>
        <div className="overview-privacy"><ClinicIcon name="shield"/>
          <p>Access is enforced by Firebase Authentication and Firestore Security Rules, not by the interface alone.</p></div>
      </aside>
    </div>
  </div>;
}

interface PatientWorkspaceProps {
  patients: Patient[];
  allPatientCount: number;
  selectedPatient: Patient | null;
  selectedPatientId: string | null;
  cases: CaseRecord[];
  search: string;
  setSearch: (value: string) => void;
  setSelectedPatientId: (value: string) => void;
  onAddPatient: () => void;
  onEditPatient: (patient: Patient) => void;
  isDoctor: boolean;
  db: NonNullable<typeof db>;
  userId: string;
  practitionerName: string;
  addCase: (input: CaseInput) => Promise<void>;
  persistSuggestion: (input: CaseInput, result: SuggestionResult) => Promise<void>;
}

function PatientWorkspace({
  patients,
  allPatientCount,
  selectedPatient,
  selectedPatientId,
  cases,
  search,
  setSearch,
  setSelectedPatientId,
  onAddPatient,
  onEditPatient,
  isDoctor,
  db,
  userId,
  practitionerName,
  addCase,
  persistSuggestion,
}: PatientWorkspaceProps) {
  const [patientTab,setPatientTab]=useState<'history'|'consultation'|'prescriptions'|'followups'>('history');
  useEffect(()=>setPatientTab('history'),[selectedPatientId]);
  return (
    <div className="workspace-layout">
      <section className="patient-column glass-panel">
        <div className="patient-search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Search patients"
            placeholder="Search patients"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="patient-list-head">
          <span>{patients.length} of {allPatientCount} patients</span>
          <span>Recent first</span>
        </div>
        <div className="patient-list">
          {patients.map((patient) => (
            <button
              key={patient.id}
              className={`patient-row ${patient.id === selectedPatientId ? 'selected' : ''}`}
              onClick={() => setSelectedPatientId(patient.id)}
            >
              <span className="avatar">{initials(patient.firstName, patient.lastName)}</span>
              <span className="patient-row-copy">
                <strong>{patient.firstName} {patient.lastName}</strong>
                <small>{patient.phone || patient.email || 'No contact added'}</small>
              </span>
              <span className="chevron" aria-hidden="true">›</span>
            </button>
          ))}
          {!patients.length ? <div className="empty-list">No accessible patients match this search.</div> : null}
        </div>
      </section>

      <section className="detail-column">
        {selectedPatient ? (
          <>
            <PatientHeader patient={selectedPatient} caseCount={cases.length}
              onEdit={() => onEditPatient(selectedPatient)} />
            <section className="patient-safety" aria-label="Patient safety information">
              <div className={selectedPatient.allergies?.trim()?'safety-item has-alert':'safety-item'}>
                <div className="safety-heading"><ClinicIcon name="alert"/><span>Known allergies</span></div>
                <p>{selectedPatient.allergies?.trim() || 'Not documented — verify with patient'}</p>
              </div>
              <div className="safety-item">
                <div className="safety-heading"><ClinicIcon name="clipboard"/><span>Current medicines</span></div>
                <p>{selectedPatient.currentMedications?.trim() || 'Not documented — verify with patient'}</p>
              </div>
            </section>
            <nav className="patient-tabs" aria-label="Patient sections">
              <button type="button" className={patientTab==='history'?'selected':''} aria-current={patientTab==='history'?'page':undefined}
                onClick={()=>setPatientTab('history')}><ClinicIcon name="history"/> Clinical history</button>
              {isDoctor?<button type="button" className={patientTab==='consultation'?'selected':''}
                aria-current={patientTab==='consultation'?'page':undefined}
                onClick={()=>setPatientTab('consultation')}><ClinicIcon name="clipboard"/> New consultation</button>:null}
              <button type="button" className={patientTab==='followups'?'selected':''}
                aria-current={patientTab==='followups'?'page':undefined}
                onClick={()=>setPatientTab('followups')}><ClinicIcon name="history"/> Follow-ups</button>
              <button type="button" className={patientTab==='prescriptions'?'selected':''}
                aria-current={patientTab==='prescriptions'?'page':undefined}
                onClick={()=>setPatientTab('prescriptions')}><ClinicIcon name="file"/> Prescriptions</button>
            </nav>
            {patientTab==='history'?<CaseTimeline cases={cases}/>:null}
            {patientTab==='consultation'&&isDoctor?<CaseEditor
              key={selectedPatient.id}
              patientName={selectedPatient.firstName+' '+selectedPatient.lastName}
              previousCases={cases}
              onSaveCase={addCase}
              onSaveSuggestion={persistSuggestion}
            />:null}
            {patientTab==='followups'?<FollowUpPanel key={selectedPatient.id} db={db} patientId={selectedPatient.id}
              userId={userId} canManage={isDoctor}/>:null}
            {patientTab==='prescriptions'?<PrescriptionPanel
              key={selectedPatient.id} db={db} patient={selectedPatient} userId={userId} practitionerName={practitionerName}
              canPrescribe={isDoctor}
            />:null}
          </>
        ) : (
          <div className="empty-state glass-panel">
            <div className="empty-icon">＋</div>
            <p className="eyebrow">Start a patient record</p>
            <h2>No patient selected</h2>
            <p>
              Doctors only see assigned patients. Administrators can create a patient and then assign one or more doctors from the Admin view.
            </p>
            <button className="button primary" onClick={onAddPatient}>Add patient</button>
          </div>
        )}
      </section>
    </div>
  );
}

function PatientHeader({ patient, caseCount, onEdit }: { patient: Patient; caseCount: number; onEdit: () => void }) {
  return (
    <section className="patient-header workspace-card glass-panel">
      <div className="avatar large">{initials(patient.firstName, patient.lastName)}</div>
      <div className="patient-identity">
        <p className="eyebrow">PATIENT PROFILE</p>
        <h2>{patient.firstName} {patient.lastName}</h2>
        <span>{patient.email || patient.phone || 'No contact details'}</span>
        <button type="button" className="button secondary patient-edit-action" onClick={onEdit}>Edit profile</button>
      </div>
      <div className="patient-metrics">
        <div><strong>{ageFromDate(patient.dateOfBirth)}</strong><span>Age</span></div>
        <div><strong>{caseCount}</strong><span>Cases</span></div>
        <div><strong>{patient.doctorIds.length}</strong><span>Doctors</span></div>
      </div>
    </section>
  );
}

function CaseTimeline({ cases }: { cases: CaseRecord[] }) {
  return (
    <aside className="workspace-card timeline-card glass-panel">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">Case history</p>
          <h3>Longitudinal record</h3>
        </div>
        <span className="quiet-note">{cases.length} entries</span>
      </div>
      <div className="timeline-list">
        {cases.map((record) => (
          <details key={record.id} className="timeline-item case-history-item">
            <summary>
              <div className="timeline-dot" />
              <time>{record.consultationDate}</time>
              <strong>{record.chiefComplaint}</strong>
              <span>View details</span>
            </summary>
            <div className="case-history-details">
              {record.createdByName ? <p><b>Recorded by:</b> {record.createdByName}</p> : null}
              {record.duration ? <p><b>Duration:</b> {record.duration}</p> : null}
              {record.location ? <p><b>Location:</b> {record.location}</p> : null}
              {record.sensation ? <p><b>Sensation:</b> {record.sensation}</p> : null}
              {record.modalitiesBetter ? <p><b>Better:</b> {record.modalitiesBetter}</p> : null}
              {record.modalitiesWorse ? <p><b>Worse:</b> {record.modalitiesWorse}</p> : null}
              {record.concomitants ? <p><b>Concomitants:</b> {record.concomitants}</p> : null}
              {record.mentalGenerals ? <p><b>Mental generals:</b> {record.mentalGenerals}</p> : null}
              {record.physicalGenerals ? <p><b>Physical generals:</b> {record.physicalGenerals}</p> : null}
              {record.visitType ? <p><b>Type:</b> {record.visitType==='follow-up'?'Follow-up':'Initial assessment'}</p> : null}
              {record.weightKg ? <p><b>Weight:</b> {record.weightKg} kg</p> : null}
              {record.temperatureC ? <p><b>Temperature:</b> {record.temperatureC} °C</p> : null}
              {record.pulseBpm ? <p><b>Pulse:</b> {record.pulseBpm} bpm</p> : null}
              {record.systolicBp&&record.diastolicBp ? <p><b>Blood pressure:</b> {record.systolicBp}/{record.diastolicBp} mmHg</p> : null}
              {record.assessment ? <p><b>Assessment:</b> {record.assessment}</p> : null}
              {record.carePlan ? <p><b>Care plan:</b> {record.carePlan}</p> : null}
              {record.followUpAdvice ? <p><b>Follow-up advice:</b> {record.followUpAdvice}</p> : null}
              {record.notes ? <p><b>Notes:</b> {record.notes}</p> : null}
            </div>
          </details>
        ))}
        {!cases.length ? (
          <div className="timeline-empty">No consultations yet.</div>
        ) : null}
      </div>
    </aside>
  );
}

function GateLoader({ message }: { message: string }) {
  return (
    <div className="gate-shell">
      <div className="gate-card glass-panel">
        <div className="brand-mark">PCM</div>
        <div className="gate-spinner" aria-hidden="true" />
        <p>{message}</p>
      </div>
    </div>
  );
}

function RoleMismatch({selected,onSignOut}:{selected:LoginRole;onSignOut:()=>void|Promise<void>}) {
  return <main className="access-shell"><section className="access-card glass-panel">
    <div className="brand-mark">PCM</div><p className="eyebrow">WRONG WORKSPACE</p>
    <h1>This is not a {selected==='admin'?'clinic administrator':'doctor'} account.</h1>
    <p>Sign-in succeeded but your verified Firebase role does not match the selected login.
    Return to the login page and select the appropriate workspace.</p>
    <button type="button" className="button primary" onClick={onSignOut}>Back to login selection</button>
  </section></main>;
}

function AccessDenied({ email, onSignOut, requiresVerification, onRefresh, onResend }: { email: string | null; onSignOut: () => void; requiresVerification:boolean; onRefresh:()=>Promise<void>;onResend:()=>Promise<void> }) {
  const [notice,setNotice]=useState('');
  return (
    <main className="access-shell">
      <div className="access-orb" aria-hidden="true" />
      <section className="access-card glass-panel">
        <div className="brand-mark">PCM</div>
        <p className="eyebrow">Authorization required</p>
        <h1>This account is not enabled for the application.</h1>
        <p>
          Your account is awaiting administrator approval or has been deactivated. Please contact the clinic administrator.
        </p>
        {email ? <div className="identity-chip">{email}</div> : null}
        {requiresVerification?<div className="account-verification-actions">
          <p>Verify your email address before you can access your approved account.</p>
          <button type="button" className="button secondary" onClick={async()=>{try{await onResend();setNotice('Verification email sent.');}catch{setNotice('Could not send verification email.');}}}>Resend verification email</button>
          <button type="button" className="button secondary" onClick={async()=>{try{await onRefresh();setNotice('Account status refreshed.');}catch{setNotice('Unable to check verification.');}}}>I verified my email</button>
        </div>:null}
        {notice?<p role="status">{notice}</p>:null}
        <button className="button primary" onClick={onSignOut}>Return to sign in</button>
      </section>
    </main>
  );
}

function SetupRequired() {
  return (
    <div className="setup-shell">
      <div className="setup-card glass-panel">
        <div className="brand-mark">PCM</div>
        <p className="eyebrow">Firebase setup required</p>
        <h1>Connect this build to your Firebase project.</h1>
        <p>Copy <code>.env.example</code> to <code>.env.local</code> and enter the Firebase web-app configuration values.</p>
        <pre>{'cp .env.example .env.local\nnpm run dev'}</pre>
        <p className="quiet-note">No patient data is stored until Firebase is configured.</p>
      </div>
    </div>
  );
}
