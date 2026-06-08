import React, { useState } from 'react';
import { Clock, Zap, AlertTriangle, Info } from 'lucide-react';
import { usePlayerStore, useIdleStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';

export const SettingsScreen: React.FC = () => {
  const player = usePlayerStore();
  const idle = useIdleStore();
  const [showReset, setShowReset] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);

  const salvageOptions = ['Common', 'Uncommon', 'Rare', 'Epic'];
  const qualityOptions = [0, 20, 40, 60, 80];

  const handleReset = () => {
    if (!resetConfirmed) {
      setResetConfirmed(true);
      return;
    }
    localStorage.clear();
    window.location.reload();
  };

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-lg font-black text-text-primary">Settings</div>

      {/* Offline Cap */}
      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-blue" />
          <div className="text-xs font-bold text-text-primary">Offline Earnings Cap</div>
        </div>
        <div className="flex items-center gap-2">
          {[2, 4, 6, 8, 12].map((h) => (
            <button
              key={h}
              onClick={() => player.setPlayer({ offlineCapHours: h })}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                player.offlineCapHours === h ? 'bg-amber text-bg border-amber' : 'bg-surface-raised text-text-secondary border-border'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
        <div className="text-[10px] text-text-muted">Maximum hours of offline earnings that can accumulate.</div>
      </MobileCard>

      {/* Auto Salvage */}
      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2">
          <Zap size={16} className="text-amber" />
          <div className="text-xs font-bold text-text-primary">Auto-Salvage Settings</div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-text-muted">Max Rarity to Auto-Salvage</div>
          <div className="flex gap-1">
            {salvageOptions.map((r) => (
              <button
                key={r}
                onClick={() => idle.setAutoSalvage(r, idle.autoSalvageQuality)}
                className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${
                  idle.autoSalvageRarity === r ? 'bg-amber text-bg border-amber' : 'bg-surface-raised text-text-secondary border-border'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-text-muted">Max Roll Quality to Salvage</div>
          <div className="flex gap-1">
            {qualityOptions.map((q) => (
              <button
                key={q}
                onClick={() => idle.setAutoSalvage(idle.autoSalvageRarity, q)}
                className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${
                  idle.autoSalvageQuality === q ? 'bg-amber text-bg border-amber' : 'bg-surface-raised text-text-secondary border-border'
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </MobileCard>

      {/* About */}
      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2">
          <Info size={16} className="text-blue" />
          <div className="text-xs font-bold text-text-primary">About</div>
        </div>
        <div className="text-[10px] text-text-secondary space-y-1">
          <div>CyberCache v0.1.0</div>
          <div>Mobile-first idle roguelite looter RPG</div>
          <div>React 19 · TypeScript · Tailwind CSS · Framer Motion</div>
        </div>
      </MobileCard>

      {/* Reset Data */}
      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-red" />
          <div className="text-xs font-bold text-red">Danger Zone</div>
        </div>
        {!showReset ? (
          <button
            onClick={() => setShowReset(true)}
            className="w-full py-2 rounded-lg bg-red/10 text-red text-xs font-bold border border-red/30"
          >
            Reset All Save Data
          </button>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] text-red">This permanently deletes all progress, items, and settings. This cannot be undone.</div>
            <button
              onClick={handleReset}
              className={`w-full py-2 rounded-lg text-xs font-bold border ${
                resetConfirmed ? 'bg-red text-white border-red animate-pulse' : 'bg-red/10 text-red border-red/30'
              }`}
            >
              {resetConfirmed ? '⚠️ RESET EVERYTHING ⚠️' : 'Confirm Reset'}
            </button>
            <button
              onClick={() => { setShowReset(false); setResetConfirmed(false); }}
              className="w-full py-2 rounded-lg bg-surface-raised text-text-secondary text-xs font-bold border border-border"
            >
              Cancel
            </button>
          </div>
        )}
      </MobileCard>
    </div>
  );
};
