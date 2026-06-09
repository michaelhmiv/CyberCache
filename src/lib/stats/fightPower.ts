/**
 * fightPower — the "effective DPS vs the current boss target" for the
 * boss prep / fight panels in the action screen.
 *
 * This is the value displayed in the `Power` / `You` column of the boss
 * readiness panel. The previous implementation read `weapon.bossPower`
 * directly (a static generator composite). That had two problems:
 *
 *   1. It silently read 0 when the player had a weapon equipped whose
 *      `bossDamageMod`, `shieldDamageMod`, and `armorDamageMod` were all
 *      tiny — the user saw "0 DPS" even with a weapon in hand.
 *
 *   2. It ignored element matchup and boss resistance — the two most
 *      important factors in "can I beat this boss" decision-making.
 *
 * The new implementation delegates to the unified modifier chain via
 * `computeLoadoutDps` (boss-relative) or `computeStandardDps` (no boss
 * context). Fallback chain: equipped weapons → best inventory weapon →
 * 0. The `equipped.length > 0` check is the safety net — any surface
 * in the boss prep context can never read 0 while a weapon is in the
 * loadout.
 *
 * Pure function so it can be unit tested without bootstrapping the
 * store graph.
 */
import type { Weapon } from '@/types/items';
import type { BossDef } from '@/types/boss';
import { computeLoadoutDps, computeStandardDps } from '@/lib/stats/dpsChain';

export function computeFightPower(
  equippedWeapons: Array<Weapon | undefined>,
  bestInventoryWeapon: Weapon | undefined,
  currentBoss: BossDef | null | undefined,
): number {
  const equipped = equippedWeapons.filter((weapon): weapon is Weapon => !!weapon);
  if (equipped.length > 0) {
    if (currentBoss) {
      return Math.round(
        computeLoadoutDps(equipped, currentBoss.weaknesses, currentBoss.resistances),
      );
    }
    return Math.round(equipped.reduce((sum, weapon) => sum + computeStandardDps(weapon), 0));
  }
  if (bestInventoryWeapon) {
    return Math.round(computeStandardDps(bestInventoryWeapon));
  }
  return 0;
}
