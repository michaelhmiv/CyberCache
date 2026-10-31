/**
 * Affix pools + baked-stat application — the ONE source for rolled
 * affix generation rules (reforge slice, migration 0027).
 *
 * The five gear generators used to each carry a private copy of their
 * affix pool; the bake switches that fold affixes into an item's stat
 * block lived beside them. Reforge needs the exact same rules — the
 * replacement affix must come from the pool the generator would use,
 * and swapping one affix on a baked item requires removing the old
 * affix's contribution and applying the new one — so the pools and
 * the bake/unbake pairs live here, imported by the generators (their
 * seeded outputs are unchanged: same defs, same order, same ops) and
 * by the reforge roll below.
 *
 * Bake invertibility: unbake → swap → rebake is the reforge
 * mechanism, and the round trip (unbake then rebake with the SAME
 * affixes) is bit-identical over generated corpora for every kind —
 * the tests pin it. Additive ops round to a fixed grid (toFixed
 * 2/3), so subtraction + the same rounding returns the prior grid
 * value exactly. Multiplicative ops on integer bases (shield HP,
 * ordnance) invert exactly the same way: the pre-image sits within
 * 0.5/(1+v) < 0.5 of the true quotient (v ≥ 0.02 for every pool
 * def), so Math.round of the quotient recovers it. Weapon
 * baseDamage and attackSpeed are the fractional bases (parts scale
 * them by fractional factors before affixes bake), so their unbake
 * divides without rounding: the recovered base is the tightest
 * value consistent with the stored stats, and a swapped affix can
 * land the final stat at most ~1 point (damage) / ~0.01 (attack
 * speed) from an oracle that knew the generator's fractional base —
 * far below one affix value step.
 *
 * Activity modules (category 'activity') are NOT pool affixes: they
 * are procedural multi-stat modules generated from inputs (notably a
 * manufacturer) that four of the five kinds do not persist on the
 * item, so no faithful re-roll exists. They are never baked (the
 * bake switches fall through on their stats) and never reforgeable.
 */
import { computeStandardDps } from '@/lib/stats/dpsChain';
import {
  applyShieldBehaviorGenerationStats,
  invertShieldBehaviorGenerationStats,
  shieldBehaviorOf,
} from '@/lib/combat/shieldBehaviors';
import type { Affix, ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import { seededInt, seededRandom } from '@/lib/utils/rng';

export interface AffixPoolDef {
  stat: string;
  text: string;
  min: number;
  max: number;
  /** Relic defs carry their own category; other kinds assign one per pool. */
  category?: Affix['category'];
}

export type ReforgeKind = 'weapon' | 'shield' | 'classMod' | 'relic' | 'ordnance';

// ---------------------------------------------------------------------------
// Pools (moved verbatim from the generators — values and order are the
// seeded-generation contract)
// ---------------------------------------------------------------------------

export const WEAPON_COMBAT_POOL: AffixPoolDef[] = [
  { stat: 'baseDamage', text: '+{v}% Damage', min: 3, max: 12 },
  { stat: 'critChance', text: '+{v}% Crit Chance', min: 2, max: 8 },
  { stat: 'critDamage', text: '+{v}% Crit Damage', min: 5, max: 20 },
  { stat: 'attackSpeed', text: '+{v}% Attack Speed', min: 3, max: 10 },
  { stat: 'bossDamageMod', text: '+{v}% Boss Damage', min: 5, max: 15 },
  { stat: 'waveDamageMod', text: '+{v}% Wave Damage', min: 5, max: 15 },
];

export const WEAPON_BOSS_POOL: AffixPoolDef[] = [
  { stat: 'shieldDamageMod', text: '+{v}% Shield Break', min: 8, max: 20 },
  { stat: 'armorDamageMod', text: '+{v}% Armor Break', min: 8, max: 20 },
];

export const WEAPON_IDLE_POOL: AffixPoolDef[] = [
  { stat: 'offlineEarningsMod', text: '+{v}% Offline Earnings', min: 5, max: 15 },
  { stat: 'rareDropChanceMod', text: '+{v}% Rare Drop Chance', min: 3, max: 10 },
  { stat: 'scrapYieldMod', text: '+{v}% Scrap Yield', min: 5, max: 20 },
];

export const SHIELD_AFFIX_POOL: AffixPoolDef[] = [
  { stat: 'hp', text: '+{v}% Shield HP', min: 5, max: 15 },
  { stat: 'rechargeRate', text: '+{v}% Recharge Rate', min: 5, max: 15 },
  { stat: 'mitigation', text: '+{v}% Mitigation', min: 3, max: 10 },
];

export const ORDNANCE_COMBAT_POOL: AffixPoolDef[] = [
  { stat: 'damage', text: '+{v}% Ordnance Damage', min: 5, max: 15 },
  { stat: 'shieldDamage', text: '+{v}% Shield Break', min: 8, max: 20 },
  { stat: 'armorDamage', text: '+{v}% Armor Break', min: 8, max: 20 },
];

export const CLASSMOD_AFFIX_POOL: AffixPoolDef[] = [
  { stat: 'weaponDamage', text: '+{v}% Weapon Damage', min: 3, max: 10 },
  { stat: 'critChance', text: '+{v}% Crit Chance', min: 2, max: 6 },
  { stat: 'bossDamageMod', text: '+{v}% Boss Damage', min: 5, max: 12 },
  { stat: 'skillPoints', text: '+{v} Bonus Skill Points', min: 1, max: 3 },
];

export const RELIC_AFFIX_POOL: AffixPoolDef[] = [
  { stat: 'offlineEarningsMod', text: '+{v}% Offline Earnings', min: 8, max: 20, category: 'idle' },
  { stat: 'rareDropChanceMod', text: '+{v}% Rare Drop Chance', min: 5, max: 15, category: 'idle' },
  { stat: 'scrapYieldMod', text: '+{v}% Scrap Yield', min: 8, max: 25, category: 'idle' },
  { stat: 'xpBoostMod', text: '+{v}% XP Gain', min: 5, max: 20, category: 'idle' },
  { stat: 'cacheKeyChanceMod', text: '+{v}% Cache Key Drop Rate', min: 5, max: 15, category: 'idle' },
  { stat: 'bossDamageMod', text: '+{v}% Boss Damage', min: 5, max: 12, category: 'boss' },
  { stat: 'survivalBoost', text: '+{v}% Survival', min: 5, max: 15, category: 'boss' },
  { stat: 'consumableEfficiency', text: '+{v}% Consumable Efficiency', min: 5, max: 20, category: 'skill' },
];

/** Every pool def a kind can roll, in generator order (weapons: combat, boss, idle). */
export function affixPoolDefsFor(kind: ReforgeKind): AffixPoolDef[] {
  switch (kind) {
    case 'weapon': return [...WEAPON_COMBAT_POOL, ...WEAPON_BOSS_POOL, ...WEAPON_IDLE_POOL];
    case 'shield': return SHIELD_AFFIX_POOL;
    case 'ordnance': return ORDNANCE_COMBAT_POOL;
    case 'classMod': return CLASSMOD_AFFIX_POOL;
    case 'relic': return RELIC_AFFIX_POOL;
  }
}

/** The affix category a def lands in for a kind (weapon: by pool). */
export function affixCategoryFor(kind: ReforgeKind, def: AffixPoolDef): Affix['category'] {
  if (kind === 'weapon') {
    if (WEAPON_COMBAT_POOL.includes(def)) return 'combat';
    if (WEAPON_BOSS_POOL.includes(def)) return 'boss';
    return 'idle';
  }
  if (kind === 'classMod') return 'skill';
  if (kind === 'relic') return def.category ?? 'idle';
  return 'combat'; // shield + ordnance pools are combat affixes
}

/**
 * Kind from the item_instances kind column. A present kind column is
 * final: 'vehicle' (and any other non-gear kind) is out of scope,
 * never reclassified by payload shape. The shape fallback exists
 * only for kind-less legacy rows.
 */
export function reforgeKindOf(kind: string | null | undefined, item: GearItem): ReforgeKind | null {
  if (kind === 'weapon' || kind === 'shield' || kind === 'classMod' || kind === 'relic' || kind === 'ordnance') {
    return kind;
  }
  if (kind) return null;
  if ('weaponType' in item) return 'weapon';
  if ('treeBonus' in item) return 'classMod';
  if ('hp' in item) return 'shield';
  if ('damage' in item && 'effect' in item) return 'ordnance';
  if ('affixes' in item) return 'relic';
  return null;
}

/** Pool affixes are reforgeable; activity modules never are. */
export function isReforgeableAffix(affix: Affix): boolean {
  return affix.category !== 'activity';
}

export function reforgeableAffixes(item: GearItem): Affix[] {
  return (item.affixes ?? []).filter(isReforgeableAffix);
}

// ---------------------------------------------------------------------------
// Bake / unbake — the generator switches, with their exact inverses.
// ---------------------------------------------------------------------------

const f1 = (n: number) => parseFloat(n.toFixed(1));
const f2 = (n: number) => parseFloat(n.toFixed(2));
const f3 = (n: number) => parseFloat(n.toFixed(3));

export interface WeaponStatBag {
  baseDamage: number;
  attackSpeed: number;
  critChance: number;
  critDamage: number;
  bossDamageMod: number;
  waveDamageMod: number;
  shieldDamageMod: number;
  armorDamageMod: number;
  offlineEarningsMod: number;
  rareDropChanceMod: number;
  scrapYieldMod: number;
}

/** The weapon generator's step-10b switch, verbatim semantics. */
export function bakeWeaponAffixes(stats: WeaponStatBag, affixes: Affix[]): void {
  for (const affix of affixes) {
    const v = affix.value;
    switch (affix.stat) {
      case 'baseDamage': stats.baseDamage = Math.round(stats.baseDamage * (1 + v)); break;
      case 'attackSpeed': stats.attackSpeed = f2(stats.attackSpeed * (1 + v)); break;
      case 'critChance': stats.critChance = f3(stats.critChance + v); break;
      case 'critDamage': stats.critDamage = f2(stats.critDamage + v); break;
      case 'bossDamageMod': stats.bossDamageMod = f3(stats.bossDamageMod + v); break;
      case 'waveDamageMod': stats.waveDamageMod = f3(stats.waveDamageMod + v); break;
      case 'shieldDamageMod': stats.shieldDamageMod = f3(stats.shieldDamageMod + v); break;
      case 'armorDamageMod': stats.armorDamageMod = f3(stats.armorDamageMod + v); break;
      case 'offlineEarningsMod': stats.offlineEarningsMod = f3(stats.offlineEarningsMod + v); break;
      case 'rareDropChanceMod': stats.rareDropChanceMod = f3(stats.rareDropChanceMod + v); break;
      case 'scrapYieldMod': stats.scrapYieldMod = f3(stats.scrapYieldMod + v); break;
      default: break; // activity modules and unknown stats are never baked
    }
  }
}

/** Exact inverse of bakeWeaponAffixes (reverse order). */
export function unbakeWeaponAffixes(stats: WeaponStatBag, affixes: Affix[]): void {
  for (let i = affixes.length - 1; i >= 0; i--) {
    const v = affixes[i].value;
    switch (affixes[i].stat) {
      // No rounding here: weapon parts scale the pre-bake bases by
      // fractional factors, so the true bases are fractional (and
      // attack speed's quotient needs its full precision — snapping
      // it to the bake grid flips rounding boundaries on rebake).
      // Plain division recovers the base; the rebake's own rounding
      // restores the stored stat, and the round trip stays exact.
      case 'baseDamage': stats.baseDamage = stats.baseDamage / (1 + v); break;
      case 'attackSpeed': stats.attackSpeed = stats.attackSpeed / (1 + v); break;
      case 'critChance': stats.critChance = f3(stats.critChance - v); break;
      case 'critDamage': stats.critDamage = f2(stats.critDamage - v); break;
      case 'bossDamageMod': stats.bossDamageMod = f3(stats.bossDamageMod - v); break;
      case 'waveDamageMod': stats.waveDamageMod = f3(stats.waveDamageMod - v); break;
      case 'shieldDamageMod': stats.shieldDamageMod = f3(stats.shieldDamageMod - v); break;
      case 'armorDamageMod': stats.armorDamageMod = f3(stats.armorDamageMod - v); break;
      case 'offlineEarningsMod': stats.offlineEarningsMod = f3(stats.offlineEarningsMod - v); break;
      case 'rareDropChanceMod': stats.rareDropChanceMod = f3(stats.rareDropChanceMod - v); break;
      case 'scrapYieldMod': stats.scrapYieldMod = f3(stats.scrapYieldMod - v); break;
      default: break;
    }
  }
}

export interface ShieldStatBag {
  hp: number;
  rechargeRate: number;
  mitigation: number;
}

export function bakeShieldAffixes(stats: ShieldStatBag, affixes: Affix[]): void {
  for (const affix of affixes) {
    const v = affix.value;
    switch (affix.stat) {
      case 'hp': stats.hp = Math.round(stats.hp * (1 + v)); break;
      case 'rechargeRate': stats.rechargeRate = f1(stats.rechargeRate * (1 + v)); break;
      case 'mitigation': stats.mitigation = f3(stats.mitigation + v); break;
      default: break;
    }
  }
}

export function unbakeShieldAffixes(stats: ShieldStatBag, affixes: Affix[]): void {
  for (let i = affixes.length - 1; i >= 0; i--) {
    const v = affixes[i].value;
    switch (affixes[i].stat) {
      case 'hp': stats.hp = Math.round(stats.hp / (1 + v)); break;
      case 'rechargeRate': stats.rechargeRate = f1(stats.rechargeRate / (1 + v)); break;
      case 'mitigation': stats.mitigation = f3(stats.mitigation - v); break;
      default: break;
    }
  }
}

export interface OrdnanceStatBag {
  damage: number;
  shieldDamage: number;
  armorDamage: number;
}

export function bakeOrdnanceAffixes(stats: OrdnanceStatBag, affixes: Affix[]): void {
  for (const affix of affixes) {
    const v = affix.value;
    switch (affix.stat) {
      case 'damage': stats.damage = Math.round(stats.damage * (1 + v)); break;
      case 'shieldDamage': stats.shieldDamage = Math.round(stats.shieldDamage * (1 + v)); break;
      case 'armorDamage': stats.armorDamage = Math.round(stats.armorDamage * (1 + v)); break;
      default: break;
    }
  }
}

export function unbakeOrdnanceAffixes(stats: OrdnanceStatBag, affixes: Affix[]): void {
  for (let i = affixes.length - 1; i >= 0; i--) {
    const v = affixes[i].value;
    switch (affixes[i].stat) {
      case 'damage': stats.damage = Math.round(stats.damage / (1 + v)); break;
      case 'shieldDamage': stats.shieldDamage = Math.round(stats.shieldDamage / (1 + v)); break;
      case 'armorDamage': stats.armorDamage = Math.round(stats.armorDamage / (1 + v)); break;
      default: break;
    }
  }
}

/**
 * The weapon power scores, computed exactly as the generator computes
 * them (combatPower through the one DPS chain; boss/farm/economy are
 * the generator's composites over the baked stat block).
 */
export function computeWeaponPowerScores(weapon: Weapon): {
  combatPower: number;
  bossPower: number;
  farmPower: number;
  economyScore: number;
} {
  const combatPower = Math.round(computeStandardDps(weapon));
  const bossPower = Math.round(combatPower * (1 + weapon.bossDamageMod) * (1 + weapon.shieldDamageMod * 0.3) * (1 + weapon.armorDamageMod * 0.3));
  const farmPower = Math.round(combatPower * (1 + weapon.waveDamageMod) * (1 + weapon.attackSpeed * 0.2));
  const economyScore = Math.round((weapon.rareDropChanceMod + weapon.scrapYieldMod + weapon.offlineEarningsMod) * 100);
  return { combatPower, bossPower, farmPower, economyScore };
}

// ---------------------------------------------------------------------------
// The reforge roll
// ---------------------------------------------------------------------------

/** One def draw using the generator's own pick procedure for the kind. */
function pickPoolDef(kind: ReforgeKind, rng: () => number): AffixPoolDef {
  if (kind === 'weapon') {
    const pool = seededRandom(0, 1, rng) > 0.7
      ? (seededRandom(0, 1, rng) > 0.5 ? WEAPON_BOSS_POOL : WEAPON_IDLE_POOL)
      : WEAPON_COMBAT_POOL;
    return pool[seededInt(0, pool.length - 1, rng)];
  }
  const defs = affixPoolDefsFor(kind);
  return defs[seededInt(0, defs.length - 1, rng)];
}

function makeAffix(kind: ReforgeKind, def: AffixPoolDef, index: number, rollVal: number): Affix {
  return {
    id: `${def.stat}_${index}`,
    category: affixCategoryFor(kind, def),
    stat: def.stat,
    value: rollVal / 100,
    displayText: def.text.replace('{v}', String(rollVal)),
  };
}

/**
 * Roll the replacement for the affix at `affixIndex`, on the caller's
 * RNG stream (the write stores pass a dedicated stream seeded from
 * the op nonce, so a replayed op reproduces the identical roll).
 *
 * Exclusion ladder (the brief's "no duplicates, never the same affix"
 * rule, applied as far as the pool allows):
 *  1. stats already carried by the item's OTHER affixes are excluded;
 *  2. the replaced affix's own stat is also excluded whenever any
 *     other legal stat remains;
 *  3. when the pool is exhausted by (1) — small pools (shield,
 *     ordnance, class mod) at high affix counts, where generation
 *     itself rolls duplicates — the replaced stat stays in play but
 *     its value re-rolls until it differs from the old value, so a
 *     reforge can never return the identical affix it consumed.
 * Draws follow the generator's pick procedure, rejection-sampled on
 * the exclusion set: the result is the generator's own distribution
 * conditioned on legality.
 */
export function rollReforgeAffix(
  kind: ReforgeKind,
  item: GearItem,
  affixIndex: number,
  rng: () => number,
): Affix {
  const affixes = item.affixes ?? [];
  const target = affixes[affixIndex];
  const otherStats = new Set(
    affixes.filter((_, i) => i !== affixIndex).map((a) => a.stat),
  );
  const universe = new Set(affixPoolDefsFor(kind).map((d) => d.stat));
  const freshStats = [...universe].filter((s) => !otherStats.has(s) && s !== target.stat);

  const excluded = new Set(otherStats);
  if (freshStats.length > 0) {
    excluded.add(target.stat);
  } else if (otherStats.has(target.stat)) {
    // Last resort: duplicates elsewhere already carry the stat; the
    // replaced slot may re-roll its own stat (with a new value).
    excluded.delete(target.stat);
  }

  for (let attempt = 0; attempt < 128; attempt++) {
    const def = pickPoolDef(kind, rng);
    if (excluded.has(def.stat)) continue;
    const rollVal = seededInt(def.min, def.max, rng);
    if (def.stat === target.stat && rollVal / 100 === target.value) continue;
    return makeAffix(kind, def, affixIndex, rollVal);
  }

  // Deterministic fallback (unreachable with a fair RNG; keeps the op
  // total): first legal def in pool order, value re-rolled in band,
  // forced off the old value when the stat is unchanged.
  const defs = affixPoolDefsFor(kind);
  const legal = defs.filter((d) => !excluded.has(d.stat));
  const def = legal[0] ?? defs.find((d) => d.stat === target.stat) ?? defs[0];
  let rollVal = seededInt(def.min, def.max, rng);
  if (def.stat === target.stat && rollVal / 100 === target.value) {
    rollVal = rollVal >= def.max ? def.min : rollVal + 1;
  }
  return makeAffix(kind, def, affixIndex, rollVal);
}

/**
 * Apply a reforge to a gear item: swap the affix at `affixIndex` for
 * a fresh pool roll and recompute every derived field the swap moves
 * (baked stats for weapon/shield/ordnance, weapon power scores).
 * Identity fields — rarity, level, type, manufacturer, element,
 * rollQuality, legendaryEffectId, parts, tree/node boosts, shield
 * behavior — are never touched: the swap goes through unbake →
 * replace → rebake so the OTHER affixes' baked contributions stay
 * bit-identical, and class mods / relics (unbaked affixes) change
 * only the affix entry itself.
 */
export function applyReforgeToItem<T extends GearItem>(
  kind: ReforgeKind,
  item: T,
  affixIndex: number,
  rng: () => number,
): { item: T; oldAffix: Affix; newAffix: Affix } {
  const next = structuredClone(item);
  const oldAffix = structuredClone(next.affixes[affixIndex]);
  const newAffix = rollReforgeAffix(kind, next, affixIndex, rng);

  if (kind === 'weapon') {
    const weapon = next as Weapon;
    const bag: WeaponStatBag = weapon;
    unbakeWeaponAffixes(bag, weapon.affixes);
    weapon.affixes[affixIndex] = newAffix;
    bakeWeaponAffixes(bag, weapon.affixes);
    Object.assign(weapon, computeWeaponPowerScores(weapon));
  } else if (kind === 'shield') {
    const shield = next as Shield;
    // The stored stats carry the behavior's generation transform
    // (Turtle). Invert it, swap the affix in the untransformed
    // space, and re-apply — the behavior itself never changes.
    const behavior = shieldBehaviorOf(shield);
    const inverted = invertShieldBehaviorGenerationStats(behavior, {
      hp: shield.hp,
      rechargeRate: shield.rechargeRate,
    });
    const bag: ShieldStatBag = {
      hp: inverted.hp,
      rechargeRate: inverted.rechargeRate,
      mitigation: shield.mitigation,
    };
    unbakeShieldAffixes(bag, shield.affixes);
    shield.affixes[affixIndex] = newAffix;
    bakeShieldAffixes(bag, shield.affixes);
    const reapplied = applyShieldBehaviorGenerationStats(behavior, bag);
    shield.hp = reapplied.hp;
    shield.rechargeRate = reapplied.rechargeRate;
    shield.mitigation = bag.mitigation;
  } else if (kind === 'ordnance') {
    const ordnance = next as Ordnance;
    const bag: OrdnanceStatBag = ordnance;
    unbakeOrdnanceAffixes(bag, ordnance.affixes);
    ordnance.affixes[affixIndex] = newAffix;
    bakeOrdnanceAffixes(bag, ordnance.affixes);
  } else {
    // Class mods and relics read affixes at runtime — nothing is
    // baked, so the entry swap is the whole mutation.
    (next as ClassMod | Relic).affixes[affixIndex] = newAffix;
  }

  return { item: next, oldAffix, newAffix };
}
