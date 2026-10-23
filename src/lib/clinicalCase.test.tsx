import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {CaseEditor} from '../components/CaseEditor';
import type {CaseRecord} from '../types';
describe('Priority 2: structured clinical chart and comparison',()=>{
 it('renders the history comparison and structured assessment fields',()=>{
  const prior:CaseRecord={id:'old',patientId:'patient-a',createdBy:'doctor',
   consultationDate:'2026-10-01',chiefComplaint:'Prior presenting complaint',
   visitType:'follow-up',status:'completed',assessment:'Clinician historical assessment',
   carePlan:'Previous plan',weightKg:'72'};
  const html=renderToStaticMarkup(<CaseEditor patientName="Example Patient" previousCases={[prior]}
    onSaveCase={async()=>{}} onSaveSuggestion={async()=>{}}/>);
  expect(html).toContain('Previous consultations');
  expect(html).toContain('Prior presenting complaint');
  expect(html).toContain('Clinician historical assessment');
  expect(html).toContain('Clinical observations');
  expect(html).toContain('Follow-up advice');
  expect(html).toContain('Systolic BP');
 });
});
