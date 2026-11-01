import React from 'react';
import { DispatchPanel } from '@/components/dispatch/DispatchPanel';

/**
 * Dispatch — the contract board + bay (migration 0032).
 *
 * Timed contracts for spare loadouts and spare vehicles, running
 * parallel to the personal action slot. This screen is a pure
 * consumer of the Chef's /api/dispatch surface; the panel owns the
 * (server-priced) prep flow.
 */
export const DispatchScreen: React.FC = () => (
  <div className="mx-auto w-full max-w-xl space-y-3 p-3">
    <div className="text-xs text-text-muted">
      Send spare gear — or a spare vehicle — out on timed contracts. Contracts pay credits, scrap, and
      materials; they never pay XP, gear, or legendaries, and they run alongside whatever you're doing.
    </div>
    <DispatchPanel />
  </div>
);
