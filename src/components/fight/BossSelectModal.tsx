import React from 'react';
import { motion } from 'framer-motion';
import { X, CheckCircle, Lock, Skull, Star, Shield, Zap, Crosshair } from 'lucide-react';
import { useBossStore } from '../../store/slices/bossSlice';
import { usePlayerStore } from '../../store';
import { REGION_1_BOSSES } from '../../constants/bosses';
import { BossDef } from '../../types/boss';
import { MobileCard } from '../layout/MobileCard';

interface BossSelectModalProps {
  onClose: () => void;
}

export const BossSelectModal: React.FC<BossSelectModalProps> = ({ onClose }) => {
  const bossStore = useBossStore();
  const player = usePlayerStore();

  const selectBoss = (boss: BossDef) => {
    bossStore.setCurrentBoss(boss.id);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 flex flex-col"
    >
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-black text-text-primary">Select Target</div>
            <div className="text-xs text-text-muted">Choose which boss to hunt</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bg-surface border border-border">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-2">
          {REGION_1_BOSSES.map((boss) => {
            const isLocked = !bossStore.unlockedBossIds.includes(boss.id);
            const isDefeated = bossStore.defeatedBossIds.includes(boss.id);
            const isCurrent = bossStore.currentBossId === boss.id;
            const pity = bossStore.pityCounters[boss.id] || 0;

            return (
              <MobileCard
                key={boss.id}
                onClick={() => !isLocked && selectBoss(boss)}
                className={`space-y-2 cursor-pointer transition-all ${
                  isLocked ? 'opacity-50' : ''
                } ${
                  isCurrent ? 'border-amber ring-1 ring-amber/50' : ''
                } ${
                  isDefeated ? 'border-green/30' : ''
                }`}
              >
                {/* Header Row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isDefeated ? (
                      <CheckCircle size={18} className="text-green" />
                    ) : isLocked ? (
                      <Lock size={18} className="text-text-muted" />
                    ) : (
                      <Skull size={18} className="text-red" />
                    )}
                    <div>
                      <div className="text-sm font-bold text-text-primary">
                        {boss.name}
                        {isCurrent && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber/20 text-amber font-bold">
                            TARGET
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-text-muted">
                        Tier {boss.tier} • Lv.{boss.level} • Power {boss.recommendedPower}
                      </div>
                    </div>
                  </div>
                  {isDefeated && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green font-bold">
                      DEFEATED
                    </span>
                  )}
                  {isLocked && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-raised text-text-muted font-bold border border-border">
                      LOCKED
                    </span>
                  )}
                </div>

                {/* Stats Row */}
                <div className="flex items-center gap-3 text-[10px] text-text-secondary">
                  <div className="flex items-center gap-1"><Shield size={10} /> HP {boss.health.toLocaleString()}</div>
                  {boss.shield > 0 && <div className="flex items-center gap-1"><Zap size={10} /> Shield {boss.shield.toLocaleString()}</div>}
                  {boss.armor > 0 && <div className="flex items-center gap-1"><Crosshair size={10} /> Armor {boss.armor.toLocaleString()}</div>}
                </div>

                {/* Weaknesses / Resistances */}
                <div className="flex flex-wrap gap-1.5">
                  {boss.weaknesses.map((e) => (
                    <span key={e} className="text-[9px] px-1.5 py-0.5 rounded bg-green/10 text-green font-bold">
                      WEAK: {e}
                    </span>
                  ))}
                  {boss.resistances.map((e) => (
                    <span key={e} className="text-[9px] px-1.5 py-0.5 rounded bg-red/10 text-red font-bold">
                      RES: {e}
                    </span>
                  ))}
                </div>

                {/* Mechanic Summary */}
                <div className="text-[10px] text-amber">{boss.mechanic.description}</div>

                {/* Pity / Entry Info */}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-text-muted">
                    {boss.entryCost > 0 ? `Entry: ${boss.entryCost}cr` : 'Free entry'}
                    {boss.rematchCost > 0 && ` · Rematch: ${boss.rematchCost}cr`}
                  </span>
                  {pity > 0 && (
                    <span className="text-amber font-bold">Pity: {pity}</span>
                  )}
                </div>

                {/* Rewards */}
                <div className="text-[9px] text-text-muted">
                  Drops: {boss.dedicatedDrops.slice(0, 3).join(', ')}
                  {boss.dedicatedDrops.length > 3 ? ` +${boss.dedicatedDrops.length - 3} more` : ''}
                </div>

                {/* Locked hint */}
                {isLocked && (
                  <div className="text-[10px] text-text-muted italic">
                    Defeat {REGION_1_BOSSES.find(b => REGION_1_BOSSES.indexOf(b) === REGION_1_BOSSES.indexOf(boss) - 1)?.name || 'the previous boss'} to unlock
                  </div>
                )}
              </MobileCard>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 p-4 border-t border-border bg-surface">
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-amber text-bg font-bold text-sm"
        >
          Done
        </button>
      </div>
    </motion.div>
  );
};
