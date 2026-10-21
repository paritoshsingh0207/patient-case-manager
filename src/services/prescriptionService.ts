import { collection, onSnapshot, type DocumentData, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { httpsCallable, type Functions } from 'firebase/functions';
import type { PrescriptionItem, PrescriptionRecord } from '../types';
import { normalizeMedicineCode } from './medicineService';

function toDate(value: unknown): Date | undefined {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as {toDate:()=>Date}).toDate === 'function') {
    return (value as {toDate:()=>Date}).toDate();
  }
  return undefined;
}
function prescriptionFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>, patientId: string): PrescriptionRecord {
  const data=snapshot.data();
  const items=Array.isArray(data.items)?data.items
    .filter((item:unknown)=>item&&typeof item==='object')
    .map((item:Record<string,unknown>)=>({
      code:typeof item.code==='string'?item.code:'',
      directions:typeof item.directions==='string'?item.directions:'',
      quantity:typeof item.quantity==='string'?item.quantity:undefined,
    })).filter((item:PrescriptionItem)=>item.code):[];
  return {id:snapshot.id,patientId,createdBy:data.createdBy??'',issuedByName:data.issuedByName??'Doctor',
    issuedAt:data.issuedAt??'',items,patientInstructions:data.patientInstructions,createdAt:toDate(data.createdAt),
    clinicalReviewConfirmed:data.clinicalReviewConfirmed===true,
    voidedAt:toDate(data.voidedAt),voidedBy:data.voidedBy,voidReason:data.voidReason};
}
export function subscribePrescriptions(db:Firestore,patientId:string,onChange:(records:PrescriptionRecord[])=>void,onError:(error:Error)=>void){
  return onSnapshot(collection(db,'patients',patientId,'prescriptions'),snapshot=>{
    const prescriptions=snapshot.docs.map(item=>prescriptionFromDoc(item,patientId))
      .sort((a,b)=>b.issuedAt.localeCompare(a.issuedAt)||(b.createdAt?.getTime()??0)-(a.createdAt?.getTime()??0));
    onChange(prescriptions);
  },onError);
}
export async function createPrescription(functions:Functions,input:{patientId:string;issuedAt:string;items:PrescriptionItem[];patientInstructions?:string;clinicalReviewConfirmed:boolean}){
  const items=input.items.map(item=>({code:normalizeMedicineCode(item.code),directions:item.directions.trim(),quantity:item.quantity?.trim()??''}));
  if(!items.length||items.some(item=>!item.code||!item.directions))throw Error('Each medicine needs an approved code and directions.');
  const callable=httpsCallable<typeof input,{id:string}>(functions,'createCodedPrescription');
  return (await callable({...input,items})).data;
}

export async function voidPrescription(functions:Functions,input:{patientId:string;prescriptionId:string;reason:string}){
  const callable=httpsCallable<typeof input,{voided:boolean}>(functions,'voidCodedPrescription');
  return (await callable(input)).data;
}
