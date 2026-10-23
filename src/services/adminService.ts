import {
  arrayRemove, collection, doc, onSnapshot, query, serverTimestamp, writeBatch, orderBy, limit,
  type DocumentData, type Firestore, type QueryDocumentSnapshot, where,
} from 'firebase/firestore';
import type { DoctorProfile } from '../types';

export interface ClinicAuditEvent {
  id:string;actorUid:string;action:string;targetType:string;targetId:string;recordedAt?:Date;
}
export function subscribeClinicAudit(db:Firestore,onChange:(events:ClinicAuditEvent[])=>void,onError:(error:Error)=>void){
  return onSnapshot(query(collection(db,'auditEvents'),orderBy('recordedAt','desc'),limit(30)),
    snap=>onChange(snap.docs.map(item=>{
      const v=item.data();
      return {id:item.id,actorUid:String(v.actorUid??''),action:String(v.action??''),
        targetType:String(v.targetType??''),targetId:String(v.targetId??''),
        recordedAt:typeof v.recordedAt?.toDate==='function'?v.recordedAt.toDate():undefined};
    })),onError);
}
function addAudit(batch:ReturnType<typeof writeBatch>,db:Firestore,actorUid:string,action:string,targetType:string,targetId:string){
  batch.set(doc(collection(db,'auditEvents')),{actorUid,action,targetType,targetId,recordedAt:serverTimestamp()});
}
function doctorFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): DoctorProfile {
  const data=snapshot.data();
  return {
    uid:snapshot.id,active:data.active===true,role:'doctor',
    displayName:typeof data.displayName==='string'?data.displayName:'Unnamed doctor',
    email:typeof data.email==='string'?data.email:'',
    deleted:data.deleted===true,
    pending:data.active!==true && !data.statusUpdatedBy,
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
  const batch=writeBatch(db);
  batch.set(doc(db,'users',uid),{
    role:'doctor',active:true,displayName,email,createdBy:input.adminUid,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),statusUpdatedBy:input.adminUid,
  });
  addAudit(batch,db,input.adminUid,'doctor_registered','doctor',uid);
  await batch.commit();
}
/** Only the active flag may change from the browser; audited by Firestore rules. */
export async function setDoctorActive(db:Firestore,input:{uid:string;active:boolean;adminUid:string}) {
  if(!input.uid||input.uid===input.adminUid)throw Error('Cannot change this account.');
  const batch=writeBatch(db);
  batch.update(doc(db,'users',input.uid),{active:input.active,updatedAt:serverTimestamp(),statusUpdatedBy:input.adminUid});
  addAudit(batch,db,input.adminUid,input.active?'doctor_activated':'doctor_deactivated','doctor',input.uid);
  await batch.commit();
}
export async function setPatientDoctors(db:Firestore,input:{patientId:string;doctorIds:string[];adminUid:string}) {
  const doctorIds=[...new Set(input.doctorIds)];
  if(doctorIds.length>20||doctorIds.some(id=>!id.trim()))throw Error('Select up to 20 valid doctors.');
  const batch=writeBatch(db);
  batch.update(doc(db,'patients',input.patientId),{doctorIds});
  addAudit(batch,db,input.adminUid,'care_team_changed','patient',input.patientId);
  await batch.commit();
}

export async function registerAdminProfile(db:Firestore,input:{uid:string;displayName:string;email:string;adminUid:string}) {
  const uid=input.uid.trim(),displayName=input.displayName.trim(),email=input.email.trim().toLowerCase();
  if(!/^[A-Za-z0-9_-]{6,128}$/.test(uid)||uid===input.adminUid)throw Error('Enter a separate verified Authentication UID.');
  if(displayName.length<2||displayName.length>120||!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw Error('Enter a valid name and email.');
  const batch=writeBatch(db);
  batch.set(doc(db,'users',uid),{role:'admin',active:true,displayName,email,
    createdBy:input.adminUid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
    statusUpdatedBy:input.adminUid});
  addAudit(batch,db,input.adminUid,'administrator_invited','administrator',uid);
  await batch.commit();
}

/** Revoke exactly one doctor's access without overwriting concurrent assignments.
 * All patient / case / prescription reads are protected by Firestore rules.
 */
export async function removePatientDoctorAccess(db:Firestore,input:{patientId:string;doctorUid:string;adminUid:string}) {
  if(!input.patientId.trim()||!input.doctorUid.trim())throw Error('Choose a valid patient and doctor.');
  const batch=writeBatch(db);
  batch.update(doc(db,'patients',input.patientId),{doctorIds:arrayRemove(input.doctorUid),updatedAt:serverTimestamp()});
  addAudit(batch,db,input.adminUid,'doctor_patient_access_revoked','patient',input.patientId);
  await batch.commit();
}
