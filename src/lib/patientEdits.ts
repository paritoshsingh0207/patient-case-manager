import type { Patient, PatientInput, Sex } from '../types';

const patientFields = [
  'firstName', 'lastName', 'dateOfBirth', 'sex', 'phone', 'email', 'occupation',
  'address', 'medicalHistory', 'familyHistory', 'allergies', 'currentMedications',
] as const satisfies readonly (keyof PatientInput)[];

const sexValues: Sex[] = ['female', 'male', 'other', 'prefer-not-to-say'];

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Capture only editable fields; never put care-team or clinician ownership in the form. */
export function patientInputFromRecord(patient: Patient): PatientInput {
  return {
    firstName: patient.firstName ?? '',
    lastName: patient.lastName ?? '',
    dateOfBirth: patient.dateOfBirth ?? '',
    sex: patient.sex ?? 'prefer-not-to-say',
    phone: patient.phone ?? '',
    email: patient.email ?? '',
    occupation: patient.occupation ?? '',
    address: patient.address ?? '',
    medicalHistory: patient.medicalHistory ?? '',
    familyHistory: patient.familyHistory ?? '',
    allergies: patient.allergies ?? '',
    currentMedications: patient.currentMedications ?? '',
  };
}

export function validatePatientInput(input: PatientInput): void {
  for (const key of ['firstName', 'lastName'] as const) {
    const length = text(input[key]).length;
    if (length < 1 || length > 120) throw Error('Patient first and last names must be 1–120 characters.');
  }
  if (input.sex && !sexValues.includes(input.sex)) throw Error('Select a valid sex.');
  const date = text(input.dateOfBirth);
  if (date) {
    const parsed = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(parsed.getTime()) ||
        parsed.toISOString().slice(0, 10) !== date ||
        date > new Date().toISOString().slice(0, 10)) {
      throw Error('Enter a valid date of birth that is not in the future.');
    }
  }
  const email = text(input.email);
  if (email && (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))) {
    throw Error('Enter a valid email address or leave it empty.');
  }
  if (text(input.phone).length > 40) throw Error('Phone must be at most 40 characters.');
  for (const key of ['occupation', 'address', 'medicalHistory', 'familyHistory', 'allergies', 'currentMedications'] as const) {
    if (text(input[key]).length > 5000) throw Error('Patient details must be at most 5,000 characters per field.');
  }
}

/** Only send actually changed fields, minimizing accidental overwrites. */
export function changedPatientFields(original: PatientInput, edited: PatientInput): Partial<PatientInput> {
  validatePatientInput(edited);
  const changes: Partial<PatientInput> = {};
  for (const field of patientFields) {
    if (text(original[field]) !== text(edited[field])) {
      Object.assign(changes, { [field]: text(edited[field]) });
    }
  }
  return changes;
}

/** Compare each intended edit with the opening snapshot inside a Firestore transaction. */
export function assertPatientFieldsUnchanged(
  latest: Record<string, unknown>,
  original: PatientInput,
  changes: Partial<PatientInput>,
): void {
  for (const field of patientFields) {
    if (Object.prototype.hasOwnProperty.call(changes, field) &&
        text(latest[field]) !== text(original[field])) {
      throw Error('This patient was updated by someone else. Close the editor, review the latest record, and try again.');
    }
  }
}
