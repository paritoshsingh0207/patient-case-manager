import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
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
import { hasWorkspaceAccess, subscribePractitionerAccess } from './services/accessService';
import {
  createCase,
  createPatient,
  saveSuggestion,
  subscribeCases,
  subscribePatients,
} from './services/patientService';

type WorkspaceView = 'patients' | 'medicines' | 'admin';

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
  if (view === 'medicines') return 'Medicine code registry';
  if (view === 'admin') return 'Administration';
  return 'Clinical dashboard';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessProfile, setAccessProfile] = useState<PractitionerAccess | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
  const [activeView, setActiveView] = useState<WorkspaceView>('patients');
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
      setActiveView('patients');
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

  const authorized = hasWorkspaceAccess(accessProfile);

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
    return <AuthPanel auth={activeAuth} />;
  }

  if (accessLoading || !accessChecked) {
    return <GateLoader message="Verifying application access…" />;
  }

  if (!authorized || !accessProfile) {
    return <AccessDenied email={user.email} onSignOut={() => signOut(activeAuth)} />;
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

  const navigation = (
    <>
      <button
        className={activeView === 'patients' ? 'active' : ''}
        aria-current={activeView === 'patients' ? 'page' : undefined}
        onClick={() => setActiveView('patients')}
      >
        <span>▦</span> Patients
      </button>
      <button
        className={activeView === 'medicines' ? 'active' : ''}
        aria-current={activeView === 'medicines' ? 'page' : undefined}
        onClick={() => setActiveView('medicines')}
      >
        <span>⌕</span> Medicine codes
      </button>
      {isAdmin ? (
        <button
          className={activeView === 'admin' ? 'active' : ''}
          aria-current={activeView === 'admin' ? 'page' : undefined}
          onClick={() => setActiveView('admin')}
        >
          <span>⚙</span> Admin
        </button>
      ) : null}
    </>
  );

  return (
    <div className="app-shell">
      <div className="app-orb app-orb-one" aria-hidden="true" />
      <div className="app-orb app-orb-two" aria-hidden="true" />

      <aside className="sidebar glass-panel">
        <div className="brand-block">
          <div className="brand-mark small">PCM</div>
          <div>
            <strong>Case Manager</strong>
            <span>Clinical workspace</span>
          </div>
        </div>

        <nav className="side-nav" aria-label="Primary navigation">
          {navigation}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <span>{practitionerName[0]?.toUpperCase() ?? 'P'}</span>
            <div>
              <strong>{practitionerName}</strong>
              <small>{isAdmin ? 'Administrator' : 'Doctor'}</small>
            </div>
          </div>
          <button className="button text inverse" onClick={() => signOut(activeAuth)}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">{isAdmin ? 'Clinic administration & records' : 'Assigned patient workspace'}</p>
            <h1>{viewTitle(activeView)}</h1>
            <p className="topbar-subtitle">
              {isAdmin
                ? 'Control doctor access while retaining visibility across the clinic.'
                : 'Only patients assigned to you are visible in this workspace.'}
            </p>
          </div>
          {activeView === 'patients' ? (
            <button className="button primary" onClick={() => setShowPatientForm(true)}>+ New patient</button>
          ) : null}
        </header>

        <nav className="mobile-nav glass-panel" aria-label="Mobile navigation">
          {navigation}
        </nav>

        {dataError ? <div className="page-error" role="alert">{dataError}</div> : null}

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
          />
        ) : null}
      </main>

      {showPatientForm ? (
        <PatientForm onSubmit={addPatient} onCancel={() => setShowPatientForm(false)} />
      ) : null}
    </div>
  );
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
            <div className={`detail-grid ${isDoctor ? '' : 'admin-history-grid'}`}>
              {isDoctor ? (
                <CaseEditor
                  patientName={`${selectedPatient.firstName} ${selectedPatient.lastName}`}
                  onSaveCase={addCase}
                  onSaveSuggestion={persistSuggestion}
                />
              ) : null}
              <CaseTimeline cases={cases} />
            </div>
            <PrescriptionPanel
              db={db}
              patient={selectedPatient}
              userId={userId}
              practitionerName={practitionerName}
              canPrescribe={isDoctor}
            />
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
        <p className="eyebrow">Patient record</p>
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
