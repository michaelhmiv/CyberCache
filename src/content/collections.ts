/**
 * Collections + Legendary Cores — content owner (migration 0026).
 *
 * The collection log is the trophy record of what a hunter has
 * actually found and done. Its catalog is FINITE and completable in
 * principle — four families, all derived from the shipped content
 * defs (never hand-maintained copies):
 *
 *   legendary_effect  every effect in LEGENDARY_EFFECTS        (25)
 *   boss              every boss in REGION_1_BOSSES            (13)
 *   weapon_frame      weapon type × manufacturer at Legendary  (36)
 *   named_elite       the named elite of each roaming area      (7)
 *                                                        total  81
 *
 * Discovery is a SERVER fact, never a client claim: the Chef routes
 * record entries through cc_record_discoveries at the moment the
 * underlying fact settles (an item is stored after a claim / boss
 * loot / offline settlement, a cache is forged, a market purchase is
 * delivered, a boss victory is applied, an elite kill is recorded).
 * Rows live in `collection_discoveries`; this module owns the catalog
 * and the item → entry derivation the routes share.
 *
 * Legendary cores are the sink-loop currency minted by salvaging
 * Legendary gear (cc_recycle_item pays them alongside scrap). Their
 * yield formula lives here; the SQL in migration 0026 mirrors it and
 * parity tests pin the two together.
 */
import { LEGENDARY_EFFECTS } from '../constants/legendaryEffects';
import { REGION_1_BOSSES } from '../constants/bosses';
import { WEAPON_TYPES } from '../constants/weaponTypes';
import { MANUFACTURERS } from '../constants/manufacturers';
import { ROAMING_AREAS } from '../constants/roamingAreas';
import { DropSource, Rarity } from '../types/game';

/**
 * The named elite of each roaming area. AREA_VISUALS
 * (src/content/areaPalettes.ts) owns the visual identity including
 * this name, but that module sits behind the pixel palette code and
 * cannot be imported by the server program (tsconfig.server.json) —
 * so the names are recorded here and parity-pinned against
 * AREA_VISUALS by src/test/collections.test.ts.
 */
export const NAMED_ELITES: ReadonlyArray<{ areaId: string; eliteName: string }> = [
  { areaId: 'dustwaste_frontier', eliteName: 'Silt Marshal' },
  { areaId: 'redline_circuit', eliteName: 'Pursuit Prime' },
  { areaId: 'ironwood_bastion', eliteName: 'Thornwarden' },
  { areaId: 'blastforge_yards', eliteName: 'Slag Herald' },
  { areaId: 'prismatek_reactor', eliteName: 'Phase Revenant' },
  { areaId: 'throwtech_dumpnet', eliteName: 'Heap Warden' },
  { areaId: 'helixworks_labyrinth', eliteName: 'Specimen Zero' },
];

export type CollectionFamily = 'legendary_effect' | 'boss' | 'weapon_frame' | 'named_elite';

export const COLLECTION_FAMILIES: readonly CollectionFamily[] = [
  'legendary_effect',
  'boss',
  'weapon_frame',
  'named_elite',
];

export interface CollectionEntry {
  family: CollectionFamily;
  key: string;
  name: string;
  /** Where it comes from — intel, never odds. */
  hint: string;
}

function effectHint(effectId: string): string {
  const def = LEGENDARY_EFFECTS.find((e) => e.id === effectId);
  if (!def) return 'A legendary weapon effect.';
  const parts: string[] = [];
  if (def.eligibleSources.includes(DropSource.BossDrop)) {
    parts.push(`Boss drops, tier ${def.minBossTier ?? 1}+`);
  }
  if (def.eligibleSources.includes(DropSource.CacheForged)) {
    parts.push('can be cache-forged');
  }
  return parts.join(' · ') || 'A legendary weapon effect.';
}

function bossHint(bossId: string): string {
  const def = REGION_1_BOSSES.find((b) => b.id === bossId);
  if (!def) return 'A boss of the wastes.';
  const drops = (def.dedicatedDrops ?? [])
    .map((id) => LEGENDARY_EFFECTS.find((e) => e.id === id)?.name ?? id)
    .join(', ');
  return drops
    ? `Tier ${def.tier} · level ${def.level} · dedicated drops: ${drops}`
    : `Tier ${def.tier} · level ${def.level}`;
}

export const COLLECTION_ENTRIES: readonly CollectionEntry[] = [
  ...LEGENDARY_EFFECTS.map((effect) => ({
    family: 'legendary_effect' as const,
    key: effect.id,
    name: effect.name,
    hint: effectHint(effect.id),
  })),
  ...REGION_1_BOSSES.map((boss) => ({
    family: 'boss' as const,
    key: boss.id,
    name: boss.name,
    hint: bossHint(boss.id),
  })),
  ...Object.values(WEAPON_TYPES).flatMap((typeDef) =>
    Object.values(MANUFACTURERS).map((mfgDef) => ({
      family: 'weapon_frame' as const,
      key: `${typeDef.id}:${mfgDef.id}`,
      name: `${mfgDef.name} ${typeDef.name}`,
      hint: `A Legendary ${typeDef.name} built by ${mfgDef.name}, from any source.`,
    })),
  ),
  ...ROAMING_AREAS.map((area) => ({
    family: 'named_elite' as const,
    key: area.id,
    name: NAMED_ELITES.find((e) => e.areaId === area.id)?.eliteName ?? 'Named Elite',
    hint: `Named elite of ${area.name} — downed when a roaming elite kill escalates there.`,
  })),
];

export const COLLECTION_TOTAL = COLLECTION_ENTRIES.length;

export function collectionEntriesForFamily(family: CollectionFamily): CollectionEntry[] {
  return COLLECTION_ENTRIES.filter((e) => e.family === family);
}

const ENTRY_BY_FAMILY_KEY = new Map(COLLECTION_ENTRIES.map((e) => [`${e.family}:${e.key}`, e]));

export function collectionEntry(family: CollectionFamily, key: string): CollectionEntry | undefined {
  return ENTRY_BY_FAMILY_KEY.get(`${family}:${key}`);
}

// ─── Discovery derivation ────────────────────────────────────────────

export interface DiscoveryRecord {
  family: CollectionFamily;
  entry_key: string;
  source: string;
}

/**
 * The loose shape every item carrier in the codebase can present:
 * generated GearItem objects (Chef results), item_instances rows, and
 * ledger item payloads all expose some subset of these fields, either
 * at the top level or inside `payload`. The derivation reads both.
 */
export interface DiscoveryItemLike {
  kind?: string | null;
  rarity?: string | null;
  level?: number | null;
  item_level?: number | null;
  weaponType?: string | null;
  manufacturer?: string | null;
  legendaryEffectId?: string | null;
  payload?: Record<string, unknown> | null;
}

function field(item: DiscoveryItemLike, key: string): unknown {
  const top = (item as Record<string, unknown>)[key];
  if (top !== undefined && top !== null && top !== '') return top;
  return item.payload?.[key];
}

function strField(item: DiscoveryItemLike, key: string): string | null {
  const value = field(item, key);
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Is this item a weapon? Stored rows carry `kind`; raw generated
 * items (Chef results) don't — they are weapons exactly when they
 * carry a weaponType + manufacturer pair.
 */
export function isWeaponItem(item: DiscoveryItemLike): boolean {
  const kind = strField(item, 'kind');
  if (kind) return kind === 'weapon';
  return !!strField(item, 'weaponType') && !!strField(item, 'manufacturer');
}

/**
 * The collection entries one acquired item proves, if any:
 *  - its legendary effect (weapons rolled with one), and
 *  - its weapon frame, when it is a Legendary weapon.
 * An entry is only emitted when the key exists in the catalog, so a
 * stray payload can never invent a collection row.
 */
export function discoveryEntriesForItem(item: DiscoveryItemLike, source: string): DiscoveryRecord[] {
  const entries: DiscoveryRecord[] = [];
  const effectId = strField(item, 'legendaryEffectId');
  if (effectId && collectionEntry('legendary_effect', effectId)) {
    entries.push({ family: 'legendary_effect', entry_key: effectId, source });
  }
  const rarity = strField(item, 'rarity');
  if (isWeaponItem(item) && rarity === Rarity.Legendary) {
    const weaponType = strField(item, 'weaponType');
    const manufacturer = strField(item, 'manufacturer');
    if (weaponType && manufacturer) {
      const key = `${weaponType}:${manufacturer}`;
      if (collectionEntry('weapon_frame', key)) {
        entries.push({ family: 'weapon_frame', entry_key: key, source });
      }
    }
  }
  return entries;
}

export function bossDiscovery(bossId: string, source = 'boss_victory'): DiscoveryRecord | null {
  return collectionEntry('boss', bossId)
    ? { family: 'boss', entry_key: bossId, source }
    : null;
}

export function eliteDiscovery(areaId: string, source = 'elite_kill'): DiscoveryRecord | null {
  return collectionEntry('named_elite', areaId)
    ? { family: 'named_elite', entry_key: areaId, source }
    : null;
}

// ─── Legendary cores ─────────────────────────────────────────────────

/**
 * Salvage yield of legendary cores for one item (cc_recycle_item's
 * SQL in migration 0026 mirrors this exactly; parity tests pin both):
 *
 *   non-Legendary                                   → 0
 *   Legendary                                       → 1
 *     + item level ≥ 25                             → +1
 *     + item level ≥ 50                             → +1
 *     + a weapon carrying a legendary effect        → +1
 *   (range 1–4)
 *
 * Scarcity: cores gate high-end rerolls, so the faucet must stay a
 * trickle. Roaming legendary weights were already cut to ×0.1
 * (migration 0015 era tuning), a low-level legendary shield is worth
 * exactly one core, and even a top-level effect weapon — the single
 * most valuable salvage in the game — pays four. Nothing multiplies
 * cores: the Scavenger salvage skills and Market Crash's 4× are
 * SCRAP economy (their defs say "scrap"), and they compose with this
 * yield by leaving it untouched — scrap scales, cores don't.
 */
export function legendaryCoreYieldFor(item: DiscoveryItemLike): number {
  if (strField(item, 'rarity') !== Rarity.Legendary) return 0;
  const rawLevel = field(item, 'item_level') ?? field(item, 'level');
  const level = typeof rawLevel === 'number' && Number.isFinite(rawLevel) ? rawLevel : 1;
  let cores = 1;
  if (level >= 25) cores += 1;
  if (level >= 50) cores += 1;
  if (isWeaponItem(item) && strField(item, 'legendaryEffectId')) cores += 1;
  return cores;
}

export const LEGENDARY_CORE_LEVEL_BANDS = { second: 25, third: 50 } as const;
