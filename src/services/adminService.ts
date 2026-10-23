import {
  collection, doc, onSnapshot, query, setDoc, updateDoc, serverTimestamp,
  type DocumentData, type Firestore, type QueryDocumentSnapshot, where,
} from 'firebase/firestore';
import type { DoctorProfile } from '../types';

function doctorFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): DoctorProfile {
  const data=snapshot.data();
  return {
    uid:snapshot.id,active:data.active===true,role:'doctor',
    displayName:typeof data.displayName==='string'?data.displayName:'Unnamed doctor',
    email:typeof data.email==='string'?data.email:'',
    deleted:data.deleted===true,
  };
}
export function subscribeDoctors(db:Firestore,onChange:(doctors:DoctorProfile[])=>void,onError:(error:Error)=>void) {
  return onSnapshot(query(collection(db,'users'),where('role','in',['doctor','practitioner'])),
    snapshot=>onChange(snapshot.docs.map(doctorFromDoc).sort((a,b)=>a.displayName.localeCompare(b.displayName))),onError);
}
/** Link a pre-existing Firebase Authentication UID; does not create an Auth account. */
export async function registerDoctorProfile(db:Firestore,input:{uid:string;displayName:string;email:string;adminUid:string}) {
  const uid=input.uid.trim(), displayName=input.displayName.trim(), email=input.email.trim().toLowerCase();
  if(!/^[A-Za-z0-9_-]{6,128}$/.test(uid))throw Error('Paste a valid Firebase Authentication UID.');
  if(displayName.length<2||displayName.length>120)throw Error('Doctor name must be 2–120 characters.');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>254)throw Error('Enter a valid email address.');
  if(uid===input.adminUid)throw Error('Create a separate Firebase Authentication account for each doctor.');
  await setDoc(doc(db,'users',uid),{
    role:'doctor',active:true,displayName,email,createdBy:input.adminUid,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),statusUpdatedBy:input.adminUid,
  });
}
/** Only the active flag may change from the browser; audited by Firestore rules. */
export async function setDoctorActive(db:Firestore,input:{uid:string;active:boolean;adminUid:string}) {
  if(!input.uid||input.uid===input.adminUid)throw Error('Cannot change this account.');
  await updateDoc(doc(db,'users',input.uid),{
    active:input.active,updatedAt:serverTimestamp(),statusUpdatedBy:input.adminUid,
  });
}
export async function setPatientDoctors(db:Firestore,input:{patientId:string;doctorIds:string[]}) {
  const doctorIds=[...new Set(input.doctorIds)];
  if(doctorIds.length>20||doctorIds.some(id=>!id.trim()))throw Error('Select up to 20 valid doctors.');
  await updateDoc(doc(db,'patients',input.patientId),{doctorIds});
}

export async function registerAdminProfile(db:Firestore,input:{uid:string;displayName:string;email:string;adminUid:string}) {
  const uid=input.uid.trim(),displayName=input.displayName.trim(),email=input.email.trim().toLowerCase();
  if(!/^[A-Za-z0-9_-]{6,128}$/.test(uid)||uid===input.adminUid)throw Error('Enter a separate verified Authentication UID.');
  if(displayName.length<2||displayName.length>120||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw Error('Enter a valid name and email.');
  await setDoc(doc(db,'users',uid),{role:'admin',active:true,displayName,email,
    createdBy:input.adminUid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
    statusUpdatedBy:input.adminUid});
}
