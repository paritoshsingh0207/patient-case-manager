import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

const db = getFirestore();
const auth = getAuth();

async function requireAdmin(uid: string | undefined) {
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in is required.');
  }

  const snapshot = await db.doc(`users/${uid}`).get();
  const data = snapshot.data();

  if (!snapshot.exists || data?.active !== true || data?.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Administrator access is required.');
  }

  return { uid, profile: data };
}

function requireString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== 'string') {
    throw new HttpsError('invalid-argument', `${field} is required.`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new HttpsError('invalid-argument', `${field} is invalid.`);
  }

  return normalized;
}

export const createDoctor = onCall(async (request) => {
  const admin = await requireAdmin(request.auth?.uid);
  const email = requireString(request.data?.email, 'Email', 254).toLowerCase();
  const displayName = requireString(request.data?.displayName, 'Display name', 120);

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email,
      displayName,
      disabled: false,
      emailVerified: false,
    });
  } catch (error) {
    throw new HttpsError(
      'already-exists',
      error instanceof Error ? error.message : 'Could not create the doctor account.',
    );
  }

  try {
    await db.doc(`users/${userRecord.uid}`).set({
      active: true,
      role: 'doctor',
      displayName,
      email,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: admin.uid,
    });

    const setupLink = await auth.generatePasswordResetLink(email);
    return { uid: userRecord.uid, setupLink };
  } catch (error) {
    await auth.deleteUser(userRecord.uid).catch(() => undefined);
    throw new HttpsError(
      'internal',
      error instanceof Error ? error.message : 'Could not finish creating the doctor account.',
    );
  }
});

export const removeDoctor = onCall(async (request) => {
  const admin = await requireAdmin(request.auth?.uid);
  const uid = requireString(request.data?.uid, 'Doctor UID', 128);

  if (uid === admin.uid) {
    throw new HttpsError('failed-precondition', 'An administrator cannot remove their own account here.');
  }

  const doctorRef = db.doc(`users/${uid}`);
  const doctorSnapshot = await doctorRef.get();
  const doctor = doctorSnapshot.data();

  if (!doctorSnapshot.exists || !['doctor', 'practitioner'].includes(doctor?.role)) {
    throw new HttpsError('not-found', 'Doctor account not found.');
  }

  const patientSnapshot = await db
    .collection('patients')
    .where('doctorIds', 'array-contains', uid)
    .get();

  const docs = patientSnapshot.docs;
  for (let start = 0; start < docs.length; start += 400) {
    const batch = db.batch();
    for (const patientDoc of docs.slice(start, start + 400)) {
      batch.update(patientDoc.ref, {
        doctorIds: FieldValue.arrayRemove(uid),
        updatedAt: FieldValue.serverTimestamp(),
        accessUpdatedBy: admin.uid,
      });
    }
    await batch.commit();
  }

  try {
    await auth.deleteUser(uid);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (!message.includes('user-not-found')) {
      throw new HttpsError('internal', 'Patient access was revoked, but Authentication cleanup failed.');
    }
  }

  await doctorRef.set(
    {
      active: false,
      deleted: true,
      deletedAt: FieldValue.serverTimestamp(),
      deletedBy: admin.uid,
    },
    { merge: true },
  );

  return { removed: true, patientsUpdated: docs.length };
});

export const setPatientDoctors = onCall(async (request) => {
  const admin = await requireAdmin(request.auth?.uid);
  const patientId = requireString(request.data?.patientId, 'Patient ID', 128);
  const rawDoctorIds = request.data?.doctorIds;

  if (!Array.isArray(rawDoctorIds) || rawDoctorIds.length > 50) {
    throw new HttpsError('invalid-argument', 'Doctor assignment list is invalid.');
  }

  const doctorIds = [...new Set(
    rawDoctorIds
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  )];

  if (doctorIds.length !== rawDoctorIds.length) {
    throw new HttpsError('invalid-argument', 'Doctor assignments contain invalid or duplicate entries.');
  }

  const patientRef = db.doc(`patients/${patientId}`);
  const patientSnapshot = await patientRef.get();
  if (!patientSnapshot.exists) {
    throw new HttpsError('not-found', 'Patient not found.');
  }

  if (doctorIds.length) {
    const doctorSnapshots = await db.getAll(
      ...doctorIds.map((doctorId) => db.doc(`users/${doctorId}`)),
    );

    for (const doctorSnapshot of doctorSnapshots) {
      const doctor = doctorSnapshot.data();
      if (
        !doctorSnapshot.exists
        || doctor?.active !== true
        || !['doctor', 'practitioner'].includes(doctor?.role)
      ) {
        throw new HttpsError('failed-precondition', 'Every assigned doctor must be an active doctor.');
      }
    }
  }

  await patientRef.update({
    doctorIds,
    updatedAt: FieldValue.serverTimestamp(),
    accessUpdatedAt: FieldValue.serverTimestamp(),
    accessUpdatedBy: admin.uid,
  });

  return { updated: true };
});
