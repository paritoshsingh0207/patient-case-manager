#!/usr/bin/env node
'use strict';
/* Browser-only mobile smoke run against Firebase Auth + Firestore emulators. */
const {spawn}=require('node:child_process');
const path=require('node:path');
const {createRequire}=require('node:module');
const functionRequire=createRequire(path.resolve(__dirname,'../functions/package.json'));
const {initializeApp}=functionRequire('firebase-admin/app');
const {getAuth}=functionRequire('firebase-admin/auth');
const {getFirestore}=functionRequire('firebase-admin/firestore');
const {chromium}=require('playwright');
const fs=require('node:fs');

const app=initializeApp({projectId:'demo-patient-case-manager'});
const adminAuth=getAuth(app),db=getFirestore(app);
const base='http://127.0.0.1:4173';
const screenshots=path.resolve('mobile-ui-screenshots');
fs.mkdirSync(screenshots,{recursive:true});
let vite,browser;

async function waitForServer(){
  for(let i=0;i<100;i++){
    try{const r=await fetch(base);if(r.ok)return;}catch{}
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw Error('Vite server did not become available');
}
async function checkWidth(page,label){
  await page.waitForTimeout(100);
  const layout=await page.evaluate(()=>{
    const width=document.documentElement.clientWidth;
    const scroll=document.documentElement.scrollWidth;
    const offenders=[...document.querySelectorAll('body *')]
      .filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>width+3&&!e.closest('.patient-tabs,.mobile-nav');})
      .slice(0,8).map(e=>e.className?.baseVal??e.className??e.tagName);
    return {width,scroll,offenders};
  });
  if(layout.scroll>layout.width+3)
    throw Error(label+': horizontal overflow '+JSON.stringify(layout));
  console.log('PASS '+label+': viewport '+layout.width+', scroll '+layout.scroll);
}
async function screen(page,name){
  await page.screenshot({path:path.join(screenshots,name+'.png'),fullPage:true});
}
async function login(page,role,email,password){
  await page.goto(base);
  await page.getByRole('button',{name:role,exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in as '+role}).click();
  await page.getByRole('heading',{name:'Overview',exact:true}).waitFor({timeout:25000});
}
async function nav(page,label){
  const button=page.getByRole('button',{name:label,exact:true});
  await button.click();
  await page.waitForTimeout(250);
}
async function signOut(page){
  await page.getByRole('button',{name:'Sign out'}).first().click();
  await page.getByRole('button',{name:'Admin',exact:true}).waitFor({timeout:20000});
}

(async()=>{
  const primary=await adminAuth.createUser({email:'admin@clinic.test',password:'LongPassword#001'});
  const doctor=await adminAuth.createUser({email:'doctor@clinic.test',password:'LongPassword#002'});
  await db.doc('users/'+primary.uid).set({
    role:'admin',active:true,displayName:'Clinic Admin',email:'admin@clinic.test',
  });
  await db.doc('users/'+doctor.uid).set({
    role:'doctor',active:true,displayName:'Dr Test',email:'doctor@clinic.test',
  });
  await db.doc('patients/mobile-demo-patient').set({
    firstName:'Test',lastName:'Patient',dateOfBirth:'1985-01-02',
    allergies:'None recorded',currentMedications:'None recorded',
    doctorIds:[doctor.uid],createdBy:primary.uid,
    createdAt:new Date(),updatedAt:new Date(),
  });
  vite=spawn(process.execPath,[path.resolve('node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','4173','--strictPort'],{
    cwd:process.cwd(),
    env:{...process.env,
      VITE_FIREBASE_API_KEY:'demo-api-key',
      VITE_FIREBASE_AUTH_DOMAIN:'demo-patient-case-manager.firebaseapp.com',
      VITE_FIREBASE_PROJECT_ID:'demo-patient-case-manager',
      VITE_FIREBASE_MESSAGING_SENDER_ID:'1234567890',
      VITE_FIREBASE_APP_ID:'1:1234567890:web:1234567890',
      VITE_USE_FIREBASE_EMULATORS:'true'},
    stdio:'inherit'
  });
  await waitForServer();
  browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:360,height:800}});
  await page.goto(base);
  await page.getByRole('heading',{name:'Doctor login'}).waitFor();
  if(await page.getByText('One clinic. Two dedicated workspaces.').count())throw Error('Old marketing copy still visible.');
  for(const width of [320,360,390,414,768]){
    await page.setViewportSize({width,height:800});
    await checkWidth(page,'login '+width);
  }
  await screen(page,'doctor-login-390');
  for(const width of [320,390,768,1024]){
    await page.setViewportSize({width,height:820});
    if(width===320)await login(page,'Admin','admin@clinic.test','LongPassword#001');
    await checkWidth(page,'admin overview '+width);
    await nav(page,'Patients');
    await checkWidth(page,'admin patients '+width);
    await nav(page,'Medicine registry');
    await checkWidth(page,'admin medicines '+width);
    await nav(page,'Administration');
    await page.getByRole('heading',{name:'Doctors',exact:true}).waitFor();
    await checkWidth(page,'admin account controls '+width);
    await page.getByRole('button',{name:'Add administrator'}).click();
    await checkWidth(page,'add administrator form '+width);
    await page.getByRole('button',{name:'Cancel'}).click();
    if(width===390)await screen(page,'admin-mobile-390');
  }
  await signOut(page);
  await page.setViewportSize({width:360,height:800});
  await page.getByRole('button',{name:'Register as a doctor'}).click();
  await page.getByRole('heading',{name:'Doctor registration'}).waitFor();
  await checkWidth(page,'doctor registration');
  await page.getByLabel('Full name').fill('Dr New Applicant');
  await page.getByLabel('Email',{exact:true}).fill('applicant@clinic.test');
  await page.getByLabel('Password',{exact:true}).fill('LongPassword#003');
  await page.getByLabel('Confirm password').fill('LongPassword#003');
  await page.getByRole('button',{name:'Register as Doctor'}).click();
  await page.getByRole('heading',{name:'Account pending approval'}).waitFor({timeout:25000});
  await checkWidth(page,'pending approval');
  await page.getByRole('button',{name:'Sign out'}).click();

  await login(page,'Admin','admin@clinic.test','LongPassword#001');
  await nav(page,'Administration');
  await page.getByText('Dr New Applicant').waitFor({timeout:15000});
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Activate doctor'}).click();
  await page.getByText('Doctor account activated.').waitFor({timeout:20000});
  await checkWidth(page,'admin doctor activation');
  await signOut(page);

  await login(page,'Doctor','doctor@clinic.test','LongPassword#002');
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:800});
    await checkWidth(page,'doctor overview '+width);
    await nav(page,'Patients');
    await page.getByRole('heading',{name:'Test Patient'}).waitFor();
    await checkWidth(page,'doctor patient profile '+width);
    await page.getByRole('button',{name:'New consultation'}).click();
    await checkWidth(page,'doctor consultation '+width);
    await page.getByRole('button',{name:'Prescriptions'}).click();
    await checkWidth(page,'doctor prescription form '+width);
    await nav(page,'Medicine registry');
    await checkWidth(page,'doctor medicine registry '+width);
    if(width===390)await screen(page,'doctor-patient-prescription-390');
  }
  console.log('All mobile browser smoke checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  await browser?.close().catch(()=>{});
  if(vite)vite.kill('SIGTERM');
  await app.delete();
});
