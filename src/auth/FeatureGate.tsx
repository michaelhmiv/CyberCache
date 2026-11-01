import React from 'react';
import { canUseFeature, type GatedFeature } from './accountState';
import { useAuth } from './AuthProvider';
import { SignInLockPrompt } from './SignInLockPrompt';

/**
 * Full-surface gate — retained for surfaces with no read-only value
 * when locked. Under the guest-visibility law (2026-11-01) the market
 * and the leaderboards no longer use it: guests see real data there
 * and the lock sits on the transact actions instead
 * (SignInLockPrompt / useEconomyTransactLock).
 */
export function FeatureGate({ feature, children }: { feature: GatedFeature; children: React.ReactNode }) {
  const { account } = useAuth();
  const decision = canUseFeature(account, feature);

  if (decision.allowed) return <>{children}</>;

  return (
    <div className="p-4 pb-20">
      <SignInLockPrompt
        heading="Account upgrade needed"
        reason={decision.reason ?? 'Update your account to continue.'}
      />
    </div>
  );
}
