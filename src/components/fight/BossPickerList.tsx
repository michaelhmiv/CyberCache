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
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { legendaryEffectName } from '@/constants/legendaryEffects';
import type { BossDef } from '@/types/boss';
import type { Weapon } from '@/types/items';
import { MobileCard } from '@/components/layout/MobileCard';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { assembleStatSummaryInput } from '@/lib/stats/assembleStatSummaryInput';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import { escalatedBossFee } from '@/lib/bossFees';
import { BossStamp } from '@/components/common/BossStamp';

interface BossPickerListProps {
  onSelect: (boss: BossDef) => void;
}

export const BossPickerList: React.FC<BossPickerListProps> = ({ onSelect }) => {
  const bossStore = useBossStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const player = usePlayerStore();
  const skills = useSkillStore();
  const survival = useSurvivalStore();
  const activeBuffsStore = useActiveBuffsStore();
  // Equipped-first: the projection prices the actual equipped loadout.
  // The best-owned inventory weapon is only used as a clearly-labeled
  // "Best Owned" preview when nothing is equipped.
  const equippedWeapons = [loadout.getWeapon('primary'), loadout.getWeapon('secondary'), loadout.getWeapon('heavy')]
    .filter((w): w is Weapon => !!w);
  const bestOwnedWeapon = equippedWeapons.length
    ? null
    : [...inventory.getWeapons()].sort((a, b) => b.combatPower - a.combatPower)[0] ?? null;
  const projectionWeapons: Weapon[] = equippedWeapons.length
    ? equippedWeapons
    : bestOwnedWeapon
      ? [bestOwnedWeapon]
      : [];
  const projectionWeapon = projectionWeapons[0] ?? null;

  // Project the loadout's DPS against each candidate boss through the
  // ONE authoritative display computation — the character stat
  // summary in boss context (the DPS chain's boss-relative pool ×
  // player bonuses), the identical figure the Fight stage's hero
  // rundown prints as "Eff. DPS" once the boss is selected. The
  // pre-fix chip priced a single weapon through a separate chain
  // call, so the list and the prep screen disagreed (gear-truth
  // slice). The input assembly is the shared one
  // (assembleStatSummaryInput — the same helper useCharacterStatSummary
  // consumes, class-mod boosts folded), so the projection can never
  // drift from the rundown again.
  const projectDpsVs = (boss: BossDef): number => {
    if (!projectionWeapon) return 0;
    const summary = buildCharacterStatSummary(assembleStatSummaryInput({
      player,
      weapons: projectionWeapons,
      shield: loadout.getShield(),
      classMod: loadout.getClassMod(),
      relic: loadout.getRelic(),
      ordnance: loadout.getOrdnance(),
      spent: skills.spent,
      classModBoosts: skills.classModBoosts,
      boss,
      activeBuffs: activeBuffsStore.buffs.filter((buff) => buff.expiresAt > Date.now()),
      consumableMods: buildConsumableInventoryMods(player.consumables),
      consumableInventory: player.consumables,
      medKitBuffer: survival.medKitBuffer,
    }));
    return summary.all.find((entry) => entry.key === 'dps')?.value ?? 0;
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
                  <BossStamp bossId={boss.id} size={20} />
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
                <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">{bestOwnedWeapon ? 'Preview: best owned vs' : 'Your DPS vs'} {boss.name.split(' ').slice(-1)[0]}</div>
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

            {/* Rewards — effect NAMES, never the raw ids (QC A3) */}
            <div className="text-[9px] text-text-muted">
              Drops: {boss.dedicatedDrops.slice(0, 3).map(legendaryEffectName).join(', ')}
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
