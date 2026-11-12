/**
 * The character stat summary + mechanics snapshot, assembled from
 * the stores with the ONE input shape every stat surface shares
 * (the assembly DashboardDeck and the retired stage band each
 * used to hand-roll). Display only: both builders read the same
 * canonical inputs the engines consume — this hook computes no
 * gameplay outcome.
 *
 * Consumers: the Home hero rundown (with the boss context while a
 * boss fight holds the stage) and the Hunter → Profile "Totals &
 * Sources" door (no boss context — the hunter's standing build).
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  useActiveBuffsStore,
  useLoadoutStore,
  useInventoryStore,
  usePlayerStore,
  useSkillStore,
  useSurvivalStore,
} from '@/store';
import { useNow } from '@/hooks/useNow';
import { buildCharacterStatSummary, type CharacterStatSummary } from '@/lib/stats/characterStats';
import { assembleStatSummaryInput, type StatSummaryAssemblyState } from '@/lib/stats/assembleStatSummaryInput';
import { buildCharacterMechanicsSnapshot, type CharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import type { BossDef } from '@/types/boss';
import type { Weapon } from '@/types/items';
import { isWeaponItem, isShieldItem, isClassModItem, isRelicItem, isOrdnanceItem } from '@/lib/loadout/loadoutReadModel';

export interface CharacterStatInputs {
  summary: CharacterStatSummary;
  snapshot: CharacterMechanicsSnapshot;
  /** Equipped weapons in slot order (primary first). */
  weapons: Weapon[];
}

/**
 * The store → assembly-state sourcing, shared by the summary hook
 * and the equip comparison ("The Trade" tape). The pure assembly
 * (assembleStatSummaryInput) is the one fold; this hook is the one
 * place store state is gathered for it, so a compare can never
 * drift from the live summary by sourcing its inputs differently.
 */
export function useStatSummaryAssemblyState(boss?: BossDef | null): StatSummaryAssemblyState {
  const player = usePlayerStore(useShallow((s) => ({ level: s.level, cacheRankSpends: s.cacheRankSpends })));
  const consumableInventory = usePlayerStore((s) => s.consumables);
  const slots = useLoadoutStore(useShallow((s) => [
    s.slots.primary, s.slots.secondary, s.slots.heavy,
    s.slots.shield, s.slots.classMod, s.slots.relic, s.slots.ordnance,
  ]));
  const equipped = useInventoryStore(useShallow((s) => slots.map((id) => s.items.find((item) => item.id === id))));
  const skills = useSkillStore(useShallow((s) => ({ spent: s.spent, classModBoosts: s.classModBoosts })));
  const medKitBuffer = useSurvivalStore((s) => s.medKitBuffer);
  const now = useNow();
  // Keep this array stable until an effect actually changes or expires.
  const activeBuffs = useActiveBuffsStore(useShallow((s) => s.buffs.filter((buff) => buff.expiresAt > now)));

  return useMemo(() => ({
    player,
    weapons: equipped.slice(0, 3).map((item) => isWeaponItem(item) ? item : undefined),
    shield: isShieldItem(equipped[3]) ? equipped[3] : undefined,
    classMod: isClassModItem(equipped[4]) ? equipped[4] : undefined,
    relic: isRelicItem(equipped[5]) ? equipped[5] : undefined,
    ordnance: isOrdnanceItem(equipped[6]) ? equipped[6] : undefined,
    spent: skills.spent,
    classModBoosts: skills.classModBoosts,
    boss: boss ?? undefined,
    activeBuffs,
    consumableMods: buildConsumableInventoryMods(consumableInventory),
    consumableInventory,
    medKitBuffer,
  }), [player, equipped, skills, medKitBuffer, activeBuffs, consumableInventory, boss]);
}

export function useCharacterStatSummary(boss?: BossDef | null): CharacterStatInputs {
  const state = useStatSummaryAssemblyState(boss);

  return useMemo(() => {
    const weapons = state.weapons.filter((w): w is Weapon => !!w);
    // The ONE assembly (assembleStatSummaryInput): weapons ride
    // slot-indexed with holes — the builders filter them exactly as
    // they filtered the compacted array — and spent points fold
    // through effectiveSkillPoints with the equipped class mod's
    // boosts, so the summary prices the build the Chef pays.
    const summaryInput = assembleStatSummaryInput(state);
    const snapshot = buildCharacterMechanicsSnapshot(summaryInput);
    return {
      summary: buildCharacterStatSummary(summaryInput, snapshot),
      snapshot,
      weapons,
    };
  }, [state]);
}
