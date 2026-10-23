import {addDoc,collection,doc,onSnapshot,serverTimestamp,updateDoc,type Firestore,type DocumentData} from 'firebase/firestore';
export interface ClinicalFollowUp {
 id:string;patientId:string;createdBy:string;reason:string;dueDate:string;
 status:'open'|'completed';createdAt?:Date;completedAt?:Date;completedBy?:string;
}
function parseDate(value:unknown):Date|undefined {
 return value&&typeof value==='object'&&'toDate' in value
   &&typeof (value as {toDate:()=>Date}).toDate==='function'
   ?(value as {toDate:()=>Date}).toDate():undefined;
}
export function followUpFromData(data:DocumentData,id:string,patientId:string):ClinicalFollowUp {
 return {id,patientId,createdBy:typeof data.createdBy==='string'?data.createdBy:'',
  reason:typeof data.reason==='string'?data.reason:'',
  dueDate:typeof data.dueDate==='string'?data.dueDate:'',
  status:data.status==='completed'?'completed':'open',
  createdAt:parseDate(data.createdAt),completedAt:parseDate(data.completedAt),
  completedBy:typeof data.completedBy==='string'?data.completedBy:undefined};
}
export function subscribeFollowUps(db:Firestore,patientId:string,
 onChange:(records:ClinicalFollowUp[])=>void,onError:(error:Error)=>void) {
 return onSnapshot(collection(db,'patients',patientId,'followUps'),snap=>{
  const records=snap.docs.map(x=>followUpFromData(x.data(),x.id,patientId))
    .sort((a,b)=>a.dueDate.localeCompare(b.dueDate));
  onChange(records);
 },onError);
}
export async function createFollowUp(db:Firestore,input:{patientId:string;userId:string;dueDate:string;reason:string}) {
 const reason=input.reason.trim(),date=input.dueDate;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00')))
   throw Error('Select a valid due date.');
 if(reason.length<3||reason.length>500)throw Error('Enter a follow-up reason of 3–500 characters.');
 return addDoc(collection(db,'patients',input.patientId,'followUps'),{
  patientId:input.patientId,createdBy:input.userId,reason,dueDate:date,
  status:'open',createdAt:serverTimestamp(),
 });
}
export async function completeFollowUp(db:Firestore,input:{patientId:string;followUpId:string;userId:string}) {
 return updateDoc(doc(db,'patients',input.patientId,'followUps',input.followUpId),{
  status:'completed',completedAt:serverTimestamp(),completedBy:input.userId,
 });
}
