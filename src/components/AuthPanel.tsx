import { useState, type FormEvent } from 'react';
import { sendPasswordResetEmail, signInWithEmailAndPassword, type Auth } from 'firebase/auth';
import type { LoginRole } from '../services/accessService';

interface AuthPanelProps {
  auth: Auth;
  onBeginSignIn: (role: LoginRole) => void;
}
function friendlyAuthMessage() {
  return 'Unable to sign in. Check your credentials or contact the practice administrator.';
}
export function AuthPanel({auth,onBeginSignIn}:AuthPanelProps) {
  const [role,setRole]=useState<LoginRole>('doctor');
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
  async function resetPassword() {
    setError('');setNotice('');
    if(!email.trim()) {setError('Enter your authorized email address first.');return;}
    try {await sendPasswordResetEmail(auth,email.trim());}catch{/* Don't disclose registration state. */}
    setNotice('If this address belongs to an authorized account, password reset instructions have been sent.');
  }
  function chooseRole(next:LoginRole) {
    if(working)return;setRole(next);setError('');setNotice('');setPassword('');
  }
  return <main className="auth-shell">
    <section className="auth-story" aria-labelledby="login-title">
      <div className="brand-lockup"><div className="brand-mark">PCM</div><div>
        <strong>Patient Case Manager</strong><span>Private clinical workspace</span>
      </div></div>
      <div className="auth-copy"><p className="eyebrow">SECURE CLINIC ACCESS</p>
        <h1 id="login-title">One clinic. Two dedicated workspaces.</h1>
        <p className="lede">Administrators coordinate doctor access and patient assignments.
        Doctors manage consultations and prescriptions for their own patients.</p>
      </div>
      <div className="trust-row"><span><i>✓</i> Individual accounts</span>
        <span><i>✓</i> Verified Firebase roles</span><span><i>✓</i> Assigned patient access</span></div>
      <p className="auth-footnote">Only authorized accounts can sign in. There is no public registration.</p>
    </section>
    <section className="auth-card glass-panel" aria-label="Clinic sign in">
      <div className="auth-card-header"><div className="lock-badge" aria-hidden="true">⌁</div>
        <div><p className="eyebrow">CHOOSE YOUR WORKSPACE</p>
          <h2>{role==='admin'?'Administrator sign in':'Doctor sign in'}</h2></div>
      </div>
      <div className="auth-role-switch" role="group" aria-label="Login as">
        <button type="button" className={role==='admin'?'selected':''} aria-pressed={role==='admin'}
          disabled={working} onClick={()=>chooseRole('admin')}>Admin Login</button>
        <button type="button" className={role==='doctor'?'selected':''} aria-pressed={role==='doctor'}
          disabled={working} onClick={()=>chooseRole('doctor')}>Doctor Login</button>
      </div>
      <p className="auth-helper">{role==='admin'
        ? 'Manage doctor accounts and patient access.'
        : 'Access assigned patients, consultations and prescriptions.'}</p>
      <form onSubmit={submit} className="stack-form">
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
          {working?'Signing in…':role==='admin'?'Sign in as Admin':'Sign in as Doctor'}</button>
      </form>
      <button className="button text auth-reset" type="button" onClick={resetPassword}>Forgot password?</button>
      <div className="restricted-note"><span aria-hidden="true">◆</span><p>
        <strong>Verified access.</strong> Choosing a tab does not grant permissions.
        The clinic checks your actual role after Firebase sign-in.</p></div>
    </section>
  </main>;
}
