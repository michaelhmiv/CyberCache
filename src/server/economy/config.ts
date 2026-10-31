/**
 * EconomyConfig — the ONE accessor for the live economy levers
 * (economy observability slice, migration 0018).
 *
 * Levers live in the economy_config table so an operator can retune
 * the economy without a redeploy (POST /api/admin/economy/config,
 * behind the job secret). Every consumer reads through this accessor:
 *
 *   - values are cached in memory for at most CACHE_TTL_MS, so a
 *     change lands within a minute on every route;
 *   - a key with no row resolves to its code default — the defaults
 *     below ARE today's shipped constants (pinned against their
 *     owners by tests: marketFee.ts MARKET_FEE_RATE, chef.ts
 *     FRAGMENT_CHANCE / BOSS_DEDICATED_DROP_CHANCE, bossFees.ts
 *     REMATCH_FEE_MAX_MULTIPLIER);
 *   - a stored value that fails validation (wrong type, out of
 *     range — only possible via direct SQL) is ignored, never
 *     applied;
 *   - a store read failure resolves to the defaults (or the last
 *     good snapshot) — config can never take the game down.
 *
 * The SQL completion path (cc_accept_listing) reads the fee rate
 * from the table itself via cc_economy_config_number; this accessor
 * serves the TypeScript consumers (Chef claim/boss routes, the
 * in-memory write mirror, the admin report).
 */

export interface EconomyConfigValues {
  /** Fraction of a completed market sale destroyed as the fee. */
  marketFeeRate: number;
  /** Probability that a boss victory's first loot roll is a dedicated drop. */
  bossDedicatedChance: number;
  /** Per-tick chance a roaming tick pays cache fragments (before mods). */
  fragmentChance: number;
  /** Cap on the boss rematch fee escalation multiplier. */
  rematchEscalationCap: number;
  /** Multiplier on the Legendary weight of area drop tables at claim time. */
  roamingLegendaryScalar: number;
  /** Fraction of an item's vendor value the NPC vendor pays on buyback. */
  vendorBuybackRate: number;
  /** Multiplier on the equipped vehicle's yield bonus (1.0 = class table as shipped). */
  vehicleYieldScalar: number;
  /** Base per-tick roaming event chance before consumable/vehicle modifiers. */
  eventChanceBase: number;
  /** Chance an elite rotating into the kill cycle escalates into the area's named elite. */
  eliteEscalationChance: number;
  /** Anti-leak budget for the event system: max added EV as a fraction of a plain tick. */
  eventValueBudgetPct: number;
  /** Material-find chance bonus in the daily hot area. */
  hotAreaMaterialBonus: number;
  /** Credits/XP yield bonus in the daily hot area. */
  hotAreaYieldBonus: number;
  /** Absolute ceiling on offline settlement hours. Range-capped at [1, 24] by design. */
  absoluteOfflineCapHours: number;
  /**
   * Crafting XP as a fraction of roaming's XP/hour (crafting-as-
   * occupation §2.3). The [0.70, 0.85] range is LAW — the occupations
   * band — so validation hard-clamps to it: an operator can tune
   * inside the band, never outside it.
   */
  craftXpRate: number;
  /** Multiplier on snapshotted craft unit durations (future jobs). */
  craftTimeScalar: number;
  /** Flat shift applied to both craft quality bounds at roll time. */
  craftQualityShift: number;
  /** Base temper chance for crafted gear frames (before mastery). */
  gearTemperBaseChance: number;
  /** Base refining yield rate before the mastery term. */
  refineBaseYield: number;
  /** Base repair work rate, condition points per hour (mechanics 0025). */
  repairWorkRateBase: number;
  /** Repair work-rate gain per services.repair mastery level. */
  repairMasterySpeedPerLevel: number;
  /** Per-kit restoration gain per services.repair mastery level. */
  repairMasteryEfficiencyPerLevel: number;
  /** Player XP paid to a mechanic per condition point restored. */
  serviceXpPerPoint: number;
  /** Hours without progress before a repair job's owner may reclaim it. */
  repairAbandonWindowHours: number;
  /** Days an unaccepted repair posting stays open before refund. */
  repairListingExpiryDays: number;
}

export type EconomyConfigKey = keyof EconomyConfigValues;

/** Code defaults = the shipped constants at the time of this slice. */
export const ECONOMY_CONFIG_DEFAULTS: EconomyConfigValues = {
  marketFeeRate: 0.05,
  bossDedicatedChance: 0.1,
  fragmentChance: 0.008,
  rematchEscalationCap: 8,
  roamingLegendaryScalar: 1.0,
  vendorBuybackRate: 0.4,
  vehicleYieldScalar: 1.0,
  eventChanceBase: 0.05,
  eliteEscalationChance: 0.12,
  eventValueBudgetPct: 0.08,
  hotAreaMaterialBonus: 0.2,
  hotAreaYieldBonus: 0.1,
  absoluteOfflineCapHours: 24,
  craftXpRate: 0.775,
  craftTimeScalar: 1.0,
  craftQualityShift: 0,
  gearTemperBaseChance: 0.05,
  refineBaseYield: 0.8,
  repairWorkRateBase: 20,
  repairMasterySpeedPerLevel: 0.02,
  repairMasteryEfficiencyPerLevel: 0.02,
  serviceXpPerPoint: 2,
  repairAbandonWindowHours: 48,
  repairListingExpiryDays: 7,
};

export interface EconomyConfigKeySpec {
  key: EconomyConfigKey;
  min: number;
  max: number;
  integer: boolean;
  /** Where the default lives when no lever is set (documentation). */
  defaultOwner: string;
}

/** The lever registry — the admin write path rejects anything else. */
export const ECONOMY_CONFIG_KEYS: Record<EconomyConfigKey, EconomyConfigKeySpec> = {
  marketFeeRate: {
    key: 'marketFeeRate', min: 0, max: 1, integer: false,
    defaultOwner: 'src/lib/market/marketFee.ts MARKET_FEE_RATE',
  },
  bossDedicatedChance: {
    key: 'bossDedicatedChance', min: 0, max: 1, integer: false,
    defaultOwner: 'src/server/chef.ts BOSS_DEDICATED_DROP_CHANCE',
  },
  fragmentChance: {
    key: 'fragmentChance', min: 0, max: 1, integer: false,
    defaultOwner: 'src/server/chef.ts FRAGMENT_CHANCE',
  },
  rematchEscalationCap: {
    key: 'rematchEscalationCap', min: 1, max: 64, integer: true,
    defaultOwner: 'src/lib/bossFees.ts REMATCH_FEE_MAX_MULTIPLIER',
  },
  roamingLegendaryScalar: {
    key: 'roamingLegendaryScalar', min: 0, max: 5, integer: false,
    defaultOwner: 'new lever; 1.0 = the shipped area drop tables unchanged',
  },
  vendorBuybackRate: {
    key: 'vendorBuybackRate', min: 0, max: 0.9, integer: false,
    defaultOwner: 'src/lib/vendor/catalog.ts VENDOR_BUYBACK_RATE_DEFAULT',
  },
  vehicleYieldScalar: {
    key: 'vehicleYieldScalar', min: 0, max: 3, integer: false,
    defaultOwner: 'src/lib/vehicles/vehicles.ts class table (1.0 = as shipped)',
  },
  eventChanceBase: {
    key: 'eventChanceBase', min: 0, max: 0.15, integer: false,
    defaultOwner: 'src/content/roamingEvents.ts EVENT_CHANCE_BASE',
  },
  eliteEscalationChance: {
    key: 'eliteEscalationChance', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/roamingEvents.ts ELITE_ESCALATION_CHANCE',
  },
  eventValueBudgetPct: {
    key: 'eventValueBudgetPct', min: 0, max: 0.5, integer: false,
    defaultOwner: 'src/content/roamingEvents.ts EVENT_VALUE_BUDGET_PCT',
  },
  hotAreaMaterialBonus: {
    key: 'hotAreaMaterialBonus', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/hotArea.ts HOT_AREA_MATERIAL_BONUS',
  },
  hotAreaYieldBonus: {
    key: 'hotAreaYieldBonus', min: 0, max: 1, integer: false,
    defaultOwner: 'src/content/hotArea.ts HOT_AREA_YIELD_BONUS',
  },
  absoluteOfflineCapHours: {
    key: 'absoluteOfflineCapHours', min: 1, max: 24, integer: true,
    defaultOwner: 'src/content/offlineCap.ts ABSOLUTE_OFFLINE_CAP_HOURS (24 is the hard ceiling — the lever range itself is capped there)',
  },
  craftXpRate: {
    key: 'craftXpRate', min: 0.7, max: 0.85, integer: false,
    defaultOwner: 'src/content/crafting.ts CRAFT_XP_RATE_DEFAULT (the [0.70, 0.85] band is the occupations law — validation clamps to it)',
  },
  craftTimeScalar: {
    key: 'craftTimeScalar', min: 0.5, max: 2, integer: false,
    defaultOwner: 'src/content/crafting.ts CRAFT_TIME_SCALAR_DEFAULT',
  },
  craftQualityShift: {
    key: 'craftQualityShift', min: -10, max: 10, integer: false,
    defaultOwner: 'src/content/crafting.ts CRAFT_QUALITY_SHIFT_DEFAULT',
  },
  gearTemperBaseChance: {
    key: 'gearTemperBaseChance', min: 0, max: 0.3, integer: false,
    defaultOwner: 'src/content/crafting.ts GEAR_TEMPER_BASE_CHANCE_DEFAULT',
  },
  refineBaseYield: {
    key: 'refineBaseYield', min: 0.5, max: 1, integer: false,
    defaultOwner: 'src/content/crafting.ts REFINE_BASE_YIELD_DEFAULT',
  },
  repairWorkRateBase: {
    key: 'repairWorkRateBase', min: 1, max: 200, integer: false,
    defaultOwner: 'src/content/repair.ts REPAIR_WORK_RATE_BASE_DEFAULT',
  },
  repairMasterySpeedPerLevel: {
    key: 'repairMasterySpeedPerLevel', min: 0, max: 0.1, integer: false,
    defaultOwner: 'src/content/repair.ts REPAIR_MASTERY_SPEED_PER_LEVEL_DEFAULT',
  },
  repairMasteryEfficiencyPerLevel: {
    key: 'repairMasteryEfficiencyPerLevel', min: 0, max: 0.1, integer: false,
    defaultOwner: 'src/content/repair.ts REPAIR_MASTERY_EFFICIENCY_PER_LEVEL_DEFAULT',
  },
  serviceXpPerPoint: {
    key: 'serviceXpPerPoint', min: 0, max: 10, integer: true,
    defaultOwner: 'src/content/repair.ts SERVICE_XP_PER_POINT_DEFAULT',
  },
  repairAbandonWindowHours: {
    key: 'repairAbandonWindowHours', min: 1, max: 720, integer: true,
    defaultOwner: 'src/content/repair.ts REPAIR_ABANDON_WINDOW_HOURS_DEFAULT',
  },
  repairListingExpiryDays: {
    key: 'repairListingExpiryDays', min: 1, max: 30, integer: true,
    defaultOwner: 'src/content/repair.ts REPAIR_LISTING_EXPIRY_DAYS_DEFAULT',
  },
};

const CACHE_TTL_MS = 60_000;

/** Validate one raw stored/written value for a key. Null = invalid. */
export function validateEconomyConfigValue(key: string, value: unknown): number | null {
  const spec = (ECONOMY_CONFIG_KEYS as Record<string, EconomyConfigKeySpec>)[key];
  if (!spec) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < spec.min || value > spec.max) return null;
  if (spec.integer && !Number.isInteger(value)) return null;
  return value;
}

export function isEconomyConfigKey(key: string): key is EconomyConfigKey {
  return key in ECONOMY_CONFIG_KEYS;
}

/**
 * Merge raw stored values (key → unknown jsonb) over the defaults,
 * dropping anything invalid. The single merge used by the accessor
 * and the admin report, so they can never disagree.
 */
export function resolveEconomyConfigValues(
  stored: Record<string, unknown> | null | undefined,
): EconomyConfigValues {
  const values: EconomyConfigValues = { ...ECONOMY_CONFIG_DEFAULTS };
  if (!stored) return values;
  for (const key of Object.keys(ECONOMY_CONFIG_KEYS) as EconomyConfigKey[]) {
    if (!(key in stored)) continue;
    const valid = validateEconomyConfigValue(key, stored[key]);
    if (valid !== null) values[key] = valid;
  }
  return values;
}

/** The persistence seam behind the accessor (Pg + in-memory impls). */
export interface EconomyConfigSource {
  /** Raw stored lever values by key (jsonb-decoded). */
  loadConfigValues(): Promise<Record<string, unknown>>;
}

export class EconomyConfig {
  private cache: { values: EconomyConfigValues; loadedAt: number } | null = null;

  constructor(
    private readonly source: EconomyConfigSource | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Effective lever values, cached ≤60s; defaults on any failure. */
  async snapshot(): Promise<EconomyConfigValues> {
    if (this.cache && this.now() - this.cache.loadedAt < CACHE_TTL_MS) {
      return this.cache.values;
    }
    if (!this.source) {
      return { ...ECONOMY_CONFIG_DEFAULTS };
    }
    try {
      const stored = await this.source.loadConfigValues();
      const values = resolveEconomyConfigValues(stored);
      this.cache = { values, loadedAt: this.now() };
      return values;
    } catch {
      // Config must never take the game down: serve the last good
      // snapshot if we have one, else the shipped defaults.
      return this.cache ? this.cache.values : { ...ECONOMY_CONFIG_DEFAULTS };
    }
  }

  async get<K extends EconomyConfigKey>(key: K): Promise<number> {
    return (await this.snapshot())[key];
  }

  /** Drop the cache (admin writes call this so the writer sees it land). */
  invalidate(): void {
    this.cache = null;
  }
}
