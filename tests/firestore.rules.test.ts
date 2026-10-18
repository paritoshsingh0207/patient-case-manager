import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
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

async function seedAccess(
  uid: string,
  active = true,
  role: 'practitioner' | 'admin' | 'viewer' = 'practitioner',
) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), `users/${uid}`), {
      active,
      role,
      displayName: uid,
    });
  });
}

describe('Firestore security rules', () => {
  it('allows an approved practitioner to read their access profile and own patient', async () => {
    await seedAccess('alice');

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(alice, 'users/alice')));

    const patient = doc(alice, 'patients/p1');
    await assertSucceeds(setDoc(patient, {
      ownerId: 'alice',
      firstName: 'A',
      lastName: 'Patient',
    }));
    await assertSucceeds(getDoc(patient));
  });

  it('blocks a signed-in account that has not been provisioned', async () => {
    const unapproved = testEnv.authenticatedContext('unapproved').firestore();

    await assertFails(setDoc(doc(unapproved, 'patients/p1'), {
      ownerId: 'unapproved',
      firstName: 'No',
      lastName: 'Access',
    }));
  });

  it('blocks an inactive practitioner', async () => {
    await seedAccess('inactive', false);

    const inactive = testEnv.authenticatedContext('inactive').firestore();
    await assertFails(setDoc(doc(inactive, 'patients/p1'), {
      ownerId: 'inactive',
      firstName: 'Inactive',
      lastName: 'User',
    }));
  });

  it('prevents clients from granting themselves a role', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();

    await assertFails(setDoc(doc(alice, 'users/alice'), {
      active: true,
      role: 'admin',
    }));
  });

  it('prevents another approved practitioner from reading the patient', async () => {
    await seedAccess('alice');
    await seedAccess('bob');

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'patients/p1'), {
        ownerId: 'alice',
        firstName: 'A',
        lastName: 'Patient',
      });
    });

    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(bob, 'patients/p1')));
  });

  it('prevents anonymous patient access', async () => {
    await seedAccess('alice');

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'patients/p1'), {
        ownerId: 'alice',
        firstName: 'A',
        lastName: 'Patient',
      });
    });

    const anonymous = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anonymous, 'patients/p1')));
  });

  it('allows only the patient owner to create case records', async () => {
    await seedAccess('alice');
    await seedAccess('bob');

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'patients/p1'), {
        ownerId: 'alice',
        firstName: 'A',
        lastName: 'Patient',
      });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();

    await assertSucceeds(setDoc(doc(alice, 'patients/p1/cases/c1'), {
      ownerId: 'alice',
      patientId: 'p1',
      chiefComplaint: 'Example',
      consultationDate: '2026-10-18',
      status: 'draft',
    }));

    await assertFails(setDoc(doc(bob, 'patients/p1/cases/c2'), {
      ownerId: 'bob',
      patientId: 'p1',
      chiefComplaint: 'Attempted access',
      consultationDate: '2026-10-18',
      status: 'draft',
    }));
  });

  it('does not allow ownership transfer on patient update', async () => {
    await seedAccess('alice');

    const alice = testEnv.authenticatedContext('alice').firestore();
    const patient = doc(alice, 'patients/p1');

    await assertSucceeds(setDoc(patient, {
      ownerId: 'alice',
      firstName: 'A',
      lastName: 'Patient',
    }));

    await assertFails(setDoc(patient, {
      ownerId: 'bob',
      firstName: 'A',
      lastName: 'Patient',
    }));
  });
});
