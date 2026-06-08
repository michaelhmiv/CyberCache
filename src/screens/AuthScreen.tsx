import React, { FormEvent, useState } from 'react';
import { motion } from 'framer-motion';
import { LogIn, Mail, UserPlus, Zap } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import type { AuthMode } from '../auth/authTypes';

function modeTitle(mode: AuthMode): string {
  if (mode === 'login') return 'Login';
  if (mode === 'register') return 'Create Account';
  if (mode === 'forgot_password') return 'Recover Account';
  if (mode === 'reset_password') return 'Set New Password';
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

  return (
    <div className="min-h-full bg-bg text-text-primary flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-surface border-2 border-border rounded-2xl p-5 shadow-xl space-y-4"
      >
        <div className="text-center space-y-2">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-amber text-bg flex items-center justify-center border-2 border-border shadow-lg">
            <Zap size={28} />
          </div>
          <div className="bl-title text-3xl leading-none text-amber">CyberCache</div>
          <div className="text-xs text-text-muted leading-relaxed">
            Jump in as a guest, then verify an account later to unlock trading, shops, and player services.
          </div>
        </div>

        {auth.authMode === 'guest' && (
          <div className="space-y-3">
            <button
              onClick={handleGuest}
              disabled={auth.actionLoading}
              className="w-full py-3 rounded-xl bg-amber text-bg font-black text-sm border-2 border-amber disabled:opacity-50"
            >
              Continue as Guest
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode('register')} className="py-2.5 rounded-xl bg-surface-raised border border-border text-xs font-bold text-text-primary flex items-center justify-center gap-2">
                <UserPlus size={14} /> Create
              </button>
              <button onClick={() => setMode('login')} className="py-2.5 rounded-xl bg-surface-raised border border-border text-xs font-bold text-text-primary flex items-center justify-center gap-2">
                <LogIn size={14} /> Login
              </button>
            </div>
          </div>
        )}

        {auth.authMode !== 'guest' && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <div className="text-sm font-black text-text-primary">{modeTitle(auth.authMode)}</div>
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
                placeholder="Username"
                className="w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
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
                  className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
                />
              </div>
            )}

            {auth.authMode !== 'forgot_password' && (
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder={auth.authMode === 'reset_password' ? 'New password' : 'Password'}
                type="password"
                className="w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
              />
            )}

            {(auth.authMode === 'register' || auth.authMode === 'reset_password') && (
              <input
                value={confirmSecret}
                onChange={(event) => setConfirmSecret(event.target.value)}
                placeholder="Confirm password"
                type="password"
                className="w-full bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted"
              />
            )}

            {(message || auth.authMessage) && (
              <div className={`text-xs rounded-xl border px-3 py-2 ${message ? 'border-red-500/50 text-red-300 bg-red-950/20' : 'border-green-500/50 text-green-300 bg-green-950/20'}`}>
                {message ?? auth.authMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={auth.actionLoading}
              className="w-full py-3 rounded-xl bg-amber text-bg font-black text-sm border-2 border-amber disabled:opacity-50"
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
