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
import {
  useActiveBuffsStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useSurvivalStore,
} from '@/store';
import { useNow } from '@/hooks/useNow';
import { buildCharacterStatSummary, type CharacterStatSummary } from '@/lib/stats/characterStats';
import { assembleStatSummaryInput, type StatSummaryAssemblyState } from '@/lib/stats/assembleStatSummaryInput';
import { buildCharacterMechanicsSnapshot, type CharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { computeSkillBonuses } from '@/lib/skills/skillBonuses';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import type { BossDef } from '@/types/boss';
import type { Weapon } from '@/types/items';

export interface CharacterStatInputs {
  summary: CharacterStatSummary;
  snapshot: CharacterMechanicsSnapshot;
  /** Equipped weapons in slot order (primary first). */
  weapons: Weapon[];
  /** The equipped primary weapon, slot-true: null when the
   *  primary slot is empty even if other slots are filled (the
   *  compacted `weapons` list cannot say which slot its first
   *  entry came from). */
  primary: Weapon | null;
  /** The build's skill-bonus record — computeSkillBonuses over
   *  spends + class-mod boosts, the same record this assembly
   *  hands the boss sim. Display surfaces that price
   *  skill-driven numbers (the fight crit, audit HTR-04) read
   *  it from here so they can never drift from the sim's input. */
  skillBonuses: Record<string, number>;
}

/**
 * The store → assembly-state sourcing, shared by the summary hook
 * and the equip comparison ("The Trade" tape). The pure assembly
 * (assembleStatSummaryInput) is the one fold; this hook is the one
 * place store state is gathered for it, so a compare can never
 * drift from the live summary by sourcing its inputs differently.
 */
export function useStatSummaryAssemblyState(boss?: BossDef | null): StatSummaryAssemblyState {
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const skills = useSkillStore();
  const survival = useSurvivalStore();
  const activeBuffsStore = useActiveBuffsStore();
  const now = useNow();

  return useMemo(() => ({
    player,
    weapons: [loadout.getWeapon('primary'), loadout.getWeapon('secondary'), loadout.getWeapon('heavy')],
    shield: loadout.getShield(),
    classMod: loadout.getClassMod(),
    relic: loadout.getRelic(),
    ordnance: loadout.getOrdnance(),
    spent: skills.spent,
    classModBoosts: skills.classModBoosts,
    boss: boss ?? undefined,
    activeBuffs: activeBuffsStore.buffs.filter((buff) => buff.expiresAt > now),
    consumableMods: buildConsumableInventoryMods(player.consumables),
    consumableInventory: player.consumables,
    medKitBuffer: survival.medKitBuffer,
  }), [player, loadout, skills, survival, activeBuffsStore.buffs, now, boss]);
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
    return {
      summary: buildCharacterStatSummary(summaryInput),
      snapshot: buildCharacterMechanicsSnapshot(summaryInput),
      weapons,
      primary: state.weapons[0] ?? null,
      skillBonuses: computeSkillBonuses(state.spent, state.classModBoosts),
    };
  }, [state]);
}
