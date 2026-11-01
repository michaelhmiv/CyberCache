/**
 * Manufacturer Standing — content module (expansion run 2, slice 3).
 *
 * One source of truth for the six manufacturers' independent standing
 * ladders: rank thresholds, tributes, per-manufacturer rank titles,
 * the unlock catalog (Rep Shelf / exclusive recipe / cosmetic / Parts
 * Crate / Signature Order), the turn-in award math (TS twin of
 * cc_turn_in_item's SQL), the drip math, the economy levers, and the
 * pure facts -> state-view derivation both server stores share.
 *
 * Standing laws (brief §2 + DECISIONS R6/R7):
 * - Ladders are INDEPENDENT: no opposed standing, no negative
 *   standing, no cross-manufacturer effects, ever (R6).
 * - Rank is derived from the standing balance but GRANTED only on
 *   tribute payment — credits (+ an item at ranks 3-5). The balance
 *   is never spent by ranking up. Tributes stand as designed (R7):
 *   410,000 credits + 3 items per ladder at scalar 1.0.
 * - Standing is reputation only. It grants access and cosmetics —
 *   never stats, drop rates, or prices. The unlock catalog below is
 *   the whole grant surface, and the slice suite asserts no unlock
 *   carries a power field and every unlock has a registered consumer.
 * - No decay. Standing only moves up.
 */

import { MANUFACTURERS } from '@/constants/manufacturers';
import { Manufacturer, Rarity } from '@/types/game';
import { salvageScrap } from '@/lib/skills/salvageBonuses';

// ---------------------------------------------------------------------------
// Manufacturers
// ---------------------------------------------------------------------------

export const STANDING_MANUFACTURERS: Manufacturer[] = [
  Manufacturer.Redline,
  Manufacturer.Ironwood,
  Manufacturer.BlastForge,
  Manufacturer.Prismatek,
  Manufacturer.ThrowTech,
  Manufacturer.HelixWorks,
];

export function isStandingManufacturer(value: unknown): value is Manufacturer {
  return (
    typeof value === 'string' &&
    (STANDING_MANUFACTURERS as string[]).includes(value)
  );
}

/** URL/id slug for a manufacturer ('Redline' -> 'redline'). */
export function manufacturerSlug(manufacturer: Manufacturer): string {
  return manufacturer.toLowerCase();
}

// ---------------------------------------------------------------------------
// Ranks and tributes
// ---------------------------------------------------------------------------

export const STANDING_RANK_COUNT = 5;

export interface StandingRankDef {
  rank: number;
  /** Generic title (the per-manufacturer flavor title sits below). */
  title: string;
  /** Cumulative standing balance required before the tribute can be paid. */
  threshold: number;
  /** One-time tribute, credits, at scalar 1.0 (the lever scales it). */
  tributeCredits: number;
  /** Minimum rarity of the one-time tribute item, or null for none. */
  tributeMinRarity: Rarity | null;
}

export const STANDING_RANKS: StandingRankDef[] = [
  { rank: 0, title: 'Unknown', threshold: 0, tributeCredits: 0, tributeMinRarity: null },
  { rank: 1, title: 'Recognized', threshold: 500, tributeCredits: 5_000, tributeMinRarity: null },
  { rank: 2, title: 'Supplier', threshold: 2_000, tributeCredits: 15_000, tributeMinRarity: null },
  { rank: 3, title: 'Partner', threshold: 5_000, tributeCredits: 40_000, tributeMinRarity: Rarity.Rare },
  { rank: 4, title: 'Insider', threshold: 11_000, tributeCredits: 100_000, tributeMinRarity: Rarity.Epic },
  { rank: 5, title: 'Factory Friend', threshold: 25_000, tributeCredits: 250_000, tributeMinRarity: Rarity.Epic },
];

/** Total tribute credits for a full ladder at scalar 1.0 (R7: 410,000). */
export const STANDING_TOTAL_TRIBUTE_CREDITS = STANDING_RANKS.reduce(
  (sum, r) => sum + r.tributeCredits,
  0,
);

/**
 * Per-manufacturer rank titles (brief §2.4 Q5: drafted from the
 * manufacturers' shipped identities; Michael vetoes at review).
 * Index 0 is rank 1.
 */
export const STANDING_TITLES: Record<Manufacturer, string[]> = {
  [Manufacturer.Redline]: ['Throttle', 'Redliner', 'Pace Setter', 'Apex', 'Redline Royalty'],
  [Manufacturer.Ironwood]: ['Sapling', 'Heartwood Hand', 'Grain Reader', 'Canopy Insider', 'Old Growth'],
  [Manufacturer.BlastForge]: ['Fuse Hand', 'Powder Crew', 'Blast Partner', 'Forge Insider', 'Forgeheart'],
  [Manufacturer.Prismatek]: ['Refracted', 'Spectrum Hand', 'Prism Partner', 'Spectrum Insider', 'Prism Sovereign'],
  [Manufacturer.ThrowTech]: ['Pack Hand', 'Thrower', 'Kit Partner', 'Decoy Insider', 'ThrowTech Ace'],
  [Manufacturer.HelixWorks]: ['Calibrator', 'Helix Hand', 'Module Partner', 'Helix Insider', 'Master Calibrator'],
};

export function standingRankDef(rank: number): StandingRankDef {
  return STANDING_RANKS[Math.max(0, Math.min(STANDING_RANK_COUNT, Math.trunc(rank) || 0))];
}

/** Highest rank whose threshold the balance meets (grant still needs the tribute). */
export function highestEarnedRank(balance: number): number {
  let earned = 0;
  for (const def of STANDING_RANKS) {
    if (balance >= def.threshold) earned = def.rank;
  }
  return earned;
}

/** Charged tribute for a rank at a lever scalar: round(base x scalar). */
export function standingTributeCredits(rank: number, scalar: number): number {
  return Math.round(standingRankDef(rank).tributeCredits * scalar);
}

const RARITY_ORDER: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
};

export function rarityMeetsMinimum(rarity: string | null | undefined, minimum: Rarity): boolean {
  return (RARITY_ORDER[rarity ?? ''] ?? -1) >= (RARITY_ORDER[minimum] ?? 99);
}

// ---------------------------------------------------------------------------
// Economy levers (registered in src/server/economy/config.ts; the slice
// suite pins these defaults/clamps against the registry).
// ---------------------------------------------------------------------------

export interface StandingLeverValues {
  /** Turn-in award divisor over the item's scrap value. */
  standingScrapDivisor: number;
  /** Standing per recorded kill from the equipped weapon's drip. */
  standingPerKill: number;
  /** Per-manufacturer daily cap on drip points (UTC day). */
  standingDripDailyCap: number;
  /** Multiplier on rank-up tribute credit costs. */
  standingTributeScalar: number;
  /** Signature Order price, credits. */
  standingOrderPrice: number;
  /** Signature Order kill switch (1 = enabled). */
  standingOrderEnabled: number;
}

export const STANDING_LEVER_DEFAULTS: StandingLeverValues = {
  standingScrapDivisor: 10,
  standingPerKill: 1,
  standingDripDailyCap: 100,
  standingTributeScalar: 1.0,
  standingOrderPrice: 150_000,
  standingOrderEnabled: 1,
};

export const STANDING_LEVER_CLAMPS: Record<
  keyof StandingLeverValues,
  { min: number; max: number; integer: boolean }
> = {
  standingScrapDivisor: { min: 2, max: 50, integer: false },
  standingPerKill: { min: 0, max: 10, integer: false },
  standingDripDailyCap: { min: 0, max: 1000, integer: true },
  standingTributeScalar: { min: 0, max: 3, integer: false },
  standingOrderPrice: { min: 0, max: 10_000_000, integer: true },
  standingOrderEnabled: { min: 0, max: 1, integer: true },
};

export function resolveStandingLevers(
  overrides?: Partial<StandingLeverValues> | null,
): StandingLeverValues {
  const out = { ...STANDING_LEVER_DEFAULTS };
  if (overrides) {
    for (const key of Object.keys(STANDING_LEVER_DEFAULTS) as Array<keyof StandingLeverValues>) {
      const raw = overrides[key];
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const clamp = STANDING_LEVER_CLAMPS[key];
      const clamped = Math.min(clamp.max, Math.max(clamp.min, raw));
      out[key] = clamp.integer ? Math.trunc(clamped) : clamped;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Turn-ins (brief §2.2). Base value = the shipped salvage scrap value
// (cc_salvage_scrap / salvageScrap), with the item-side Market Crash
// multiplier cc_recycle_item applies; Scavenger skill bonuses never
// apply — the rep desk pays reputation, not a build's salvage rate.
// ---------------------------------------------------------------------------

export interface TurnInItemShape {
  kind: string;
  runtimeState: string;
  isLocked: boolean;
  equippedSlot: string | null;
  rarity: string | null;
  itemLevel: number;
  manufacturer: string | null;
  legendaryEffectId?: string | null;
}

/**
 * Why an item cannot be turned in, or null when it can. The 0027
 * reforge eligibility rule verbatim: state 'available' only (locked,
 * equipped, listed, and escrowed items all refuse), vehicles out.
 */
export function standingTurnInRefusal(item: TurnInItemShape): string | null {
  if (item.kind === 'vehicle') return 'Vehicles cannot be turned in for standing';
  if (!isStandingManufacturer(item.manufacturer)) return 'Item has no manufacturer standing';
  if (item.isLocked) return 'Locked item';
  if (item.equippedSlot) return 'Unequip the item before turning it in';
  if (item.runtimeState !== 'available') return 'Item is not available';
  return null;
}

/** Standing awarded for turning in an item at a scrap divisor. */
export function standingTurnInAward(
  item: { rarity: string | null; itemLevel: number; legendaryEffectId?: string | null },
  divisor: number,
): number {
  const base =
    salvageScrap(item.rarity ?? 'Common', item.itemLevel) *
    (item.legendaryEffectId === 'market_crash' ? 4 : 1);
  return Math.max(1, Math.round(base / Math.max(1, divisor)));
}

// ---------------------------------------------------------------------------
// Unlock catalog (brief §2.5). One unlock per rank, identical shape for
// every manufacturer. This catalog is the whole grant surface: access
// and cosmetics only — no stats, no drop rates, no prices.
// ---------------------------------------------------------------------------

export type StandingUnlockKind = 'shelf' | 'recipe' | 'cosmetic' | 'crate' | 'order';

export interface StandingUnlockDef {
  id: string;
  manufacturer: Manufacturer;
  rank: number;
  kind: StandingUnlockKind;
  label: string;
  detail: string;
}

/** Rank-1 Rep Shelf picks: an existing rotation-pool consumable matched to each identity, at list price. */
export const STANDING_SHELF_TYPES: Record<Manufacturer, { consumableType: string; priceCredits: number }> = {
  [Manufacturer.Redline]: { consumableType: 'OverchargeStim', priceCredits: 800 },
  [Manufacturer.Ironwood]: { consumableType: 'BossScanner', priceCredits: 600 },
  [Manufacturer.BlastForge]: { consumableType: 'OrdnanceCharge', priceCredits: 400 },
  [Manufacturer.Prismatek]: { consumableType: 'VoidAmmo', priceCredits: 700 },
  [Manufacturer.ThrowTech]: { consumableType: 'MagnetizedPayload', priceCredits: 650 },
  [Manufacturer.HelixWorks]: { consumableType: 'LuckBooster', priceCredits: 350 },
};

/** Rank-2 exclusive recipe outputs (defs in src/constants/consumables.ts, recipes in src/content/crafting.ts). */
export const STANDING_RECIPE_TYPES: Record<Manufacturer, { consumableType: string; recipeId: string; name: string }> = {
  [Manufacturer.Redline]: { consumableType: 'RedlineTonic', recipeId: 'recipe_redline_standing', name: 'Redline Tonic' },
  [Manufacturer.Ironwood]: { consumableType: 'HeartwoodSightOil', recipeId: 'recipe_ironwood_standing', name: 'Heartwood Sight Oil' },
  [Manufacturer.BlastForge]: { consumableType: 'ForgeheartCharge', recipeId: 'recipe_blastforge_standing', name: 'Forgeheart Charge' },
  [Manufacturer.Prismatek]: { consumableType: 'PrismCoating', recipeId: 'recipe_prismatek_standing', name: 'Prism Coating' },
  [Manufacturer.ThrowTech]: { consumableType: 'ThrowTechDecoyKit', recipeId: 'recipe_throwtech_standing', name: 'ThrowTech Decoy Kit' },
  [Manufacturer.HelixWorks]: { consumableType: 'HelixCalibrationKit', recipeId: 'recipe_helixworks_standing', name: 'Helix Calibration Kit' },
};

/** Rank-3 cosmetics: a manufacturer head variant + rig decal tint (selection is device-local). */
export const STANDING_COSMETICS: Record<Manufacturer, { headVariantId: string; spriteId: string }> = {
  [Manufacturer.Redline]: { headVariantId: 'mfr-redline', spriteId: 'hunter-head-redline' },
  [Manufacturer.Ironwood]: { headVariantId: 'mfr-ironwood', spriteId: 'hunter-head-ironwood' },
  [Manufacturer.BlastForge]: { headVariantId: 'mfr-blastforge', spriteId: 'hunter-head-blastforge' },
  [Manufacturer.Prismatek]: { headVariantId: 'mfr-prismatek', spriteId: 'hunter-head-prismatek' },
  [Manufacturer.ThrowTech]: { headVariantId: 'mfr-throwtech', spriteId: 'hunter-head-throwtech' },
  [Manufacturer.HelixWorks]: { headVariantId: 'mfr-helixworks', spriteId: 'hunter-head-helixworks' },
};

/** Rank-4 Parts Crates: weekly materials/essences bundles at a deliberately poor conversion rate. */
export const STANDING_CRATE_CONTENTS: Record<
  Manufacturer,
  { priceCredits: number; materials: Record<string, number>; essences: Record<string, number> }
> = {
  [Manufacturer.Redline]: { priceCredits: 5_000, materials: { BallisticParts: 10, NitrocellGel: 4 }, essences: {} },
  [Manufacturer.Ironwood]: { priceCredits: 5_000, materials: { HeartwoodResin: 4, TechFragments: 10 }, essences: {} },
  [Manufacturer.BlastForge]: { priceCredits: 5_000, materials: { ForgeheartIngots: 4, ReactiveComponents: 10 }, essences: {} },
  [Manufacturer.Prismatek]: { priceCredits: 6_000, materials: { PrismShards: 4 }, essences: { VoidEssence: 2, CryoGel: 2 } },
  [Manufacturer.ThrowTech]: { priceCredits: 5_000, materials: { MagnetiteCores: 4, TechFragments: 10 }, essences: {} },
  [Manufacturer.HelixWorks]: { priceCredits: 5_500, materials: { Siltglass: 4, VoidDust: 5 }, essences: {} },
};

/** Purchasable standing offers — the SQL cc_standing_catalog twin (parity-pinned by the slice suite). */
export interface StandingOfferDef {
  offerKey: string;
  manufacturer: Manufacturer;
  kind: 'shelf' | 'crate';
  rankRequired: number;
  priceCredits: number;
  consumableType: string | null;
  materials: Record<string, number>;
  essences: Record<string, number>;
}

export const STANDING_OFFERS: StandingOfferDef[] = STANDING_MANUFACTURERS.flatMap((manufacturer) => {
  const shelf = STANDING_SHELF_TYPES[manufacturer];
  const crate = STANDING_CRATE_CONTENTS[manufacturer];
  return [
    {
      offerKey: `shelf:${manufacturer}`,
      manufacturer,
      kind: 'shelf' as const,
      rankRequired: 1,
      priceCredits: shelf.priceCredits,
      consumableType: shelf.consumableType,
      materials: {},
      essences: {},
    },
    {
      offerKey: `crate:${manufacturer}`,
      manufacturer,
      kind: 'crate' as const,
      rankRequired: 4,
      priceCredits: crate.priceCredits,
      consumableType: null,
      materials: crate.materials,
      essences: crate.essences,
    },
  ];
});

export function standingOffer(offerKey: string): StandingOfferDef | null {
  return STANDING_OFFERS.find((o) => o.offerKey === offerKey) ?? null;
}

export function standingUnlockId(manufacturer: Manufacturer, kind: StandingUnlockKind): string {
  return `standing:${manufacturerSlug(manufacturer)}:${kind}`;
}

export const STANDING_UNLOCKS: StandingUnlockDef[] = STANDING_MANUFACTURERS.flatMap((manufacturer) => {
  const def = MANUFACTURERS[manufacturer];
  const shelf = STANDING_SHELF_TYPES[manufacturer];
  const recipe = STANDING_RECIPE_TYPES[manufacturer];
  return [
    {
      id: standingUnlockId(manufacturer, 'shelf'),
      manufacturer,
      rank: 1,
      kind: 'shelf' as const,
      label: 'Rep Shelf',
      detail: `${shelf.consumableType} at list price from the Rep Desk — always stocked, flat 100% quality.`,
    },
    {
      id: standingUnlockId(manufacturer, 'recipe'),
      manufacturer,
      rank: 2,
      kind: 'recipe' as const,
      label: `${recipe.name} recipe`,
      detail: `Craft ${recipe.name} at the bench — a ${def.name} exclusive, quality-scalable like any crafted consumable.`,
    },
    {
      id: standingUnlockId(manufacturer, 'cosmetic'),
      manufacturer,
      rank: 3,
      kind: 'cosmetic' as const,
      label: `${def.name} rig colors`,
      detail: `A ${def.name} head variant and decal tint for your rig, chosen in Settings. Looks only — no stats.`,
    },
    {
      id: standingUnlockId(manufacturer, 'crate'),
      manufacturer,
      rank: 4,
      kind: 'crate' as const,
      label: 'Parts Crate',
      detail: `A weekly bundle of ${def.name} workshop materials from the Rep Desk.`,
    },
    {
      id: standingUnlockId(manufacturer, 'order'),
      manufacturer,
      rank: 5,
      kind: 'order' as const,
      label: 'Signature Order',
      detail: `Commission a ${def.name} weapon at your level once a week — Rare to Epic, never Legendary.`,
    },
  ];
});

/**
 * Unlock -> consumer registry (#216 discipline): every unlock id must
 * name the shipped code path that consumes it. The slice suite asserts
 * each registry needle exists in the named file, so an unlock can
 * never ship as a promise nothing reads.
 */
export const STANDING_UNLOCK_CONSUMERS: Record<
  string,
  { consumer: string; file: string; needle: string }
> = Object.fromEntries(
  STANDING_MANUFACTURERS.flatMap((manufacturer) => {
    const slug = manufacturerSlug(manufacturer);
    return [
      [
        standingUnlockId(manufacturer, 'shelf'),
        {
          consumer: 'cc_standing_buy rank gate (shelf offers)',
          file: 'db/migrations/0043_manufacturer_standing.sql',
          needle: 'cc_standing_buy',
        },
      ],
      [
        standingUnlockId(manufacturer, 'recipe'),
        {
          consumer: 'cc_enqueue_craft_job requiresStanding gate',
          file: 'db/migrations/0043_manufacturer_standing.sql',
          needle: 'requiresStanding',
        },
      ],
      [
        standingUnlockId(manufacturer, 'cosmetic'),
        {
          consumer: 'Settings head-variant list (owned rank-3 variants only)',
          file: 'src/lib/pixel/rig.ts',
          needle: `mfr-${slug}`,
        },
      ],
      [
        standingUnlockId(manufacturer, 'crate'),
        {
          consumer: 'cc_standing_buy weekly cadence (standing_weekly_purchases)',
          file: 'db/migrations/0043_manufacturer_standing.sql',
          needle: 'standing_weekly_purchases',
        },
      ],
      [
        standingUnlockId(manufacturer, 'order'),
        {
          consumer: 'cc_standing_order_weapon',
          file: 'db/migrations/0043_manufacturer_standing.sql',
          needle: 'cc_standing_order_weapon',
        },
      ],
    ];
  }),
);

// ---------------------------------------------------------------------------
// Calendar helpers (SQL twins: (now() at time zone 'utc')::date and
// to_char(now() at time zone 'utc', 'IYYY-"W"IW')).
// ---------------------------------------------------------------------------

export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this week
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Facts -> state view (server-owned facts; the view is pure derivation
// shared by the Pg route, the in-memory twin, tests, and golden scenes).
// ---------------------------------------------------------------------------

export interface StandingRowFact {
  manufacturer: string;
  standing: number;
  rank: number;
}

export interface StandingFacts {
  accountType: string;
  canUsePlayerEconomy: boolean;
  credits: number;
  playerLevel: number;
  rows: StandingRowFact[];
  /** This ISO week's purchases: { manufacturer, kind: 'crate' | 'order' }. */
  weeklyPurchases: Array<{ manufacturer: string; kind: string }>;
}

export interface StandingUnlockView extends StandingUnlockDef {
  state: 'owned' | 'locked';
}

export interface StandingManufacturerView {
  manufacturer: Manufacturer;
  name: string;
  color: string;
  standing: number;
  rank: number;
  /** Flavor title for the current rank, or null at rank 0. */
  rankTitle: string | null;
  genericTitle: string;
  earnedRank: number;
  nextRank: {
    rank: number;
    title: string;
    genericTitle: string;
    threshold: number;
    standingNeeded: number;
    tributeCredits: number;
    tributeMinRarity: Rarity | null;
    canAffordTribute: boolean;
    thresholdMet: boolean;
  } | null;
  unlocks: StandingUnlockView[];
  shelf: { offerKey: string; consumableType: string; priceCredits: number; available: boolean };
  crate: {
    offerKey: string;
    priceCredits: number;
    materials: Record<string, number>;
    essences: Record<string, number>;
    boughtThisWeek: boolean;
    available: boolean;
  };
  order: { priceCredits: number; enabled: boolean; orderedThisWeek: boolean; available: boolean };
}

export interface StandingStateView {
  canUsePlayerEconomy: boolean;
  isGuest: boolean;
  playerLevel: number;
  credits: number;
  manufacturers: StandingManufacturerView[];
  totalStanding: number;
  totalRanks: number;
}

export function buildStandingStateView(
  facts: StandingFacts,
  levers: StandingLeverValues = STANDING_LEVER_DEFAULTS,
): StandingStateView {
  const byManufacturer = new Map(facts.rows.map((r) => [r.manufacturer, r]));
  const weekly = new Set(facts.weeklyPurchases.map((w) => `${w.manufacturer}:${w.kind}`));
  const manufacturers = STANDING_MANUFACTURERS.map((manufacturer) => {
    const def = MANUFACTURERS[manufacturer];
    const row = byManufacturer.get(manufacturer);
    const standing = Math.max(0, Math.trunc(row?.standing ?? 0));
    const rank = Math.max(0, Math.min(STANDING_RANK_COUNT, Math.trunc(row?.rank ?? 0)));
    const earnedRank = highestEarnedRank(standing);
    const nextDef = rank < STANDING_RANK_COUNT ? STANDING_RANKS[rank + 1] : null;
    const shelf = STANDING_SHELF_TYPES[manufacturer];
    const crate = STANDING_CRATE_CONTENTS[manufacturer];
    const crateBought = weekly.has(`${manufacturer}:crate`);
    const orderDone = weekly.has(`${manufacturer}:order`);
    return {
      manufacturer,
      name: def.name,
      color: def.color,
      standing,
      rank,
      rankTitle: rank >= 1 ? STANDING_TITLES[manufacturer][rank - 1] : null,
      genericTitle: standingRankDef(rank).title,
      earnedRank,
      nextRank: nextDef
        ? {
            rank: nextDef.rank,
            title: STANDING_TITLES[manufacturer][nextDef.rank - 1],
            genericTitle: nextDef.title,
            threshold: nextDef.threshold,
            standingNeeded: Math.max(0, nextDef.threshold - standing),
            tributeCredits: standingTributeCredits(nextDef.rank, levers.standingTributeScalar),
            tributeMinRarity: nextDef.tributeMinRarity,
            canAffordTribute:
              facts.credits >= standingTributeCredits(nextDef.rank, levers.standingTributeScalar),
            thresholdMet: standing >= nextDef.threshold,
          }
        : null,
      unlocks: STANDING_UNLOCKS.filter((u) => u.manufacturer === manufacturer).map((u) => ({
        ...u,
        state: (rank >= u.rank ? 'owned' : 'locked') as 'owned' | 'locked',
      })),
      shelf: {
        offerKey: `shelf:${manufacturer}`,
        consumableType: shelf.consumableType,
        priceCredits: shelf.priceCredits,
        available: rank >= 1,
      },
      crate: {
        offerKey: `crate:${manufacturer}`,
        priceCredits: crate.priceCredits,
        materials: crate.materials,
        essences: crate.essences,
        boughtThisWeek: crateBought,
        available: rank >= 4 && !crateBought,
      },
      order: {
        priceCredits: levers.standingOrderPrice,
        enabled: levers.standingOrderEnabled === 1,
        orderedThisWeek: orderDone,
        available: rank >= 5 && levers.standingOrderEnabled === 1 && !orderDone,
      },
    };
  });
  return {
    canUsePlayerEconomy: facts.canUsePlayerEconomy,
    isGuest: facts.accountType === 'guest',
    playerLevel: facts.playerLevel,
    credits: facts.credits,
    manufacturers,
    totalStanding: manufacturers.reduce((sum, m) => sum + m.standing, 0),
    totalRanks: manufacturers.reduce((sum, m) => sum + m.rank, 0),
  };
}
