import { describe,it,expect } from 'vitest';
import { parseVerifiedMedicineJson } from './verifiedMedicineImport';
function example() {
  const documents = Array.from({length:881},(_,i)=>({
    code:'AB'+(i+1),remedyName:'Abies Sample'+(i+1),
    expertVerified:true,reviewStatus:'Verified',
  }));
  return {schemaVersion:'1',releaseVersion:'1.0-expert-verified',documents};
}
describe('expert verified registry JSON preflight',()=>{
  it('accepts 881 unique alphabetically prefixed records',()=>{
    const result=parseVerifiedMedicineJson(JSON.stringify(example()));
    expect(result.documents).toHaveLength(881);
  });
  it('rejects a duplicated or reassigned code',()=>{
    const data=example();data.documents[1].code=data.documents[0].code;
    expect(()=>parseVerifiedMedicineJson(JSON.stringify(data))).toThrow();
  });
  it('rejects an unverified medicine',()=>{
    const data=example();data.documents[0].expertVerified=false;
    expect(()=>parseVerifiedMedicineJson(JSON.stringify(data))).toThrow();
  });
  it('rejects incomplete releases',()=>{
    const data=example();data.documents.pop();
    expect(()=>parseVerifiedMedicineJson(JSON.stringify(data))).toThrow();
  });
});
