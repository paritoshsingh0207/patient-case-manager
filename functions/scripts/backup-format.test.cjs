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

const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),spawn=require('node:child_process').spawnSync;
test('CLI verifies encrypted files and staging restore stays dry-run without credentials',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'pcm-recovery-test-'));
 try{
  const name=path.join(folder,'synthetic.pcmbackup');
  fs.writeFileSync(name,f.encrypt(sample(),pass));
  const run=(args)=>spawn(process.execPath,[path.join(__dirname,'clinic-backup.cjs'),...args],{
   cwd:path.join(__dirname,'..','..'),
   env:{...process.env,PCM_BACKUP_PASSPHRASE:pass},encoding:'utf8',timeout:12000,
  });
  let proc=run(['verify','--file='+name]);
  assert.equal(proc.status,0,proc.stderr);
  assert.match(proc.stdout,/ARCHIVE_VERIFIED/);
  proc=run(['restore','--file='+name,'--project=source-project-123','--apply','--confirm-staging=source-project-123']);
  assert.notEqual(proc.status,0);assert.match(proc.stderr,/different, isolated/i);
  proc=run(['restore','--file='+name,'--project=some-production']);
  assert.notEqual(proc.status,0);assert.match(proc.stderr,/staging project ID/i);
  proc=run(['restore','--file='+name,'--project=clinic-isolated-staging']);
  assert.equal(proc.status,0,proc.stderr);
  assert.match(proc.stdout,/DRY RUN ONLY/);
  assert.doesNotMatch(proc.stdout,/STAGING_RESTORE_CREATED/);
 }finally{fs.rmSync(folder,{recursive:true,force:true})}
});
