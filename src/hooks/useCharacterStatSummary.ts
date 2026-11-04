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
import { buildCharacterMechanicsSnapshot, type CharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import type { BossDef } from '@/types/boss';
import type { Weapon } from '@/types/items';

export interface CharacterStatInputs {
  summary: CharacterStatSummary;
  snapshot: CharacterMechanicsSnapshot;
  /** Equipped weapons in slot order (primary first). */
  weapons: Weapon[];
}

export function useCharacterStatSummary(boss?: BossDef | null): CharacterStatInputs {
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const skills = useSkillStore();
  const survival = useSurvivalStore();
  const activeBuffsStore = useActiveBuffsStore();
  const now = useNow();

  return useMemo(() => {
    const weapons = [loadout.getWeapon('primary'), loadout.getWeapon('secondary'), loadout.getWeapon('heavy')]
      .filter((w): w is Weapon => !!w);
    const activeBuffs = activeBuffsStore.buffs.filter((buff) => buff.expiresAt > now);
    const summaryInput = {
      player,
      weapons,
      shield: loadout.getShield(),
      classMod: loadout.getClassMod(),
      relic: loadout.getRelic(),
      ordnance: loadout.getOrdnance(),
      spentSkills: skills.spent,
      boss: boss ?? undefined,
      activeBuffs,
      consumableMods: buildConsumableInventoryMods(player.consumables),
      consumableInventory: player.consumables,
      medKitBuffer: survival.medKitBuffer,
    };
    return {
      summary: buildCharacterStatSummary(summaryInput),
      snapshot: buildCharacterMechanicsSnapshot(summaryInput),
      weapons,
    };
  }, [player, loadout, skills, survival, activeBuffsStore.buffs, now, boss]);
}
