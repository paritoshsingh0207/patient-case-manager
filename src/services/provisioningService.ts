import { deleteApp, getApp, initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword, deleteUser, getAuth, inMemoryPersistence,
  sendPasswordResetEmail, setPersistence, signOut,
} from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { registerAdminProfile } from './adminService';

export async function inviteAdministrator(db:Firestore,input:{name:string;email:string;adminUid:string}):Promise<void> {
  const name=input.name.trim(), email=input.email.trim().toLowerCase();
  if(name.length<2||name.length>120)throw Error('Enter a name between 2 and 120 characters.');
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>254)throw Error('Enter a valid email.');
  const secret=Array.from(crypto.getRandomValues(new Uint8Array(48)),n=>n.toString(16).padStart(2,'0')).join('');
  const secondary=initializeApp(getApp().options,'admin-provision-'+Date.now());
  const secondAuth=getAuth(secondary);
  let newUser:Awaited<ReturnType<typeof createUserWithEmailAndPassword>>['user']|null=null;
  let saved=false;
  try {
    await setPersistence(secondAuth,inMemoryPersistence);
    const account=await createUserWithEmailAndPassword(secondAuth,email,secret);
    newUser=account.user;
    await sendPasswordResetEmail(secondAuth,email);
    await registerAdminProfile(db,{uid:newUser.uid,displayName:name,email,adminUid:input.adminUid});
    saved=true;
  }catch(error){
    if(newUser&&!saved)try{await deleteUser(newUser);}catch{/* Orphan user may need Auth Console cleanup. */}
    throw error;
  }finally{
    try{await signOut(secondAuth);}catch{/* Best effort */}
    await deleteApp(secondary);
  }
}
