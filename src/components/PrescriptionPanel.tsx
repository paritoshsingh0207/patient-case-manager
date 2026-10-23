import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import type { Firestore } from 'firebase/firestore';
import type { MedicineCode, Patient, PrescriptionItem, PrescriptionRecord } from '../types';
import { subscribeMedicineCodes } from '../services/medicineService';
import { PrintablePrescription, SavedPrescriptionDetails, medicineDisplayLabel } from './PrescriptionViews';
import {
  createPrescription,
  voidPrescription,
  subscribePrescriptions,
} from '../services/prescriptionService';

interface PrescriptionPanelProps {
  db: Firestore;
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
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [registryError, setRegistryError] = useState('');

  useEffect(() => {
    setLoadingHistory(true);
    setHistoryError('');
    setRegistryError('');
    setPrescriptions([]);
    setViewingId(null);
    const unsubscribeCodes = subscribeMedicineCodes(
      db,
      (codes) => { setMedicineCodes(codes); setRegistryError(''); },
      () => setRegistryError('Medicine names could not be loaded from the registry.'),
    );
    const unsubscribePrescriptions = subscribePrescriptions(
      db,
      patient.id,
      (records) => {
        setPrescriptions(records);
        setHistoryError('');
        setLoadingHistory(false);
      },
      (error) => {
        setLoadingHistory(false);
        setHistoryError(error.message || 'Could not load saved prescriptions.');
      },
    );

    return () => { unsubscribeCodes(); unsubscribePrescriptions(); };
  }, [db, patient.id]);

  useEffect(() => {
    if (!printable) return;
    const clear = () => setPrintable(null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, [printable]);

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      await createPrescription(db, {
        patientId: patient.id,
        userId,
        issuedByName: practitionerName,
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
    // Commit the code-only print document before invoking the browser print dialog.
    flushSync(() => setPrintable(record));
    window.print();
  }

  async function handleVoid(record: PrescriptionRecord) {
    const reason = window.prompt('Why is this prescription being voided? The record and reason will be retained.');
    if (!reason?.trim()) return;
    if (!window.confirm('Void this prescription permanently? A replacement requires a NEW prescription.')) return;
    try {
      await voidPrescription(db, {patientId: patient.id, prescriptionId: record.id, userId, reason: reason.trim()});
      setMessage('Prescription voided with an audit reason. Historical record retained.');
      setPrintable(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not void the prescription.');
    }
  }

  function internalName(code: string) {
    const match = medicineCodes.find(item => item.code === code)
      ?? medicineCodes.find(item => item.legacyCode === code);
    return match?.remedyName ?? '';
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
          <span className="status-pill">Prescription</span>
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
                  </div>
                );
              })}
            </div>
  
            <p className="quiet-note">Save one medicine at a time. Each becomes a separate, auditable prescription entry.</p>
  
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
            <div><p className="eyebrow">History</p><h3>Saved prescriptions</h3></div>
            <span className="quiet-note">{loadingHistory?'Loading…':`${prescriptions.length} entries`}</span>
          </div>
          {registryError ? <p className="inline-error" role="alert">{registryError}</p>:null}
          {historyError ? <div className="inline-error" role="alert">
            Saved prescriptions could not be loaded: {historyError}. Check your account approval and patient assignment.
          </div>:null}
          {loadingHistory && !historyError ? <div className="empty-list" role="status">Loading saved prescriptions…</div>:null}
          {!loadingHistory && !historyError && prescriptions.map(record => (
            <article className="prescription-history-entry" key={record.id}>
              <div className="prescription-history-row">
                <div>
                  <strong>{record.issuedAt} {record.voidedAt?' · VOIDED':''}</strong>
                  <span>{record.items.map(item =>
                    medicineDisplayLabel(item.code, medicineCodes) +
                    (item.potency?' · '+item.potency:'') +
                    (item.dosageForm?' · '+item.dosageForm:'')).join(', ') || 'No medicine items recorded'}</span>
                </div>
                <span className="quiet-note">By {record.issuedByName}</span>
                <button className="button secondary" type="button"
                  aria-expanded={viewingId===record.id}
                  onClick={()=>setViewingId(current=>current===record.id?null:record.id)}>
                  {viewingId===record.id?'Hide details':'View prescription'}
                </button>
                {!record.voidedAt ? <>
                  <button className="button secondary" type="button"
                    onClick={()=>printPrescription(record)}>Print</button>
                  {(userId===record.createdBy||!canPrescribe) ?
                    <button className="button danger-text" type="button"
                      onClick={()=>handleVoid(record)}>Void</button>:null}
                </>:<span className="quiet-note">Not valid for dispensing</span>}
              </div>
              {viewingId===record.id?<SavedPrescriptionDetails record={record} medicines={medicineCodes}/>:null}
            </article>
          ))}
          {!loadingHistory && !historyError && !prescriptions.length ?
            <div className="empty-list">No saved prescriptions for this patient.</div>:null}
        </div>
      </section>

      {printable ? <PrintablePrescription record={printable} patient={patient} /> : null}
    </>
  );
}
