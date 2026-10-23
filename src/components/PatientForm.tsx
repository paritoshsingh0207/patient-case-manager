import { useState, type FormEvent } from 'react';
import type { Patient, PatientInput, Sex } from '../types';
import { patientInputFromRecord } from '../lib/patientEdits';
import { findPotentialDuplicates } from '../lib/patientDuplicates';

interface PatientFormProps {
  onSubmit: (input: PatientInput, confirmedPotentialDuplicate?: boolean) => Promise<void>;
  onCancel: () => void;
  initialPatient?: Patient;
  possiblePatients?: Patient[];
  onOpenExisting?: (patientId: string) => void;
  patientDirectoryReady?: boolean;
}

const emptyPatient: PatientInput = {
  firstName: '',
  lastName: '',
  dateOfBirth: '',
  sex: 'prefer-not-to-say',
  phone: '',
  email: '',
  occupation: '',
  address: '',
  medicalHistory: '',
  familyHistory: '',
  allergies: '',
  currentMedications: '',
};

export function PatientForm({ onSubmit, onCancel, initialPatient, possiblePatients = [],
  onOpenExisting, patientDirectoryReady = true }: PatientFormProps) {
  const isEditing = Boolean(initialPatient);
  const [form, setForm] = useState<PatientInput>(() => initialPatient
    ? patientInputFromRecord(initialPatient) : { ...emptyPatient });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmedPotentialDuplicate, setConfirmedPotentialDuplicate] = useState(false);
  const matches = isEditing ? [] : findPotentialDuplicates(form, possiblePatients);

  function update<K extends keyof PatientInput>(key: K, value: PatientInput[K]) {
    setConfirmedPotentialDuplicate(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!isEditing && !patientDirectoryReady) {
      setError('The patient directory is unavailable. Wait for it to load and try again.');
      return;
    }
    if (!isEditing && matches.length && !confirmedPotentialDuplicate) {
      setError('Review the possible matching charts and confirm before creating another patient.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit(form, !isEditing && confirmedPotentialDuplicate);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save patient.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="patient-form-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Patient record</p>
            <h2 id="patient-form-title">{isEditing ? "Edit patient profile" : "Add patient"}</h2>
          </div>
          <button className="icon-button" onClick={onCancel} type="button" aria-label="Close">×</button>
        </div>
        <form onSubmit={submit} className="patient-form">
          <div className="form-grid two">
            <label>First name<input required value={form.firstName} onChange={(e) => update('firstName', e.target.value)} /></label>
            <label>Last name<input required value={form.lastName} onChange={(e) => update('lastName', e.target.value)} /></label>
            <label>Date of birth<input type="date" value={form.dateOfBirth} onChange={(e) => update('dateOfBirth', e.target.value)} /></label>
            <label>Sex<select value={form.sex} onChange={(e) => update('sex', e.target.value as Sex)}>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
              <option value="prefer-not-to-say">Prefer not to say</option>
            </select></label>
            <label>Phone<input value={form.phone} onChange={(e) => update('phone', e.target.value)} /></label>
            <label>Email<input type="email" value={form.email} onChange={(e) => update('email', e.target.value)} /></label>
            <label>Occupation<input value={form.occupation} onChange={(e) => update('occupation', e.target.value)} /></label>
            <label>Address<input value={form.address} onChange={(e) => update('address', e.target.value)} /></label>
          </div>
          <div className="form-grid two">
            <label>Medical history<textarea value={form.medicalHistory} onChange={(e) => update('medicalHistory', e.target.value)} /></label>
            <label>Family history<textarea value={form.familyHistory} onChange={(e) => update('familyHistory', e.target.value)} /></label>
            <label>Known allergies<textarea value={form.allergies} onChange={(e) => update('allergies', e.target.value)} /></label>
            <label>Current medications<textarea value={form.currentMedications} onChange={(e) => update('currentMedications', e.target.value)} /></label>
          </div>
          {!isEditing && matches.length ? (
            <section className="duplicate-warning" aria-label="Possible existing patients">
              <strong>Possible patient already exists</strong>
              <p>These are potential matches among records you can access. Confirm identity against
                the existing chart before opening a second record. Matching fields are clues,
                not proof of identity.</p>
              <div className="duplicate-warning-list">
                {matches.slice(0, 8).map(match => (
                  <div key={match.patient.id} className="duplicate-warning-row">
                    <div>
                      <strong>{match.patient.firstName} {match.patient.lastName}</strong>
                      <small>{match.patient.dateOfBirth || 'Birth date not recorded'} · {match.reasons.join(' · ')}</small>
                    </div>
                    {onOpenExisting ? <button type="button" className="button secondary"
                      onClick={() => onOpenExisting(match.patient.id)}>Open chart</button> : null}
                  </div>
                ))}
              </div>
              {matches.length > 8 ? <p>Showing 8 of {matches.length} matches.</p> : null}
              <label className="duplicate-confirmation">
                <input type="checkbox" checked={confirmedPotentialDuplicate}
                  onChange={event => setConfirmedPotentialDuplicate(event.target.checked)} />
                I checked the possible matches and still need to create a separate patient record.
              </label>
            </section>
          ) : null}
          {!isEditing && !patientDirectoryReady ?
            <p className="inline-error" role="alert">Patient directory has not loaded. Creating a record is temporarily disabled.</p> : null}
          {error ? <div className="inline-error" role="alert">{error}</div> : null}
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={saving} onClick={onCancel}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving || (!isEditing && !patientDirectoryReady) || (!isEditing && matches.length > 0 && !confirmedPotentialDuplicate)}>{saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create patient'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
