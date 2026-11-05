/**
 * Inventory sort — the ONE taxonomy + ordering engine for the Gear
 * inventory list (GearHub). Extracted from GearHub so the semantics
 * are unit-pinned and no second picker can grow its own sort truth.
 *
 * The taxonomy follows the owner's structure (2026-11-05):
 *
 *   - GENERAL group first: keys that mean something for every item
 *     (Best Overall stays the default).
 *   - One labeled group per gear kind, built ONLY from stats that
 *     kind really carries (the itemStatDeck fields — no invented
 *     keys). Weapon DPS is the real number: `computeStandardDps`
 *     from the one DPS chain, never an inline formula and never the
 *     combatPower proxy the old per-kind menu mislabeled as "DPS".
 *   - Vehicles are NOT in this taxonomy: a vehicle is deliberately
 *     not part of the GearItem union (see src/types/items.ts) and
 *     never enters this inventory list — it lives in the Garage.
 *
 * SCOPING (owner correction, 2026-11-05 — the sink rule is dead):
 * picking a kind-group key SCOPES the list to that kind by driving
 * the inventory's existing kind filter (`activeKind`) — sorting by
 * Shield HP means "show me shields, best first", not "shields float
 * above fifty sunk items". The pure transitions below own the state
 * interaction:
 *
 *   - applySortPick(kind key)  → kind filter set to that kind,
 *     sortScope records the kind as SORT-DRIVEN.
 *   - applySortPick(general)   → if the current kind filter is the
 *     sort-driven scope, it clears back to All; if the player set
 *     the kind filter independently (kind rail), it stays.
 *   - applyKindPick (kind rail / clear) → the filter becomes the
 *     player's own: sortScope clears, and a sort key belonging to a
 *     different kind falls back to Best Overall rather than lying
 *     about what the list is ordered by.
 *
 * Ordering: equipped items pin first (the list's long-standing
 * behavior, both directions). Within that, the key's value rules;
 * ties keep the list's incoming order (stable). 'recent' reads the
 * incoming order directly — the store hands the list newest-first.
 */
import { computeStandardDps } from '@/lib/stats/dpsChain';
import {
  affixesOf,
  affixValue,
  isClassMod,
  isOrdnance,
  isShield,
  isWeapon,
  sumNodeBoosts,
  topActivityModule,
} from '@/lib/gear/gearCardSummary';
import { projectSalvageYield } from '@/lib/gear/salvageAward';
import type { GearItem } from '@/types/items';

export type GearKind = 'all' | 'weapon' | 'shield' | 'ordnance' | 'classMod' | 'relic';

export type SortKey =
  | 'combatPower'
  | 'bossPower'
  | 'farmPower'
  | 'economy'
  | 'level'
  | 'rarity'
  | 'rollQuality'
  | 'name'
  | 'recent'
  | 'dps'
  | 'damage'
  | 'critChance'
  | 'critDamage'
  | 'statusChance'
  | 'attackSpeed'
  | 'shieldHp'
  | 'mitigation'
  | 'recharge'
  | 'payload'
  | 'shieldBreak'
  | 'armorBreak'
  | 'skillBoost'
  | 'nodeCount'
  | 'affixCount'
  | 'activityValue'
  | 'idleValue'
  | 'dropValue'
  | 'scrapValue'
  | 'salvageScrap';

export type SortDir = 'desc' | 'asc';

export interface SortOption {
  key: SortKey;
  label: string;
}

export interface SortGroup {
  id: string;
  /** Menu section header. Kind groups say what they do: sorting by
   *  a stat in the group also scopes the list to that kind. */
  label: string;
  /** The kind this group's keys scope to; null for General. */
  kind: Exclude<GearKind, 'all'> | null;
  options: SortOption[];
}

export const SORT_GROUPS: SortGroup[] = [
  {
    id: 'general',
    label: 'General',
    kind: null,
    options: [
      { key: 'combatPower', label: 'Best Overall' },
      { key: 'rarity', label: 'Rarity' },
      { key: 'level', label: 'Item Level' },
      { key: 'recent', label: 'Newest' },
      { key: 'name', label: 'Name A–Z' },
      { key: 'activityValue', label: 'Activity Value' },
      { key: 'affixCount', label: 'Affix Count' },
      { key: 'salvageScrap', label: 'Salvage Value' },
    ],
  },
  {
    id: 'weapon',
    label: 'Weapon Stats',
    kind: 'weapon',
    options: [
      { key: 'dps', label: 'DPS' },
      { key: 'damage', label: 'Damage' },
      { key: 'critChance', label: 'Crit Chance' },
      { key: 'critDamage', label: 'Crit Damage' },
      { key: 'statusChance', label: 'Status Chance' },
      { key: 'attackSpeed', label: 'Attack Speed' },
      { key: 'bossPower', label: 'Boss Power' },
      { key: 'farmPower', label: 'Farm Power' },
      { key: 'rollQuality', label: 'Roll Quality' },
      { key: 'economy', label: 'Economy' },
    ],
  },
  {
    id: 'shield',
    label: 'Shield Stats',
    kind: 'shield',
    options: [
      { key: 'shieldHp', label: 'Shield HP' },
      { key: 'mitigation', label: 'Mitigation' },
      { key: 'recharge', label: 'Recharge Rate' },
    ],
  },
  {
    id: 'ordnance',
    label: 'Ordnance Stats',
    kind: 'ordnance',
    options: [
      { key: 'payload', label: 'Payload' },
      { key: 'shieldBreak', label: 'Shield Damage' },
      { key: 'armorBreak', label: 'Armor Damage' },
    ],
  },
  {
    id: 'classMod',
    label: 'Class Mod Stats',
    kind: 'classMod',
    options: [
      { key: 'skillBoost', label: 'Node Boost' },
      { key: 'nodeCount', label: 'Boosted Nodes' },
    ],
  },
  {
    id: 'relic',
    label: 'Relic Stats',
    kind: 'relic',
    options: [
      { key: 'idleValue', label: 'Idle Value' },
      { key: 'dropValue', label: 'Drop Value' },
      { key: 'scrapValue', label: 'Scrap Yield' },
    ],
  },
];

const OPTION_BY_KEY = new Map<SortKey, SortOption>(
  SORT_GROUPS.flatMap((group) => group.options.map((option) => [option.key, option] as const)),
);
const GROUP_KIND_BY_KEY = new Map<SortKey, Exclude<GearKind, 'all'> | null>(
  SORT_GROUPS.flatMap((group) => group.options.map((option) => [option.key, group.kind] as const)),
);

export const isSortKey = (value: unknown): value is SortKey =>
  typeof value === 'string' && OPTION_BY_KEY.has(value as SortKey);

export const sortLabel = (key: SortKey): string => OPTION_BY_KEY.get(key)?.label ?? 'Sort';

/** The kind a key scopes to, or null for General keys. */
export const sortGroupKind = (key: SortKey): Exclude<GearKind, 'all'> | null =>
  GROUP_KIND_BY_KEY.get(key) ?? null;

/** The direction a key reads naturally in: stats highest-first,
 *  names A–Z, newest first. Picking a key resets to this; the
 *  direction toggle flips from there. */
export const naturalDir = (key: SortKey): SortDir => (key === 'name' ? 'asc' : 'desc');

const RARITY_RANK: Record<string, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 3,
  Epic: 4,
  Legendary: 5,
};

export interface SortContext {
  /** The player's own skill bonuses (computeSkillBonuses record) —
   *  the salvage projection is priced in the player's hands, the
   *  same number the inspect sheet quotes. */
  bonuses: Record<string, number>;
}

// Real DPS per item object, computed once: the chain prices a
// weapon against the standard target exactly as the stat deck
// prints it. Keyed by object identity — a replaced store row is a
// new object and recomputes; a stable row never does.
const dpsCache = new WeakMap<GearItem, number>();
export function weaponDps(item: GearItem): number {
  if (!isWeapon(item)) return 0;
  const cached = dpsCache.get(item);
  if (cached !== undefined) return cached;
  const dps = computeStandardDps(item);
  dpsCache.set(item, dps);
  return dps;
}

export function itemComparable(item: GearItem, key: SortKey, ctx: SortContext): number {
  const activity = topActivityModule(item)?.value ?? 0;
  switch (key) {
    case 'combatPower': return isWeapon(item) ? item.combatPower : isShield(item) ? item.hp : isOrdnance(item) ? item.damage : affixesOf(item).length * 20;
    case 'bossPower': return isWeapon(item) ? item.bossPower : affixValue(item, ['bossDamageMod', 'survivalBoost']);
    case 'farmPower': return isWeapon(item) ? item.farmPower : affixValue(item, ['creditsPerKill', 'rareDropChanceMod', 'xpBoostMod']);
    case 'economy': return isWeapon(item) ? item.economyScore : affixValue(item, ['offlineEarningsMod', 'rareDropChanceMod', 'scrapYieldMod']) * 100;
    case 'level': return item.level ?? 1;
    case 'rarity': return RARITY_RANK[item.rarity] ?? 0;
    case 'rollQuality': return isWeapon(item) ? item.rollQuality : activity * 100;
    case 'dps': return weaponDps(item);
    case 'damage': return isWeapon(item) ? item.baseDamage : 0;
    case 'critChance': return isWeapon(item) ? item.critChance : 0;
    case 'critDamage': return isWeapon(item) ? item.critDamage : 0;
    case 'statusChance': return isWeapon(item) ? item.statusChance : 0;
    case 'attackSpeed': return isWeapon(item) ? item.attackSpeed : 0;
    case 'shieldHp': return isShield(item) ? item.hp : 0;
    case 'mitigation': return isShield(item) ? item.mitigation : 0;
    case 'recharge': return isShield(item) ? item.rechargeRate : 0;
    case 'payload': return isOrdnance(item) ? item.damage : 0;
    case 'shieldBreak': return isOrdnance(item) ? item.shieldDamage : isWeapon(item) ? item.shieldDamageMod : 0;
    case 'armorBreak': return isOrdnance(item) ? item.armorDamage : isWeapon(item) ? item.armorDamageMod : 0;
    case 'skillBoost': return sumNodeBoosts(item) + affixValue(item, ['skillPoints', 'weaponDamage', 'critChance']) * 100;
    case 'nodeCount': return isClassMod(item) ? Object.keys(item.nodeBoosts).length : 0;
    case 'affixCount': return affixesOf(item).length;
    case 'activityValue': return activity * 100;
    case 'idleValue': return affixValue(item, ['offlineEarningsMod', 'offlineScrapMod', 'offlineXpMod', 'offlineMaterialMod']) * 100;
    case 'dropValue': return affixValue(item, ['rareDropChanceMod', 'cacheKeyChanceMod', 'cacheFragmentChance', 'materialFindChance']) * 100;
    case 'scrapValue': return affixValue(item, ['scrapYieldMod', 'salvageYield', 'rareMaterialChance', 'essenceExtraction']) * 100;
    case 'salvageScrap': return projectSalvageYield(item, ctx.bonuses).scrapValue;
    case 'name':
    case 'recent':
    default:
      return 0;
  }
}

/**
 * Order a list by a key + direction. Pure: returns a new array,
 * never mutates. Equipped items pin first in both directions (the
 * inventory's standing behavior); all other ties keep the incoming
 * order, which for 'recent' IS the sort (store order, newest first).
 */
export function sortItems(
  items: GearItem[],
  key: SortKey,
  dir: SortDir,
  equippedIds: ReadonlySet<string>,
  ctx: SortContext,
): GearItem[] {
  const sign = dir === 'desc' ? -1 : 1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aEq = equippedIds.has(a.item.id) ? 1 : 0;
      const bEq = equippedIds.has(b.item.id) ? 1 : 0;
      if (aEq !== bEq) return bEq - aEq;
      if (key === 'name') {
        const byName = a.item.name.localeCompare(b.item.name);
        if (byName !== 0) return byName * sign;
        return a.index - b.index;
      }
      if (key === 'recent') {
        return dir === 'desc' ? a.index - b.index : b.index - a.index;
      }
      const ca = itemComparable(a.item, key, ctx);
      const cb = itemComparable(b.item, key, ctx);
      if (ca !== cb) return (cb - ca) * (dir === 'desc' ? 1 : -1);
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

// ── UI state transitions (pure; GearHub holds the state) ────────────

export interface SortUiState {
  sort: SortKey;
  dir: SortDir;
  activeKind: GearKind;
  /** The kind the current filter was set BY a sort pick, if any.
   *  Null when the filter is the player's own (kind rail) or All. */
  sortScope: Exclude<GearKind, 'all'> | null;
}

export const DEFAULT_SORT_STATE: SortUiState = {
  sort: 'combatPower',
  dir: 'desc',
  activeKind: 'all',
  sortScope: null,
};

/** Restore from a persisted sort key + direction: scope derives
 *  from the key's group (a kind key reopens scoped to its kind). */
export function sortStateFromPersisted(key: SortKey, dir: SortDir): SortUiState {
  const kind = sortGroupKind(key);
  return kind
    ? { sort: key, dir, activeKind: kind, sortScope: kind }
    : { sort: key, dir, activeKind: 'all', sortScope: null };
}

export function applySortPick(state: SortUiState, key: SortKey): SortUiState {
  const kind = sortGroupKind(key);
  if (kind) {
    return { sort: key, dir: naturalDir(key), activeKind: kind, sortScope: kind };
  }
  // General keys never scope. A sort-driven scope clears; an
  // independently set kind filter is the player's and stays.
  const clearsScope = state.sortScope !== null && state.activeKind === state.sortScope;
  return {
    sort: key,
    dir: naturalDir(key),
    activeKind: clearsScope ? 'all' : state.activeKind,
    sortScope: null,
  };
}

export function applyKindPick(state: SortUiState, kind: GearKind): SortUiState {
  const sortKind = sortGroupKind(state.sort);
  const sortFits = sortKind === null || sortKind === kind;
  return {
    sort: sortFits ? state.sort : 'combatPower',
    dir: sortFits ? state.dir : naturalDir('combatPower'),
    activeKind: kind,
    sortScope: null,
  };
}

export function toggleSortDir(state: SortUiState): SortUiState {
  return { ...state, dir: state.dir === 'desc' ? 'asc' : 'desc' };
}
