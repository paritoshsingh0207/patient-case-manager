import {
  collection, doc, onSnapshot, query, updateDoc,
  type DocumentData, type Firestore, type QueryDocumentSnapshot, where,
} from 'firebase/firestore';
import type { DoctorProfile } from '../types';

function doctorFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): DoctorProfile {
  const data=snapshot.data();
  return {
    uid:snapshot.id,active:data.active === true,role:'doctor',
    displayName:typeof data.displayName === 'string' ? data.displayName : 'Unnamed doctor',
    email:typeof data.email === 'string' ? data.email : '',
    deleted:data.deleted === true,
  };
}
export function subscribeDoctors(db:Firestore,onChange:(doctors:DoctorProfile[])=>void,onError:(error:Error)=>void) {
  return onSnapshot(query(collection(db,'users'),where('role','in',['doctor','practitioner'])),
    snapshot=>onChange(snapshot.docs.map(doctorFromDoc).sort((a,b)=>a.displayName.localeCompare(b.displayName))),onError);
}
export async function setPatientDoctors(db:Firestore,input:{patientId:string;doctorIds:string[]}) {
  const doctorIds=[...new Set(input.doctorIds)];
  if (doctorIds.length > 20 || doctorIds.some(id=>!id.trim())) throw Error('Select up to 20 valid doctors.');
  await updateDoc(doc(db,'patients',input.patientId),{doctorIds});
}
