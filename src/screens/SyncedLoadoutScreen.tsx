import React from 'react';
import { ActionLoadout } from '@/components/action/ActionLoadout';

export const SyncedLoadoutScreen: React.FC = () => {
  return (
    <div className="p-4 space-y-4 pb-20">
      <div>
        <div className="text-lg font-black text-text-primary">Loadout</div>
        <div className="text-xs text-text-muted">Server-authoritative gear constellation. All changes are verified through Supabase RPCs.</div>
      </div>
      <ActionLoadout />
    </div>
  );
};
