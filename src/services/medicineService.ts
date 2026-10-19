import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { MedicineCode } from '../types';

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

function medicineFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): MedicineCode {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    code: data.code ?? snapshot.id,
    remedyName: data.remedyName ?? '',
    notes: data.notes,
    active: data.active !== false,
    createdBy: data.createdBy,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

export function normalizeMedicineCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export function subscribeMedicineCodes(
  db: Firestore,
  onChange: (codes: MedicineCode[]) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    collection(db, 'medicineCodes'),
    (snapshot) => {
      const codes = snapshot.docs
        .map(medicineFromDoc)
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      onChange(codes);
    },
    onError,
  );
}

export async function saveMedicineCode(
  db: Firestore,
  userId: string,
  input: { code: string; remedyName: string; notes?: string },
) {
  const code = normalizeMedicineCode(input.code);
  if (!code) throw new Error('Medicine code is required.');
  if (!input.remedyName.trim()) throw new Error('Medicine name is required.');

  const ref = doc(db, 'medicineCodes', code);
  await setDoc(
    ref,
    {
      code,
      remedyName: input.remedyName.trim(),
      notes: input.notes?.trim() ?? '',
      active: true,
      createdBy: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function removeMedicineCode(db: Firestore, code: string) {
  await deleteDoc(doc(db, 'medicineCodes', normalizeMedicineCode(code)));
}
