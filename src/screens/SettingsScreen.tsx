import React, { useState } from 'react';
import { Clock, AlertTriangle, Info, Settings, ExternalLink } from 'lucide-react';
import { usePlayerStore, useIdleStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { resetRuntimeStoresToInitialState, saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';

const DATA_DELETION_URL = 'https://cybercache-production.up.railway.app/data-deletion.html';

export const SettingsScreen: React.FC = () => {
  const player = usePlayerStore();
  const idle = useIdleStore();
  const [showReset, setShowReset] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const salvageOptions = ['Common', 'Uncommon', 'Rare', 'Epic'];
  const qualityOptions = [0, 20, 40, 60, 80];

  const handleReset = async () => {
    if (!resetConfirmed) {
      setResetConfirmed(true);
      return;
    }

    setResetting(true);
    setResetError(null);
    try {
      await verifiedOps.resetProgress();
      resetRuntimeStoresToInitialState();
      await saveCurrentRuntimeStores();
      window.location.reload();
    } catch (error) {
      setResetError(error instanceof Error ? error.message : 'Unable to reset account progress.');
      setResetting(false);
    }
  };

  return (
    <div className="bl-page space-y-4 p-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Options Board</div>
          <div className="text-xs text-text-muted">Idle tuning, salvage rules, and account controls.</div>
        </div>
        <div className="bl-icon-plate flex h-12 w-12 shrink-0 -rotate-2 items-center justify-center text-amber">
          <Settings size={22} />
        </div>
      </div>

      <MobileCard className="space-y-2" rarityColor="#3B82F6">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Offline Earnings Cap</div>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {[2, 4, 6, 8, 12].map((h) => (
            <button
              key={h}
              onClick={() => player.setPlayer({ offlineCapHours: h })}
              className={`py-1.5 text-xs font-black ${player.offlineCapHours === h ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
            >
              {h}h
            </button>
          ))}
        </div>
        <div className="text-[10px] text-text-muted">Maximum hours of offline rewards that can pile up while away.</div>
      </MobileCard>

      <MobileCard className="space-y-3" rarityColor="#FF9000">
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 16 }} className="text-amber">♻</span>
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Auto-Salvage Rules</div>
        </div>
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Max Rarity to Auto-Salvage</div>
          <div className="grid grid-cols-4 gap-1.5">
            {salvageOptions.map((r) => (
              <button
                key={r}
                onClick={() => idle.setAutoSalvage(r, idle.autoSalvageQuality)}
                className={`py-1.5 text-[10px] font-black ${idle.autoSalvageRarity === r ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted">Max Roll Quality to Salvage</div>
          <div className="grid grid-cols-5 gap-1.5">
            {qualityOptions.map((q) => (
              <button
                key={q}
                onClick={() => idle.setAutoSalvage(idle.autoSalvageRarity, q)}
                className={`py-1.5 text-[10px] font-black ${idle.autoSalvageQuality === q ? 'bl-primary' : 'bl-secondary text-text-secondary'}`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#3B82F6">
        <div className="flex items-center gap-2">
          <Info size={16} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">About</div>
        </div>
        <div className="space-y-1 text-[10px] text-text-secondary">
          <div>CyberCache v0.1.0</div>
          <div>Mobile-first idle roguelite looter RPG</div>
          <div>React 19 · TypeScript · Tailwind CSS · Framer Motion</div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2" rarityColor="#FF4B5C">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red" />
          <div className="text-xs font-black uppercase tracking-wide text-red">Danger Zone</div>
        </div>
        {resetError && (
          <div className="bl-card p-2 text-[10px] text-red">
            {resetError}
          </div>
        )}
        {!showReset ? (
          <button
            onClick={() => setShowReset(true)}
            className="bl-secondary w-full py-2 text-xs font-black text-red"
          >
            Reset All Save Data
          </button>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] text-red">This permanently resets Supabase-backed progress, items, and runtime settings. This cannot be undone.</div>
            <button
              onClick={handleReset}
              disabled={resetting}
              className={`w-full py-2 text-xs font-black disabled:opacity-50 ${resetConfirmed ? 'bl-primary animate-pulse' : 'bl-secondary text-red'}`}
            >
              {resetting ? 'Resetting…' : resetConfirmed ? 'RESET EVERYTHING' : 'Confirm Reset'}
            </button>
            <button
              onClick={() => { setShowReset(false); setResetConfirmed(false); setResetError(null); }}
              disabled={resetting}
              className="bl-secondary w-full py-2 text-xs font-black text-text-secondary disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        )}
        <div className="border-t border-border/60 pt-3">
          <div className="mb-2 text-[10px] text-text-muted">
            Request deletion of your CyberCache account and associated server-side gameplay data.
          </div>
          <button
            onClick={() => window.open(DATA_DELETION_URL, '_blank', 'noopener,noreferrer')}
            className="bl-secondary flex w-full items-center justify-center gap-2 py-2 text-xs font-black text-red"
          >
            <ExternalLink size={14} />
            Delete Account / Data
          </button>
        </div>
      </MobileCard>
    </div>
  );
};
