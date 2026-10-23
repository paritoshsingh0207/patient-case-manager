import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
  runTransaction,
  where,
} from 'firebase/firestore';
import type {
  AppRole,
  CaseInput,
  CaseRecord,
  Patient,
  PatientInput,
  SuggestionResult,
} from '../types';
import { assertPatientFieldsUnchanged, changedPatientFields } from '../lib/patientEdits';

function toDate(value: unknown): Date | undefined {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate: () => Date }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate();
  }

  return undefined;
}

function patientFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): Patient {
  const data = snapshot.data();
  const legacyOwner = typeof data.ownerId === 'string' ? data.ownerId : undefined;
  const doctorIds = Array.isArray(data.doctorIds)
    ? data.doctorIds.filter((value: unknown): value is string => typeof value === 'string')
    : legacyOwner
      ? [legacyOwner]
      : [];

  return {
    id: snapshot.id,
    createdBy: data.createdBy ?? legacyOwner ?? '',
    doctorIds,
    firstName: data.firstName,
    lastName: data.lastName,
    dateOfBirth: data.dateOfBirth,
    sex: data.sex,
    phone: data.phone,
    email: data.email,
    occupation: data.occupation,
    address: data.address,
    medicalHistory: data.medicalHistory,
    familyHistory: data.familyHistory,
    allergies: data.allergies,
    currentMedications: data.currentMedications,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

function caseFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>, patientId: string): CaseRecord {
  const data = snapshot.data();

  return {
    id: snapshot.id,
    createdBy: data.createdBy ?? data.ownerId ?? '',
    createdByName: data.createdByName,
    patientId,
    consultationDate: data.consultationDate,
    chiefComplaint: data.chiefComplaint,
    duration: data.duration,
    location: data.location,
    sensation: data.sensation,
    modalitiesBetter: data.modalitiesBetter,
    modalitiesWorse: data.modalitiesWorse,
    concomitants: data.concomitants,
    mentalGenerals: data.mentalGenerals,
    physicalGenerals: data.physicalGenerals,
    notes: data.notes,
    visitType: data.visitType === 'follow-up' ? 'follow-up' : 'initial',
    assessment: typeof data.assessment==='string'?data.assessment:undefined,
    carePlan: typeof data.carePlan==='string'?data.carePlan:undefined,
    followUpAdvice: typeof data.followUpAdvice==='string'?data.followUpAdvice:undefined,
    weightKg: typeof data.weightKg==='string'?data.weightKg:undefined,
    temperatureC: typeof data.temperatureC==='string'?data.temperatureC:undefined,
    pulseBpm: typeof data.pulseBpm==='string'?data.pulseBpm:undefined,
    systolicBp: typeof data.systolicBp==='string'?data.systolicBp:undefined,
    diastolicBp: typeof data.diastolicBp==='string'?data.diastolicBp:undefined,
    status: data.status ?? 'draft',
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function subscribePatients(
  db: Firestore,
  userId: string,
  role: AppRole,
  onChange: (patients: Patient[]) => void,
  onError: (error: Error) => void,
) {
  const patientsCollection = collection(db, 'patients');
  const patientsQuery =
    role === 'admin'
      ? patientsCollection
      : query(patientsCollection, where('doctorIds', 'array-contains', userId));

  return onSnapshot(
    patientsQuery,
    (snapshot) => {
      const patients = snapshot.docs.map(patientFromDoc).sort((a, b) => {
        const aTime = a.updatedAt?.getTime() ?? a.createdAt?.getTime() ?? 0;
        const bTime = b.updatedAt?.getTime() ?? b.createdAt?.getTime() ?? 0;
        return bTime - aTime;
      });
      onChange(patients);
    },
    onError,
  );
}

export async function createPatient(
  db: Firestore,
  userId: string,
  role: AppRole,
  input: PatientInput,
) {
  return addDoc(collection(db, 'patients'), {
    ...input,
    createdBy: userId,
    doctorIds: role === 'admin' ? [] : [userId],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Profile changes use a transaction so two clinicians cannot silently overwrite
 * the same field. Firestore rules still enforce active patient assignment.
 */
export async function updatePatient(
  db: Firestore,
  patientId: string,
  input: PatientInput,
  original: PatientInput,
) {
  const changed = changedPatientFields(original, input);
  if (!Object.keys(changed).length) return;

  const reference = doc(db, 'patients', patientId);
  await runTransaction(db, async transaction => {
    const current = await transaction.get(reference);
    if (!current.exists()) throw Error('This patient record is no longer available.');
    assertPatientFieldsUnchanged(current.data(), original, changed);
    transaction.update(reference, { ...changed, updatedAt: serverTimestamp() });
  });
}

export function subscribeCases(
  db: Firestore,
  patientId: string,
  onChange: (cases: CaseRecord[]) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    collection(db, 'patients', patientId, 'cases'),
    (snapshot) => {
      const cases = snapshot.docs
        .map((item) => caseFromDoc(item, patientId))
        .sort((a, b) => b.consultationDate.localeCompare(a.consultationDate));
      onChange(cases);
    },
    onError,
  );
}

export async function createCase(
  db: Firestore,
  patientId: string,
  userId: string,
  createdByName: string,
  input: CaseInput,
) {
  const caseRef = await addDoc(collection(db, 'patients', patientId, 'cases'), {
    ...input,
    createdBy: userId,
    createdByName,
    patientId,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, 'patients', patientId), { updatedAt: serverTimestamp() });
  return caseRef;
}

export async function saveSuggestion(
  db: Firestore,
  patientId: string,
  userId: string,
  caseInput: CaseInput,
  result: SuggestionResult,
) {
  return addDoc(collection(db, 'patients', patientId, 'suggestions'), {
    createdBy: userId,
    patientId,
    caseInput,
    blocked: result.blocked,
    redFlags: result.redFlags,
    suggestions: result.suggestions,
    engineVersion: '0.2.0',
    createdAt: serverTimestamp(),
  });
}
