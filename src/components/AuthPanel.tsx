import {useState, type FormEvent} from 'react';
import {sendPasswordResetEmail, signInWithEmailAndPassword, type Auth} from 'firebase/auth';
import type {Firestore} from 'firebase/firestore';
import {submitDoctorRegistration} from '../services/registrationService';
import type {LoginRole} from '../services/accessService';

interface AuthPanelProps {
  auth:Auth;
  db:Firestore;
  onBeginSignIn:(role:LoginRole)=>void;
}
function friendlyAuthMessage(error:unknown) {
  const code=(error as {code?:string})?.code;
  if(code==='auth/email-already-in-use')return 'This email already has an account. Please sign in.';
  if(code==='auth/weak-password')return 'Please use a stronger password.';
  if(code==='auth/operation-not-allowed')return 'Email and password sign-up is not enabled for this clinic.';
  if(code==='auth/too-many-requests')return 'Too many requests. Please try again later.';
  return 'Unable to complete your request. Please check your details and try again.';
}
export function AuthPanel({auth,db,onBeginSignIn}:AuthPanelProps) {
  const [role,setRole]=useState<LoginRole>('doctor');
  const [register,setRegister]=useState(false);
  const [fullName,setFullName]=useState('');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [confirmation,setConfirmation]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [working,setWorking]=useState(false);

  function selectRole(next:LoginRole) {
    if(working)return;
    setRole(next);setRegister(false);setError('');setNotice('');setPassword('');setConfirmation('');
  }
  function selectMode(value:boolean) {
    if(working)return;
    setRegister(value);setError('');setNotice('');setPassword('');setConfirmation('');
  }
  async function submit(event:FormEvent) {
    event.preventDefault();
    setError('');setNotice('');
    if(register && password!==confirmation) {setError('The passwords do not match.');return;}
    setWorking(true);
    onBeginSignIn(register?'doctor':role);
    try {
      if(register) {
        await submitDoctorRegistration(auth,db,{fullName,email,password});
      }else{
        await signInWithEmailAndPassword(auth,email.trim(),password);
      }
    }catch(e){setError(friendlyAuthMessage(e));}
    finally{setWorking(false);}
  }
  async function resetPassword() {
    setError('');setNotice('');
    if(!email.trim()){setError('Enter your email address first.');return;}
    try{await sendPasswordResetEmail(auth,email.trim());}catch{/* do not expose registration state */}
    setNotice('If the address has an account, password reset instructions have been sent.');
  }

  return <main className="auth-shell auth-simple">
    <section className="auth-story auth-brand" aria-label="Patient Case Manager">
      <div className="brand-lockup">
        <div className="brand-mark">PCM</div>
        <div><strong>Patient Case Manager</strong><span>Clinic Management</span></div>
      </div>
    </section>
    <section className="auth-card glass-panel" aria-label="Account access">
      <div className="auth-card-header">
        <div><h1>{register?'Doctor registration':role==='admin'?'Admin login':'Doctor login'}</h1></div>
      </div>
      {!register?<div className="auth-role-switch" role="group" aria-label="Account type">
        <button type="button" aria-pressed={role==='admin'} className={role==='admin'?'selected':''}
          disabled={working} onClick={()=>selectRole('admin')}>Admin</button>
        <button type="button" aria-pressed={role==='doctor'} className={role==='doctor'?'selected':''}
          disabled={working} onClick={()=>selectRole('doctor')}>Doctor</button>
      </div>:null}
      <form className="stack-form" onSubmit={submit}>
        {register?<label>Full name
          <input required autoComplete="name" minLength={2} maxLength={120}
            value={fullName} onChange={e=>setFullName(e.target.value)}
            placeholder="Full name"/>
        </label>:null}
        <label>Email
          <input type="email" inputMode="email" autoCapitalize="none" autoComplete="username"
            required value={email} onChange={e=>setEmail(e.target.value)} placeholder="name@clinic.com"/>
        </label>
        <label>Password
          <div className="password-field">
            <input type={showPassword?'text':'password'} required
              minLength={register?12:6} autoComplete={register?'new-password':'current-password'}
              value={password} onChange={e=>setPassword(e.target.value)}
              placeholder={register?'At least 12 characters':'Enter password'}/>
            <button type="button" className="password-toggle"
              onClick={()=>setShowPassword(x=>!x)} aria-label={showPassword?'Hide password':'Show password'}>
              {showPassword?'Hide':'Show'}</button>
          </div>
        </label>
        {register?<label>Confirm password
          <input required type={showPassword?'text':'password'} minLength={12}
            autoComplete="new-password" value={confirmation}
            onChange={e=>setConfirmation(e.target.value)} placeholder="Confirm password"/>
        </label>:null}
        {error?<div className="inline-error" role="alert">{error}</div>:null}
        {notice?<div className="inline-notice" role="status">{notice}</div>:null}
        <button className="button primary auth-submit" type="submit" disabled={working}>
          {working?'Processing…':register?'Register as Doctor':role==='admin'?'Sign in as Admin':'Sign in as Doctor'}
        </button>
      </form>
      {!register?<button className="button text auth-reset" type="button" onClick={resetPassword}>
        Forgot password?
      </button>:<p className="auth-registration-note">
        Registration is submitted for administrator approval. You will need to verify your email before accessing patient records.
      </p>}
      <div className="auth-bottom-action">
        {register?
          <button className="button text" type="button" onClick={()=>selectMode(false)}>Back to login</button>:
          role==='doctor'?<button className="button text" type="button" onClick={()=>selectMode(true)}>
            Register as a doctor
          </button>:null}
      </div>
    </section>
  </main>;
}
