import { useState, type ReactNode } from 'react';
import { canUseFeature, type AccountState } from './accountState';
import { useAuth } from './AuthProvider';
import { SignInLockPrompt } from './SignInLockPrompt';

/** The prompt heading for a locked transact action. Guests get the
 * honest carry-over sell — signing in keeps the account (and every
 * credit, item and streak day on it); other not-yet-verified states
 * get the plain form. */
export function lockHeading(account: AccountState | null, action: string): string {
  return account?.accountType === 'guest'
    ? `Sign in to ${action} — your guest progress carries over`
    : `Sign in to ${action}`;
}

export interface EconomyTransactLock {
  /** True when this session may VIEW but not transact. */
  locked: boolean;
  /** Run `fn` for unlocked sessions; raise the sign-in prompt for
   * locked ones. `action` is a short verb phrase ('buy',
   * 'post a repair job') used verbatim in the prompt heading. */
  guardTransact: (action: string, fn: () => void) => void;
  /** The prompt element to render (null until a locked tap). */
  prompt: ReactNode;
}

/**
 * The guest-visibility law (2026-11-01) as a hook: views render for
 * every session; the lock lives on the transact actions. `locked`
 * mirrors the FeatureGate 'market' decision (player-economy
 * access). Render `prompt` somewhere stable in the surface (above
 * the list the action belongs to) so the guest sees WHY nothing
 * happened after a tap.
 */
export function useEconomyTransactLock(): EconomyTransactLock {
  const { account } = useAuth();
  const [lockAction, setLockAction] = useState<string | null>(null);
  const decision = canUseFeature(account, 'market');
  const locked = !decision.allowed;
  return {
    locked,
    guardTransact(action: string, fn: () => void) {
      if (locked) {
        setLockAction(action);
        return;
      }
      fn();
    },
    prompt: lockAction
      ? (
        <SignInLockPrompt
          heading={lockHeading(account, lockAction)}
          reason={account?.accountType === 'guest' ? undefined : decision.reason}
          onDismiss={() => setLockAction(null)}
        />
      )
      : null,
  };
}
