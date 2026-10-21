import { collection, onSnapshot, type DocumentData, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import type { MedicineCode } from '../types';

function toDate(value: unknown): Date | undefined {
  if (value && typeof value === 'object' && 'toDate' in value
      && typeof (value as {toDate:()=>Date}).toDate === 'function') {
    return (value as {toDate:()=>Date}).toDate();
  }
  return undefined;
}
function medicineFromDoc(snapshot: QueryDocumentSnapshot<DocumentData>): MedicineCode {
  const data=snapshot.data();
  return {
    id:snapshot.id, code:data.code ?? snapshot.id,
    remedyName:data.remedyName ?? '', notes:data.notes,
    active:data.active === true, approvedForNewRx:data.approvedForNewRx === true,
    expertVerified:data.expertVerified === true,
    legacyCode:typeof data.legacyCode === 'string' ? data.legacyCode : undefined,
    traditionalAbbreviation:typeof data.traditionalAbbreviation === 'string' ? data.traditionalAbbreviation : undefined,
    synonymsOrAliases:typeof data.synonymsOrAliases === 'string' ? data.synonymsOrAliases : undefined,
    sourceCoverage:typeof data.sourceCoverage === 'string' ? data.sourceCoverage : undefined,
    releaseVersion:typeof data.releaseVersion === 'string' ? data.releaseVersion : undefined,
    createdBy:data.createdBy, createdAt:toDate(data.createdAt),updatedAt:toDate(data.updatedAt),
  };
}
export function normalizeMedicineCode(code: string) {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}
export function subscribeMedicineCodes(db: Firestore,onChange:(codes:MedicineCode[])=>void,onError:(error:Error)=>void) {
  return onSnapshot(collection(db,'medicineCodes'),snapshot=>{
    onChange(snapshot.docs.map(medicineFromDoc).sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})));
  },onError);
}
