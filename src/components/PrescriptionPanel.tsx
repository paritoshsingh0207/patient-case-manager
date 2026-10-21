import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';
import type { MedicineCode, Patient, PrescriptionItem, PrescriptionRecord } from '../types';
import { subscribeMedicineCodes } from '../services/medicineService';
import {
  createPrescription,
  voidPrescription,
  subscribePrescriptions,
} from '../services/prescriptionService';

interface PrescriptionPanelProps {
  db: Firestore;
  functions: Functions;
  patient: Patient;
  userId: string;
  practitionerName: string;
  canPrescribe: boolean;
}

function localDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function emptyItem(): PrescriptionItem {
  return { code: '', potency: '', dosageForm: '', directions: '', quantity: '' };
}

export function PrescriptionPanel({
  db,
  functions,
  patient,
  userId,
  practitionerName,
  canPrescribe,
}: PrescriptionPanelProps) {
  const [medicineCodes, setMedicineCodes] = useState<MedicineCode[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [issuedAt, setIssuedAt] = useState(localDate);
  const [items, setItems] = useState<PrescriptionItem[]>([emptyItem()]);
  const [patientInstructions, setPatientInstructions] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [printable, setPrintable] = useState<PrescriptionRecord | null>(null);

  useEffect(() => {
    const unsubscribeCodes = subscribeMedicineCodes(
      db,
      setMedicineCodes,
      (error) => setMessage(error.message),
    );
    const unsubscribePrescriptions = subscribePrescriptions(
      db,
      patient.id,
      setPrescriptions,
      (error) => setMessage(error.message),
    );

    return () => {
      unsubscribeCodes();
      unsubscribePrescriptions();
    };
  }, [db, patient.id]);

  const activeCodes = useMemo(
    () => medicineCodes.filter((item) => item.active && item.approvedForNewRx),
    [medicineCodes],
  );

  function updateItem(index: number, key: keyof PrescriptionItem, value: string) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  }

  function removeItem(index: number) {
    setItems((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      return next.length ? next : [emptyItem()];
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      await createPrescription(functions, {
        patientId: patient.id,
        issuedAt,
        items,
        patientInstructions,
        clinicalReviewConfirmed: reviewConfirmed,
      });
      setItems([emptyItem()]);
      setPatientInstructions('');
      setReviewConfirmed(false);
      setMessage('Approved coded prescription saved. Clinic medicine mapping remains available for authorized verification.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save prescription.');
    } finally {
      setSaving(false);
    }
  }

  function printPrescription(record: PrescriptionRecord) {
    if (record.voidedAt) return;
    setPrintable(record);
    window.setTimeout(() => window.print(), 80);
  }

  async function handleVoid(record: PrescriptionRecord) {
    const reason = window.prompt('Why is this prescription being voided? The record and reason will be retained.');
    if (!reason?.trim()) return;
    if (!window.confirm('Void this prescription permanently? A replacement requires a NEW prescription.')) return;
    try {
      await voidPrescription(functions, {patientId: patient.id, prescriptionId: record.id, reason: reason.trim()});
      setMessage('Prescription voided with an audit reason. Historical record retained.');
      setPrintable(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not void the prescription.');
    }
  }

  function internalName(code: string) {
    return medicineCodes.find((item) => item.code === code)?.remedyName ?? '';
  }

  return (
    <>
      <section className="workspace-card glass-panel prescription-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Patient-facing codes</p>
            <h2>Prescription</h2>
            <p className="section-copy">
              Only active, expert-approved medicine codes can be prescribed. Keep full medicine identity available to authorized dispensers and patients as required.
            </p>
          </div>
          <span className="status-pill">Code only</span>
        </div>

        {canPrescribe ? (
          <form onSubmit={submit} className="prescription-form">
            <label className="prescription-date">
              Prescription date
              <input type="date" required value={issuedAt} onChange={(event) => setIssuedAt(event.target.value)} />
            </label>
  
            <div className="prescription-items">
              {items.map((item, index) => {
                const remedyName = internalName(item.code);
                return (
                  <div className="prescription-item-editor" key={index}>
                    <label>
                      Medicine code
                      <select
                        required
                        value={item.code}
                        onChange={(event) => updateItem(index, 'code', event.target.value)}
                      >
                        <option value="">Select code</option>
                        {activeCodes.map((medicine) => (
                          <option key={medicine.id} value={medicine.code}>
                            {medicine.code} — {medicine.remedyName}
                          </option>
                        ))}
                      </select>
                      {remedyName ? <small className="internal-remedy-hint">Internal: {remedyName}</small> : null}
                    </label>
                    <label>
                      Potency / strength
                      <input required maxLength={40} value={item.potency ?? ''} onChange={(event) => updateItem(index, 'potency', event.target.value)} placeholder="e.g. 30C, 200C, Q" />
                    </label>
                    <label>
                      Dosage form
                      <input required maxLength={70} value={item.dosageForm ?? ''} onChange={(event) => updateItem(index, 'dosageForm', event.target.value)} placeholder="e.g. globules, drops" />
                    </label>
                    <label>
                      Directions visible to patient
                      <input
                        required
                        value={item.directions}
                        onChange={(event) => updateItem(index, 'directions', event.target.value)}
                        placeholder="e.g. 4 pills twice daily"
                      />
                    </label>
                    <label>
                      Quantity / duration
                      <input
                        value={item.quantity ?? ''}
                        onChange={(event) => updateItem(index, 'quantity', event.target.value)}
                        placeholder="e.g. 7 days"
                      />
                    </label>
                    <button
                      className="button danger-text compact-button"
                      type="button"
                      onClick={() => removeItem(index)}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
  
            <button
              className="button secondary add-line-button"
              type="button"
              onClick={() => setItems((current) => [...current, emptyItem()])}
            >
              + Add medicine
            </button>
  
            <label>
              Patient instructions
              <textarea
                value={patientInstructions}
                onChange={(event) => setPatientInstructions(event.target.value)}
                placeholder="Diet, follow-up, precautions, or other patient-visible instructions."
              />
            </label>
  
            <div className="registry-review-box">
              <strong>Clinical identity and safety review</strong>
              <p className="quiet-note">Patient allergies: {patient.allergies || 'Not documented'} · Current medicines: {patient.currentMedications || 'Not documented'}</p>
              <label className="registry-approval">
                <input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)}/>
                I reviewed allergies, current medicines and dispensing details and will ensure the patient can obtain the complete medicine identity.
              </label>
            </div>
            <div className="case-actions">
              <span className="quiet-note">The clinic registry retains the full medicine identity for clinical and dispensing verification.</span>
              <button className="button primary" type="submit" disabled={saving || !activeCodes.length || !reviewConfirmed}>
                {saving ? 'Saving…' : 'Save coded prescription'}
              </button>
            </div>
          </form>
        ) : (
          <div className="admin-readonly-note">
            Administrators can review and print prescriptions, but only doctors can create clinical prescriptions.
          </div>
        )}

        {message ? <div className="save-message" role="status">{message}</div> : null}

        <div className="prescription-history">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">History</p>
              <h3>Saved prescriptions</h3>
            </div>
            <span className="quiet-note">{prescriptions.length} entries</span>
          </div>

          {prescriptions.map((record) => (
            <article className="prescription-history-row" key={record.id}>
              <div>
                <strong>{record.issuedAt} {record.voidedAt ? ' · VOIDED' : ''}</strong>
                <span>{record.items.map((item) => item.code + (internalName(item.code) ? ' — ' + internalName(item.code) : ' — needs verification') + (item.potency ? ' · ' + item.potency : '') + (item.dosageForm ? ' · ' + item.dosageForm : '')).join(', ')}</span>
                {record.voidedAt ? <span>Void reason: {record.voidReason || 'Not specified'}</span> : null}
              </div>
              <span className="quiet-note">By {record.issuedByName}</span>
              {record.voidedAt ? <span className="quiet-note">Not valid for dispensing</span> : <>
                <button className="button secondary" type="button" onClick={() => printPrescription(record)}>Print</button>
                {(userId === record.createdBy || !canPrescribe) ? <button className="button danger-text" type="button" onClick={() => handleVoid(record)}>Void</button> : null}
              </>}
            </article>
          ))}
          {!prescriptions.length ? <div className="empty-list">No prescriptions saved yet.</div> : null}
        </div>
      </section>

      {printable ? (
        <section className="prescription-print" aria-hidden="true">
          <header>
            <div>
              <strong>Patient Case Manager</strong>
              <span>Prescription</span>
            </div>
            <div className="print-rx">Rx</div>
          </header>

          <div className="print-patient-grid">
            <div><span>Patient</span><strong>{patient.firstName} {patient.lastName}</strong></div>
            <div><span>Date</span><strong>{printable.issuedAt}</strong></div>
            <div><span>Reference</span><strong>RX-{printable.id.slice(0, 8).toUpperCase()}</strong></div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Medicine code</th>
                <th>Directions</th>
                <th>Quantity / duration</th>
              </tr>
            </thead>
            <tbody>
              {printable.items.map((item, index) => (
                <tr key={`${item.code}-${index}`}>
                  <td><strong>{item.code}</strong>{item.potency ? <span className="rx-dispensary-detail">{item.potency}</span> : null}{item.dosageForm ? <span className="rx-dispensary-detail">{item.dosageForm}</span> : null}</td>
                  <td>{item.directions}</td>
                  <td>{item.quantity || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {printable.patientInstructions ? (
            <div className="print-instructions">
              <span>Instructions</span>
              <p>{printable.patientInstructions}</p>
            </div>
          ) : null}

          <footer>
            <div>
              <span>Prescribed by</span>
              <strong>{printable.issuedByName}</strong>
            </div>
            <p>Medicine names and dispensing details are available from the clinic on request.</p>
          </footer>
        </section>
      ) : null}
    </>
  );
}
