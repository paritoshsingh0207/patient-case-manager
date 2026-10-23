#!/usr/bin/env node
'use strict';
/**
 * Patient Case Manager: encrypted, local-only Firestore backup + staging restore.
 *
 * READ-ONLY: node functions/scripts/clinic-backup.cjs export --project=PROJECT --confirm-project=PROJECT --out=PATH.pcmbackup
 * CHECK:     node functions/scripts/clinic-backup.cjs verify --file=PATH.pcmbackup
 * DRY RUN:   node functions/scripts/clinic-backup.cjs restore --file=PATH.pcmbackup --project=ISOLATED-STAGING-PROJECT
 * APPLY:     ... restore ... --apply --confirm-staging=ISOLATED-STAGING-PROJECT
 *
 * Existing Firebase CLI login is used; no service account, gcloud, or Cloud Functions.
 * This uses firebase-tools' internal auth helper; fail closed on incompatible versions.
 * Use an *isolated staging project* for restore; never restore over live clinic data.
 */
const fs=require('node:fs'),path=require('node:path');
const {ROOTS,MAX_DOCS,validProject,canonical,digest,encrypt,decrypt,counts}=require('./backup-format.cjs');
const args=process.argv.slice(2),mode=args[0];
const opt=n=>{const x=args.slice(1).find(y=>y.startsWith('--'+n+'='));return x?.slice(n.length+3)??null};
const flag=n=>args.slice(1).includes('--'+n);
const fail=s=>{throw Error(s)};
if(!['export','verify','restore'].includes(mode)){
 console.error('Usage: clinic-backup.cjs export|verify|restore [--project=PROJECT] [--out=FILE | --file=FILE]');
 process.exit(2);
}
const project=opt('project'),file=opt('file'),out=opt('out');
const API='https://firestore.googleapis.com/v1/projects/';
const MAX_BYTES=130*1024*1024;
function urlFor(project,relative){
 return API+encodeURIComponent(project)+'/databases/(default)/documents'+(relative?'/'+relative.split('/').map(encodeURIComponent).join('/'):'');
}
async function passphrase(){
 if(process.env.PCM_BACKUP_PASSPHRASE)return process.env.PCM_BACKUP_PASSPHRASE;
 if(!process.stdin.isTTY||!process.stdin.setRawMode)fail('Use an interactive terminal or securely supply PCM_BACKUP_PASSPHRASE.');
 return new Promise((resolve,reject)=>{
  let value='',finished=false;
  process.stdout.write('Backup passphrase (hidden, 16+ characters): ');
  const input=process.stdin;
  const done=(error)=>{
   if(finished)return;finished=true;input.off('data',onData);input.setRawMode(false);input.pause();
   process.stdout.write('\n');if(error)reject(error);else resolve(value);
  };
  const onData=(chunk)=>{
   for(const c of chunk.toString('utf8')){
    if(c==='\r'||c==='\n'){done();return}
    if(c==='\u0003'){done(Error('Canceled.'));return}
    if(c==='\u007f'||c==='\b'){value=value.slice(0,-1);continue}
    if(c>=' '&&!/[\u007f-\u009f]/.test(c))value+=c;
   }
  };
  input.setRawMode(true);input.resume();input.on('data',onData);
 });
}
function tokenProvider(){
 let auth;try{auth=require('firebase-tools/lib/auth')}catch{fail('Firebase CLI auth unavailable. Run npm install from the project directory.')}
 if(typeof auth.getProjectDefaultAccount!=='function'||typeof auth.getAccessToken!=='function')
  fail('Firebase CLI changed its auth helper; no project data accessed.');
 const account=auth.getProjectDefaultAccount(process.cwd());
 if(!account?.tokens?.refresh_token||!account.user?.email)
  fail('No active Firebase CLI login. Run firebase login from your normal workstation.');
 console.log('Firebase CLI identity: '+account.user.email);
 let cached='',expires=0;
 return async()=>{
  if(cached&&Date.now()<expires)return cached;
  const result=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
  if(!result?.access_token)fail('Could not refresh Firebase CLI login.');
  cached=result.access_token;expires=Date.now()+30*60*1000;return cached;
 };
}
async function api(url,token,method='GET',body){
 const headers={Authorization:'Bearer '+await token(),Accept:'application/json'};
 if(body!==undefined)headers['Content-Type']='application/json';
 const resp=await fetch(url,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const raw=await resp.text();let result;
 try{result=raw?JSON.parse(raw):{}}catch{result={error:{message:'Invalid API response'}}}
 if(!resp.ok) {
  if(resp.status===404&&method==='GET')return null;
  fail('Firestore request failed (HTTP '+resp.status+'): '+String(result.error?.message||'Unknown error').slice(0,400));
 }
 return result;
}
function collectionPathFromName(name,project){
 const prefix=urlFor(project,'')+'/';
 if(typeof name!=='string'||!name.startsWith('projects/'+project+'/databases/(default)/documents/'))
  fail('Unexpected Firestore document from another project.');
 return name.slice(('projects/'+project+'/databases/(default)/documents/').length);
}
async function listDocuments(project,col,token){
 const result=[];
 let page='';
 do{
  const url=new URL(urlFor(project,col));url.searchParams.set('pageSize','100');
  if(page)url.searchParams.set('pageToken',page);
  const response=await api(url.toString(),token);
  for(const doc of response?.documents||[]) {
   const docPath=collectionPathFromName(doc.name,project);
   if(docPath.split('/').slice(0,-1).join('/')!==col)fail('Unexpected document collection path.');
   result.push({path:docPath,fields:doc.fields||{}});
   if(result.length>MAX_DOCS)fail('Exceeded safe export document count.');
  }
  page=response?.nextPageToken||'';
 }while(page);
 return result;
}
async function listChildren(project,documentPath,token){
 let page='',ids=[];
 do{
  const body={pageSize:100};
  if(page)body.pageToken=page;
  const result=await api(urlFor(project,documentPath)+':listCollectionIds',token,'POST',body);
  ids.push(...(result.collectionIds||[]));
  page=result.nextPageToken||'';
 }while(page);
 return ids.sort();
}
async function exportDocs(project,token){
 // Collection allowlist avoids leaking unrelated Awakening website collections.
 const documents=[],seen=new Set();
 const add=(doc)=>{
  if(seen.has(doc.path))fail('Repeated document in Firestore query.');seen.add(doc.path);
  documents.push(doc);if(documents.length>MAX_DOCS)fail('Too many documents. No backup file written.');
 };
 for(const root of ROOTS){
  const rootDocs=await listDocuments(project,root,token);
  for(const doc of rootDocs)add(doc);
  console.log(root+': '+rootDocs.length+' root records');
  if(root==='patients'){
   // Enumerate all nesting levels, including cases, prescriptions, suggestions and followUps.
   const queue=rootDocs.map(d=>d.path);
   for(let i=0;i<queue.length;i++){
    const parent=queue[i];
    const children=await listChildren(project,parent,token);
    for(const collectionId of children){
     const col=parent+'/'+collectionId;
     const found=await listDocuments(project,col,token);
     for(const doc of found){add(doc);queue.push(doc.path)}
    }
   }
  }
 }
 return canonical({schema:1,sourceProject:project,exportedAt:new Date().toISOString(),documents});
}
function retargetFields(fields,source,target){
 // ReferenceValue values are project-qualified, so rewrite inside nested maps/arrays.
 const old='projects/'+source+'/databases/(default)/documents/';
 const dest='projects/'+target+'/databases/(default)/documents/';
 function convert(value){
  if(!value||typeof value!=='object')return value;
  if('referenceValue' in value){
   if(typeof value.referenceValue!=='string'||!value.referenceValue.startsWith(old))
    fail('Foreign or unsupported Firestore document reference in backup.');
   return {...value,referenceValue:dest+value.referenceValue.slice(old.length)};
  }
  if(value.mapValue?.fields){
   return {...value,mapValue:{...value.mapValue,fields:Object.fromEntries(
    Object.entries(value.mapValue.fields).map(([k,v])=>[k,convert(v)]) )}};
  }
  if(value.arrayValue?.values){
   return {...value,arrayValue:{...value.arrayValue,values:value.arrayValue.values.map(convert)}};
  }
  return value;
 }
 return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,convert(v)]));
}
async function isEmpty(project,token){
 for(const root of ROOTS){
  const url=new URL(urlFor(project,root));url.searchParams.set('pageSize','1');
  const result=await api(url.toString(),token);
  if(result?.documents?.length)fail('Staging destination has existing '+root+' records. Use a NEW isolated staging project; no writes made.');
 }
}
async function restoreDocs(archive,target,token){
 await isEmpty(target,token);
 const sorted=[...archive.documents].sort((a,b)=>a.path.split('/').length-b.path.split('/').length||a.path.localeCompare(b.path));
 let completed=0;
 for(let i=0;i<sorted.length;i+=20){
  const batch=sorted.slice(i,i+20).map(doc=>({
   update:{name:'projects/'+target+'/databases/(default)/documents/'+doc.path,
    fields:retargetFields(doc.fields,archive.sourceProject,target)},
   currentDocument:{exists:false},
  }));
  await api(urlFor(target,'').replace(/\/documents$/,'/documents:commit'),token,'POST',{writes:batch});
  completed+=batch.length;
  if(completed%200===0||completed===sorted.length)console.log('Created '+completed+' of '+sorted.length+' staging documents.');
 }
 return completed;
}
async function main(){
 if(mode==='export'){
  if(!validProject(project)||opt('confirm-project')!==project||!out)
   fail('Export requires --project=PROJECT --confirm-project=PROJECT --out=/private/path/backup.pcmbackup.');
  const dest=path.resolve(out);if(!dest.endsWith('.pcmbackup'))fail('Use a .pcmbackup filename.');
  if(fs.existsSync(dest))fail('Output file already exists; will never overwrite an existing backup.');
  console.log('Source Firestore project: '+project);
  const token=tokenProvider(),archive=await exportDocs(project,token);
  if(!archive.documents.length)fail('No documents were found. An empty backup cannot certify recovery.');
  const secret=await passphrase(),encrypted=encrypt(archive,secret);
  if(encrypted.length>MAX_BYTES)fail('Backup container exceeds safe size; no file written.');
  fs.writeFileSync(dest,encrypted,{flag:'wx',mode:0o600});
  const verified=decrypt(fs.readFileSync(dest),secret);
  if(digest(verified)!==digest(archive))fail('Backup verification failed. Do not trust this file.');
  console.log(JSON.stringify({status:'ENCRYPTED_BACKUP_VERIFIED',sourceProject:project,
   documents:verified.documents.length,collections:counts(verified),sha256:digest(verified),
   file:dest},null,2));
 }else{
  if(!file||!fs.existsSync(file))fail('Specify an existing --file=...pcmbackup.');
  if(fs.statSync(file).size>MAX_BYTES)fail('Backup file exceeds allowed size.');
  const archive=decrypt(fs.readFileSync(file),await passphrase());
  console.log(JSON.stringify({status:'ARCHIVE_VERIFIED',sourceProject:archive.sourceProject,
   exportedAt:archive.exportedAt,documentCount:archive.documents.length,
   collections:counts(archive),sha256:digest(archive)},null,2));
  if(mode==='verify')return;
  if(!validProject(project)||project===archive.sourceProject)fail('Restore target must be a different, isolated Firebase project.');
  if(!(/-staging$|-test$/.test(project)||project.startsWith('demo-')))
   fail('Refusing restore: staging project ID must end -staging/-test or start demo-.');
  if(!flag('apply')){
   console.log('DRY RUN ONLY. Restore target: '+project+'. Add --apply --confirm-staging='+project+' for an EMPTY staging project.');
   return;
  }
  if(opt('confirm-staging')!==project)fail('Restore refused. Explicit --confirm-staging must equal the staging project ID.');
  const token=tokenProvider();
  try {
   const n=await restoreDocs(archive,project,token);
   console.log('STAGING_RESTORE_CREATED '+n+' documents. Firebase Authentication accounts and Hosting are NOT restored.');
  }catch(e){console.error('RESTORE INCOMPLETE. Do not rerun against partially populated staging. Use a fresh staging project.');throw e}
 }
}
main().catch(e=>{console.error('Clinic backup error: '+e.message);process.exitCode=1});
