import { describe, expect, it } from 'vitest';
import { duplicateReasons, findDuplicatePairs, findPotentialDuplicates } from './patientDuplicates';
import type { Patient, PatientInput } from '../types';

const entry = (id: string, extras: Partial<Patient> = {}): Patient => ({
  id, firstName: ' Anita ', lastName: 'Sharma', doctorIds: ['doctor'], createdBy: 'doctor',
  dateOfBirth: '1984-03-14', ...extras,
});

describe('patient duplicate identification', () => {
  it('identifies same name/DOB despite spacing or letter case', () => {
    const candidate: PatientInput = { firstName: 'anita', lastName: 'SHARMA', dateOfBirth: '1984-03-14' };
    expect(findPotentialDuplicates(candidate, [entry('existing')])[0]?.reasons)
      .toContain('Same name and date of birth');
  });

  it('does not mark unrelated family members who share only phone/email', () => {
    const existing = entry('sibling', { firstName: 'Rohan', dateOfBirth: '2012-02-12', phone: '9876543210',
      email: 'family@example.test' });
    const candidate: PatientInput = { firstName: 'Anita', lastName: 'Sharma', dateOfBirth: '1984-03-14',
      phone: '+91 98765 43210', email: 'family@example.test' };
    expect(duplicateReasons(candidate, existing)).toEqual([]);
  });

  it('recognizes local and +91 phone formats when paired with a name', () => {
    expect(duplicateReasons(
      { firstName: 'Anita', lastName: 'Sharma', phone: '98765 43210' },
      entry('p2', { dateOfBirth: '', phone: '+91-9876543210' }),
    )).toContain('Same name and phone');
  });

  it('does not flag name alone or date of birth alone', () => {
    expect(duplicateReasons({ firstName: 'Anita', lastName: 'Sharma' }, entry('p'))).toEqual([]);
    expect(duplicateReasons({ firstName: 'Different', lastName: 'Person', dateOfBirth: '1984-03-14' },
      entry('p'))).toEqual([]);
  });

  it('returns each clinic-wide pair just once even if multiple clues match', () => {
    const records = [
      entry('one', { phone: '9876543210' }),
      entry('two', { firstName: 'anita', phone: '+91 9876543210' }),
      entry('three', { firstName: 'Different', lastName: 'Person', dateOfBirth: '1970-01-01' }),
    ];
    const matches = findDuplicatePairs(records);
    expect(matches).toHaveLength(1);
    expect(matches[0].reasons).toContain('Same name and date of birth');
    expect(matches[0].reasons).toContain('Same name and phone');
  });

  it('skips the same chart when inspecting an existing record', () => {
    const existing = entry('existing');
    expect(findPotentialDuplicates(existing, [existing], existing.id)).toEqual([]);
  });
});
