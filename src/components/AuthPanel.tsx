import { useState, type FormEvent } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';

interface AuthPanelProps {
  auth: Auth;
}

export function AuthPanel({ auth }: AuthPanelProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'register'>('signin');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setWorking(true);
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : 'Authentication failed.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-story">
        <div className="brand-mark">PCM</div>
        <p className="eyebrow">Clinical workspace</p>
        <h1>Patient cases, follow-ups, and remedy review in one secure workspace.</h1>
        <p className="lede">
          Built for practitioner-led case taking. Remedy suggestions are transparent, auditable, and kept separate from the clinician's final decision.
        </p>
        <div className="auth-points">
          <span>Structured case taking</span>
          <span>Patient-scoped records</span>
          <span>Firebase security rules</span>
        </div>
      </section>

      <section className="auth-card">
        <p className="eyebrow">{mode === 'signin' ? 'Welcome back' : 'Create account'}</p>
        <h2>{mode === 'signin' ? 'Sign in to your practice' : 'Set up your practitioner login'}</h2>
        <form onSubmit={submit} className="stack-form">
          <label>
            Email
            <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>
          {error ? <div className="inline-error">{error}</div> : null}
          <button className="button primary" disabled={working} type="submit">
            {working ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <button className="button text" type="button" onClick={() => setMode(mode === 'signin' ? 'register' : 'signin')}>
          {mode === 'signin' ? 'Need an account? Register' : 'Already registered? Sign in'}
        </button>
      </section>
    </div>
  );
}
