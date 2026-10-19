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
  setDoc,
  updateDoc,
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
    await assertSucceeds(setDoc(prescription, {
      patientId: 'patient-a',
      createdBy: 'saurabh',
      issuedAt: '2026-10-19',
      issuedByName: 'Dr Saurabh',
      items: [{ code: 'B1', directions: '4 pills twice daily', quantity: '7 days' }],
    }));

    await assertSucceeds(getDoc(prescription));
    await assertFails(getDoc(doc(gaurav, 'patients/patient-a/prescriptions/rx-1')));
  });

  it('keeps the medicine-code mapping internal: admin manages it, doctors can look it up', async () => {
    await seedUser('admin', 'admin');
    await seedUser('saurabh', 'doctor');

    const admin = testEnv.authenticatedContext('admin').firestore();
    const saurabh = testEnv.authenticatedContext('saurabh').firestore();

    await assertSucceeds(setDoc(doc(admin, 'medicineCodes/B1'), {
      code: 'B1',
      remedyName: 'Belladonna',
      active: true,
    }));

    await assertSucceeds(getDoc(doc(saurabh, 'medicineCodes/B1')));

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
