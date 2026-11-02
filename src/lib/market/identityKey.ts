/**
 * identityKey — the ONE item-identity key scheme for market price
 * history (market depth slice, migration 0019).
 *
 * Price intelligence is only useful if "the same kind of thing" maps
 * to the same key on both sides of a sale: the key stamped onto a
 * listing when it is created, and the key a seller computes locally
 * when asking "what do these sell for?" before listing. This module
 * is that scheme; the SQL twin lives in migration 0019
 * (cc_market_gear_identity / cc_market_consumable_identity) and parity
 * is pinned by tests.
 *
 * Key shapes:
 *   gear weapon:    gear:weapon:{weaponType}:{rarity}:b{levelBand}
 *   gear other:     gear:{category}:{rarity}:b{levelBand}
 *   consumable:     cons:{consumableType}:{qualityBand}
 *   material:       mat:{materialId}
 *   fragment:       frag:cache            (0050 — one commodity)
 *   core:           core:legendary        (0050 — one commodity)
 *   essence:        ess:{essenceId}       (0050 — per essence type)
 *
 * Why these axes:
 *   - Gear price is driven by what the item IS (weapon type / gear
 *     category), its rarity, and its level — the three numbers a
 *     buyer compares. Element and manufacturer are deliberately NOT
 *     in the key: at ~1,000 players they would fragment every key
 *     into single-sale buckets and the medians would be noise. Level
 *     is banded in 10s for the same reason (a Lv.21 and a Lv.29
 *     pistol compete with each other; a Lv.3 does not).
 *   - Consumables have no rarity or level; their price axis is the
 *     batch quality %, banded around the shipped craft ranges
 *     (crafted quality rolls ~70–150, vendor stock is exactly 100):
 *     q0 ≤79 · q1 80–100 · q2 101–120 · q3 121–140 · q4 ≥141.
 *   - Materials are fungible — the material id IS the identity.
 */
import { CONSUMABLES } from '../../constants/consumables';
import { EssenceType, MaterialType } from '../../types/game';
import type { GearItem } from '../../types/items';

export type MarketCategory =
  | 'weapon' | 'shield' | 'relic' | 'classMod' | 'ordnance'
  | 'consumable' | 'material' | 'vehicle'
  | 'fragment' | 'core' | 'essence';

export const MARKET_CATEGORY_LABELS: Record<MarketCategory, string> = {
  weapon: 'Weapons',
  shield: 'Shields',
  relic: 'Relics',
  classMod: 'Class Mods',
  ordnance: 'Ordnance',
  consumable: 'Consumables',
  material: 'Materials',
  vehicle: 'Vehicles',
  fragment: 'Cache Fragments',
  core: 'Legendary Cores',
  essence: 'Essences',
};

/**
 * Vehicle identity (0021): class + rarity. A vehicle's price is
 * driven by what it is (class) and its rarity; level is the class
 * gate, not a roll axis, and affix rolls are too granular to bucket
 * at this population — same reasoning as the gear key.
 */
export function vehicleIdentityKey(vehicleClassId: string, rarity: string | null | undefined): string {
  return `vehicle:${vehicleClassId || 'unknown'}:${rarity || 'Common'}`;
}

/** The five profile material keys (MaterialType) — the listable materials. */
export const MARKET_MATERIAL_IDS: readonly string[] = Object.values(MaterialType);

/** 10-level bands: Lv.1–10 → 0, 11–20 → 1, … */
export function levelBand(level: number | null | undefined): number {
  const lv = Math.max(1, Math.floor(Number(level) || 1));
  return Math.floor((lv - 1) / 10);
}

export type ConsumableQualityBand = 'q0' | 'q1' | 'q2' | 'q3' | 'q4';

export function qualityBand(qualityPercent: number | null | undefined): ConsumableQualityBand {
  const q = Number(qualityPercent) || 100;
  if (q <= 79) return 'q0';
  if (q <= 100) return 'q1';
  if (q <= 120) return 'q2';
  if (q <= 140) return 'q3';
  return 'q4';
}

export const QUALITY_BAND_LABELS: Record<ConsumableQualityBand, string> = {
  q0: '≤79%',
  q1: '80–100%',
  q2: '101–120%',
  q3: '121–140%',
  q4: '≥141%',
};

export function gearIdentityKey(input: {
  category: MarketCategory;
  weaponType?: string | null;
  rarity?: string | null;
  level?: number | null;
}): string {
  const rarity = input.rarity || 'Common';
  const band = `b${levelBand(input.level)}`;
  if (input.category === 'weapon') {
    return `gear:weapon:${input.weaponType || 'Unknown'}:${rarity}:${band}`;
  }
  return `gear:${input.category}:${rarity}:${band}`;
}

export function consumableIdentityKey(consumableType: string, qualityPercent: number | null | undefined): string {
  return `cons:${consumableType}:${qualityBand(qualityPercent)}`;
}

export function materialIdentityKey(materialId: string): string {
  return `mat:${materialId}`;
}

/**
 * Sellable resources (0050): cache fragments, legendary cores, and
 * essences join the market as quantity commodities. Fragments and
 * cores are single fungible commodities (one identity each); each
 * essence type is its own commodity, mirroring materials.
 */
export const FRAGMENT_IDENTITY_KEY = 'frag:cache';
export const CORE_IDENTITY_KEY = 'core:legendary';
export const FRAGMENT_DISPLAY_NAME = 'Cache Fragment';
export const CORE_DISPLAY_NAME = 'Legendary Core';

/** The five profile essence keys (EssenceType) — the listable essences. */
export const MARKET_ESSENCE_IDS: readonly string[] = Object.values(EssenceType);

/** Display names for essences — labels owned by src/constants/visualAssets.ts. */
export const ESSENCE_DISPLAY_NAMES: Record<string, string> = {
  [EssenceType.IgnitionFluid]: 'Ignition Fluid',
  [EssenceType.ConduitWire]: 'Conduit Wire',
  [EssenceType.AcidCompound]: 'Acid Compound',
  [EssenceType.CryoGel]: 'Cryo Gel',
  [EssenceType.VoidEssence]: 'Void Essence',
};

export function essenceIdentityKey(essenceId: string): string {
  return `ess:${essenceId}`;
}

export function essenceDisplayName(essenceId: string): string {
  return ESSENCE_DISPLAY_NAMES[essenceId] ?? essenceId;
}

/**
 * Gear category from an item payload — the SAME discriminator rule the
 * database itself uses to classify generated items (migration 0007's
 * cc_* item insert: weaponType → weapon, mitigation → shield,
 * treeBonus → classMod, damage → ordnance, affixes → relic), with the
 * row's kind column ('weapon', 'gear:weapon', …) as fallback.
 */
export function gearCategoryFromPayload(
  payload: Record<string, unknown> | null | undefined,
  kind?: string | null,
): MarketCategory {
  const p = payload ?? {};
  if ('weaponType' in p) return 'weapon';
  if ('mitigation' in p || 'hp' in p) return 'shield';
  if ('treeBonus' in p) return 'classMod';
  if ('damage' in p) return 'ordnance';
  if ('affixes' in p) return 'relic';
  const fromKind = (kind ?? '').replace(/^gear:/, '');
  if (fromKind === 'weapon' || fromKind === 'shield' || fromKind === 'classMod'
    || fromKind === 'ordnance' || fromKind === 'relic') {
    return fromKind;
  }
  return 'relic';
}

/** Identity key for a gear payload (server rows) — level/rarity from the row when given. */
export function gearIdentityFromPayload(
  payload: Record<string, unknown> | null | undefined,
  opts?: { kind?: string | null; rarity?: string | null; level?: number | null },
): string {
  const p = payload ?? {};
  const category = gearCategoryFromPayload(p, opts?.kind);
  return gearIdentityKey({
    category,
    weaponType: typeof p.weaponType === 'string' ? p.weaponType : null,
    rarity: opts?.rarity ?? (typeof p.rarity === 'string' ? p.rarity : null),
    level: opts?.level ?? (typeof p.level === 'number' ? p.level : null),
  });
}

/** Identity key for a client-side gear item (the Sell tab guidance lookup). */
export function gearIdentityKeyForItem(item: GearItem): string {
  return gearIdentityFromPayload(item as unknown as Record<string, unknown>, {
    rarity: item.rarity,
    level: item.level ?? 1,
  });
}

/** Display name for a consumable type (CONSUMABLES defs own names). */
export function consumableDisplayName(consumableType: string): string {
  return CONSUMABLES[consumableType]?.name ?? consumableType;
}

/**
 * Whether a consumable type may be listed on the player market — the
 * defs own this (`market.playerMarketAllowed`); every shipped type is
 * allowed except the legacy ElementalCoating. Migration 0019 restates
 * the same exclusion in SQL.
 */
export function consumableListable(consumableType: string): boolean {
  const def = CONSUMABLES[consumableType];
  return def ? def.market.playerMarketAllowed : false;
}
