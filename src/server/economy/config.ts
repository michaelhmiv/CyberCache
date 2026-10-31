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
