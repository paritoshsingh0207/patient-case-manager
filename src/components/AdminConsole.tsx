import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { DoctorProfile, Patient } from '../types';
import {
  createDoctorAccount,
  removeDoctorAccount,
  setPatientDoctors,
  subscribeDoctors,
} from '../services/adminService';

interface AdminConsoleProps {
  db: Firestore;
  functions: Functions;
  patients: Patient[];
}

export function AdminConsole({ db, functions, patients }: AdminConsoleProps) {
  const [doctors, setDoctors] = useState<DoctorProfile[]>([]);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [creating, setCreating] = useState(false);
  const [setupLink, setSetupLink] = useState('');
  const [message, setMessage] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<string[]>([]);
  const [savingAccess, setSavingAccess] = useState(false);

  useEffect(() => {
    return subscribeDoctors(
      db,
      setDoctors,
      (error) => setMessage(error.message),
    );
  }, [db]);

  const activeDoctors = useMemo(
    () => doctors.filter((doctor) => doctor.active && !doctor.deleted),
    [doctors],
  );

  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId) ?? null;

  useEffect(() => {
    if (!selectedPatientId && patients[0]) {
      setSelectedPatientId(patients[0].id);
      return;
    }

    if (selectedPatientId && !patients.some((patient) => patient.id === selectedPatientId)) {
      setSelectedPatientId(patients[0]?.id ?? '');
    }
  }, [patients, selectedPatientId]);

  useEffect(() => {
    setSelectedDoctorIds(selectedPatient?.doctorIds ?? []);
  }, [selectedPatient]);

  async function createDoctor(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setMessage('');
    setSetupLink('');

    try {
      const result = await createDoctorAccount(functions, { displayName, email });
      setDisplayName('');
      setEmail('');
      setSetupLink(result.setupLink);
      setMessage('Doctor account created. Share the setup link with the doctor through a trusted channel.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the doctor account.');
    } finally {
      setCreating(false);
    }
  }

  async function removeDoctor(doctor: DoctorProfile) {
    const confirmed = window.confirm(
      `Remove ${doctor.displayName} from the application? Their login will be deleted and patient access revoked, while historical authorship remains in the medical record.`,
    );
    if (!confirmed) return;

    setMessage('');
    try {
      const result = await removeDoctorAccount(functions, doctor.uid);
      setMessage(
        `${doctor.displayName} removed. Access was revoked from ${result.patientsUpdated} patient record(s).`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not remove the doctor.');
    }
  }

  function toggleDoctor(uid: string) {
    setSelectedDoctorIds((current) =>
      current.includes(uid)
        ? current.filter((doctorId) => doctorId !== uid)
        : [...current, uid],
    );
  }

  async function savePatientAccess() {
    if (!selectedPatient) return;
    setSavingAccess(true);
    setMessage('');

    try {
      await setPatientDoctors(functions, {
        patientId: selectedPatient.id,
        doctorIds: selectedDoctorIds,
      });
      setMessage('Patient access updated.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not update patient access.');
    } finally {
      setSavingAccess(false);
    }
  }

  async function copySetupLink() {
    if (!setupLink) return;
    try {
      await navigator.clipboard.writeText(setupLink);
      setMessage('Doctor setup link copied.');
    } catch {
      setMessage('Could not copy automatically. Select and copy the setup link manually.');
    }
  }

  return (
    <div className="admin-console">
      <section className="workspace-card glass-panel admin-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Administration</p>
            <h2>Doctors</h2>
            <p className="section-copy">Create doctor logins and revoke access without exposing patient records.</p>
          </div>
          <span className="status-pill">{activeDoctors.length} active</span>
        </div>

        <form className="admin-doctor-form" onSubmit={createDoctor}>
          <label>
            Doctor name
            <input
              required
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Dr. Saurabh Sharma"
            />
          </label>
          <label>
            Email
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="doctor@clinic.com"
            />
          </label>
          <button className="button primary" type="submit" disabled={creating}>
            {creating ? 'Creating…' : '+ Add doctor'}
          </button>
        </form>

        {setupLink ? (
          <div className="setup-link-panel">
            <div>
              <strong>One-time password setup link</strong>
              <span>Send this only to the new doctor through a trusted channel.</span>
            </div>
            <div className="setup-link-row">
              <input readOnly value={setupLink} aria-label="Doctor password setup link" />
              <button className="button secondary" type="button" onClick={copySetupLink}>Copy</button>
            </div>
          </div>
        ) : null}

        <div className="doctor-list">
          {activeDoctors.map((doctor) => (
            <article className="doctor-row" key={doctor.uid}>
              <div className="avatar">{doctor.displayName.slice(0, 2).toUpperCase()}</div>
              <div>
                <strong>{doctor.displayName}</strong>
                <span>{doctor.email}</span>
              </div>
              <span className="doctor-status">Active</span>
              <button className="button danger-text" type="button" onClick={() => removeDoctor(doctor)}>
                Remove
              </button>
            </article>
          ))}
          {!activeDoctors.length ? <div className="empty-list">No doctors have been added yet.</div> : null}
        </div>
      </section>

      <section className="workspace-card glass-panel admin-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Patient sharing</p>
            <h2>Care-team access</h2>
            <p className="section-copy">
              Admins can see every patient. Doctors see a patient only when their name is selected here.
            </p>
          </div>
        </div>

        <label className="patient-access-select">
          Patient
          <select value={selectedPatientId} onChange={(event) => setSelectedPatientId(event.target.value)}>
            <option value="">Select patient</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.firstName} {patient.lastName}
              </option>
            ))}
          </select>
        </label>

        {selectedPatient ? (
          <>
            <div className="access-doctor-grid">
              {activeDoctors.map((doctor) => {
                const checked = selectedDoctorIds.includes(doctor.uid);
                return (
                  <label className={`access-doctor-card ${checked ? 'selected' : ''}`} key={doctor.uid}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleDoctor(doctor.uid)}
                    />
                    <span className="avatar">{doctor.displayName.slice(0, 2).toUpperCase()}</span>
                    <span>
                      <strong>{doctor.displayName}</strong>
                      <small>{doctor.email}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            {!activeDoctors.length ? <div className="empty-list">Add a doctor before assigning patient access.</div> : null}
            <div className="admin-actions">
              <span className="quiet-note">
                {selectedDoctorIds.length
                  ? `${selectedDoctorIds.length} doctor(s) can access this patient's full case history.`
                  : 'No doctor currently has access. Admin access remains available.'}
              </span>
              <button
                className="button primary"
                type="button"
                onClick={savePatientAccess}
                disabled={savingAccess}
              >
                {savingAccess ? 'Saving…' : 'Save access'}
              </button>
            </div>
          </>
        ) : (
          <div className="empty-list">Select a patient to manage doctor access.</div>
        )}
      </section>

      {message ? <div className="save-message admin-message" role="status">{message}</div> : null}
    </div>
  );
}
