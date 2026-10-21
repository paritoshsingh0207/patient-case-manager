import {
  addDoc, collection, doc, onSnapshot, serverTimestamp, updateDoc,
  type DocumentData, type Firestore, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { PrescriptionItem, PrescriptionRecord } from '../types';
import { normalizeMedicineCode } from './medicineService';

function toDate(value:unknown):Date|undefined {
  if(value && typeof value==='object' && 'toDate' in value
     && typeof (value as {toDate:()=>Date}).toDate==='function')
    return (value as {toDate:()=>Date}).toDate();
  return undefined;
}
function fromDoc(snapshot:QueryDocumentSnapshot<DocumentData>,patientId:string):PrescriptionRecord {
  const data=snapshot.data();
  const items=Array.isArray(data.items)?data.items.filter((x:unknown)=>x&&typeof x==='object')
    .map((x:Record<string,unknown>)=>({
      code:typeof x.code==='string'?x.code:'',
      potency:typeof x.potency==='string'?x.potency:undefined,
      dosageForm:typeof x.dosageForm==='string'?x.dosageForm:undefined,
      directions:typeof x.directions==='string'?x.directions:'',
      quantity:typeof x.quantity==='string'?x.quantity:undefined,
    })).filter((x:PrescriptionItem)=>x.code):[];
  return {
    id:snapshot.id,patientId,createdBy:data.createdBy??'',issuedByName:data.issuedByName??'Doctor',
    issuedAt:data.issuedAt??'',items,patientInstructions:data.patientInstructions,
    clinicalReviewConfirmed:data.clinicalReviewConfirmed===true,
    voidedAt:toDate(data.voidedAt),voidedBy:data.voidedBy,voidReason:data.voidReason,
    createdAt:toDate(data.createdAt),
  };
}
export function subscribePrescriptions(db:Firestore,patientId:string,onChange:(records:PrescriptionRecord[])=>void,onError:(error:Error)=>void) {
  return onSnapshot(collection(db,'patients',patientId,'prescriptions'),snapshot=>{
    onChange(snapshot.docs.map(x=>fromDoc(x,patientId))
      .sort((a,b)=>b.issuedAt.localeCompare(a.issuedAt)||(b.createdAt?.getTime()??0)-(a.createdAt?.getTime()??0)));
  },onError);
}
export async function createPrescription(db:Firestore,input:{
  patientId:string;userId:string;issuedByName:string;issuedAt:string;items:PrescriptionItem[];
  patientInstructions?:string;clinicalReviewConfirmed:boolean;
}) {
  if(!input.clinicalReviewConfirmed)throw Error('Clinical review confirmation is required.');
  // Exactly one medicine per document. Firestore rules can check this medicine
  // against its approved registry entry without trusted Cloud Functions.
  if(input.items.length!==1)throw Error('Save each medicine as its own prescription.');
  const item=input.items[0];
  const code=normalizeMedicineCode(item.code);
  const fields={
    code,potency:item.potency?.trim()??'',dosageForm:item.dosageForm?.trim()??'',
    directions:item.directions.trim(),quantity:item.quantity?.trim()??'',
  };
  if(!/^[A-Z]{2}[1-9]\d*$/.test(code)||!fields.potency||!fields.dosageForm||!fields.directions)
    throw Error('Valid approved code, potency, dosage form and directions required.');
  return addDoc(collection(db,'patients',input.patientId,'prescriptions'),{
    patientId:input.patientId,createdBy:input.userId,
    issuedByName:input.issuedByName.trim(),issuedAt:input.issuedAt,
    medicineCode:code,items:[fields],patientInstructions:input.patientInstructions?.trim()??'',
    clinicalReviewConfirmed:true,createdAt:serverTimestamp(),
  });
}
export async function voidPrescription(db:Firestore,input:{
  patientId:string;prescriptionId:string;userId:string;reason:string;
}) {
  if(!input.reason.trim()||input.reason.trim().length>500)throw Error('A void reason is required (500 characters max).');
  return updateDoc(doc(db,'patients',input.patientId,'prescriptions',input.prescriptionId),{
    voidReason:input.reason.trim(),
    voidedBy:input.userId,voidedAt:serverTimestamp(),
  });
}
