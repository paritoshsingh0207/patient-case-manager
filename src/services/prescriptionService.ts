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
export function prescriptionFromData(data:Record<string,unknown>,patientId:string,id:string):PrescriptionRecord {
  // Read both current coded records and older, single-medicine prescription documents.
  const rawItems=Array.isArray(data.items)?data.items:[];
  const items:PrescriptionItem[]=rawItems.flatMap((raw:unknown)=>{
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return [];
    const value=raw as Record<string,unknown>;
    const code=typeof value.code==='string'?value.code.trim():'';
    if(!code)return [];
    return [{
      code,
      potency:typeof value.potency==='string'?value.potency:undefined,
      dosageForm:typeof value.dosageForm==='string'?value.dosageForm:undefined,
      directions:typeof value.directions==='string'?value.directions:'',
      quantity:typeof value.quantity==='string'?value.quantity:undefined,
    }];
  });
  if(!items.length && typeof data.medicineCode==='string' && data.medicineCode.trim()){
    items.push({
      code:data.medicineCode.trim(),
      potency:typeof data.potency==='string'?data.potency:undefined,
      dosageForm:typeof data.dosageForm==='string'?data.dosageForm:undefined,
      directions:typeof data.directions==='string'?data.directions:'',
      quantity:typeof data.quantity==='string'?data.quantity:undefined,
    });
  }
  const issuedDate=toDate(data.issuedAt)??toDate(data.createdAt);
  const issuedAt=typeof data.issuedAt==='string'
    ? data.issuedAt
    : issuedDate?.toISOString().slice(0,10)??'Date not recorded';
  return {
    id,patientId,
    createdBy:typeof data.createdBy==='string'?data.createdBy:'',
    issuedByName:typeof data.issuedByName==='string'?data.issuedByName:'Doctor',
    issuedAt,items,
    patientInstructions:typeof data.patientInstructions==='string'?data.patientInstructions:undefined,
    clinicalReviewConfirmed:data.clinicalReviewConfirmed===true,
    voidedAt:toDate(data.voidedAt),
    voidedBy:typeof data.voidedBy==='string'?data.voidedBy:undefined,
    voidReason:typeof data.voidReason==='string'?data.voidReason:undefined,
    createdAt:toDate(data.createdAt),
  };
}
function fromDoc(snapshot:QueryDocumentSnapshot<DocumentData>,patientId:string):PrescriptionRecord {
  return prescriptionFromData(snapshot.data(),patientId,snapshot.id);
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
