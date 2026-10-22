import {
  collection, doc, onSnapshot, query, setDoc, updateDoc, serverTimestamp,
  type DocumentData, type Firestore, type QueryDocumentSnapshot, where,
} from 'firebase/firestore';
import type { DoctorProfile, PractitionerAccess } from '../types';

function doctorFromDoc(snapshot:QueryDocumentSnapshot<DocumentData>):DoctorProfile {
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

export function subscribeAdmins(db:Firestore,onChange:(admins:PractitionerAccess[])=>void,onError:(error:Error)=>void) {
  return onSnapshot(query(collection(db,'users'),where('role','==','admin')),
    snapshot=>onChange(snapshot.docs.map(d=>({
      uid:d.id,role:'admin' as const,active:d.data().active===true,
      displayName:typeof d.data().displayName==='string'?d.data().displayName:'Administrator',
      email:typeof d.data().email==='string'?d.data().email:'',
    }))),onError);
}

export async function setDoctorActive(db:Firestore,input:{uid:string;active:boolean;adminUid:string}) {
  if(!input.uid||input.uid===input.adminUid)throw Error('You cannot change this account.');
  await updateDoc(doc(db,'users',input.uid),{
    active:input.active,updatedAt:serverTimestamp(),statusUpdatedBy:input.adminUid,
  });
}

/** Admin links a *new* Firebase Auth identity as an administrator. */
export async function addAdministratorProfile(db:Firestore,input:{uid:string;displayName:string;email:string;adminUid:string}) {
  if(input.uid===input.adminUid)throw Error('Use a different account for the new administrator.');
  const name=input.displayName.trim(),email=input.email.trim().toLowerCase();
  if(name.length<2||name.length>120)throw Error('Administrator name must be 2–120 characters.');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw Error('Invalid email address.');
  await setDoc(doc(db,'users',input.uid),{
    role:'admin',active:true,displayName:name,email,
    emailVerificationRequired:true,
    createdBy:input.adminUid,statusUpdatedBy:input.adminUid,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
  });
}

export async function setPatientDoctors(db:Firestore,input:{patientId:string;doctorIds:string[]}) {
  const doctorIds=[...new Set(input.doctorIds)];
  if(doctorIds.length>20||doctorIds.some(id=>!id.trim()))throw Error('Select up to 20 valid doctors.');
  await updateDoc(doc(db,'patients',input.patientId),{doctorIds});
}
