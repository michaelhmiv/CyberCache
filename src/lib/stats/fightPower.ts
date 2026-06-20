import type { Weapon } from '@/types/items';
import type { BossDef } from '@/types/boss';
import { computeLoadoutDps, computeStandardDps } from '@/lib/stats/dpsChain';

/**
 * Server-authoritative equipped weapon power.
 * Empty equipped loadout means 0 weapon DPS; inventory preview weapons must be
 * computed through computePreviewFightPower and labeled as preview in UI.
 */
export function computeEquippedFightPower(
  equippedWeapons: Array<Weapon | undefined>,
  currentBoss: BossDef | null | undefined,
): number {
  const equipped = equippedWeapons.filter((weapon): weapon is Weapon => !!weapon);
  if (equipped.length === 0) return 0;
  if (currentBoss) {
    return Math.round(computeLoadoutDps(equipped, currentBoss.weaknesses, currentBoss.resistances));
  }
  return Math.round(equipped.reduce((sum, weapon) => sum + computeStandardDps(weapon), 0));
}

/** Best-owned projection only. Do not feed this value into equipped/activity truth. */
export function computePreviewFightPower(
  previewWeapon: Weapon | undefined,
  currentBoss: BossDef | null | undefined,
): number {
  if (!previewWeapon) return 0;
  if (currentBoss) {
    return Math.round(computeLoadoutDps([previewWeapon], currentBoss.weaknesses, currentBoss.resistances));
  }
  return Math.round(computeStandardDps(previewWeapon));
}
