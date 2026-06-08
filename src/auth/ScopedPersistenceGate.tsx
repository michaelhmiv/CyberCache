import React, { useEffect, useState } from 'react';
import { switchAccountStorageScope } from '../store/sessionPersistence';
import { useAuth } from './AuthProvider';

export function ScopedPersistenceGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [readyScope, setReadyScope] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const userId = user?.id ?? null;
    setReadyScope(null);

    switchAccountStorageScope(userId)
      .then(() => {
        if (!cancelled) setReadyScope(userId ?? 'anonymous');
      })
      .catch(() => {
        if (!cancelled) setReadyScope(userId ?? 'anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (loading || readyScope === null) {
    return (
      <div className="h-full flex items-center justify-center bg-bg text-text-primary p-4">
        <div className="text-center space-y-2">
          <div className="bl-title text-3xl text-amber">CyberCache</div>
          <div className="text-xs text-text-muted">Loading account data…</div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
