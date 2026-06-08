import React, { useEffect, useState } from 'react';
import { switchAccountStorageScope } from '../store/sessionPersistence';
import { useAuth } from './AuthProvider';

export function AccountStorageBoundary({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [readyScope, setReadyScope] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const userId = user?.id ?? null;

    // Reset to loading while storage migration runs — necessary gate
    // to prevent rendering stale scoped data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReadyScope(null);

    // Storage scope migration is async; setState after await is safe here
    // because the effect cleans up via the cancelled flag on unmount.
    async function run() {
      try {
        await switchAccountStorageScope(userId);
      } catch {
        // Storage scope switching is best-effort; don't block the app.
      }
      if (!cancelled) setReadyScope(userId ?? 'anonymous');
    }
    run();

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
