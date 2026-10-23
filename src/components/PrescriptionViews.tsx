import type { MedicineCode, Patient, PrescriptionRecord } from '../types';

const clinicName = import.meta.env.VITE_CLINIC_NAME?.trim() || 'Clinic';
const clinicAddress = import.meta.env.VITE_CLINIC_ADDRESS?.trim() || '';
const clinicContact = import.meta.env.VITE_CLINIC_CONTACT?.trim() || '';

/** Names are for authorized on-screen review. The print component never receives the registry. */
export function medicineDisplayLabel(code: string, medicines: MedicineCode[]) {
  const medicine = medicines.find(item => item.code === code)
    ?? medicines.find(item => item.legacyCode === code);
  return medicine?.remedyName ? `${code} — ${medicine.remedyName}` : `${code} — medicine name unavailable`;
}

export function SavedPrescriptionDetails({
  record, medicines,
}: {record: PrescriptionRecord; medicines: MedicineCode[]}) {
  return <section className="prescription-saved-detail" aria-label="Saved prescription details">
    <div className="prescription-saved-meta">
      <span><strong>Date:</strong> {record.issuedAt}</span>
      <span><strong>Prescriber:</strong> {record.issuedByName}</span>
      <span><strong>Reference:</strong> RX-{record.id.slice(0,8).toUpperCase()}</span>
      <span><strong>Status:</strong> {record.voidedAt?'Voided':'Saved'}</span>
    </div>
    {record.items.length ? <div className="prescription-saved-items">
      {record.items.map((item, index) => <div className="prescription-saved-item" key={item.code+'-'+index}>
        <strong>{medicineDisplayLabel(item.code, medicines)}</strong>
        <dl>
          <div><dt>Potency / strength</dt><dd>{item.potency||'Not recorded'}</dd></div>
          <div><dt>Form</dt><dd>{item.dosageForm||'Not recorded'}</dd></div>
          <div><dt>Directions</dt><dd>{item.directions||'Not recorded'}</dd></div>
          <div><dt>Quantity / duration</dt><dd>{item.quantity||'Not recorded'}</dd></div>
        </dl>
      </div>)}
    </div>:<p>No medicine items were recorded in this prescription.</p>}
    {record.patientInstructions ? <p><strong>Patient instructions:</strong> {record.patientInstructions}</p>:null}
    {record.voidedAt ? <p className="prescription-voided-reason"><strong>Voided:</strong> {record.voidReason||'Reason unavailable'}</p>:null}
  </section>;
}

/** Only coded identification, potency/form, instructions and quantity appear on paper.
 * Medicine identity must still be accessible to authorized dispensers as clinically required.
 */
export function PrintablePrescription({record,patient}:{
  record:PrescriptionRecord;patient:Patient;
}) {
  return <section className="prescription-print" aria-hidden="true">
    <header>
      <div>
        <strong>{clinicName}</strong>
        <span>Prescription</span>
        {clinicAddress ? <small className="print-clinic-meta">{clinicAddress}</small>:null}
        {clinicContact ? <small className="print-clinic-meta">{clinicContact}</small>:null}
      </div>
      <div className="print-rx">Rx</div>
    </header>
    <div className="print-patient-grid">
      <div><span>Patient</span><strong>{patient.firstName} {patient.lastName}</strong></div>
      <div><span>Date</span><strong>{record.issuedAt}</strong></div>
      <div><span>Reference</span><strong>RX-{record.id.slice(0,8).toUpperCase()}</strong></div>
    </div>
    <table>
      <thead><tr>
        <th>Medicine code</th><th>Directions</th><th>Quantity / duration</th>
      </tr></thead>
      <tbody>{record.items.map((item,index)=><tr key={item.code+'-'+index}>
        <td><strong>{item.code}</strong>
          {item.potency?<span className="rx-dispensary-detail">{item.potency}</span>:null}
          {item.dosageForm?<span className="rx-dispensary-detail">{item.dosageForm}</span>:null}
        </td>
        <td>{item.directions}</td><td>{item.quantity||'—'}</td>
      </tr>)}</tbody>
    </table>
    {record.patientInstructions?<div className="print-instructions">
      <span>Instructions</span><p>{record.patientInstructions}</p>
    </div>:null}
    <footer>
      <div><span>Prescribed by</span><strong>{record.issuedByName}</strong></div>
      <p>Verify full medicine identity, preparation, strength and instructions before dispensing.</p>
    </footer>
  </section>;
}
