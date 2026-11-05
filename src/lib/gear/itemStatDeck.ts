import { useBossStore } from '@/store';
import { pct, signedPct } from '@/lib/gear/statFormat';
import { computeLoadoutDps, computeStandardDps } from '@/lib/stats/dpsChain';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { LEGENDARY_EFFECTS, legendaryEffectName } from '@/constants/legendaryEffects';
import { SKILL_NODES } from '@/constants/skillTrees';
import {
  SHIELD_BEHAVIORS,
  describeShieldBehavior,
  shieldBehaviorOf,
} from '@/lib/combat/shieldBehaviors';
import type React from 'react';
import type { Affix, ClassMod, GearItem, Ordnance, Relic, Shield as ShieldItem, Weapon } from '@/types/items';

/**
 * The ONE item stat deck data source (extracted from
 * GearInspectSheet, 2026-11-04, cache-reveal "show more stats").
 *
 * Every surface that prints an item's numbers — the inspect sheet,
 * the cache reveal page — derives its rows from here (`statRows`,
 * the label helpers, `legendaryEffectOf`) and renders them through
 * the shared components in
 * `src/components/gear/itemStatDeck.tsx`, so two surfaces can never
 * disagree about an item's stats. Do not hand-copy these rows into
 * a screen; compose from here instead.
 */
export const slashClip = { clipPath: 'polygon(9px 0,100% 0,calc(100% - 9px) 100%,0 100%)' };
export const isWeapon = (item: GearItem): item is Weapon => 'weaponType' in item;
export const isShield = (item: GearItem): item is ShieldItem => 'hp' in item && !isWeapon(item);
export const isClassMod = (item: GearItem): item is ClassMod => 'treeBonus' in item;
export const isOrdnance = (item: GearItem): item is Ordnance => 'damage' in item && 'effect' in item && !isWeapon(item);
export const isRelic = (item: GearItem): item is Relic => 'affixes' in item && !isWeapon(item) && !isShield(item) && !isClassMod(item) && !isOrdnance(item);
export const affixesOf = (item: GearItem): Affix[] => ('affixes' in item && Array.isArray(item.affixes) ? item.affixes : []);
export const kindOf = (item: GearItem) => (isWeapon(item) ? 'Weapon' : isShield(item) ? 'Shield' : isClassMod(item) ? 'Class Mod' : isOrdnance(item) ? 'Ordnance' : 'Relic');
// The percent formatters live in statFormat.ts (shared with the
// loot-moment card); re-exported here so this module stays the
// deck's one import surface.
export { pct, signedPct } from './statFormat';

/**
 * Player-facing labels for weapon-part modifier keys (QC 2026-11-02,
 * A3: the Roll Parts tape printed the raw camelCase keys —
 * "attackSpeed 1.20 · critChance 0.05"). Keys are WeaponStats fields
 * plus the extra part-only stats the generators roll; anything not in
 * the map is humanized (camelCase → spaced words) so a future stat
 * still never renders as a raw identifier.
 */
const PART_STAT_LABELS: Record<string, string> = {
  baseDamage: 'Damage',
  attackSpeed: 'Attack Speed',
  critChance: 'Crit Chance',
  critDamage: 'Crit Damage',
  statusChance: 'Status Chance',
  statusDamage: 'Status Damage',
  bossDamageMod: 'Boss Damage',
  waveDamageMod: 'Wave Damage',
  shieldDamageMod: 'Shield Damage',
  armorDamageMod: 'Armor Damage',
  offlineEarningsMod: 'Offline Earnings',
  rareDropChanceMod: 'Rare Drop Chance',
  scrapYieldMod: 'Scrap Yield',
  armorPen: 'Armor Penetration',
  blockChance: 'Block Chance',
  elementalDamage: 'Elemental Damage',
  multiShot: 'Multishot',
};
const humanizeKey = (key: string) =>
  key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
export const partStatLabel = (key: string) => PART_STAT_LABELS[key] ?? humanizeKey(key);
export const skillNodeName = (nodeId: string) =>
  SKILL_NODES.find((node) => node.id === nodeId)?.name ?? humanizeKey(nodeId);

export function statRows(item: GearItem, bossRelativeDps?: number, bossName?: string): Array<[string, React.ReactNode, string?, number?]> {
  if (isWeapon(item)) {
    // DPS goes through the unified modifier chain. The "vs standard target"
    // label is shown next to the number on the UI to make the assumption
    // explicit — the player can see in the boss-prep screen what the value
    // becomes against a real weakness. When a boss is selected, a second
    // row is appended with the boss-relative DPS so the player can compare
    // this weapon's contribution to both the standard baseline and the
    // current hunt target.
    const dps = Math.round(computeStandardDps(item));
    const rows: Array<[string, React.ReactNode, string?, number?]> = [
      ['Combat Power', item.combatPower, 'text-amber', item.combatPower],
      ['DPS (vs standard)', dps, 'text-red', dps],
      ['Boss Power', item.bossPower, 'text-amber', item.bossPower],
      ['Farm Power', item.farmPower, 'text-green', item.farmPower],
      ['Damage', item.baseDamage],
      ['Attack Speed', (item.attackSpeed ?? 0).toFixed(2)],
      ['Crit Chance', pct(item.critChance)],
      ['Crit Damage', pct(item.critDamage)],
      ['Status Chance', pct(item.statusChance)],
      ['Shield Modifier', signedPct(item.shieldDamageMod), 'text-cyan'],
      ['Armor Modifier', signedPct(item.armorDamageMod), 'text-purple'],
      ['Boss Damage Mod', signedPct(item.bossDamageMod), 'text-red'],
      ['Wave Damage Mod', signedPct(item.waveDamageMod), 'text-orange'],
      ['Offline Modifier', signedPct(item.offlineEarningsMod), 'text-green'],
      ['Rare Drop', signedPct(item.rareDropChanceMod), 'text-amber'],
      ['Scrap Yield', signedPct(item.scrapYieldMod), 'text-cyan'],
    ];
    if (bossRelativeDps !== undefined && bossName) {
      rows.splice(2, 0, [`DPS (vs ${bossName})`, Math.round(bossRelativeDps), 'text-red', bossRelativeDps]);
    }
    return rows;
  }
  if (isShield(item)) {
    // Behavior (Phase 2c): name + plain-language effect with this
    // shield's real numbers — no invisible mechanics. Legacy shields
    // read as Standard.
    const behavior = shieldBehaviorOf(item);
    return [
      ['Shield HP', item.hp, 'text-cyan', item.hp],
      ['Recharge Rate', `${Math.round(item.rechargeRate)}/s`],
      ['Mitigation', pct(item.mitigation), 'text-green'],
      ['Element', item.element],
      ['Behavior', SHIELD_BEHAVIORS[behavior].name, 'text-amber'],
      ['Effect', describeShieldBehavior(behavior, item)],
    ];
  }
  if (isClassMod(item)) return [['Skill Tree', item.treeBonus, 'text-purple'], ['Boosted Nodes', Object.keys(item.nodeBoosts).length], ['Total Node Boost', Object.values(item.nodeBoosts).reduce((s, v) => s + v, 0), 'text-purple'], ['Affixes', item.affixes.length]];
  if (isOrdnance(item)) return [['Payload Damage', item.damage, 'text-red', item.damage], ['Shield Damage', item.shieldDamage, 'text-cyan'], ['Armor Damage', item.armorDamage, 'text-purple'], ['Element', item.element], ['Effect', item.effect]];
  // Relic: show affix category breakdown (relics are all about affixes)
  const relicAffixes = affixesOf(item);
  const byCategory: Record<string, number> = {};
  relicAffixes.forEach((a) => {
    byCategory[a.category] = (byCategory[a.category] || 0) + 1;
  });
  const catRows: Array<[string, React.ReactNode, string?, number?]> = Object.entries(byCategory).map(
    ([cat, count]) => [`${cat} Affixes`, count, 'text-amber', count * 15],
  );
  return [
    ['Total Affixes', relicAffixes.length, 'text-amber', relicAffixes.length * 10],
    ...catRows,
    ['Source', item.sourceTag],
    ['Rarity', item.rarity],
  ];
}

/**
 * The legendary effect carried by an item, resolved from the ONE
 * definition source (`LEGENDARY_EFFECTS`): its player-facing name
 * (via `legendaryEffectName`, the shared lookup) and its description.
 */
export function legendaryEffectOf(item: GearItem): { name: string; description: string } | null {
  if (!isWeapon(item) || !item.legendaryEffectId) return null;
  const def = LEGENDARY_EFFECTS.find((e) => e.id === item.legendaryEffectId);
  return { name: legendaryEffectName(item.legendaryEffectId), description: def?.description ?? '' };
}

/**
 * Boss-relative DPS for a weapon, exactly as the inspect sheet
 * computes it: the currently selected boss (if any) priced through
 * the unified chain (`computeLoadoutDps`) the diorama uses.
 */
export function useBossRelativeDps(item: GearItem | null): { dps: number; bossName: string } | undefined {
  const currentBossId = useBossStore((s) => s.currentBossId);
  if (!item || !isWeapon(item) || !currentBossId) return undefined;
  const boss = REGION_1_BOSSES.find((b) => b.id === currentBossId) ?? null;
  if (!boss) return undefined;
  return { dps: computeLoadoutDps([item], boss.weaknesses, boss.resistances), bossName: boss.name };
}
