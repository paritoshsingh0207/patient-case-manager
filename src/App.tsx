import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import type { CaseInput, CaseRecord, Patient, PatientInput, SuggestionResult } from './types';
import { auth, db, firebaseReady } from './lib/firebase';
import { AuthPanel } from './components/AuthPanel';
import { PatientForm } from './components/PatientForm';
import { CaseEditor } from './components/CaseEditor';
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
  const beforeBirthday = now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return Number.isFinite(age) ? String(age) : '—';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
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
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user || !db) {
      setPatients([]);
      return;
    }
    return subscribePatients(db, user.uid, (nextPatients) => {
      setPatients(nextPatients);
      setSelectedPatientId((current) => current ?? nextPatients[0]?.id ?? null);
    }, (error) => setDataError(error.message));
  }, [user]);

  useEffect(() => {
    if (!selectedPatientId || !db || !user) {
      setCases([]);
      return;
    }
    return subscribeCases(db, selectedPatientId, setCases, (error) => setDataError(error.message));
  }, [selectedPatientId, user]);

  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;
  const filteredPatients = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return patients;
    return patients.filter((patient) => `${patient.firstName} ${patient.lastName} ${patient.phone ?? ''} ${patient.email ?? ''}`.toLowerCase().includes(term));
  }, [patients, search]);

  if (!firebaseReady) {
    return <SetupRequired />;
  }

  if (authLoading || !auth || !db) {
    return <div className="center-screen">Loading workspace…</div>;
  }

  if (!user) {
    return <AuthPanel auth={auth} />;
  }

  const activeAuth = auth;

  async function addPatient(input: PatientInput) {
    if (!db || !user) return;
    const result = await createPatient(db, user.uid, input);
    setSelectedPatientId(result.id);
    setShowPatientForm(false);
  }

  async function addCase(input: CaseInput) {
    if (!db || !user || !selectedPatient) return;
    await createCase(db, selectedPatient.id, user.uid, input);
  }

  async function persistSuggestion(input: CaseInput, result: SuggestionResult) {
    if (!db || !user || !selectedPatient) return;
    await saveSuggestion(db, selectedPatient.id, user.uid, input, result);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark small">PCM</div>
          <div><strong>Case Manager</strong><span>Practitioner workspace</span></div>
        </div>
        <nav className="side-nav">
          <button className="active"><span>▦</span> Patients</button>
          <button disabled><span>◷</span> Follow-ups <em>Soon</em></button>
          <button disabled><span>⌕</span> Remedy library <em>Soon</em></button>
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip"><span>{user.email?.[0]?.toUpperCase() ?? 'P'}</span><div><strong>{user.email}</strong><small>Signed in</small></div></div>
          <button className="button text inverse" onClick={() => signOut(activeAuth)}>Sign out</button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div><p className="eyebrow">Patient case manager</p><h1>Clinical workspace</h1></div>
          <button className="button primary" onClick={() => setShowPatientForm(true)}>+ New patient</button>
        </header>

        {dataError ? <div className="page-error">{dataError}</div> : null}

        <div className="workspace-layout">
          <section className="patient-column">
            <div className="patient-search"><span>⌕</span><input placeholder="Search patients" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="patient-list-head"><span>{filteredPatients.length} patients</span><span>Recent first</span></div>
            <div className="patient-list">
              {filteredPatients.map((patient) => (
                <button key={patient.id} className={`patient-row ${patient.id === selectedPatientId ? 'selected' : ''}`} onClick={() => setSelectedPatientId(patient.id)}>
                  <span className="avatar">{initials(patient.firstName, patient.lastName)}</span>
                  <span className="patient-row-copy"><strong>{patient.firstName} {patient.lastName}</strong><small>{patient.phone || patient.email || 'No contact added'}</small></span>
                  <span className="chevron">›</span>
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
                  <CaseEditor patientName={`${selectedPatient.firstName} ${selectedPatient.lastName}`} onSaveCase={addCase} onSaveSuggestion={persistSuggestion} />
                  <CaseTimeline cases={cases} />
                </div>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">＋</div>
                <h2>Create the first patient record</h2>
                <p>Patient details, consultations, remedy reviews and follow-ups will live in one timeline.</p>
                <button className="button primary" onClick={() => setShowPatientForm(true)}>Add patient</button>
              </div>
            )}
          </section>
        </div>
      </main>

      {showPatientForm ? <PatientForm onSubmit={addPatient} onCancel={() => setShowPatientForm(false)} /> : null}
    </div>
  );
}

function PatientHeader({ patient, caseCount }: { patient: Patient; caseCount: number }) {
  return (
    <section className="patient-header workspace-card">
      <div className="avatar large">{initials(patient.firstName, patient.lastName)}</div>
      <div className="patient-identity"><p className="eyebrow">Patient record</p><h2>{patient.firstName} {patient.lastName}</h2><span>{patient.email || patient.phone || 'No contact details'}</span></div>
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
    <aside className="workspace-card timeline-card">
      <div className="section-heading compact"><div><p className="eyebrow">History</p><h3>Case timeline</h3></div><span className="quiet-note">{cases.length} entries</span></div>
      <div className="timeline-list">
        {cases.map((record) => (
          <article key={record.id} className="timeline-item">
            <div className="timeline-dot" />
            <time>{record.consultationDate}</time>
            <strong>{record.chiefComplaint}</strong>
            <p>{[record.location, record.sensation, record.modalitiesWorse && `Worse: ${record.modalitiesWorse}`, record.modalitiesBetter && `Better: ${record.modalitiesBetter}`].filter(Boolean).join(' · ') || 'No characteristic details recorded.'}</p>
          </article>
        ))}
        {!cases.length ? <div className="timeline-empty">No consultations yet. Save the first case to start the longitudinal record.</div> : null}
      </div>
    </aside>
  );
}

function SetupRequired() {
  return (
    <div className="setup-shell">
      <div className="setup-card">
        <div className="brand-mark">PCM</div>
        <p className="eyebrow">Firebase setup required</p>
        <h1>Connect this build to your Firebase project.</h1>
        <p>Copy <code>.env.example</code> to <code>.env.local</code> and enter the Firebase web-app configuration values, then enable Email/Password Authentication and Firestore.</p>
        <pre>cp .env.example .env.local{`\n`}npm run dev</pre>
        <p className="quiet-note">No patient data is stored until Firebase is configured.</p>
      </div>
    </div>
  );
}
