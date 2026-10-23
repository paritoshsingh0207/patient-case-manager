import type { Patient, PatientInput } from '../types';

export interface PotentialPatientMatch {
  patient: Patient;
  reasons: string[];
}

export interface DuplicatePatientPair {
  first: Patient;
  second: Patient;
  reasons: string[];
}

function normalizeName(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/[.']/g, '').replace(/\s+/g, ' ')
    : '';
}

function normalizePhone(value: unknown): string {
  if (typeof value !== 'string') return '';
  const digits = value.replace(/\D/g, '');
  // A local ten-digit number and the same Indian number with +91 should match.
  const canonical = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return canonical.length >= 7 && canonical.length <= 15 ? canonical : '';
}

function normalizeEmail(value: unknown): string {
  if (typeof value !== 'string') return '';
  const email = value.trim().toLowerCase();
  return email.includes('@') ? email : '';
}

function patientKeys(patient: PatientInput): { name: string; dob: string; phone: string; email: string } {
  const first = normalizeName(patient.firstName);
  const last = normalizeName(patient.lastName);
  return {
    name: first && last ? first + ' ' + last : '',
    dob: typeof patient.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(patient.dateOfBirth)
      ? patient.dateOfBirth : '',
    phone: normalizePhone(patient.phone),
    email: normalizeEmail(patient.email),
  };
}

/** Two independent identity clues are needed. A shared phone or family email alone
 * is never enough to flag a chart as a likely duplicate.
 */
export function duplicateReasons(first: PatientInput, second: PatientInput): string[] {
  const a = patientKeys(first);
  const b = patientKeys(second);
  const name = Boolean(a.name && a.name === b.name);
  const dob = Boolean(a.dob && a.dob === b.dob);
  const phone = Boolean(a.phone && a.phone === b.phone);
  const email = Boolean(a.email && a.email === b.email);
  const reasons: string[] = [];
  if (name && dob) reasons.push('Same name and date of birth');
  if (name && phone) reasons.push('Same name and phone');
  if (name && email) reasons.push('Same name and email');
  if (dob && phone) reasons.push('Same date of birth and phone');
  if (dob && email) reasons.push('Same date of birth and email');
  return reasons;
}

export function findPotentialDuplicates(
  candidate: PatientInput,
  visiblePatients: Patient[],
  excludePatientId?: string,
): PotentialPatientMatch[] {
  return visiblePatients
    .filter(patient => patient.id !== excludePatientId)
    .map(patient => ({ patient, reasons: duplicateReasons(candidate, patient) }))
    .filter(match => match.reasons.length > 0)
    .sort((a, b) => b.reasons.length - a.reasons.length ||
      a.patient.lastName.localeCompare(b.patient.lastName));
}

/** Admin-only review: indexed matching avoids comparing every patient with every
 * other patient when a directory grows. No chart is ever merged or deleted.
 */
export function findDuplicatePairs(patients: Patient[], limit = 100): DuplicatePatientPair[] {
  const buckets = new Map<string, Patient[]>();
  const seen = new Set<string>();
  const result: DuplicatePatientPair[] = [];

  for (const patient of patients) {
    const { name, dob, phone, email } = patientKeys(patient);
    const keys = [
      name && dob ? 'nd:' + JSON.stringify([name, dob]) : '',
      name && phone ? 'np:' + JSON.stringify([name, phone]) : '',
      name && email ? 'ne:' + JSON.stringify([name, email]) : '',
      dob && phone ? 'dp:' + JSON.stringify([dob, phone]) : '',
      dob && email ? 'de:' + JSON.stringify([dob, email]) : '',
    ].filter(Boolean);

    for (const key of keys) {
      const earlier = buckets.get(key) ?? [];
      for (const other of earlier) {
        const pairKey = [other.id, patient.id].sort().join('|');
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        const reasons = duplicateReasons(other, patient);
        if (reasons.length) result.push({ first: other, second: patient, reasons });
        if (result.length >= limit) return result;
      }
      earlier.push(patient);
      buckets.set(key, earlier);
    }
  }
  return result.sort((a, b) => b.reasons.length - a.reasons.length);
}
