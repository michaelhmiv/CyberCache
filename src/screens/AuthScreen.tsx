import React, { FormEvent, useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, Mail, UserPlus, Zap } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { validateUsername } from '../lib/validation/username';
import type { AuthMode } from '../auth/authTypes';

function modeTitle(mode: AuthMode): string {
  if (mode === 'login') return 'Load Hunter';
  if (mode === 'register') return 'Create Hunter';
  if (mode === 'forgot_password') return 'Recover Hunter';
  if (mode === 'reset_password') return 'Set New Secret';
  return 'Enter CyberCache';
}

export const AuthScreen: React.FC = () => {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [confirmSecret, setConfirmSecret] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const setMode = (mode: AuthMode) => {
    setLocalError(null);
    auth.clearAuthStatus();
    auth.setAuthMode(mode);
  };

  const requireEmail = () => {
    if (!email.trim()) {
      setLocalError('Email is required.');
      return false;
    }
    return true;
  };

  const requireSecret = () => {
    if (!secret) {
      setLocalError('Password is required.');
      return false;
    }
    return true;
  };

  const requireMatchingSecret = () => {
    if (!requireSecret()) return false;
    if (secret !== confirmSecret) {
      setLocalError('Passwords do not match.');
      return false;
    }
    return true;
  };

  const handleGuest = async () => {
    setLocalError(null);
    await auth.continueAsGuest();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);

    if (auth.authMode === 'login') {
      if (!requireEmail() || !requireSecret()) return;
      await auth.signInWithEmail(email.trim(), secret);
      return;
    }

    if (auth.authMode === 'register') {
      if (!username.trim()) {
        setLocalError('Username is required.');
        return;
      }
      const validation = validateUsername(username);
      if (!validation.ok) {
        setLocalError(validation.error ?? 'Invalid username.');
        return;
      }
      if (!requireEmail() || !requireMatchingSecret()) return;
      await auth.registerWithEmail(email.trim(), secret, username.trim());
      return;
    }

    if (auth.authMode === 'forgot_password') {
      if (!requireEmail()) return;
      await auth.sendPasswordReset(email.trim());
      return;
    }

    if (auth.authMode === 'reset_password') {
      if (!requireMatchingSecret()) return;
      await auth.updatePassword(secret);
    }
  };

  const message = localError ?? auth.authError;
  const diagnosticText = auth.authDiagnostic ? JSON.stringify(auth.authDiagnostic, null, 2) : null;

  return (
    <div className="bl-page flex min-h-full items-center justify-center p-4 text-text-primary">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="bl-card w-full max-w-sm space-y-4 p-5"
      >
        <div className="space-y-3 text-center">
          <div className="mx-auto flex h-16 w-16 -rotate-3 items-center justify-center border-[3px] border-border bg-amber text-bg shadow-[5px_5px_0_rgba(0,0,0,0.8)]">
            <Zap size={30} />
          </div>
          <div>
            <div className="bl-title text-4xl leading-none text-amber">CyberCache</div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-text-muted">Load Hunter File</div>
          </div>
          <div className="text-xs leading-relaxed text-text-muted">
            Jump in as a guest, then verify later to unlock the vendor yard, shops, and player services.
          </div>
        </div>

        {auth.authMode === 'guest' && (
          <div className="space-y-3">
            {(message || auth.authMessage) && (
              <div className={`bl-card px-3 py-2 text-xs ${message ? 'text-red' : 'text-green'}`}>
                {message ?? auth.authMessage}
              </div>
            )}
            {diagnosticText && (
              <details className="bl-card px-3 py-2 text-[10px] text-text-muted" open>
                <summary className="cursor-pointer font-black uppercase tracking-wide text-amber">Google debug packet</summary>
                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono leading-snug text-text-primary">
                  {diagnosticText}
                </pre>
              </details>
            )}
            <button
              onClick={handleGuest}
              disabled={auth.actionLoading}
              className="bl-primary w-full py-3 text-sm font-black uppercase tracking-wide disabled:opacity-50"
            >
              Continue as Guest
            </button>
            <button
              onClick={() => auth.signInWithGoogle()}
              disabled={auth.actionLoading}
              className="bl-secondary flex w-full items-center justify-center gap-2 py-3 text-sm font-bold disabled:opacity-50"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode('register')} className="bl-secondary flex items-center justify-center gap-2 py-2.5 text-xs font-bold">
                <UserPlus size={14} /> Create
              </button>
              <button onClick={() => setMode('login')} className="bl-secondary flex items-center justify-center gap-2 py-2.5 text-xs font-bold">
                <LogIn size={14} /> Login
              </button>
            </div>
          </div>
        )}

        {auth.authMode !== 'guest' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <div className="text-sm font-black uppercase tracking-wide text-text-primary">{modeTitle(auth.authMode)}</div>
              <div className="text-[11px] text-text-muted">
                {auth.authMode === 'reset_password'
                  ? 'Set a new password to finish account recovery.'
                  : 'Verified accounts unlock the player economy.'}
              </div>
            </div>

            {auth.authMode === 'register' && (
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Hunter name"
                className="bl-input w-full px-3 py-2 text-sm placeholder:text-text-muted"
              />
            )}

            {auth.authMode !== 'reset_password' && (
              <div className="relative">
                <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email"
                  type="email"
                  className="bl-input w-full py-2 pl-9 pr-3 text-sm placeholder:text-text-muted"
                />
              </div>
            )}

            {auth.authMode !== 'forgot_password' && (
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder={auth.authMode === 'reset_password' ? 'New password' : 'Password'}
                type="password"
                className="bl-input w-full px-3 py-2 text-sm placeholder:text-text-muted"
              />
            )}

            {(auth.authMode === 'register' || auth.authMode === 'reset_password') && (
              <input
                value={confirmSecret}
                onChange={(event) => setConfirmSecret(event.target.value)}
                placeholder="Confirm password"
                type="password"
                className="bl-input w-full px-3 py-2 text-sm placeholder:text-text-muted"
              />
            )}

            {(message || auth.authMessage) && (
              <div className={`bl-card px-3 py-2 text-xs ${message ? 'text-red' : 'text-green'}`}>
                {message ?? auth.authMessage}
              </div>
            )}
            {diagnosticText && (
              <details className="bl-card px-3 py-2 text-[10px] text-text-muted" open>
                <summary className="cursor-pointer font-black uppercase tracking-wide text-amber">Google debug packet</summary>
                <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono leading-snug text-text-primary">
                  {diagnosticText}
                </pre>
              </details>
            )}

            <button
              type="submit"
              disabled={auth.actionLoading}
              className="bl-primary w-full py-3 text-sm font-black uppercase tracking-wide disabled:opacity-50"
            >
              {auth.actionLoading ? 'Working…' : modeTitle(auth.authMode)}
            </button>

            <div className="flex items-center justify-between text-[11px] text-text-muted">
              <button type="button" onClick={() => setMode('guest')} className="hover:text-amber">Back</button>
              {auth.authMode === 'login' && <button type="button" onClick={() => setMode('forgot_password')} className="hover:text-amber">Forgot password?</button>}
              {auth.authMode !== 'login' && <button type="button" onClick={() => setMode('login')} className="hover:text-amber">Login</button>}
            </div>
          </form>
        )}
      </motion.div>
    </div>
  );
};
