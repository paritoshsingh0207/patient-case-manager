#!/usr/bin/env node
// Local-only Firebase Admin SDK provisioning. No Cloud Functions / Blaze required.
// Create the Firebase Authentication user in console first, then attach an active
// Firestore clinic role using explicit project/uid flags. Never commit credentials.
'use strict';
const {initializeApp} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');
const {getFirestore,FieldValue} = require('firebase-admin/firestore');
const args=process.argv.slice(2);
const opt=name=>{const x=args.find(v=>v.startsWith('--'+name+'='));return x?.slice(name.length+3)??null;};
const flag=name=>args.includes('--'+name);
const project=opt('project'),uid=opt('uid'),mode=opt('mode'),role=opt('role')??'doctor';
function fail(msg){throw Error(msg);}
if(!project||!uid||!['activate','deactivate'].includes(mode)) {
  console.error('Usage: node functions/scripts/manage-doctor.cjs --project=PROJECT_ID --uid=AUTH_UID --mode=activate|deactivate [--role=admin|doctor] --confirm-project=PROJECT_ID');
  process.exit(2);
}
if(!/^[a-z][a-z0-9-]{4,29}$/.test(project)||uid.length>128||!['admin','doctor'].includes(role))fail('Invalid project, UID or role.');
if(opt('confirm-project')!==project)fail('Explicit --confirm-project=PROJECT_ID required.');
if(role==='admin'&&!flag('confirm-admin-role')&&mode==='activate')
  fail('Creating an admin requires --confirm-admin-role.');
initializeApp({projectId:project});
const db=getFirestore(),auth=getAuth();
(async()=>{
  const ref=db.doc('users/'+uid);
  if(mode==='deactivate'){
    const existing=await ref.get();
    if(!existing.exists)fail('No clinic profile found for this UID.');
    await ref.update({active:false,disabledAt:FieldValue.serverTimestamp()});
    console.log('Disabled clinic access. Authentication login may still exist; rules deny inactive users.');
    return;
  }
  const authUser=await auth.getUser(uid);
  if(!authUser.email)fail('Firebase Authentication account needs an email.');
  const previous=await ref.get();
  if(previous.exists&&previous.data()?.role!==role)
    fail('Role reassignment denied. Review and change through an explicitly audited admin process.');
  if(previous.exists&&previous.data()?.deleted===true)
    fail('Previously deleted profile cannot be silently reactivated.');
  await ref.set({
    active:true,role,email:authUser.email,displayName:authUser.displayName||authUser.email,
    updatedAt:FieldValue.serverTimestamp(),
    ...(!previous.exists?{createdAt:FieldValue.serverTimestamp(),createdBy:'trusted-local-admin'}:{}),
  },{merge:true});
  console.log('Activated '+role+' clinic profile for Firebase Auth UID '+uid+'.');
})().catch(err=>{console.error('Provisioning error:',err.message);process.exitCode=1;});
