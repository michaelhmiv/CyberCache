import React from 'react';
import { useAuth } from './AuthProvider';

export function AccountStorageBoundary({ children }: { children: React.ReactNode }) {
  const { loading } = useAuth();

  if (loading) {
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
