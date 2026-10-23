import { describe, expect, it } from 'vitest';
import { assertPatientFieldsUnchanged, changedPatientFields, patientInputFromRecord, validatePatientInput } from './patientEdits';
import type { Patient, PatientInput } from '../types';

const starting: PatientInput = {
  firstName: 'Jane', lastName: 'Example', allergies: 'Penicillin',
  currentMedications: 'None', medicalHistory: '', sex: 'female',
};

describe('safe patient profile editing', () => {
  it('extracts editable fields only, never patient ownership or doctor assignments', () => {
    const record: Patient = { id: 'p1', createdBy: 'admin', doctorIds: ['doctor'],
      firstName: 'Jane', lastName: 'Example', allergies: 'Penicillin' };
    expect(patientInputFromRecord(record)).toMatchObject({
      firstName: 'Jane', lastName: 'Example', allergies: 'Penicillin',
    });
    expect(patientInputFromRecord(record)).not.toHaveProperty('doctorIds');
    expect(patientInputFromRecord(record)).not.toHaveProperty('createdBy');
  });

  it('writes only edited fields and ignores whitespace-only noise', () => {
    const patch = changedPatientFields(starting, {
      ...starting, firstName: ' Jane ', allergies: 'Penicillin; latex',
    });
    expect(patch).toEqual({ allergies: 'Penicillin; latex' });
  });

  it('detects a conflicting newer edit instead of overwriting it', () => {
    const patch = changedPatientFields(starting, { ...starting, allergies: 'Latex' });
    expect(() => assertPatientFieldsUnchanged(
      { ...starting, allergies: 'Shellfish' }, starting, patch,
    )).toThrow(/updated by someone else/);
    expect(() => assertPatientFieldsUnchanged(
      { ...starting, phone: '0123456' }, starting, patch,
    )).not.toThrow();
  });

  it('rejects incomplete names and impossible birth dates', () => {
    expect(() => validatePatientInput({ ...starting, firstName: ' ' })).toThrow(/names/);
    expect(() => validatePatientInput({ ...starting, dateOfBirth: '2026-02-30' })).toThrow(/date of birth/);
    expect(() => validatePatientInput({ ...starting, email: 'not-an-email' })).toThrow(/email/);
  });
});
