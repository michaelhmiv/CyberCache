/**
 * Reforge (migration 0027) — spend scrap (+ legendary cores on
 * Legendary-rarity gear) to reroll ONE rolled affix on an item.
 *
 * This module owns the COST RULES. The affix pools and the roll
 * itself live in src/lib/gear/affixPools.ts (shared with the item
 * generators — one source); the server op (cc_reforge_item) is the
 * authority that charges, and its SQL cost recompute mirrors the
 * formula here (parity-pinned by tests).
 *
 * Sink design:
 *  - Scrap: a reforge costs the salvage value of THREE items of the
 *    same rarity and level (salvage value = cc_salvage_scrap:
 *    round((10 + level × 5) × rarity scrap multiplier)). Scrap's
 *    sources are salvage and roaming yield; its other sink is
 *    crafting escrow. Pricing a reforge at 3× salvage makes it a
 *    real decision — you burn a small pile of drops to fix one
 *    keeper — without walling it behind a long grind, and the cost
 *    scales with exactly the axis (rarity × level) that makes an
 *    item worth reforging.
 *  - Legendary cores, Legendary rarity only: 2 cores. Salvaging a
 *    Legendary yields 1 + (level ≥ 25) + (level ≥ 50) + (effect
 *    weapon) = 1–4 cores, modal 2–3 at the levels where legendaries
 *    get reforged — so one legendary reforge costs roughly one
 *    salvaged legendary. The loop stays tight by construction:
 *    cores cannot be farmed from anything but legendaries, and the
 *    two sinks (this + the 1-core-per-unit crafting catalyst) keep
 *    them scarce. Non-legendary reforge never touches cores.
 *  - Both currencies are DESTROYED on use (no counterparty, no
 *    escrow, no refund — the roll is instant and atomic) and metered
 *    in the daily economy metrics: scrap into
 *    scrap_destroyed_reforge, cores into legendary_cores_spent
 *    (broken out in legendary_cores_destroyed_reforge).
 *
 * Scope rulings (documented in the PR + ARCHITECTURE):
 *  - Gear kinds only (weapon / shield / classMod / relic / ordnance).
 *    Vehicles are OUT: a vehicle is a separate item family whose
 *    affixes are class yield tuning surfaced in the Garage, not the
 *    gear home — a Garage-side vehicle reforge can reuse this op's
 *    shape later.
 *  - Activity modules are never reforgeable (see affixPools.ts).
 *  - rollQuality is UNCHANGED: reforge swaps an affix, it does not
 *    re-roll the item. Roll quality, rarity, level, element,
 *    manufacturer, parts, and legendaryEffectId are item identity —
 *    a non-legendary can never gain a legendary effect here, and a
 *    legendary never loses one.
 */
import { RARITIES } from '../constants/rarities';
import type { Rarity } from '../types/game';

/** Item kinds the reforge op accepts (item_instances.kind values). */
export const REFORGEABLE_KINDS = ['weapon', 'shield', 'classMod', 'relic', 'ordnance'] as const;

/** A reforge costs this many same-tier salvage values in scrap. */
export const REFORGE_SCRAP_SALVAGE_MULTIPLE = 3;

/** Lever defaults (registered in src/server/economy/config.ts). */
export const REFORGE_SCRAP_SCALAR_DEFAULT = 1;
export const REFORGE_LEGENDARY_CORE_COST_DEFAULT = 2;

export interface ReforgeLeverValues {
  /** Multiplier on the scrap cost (economy lever reforgeScrapScalar). */
  reforgeScrapScalar: number;
  /** Flat legendary-core cost on Legendary-rarity items (lever). */
  reforgeLegendaryCoreCost: number;
}

export const REFORGE_LEVER_DEFAULTS: ReforgeLeverValues = {
  reforgeScrapScalar: REFORGE_SCRAP_SCALAR_DEFAULT,
  reforgeLegendaryCoreCost: REFORGE_LEGENDARY_CORE_COST_DEFAULT,
};

/** cc_salvage_scrap, mirrored from its TS owner (writes/store.ts). */
export function salvageValueFor(rarity: Rarity | string, level: number): number {
  const mult = RARITIES[rarity as Rarity]?.scrapMultiplier ?? 1;
  return Math.max(1, Math.round((10 + Math.max(1, level || 1) * 5) * mult));
}

export interface ReforgeCost {
  scrap: number;
  cores: number;
}

/**
 * The reforge price for one item. `levers` carries the live economy
 * lever values; omitted fields resolve to the shipped defaults (the
 * client preview and the in-memory store both price at defaults
 * unless a provider injects live values — the SQL op recomputes from
 * the economy_config table and is the charging authority).
 */
export function reforgeCostFor(
  item: { rarity: Rarity | string; level: number },
  levers: Partial<ReforgeLeverValues> = {},
): ReforgeCost {
  const scalar = levers.reforgeScrapScalar ?? REFORGE_SCRAP_SCALAR_DEFAULT;
  const coreCost = levers.reforgeLegendaryCoreCost ?? REFORGE_LEGENDARY_CORE_COST_DEFAULT;
  const scrap = Math.max(
    0,
    Math.ceil(salvageValueFor(item.rarity, item.level) * REFORGE_SCRAP_SALVAGE_MULTIPLE * scalar),
  );
  const cores = item.rarity === 'Legendary' ? Math.max(0, Math.floor(coreCost)) : 0;
  return { scrap, cores };
}
