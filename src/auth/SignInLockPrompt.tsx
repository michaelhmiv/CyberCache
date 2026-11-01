import React from 'react';
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
      {isGuestAccount(account) && (
        <button
          onClick={() => signInWithGoogle()}
          disabled={actionLoading}
          className="w-full py-2.5 rounded-xl bg-amber text-bg font-black text-xs border-2 border-amber disabled:opacity-50"
        >
          Sign in with Google — keep your progress
        </button>
      )}
    </div>
  );
}
