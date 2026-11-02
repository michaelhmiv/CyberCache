/**
 * Cache Rank — the Badass-rank analogue (Cache Rank slice,
 * migration 0031).
 *
 * This module is the ONE content owner for the Cache Rank rules:
 * the earning table (tokens from LEVELS, never from challenges),
 * the milestone bundles, the spend menu (seven tiny permanent
 * bonuses with rank caps and a rising cost curve), the lever
 * surface (defaults + hard clamps), the resolved-bonus derivation,
 * and the cache-draw weight adjustment that finally consumes the
 * `cacheQuality` effect. Engines (the Chef claim/boss/endless
 * resolvers, the cache-open path, the market completion path, the
 * craft/repair settlers), routes, stores, and screens all read from
 * here — nobody re-derives a magnitude.
 *
 * The laws this file encodes:
 *
 *  - EARNING IS LEVEL-DERIVED, SERVER-SIDE ONLY. One token per
 *    level gained plus a bundle at each milestone level
 *    (10/25/50/75/100). Entitlement is a pure function of the
 *    server's own profiles.player_level; grants pay
 *    entitlement(level) − entitlement(watermark) exactly once
 *    (profiles.cache_rank_grant_level is the watermark), enforced
 *    by a BEFORE UPDATE trigger on profiles.player_level plus the
 *    cc_grant_cache_rank_tokens observation RPC. A request body can
 *    assert levels or token balances and change nothing.
 *  - TOKENS ARE A SEPARATE CURRENCY. The skill-point budget
 *    (level − 1) is untouched; Cache Rank spends live in
 *    profiles.cache_rank_spends and never interact with respec
 *    (cc_retrain). Cache Rank itself offers NO respec — deliberate:
 *    bonuses are tiny and broad, so a misclick costs little, and
 *    level-bound tokens cannot be farmed by re-spending.
 *  - BONUSES ARE TINY AND CAPPED. Per-rank effects are 0.5–2% and
 *    every track caps at 10 ranks, so the all-maxed profile is
 *    +10% credits / +10% XP / +10% scrap / +5% damage / +10% max
 *    HP / +20% cache quality / +5% market proceeds — meaningful
 *    over years of play, never build-defining.
 *  - COMPOSITION ORDER IS FIXED. Where a Cache Rank bonus meets an
 *    older system it applies LAST, on the post-everything-else
 *    figure: roaming rates multiply after gear/skill/activity/hot
 *    multipliers; the market proceeds uplift applies to the
 *    POST-FEE proceeds (fee first — rate, Darknet/Manipulator/House
 *    Brand reductions — then the uplift, which is minted and
 *    metered as such); the cache-quality total is skill
 *    cacheQuality + Cache Rank cache quality, added once.
 *  - NOT AN ACHIEVEMENT SYSTEM. Nothing here reads a challenge,
 *    a kill count, or a checklist. Levels are the only input.
 */
import { xpToNextLevel } from './simulation';
import type { PxIconName } from '@/lib/pixel/icons';

// ─── Earning ─────────────────────────────────────────────────────────

/** Milestone levels that pay a token bundle on top of the per-level token. */
export const CACHE_RANK_MILESTONE_LEVELS = [10, 25, 50, 75, 100] as const;

// ─── The spend menu ──────────────────────────────────────────────────

export type CacheRankBonusId =
  | 'credits'
  | 'xp'
  | 'scrap'
  | 'damage'
  | 'maxHp'
  | 'cacheQuality'
  | 'marketProceeds';

export interface CacheRankBonusDef {
  id: CacheRankBonusId;
  name: string;
  /** Player-facing one-liner (the bonus at one rank, formatted by formatCacheRankBonusEffect). */
  summary: string;
  /** The lever key carrying this track's per-rank effect. */
  leverKey: keyof CacheRankLeverValues;
  /** Hard rank cap — mirrored by the cache_rank_bonus_definitions table (0031). */
  maxRanks: number;
  /** Pixel icon for the panel's rank pips (visual identity, G-rules). */
  icon: PxIconName;
  /** Accent color for the track (visual identity, G-rules). */
  color: string;
}

export const CACHE_RANK_BONUS_DEFS: CacheRankBonusDef[] = [
  {
    id: 'credits',
    name: 'Greed',
    summary: 'Credits earned from roaming, bosses, and the Chamber',
    leverKey: 'cacheRankCreditsPerRank',
    maxRanks: 10,
    icon: 'coin',
    color: '#F2C063',
  },
  {
    id: 'xp',
    name: 'Fast Learner',
    summary: 'XP earned from every source',
    leverKey: 'cacheRankXpPerRank',
    maxRanks: 10,
    icon: 'star',
    color: '#7FD4FF',
  },
  {
    id: 'scrap',
    name: 'Salvage Hound',
    summary: 'Scrap earned from roaming and the Chamber',
    leverKey: 'cacheRankScrapPerRank',
    maxRanks: 10,
    icon: 'hammer',
    color: '#B08968',
  },
  {
    id: 'damage',
    name: 'Heavy Hand',
    summary: 'Damage in roaming, boss fights, and the Chamber',
    leverKey: 'cacheRankDamagePerRank',
    maxRanks: 10,
    icon: 'burst',
    color: '#FF4B5C',
  },
  {
    id: 'maxHp',
    name: 'Thick Skin',
    summary: 'Maximum hunter HP',
    leverKey: 'cacheRankMaxHpPerRank',
    maxRanks: 10,
    icon: 'heart',
    color: '#FF8FA3',
  },
  {
    id: 'cacheQuality',
    name: 'Cache Optimizer',
    summary: 'Cache quality — Epic and Legendary cache draws weigh heavier',
    leverKey: 'cacheRankCacheQualityPerRank',
    maxRanks: 10,
    icon: 'hex',
    color: '#B18CFF',
  },
  {
    id: 'marketProceeds',
    name: 'Silver Tongue',
    summary: 'Market sale proceeds, paid on top of the post-fee amount',
    leverKey: 'cacheRankMarketProceedsPerRank',
    maxRanks: 10,
    icon: 'tag',
    color: '#8FE388',
  },
];

export const CACHE_RANK_BONUS_IDS: CacheRankBonusId[] = CACHE_RANK_BONUS_DEFS.map((d) => d.id);

export function cacheRankBonusDef(id: unknown): CacheRankBonusDef | null {
  return CACHE_RANK_BONUS_DEFS.find((d) => d.id === id) ?? null;
}

export function isCacheRankBonusId(value: unknown): value is CacheRankBonusId {
  return typeof value === 'string' && CACHE_RANK_BONUS_IDS.includes(value as CacheRankBonusId);
}

// ─── Levers ──────────────────────────────────────────────────────────

/**
 * The Cache Rank lever surface. Every earning/cost/effect constant
 * is a live economy lever (0018 pattern: registered in
 * src/server/economy/config.ts, read through the ONE EconomyConfig
 * accessor, mirrored into SQL by cc_economy_config_number with the
 * same clamps applied at the SQL call sites). Defaults and hard
 * clamps live HERE (content) and the config registry mirrors them,
 * pinned equal by tests — TS and SQL can never disagree about the
 * shipped default.
 */
export interface CacheRankLeverValues {
  /** Tokens granted per level gained. */
  cacheRankTokensPerLevel: number;
  /** Milestone bundle at the first milestone level (L10). */
  cacheRankMilestoneBundleBase: number;
  /** Bundle growth per milestone step (L25 = base + step, …). */
  cacheRankMilestoneBundleStep: number;
  /** Cost of rank 1 on any track. */
  cacheRankCostBase: number;
  /** Cost growth per rank pair: cost at r ranks = base + growth × floor(r / 2). */
  cacheRankCostGrowth: number;
  /** +credits fraction per Greed rank. */
  cacheRankCreditsPerRank: number;
  /** +XP fraction per Fast Learner rank. */
  cacheRankXpPerRank: number;
  /** +scrap fraction per Salvage Hound rank. */
  cacheRankScrapPerRank: number;
  /** +damage fraction per Heavy Hand rank. */
  cacheRankDamagePerRank: number;
  /** +max HP fraction per Thick Skin rank. */
  cacheRankMaxHpPerRank: number;
  /** +cache quality per Cache Optimizer rank (weight-shift fraction). */
  cacheRankCacheQualityPerRank: number;
  /** +market proceeds fraction per Silver Tongue rank (of post-fee proceeds). */
  cacheRankMarketProceedsPerRank: number;
}

export const CACHE_RANK_LEVER_DEFAULTS: CacheRankLeverValues = {
  cacheRankTokensPerLevel: 1,
  cacheRankMilestoneBundleBase: 5,
  cacheRankMilestoneBundleStep: 5,
  cacheRankCostBase: 1,
  cacheRankCostGrowth: 1,
  cacheRankCreditsPerRank: 0.01,
  cacheRankXpPerRank: 0.01,
  cacheRankScrapPerRank: 0.01,
  cacheRankDamagePerRank: 0.005,
  cacheRankMaxHpPerRank: 0.01,
  cacheRankCacheQualityPerRank: 0.02,
  cacheRankMarketProceedsPerRank: 0.005,
};

/** Hard clamps per lever — the SQL call sites clamp identically. */
export const CACHE_RANK_LEVER_CLAMPS: Record<
  keyof CacheRankLeverValues,
  { min: number; max: number; integer?: boolean }
> = {
  cacheRankTokensPerLevel: { min: 0, max: 3, integer: true },
  cacheRankMilestoneBundleBase: { min: 0, max: 25, integer: true },
  cacheRankMilestoneBundleStep: { min: 0, max: 25, integer: true },
  cacheRankCostBase: { min: 1, max: 10, integer: true },
  cacheRankCostGrowth: { min: 0, max: 2 },
  cacheRankCreditsPerRank: { min: 0, max: 0.02 },
  cacheRankXpPerRank: { min: 0, max: 0.02 },
  cacheRankScrapPerRank: { min: 0, max: 0.02 },
  cacheRankDamagePerRank: { min: 0, max: 0.01 },
  cacheRankMaxHpPerRank: { min: 0, max: 0.02 },
  cacheRankCacheQualityPerRank: { min: 0, max: 0.04 },
  cacheRankMarketProceedsPerRank: { min: 0, max: 0.01 },
};

function clampLever(key: keyof CacheRankLeverValues, value: number): number {
  const clamp = CACHE_RANK_LEVER_CLAMPS[key];
  const clamped = Math.min(clamp.max, Math.max(clamp.min, value));
  return clamp.integer ? Math.trunc(clamped) : clamped;
}

/** Resolve a partial lever bag over the defaults, clamped. */
export function resolveCacheRankLevers(
  partial?: Partial<CacheRankLeverValues> | null,
): CacheRankLeverValues {
  const out = { ...CACHE_RANK_LEVER_DEFAULTS };
  if (partial) {
    for (const key of Object.keys(CACHE_RANK_LEVER_DEFAULTS) as Array<keyof CacheRankLeverValues>) {
      const value = partial[key];
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = clampLever(key, value);
    }
  }
  return out;
}

// ─── Entitlement + costs (pure, lever-shaped) ────────────────────────

/** The bundle paid when `level` is a milestone level, else 0. */
export function cacheRankMilestoneBundle(
  level: number,
  leversInput?: Partial<CacheRankLeverValues> | null,
): number {
  const levers = resolveCacheRankLevers(leversInput);
  const index = (CACHE_RANK_MILESTONE_LEVELS as readonly number[]).indexOf(level);
  if (index < 0) return 0;
  return levers.cacheRankMilestoneBundleBase + index * levers.cacheRankMilestoneBundleStep;
}

/**
 * Total tokens a player at `level` has EVER earned: one per level
 * gained (levels 2..level) plus every milestone bundle at or below
 * the level. entitlement(1) = 0; entitlement(100) = 99 + 75 = 174
 * at the shipped defaults. Grants pay the difference between the
 * entitlement at the player's current level and at their grant
 * watermark — this function is the whole earning rule.
 */
export function cacheRankEntitlement(
  level: number,
  leversInput?: Partial<CacheRankLeverValues> | null,
): number {
  const levers = resolveCacheRankLevers(leversInput);
  const lvl = Math.max(1, Math.trunc(level) || 1);
  let total = (lvl - 1) * levers.cacheRankTokensPerLevel;
  for (const milestone of CACHE_RANK_MILESTONE_LEVELS) {
    if (milestone <= lvl) total += cacheRankMilestoneBundle(milestone, levers);
  }
  return total;
}

/**
 * Cost of the NEXT rank on a track holding `currentRanks` ranks:
 * base + growth × floor(currentRanks / 2), rounded — the shipped
 * curve is 1,1,2,2,3,3,4,4,5,5 (30 tokens to max one track, 210 to
 * max all seven against 174 lifetime earnable: choices matter).
 */
export function cacheRankCostForRank(
  currentRanks: number,
  leversInput?: Partial<CacheRankLeverValues> | null,
): number {
  const levers = resolveCacheRankLevers(leversInput);
  const ranks = Math.max(0, Math.trunc(currentRanks) || 0);
  return Math.max(1, Math.round(levers.cacheRankCostBase + levers.cacheRankCostGrowth * Math.floor(ranks / 2)));
}

/** Total tokens spent to reach `ranks` ranks on one track. */
export function cacheRankTrackCost(
  ranks: number,
  leversInput?: Partial<CacheRankLeverValues> | null,
): number {
  let total = 0;
  for (let r = 0; r < Math.max(0, Math.trunc(ranks) || 0); r++) total += cacheRankCostForRank(r, leversInput);
  return total;
}

// ─── Resolved bonuses ────────────────────────────────────────────────

/** The seven resolved Cache Rank bonus fractions for a spend record. */
export interface CacheRankBonuses {
  credits: number;
  xp: number;
  scrap: number;
  damage: number;
  maxHp: number;
  cacheQuality: number;
  marketProceeds: number;
}

export const EMPTY_CACHE_RANK_BONUSES: CacheRankBonuses = {
  credits: 0,
  xp: 0,
  scrap: 0,
  damage: 0,
  maxHp: 0,
  cacheQuality: 0,
  marketProceeds: 0,
};

/** Sanitize a stored spend record: known tracks only, ranks clamped to [0, cap]. */
export function sanitizeCacheRankSpends(spends: unknown): Record<CacheRankBonusId, number> {
  const out = {} as Record<CacheRankBonusId, number>;
  for (const def of CACHE_RANK_BONUS_DEFS) out[def.id] = 0;
  if (!spends || typeof spends !== 'object' || Array.isArray(spends)) return out;
  for (const def of CACHE_RANK_BONUS_DEFS) {
    const raw = (spends as Record<string, unknown>)[def.id];
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (Number.isFinite(n)) out[def.id] = Math.min(def.maxRanks, Math.max(0, Math.trunc(n)));
  }
  return out;
}

/**
 * Resolve a spend record into bonus fractions: ranks × the levered
 * per-rank effect, per track. The ONE derivation — Chef engines,
 * routes, the market path, and the client snapshot all consume this
 * record, always computed from server-side (or server-synced)
 * spends, never from a request body's claim.
 */
export function cacheRankBonuses(
  spends: unknown,
  leversInput?: Partial<CacheRankLeverValues> | null,
): CacheRankBonuses {
  const levers = resolveCacheRankLevers(leversInput);
  const clean = sanitizeCacheRankSpends(spends);
  const out = { ...EMPTY_CACHE_RANK_BONUSES };
  for (const def of CACHE_RANK_BONUS_DEFS) {
    out[def.id] = clean[def.id] * levers[def.leverKey];
  }
  return out;
}

// ─── Cache draw quality (the cacheQuality consumer math) ────────────

/** Rarity ladder for draw-weight purposes (lowest first). */
const RARITY_RANK: Record<string, number> = {
  Common: 0,
  Uncommon: 1,
  Rare: 2,
  Epic: 3,
  Legendary: 4,
};

/**
 * Apply a cache-quality fraction to a weighted draw table: every
 * outcome ABOVE the table's lowest tier weighs (1 + quality) × its
 * base weight; the lowest tier is unchanged. This is the shipped
 * semantics of "cache quality" for both the Scavenger node's
 * `cacheQuality` effect and the Cache Rank Cache Optimizer track —
 * their sum is the quality the draw reads, exactly once. At the
 * shipped cache table (Rare 6000 / Epic 3200 / Legendary 800),
 * quality 0.25 moves Legendary 8.0% → 9.1% and Epic 32% → 36.4%.
 */
export function cacheQualityAdjustedWeights<T extends { outcome: string; weight: number }>(
  outcomes: readonly T[],
  quality: number,
): T[] {
  const q = Number.isFinite(quality) ? Math.max(0, quality) : 0;
  if (q === 0 || outcomes.length === 0) return outcomes.map((o) => ({ ...o }));
  const minRank = Math.min(...outcomes.map((o) => RARITY_RANK[o.outcome] ?? 0));
  return outcomes.map((o) =>
    (RARITY_RANK[o.outcome] ?? 0) > minRank ? { ...o, weight: o.weight * (1 + q) } : { ...o },
  );
}

// ─── Player-facing state view ────────────────────────────────────────

export interface CacheRankTrackView {
  id: CacheRankBonusId;
  name: string;
  summary: string;
  icon: PxIconName;
  color: string;
  ranks: number;
  maxRanks: number;
  /** Current total effect as a fraction (ranks × per-rank). */
  effect: number;
  /** Effect of one rank as a fraction (the levered per-rank value). */
  perRank: number;
  /** Token cost of the next rank, or null at the cap. */
  nextCost: number | null;
  maxed: boolean;
}

export interface CacheRankMilestoneView {
  level: number;
  bundle: number;
  /** Claimed = the grant watermark has reached this level. */
  claimed: boolean;
}

export interface CacheRankStateView {
  /** Spendable token balance (server record). */
  tokens: number;
  /** Total tokens ever granted (entitlement at the watermark). */
  tokensEarned: number;
  /** The player's server level — the earning input. */
  level: number;
  /** XP inside the current level + the level's XP span (next-token progress). */
  xpIntoLevel: number;
  xpForLevel: number;
  /** The next level that pays a token (level + 1), or null at the cap. */
  nextTokenLevel: number | null;
  milestones: CacheRankMilestoneView[];
  tracks: CacheRankTrackView[];
  bonuses: CacheRankBonuses;
}

export function cacheRankStateView(input: {
  level: number;
  playerXp: number;
  tokens: number;
  grantLevel: number;
  spends: unknown;
  levers?: Partial<CacheRankLeverValues> | null;
}): CacheRankStateView {
  const levers = resolveCacheRankLevers(input.levers);
  const level = Math.max(1, Math.trunc(input.level) || 1);
  const clean = sanitizeCacheRankSpends(input.spends);
  const bonuses = cacheRankBonuses(clean, levers);
  const tracks = CACHE_RANK_BONUS_DEFS.map((def) => {
    const ranks = clean[def.id];
    const maxed = ranks >= def.maxRanks;
    return {
      id: def.id,
      name: def.name,
      summary: def.summary,
      icon: def.icon,
      color: def.color,
      ranks,
      maxRanks: def.maxRanks,
      effect: bonuses[def.id],
      perRank: levers[def.leverKey],
      nextCost: maxed ? null : cacheRankCostForRank(ranks, levers),
      maxed,
    };
  });
  return {
    tokens: Math.max(0, Math.trunc(input.tokens) || 0),
    tokensEarned: cacheRankEntitlement(input.grantLevel, levers),
    level,
    xpIntoLevel: Math.max(0, Math.trunc(input.playerXp) || 0),
    xpForLevel: level >= 100 ? 0 : xpToNextLevel(level),
    nextTokenLevel: level >= 100 ? null : level + 1,
    milestones: CACHE_RANK_MILESTONE_LEVELS.map((milestone) => ({
      level: milestone,
      bundle: cacheRankMilestoneBundle(milestone, levers),
      claimed: input.grantLevel >= milestone,
    })),
    tracks,
    bonuses,
  };
}

/** Format a bonus fraction the way the panel shows it: +1.0%, +0.5%, +2%. */
export function formatCacheRankPct(fraction: number): string {
  const pct = fraction * 100;
  const rounded = Math.round(pct * 10) / 10;
  return `+${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}
