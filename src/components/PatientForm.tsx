import { useState, type FormEvent } from 'react';
import type { PatientInput, Sex } from '../types';

interface PatientFormProps {
  onSubmit: (input: PatientInput) => Promise<void>;
  onCancel: () => void;
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

export function PatientForm({ onSubmit, onCancel }: PatientFormProps) {
  const [form, setForm] = useState<PatientInput>(emptyPatient);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function update<K extends keyof PatientInput>(key: K, value: PatientInput[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await onSubmit(form);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save patient.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="new-patient-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Patient record</p>
            <h2 id="new-patient-title">Add patient</h2>
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
          {error ? <div className="inline-error">{error}</div> : null}
          <div className="modal-actions">
            <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Create patient'}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
