import {
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { PrescriptionItem, PrescriptionRecord } from '../types';
import { normalizeMedicineCode } from './medicineService';

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

function prescriptionFromDoc(
  snapshot: QueryDocumentSnapshot<DocumentData>,
  patientId: string,
): PrescriptionRecord {
  const data = snapshot.data();
  const items = Array.isArray(data.items)
    ? data.items
        .filter((item: unknown) => item && typeof item === 'object')
        .map((item: Record<string, unknown>) => ({
          code: typeof item.code === 'string' ? item.code : '',
          directions: typeof item.directions === 'string' ? item.directions : '',
          quantity: typeof item.quantity === 'string' ? item.quantity : undefined,
        }))
        .filter((item: PrescriptionItem) => item.code)
    : [];

  return {
    id: snapshot.id,
    patientId,
    createdBy: data.createdBy ?? '',
    issuedByName: data.issuedByName ?? 'Practitioner',
    issuedAt: data.issuedAt ?? '',
    items,
    patientInstructions: data.patientInstructions,
    createdAt: toDate(data.createdAt),
  };
}

export function subscribePrescriptions(
  db: Firestore,
  patientId: string,
  onChange: (prescriptions: PrescriptionRecord[]) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    collection(db, 'patients', patientId, 'prescriptions'),
    (snapshot) => {
      const prescriptions = snapshot.docs
        .map((item) => prescriptionFromDoc(item, patientId))
        .sort((a, b) => {
          const dateSort = b.issuedAt.localeCompare(a.issuedAt);
          if (dateSort !== 0) return dateSort;
          return (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
        });
      onChange(prescriptions);
    },
    onError,
  );
}

export async function createPrescription(
  db: Firestore,
  input: {
    patientId: string;
    userId: string;
    issuedByName: string;
    issuedAt: string;
    items: PrescriptionItem[];
    patientInstructions?: string;
  },
) {
  const items = input.items
    .map((item) => ({
      code: normalizeMedicineCode(item.code),
      directions: item.directions.trim(),
      quantity: item.quantity?.trim() ?? '',
    }))
    .filter((item) => item.code);

  if (!items.length) {
    throw new Error('Add at least one coded medicine.');
  }

  return addDoc(collection(db, 'patients', input.patientId, 'prescriptions'), {
    patientId: input.patientId,
    createdBy: input.userId,
    issuedByName: input.issuedByName,
    issuedAt: input.issuedAt,
    items,
    patientInstructions: input.patientInstructions?.trim() ?? '',
    createdAt: serverTimestamp(),
  });
}
