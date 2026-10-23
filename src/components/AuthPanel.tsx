import { useState, type FormEvent } from 'react';
import { createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, type Auth } from 'firebase/auth';
import type { LoginRole } from '../services/accessService';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface AuthPanelProps {
  auth: Auth;
  onBeginSignIn: (role: LoginRole) => void;
}
function friendlyAuthMessage() {
  return 'Unable to sign in. Check your credentials or contact the practice administrator.';
}
export function AuthPanel({auth,onBeginSignIn}:AuthPanelProps) {
  const [role,setRole]=useState<LoginRole>('doctor');
  const [register,setRegister]=useState(false);
  const [fullName,setFullName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [working,setWorking]=useState(false);
  const [showPassword,setShowPassword]=useState(false);
  async function submit(event:FormEvent) {
    event.preventDefault();setError('');setNotice('');setWorking(true);
    onBeginSignIn(role);
    try { await signInWithEmailAndPassword(auth,email.trim(),password); }
    catch { setError(friendlyAuthMessage()); }
    finally {setWorking(false);}
  }
  async function registerDoctor(event:FormEvent) {
    event.preventDefault();setError('');setNotice('');setWorking(true);
    try {
      if(!db)throw Error('Database unavailable.');
      if(fullName.trim().length<2||fullName.trim().length>120)throw Error('Enter your full name.');
      const result=await createUserWithEmailAndPassword(auth,email.trim(),password);
      try {
        await setDoc(doc(db,'users',result.user.uid),{role:'doctor',active:false,
          displayName:fullName.trim(),email:result.user.email,createdAt:serverTimestamp()});
      }catch{setError('Login created, but approval request could not be saved. Contact the administrator.');return;}
      try{await sendEmailVerification(result.user);}catch{/* Non-blocking verification email. */}
      onBeginSignIn('doctor');
    }catch(e){setError(e instanceof Error&&e.message==='Enter your full name.'?e.message:'Registration failed. Check your details or try signing in.');}
    finally{setWorking(false);}
  }
  async function resetPassword() {
    setError('');setNotice('');
    if(!email.trim()) {setError('Enter your authorized email address first.');return;}
    try {await sendPasswordResetEmail(auth,email.trim());}catch{/* Don't disclose registration state. */}
    setNotice('If this address belongs to an authorized account, password reset instructions have been sent.');
  }
  function chooseRole(next:LoginRole) {
    if(working)return;setRole(next);setRegister(false);setError('');setNotice('');setPassword('');
  }
  return <main className="auth-shell">
    <section className="auth-card glass-panel" aria-label="Clinic sign in">
      <div className="auth-card-header"><div className="lock-badge" aria-hidden="true">⌁</div>
        <div><h2>{register?'Doctor registration':role==='admin'?'Administrator sign in':'Doctor sign in'}</h2></div>
      </div>
      <div className="auth-role-switch" role="group" aria-label="Login as">
        <button type="button" className={role==='admin'?'selected':''} aria-pressed={role==='admin'}
          disabled={working} onClick={()=>chooseRole('admin')}>Admin Login</button>
        <button type="button" className={role==='doctor'?'selected':''} aria-pressed={role==='doctor'}
          disabled={working} onClick={()=>chooseRole('doctor')}>Doctor Login</button>
      </div>
      <form onSubmit={register?registerDoctor:submit} className="stack-form">
        {register?<label>Full name<input required minLength={2} maxLength={120} autoComplete="name"
          value={fullName} onChange={e=>setFullName(e.target.value)}/></label>:null}
        <label>{role==='admin'?'Admin email address':'Doctor email address'}
          <input type="email" required inputMode="email" autoCapitalize="none" autoComplete="username"
            value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@clinic.com"/>
        </label>
        <label>Password
          <div className="password-field">
            <input type={showPassword?'text':'password'} required minLength={6}
              value={password} onChange={e=>setPassword(e.target.value)}
              autoComplete="current-password" placeholder="Enter your password"/>
            <button type="button" className="password-toggle"
              onClick={()=>setShowPassword(x=>!x)} aria-label={showPassword?'Hide password':'Show password'}>
              {showPassword?'Hide':'Show'}</button>
          </div>
        </label>
        {error?<div className="inline-error" role="alert">{error}</div>:null}
        {notice?<div className="inline-notice" role="status">{notice}</div>:null}
        <button className="button primary auth-submit" disabled={working} type="submit">
          {working?'Processing…':register?'Register for approval':role==='admin'?'Sign in as Admin':'Sign in as Doctor'}</button>
      </form>
      {!register?<button className="button text auth-reset" type="button" onClick={resetPassword}>Forgot password?</button>:null}
      {role==='doctor'?<button className="button text auth-reset" type="button" disabled={working}
        onClick={()=>{setRegister(x=>!x);setError('');setNotice('');setPassword('');}}>
        {register?'Back to Doctor Login':'Register as a doctor'}</button>:null}
    </section>
  </main>;
}
