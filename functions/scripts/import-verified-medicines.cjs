#!/usr/bin/env node
// Spark-plan release installer. Runs ONLY on a trusted administrator's computer.
// Does not deploy to Cloud Functions. Default mode reads and validates; no writes.
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore,FieldValue} = require('firebase-admin/firestore');

const args=process.argv.slice(2);
const value=(name)=>{const item=args.find(x=>x.startsWith('--'+name+'='));return item?.slice(name.length+3)??null;};
const flag=(name)=>args.includes('--'+name);
function fail(msg){throw Error(msg);}
const project=value('project');
const source=value('file');
const apply=flag('apply');
if(!project||!source) {
  console.error('Usage: node functions/scripts/import-verified-medicines.cjs --project=PROJECT_ID --file=/path/verified.json [--apply --confirm-project=PROJECT_ID --backup-confirmed]');
  process.exit(2);
}
if(!/^[a-z][a-z0-9-]{4,29}$/.test(project))fail('Invalid project ID.');
if(apply&&(!flag('backup-confirmed')||value('confirm-project')!==project))
  fail('Apply requires a backup and --confirm-project matching --project.');
const raw=JSON.parse(fs.readFileSync(source,'utf8'));
if(raw.schemaVersion!=='1'||raw.releaseVersion!=='1.0-expert-verified'||!Array.isArray(raw.documents)||raw.documents.length!==881)
  fail('Expected 881 verified medicines from release 1.0.');
const docs=raw.documents.map(row=>{
  if(!row||typeof row!=='object'||row.expertVerified!==true||row.reviewStatus!=='Verified')
    fail('Unverified or malformed medicine row.');
  const code=row.code, remedyName=row.remedyName,legacyCode=row.legacyCode??'';
  if(typeof code!=='string'||typeof remedyName!=='string'||typeof legacyCode!=='string'
     || !/^[A-Z]{2}[1-9]\d*$/.test(code)||code.slice(0,2)!==remedyName.toUpperCase().replace(/[^A-Z]/g,'').slice(0,2))
    fail('Invalid code or medicine identity.');
  return {code,remedyName,legacyCode,
    traditionalAbbreviation:typeof row.traditionalAbbreviation==='string'?row.traditionalAbbreviation:'',
    synonymsOrAliases:typeof row.synonymsOrAliases==='string'?row.synonymsOrAliases:'',
    sourceCoverage:typeof row.sourceCoverage==='string'?row.sourceCoverage:'',
    expertVerified:true,reviewStatus:'Verified'};
});
const sorted=[...docs].sort((a,b)=>a.code.localeCompare(b.code));
const fingerprint=crypto.createHash('sha256').update(sorted.map(x=>x.code+'\t'+x.remedyName+'\t'+x.legacyCode+'\n').join(''),'utf8').digest('hex');
const APPROVED_V1='117f6e5f51811a59e15311866b62f52e41f16ee96d65cf0d591dd6d0615a92e6';
if(fingerprint!==APPROVED_V1)fail('Medicine identities do not match the expert-approved v1 fingerprint.');
if(new Set(docs.map(x=>x.code)).size!==881 ||
   new Set(docs.map(x=>x.remedyName.toLowerCase())).size!==881 ||
   new Set(docs.filter(x=>x.legacyCode).map(x=>x.legacyCode)).size!==688)
  fail('Duplicate or missing medicine/legacy code.');

initializeApp({projectId:project});
const db=getFirestore();
(async()=>{
  const existing=new Map();
  for(let i=0;i<docs.length;i+=200){
    const batch=docs.slice(i,i+200);
    const results=await db.getAll(...batch.map(x=>db.doc('medicineCodes/'+x.code)));
    for(const x of results)if(x.exists)existing.set(x.id,x.data());
  }
  let toCreate=0,matching=0;
  for(const entry of docs){
    const previous=existing.get(entry.code);
    if(!previous){toCreate++;continue;}
    if(typeof previous.remedyName!=='string'||
       previous.remedyName.trim().toLowerCase()!==entry.remedyName.toLowerCase()||
       (previous.legacyCode&&previous.legacyCode!==entry.legacyCode))
      fail('Conflicting pre-existing medicine identity for code '+entry.code+'. No changes made.');
    if(previous.active!==true||previous.approvedForNewRx!==true)
      fail('Code '+entry.code+' is archived/inactive. Re-import will not reactivate it.');
    matching++;
  }
  console.log(JSON.stringify({project,mode:apply?'APPLY':'DRY_RUN',
    verified:docs.length,legacyMappings:688,toCreate,alreadyApproved:matching,
    releaseVersion:'1.0-expert-verified',fingerprint},null,2));
  if(!apply){console.log('DRY RUN complete. No Firestore writes.');return;}
  let count=0;
  for(let i=0;i<docs.length;i+=200){
    const part=docs.slice(i,i+200);
    await db.runTransaction(async tx=>{
      const refs=part.map(x=>db.doc('medicineCodes/'+x.code));
      const current=await tx.getAll(...refs);
      for(let j=0;j<part.length;j++){
        const item=part[j],snap=current[j];
        if(snap.exists){
          const v=snap.data();
          if(typeof v.remedyName!=='string'||v.remedyName.trim().toLowerCase()!==item.remedyName.toLowerCase()
             || (v.legacyCode&&v.legacyCode!==item.legacyCode)||v.active!==true||v.approvedForNewRx!==true)
            fail('Concurrent edit/archival at '+item.code+'. Batch canceled.');
          // Fill metadata on matching mappings without changing code/name identities.
          tx.update(refs[j],{
            legacyCode:item.legacyCode,traditionalAbbreviation:item.traditionalAbbreviation,
            synonymsOrAliases:item.synonymsOrAliases,sourceCoverage:item.sourceCoverage,
            expertVerified:true,reviewStatus:'Verified',updatedAt:FieldValue.serverTimestamp(),
          });
        }else{
          tx.create(refs[j],{
            ...item,active:true,approvedForNewRx:true,
            releaseVersion:'1.0-expert-verified',verificationAttestedOn:'2026-10-21',
            createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),
            createdBy:'local-admin-import',
          });
        }
      }
    });
    count+=part.length;console.log('Processed '+count+'/'+docs.length+' verified mappings.');
  }
  console.log('Import complete. Verify all 881 records appear in the authenticated medicine registry.');
})().catch(error=>{console.error('Import stopped:',error.message);process.exitCode=1;});
