'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),f=require('./backup-format.cjs');
const pass='sample-long-passphrase-for-automated-tests';
function sample(){return {schema:1,sourceProject:'source-project-123',exportedAt:'2026-10-23T10:00:00Z',documents:[
 {path:'users/u1',fields:{role:{stringValue:'doctor'}}},
 {path:'patients/p1',fields:{firstName:{stringValue:'Synthetic'}}},
 {path:'patients/p1/prescriptions/rx1',fields:{medicineCode:{stringValue:'AB1'},duration:{integerValue:'7'},at:{timestampValue:'2026-10-23T00:00:00Z'}}},
 {path:'medicineCodes/AB1',fields:{remedyName:{stringValue:'Sample remedy'}}},
 {path:'auditEvents/e1',fields:{action:{stringValue:'care_team_changed'}}}]}}
test('round-trip, nested clinical collections and typed fields',()=>{
 const encrypted=f.encrypt(sample(),pass);
 assert.doesNotMatch(encrypted.toString(),/Synthetic|source-project-123|medicineCode/);
 const output=f.decrypt(encrypted,pass);
 assert.equal(f.digest(output),f.digest(sample()));
 assert.deepEqual(f.counts(output),{users:1,patients:2,medicineCodes:1,auditEvents:1});
 assert.equal(output.documents.find(d=>d.path.includes('/prescriptions/')).fields.duration.integerValue,'7');
});
test('wrong password and tampered ciphertext are rejected',()=>{
 const box=JSON.parse(f.encrypt(sample(),pass).toString());
 assert.throws(()=>f.decrypt(JSON.stringify(box),'wrong'),/authentication failed/i);
 const buf=Buffer.from(box.payload,'base64');buf[0]^=1;box.payload=buf.toString('base64');
 assert.throws(()=>f.decrypt(JSON.stringify(box),pass),/authentication failed/i);
});
test('unrelated Awakening collections, duplicate paths and weak passwords rejected',()=>{
 const a=sample();a.documents.push({path:'awakeningBookings/b1',fields:{name:{stringValue:'X'}}});
 assert.throws(()=>f.encrypt(a,pass),/unknown-scope/i);
 const b=sample();b.documents.push({...b.documents[0]});
 assert.throws(()=>f.encrypt(b,pass),/Duplicate/i);
 assert.throws(()=>f.encrypt(sample(),'short'),/16 characters/i);
});
