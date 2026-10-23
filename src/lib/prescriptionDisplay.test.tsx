import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { prescriptionFromData } from '../services/prescriptionService';
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

describe('historical prescription data visibility',()=>{
  it('reads a previously saved single-code record with a timestamp date',()=>{
    const record=prescriptionFromData({
      medicineCode:'BE1',issuedByName:'Dr Archived',
      issuedAt:{toDate:()=>new Date('2026-10-20T12:00:00Z')},
      potency:'30C',dosageForm:'drops',directions:'Follow the written schedule',
      patientInstructions:'Review in one week',
    },'patient-a','historical');
    expect(record.issuedAt).toBe('2026-10-20');
    expect(record.items[0]?.code).toBe('BE1');
    const html=renderToStaticMarkup(<SavedPrescriptionDetails record={record} medicines={[medicine]}/>);
    expect(html).toContain('BE1 — Belladonna');
    expect(html).toContain('Dr Archived');
    expect(html).toContain('Follow the written schedule');
  });
  it('parses current records and tolerates missing historical fields',()=>{
    const record=prescriptionFromData({
      medicineCode:'BE1',issuedAt:'2026-10-23',issuedByName:'Dr Saved',
      items:[{code:'BE1',potency:'6C',dosageForm:'globules',directions:'clinician direction',quantity:'5 days'}],
    },'patient-a','saved');
    expect(record.items).toHaveLength(1);
    expect(record.issuedAt).toBe('2026-10-23');
    expect(record.items[0]?.potency).toBe('6C');
    expect(prescriptionFromData({},'patient-a','empty').items).toEqual([]);
  });
});
