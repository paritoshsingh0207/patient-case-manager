import {
  collection,
  onSnapshot,
  query,
  type DocumentData,
  type Firestore,
  type QueryDocumentSnapshot,
  where,
} from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';
import type { DoctorProfile } from '../types';

interface CreateDoctorInput {
  displayName: string;
  email: string;
}

interface CreateDoctorResult {
  uid: string;
  setupLink: string;
}

interface SetPatientDoctorsInput {
  patientId: string;
  doctorIds: string[];
}

function doctorFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): DoctorProfile {
  const data = snapshot.data();
  return {
    uid: snapshot.id,
    active: data.active === true,
    role: 'doctor',
    displayName: typeof data.displayName === 'string' ? data.displayName : 'Unnamed doctor',
    email: typeof data.email === 'string' ? data.email : '',
    deleted: data.deleted === true,
  };
}

export function subscribeDoctors(
  db: Firestore,
  onChange: (doctors: DoctorProfile[]) => void,
  onError: (error: Error) => void,
) {
  const doctorsQuery = query(
    collection(db, 'users'),
    where('role', 'in', ['doctor', 'practitioner']),
  );

  return onSnapshot(
    doctorsQuery,
    (snapshot) => {
      const doctors = snapshot.docs
        .map(doctorFromDoc)
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      onChange(doctors);
    },
    onError,
  );
}

export async function createDoctorAccount(
  functions: Functions,
  input: CreateDoctorInput,
) {
  const callable = httpsCallable<CreateDoctorInput, CreateDoctorResult>(functions, 'createDoctor');
  const result = await callable({
    displayName: input.displayName.trim(),
    email: input.email.trim().toLowerCase(),
  });
  return result.data;
}

export async function removeDoctorAccount(functions: Functions, uid: string) {
  const callable = httpsCallable<{ uid: string }, { removed: boolean; patientsUpdated: number }>(
    functions,
    'removeDoctor',
  );
  const result = await callable({ uid });
  return result.data;
}

export async function setPatientDoctors(
  functions: Functions,
  input: SetPatientDoctorsInput,
) {
  const callable = httpsCallable<SetPatientDoctorsInput, { updated: boolean }>(
    functions,
    'setPatientDoctors',
  );
  const result = await callable(input);
  return result.data;
}
