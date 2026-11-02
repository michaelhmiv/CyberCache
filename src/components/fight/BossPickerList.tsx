/**
 * BossPickerList — THE boss picker list (Phase 1 consolidation).
 *
 * One shared boss-selection list for every entry point: the App-level
 * boss select modal and the Fight tab's "Change boss" sheet both render
 * this component; they differ only in what `onSelect` does (set the
 * target vs. start prep). Locked bosses render disabled with their
 * unlock hint — nothing is hidden, nothing is selectable early.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { CheckCircle, Lock } from 'lucide-react';
import { useBossStore } from '@/store/slices/bossSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { REGION_1_BOSSES } from '@/constants/bosses';
import type { BossDef } from '@/types/boss';
import { MobileCard } from '@/components/layout/MobileCard';
import { computeLoadoutDps } from '@/lib/stats/dpsChain';
import { escalatedBossFee } from '@/lib/bossFees';
import { BossSigil } from '@/components/common/BossSigil';

interface BossPickerListProps {
  onSelect: (boss: BossDef) => void;
}

export const BossPickerList: React.FC<BossPickerListProps> = ({ onSelect }) => {
  const bossStore = useBossStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  // Equipped-first: use the actual equipped weapon for any DPS projection
  // that feeds activity truth. The best-owned inventory weapon is only
  // used as a clearly-labeled "Best Owned" preview when nothing is equipped.
  const equippedWeapon = loadout.getWeapon('primary')
    ?? loadout.getWeapon('secondary')
    ?? loadout.getWeapon('heavy')
    ?? null;
  const bestOwnedWeapon = equippedWeapon
    ? null
    : [...inventory.getWeapons()].sort((a, b) => b.combatPower - a.combatPower)[0] ?? null;
  const projectionWeapon = equippedWeapon ?? bestOwnedWeapon;

  // Project the player's best weapon's DPS against each candidate boss. The
  // label is "vs {boss.name}" so the chip is contextual, not abstract. This
  // is the same call the diorama uses, so what the player sees here matches
  // what the diorama will show after they select the target.
  const projectDpsVs = (boss: BossDef): number => {
    if (!projectionWeapon) return 0;
    return computeLoadoutDps([projectionWeapon], boss.weaknesses, boss.resistances);
  };

  return (
    <div className="space-y-2">
      {REGION_1_BOSSES.map((boss) => {
        const isLocked = !bossStore.unlockedBossIds.includes(boss.id);
        const isDefeated = bossStore.defeatedBossIds.includes(boss.id);
        const isCurrent = bossStore.currentBossId === boss.id;
        const pity = bossStore.pityCounters[boss.id] || 0;

        return (
          <MobileCard
            key={boss.id}
            onClick={() => !isLocked && onSelect(boss)}
            className={`space-y-2 cursor-pointer transition-all ${
              isLocked ? 'opacity-50' : ''
            } ${
              isCurrent ? 'border-amber ring-1 ring-amber/50' : ''
            } ${
              isDefeated ? 'border-green/30' : ''
            }`}
          >
            {/* Header Row */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                {isDefeated ? (
                  <CheckCircle size={18} className="text-green" />
                ) : isLocked ? (
                  <Lock size={18} className="text-text-muted" />
                ) : (
                  <BossSigil bossId={boss.id} size={20} showFrame={false} />
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
            <div className="flex items-center justify-between gap-2 text-[10px] text-text-secondary">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <div className="flex items-center gap-1"><PxIcon name="heart" size={13} /> HP {boss.health.toLocaleString()}</div>
                {boss.shield > 0 && <div className="flex items-center gap-1"><PxIcon name="bolt" size={13} /> Shield {boss.shield.toLocaleString()}</div>}
                {boss.armor > 0 && <div className="flex items-center gap-1"><PxIcon name="armor" size={13} /> Armor {boss.armor.toLocaleString()}</div>}
              </div>
              <div
                className="shrink-0 border-2 border-border bg-bg/80 px-1.5 py-0.5"
                data-testid={`bossselect-dps-${boss.id}`}
              >
                <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">{bestOwnedWeapon ? 'Preview: best owned vs' : 'Your weapon vs'} {boss.name.split(' ').slice(-1)[0]}</div>
                <div className={`text-[11px] font-black ${projectionWeapon ? 'text-red' : 'text-text-muted'}`}>
                  {projectionWeapon ? `${Math.round(projectDpsVs(boss)).toLocaleString()} DPS` : 'no weapon'}
                </div>
              </div>
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
                {boss.rematchCost > 0 && ` · Rematch: ${escalatedBossFee(boss.rematchCost, bossStore.bossVictoriesToday[boss.id] ?? 0)}cr`}
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
  );
};
