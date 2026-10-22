import {getApps, initializeApp, type FirebaseApp} from 'firebase/app';
import {
  createUserWithEmailAndPassword, getAuth, inMemoryPersistence,
  sendEmailVerification, setPersistence, signOut, updateProfile,
} from 'firebase/auth';
import type {Firestore} from 'firebase/firestore';
import {addAdministratorProfile} from './adminService';

/** Create another Firebase Auth account without signing the current admin out. */
export async function createAdministratorAccount(primary:FirebaseApp,db:Firestore,input:{
  fullName:string;email:string;temporaryPassword:string;adminUid:string;
}):Promise<{uid:string;email:string;verificationSent:boolean}> {
  if(input.temporaryPassword.length<12)throw Error('Use a temporary password of at least 12 characters.');
  const name=input.fullName.trim(), email=input.email.trim().toLowerCase();
  if(name.length<2||name.length>120)throw Error('Enter the new administrator name.');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))throw Error('Enter a valid email.');
  const named='admin-account-provisioner';
  const secondaryApp=getApps().find(x=>x.name===named)??initializeApp(primary.options,named);
  const secondaryAuth=getAuth(secondaryApp);
  await setPersistence(secondaryAuth,inMemoryPersistence);
  let uid:string|undefined;
  try {
    const credential=await createUserWithEmailAndPassword(secondaryAuth,email,input.temporaryPassword);
    uid=credential.user.uid;
    await updateProfile(credential.user,{displayName:name});
    await addAdministratorProfile(db,{uid,displayName:name,email,adminUid:input.adminUid});
    let verificationSent=false;
    try {await sendEmailVerification(credential.user);verificationSent=true;}catch{/* Can resend on first login. */}
    return {uid,email,verificationSent};
  }catch(e){
    if(uid)throw Error('Auth account was created (UID: '+uid+'), but role setup was incomplete: '+(e instanceof Error?e.message:'Unknown error')+'. Contact an administrator before retrying.');
    throw e;
  }finally{
    await signOut(secondaryAuth).catch(()=>{});
  }
}
