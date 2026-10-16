import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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

describe('Firestore security rules', () => {
  it('allows a signed-in practitioner to create and read their own patient', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    const patient = doc(alice, 'patients/p1');

    await assertSucceeds(setDoc(patient, { ownerId: 'alice', firstName: 'A', lastName: 'Patient' }));
    await assertSucceeds(getDoc(patient));
  });

  it('prevents another practitioner from reading the patient', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'patients/p1'), { ownerId: 'alice', firstName: 'A', lastName: 'Patient' });
    });

    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(bob, 'patients/p1')));
  });

  it('prevents anonymous patient access', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'patients/p1'), { ownerId: 'alice', firstName: 'A', lastName: 'Patient' });
    });

    const anonymous = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonymous, 'patients/p1')));
  });

  it('allows only the patient owner to create case records', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'patients/p1'), { ownerId: 'alice', firstName: 'A', lastName: 'Patient' });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();

    await assertSucceeds(setDoc(doc(alice, 'patients/p1/cases/c1'), {
      ownerId: 'alice', patientId: 'p1', chiefComplaint: 'Example', consultationDate: '2026-10-05', status: 'draft',
    }));

    await assertFails(setDoc(doc(bob, 'patients/p1/cases/c2'), {
      ownerId: 'bob', patientId: 'p1', chiefComplaint: 'Attempted access', consultationDate: '2026-10-05', status: 'draft',
    }));
  });

  it('does not allow ownership transfer on patient update', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    const patient = doc(alice, 'patients/p1');
    await assertSucceeds(setDoc(patient, { ownerId: 'alice', firstName: 'A', lastName: 'Patient' }));
    await assertFails(setDoc(patient, { ownerId: 'bob', firstName: 'A', lastName: 'Patient' }));
  });
});
