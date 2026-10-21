import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

// Callable endpoints authenticate and authorize independently of browser UI.
if (!getApps().length) initializeApp();
const db = getFirestore();

async function activeProfile(uid: string | undefined, adminOnly = true) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const profile = (await db.doc('users/' + uid).get()).data();
  if (!profile || profile.active !== true ||
    (adminOnly ? profile.role !== 'admin' : !['doctor', 'practitioner'].includes(profile.role))) {
    throw new HttpsError('permission-denied', 'Active clinic privileges are required.');
  }
  return { uid, profile };
}
function mandatory(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new HttpsError('invalid-argument', field + ' is invalid.');
  }
  return value.trim();
}
function optional(value: unknown, maximum: number): string {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > maximum) {
    throw new HttpsError('invalid-argument', 'Registry metadata is invalid.');
  }
  return value.trim();
}
type VerifiedMedicine = ReturnType<typeof validateMedicine>;
function validateMedicine(raw: unknown) {
  if (!raw || typeof raw !== 'object') {
    throw new HttpsError('invalid-argument', 'Each medicine must be an object.');
  }
  const item = raw as Record<string, unknown>;
  const code = mandatory(item.code, 'Code', 24).toUpperCase();
  const remedyName = mandatory(item.remedyName, 'Medicine name', 180);
  const prefix = remedyName.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  if (!/^[A-Z]{2}[1-9]\d*$/.test(code) || code.slice(0, 2) !== prefix) {
    throw new HttpsError('invalid-argument', 'Medicine prefix does not match code ' + code + '.');
  }
  if (item.expertVerified !== true || item.reviewStatus !== 'Verified') {
    throw new HttpsError('failed-precondition', 'Code ' + code + ' is not expert verified.');
  }
  return {
    code, remedyName,
    legacyCode: optional(item.legacyCode, 24),
    traditionalAbbreviation: optional(item.traditionalAbbreviation, 60),
    synonymsOrAliases: optional(item.synonymsOrAliases, 1000),
    sourceCoverage: optional(item.sourceCoverage, 300),
    expertVerified: true,
    reviewStatus: 'Verified' as const,
  };
}

// 881-entry bulk import: validate all mappings before writing any. Safe to retry.
export const importVerifiedMedicines = onCall(
  { timeoutSeconds: 180, memory: '512MiB' },
  async (request) => {
    const admin = await activeProfile(request.auth?.uid);
    if (request.data?.clinicalUseApproved !== true) {
      throw new HttpsError('failed-precondition', 'Explicit clinical approval is required.');
    }
    if (request.data?.schemaVersion !== '1' || request.data?.releaseVersion !== '1.0-expert-verified') {
      throw new HttpsError('invalid-argument', 'Please use the expert-verified v1 JSON file.');
    }
    const raw = request.data?.documents;
    if (!Array.isArray(raw) || raw.length !== 881) {
      throw new HttpsError('invalid-argument', 'The approved release must contain exactly 881 medicines.');
    }
    const entries: VerifiedMedicine[] = raw.map(validateMedicine);
    const codes = new Set<string>(), names = new Set<string>();
    for (const item of entries) {
      const name = item.remedyName.toLowerCase();
      if (codes.has(item.code) || names.has(name)) {
        throw new HttpsError('invalid-argument', 'Duplicate code or medicine name in import.');
      }
      codes.add(item.code);
      names.add(name);
    }
    const existing = new Map<string, Record<string, unknown>>();
    for (let n = 0; n < entries.length; n += 200) {
      const group = entries.slice(n, n + 200);
      const snapshots = await db.getAll(...group.map((x) => db.doc('medicineCodes/' + x.code)));
      for (const snapshot of snapshots) {
        if (snapshot.exists) existing.set(snapshot.id, snapshot.data() as Record<string, unknown>);
      }
    }
    for (const item of entries) {
      const previous = existing.get(item.code);
      if (previous && (
        typeof previous.remedyName !== 'string' ||
        previous.remedyName.trim().toLowerCase() !== item.remedyName.toLowerCase() ||
        (previous.legacyCode && previous.legacyCode !== item.legacyCode)
      )) {
        throw new HttpsError('already-exists', 'Code ' + item.code + ' already maps to a different medicine.');
      }
    }
    let created = 0, reapproved = 0;
    // Firestore batches are not globally atomic; a retry completes partial progress.
    for (let n = 0; n < entries.length; n += 300) {
      const batch = db.batch();
      for (const item of entries.slice(n, n + 300)) {
        const ref = db.doc('medicineCodes/' + item.code);
        if (existing.has(item.code)) {
          batch.update(ref, {
            active: true, approvedForNewRx: true, expertVerified: true,
            updatedAt: FieldValue.serverTimestamp(), authorizedBy: admin.uid,
          });
          reapproved++;
        } else {
          batch.create(ref, {
            ...item, active: true, approvedForNewRx: true,
            createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
            createdBy: admin.uid, authorizedBy: admin.uid,
            verificationAttestedOn: '2026-10-21', releaseVersion: '1.0-expert-verified',
          });
          created++;
        }
      }
      await batch.commit();
    }
    return { imported: entries.length, created, reapproved };
  },
);

// Single newly reviewed entries never overwrite a previously issued code.
export const registerMedicineCode = onCall(async (request) => {
  const admin = await activeProfile(request.auth?.uid);
  if (request.data?.expertVerified !== true || request.data?.clinicalUseApproved !== true) {
    throw new HttpsError('failed-precondition', 'Expert and clinical approval must be confirmed.');
  }
  const item = validateMedicine({
    code: request.data?.code, remedyName: request.data?.remedyName,
    expertVerified: true, reviewStatus: 'Verified',
  });
  try {
    await db.doc('medicineCodes/' + item.code).create({
      ...item, notes: optional(request.data?.notes, 500),
      active: true, approvedForNewRx: true,
      createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      createdBy: admin.uid, authorizedBy: admin.uid, releaseVersion: 'manual-expert-approved',
    });
  } catch (error) {
    if ((error as { code?: number }).code === 6) {
      throw new HttpsError('already-exists', 'This medicine code already exists and cannot be reassigned.');
    }
    throw error;
  }
  return { code: item.code };
});

export const archiveMedicineCode = onCall(async (request) => {
  const admin = await activeProfile(request.auth?.uid);
  const code = mandatory(request.data?.code, 'Code', 24).toUpperCase();
  const ref = db.doc('medicineCodes/' + code);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'Code not found.');
  await ref.update({
    active: false, approvedForNewRx: false,
    updatedAt: FieldValue.serverTimestamp(), archivedBy: admin.uid,
  });
  return { archived: true };
});

// A doctor cannot circumvent approved-code checks using direct Firestore writes.
export const createCodedPrescription = onCall(async (request) => {
  const doctor = await activeProfile(request.auth?.uid, false);
  const patientId = mandatory(request.data?.patientId, 'Patient ID', 128);
  const patient = (await db.doc('patients/' + patientId).get()).data();
  if (!patient || !Array.isArray(patient.doctorIds) || !patient.doctorIds.includes(doctor.uid)) {
    throw new HttpsError('permission-denied', 'You are not assigned to this patient.');
  }
  const issuedAt = mandatory(request.data?.issuedAt, 'Prescription date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedAt) ||
      Number.isNaN(Date.parse(issuedAt)) ||
      new Date(issuedAt).toISOString().slice(0, 10) !== issuedAt) {
    throw new HttpsError('invalid-argument', 'Prescription date is invalid.');
  }
  const rawItems: unknown = request.data?.items;
  if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 20) {
    throw new HttpsError('invalid-argument', 'Add between 1 and 20 medicines.');
  }
  const items = rawItems.map((raw: unknown) => {
    const item = raw as Record<string, unknown> | null;
    const code = mandatory(item?.code, 'Medicine code', 24).toUpperCase();
    if (!/^[A-Z]{2}[1-9]\d*$/.test(code)) {
      throw new HttpsError('invalid-argument', 'Use an alphabetical medicine code.');
    }
    return {
      code, directions: mandatory(item?.directions, 'Directions', 500),
      quantity: optional(item?.quantity, 200),
    };
  });
  const uniqueCodes = [...new Set(items.map((x) => x.code))];
  const records = await db.getAll(...uniqueCodes.map((code) => db.doc('medicineCodes/' + code)));
  for (const record of records) {
    const data = record.data();
    if (!data || data.active !== true || data.approvedForNewRx !== true) {
      throw new HttpsError('failed-precondition', 'Code ' + record.id + ' is not approved for new prescriptions.');
    }
  }
  const prescription = await db.collection('patients/' + patientId + '/prescriptions').add({
    patientId, createdBy: doctor.uid,
    issuedByName: typeof doctor.profile.displayName === 'string' ? doctor.profile.displayName : 'Doctor',
    issuedAt, items, patientInstructions: optional(request.data?.patientInstructions, 3000),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: prescription.id };
});
