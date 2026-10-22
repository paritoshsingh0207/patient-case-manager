import {
  createUserWithEmailAndPassword, sendEmailVerification, updateProfile,
  type Auth, type User,
} from 'firebase/auth';
import {doc, setDoc, serverTimestamp, type Firestore} from 'firebase/firestore';

/** Creates only a pending doctor profile. Firestore rules forbid self-approval. */
export async function submitDoctorRegistration(auth:Auth,db:Firestore,input:{
  email:string; password:string; fullName:string;
}) {
  const email=input.email.trim().toLowerCase(), name=input.fullName.trim();
  if(name.length<2||name.length>120)throw Error('Enter a name between 2 and 120 characters.');
  if(input.password.length<12)throw Error('Please use a password of at least 12 characters.');
  const credential=await createUserWithEmailAndPassword(auth,email,input.password);
  await updateProfile(credential.user,{displayName:name});
  await createPendingDoctorProfile(db,credential.user,name);
  // Email verification is a requirement for new accounts to access clinical data.
  try { await sendEmailVerification(credential.user); }
  catch { /* The pending account can request another verification email on sign-in. */ }
}

export async function createPendingDoctorProfile(db:Firestore,user:User,name:string) {
  const displayName=name.trim();
  if(!user.email||displayName.length<2||displayName.length>120)throw Error('Enter your full name.');
  await setDoc(doc(db,'users',user.uid),{
    active:false,role:'doctor',email:user.email,displayName,
    emailVerificationRequired:true,
    createdBy:user.uid,statusUpdatedBy:user.uid,
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
  });
}
