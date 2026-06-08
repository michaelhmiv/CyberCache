import React from 'react';
import { canUseFeature, isGuestAccount, type GatedFeature } from './accountState';
import { useAuth } from './AuthProvider';

export function FeatureGate({ feature, children }: { feature: GatedFeature; children: React.ReactNode }) {
  const { account, setAuthMode } = useAuth();
  const decision = canUseFeature(account, feature);

  if (decision.allowed) return <>{children}</>;

  return (
    <div className="p-4 pb-20">
      <div className="rounded-2xl border-2 border-border bg-surface p-5 space-y-3 text-center">
        <div className="bl-title text-2xl text-amber">Locked</div>
        <div className="text-sm text-text-primary font-bold">Account upgrade needed</div>
        <div className="text-xs text-text-muted leading-relaxed">{decision.reason ?? 'Update your account to continue.'}</div>
        {isGuestAccount(account) && (
          <button onClick={() => setAuthMode('register')} className="w-full py-2.5 rounded-xl bg-amber text-bg font-black text-xs border-2 border-amber">
            Create Account
          </button>
        )}
      </div>
    </div>
  );
}
