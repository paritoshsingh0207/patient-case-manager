import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PrintablePrescription, SavedPrescriptionDetails, medicineDisplayLabel } from '../components/PrescriptionViews';
import type { MedicineCode, Patient, PrescriptionRecord } from '../types';

const medicine:MedicineCode = {
  id:'BE1',code:'BE1',remedyName:'Belladonna',active:true,approvedForNewRx:true,expertVerified:true,
  legacyCode:'B2',
};
const patient:Patient = {id:'patient-a',createdBy:'doctor-1',doctorIds:['doctor-1'],firstName:'Example',lastName:'Patient'};
const prescription:PrescriptionRecord = {
  id:'example-saved-prescription',patientId:'patient-a',createdBy:'doctor-1',
  issuedByName:'Dr Test',issuedAt:'2026-10-23',
  items:[{code:'BE1',potency:'30C',dosageForm:'drops',directions:'As prescribed',quantity:'7 days'}],
  patientInstructions:'Return for follow-up',
};
describe('saved prescription and printed prescription separation',()=>{
  it('shows the code together with the resolved medicine name on screen',()=>{
    expect(medicineDisplayLabel('BE1',[medicine])).toBe('BE1 — Belladonna');
    expect(medicineDisplayLabel('B2',[medicine])).toBe('B2 — Belladonna');
    expect(medicineDisplayLabel('ZZ99',[])).toContain('ZZ99');
    const html=renderToStaticMarkup(<SavedPrescriptionDetails record={prescription} medicines={[medicine]} />);
    expect(html).toContain('BE1 — Belladonna');
    expect(html).toContain('30C');
    expect(html).toContain('As prescribed');
    expect(html).toContain('Return for follow-up');
  });
  it('prints medicine code, potency, form and directions but never the medicine name',()=>{
    const html=renderToStaticMarkup(<PrintablePrescription record={prescription} patient={patient}/>);
    expect(html).toContain('BE1');
    expect(html).toContain('30C');
    expect(html).toContain('drops');
    expect(html).toContain('As prescribed');
    expect(html).not.toContain('Belladonna');
    expect(html).not.toContain('medicine name unavailable');
    expect(html).not.toContain('B2');
    expect(html).toContain('Example');
  });
  it('marks voided prescriptions on screen and preserves the reason',()=>{
    const html=renderToStaticMarkup(<SavedPrescriptionDetails
      record={{...prescription,voidedAt:new Date('2026-10-23'),voidReason:'Incorrect record'}}
      medicines={[medicine]}/>);
    expect(html).toContain('Voided');
    expect(html).toContain('Incorrect record');
  });
});
