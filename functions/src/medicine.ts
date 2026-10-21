import { getApps, initializeApp } from 'firebase-admin/app';
import { createHash } from 'node:crypto';
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
const APPROVED_V1_SHA256 = '117f6e5f51811a59e15311866b62f52e41f16ee96d65cf0d591dd6d0615a92e6';
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
    const canonical = [...entries].sort((a,b) => a.code.localeCompare(b.code))
      .map(item => item.code + '\t' + item.remedyName + '\t' + item.legacyCode + '\n').join('');
    if (createHash('sha256').update(canonical, 'utf8').digest('hex') !== APPROVED_V1_SHA256) {
      throw new HttpsError('failed-precondition', 'The medicine-code mapping differs from the expert-approved release. Import canceled.');
    }
    const codes = new Set<string>(), names = new Set<string>(), legacyCodes = new Set<string>();
    for (const item of entries) {
      const name = item.remedyName.toLowerCase();
      if (codes.has(item.code) || names.has(name)) {
        throw new HttpsError('invalid-argument', 'Duplicate code or medicine name in import.');
      }
      codes.add(item.code);
      names.add(name);
      if (item.legacyCode) {
        if (legacyCodes.has(item.legacyCode)) throw new HttpsError('invalid-argument', 'Duplicate legacy code in import.');
        legacyCodes.add(item.legacyCode);
      }
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
      if (previous && (previous.active !== true || previous.approvedForNewRx !== true)) {
        throw new HttpsError('failed-precondition', 'Code ' + item.code + ' is inactive. An import cannot silently reactivate an archived code.');
      }
    }
    let created = 0, reapproved = 0;
    // Per-batch transactions guard against concurrent archives or code changes.
    // The overall release is retryable but not globally atomic across batches.
    for (let n = 0; n < entries.length; n += 300) {
      const slice = entries.slice(n, n + 300);
      let batchCreated = 0, batchReapproved = 0;
      await db.runTransaction(async (tx) => {
        batchCreated = 0; batchReapproved = 0;
        const refs = slice.map(item => db.doc('medicineCodes/' + item.code));
        const snapshots = await tx.getAll(...refs);
        for (let i = 0; i < slice.length; i++) {
          const item = slice[i];
          const snapshot = snapshots[i];
          const ref = refs[i];
          if (snapshot.exists) {
            const previous = snapshot.data()!;
            if (typeof previous.remedyName !== 'string' ||
                previous.remedyName.trim().toLowerCase() !== item.remedyName.toLowerCase() ||
                (previous.legacyCode && previous.legacyCode !== item.legacyCode) ||
                previous.active !== true || previous.approvedForNewRx !== true) {
              throw new HttpsError('already-exists', 'Cannot overwrite or reactivate code ' + item.code + '.');
            }
            tx.update(ref, {
              expertVerified: true, updatedAt: FieldValue.serverTimestamp(),
              lastImportCheckedBy: admin.uid,
            });
            batchReapproved++;
          } else {
            tx.create(ref, {
              ...item, active: true, approvedForNewRx: true,
              createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
              createdBy: admin.uid, authorizedBy: admin.uid,
              verificationAttestedOn: '2026-10-21', releaseVersion: '1.0-expert-verified',
            });
            batchCreated++;
          }
        }
      });
      created += batchCreated; reapproved += batchReapproved;
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
  if (request.data?.clinicalReviewConfirmed !== true) {
    throw new HttpsError('failed-precondition', 'Confirm review of patient medication history, allergies and identity disclosure.');
  }
  const items = rawItems.map((raw: unknown) => {
    const item = raw as Record<string, unknown> | null;
    const code = mandatory(item?.code, 'Medicine code', 24).toUpperCase();
    if (!/^[A-Z]{2}[1-9]\d*$/.test(code)) {
      throw new HttpsError('invalid-argument', 'Use an alphabetical medicine code.');
    }
    return {
      code, potency: mandatory(item?.potency, 'Potency', 40),
      dosageForm: mandatory(item?.dosageForm, 'Dosage form', 70),
      directions: mandatory(item?.directions, 'Directions', 500),
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
    clinicalReviewConfirmed: true, clinicalReviewAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
  });
  return { id: prescription.id };
});


/** Void a prescription without erasing the medical record or its signed authorship. */
export const voidCodedPrescription = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in is required.');
  const profile = (await db.doc('users/' + uid).get()).data();
  if (!profile || profile.active !== true || !['admin', 'doctor', 'practitioner'].includes(profile.role)) {
    throw new HttpsError('permission-denied', 'An active clinic member is required.');
  }
  const patientId = mandatory(request.data?.patientId, 'Patient ID', 128);
  const prescriptionId = mandatory(request.data?.prescriptionId, 'Prescription ID', 128);
  const reason = mandatory(request.data?.reason, 'Void reason', 500);
  const patientRef = db.doc('patients/' + patientId);
  const prescriptionRef = patientRef.collection('prescriptions').doc(prescriptionId);
  await db.runTransaction(async tx => {
    const [patient, prescription] = await Promise.all([tx.get(patientRef),tx.get(prescriptionRef)]);
    if (!patient.exists || !prescription.exists) throw new HttpsError('not-found', 'Prescription not found.');
    const data = prescription.data()!;
    const assigned = Array.isArray(patient.data()?.doctorIds) && patient.data()!.doctorIds.includes(uid);
    const canVoid = profile.role === 'admin' || (assigned && data.createdBy === uid);
    if (!canVoid) throw new HttpsError('permission-denied', 'Only the prescribing doctor or clinic administrator may void this prescription.');
    if (data.voidedAt) throw new HttpsError('failed-precondition', 'Prescription is already voided.');
    tx.update(prescriptionRef, {
      voidedAt: FieldValue.serverTimestamp(),
      voidedBy: uid, voidReason: reason,
    });
  });
  return { voided: true };
});
