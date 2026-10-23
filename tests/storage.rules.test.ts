import fs from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getMetadata, listAll, ref, uploadBytes } from 'firebase/storage';

let env: RulesTestEnvironment;
const bucket = 'gs://demo-patient-case-manager.firebasestorage.app';
const filePath = 'patientFiles/patient-a/attachmentABC123456789';
const pdf = new Uint8Array([37,80,68,70,45,49,46,52]);
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId:'demo-patient-case-manager',
    firestore:{host:'127.0.0.1',port:8080,rules:fs.readFileSync('firestore.rules','utf8')},
    storage:{host:'127.0.0.1',port:9199,rules:fs.readFileSync('storage.rules','utf8')},
  });
});
beforeEach(async () => {
  await env.clearStorage();await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx => {
    for(const [uid,role,active] of [
      ['doctor-a','doctor',true],['doctor-b','doctor',true],
      ['administrator','admin',true],['inactive','doctor',false],
    ] as const) await setDoc(doc(ctx.firestore(),'users',uid),{role,active});
    await setDoc(doc(ctx.firestore(),'patients/patient-a'),{
      firstName:'Synthetic',lastName:'Patient',doctorIds:['doctor-a'],createdBy:'administrator',
    });
  });
});
afterAll(async () => {await env?.cleanup();});
const objectFor = (uid:string, at=filePath) => ref(env.authenticatedContext(uid).storage(bucket),at);
const uploadAs = (uid:string, type='application/pdf',at=filePath) =>
  uploadBytes(objectFor(uid,at),pdf,{contentType:type,customMetadata:{createdBy:uid,patientId:'patient-a'}});
describe('private clinical Storage',()=>{
  it('allows assigned doctor upload and authorized admin read, not unassigned read',async()=>{
    await assertSucceeds(uploadAs('doctor-a'));
    await assertSucceeds(getMetadata(objectFor('doctor-a')));
    await assertSucceeds(getMetadata(objectFor('administrator')));
    await assertFails(getMetadata(objectFor('doctor-b')));
    await assertFails(getMetadata(ref(env.unauthenticatedContext().storage(bucket),filePath)));
  });
  it('rejects unauthorized uploads and bad types',async()=>{
    await assertFails(uploadAs('doctor-b'));
    await assertFails(uploadAs('inactive'));
    await assertFails(uploadAs('doctor-a','image/svg+xml'));
    await assertFails(uploadAs('doctor-a','application/pdf','public/attachmentABC123456789'));
  });
  it('revokes file reads after doctor removal',async()=>{
    await assertSucceeds(uploadAs('doctor-a'));
    await env.withSecurityRulesDisabled(async ctx=>{
      await updateDoc(doc(ctx.firestore(),'patients/patient-a'),{doctorIds:[]});
    });
    await assertFails(getMetadata(objectFor('doctor-a')));
    await assertSucceeds(getMetadata(objectFor('administrator')));
  });
  it('rejects overwrite, delete and list operations',async()=>{
    await assertSucceeds(uploadAs('doctor-a'));
    await assertFails(uploadAs('doctor-a'));
    await assertFails(deleteObject(objectFor('doctor-a')));
    await assertFails(listAll(ref(env.authenticatedContext('doctor-a').storage(bucket),'patientFiles/patient-a')));
  });
});
