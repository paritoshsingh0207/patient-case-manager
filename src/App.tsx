import { useEffect, useMemo, useState } from 'react';
import { ClinicIcon, type ClinicIconName } from './components/ClinicIcon';
import { onAuthStateChanged, signOut, sendEmailVerification, reload, type User } from 'firebase/auth';
import type {
  CaseInput,
  CaseRecord,
  Patient,
  PatientInput,
  PractitionerAccess,
  SuggestionResult,
} from './types';
import { app, auth, db, firebaseReady } from './lib/firebase';
import { AuthPanel } from './components/AuthPanel';
import { PatientForm } from './components/PatientForm';
import { CaseEditor } from './components/CaseEditor';
import { AdminConsole } from './components/AdminConsole';
import { MedicineCodeManager } from './components/MedicineCodeManager';
import { PrescriptionPanel } from './components/PrescriptionPanel';
import { hasWorkspaceAccess, matchesLoginRole, subscribePractitionerAccess, type LoginRole } from './services/accessService';
import {createPendingDoctorProfile} from './services/registrationService';
import {
  createCase,
  createPatient,
  saveSuggestion,
  subscribeCases,
  subscribePatients,
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
  const [verificationRefresh, setVerificationRefresh] = useState(0);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessProfile, setAccessProfile] = useState<PractitionerAccess | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>('overview');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [search, setSearch] = useState('');
  const [dataError, setDataError] = useState('');

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setAuthLoading(false);
      return;
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAccessProfile(null);
      setAccessChecked(false);
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

  const authorized = hasWorkspaceAccess(accessProfile, user?.emailVerified === true);
  void verificationRefresh;

  useEffect(() => {
    if (!user || !db || !authorized || !accessProfile) {
      setPatients([]);
      setSelectedPatientId(null);
      return;
    }

    return subscribePatients(
      db,
      user.uid,
      accessProfile.role,
      (nextPatients) => {
        setPatients(nextPatients);
        setSelectedPatientId((current) =>
          current && nextPatients.some((patient) => patient.id === current)
            ? current
            : nextPatients[0]?.id ?? null,
        );
      },
      (error) => setDataError(error.message),
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
    return <AuthPanel auth={activeAuth} db={activeDb} onBeginSignIn={setLoginRole} />;
  }

  if (accessLoading || !accessChecked) {
    return <GateLoader message="Verifying application access…" />;
  }

  if (!accessProfile) {
    return <CompleteDoctorRegistration user={user} db={activeDb} onSignOut={() => signOut(activeAuth)} />;
  }
  if (!authorized) {
    return <AccountStatus user={user} profile={accessProfile}
      onRefreshed={()=>setVerificationRefresh(v=>v+1)}
      onSignOut={() => signOut(activeAuth)} />;
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
              <p className="eyebrow">{isAdmin ? 'Administration' : 'Doctor'}</p>
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
            firebaseApp={app!}
          />
        ) : null}
        </main>
      </div>

      {showPatientForm ? (
        <PatientForm onSubmit={addPatient} onCancel={() => setShowPatientForm(false)} />
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
    <div className="overview-intro"><div><h2>Patients</h2></div>
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
        <h3>Actions</h3>
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
  isDoctor,
  db,
  userId,
  practitionerName,
  addCase,
  persistSuggestion,
}: PatientWorkspaceProps) {
  const [patientTab,setPatientTab]=useState<'history'|'consultation'|'prescriptions'>('history');
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
            <PatientHeader patient={selectedPatient} caseCount={cases.length} />
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
              <button type="button" className={patientTab==='prescriptions'?'selected':''}
                aria-current={patientTab==='prescriptions'?'page':undefined}
                onClick={()=>setPatientTab('prescriptions')}><ClinicIcon name="file"/> Prescriptions</button>
            </nav>
            {patientTab==='history'?<CaseTimeline cases={cases}/>:null}
            {patientTab==='consultation'&&isDoctor?<CaseEditor
              patientName={selectedPatient.firstName+' '+selectedPatient.lastName}
              onSaveCase={addCase}
              onSaveSuggestion={persistSuggestion}
            />:null}
            {patientTab==='prescriptions'?<PrescriptionPanel
              db={db} patient={selectedPatient} userId={userId} practitionerName={practitionerName}
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

function PatientHeader({ patient, caseCount }: { patient: Patient; caseCount: number }) {
  return (
    <section className="patient-header workspace-card glass-panel">
      <div className="avatar large">{initials(patient.firstName, patient.lastName)}</div>
      <div className="patient-identity">
        <p className="eyebrow">PATIENT PROFILE</p>
        <h2>{patient.firstName} {patient.lastName}</h2>
        <span>{patient.email || patient.phone || 'No contact details'}</span>
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

function AccountStatus({user,profile,onRefreshed,onSignOut}:{
  user:User;profile:PractitionerAccess;onRefreshed:()=>void;onSignOut:()=>void|Promise<void>;
}) {
  const [feedback,setFeedback]=useState('');
  const [working,setWorking]=useState(false);
  async function resendVerification() {
    setWorking(true);setFeedback('');
    try {await sendEmailVerification(user);setFeedback('Verification email sent. Check your inbox.');}
    catch {setFeedback('Unable to send the email. Try again later.');}
    finally{setWorking(false);}
  }
  async function checkVerification() {
    setWorking(true);setFeedback('');
    try {
      await reload(user);
      await user.getIdToken(true);
      onRefreshed();
      if(!user.emailVerified)setFeedback('Email has not been verified yet.');
    }catch{setFeedback('Could not check email verification.');}
    finally{setWorking(false);}
  }
  const needsEmail=profile.emailVerificationRequired && !user.emailVerified;
  return <main className="access-shell"><section className="access-card glass-panel">
    <div className="brand-mark">PCM</div>
    <h1>{!profile.active?'Account pending approval':'Verify your email'}</h1>
    <p>{!profile.active
      ? 'Your account is awaiting administrator approval.'
      : 'Verify your email address to access your account.'}</p>
    {needsEmail?<><p>A verification link was sent to {user.email}.</p>
      <div className="account-status-actions">
        <button type="button" className="button secondary" disabled={working} onClick={resendVerification}>Resend verification</button>
        <button type="button" className="button secondary" disabled={working} onClick={checkVerification}>I've verified my email</button>
      </div>
    </>:null}
    {feedback?<p role="status">{feedback}</p>:null}
    <button className="button primary" type="button" onClick={onSignOut}>Sign out</button>
  </section></main>;
}

function CompleteDoctorRegistration({user,db,onSignOut}:{
  user:User;db:NonNullable<typeof import('./lib/firebase').db>;onSignOut:()=>void|Promise<void>;
}) {
  const [fullName,setFullName]=useState(user.displayName||'');
  const [message,setMessage]=useState('');
  const [working,setWorking]=useState(false);
  async function submit(event:import('react').FormEvent) {
    event.preventDefault();setWorking(true);setMessage('');
    try { await createPendingDoctorProfile(db,user,fullName); }
    catch(e){setMessage(e instanceof Error?e.message:'Unable to submit registration.');}
    finally{setWorking(false);}
  }
  return <main className="access-shell"><section className="access-card glass-panel">
    <div className="brand-mark">PCM</div>
    <h1>Complete doctor registration</h1>
    <form onSubmit={submit} className="stack-form">
      <label>Full name<input required minLength={2} maxLength={120} value={fullName}
        onChange={e=>setFullName(e.target.value)} autoComplete="name"/></label>
      {message?<div className="inline-error" role="alert">{message}</div>:null}
      <button className="button primary" type="submit" disabled={working}>Submit for approval</button>
    </form>
    <button type="button" className="button text" onClick={onSignOut}>Sign out</button>
  </section></main>;
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

function AccessDenied({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  return (
    <main className="access-shell">
      <div className="access-orb" aria-hidden="true" />
      <section className="access-card glass-panel">
        <div className="brand-mark">PCM</div>
        <p className="eyebrow">Authorization required</p>
        <h1>This account is not enabled for the application.</h1>
        <p>
          Authentication succeeded, but this account is not currently an active doctor or administrator.
          Contact the administrator if you believe this is an error.
        </p>
        {email ? <div className="identity-chip">{email}</div> : null}
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
