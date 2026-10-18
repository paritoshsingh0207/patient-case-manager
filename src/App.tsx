import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import type { CaseInput, CaseRecord, Patient, PatientInput, PractitionerAccess, SuggestionResult } from './types';
import { auth, db, firebaseReady } from './lib/firebase';
import { AuthPanel } from './components/AuthPanel';
import { PatientForm } from './components/PatientForm';
import { CaseEditor } from './components/CaseEditor';
import { hasWorkspaceAccess, subscribePractitionerAccess } from './services/accessService';
import {
  createCase,
  createPatient,
  saveSuggestion,
  subscribeCases,
  subscribePatients,
} from './services/patientService';

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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accessLoading, setAccessLoading] = useState(false);
  const [accessProfile, setAccessProfile] = useState<PractitionerAccess | null>(null);
  const [accessChecked, setAccessChecked] = useState(false);
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
    if (!user || !db || !authorized) {
      setPatients([]);
      setSelectedPatientId(null);
      return;
    }

    return subscribePatients(
      db,
      user.uid,
      (nextPatients) => {
        setPatients(nextPatients);
        setSelectedPatientId((current) => current ?? nextPatients[0]?.id ?? null);
      },
      (error) => setDataError(error.message),
    );
  }, [user, authorized]);

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

  if (!user) {
    return <AuthPanel auth={auth} />;
  }

  if (accessLoading || !accessChecked) {
    return <GateLoader message="Verifying practitioner access…" />;
  }

  if (!authorized) {
    return <AccessDenied email={user.email} onSignOut={() => signOut(auth)} />;
  }

  const activeAuth = auth;

  async function addPatient(input: PatientInput) {
    if (!db || !user || !authorized) return;
    const result = await createPatient(db, user.uid, input);
    setSelectedPatientId(result.id);
    setShowPatientForm(false);
  }

  async function addCase(input: CaseInput) {
    if (!db || !user || !selectedPatient || !authorized) return;
    await createCase(db, selectedPatient.id, user.uid, input);
  }

  async function persistSuggestion(input: CaseInput, result: SuggestionResult) {
    if (!db || !user || !selectedPatient || !authorized) return;
    await saveSuggestion(db, selectedPatient.id, user.uid, input, result);
  }

  const practitionerName =
    accessProfile?.displayName ||
    user.displayName ||
    user.email?.split('@')[0] ||
    'Practitioner';

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
          <button className="active" aria-current="page"><span>▦</span> Patients</button>
          <button disabled><span>◷</span> Follow-ups <em>Soon</em></button>
          <button disabled><span>⌕</span> Remedy library <em>Soon</em></button>
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <span>{practitionerName[0]?.toUpperCase() ?? 'P'}</span>
            <div>
              <strong>{practitionerName}</strong>
              <small>{accessProfile?.role === 'admin' ? 'Administrator' : 'Practitioner'}</small>
            </div>
          </div>
          <button className="button text inverse" onClick={() => signOut(activeAuth)}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div>
            <p className="eyebrow">Private practitioner workspace</p>
            <h1>Clinical dashboard</h1>
            <p className="topbar-subtitle">Manage patient cases in one focused, secure workspace.</p>
          </div>
          <button className="button primary" onClick={() => setShowPatientForm(true)}>+ New patient</button>
        </header>

        {dataError ? <div className="page-error" role="alert">{dataError}</div> : null}

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
              <span>{filteredPatients.length} patients</span>
              <span>Recent first</span>
            </div>
            <div className="patient-list">
              {filteredPatients.map((patient) => (
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
              {!filteredPatients.length ? <div className="empty-list">No patients found.</div> : null}
            </div>
          </section>

          <section className="detail-column">
            {selectedPatient ? (
              <>
                <PatientHeader patient={selectedPatient} caseCount={cases.length} />
                <div className="detail-grid">
                  <CaseEditor
                    patientName={`${selectedPatient.firstName} ${selectedPatient.lastName}`}
                    onSaveCase={addCase}
                    onSaveSuggestion={persistSuggestion}
                  />
                  <CaseTimeline cases={cases} />
                </div>
              </>
            ) : (
              <div className="empty-state glass-panel">
                <div className="empty-icon">＋</div>
                <p className="eyebrow">Start a case record</p>
                <h2>Create the first patient</h2>
                <p>Patient details, consultations, remedy reviews, and follow-ups stay together in one longitudinal record.</p>
                <button className="button primary" onClick={() => setShowPatientForm(true)}>Add patient</button>
              </div>
            )}
          </section>
        </div>
      </main>

      {showPatientForm ? (
        <PatientForm onSubmit={addPatient} onCancel={() => setShowPatientForm(false)} />
      ) : null}
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
        <div><strong>{patient.sex && patient.sex !== 'prefer-not-to-say' ? patient.sex : '—'}</strong><span>Sex</span></div>
      </div>
    </section>
  );
}

function CaseTimeline({ cases }: { cases: CaseRecord[] }) {
  return (
    <aside className="workspace-card timeline-card glass-panel">
      <div className="section-heading compact">
        <div>
          <p className="eyebrow">History</p>
          <h3>Case timeline</h3>
        </div>
        <span className="quiet-note">{cases.length} entries</span>
      </div>
      <div className="timeline-list">
        {cases.map((record) => (
          <article key={record.id} className="timeline-item">
            <div className="timeline-dot" />
            <time>{record.consultationDate}</time>
            <strong>{record.chiefComplaint}</strong>
            <p>
              {[
                record.location,
                record.sensation,
                record.modalitiesWorse && `Worse: ${record.modalitiesWorse}`,
                record.modalitiesBetter && `Better: ${record.modalitiesBetter}`,
              ].filter(Boolean).join(' · ') || 'No characteristic details recorded.'}
            </p>
          </article>
        ))}
        {!cases.length ? (
          <div className="timeline-empty">No consultations yet. Save the first case to start the longitudinal record.</div>
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
        <h1>This account is not enabled for the clinical workspace.</h1>
        <p>
          Authentication succeeded, but this account is not currently listed as an active practitioner.
          Contact the practice administrator if you believe this is an error.
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
