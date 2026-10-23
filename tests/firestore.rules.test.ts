import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  setDoc,
  updateDoc,
  writeBatch,
  serverTimestamp,
  query,
  where,
} from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-patient-case-manager',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.resolve('firestore.rules'), 'utf8'),
    },
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

async function seedUser(
  uid: string,
  role: 'doctor' | 'practitioner' | 'admin' | 'viewer',
  active = true,
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}`), {
      active,
      role,
      displayName: uid,
      email: `${uid}@clinic.test`,
    });
  });
}

async function seedPatient(
  patientId: string,
  doctorIds: string[],
  createdBy = 'admin',
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, `patients/${patientId}`), {
      createdBy,
      doctorIds,
      firstName: 'Patient',
      lastName: patientId,
    });
    await setDoc(doc(db, `patients/${patientId}/cases/case-1`), {
      patientId,
      createdBy: doctorIds[0] ?? 'saurabh',
      consultationDate: '2026-10-19',
      chiefComplaint: 'Example case history',
      status: 'completed',
    });
  });
}

describe('clinic role and patient-sharing security rules', () => {
  it('allows an active user to read only their own access profile unless they are admin', async () => {
    await seedUser('saurabh', 'doctor');
    await seedUser('admin', 'admin');

    const saurabh = testEnv.authenticatedContext('saurabh').firestore();
    const admin = testEnv.authenticatedContext('admin').firestore();

    await assertSucceeds(getDoc(doc(saurabh, 'users/saurabh')));
    await assertFails(getDoc(doc(saurabh, 'users/admin')));
    await assertSucceeds(getDocs(collection(admin, 'users')));
  });

  it('blocks signed-in users who are not provisioned or are inactive', async () => {
    await seedUser('inactive', 'doctor', false);

    const unapproved = testEnv.authenticatedContext('unapproved').firestore();
    const inactive = testEnv.authenticatedContext('inactive').firestore();

    await assertFails(setDoc(doc(unapproved, 'patients/p1'), {
      createdBy: 'unapproved',
      doctorIds: ['unapproved'],
      firstName: 'No',
      lastName: 'Access',
    }));

    await assertFails(setDoc(doc(inactive, 'patients/p2'), {
      createdBy: 'inactive',
      doctorIds: ['inactive'],
      firstName: 'Inactive',
      lastName: 'Doctor',
    }));
  });

  it('lets Doctor Saurabh see Patient A and the complete case history when assigned', async () => {
    await seedUser('saurabh', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const saurabh = testEnv.authenticatedContext('saurabh').firestore();
    await assertSucceeds(getDoc(doc(saurabh, 'patients/patient-a')));
    await assertSucceeds(getDoc(doc(saurabh, 'patients/patient-a/cases/case-1')));
  });

  it('prevents Doctor Gaurav from seeing Patient A when he is not assigned', async () => {
    await seedUser('saurabh', 'doctor');
    await seedUser('gaurav', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const gaurav = testEnv.authenticatedContext('gaurav').firestore();
    await assertFails(getDoc(doc(gaurav, 'patients/patient-a')));
    await assertFails(getDoc(doc(gaurav, 'patients/patient-a/cases/case-1')));
  });

  it('allows admin to see Patient A and its case history without being on the care team', async () => {
    await seedUser('admin', 'admin');
    await seedUser('saurabh', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const admin = testEnv.authenticatedContext('admin').firestore();
    await assertSucceeds(getDoc(doc(admin, 'patients/patient-a')));
    await assertSucceeds(getDoc(doc(admin, 'patients/patient-a/cases/case-1')));
  });

  it('lets admin share Patient A with Doctor Gaurav, after which Gaurav can read the history', async () => {
    await seedUser('admin', 'admin');
    await seedUser('saurabh', 'doctor');
    await seedUser('gaurav', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const admin = testEnv.authenticatedContext('admin').firestore();
    await assertSucceeds(updateDoc(doc(admin, 'patients/patient-a'), {
      doctorIds: ['saurabh', 'gaurav'],
    }));

    const gaurav = testEnv.authenticatedContext('gaurav').firestore();
    await assertSucceeds(getDoc(doc(gaurav, 'patients/patient-a')));
    await assertSucceeds(getDoc(doc(gaurav, 'patients/patient-a/cases/case-1')));
  });

  it('prevents a doctor from changing the care team or sharing a patient themselves', async () => {
    await seedUser('saurabh', 'doctor');
    await seedUser('gaurav', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const saurabh = testEnv.authenticatedContext('saurabh').firestore();
    await assertFails(updateDoc(doc(saurabh, 'patients/patient-a'), {
      doctorIds: ['saurabh', 'gaurav'],
    }));
  });

  it('allows an assigned doctor to create clinical records but prevents an unassigned doctor', async () => {
    await seedUser('saurabh', 'doctor');
    await seedUser('gaurav', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const saurabh = testEnv.authenticatedContext('saurabh').firestore();
    const gaurav = testEnv.authenticatedContext('gaurav').firestore();

    await assertSucceeds(setDoc(doc(saurabh, 'patients/patient-a/cases/new-case'), {
      patientId: 'patient-a',
      createdBy: 'saurabh',
      consultationDate: '2026-10-19',
      chiefComplaint: 'Follow-up',
      status: 'completed',
    }));

    await assertFails(setDoc(doc(gaurav, 'patients/patient-a/cases/unauthorized-case'), {
      patientId: 'patient-a',
      createdBy: 'gaurav',
      consultationDate: '2026-10-19',
      chiefComplaint: 'Should fail',
      status: 'completed',
    }));
  });

  it('allows admin to read clinical records but not author a doctor case note or prescription', async () => {
    await seedUser('admin', 'admin');
    await seedUser('saurabh', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const admin = testEnv.authenticatedContext('admin').firestore();

    await assertFails(setDoc(doc(admin, 'patients/patient-a/cases/admin-case'), {
      patientId: 'patient-a',
      createdBy: 'admin',
      consultationDate: '2026-10-19',
      chiefComplaint: 'Admin should not author clinical notes',
      status: 'completed',
    }));

    await assertFails(setDoc(doc(admin, 'patients/patient-a/prescriptions/admin-rx'), {
      patientId: 'patient-a',
      createdBy: 'admin',
      issuedAt: '2026-10-19',
      issuedByName: 'Administrator',
      items: [{ code: 'B1', directions: 'Example' }],
    }));
  });

  it('allows assigned doctors to create coded prescriptions and blocks unassigned doctors from reading them', async () => {
    await seedUser('saurabh', 'doctor');
    await seedUser('gaurav', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const saurabh = testEnv.authenticatedContext('saurabh').firestore();
    const gaurav = testEnv.authenticatedContext('gaurav').firestore();

    const prescription = doc(saurabh, 'patients/patient-a/prescriptions/rx-1');
    await assertFails(setDoc(prescription, {
      patientId: 'patient-a',
      createdBy: 'saurabh',
      issuedAt: '2026-10-19',
      issuedByName: 'Dr Saurabh',
      items: [{ code: 'B1', directions: '4 pills twice daily', quantity: '7 days' }],
    }));

    // Older B-series codes are historical only; rules deny new B-series prescriptions.
    await assertFails(getDoc(doc(gaurav, 'patients/patient-a/prescriptions/rx-1')));
  });

  it('keeps the medicine-code mapping internal: admin manages it, doctors can look it up', async () => {
    await seedUser('admin', 'admin');
    await seedUser('saurabh', 'doctor');

    const admin = testEnv.authenticatedContext('admin').firestore();
    const saurabh = testEnv.authenticatedContext('saurabh').firestore();

    await assertFails(setDoc(doc(admin, 'medicineCodes/B1'), {
      code: 'B1',
      remedyName: 'Belladonna',
      active: true,
    }));

    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), 'medicineCodes/BE1'), {
        code: 'BE1', remedyName: 'Belladonna', approvedForNewRx: true, active: true,
      });
    });
    await assertSucceeds(getDoc(doc(saurabh, 'medicineCodes/BE1')));
    await assertFails(updateDoc(doc(admin, 'medicineCodes/BE1'), {remedyName: 'Different medicine'}));

    await assertFails(setDoc(doc(saurabh, 'medicineCodes/B2'), {
      code: 'B2',
      remedyName: 'Example',
      active: true,
    }));
  });

  it('prevents doctors from rewriting another doctors historical case after patient sharing', async () => {
    await seedUser('admin', 'admin');
    await seedUser('saurabh', 'doctor');
    await seedUser('gaurav', 'doctor');
    await seedPatient('patient-a', ['saurabh']);

    const admin = testEnv.authenticatedContext('admin').firestore();
    await assertSucceeds(updateDoc(doc(admin, 'patients/patient-a'), {
      doctorIds: ['saurabh', 'gaurav'],
    }));

    const gaurav = testEnv.authenticatedContext('gaurav').firestore();
    await assertFails(updateDoc(doc(gaurav, 'patients/patient-a/cases/case-1'), {
      notes: 'Attempt to rewrite Saurabh history',
    }));
  });
});


describe('production append-only clinical audit rules', () => {
  it('blocks direct deletion or edits of signed clinical history for any role', async () => {
    await seedUser('admin','admin'); await seedUser('saurabh','doctor');
    await seedPatient('patient-a',['saurabh']);
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(),'patients/patient-a/prescriptions/rx-1'),{
        patientId:'patient-a',createdBy:'saurabh',issuedAt:'2026-10-21',
        items:[{code:'BE1',directions:'Example'}],
      });
    });
    const doctor = testEnv.authenticatedContext('saurabh').firestore();
    const admin = testEnv.authenticatedContext('admin').firestore();
    for (const client of [doctor,admin]) {
      await assertFails(deleteDoc(doc(client,'patients/patient-a/prescriptions/rx-1')));
      await assertFails(updateDoc(doc(client,'patients/patient-a/prescriptions/rx-1'),{items:[]}));
      await assertFails(deleteDoc(doc(client,'patients/patient-a/cases/case-1')));
      await assertFails(updateDoc(doc(client,'patients/patient-a/cases/case-1'),{notes:'silent rewrite'}));
    }
  });
});


describe('Spark prescription validation without Cloud Functions', () => {
  const path = 'patients/patient-a/prescriptions';
  const approved = {
    patientId:'patient-a',createdBy:'saurabh',issuedByName:'Dr Saurabh',
    issuedAt:'2026-10-21',medicineCode:'BE1',clinicalReviewConfirmed:true,
    createdAt:serverTimestamp(),patientInstructions:'',
    items:[{code:'BE1',potency:'30C',dosageForm:'globules',directions:'clinician directions',quantity:'7 days'}],
  };

  async function seedMedicine(active=true,approvedForNewRx=true) {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(),'medicineCodes/BE1'),{
        code:'BE1',remedyName:'Belladonna',active,approvedForNewRx,expertVerified:true,
      });
    });
  }

  it('allows one expert-approved medicine per Rx and permits audited voiding',async()=>{
    await seedUser('saurabh','doctor');await seedPatient('patient-a',['saurabh']);
    await seedMedicine();
    const db=testEnv.authenticatedContext('saurabh').firestore();
    const ref=doc(db,path+'/rx-1');
    await assertSucceeds(setDoc(ref,approved));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref,{voidedAt:serverTimestamp(),voidedBy:'saurabh',voidReason:'Issued in error'}));
    await assertFails(updateDoc(ref,{voidReason:'Changed reason'}));
    await assertFails(deleteDoc(ref));
  });

  it('rejects unknown, inactive, unverified, legacy and multi-item prescriptions',async()=>{
    await seedUser('saurabh','doctor');await seedPatient('patient-a',['saurabh']);
    const db=testEnv.authenticatedContext('saurabh').firestore();
    await seedMedicine();
    await assertFails(setDoc(doc(db,path+'/legacy'),{...approved,medicineCode:'B1',items:[{...approved.items[0],code:'B1'}]}));
    await assertFails(setDoc(doc(db,path+'/unknown'),{...approved,medicineCode:'ZZ999',items:[{...approved.items[0],code:'ZZ999'}]}));
    await assertFails(setDoc(doc(db,path+'/two'),{...approved,items:[approved.items[0],approved.items[0]]}));
    await assertFails(setDoc(doc(db,path+'/wrong-code'),{...approved,medicineCode:'BE1',items:[{...approved.items[0],code:'AB1'}]}));
    await seedMedicine(false,true);
    await assertFails(setDoc(doc(db,path+'/inactive'),approved));
    await seedMedicine(true,false);
    await assertFails(setDoc(doc(db,path+'/not-approved'),approved));
    await seedMedicine(true,true);
    await assertFails(setDoc(doc(db,path+'/missing-review'),{...approved,clinicalReviewConfirmed:false}));
  });

  it('rejects unassigned doctors and restricts voiding to prescriber or admin',async()=>{
    await seedUser('saurabh','doctor');await seedUser('gaurav','doctor');await seedUser('admin','admin');
    await seedPatient('patient-a',['saurabh','gaurav']);await seedMedicine();
    const saurabh=testEnv.authenticatedContext('saurabh').firestore();
    const gaurav=testEnv.authenticatedContext('gaurav').firestore();
    const admin=testEnv.authenticatedContext('admin').firestore();
    await assertSucceeds(setDoc(doc(saurabh,path+'/rx-1'),approved));
    await assertFails(updateDoc(doc(gaurav,path+'/rx-1'),{
      voidedAt:serverTimestamp(),voidedBy:'gaurav',voidReason:'not the prescriber',
    }));
    await assertSucceeds(updateDoc(doc(admin,path+'/rx-1'),{
      voidedAt:serverTimestamp(),voidedBy:'admin',voidReason:'clinic verification',
    }));
    await assertFails(setDoc(doc(admin,path+'/admin-rx'),{...approved,createdBy:'admin'}));
  });

  it('does not allow browser-side role editing or registry edits',async()=>{
    await seedUser('admin','admin');await seedUser('saurabh','doctor');
    const admin=testEnv.authenticatedContext('admin').firestore();
    const doctor=testEnv.authenticatedContext('saurabh').firestore();
    await assertFails(setDoc(doc(admin,'users/newadmin'),{active:true,role:'admin'}));
    await assertFails(updateDoc(doc(doctor,'users/saurabh'),{role:'admin'}));
    await assertFails(setDoc(doc(admin,'medicineCodes/BE1'),{
      code:'BE1',remedyName:'Belladonna',active:true,approvedForNewRx:true,expertVerified:true,
    }));
  });
});

describe('Spark admin doctor management, role immutability and revocation',()=>{
  const makeProfile=(uid:string,adminUid='admin')=>({
    active:true,role:'doctor',displayName:'Dr Example',email:'doctor@example.com',
    createdBy:adminUid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
    statusUpdatedBy:adminUid,
  });
  it('allows an active admin to register a doctor profile for an existing Auth UID',async()=>{
    await seedUser('admin','admin');await seedUser('outsider','doctor');
    const a=testEnv.authenticatedContext('admin').firestore();
    const d=testEnv.authenticatedContext('outsider').firestore();
    await assertSucceeds(setDoc(doc(a,'users/doctor-uid-0001'),makeProfile('doctor-uid-0001')));
    await assertFails(setDoc(doc(d,'users/doctor-uid-0002'),makeProfile('doctor-uid-0002','outsider')));
  });
  it('blocks client-created admin profiles and role escalation',async()=>{
    await seedUser('admin','admin');await seedUser('outsider','doctor');
    const a=testEnv.authenticatedContext('admin').firestore();
    const d=testEnv.authenticatedContext('outsider').firestore();
    await assertSucceeds(setDoc(doc(a,'users/new-admin-uid'),{...makeProfile('new-admin-uid'),role:'admin'}));
    await assertFails(updateDoc(doc(a,'users/outsider'),{role:'admin'}));
    await assertFails(updateDoc(doc(d,'users/outsider'),{role:'admin',active:true}));
    await assertFails(setDoc(doc(a,'users/doctor-uid-0003'),{...makeProfile('doctor-uid-0003'),isAdmin:true}));
  });
  it('admin can deactivate/reactivate a doctor, but not change immutable identity fields',async()=>{
    await seedUser('admin','admin');await seedUser('outsider','doctor');
    await seedPatient('patient-a',['outsider']);
    const a=testEnv.authenticatedContext('admin').firestore();
    const d=testEnv.authenticatedContext('outsider').firestore();
    const ref=doc(a,'users/outsider');
    await assertSucceeds(getDoc(doc(d,'patients/patient-a')));
    await assertSucceeds(updateDoc(ref,{active:false,updatedAt:serverTimestamp(),statusUpdatedBy:'admin'}));
    await assertFails(getDoc(doc(d,'patients/patient-a')));
    await assertFails(updateDoc(ref,{displayName:'Altered Doctor'}));
    await assertFails(updateDoc(ref,{active:true,role:'admin',updatedAt:serverTimestamp(),statusUpdatedBy:'admin'}));
    await assertFails(updateDoc(doc(d,'users/outsider'),{active:true,updatedAt:serverTimestamp(),statusUpdatedBy:'outsider'}));
    await assertSucceeds(updateDoc(ref,{active:true,updatedAt:serverTimestamp(),statusUpdatedBy:'admin'}));
    await assertSucceeds(getDoc(doc(d,'patients/patient-a')));
    await assertFails(deleteDoc(ref));
  });
});

describe('doctor self-registration and admin controls',()=>{
  it('permits only an inactive doctor profile owned by the signed-in applicant',async()=>{
    const applicant=testEnv.authenticatedContext('new-doctor',{email:'new-doctor@clinic.test'}).firestore();
    await assertSucceeds(setDoc(doc(applicant,'users/new-doctor'),{
      role:'doctor',active:false,displayName:'Dr New Doctor',
      email:'new-doctor@clinic.test',registrationMethod:'self',createdAt:serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(applicant,'users/new-doctor'),{active:true}));
    await assertFails(setDoc(doc(applicant,'users/another-user'),{
      role:'doctor',active:false,displayName:'Other',
      email:'new-doctor@clinic.test',registrationMethod:'self',createdAt:serverTimestamp(),
    }));
  });
  it('requires existing admin to grant admin role and prevents doctors from promoting themselves',async()=>{
    await seedUser('admin','admin');await seedUser('saurabh','doctor');
    const admin=testEnv.authenticatedContext('admin').firestore();
    const doctor=testEnv.authenticatedContext('saurabh').firestore();
    const data={
      role:'admin',active:true,displayName:'Second Administrator',
      email:'second@example.com',createdBy:'admin',statusUpdatedBy:'admin',
      createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
    };
    await assertSucceeds(setDoc(doc(admin,'users/second-admin'),data));
    await assertFails(setDoc(doc(doctor,'users/forged-admin'),{...data,createdBy:'saurabh',statusUpdatedBy:'saurabh'}));
  });
});


describe('pending doctor activation remains admin controlled',()=>{
  it('lets admin approve a pending doctor but keeps unverified email from reading patients',async()=>{
    await seedUser('admin','admin');
    await seedPatient('patient-a',['new-doctor']);
    const applicant=testEnv.authenticatedContext('new-doctor',{email:'new-doctor@clinic.test',email_verified:false}).firestore();
    const admin=testEnv.authenticatedContext('admin').firestore();
    await assertSucceeds(setDoc(doc(applicant,'users/new-doctor'),{
      role:'doctor',active:false,displayName:'Dr New',email:'new-doctor@clinic.test',
      registrationMethod:'self',createdAt:serverTimestamp(),
    }));
    await assertFails(getDoc(doc(applicant,'patients/patient-a')));
    await assertSucceeds(updateDoc(doc(admin,'users/new-doctor'),{
      active:true,updatedAt:serverTimestamp(),statusUpdatedBy:'admin',
    }));
    await assertFails(getDoc(doc(applicant,'patients/patient-a')));
    const verified=testEnv.authenticatedContext('new-doctor',{email:'new-doctor@clinic.test',email_verified:true}).firestore();
    await assertSucceeds(getDoc(doc(verified,'patients/patient-a')));
    await assertFails(updateDoc(doc(verified,'users/new-doctor'),{role:'admin'}));
  });
});

describe('live Firestore collection queries and per-patient revocation',()=>{
  it('doctor query only returns assigned patients, not the entire clinic',async()=>{
    await seedUser('admin','admin'); await seedUser('doctor-1','doctor');await seedUser('doctor-2','doctor');
    await seedPatient('patient-a',['doctor-1']);await seedPatient('patient-b',['doctor-2']);
    const a=testEnv.authenticatedContext('admin').firestore();
    const d1=testEnv.authenticatedContext('doctor-1').firestore();
    await assertSucceeds(getDocs(collection(a,'patients')));
    const assigned=query(collection(d1,'patients'),where('doctorIds','array-contains','doctor-1'));
    const results=await assertSucceeds(getDocs(assigned));
    if(results.docs.map(d=>d.id).join(',')!=='patient-a')throw Error('Doctor query returned wrong patients');
    await assertFails(getDocs(collection(d1,'patients')));
  });
  it('admin can revoke just one doctor; removed doctor loses patient and child access instantly',async()=>{
    await seedUser('admin','admin');await seedUser('doctor-1','doctor');await seedUser('doctor-2','doctor');
    await seedPatient('patient-a',['doctor-1','doctor-2']);
    const admin=testEnv.authenticatedContext('admin').firestore();
    const d1=testEnv.authenticatedContext('doctor-1').firestore();
    const d2=testEnv.authenticatedContext('doctor-2').firestore();
    await assertSucceeds(getDoc(doc(d1,'patients/patient-a')));
    await assertSucceeds(updateDoc(doc(admin,'patients/patient-a'),{doctorIds:['doctor-2']}));
    await assertFails(getDoc(doc(d1,'patients/patient-a')));
    await assertFails(getDocs(collection(d1,'patients/patient-a/cases')));
    await assertSucceeds(getDoc(doc(d2,'patients/patient-a')));
    await assertSucceeds(getDocs(collection(d2,'patients/patient-a/cases')));
    await assertFails(updateDoc(doc(d2,'patients/patient-a'),{doctorIds:['doctor-1','doctor-2']}));
  });
  it('admin can unassign a doctor from an older patient without rewriting clinical history',async()=>{
    await seedUser('admin','admin');await seedUser('doctor-1','doctor');
    await testEnv.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'patients/legacy'),{
      doctorIds:['doctor-1'],firstName:'Old',lastName:'Record',ownerId:'doctor-1',
    }));
    const a=testEnv.authenticatedContext('admin').firestore();
    await assertSucceeds(updateDoc(doc(a,'patients/legacy'),{doctorIds:[]}));
  });
});

describe('saved prescription history access after sign-in',()=>{
  it('allows authorized doctors to list saved prescriptions, including records authored by another doctor',async()=>{
    await seedUser('doctor-1','doctor');await seedUser('doctor-2','doctor');await seedUser('admin','admin');
    await seedPatient('patient-a',['doctor-1','doctor-2']);
    await testEnv.withSecurityRulesDisabled(async context=>{
      const db=context.firestore();
      await setDoc(doc(db,'patients/patient-a/prescriptions/historical-rx'),{
        patientId:'patient-a',createdBy:'doctor-1',issuedByName:'Doctor One',
        issuedAt:'2026-10-20',medicineCode:'BE1',
        items:[{code:'BE1',potency:'30C',dosageForm:'drops',directions:'As prescribed',quantity:'7 days'}],
      });
    });
    const sameDoctor=testEnv.authenticatedContext('doctor-1').firestore();
    const secondDoctor=testEnv.authenticatedContext('doctor-2').firestore();
    const admin=testEnv.authenticatedContext('admin').firestore();
    for(const access of [sameDoctor,secondDoctor,admin]){
      const results=await assertSucceeds(getDocs(collection(access,'patients/patient-a/prescriptions')));
      if(results.size!==1||results.docs[0].id!=='historical-rx')throw Error('Saved prescription not visible');
      await assertSucceeds(getDoc(doc(access,'patients/patient-a/prescriptions/historical-rx')));
    }
    await assertSucceeds(updateDoc(doc(admin,'patients/patient-a'),{doctorIds:['doctor-2']}));
    await assertFails(getDocs(collection(sameDoctor,'patients/patient-a/prescriptions')));
    await assertSucceeds(getDocs(collection(secondDoctor,'patients/patient-a/prescriptions')));
  });
});

describe('Priority 0: protected administrative activity',()=>{
 it('allows admin to append records, not edit them, and rejects doctors and spoofing',async()=>{
  await seedUser('admin','admin');await seedUser('doctor','doctor');
  const a=testEnv.authenticatedContext('admin').firestore(),d=testEnv.authenticatedContext('doctor').firestore();
  const event={actorUid:'admin',action:'care_team_changed',targetType:'patient',targetId:'patient-a',recordedAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(a,'auditEvents/event1'),event));
  await assertSucceeds(getDoc(doc(a,'auditEvents/event1')));
  await assertFails(getDoc(doc(d,'auditEvents/event1')));
  await assertFails(setDoc(doc(d,'auditEvents/event2'),{...event,actorUid:'doctor'}));
  await assertFails(setDoc(doc(a,'auditEvents/event3'),{...event,actorUid:'someone'}));
  await assertFails(updateDoc(doc(a,'auditEvents/event1'),{targetId:'patient-b'}));
  await assertFails(deleteDoc(doc(a,'auditEvents/event1')));
 });
});

describe('Priority 1: internal follow-up permissions',()=>{
 it('assigned doctor can create and complete follow-up; unassigned doctor cannot read or alter',async()=>{
  await seedUser('admin','admin');await seedUser('d1','doctor');await seedUser('d2','doctor');
  await seedPatient('pa',['d1']);
  const first=testEnv.authenticatedContext('d1').firestore(),other=testEnv.authenticatedContext('d2').firestore(),
   admin=testEnv.authenticatedContext('admin').firestore();
  const ref=doc(first,'patients/pa/followUps/fu1');
  const data={patientId:'pa',createdBy:'d1',dueDate:'2026-11-10',reason:'Review symptom progression',status:'open',createdAt:serverTimestamp()};
  await assertSucceeds(setDoc(ref,data));
  await assertSucceeds(getDoc(doc(admin,'patients/pa/followUps/fu1')));
  await assertFails(getDoc(doc(other,'patients/pa/followUps/fu1')));
  await assertFails(setDoc(doc(other,'patients/pa/followUps/forged'),{...data,createdBy:'d2'}));
  await assertSucceeds(updateDoc(ref,{status:'completed',completedAt:serverTimestamp(),completedBy:'d1'}));
  await assertFails(updateDoc(ref,{status:'open'}));
  await assertFails(deleteDoc(ref));
 });
});

describe('Priority 0: administrator invitation audit remains append-only',()=>{
 it('supports an atomically recorded administrator invitation',async()=>{
  await seedUser('admin','admin');
  const a=testEnv.authenticatedContext('admin').firestore();
  const b=writeBatch(a);
  b.set(doc(a,'users/second-admin'),{
    role:'admin',active:true,displayName:'Another Administrator',email:'second@example.com',
    createdBy:'admin',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),statusUpdatedBy:'admin',
  });
  b.set(doc(a,'auditEvents/new-admin-event'),{
    actorUid:'admin',action:'administrator_invited',targetType:'administrator',targetId:'second-admin',
    recordedAt:serverTimestamp(),
  });
  await assertSucceeds(b.commit());
  await assertSucceeds(getDoc(doc(a,'auditEvents/new-admin-event')));
 });
});

describe('patient profile edits preserve care-team security', () => {
  it('allows assigned clinicians and admin to amend allergy notes, but never unassigned clinicians', async () => {
    await seedUser('admin','admin');
    await seedUser('assigned','doctor');
    await seedUser('outsider','doctor');
    await seedPatient('patient-edit',['assigned']);
    const assigned = testEnv.authenticatedContext('assigned').firestore();
    const outsider = testEnv.authenticatedContext('outsider').firestore();
    const admin = testEnv.authenticatedContext('admin').firestore();
    await assertSucceeds(updateDoc(doc(assigned,'patients/patient-edit'), {
      allergies: 'Newly documented medication allergy',
      currentMedications: 'Clinician-reviewed medicine list',
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(updateDoc(doc(admin,'patients/patient-edit'), {
      address: 'Updated clinic contact details', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(outsider,'patients/patient-edit'), {
      allergies: 'Unauthorized change', updatedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(assigned,'patients/patient-edit'), {
      doctorIds: ['assigned','outsider'],
    }));
    await assertFails(updateDoc(doc(assigned,'patients/patient-edit'), {
      createdBy: 'assigned',
    }));
    await assertFails(updateDoc(doc(assigned,'patients/patient-edit'), {
      privateFlag: 'forged', updatedAt: serverTimestamp(),
    }));
    // Recording a new consultation may still refresh the patient's activity time.
    await assertSucceeds(updateDoc(doc(assigned,'patients/patient-edit'), {
      updatedAt: serverTimestamp(),
    }));
    await assertSucceeds(getDoc(doc(assigned,'patients/patient-edit/cases/case-1')));
  });
});
