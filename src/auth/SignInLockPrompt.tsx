import React from 'react';
import { Capacitor } from '@capacitor/core';
import { X } from 'lucide-react';
import { isGuestAccount } from './accountState';
import { useAuth } from './AuthProvider';

/**
 * The sign-in lock prompt (guest-visibility law, 2026-11-01): guests
 * SEE every screen — the lock lives on the transact ACTION, and this
 * panel is what a tap on a locked action produces. It is the panel
 * FeatureGate has always rendered for a fully gated surface, shared
 * now so an action-level lock presents identically: "Locked" title,
 * an honest heading, the reason when there is one, and — for guests —
 * the Google upgrade that keeps their progress (the in-place guest
 * link shipped in #201/#232: same account, nothing is lost).
 *
 * On the web the Google upgrade cannot run — sign-in exists only in
 * the app — so instead of a button that dead-ends in the app-only
 * refusal, the prompt says so plainly (QC B3/C2): sign-in happens in
 * the CyberCache app; the web build is a guest preview. The app's
 * prompt (and its working button) is unchanged.
 */
export function SignInLockPrompt({
  heading,
  reason,
  onDismiss,
}: {
  heading: string;
  reason?: string;
  onDismiss?: () => void;
}) {
  const { account, signInWithGoogle, actionLoading } = useAuth();
  const isNative = Capacitor.isNativePlatform();
  return (
    <div className="relative rounded-2xl border-2 border-border bg-surface p-5 space-y-3 text-center">
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss sign-in prompt"
          className="absolute right-2 top-2 text-text-muted hover:text-text-primary"
        >
          <X size={14} />
        </button>
      )}
      <div className="bl-title text-2xl text-amber">Locked</div>
      <div className="text-sm text-text-primary font-bold">{heading}</div>
      {reason && <div className="text-xs text-text-muted leading-relaxed">{reason}</div>}
      {isGuestAccount(account) &&
        (isNative ? (
          <button
            onClick={() => signInWithGoogle()}
            disabled={actionLoading}
            className="w-full py-2.5 rounded-xl bg-amber text-bg font-black text-xs border-2 border-amber disabled:opacity-50"
          >
            Sign in with Google — keep your progress
          </button>
        ) : (
          <div className="text-xs text-text-muted leading-relaxed" data-testid="signin-lock-web-note">
            Sign-in happens in the CyberCache app — open the app to sign in with Google and keep
            your progress. This web build is a guest preview: you can look everywhere, and trading
            unlocks in the app.
          </div>
        ))}
    </div>
  );
}
