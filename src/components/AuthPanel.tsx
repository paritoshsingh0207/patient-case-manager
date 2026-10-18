import { useState, type FormEvent } from 'react';
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  type Auth,
} from 'firebase/auth';

interface AuthPanelProps {
  auth: Auth;
}

function friendlyAuthMessage() {
  return 'Unable to sign in. Check your credentials or contact the practice administrator.';
}

export function AuthPanel({ auth }: AuthPanelProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [working, setWorking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setNotice('');
    setWorking(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch {
      setError(friendlyAuthMessage());
    } finally {
      setWorking(false);
    }
  }

  async function resetPassword() {
    setError('');
    setNotice('');

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setError('Enter your authorized email address first.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, normalizedEmail);
      setNotice('If this address belongs to an authorized account, password reset instructions have been sent.');
    } catch {
      setNotice('If this address belongs to an authorized account, password reset instructions have been sent.');
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-orb auth-orb-one" aria-hidden="true" />
      <div className="auth-orb auth-orb-two" aria-hidden="true" />
      <div className="auth-grid" aria-hidden="true" />

      <section className="auth-story" aria-labelledby="login-title">
        <div className="brand-lockup">
          <div className="brand-mark">PCM</div>
          <div>
            <strong>Patient Case Manager</strong>
            <span>Private practitioner workspace</span>
          </div>
        </div>

        <div className="auth-copy">
          <p className="eyebrow">Restricted clinical workspace</p>
          <h1 id="login-title">Focused case management. Protected by design.</h1>
          <p className="lede">
            A clean workspace for designated practitioners to manage patient histories,
            consultations, follow-ups, and decision-support review.
          </p>
        </div>

        <div className="trust-row">
          <span><i>✓</i> Approved users only</span>
          <span><i>✓</i> Owner-scoped records</span>
          <span><i>✓</i> Auditable case history</span>
        </div>

        <p className="auth-footnote">
          Access is limited to accounts provisioned by the practice administrator.
        </p>
      </section>

      <section className="auth-card glass-panel" aria-label="Practitioner sign in">
        <div className="auth-card-header">
          <div className="lock-badge" aria-hidden="true">⌁</div>
          <div>
            <p className="eyebrow">Secure access</p>
            <h2>Practitioner sign in</h2>
          </div>
        </div>

        <p className="auth-helper">Use the email address assigned by your practice administrator.</p>

        <form onSubmit={submit} className="stack-form">
          <label>
            Email address
            <input
              type="email"
              required
              inputMode="email"
              autoCapitalize="none"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@practice.com"
            />
          </label>

          <label>
            Password
            <div className="password-field">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>

          {error ? <div className="inline-error" role="alert">{error}</div> : null}
          {notice ? <div className="inline-notice" role="status">{notice}</div> : null}

          <button className="button primary auth-submit" disabled={working} type="submit">
            {working ? 'Signing in…' : 'Sign in securely'}
          </button>
        </form>

        <button className="button text auth-reset" type="button" onClick={resetPassword}>
          Forgot password?
        </button>

        <div className="restricted-note">
          <span aria-hidden="true">◆</span>
          <p><strong>No public registration.</strong> New practitioner accounts are created by an administrator.</p>
        </div>
      </section>
    </main>
  );
}
