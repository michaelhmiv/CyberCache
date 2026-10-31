/**
 * Vendor catalog — the ONE source of truth for what the NPC vendor
 * sells, at what price, and what it buys back (Vendor 2a slice).
 *
 * Before this module the vendor's price list existed as three
 * hardcoded copies: the CASE statement inside SQL `cc_vendor_price`
 * (migration 0004), the `VENDOR_CATALOG` record in
 * `src/server/writes/store.ts`, and the `market()` configs in
 * `src/constants/consumables.ts` that the client screen read. This
 * module is now the owner:
 *
 *   - Consumable entries DERIVE from the consumable defs
 *     (`market.vendorStocked` → staple, priced + player-marketable
 *     non-staples → rotation pool). No price is re-typed here.
 *   - Material / essence entries (the five profile materials + five
 *     essences) are defined here — they had no vendor price before.
 *   - The SQL twin lives in migration 0020 (`cc_vendor_catalog()` —
 *     one VALUES list feeding `cc_vendor_price`, `cc_vendor_buy`,
 *     `cc_vendor_sell`), and parity between this module and the SQL
 *     functions is pinned by tests + the real-Postgres harness.
 *
 * Rotation and the Item of the Day are DATE-SEEDED and computed on
 * read — never cron-driven. The same UTC date yields the same stock
 * for every player, on client and server: picks are ordered by
 * `hashString(seed)` (the mulberry-family hash whose SQL twin is
 * `cc_hash_string`), so the SQL functions reproduce the exact picks
 * this module makes. Stock rolls at UTC midnight. Rotating stock is
 * INFINITE (variety rotates daily; the shipped vendor model has no
 * stock counts and none are invented here).
 *
 * Prices are integer credits everywhere on the vendor path: the
 * Item of the Day discount is applied per unit and floored
 * (`floor(base × 0.75)`), and buyback payouts floor once per sale
 * (`floor(total value × rate)`) — the same floor convention as the
 * market fee (migration 0017), so no fractional credits ever arise
 * here and the 0009/0010 remainder columns are never touched.
 */
import { CONSUMABLES } from '../../constants/consumables';
import type { ConsumableDef } from '../../types/consumables';
import { EssenceType, MaterialType } from '../../types/game';
import { hashString } from '../utils/rng';

export type VendorItemKind = 'consumable' | 'material' | 'essence';

/** Item of the Day discount: 25% off the base price, per unit, floored. */
export const ITEM_OF_THE_DAY_DISCOUNT_RATE = 0.25;

/**
 * Default vendor buyback rate (fraction of vendor value paid out).
 * The live value is the `vendorBuybackRate` economy lever
 * (src/server/economy/config.ts); this constant is its code default
 * and the client display preview's rate.
 */
export const VENDOR_BUYBACK_RATE_DEFAULT = 0.4;

/** Rotating slots per day: 2 consumables + 1 material/essence. */
export const VENDOR_ROTATION_CONSUMABLE_SLOTS = 2;
export const VENDOR_ROTATION_MATERIAL_SLOTS = 1;

export interface VendorMaterialEntry {
  id: string;
  name: string;
  kind: 'material' | 'essence';
  /** Vendor unit price — also the buyback base value per unit. */
  unitPrice: number;
}

/**
 * Material + essence vendor values. Priced so that crafting a staple
 * from vendor-bought materials always costs MORE than the staple
 * itself (the staples are the beginner on-ramp; materials are a
 * convenience), and no buy/sell loop against the vendor can profit:
 * buyback pays a fraction (default 40%) of these same values.
 */
export const VENDOR_MATERIALS: VendorMaterialEntry[] = [
  { id: MaterialType.ScrapAlloy, name: 'Scrap Alloy', kind: 'material', unitPrice: 10 },
  { id: MaterialType.BallisticParts, name: 'Ballistic Parts', kind: 'material', unitPrice: 15 },
  { id: MaterialType.ReactiveComponents, name: 'Reactive Components', kind: 'material', unitPrice: 20 },
  { id: MaterialType.TechFragments, name: 'Tech Fragments', kind: 'material', unitPrice: 35 },
  { id: MaterialType.VoidDust, name: 'Void Dust', kind: 'material', unitPrice: 75 },
  { id: EssenceType.IgnitionFluid, name: 'Ignition Fluid', kind: 'essence', unitPrice: 30 },
  { id: EssenceType.ConduitWire, name: 'Conduit Wire', kind: 'essence', unitPrice: 30 },
  { id: EssenceType.AcidCompound, name: 'Acid Compound', kind: 'essence', unitPrice: 30 },
  { id: EssenceType.CryoGel, name: 'Cryo Gel', kind: 'essence', unitPrice: 30 },
  { id: EssenceType.VoidEssence, name: 'Void Essence', kind: 'essence', unitPrice: 90 },
];

const MATERIAL_BY_ID = new Map(VENDOR_MATERIALS.map((m) => [m.id, m]));
const CONSUMABLE_BY_ID = new Map(Object.values(CONSUMABLES).map((c) => [c.id, c]));

/** The staple consumable defs — always stocked, flat 100% quality. */
export const VENDOR_STAPLE_DEFS: ConsumableDef[] = Object.values(CONSUMABLES).filter(
  (c) => c.market.vendorStocked,
);

/**
 * The rotation consumable pool: priced consumables that are NOT
 * staples and are allowed on markets. `rotatingVendorOnly` defs
 * (Workshop Rush Ticket) live here by design; legacy defs that are
 * neither craftable nor player-marketable (Elemental Coating) are
 * excluded — the vendor never stocks them.
 */
export const VENDOR_ROTATION_DEFS: ConsumableDef[] = Object.values(CONSUMABLES).filter(
  (c) => !c.market.vendorStocked && c.market.playerMarketAllowed && !c.market.vendorExcluded,
);

const STAPLE_IDS = new Set(VENDOR_STAPLE_DEFS.map((c) => c.id));
const ROTATION_IDS = new Set(VENDOR_ROTATION_DEFS.map((c) => c.id));

/** UTC date key (YYYY-MM-DD) — the rotation seed domain. */
export function vendorDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function hashOrder(dateKey: string, domain: string, keys: readonly string[]): string[] {
  return [...keys].sort((a, b) => {
    const ha = hashString(`${domain}:${dateKey}:${a}`);
    const hb = hashString(`${domain}:${dateKey}:${b}`);
    return ha - hb || (a < b ? -1 : a > b ? 1 : 0);
  });
}

export interface VendorRotation {
  dateKey: string;
  /** Consumable ids in today's rotating stock (slot order). */
  consumables: string[];
  /** Material/essence ids in today's rotating stock (slot order). */
  materials: string[];
  /** The discounted item's consumable id for this date. */
  itemOfTheDay: string;
}

/**
 * Today's rotating stock + Item of the Day for a UTC date key.
 * Deterministic: same input → same output, on every client and on
 * the server (SQL twin: cc_vendor_rotation / cc_vendor_item_of_the_day
 * in migration 0020, using cc_hash_string with the same seed strings).
 */
export function vendorRotationForDate(dateKey: string): VendorRotation {
  const consumables = hashOrder(
    dateKey,
    'vendor-rotation',
    VENDOR_ROTATION_DEFS.map((c) => c.id),
  ).slice(0, VENDOR_ROTATION_CONSUMABLE_SLOTS);
  const materials = hashOrder(
    dateKey,
    'vendor-rotation',
    VENDOR_MATERIALS.map((m) => m.id),
  ).slice(0, VENDOR_ROTATION_MATERIAL_SLOTS);
  // The featured item is drawn from what the vendor actually sells
  // that day: the staples plus today's rotating consumables.
  const featuredPool = [...STAPLE_IDS, ...consumables];
  const itemOfTheDay = hashOrder(dateKey, 'vendor-iotd', featuredPool)[0];
  return { dateKey, consumables, materials, itemOfTheDay };
}

/** Base (undiscounted) vendor price for any catalog item, or null. */
export function vendorBasePrice(itemKey: string): number | null {
  const def = CONSUMABLE_BY_ID.get(itemKey);
  if (def) return def.market.vendorPrice;
  return MATERIAL_BY_ID.get(itemKey)?.unitPrice ?? null;
}

/** Catalog kind for an item key, or null when the vendor ignores it. */
export function vendorItemKind(itemKey: string): VendorItemKind | null {
  if (CONSUMABLE_BY_ID.has(itemKey)) return 'consumable';
  const material = MATERIAL_BY_ID.get(itemKey);
  if (material) return material.kind;
  return null;
}

export function isVendorStaple(itemKey: string): boolean {
  return STAPLE_IDS.has(itemKey);
}

export function isVendorRotationItem(itemKey: string): boolean {
  return ROTATION_IDS.has(itemKey) || MATERIAL_BY_ID.has(itemKey);
}

/** The floored per-unit price of the Item of the Day. */
export function discountedUnitPrice(basePrice: number): number {
  return Math.floor(basePrice * (1 - ITEM_OF_THE_DAY_DISCOUNT_RATE));
}

export interface VendorOffer {
  itemKey: string;
  kind: VendorItemKind;
  basePrice: number;
  /** What one unit costs today (discounted when featured). */
  unitPrice: number;
  itemOfTheDay: boolean;
  /** True for the always-stocked staples. */
  staple: boolean;
}

/**
 * What the vendor charges for one unit of `itemKey` on `dateKey` —
 * or null when the item is not on sale that day (a rotation item on
 * a day it does not rotate in, or an item the vendor never sells).
 */
export function vendorOfferFor(itemKey: string, dateKey: string): VendorOffer | null {
  const basePrice = vendorBasePrice(itemKey);
  const kind = vendorItemKind(itemKey);
  if (basePrice === null || kind === null) return null;
  const staple = kind === 'consumable' && STAPLE_IDS.has(itemKey);
  const rotation = vendorRotationForDate(dateKey);
  const rotatingToday =
    kind === 'consumable' ? rotation.consumables.includes(itemKey) : rotation.materials.includes(itemKey);
  if (!staple && !rotatingToday) return null;
  const itemOfTheDay = kind === 'consumable' && rotation.itemOfTheDay === itemKey;
  return {
    itemKey,
    kind,
    basePrice,
    unitPrice: itemOfTheDay ? discountedUnitPrice(basePrice) : basePrice,
    itemOfTheDay,
    staple,
  };
}

/** Everything on sale on `dateKey`, staples first, for display. */
export function vendorStockForDate(dateKey: string): VendorOffer[] {
  const rotation = vendorRotationForDate(dateKey);
  const keys = [
    ...VENDOR_STAPLE_DEFS.map((c) => c.id),
    ...rotation.consumables,
    ...rotation.materials,
  ];
  return keys
    .map((key) => vendorOfferFor(key, dateKey))
    .filter((offer): offer is VendorOffer => offer !== null);
}

/**
 * A consumable batch's vendor value: base price scaled by the
 * batch's quality % (vendor staples are flat 100%, so a vendor-bought
 * batch is worth exactly its base price per unit).
 */
export function consumableUnitVendorValue(itemKey: string, qualityPercent: number): number | null {
  const base = vendorBasePrice(itemKey);
  if (base === null) return null;
  return (base * qualityPercent) / 100;
}

/** Buyback payout for a sale: floor(total vendor value × rate). */
export function vendorBuybackPayout(totalVendorValue: number, rate: number): number {
  return Math.floor(totalVendorValue * rate);
}

function payloadNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * cc_compute_item_estimated_value — floor(level*100*rarityMult +
 * kind bonus). This is the canonical TS implementation: generation
 * stamps its result onto item_instances.estimated_value (the value
 * buyback pays on), src/server/writes/store.ts re-exports it for the
 * server stores, and the vendor screen uses it for payout previews.
 * The SQL twin is cc_compute_item_estimated_value (migration 0004).
 */
export function computeItemEstimatedValue(
  payload: Record<string, unknown>,
  kind: string,
  rarity: string,
  itemLevel: number,
): number {
  const mult =
    rarity === 'Uncommon' ? 2 : rarity === 'Rare' ? 5 : rarity === 'Epic' ? 10 : rarity === 'Legendary' ? 25 : 1;
  const level = Math.max(1, itemLevel || 1);
  const base = level * 100 * mult;
  let bonus = 0;
  if (kind === 'weapon') {
    bonus = payloadNumber(payload.combatPower) * 2;
  } else if (kind === 'shield') {
    bonus = payloadNumber(payload.hp) * 0.5 * (1 + payloadNumber(payload.mitigation));
  } else if (kind === 'classMod') {
    const affixCount = Array.isArray(payload.affixes) ? payload.affixes.length : 0;
    const nodeBoosts =
      payload.nodeBoosts && typeof payload.nodeBoosts === 'object' ? Object.keys(payload.nodeBoosts).length : 0;
    bonus = (nodeBoosts * 50 + affixCount * 30) * level;
  } else if (kind === 'relic') {
    const affixCount = Array.isArray(payload.affixes) ? payload.affixes.length : 0;
    bonus = affixCount * 40 * mult;
  } else if (kind === 'ordnance') {
    bonus = (payloadNumber(payload.damage) + payloadNumber(payload.shieldDamage) + payloadNumber(payload.armorDamage)) * 1.5;
  } else if (kind === 'vehicle') {
    const affixCount = Array.isArray(payload.affixes) ? payload.affixes.length : 0;
    bonus = affixCount * 40 * mult;
  }
  return Math.floor(base + bonus);
}
