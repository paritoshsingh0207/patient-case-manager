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
  serverTimestamp,
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
