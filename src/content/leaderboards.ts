/**
 * Weekly leaderboards — stat races, rotation, and rewards
 * (expansion run unit 29; Michael's Torn directive: weekly
 * leaderboards with rewards).
 *
 * This module is the ONE content owner for the weekly race system:
 * which races exist, how the weekly slate rotates, how ties break,
 * and what a finish pays. The standings themselves are a fold over
 * server records (src/server/leaderboards/fold.ts) — this module
 * never touches player state, and nothing here is a lever: like the
 * world-boss tier table, race/reward amounts are CONTENT (the
 * event's identity), not live economy config.
 *
 * The weekly cycle follows the world-boss brief's settlement
 * pattern (§2.1/§2.7): weeks are ISO weeks in UTC (Monday 00:00:00
 * UTC open → next Monday close), week identity is the Monday date,
 * and settlement rides the daily heartbeat — a closed week settles
 * exactly once, self-healing after outages, with no new cron.
 */

// ---------------------------------------------------------------------------
// Week math — ISO weeks, UTC. Week identity = the Monday's date.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;

/** The Monday 00:00:00.000 UTC that opens the ISO week containing `date`. */
export function isoWeekStart(date: Date): Date {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay: 0 = Sunday … 6 = Saturday. ISO weeks start Monday.
  const daysSinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

/** Week key = the Monday date (YYYY-MM-DD, UTC). The whole system keys on it. */
export function weekKeyOf(date: Date): string {
  return isoWeekStart(date).toISOString().slice(0, 10);
}

/** The half-open window [start, end) a week key covers, as ISO strings. */
export function weekWindow(weekKey: string): { start: string; end: string } {
  const start = new Date(`${weekKey}T00:00:00.000Z`);
  return { start: start.toISOString(), end: new Date(start.getTime() + WEEK_MS).toISOString() };
}

/** The week key `offset` weeks from the week containing `date` (0 = current). */
export function weekKeyOffset(date: Date, offset: number): string {
  const start = isoWeekStart(date);
  start.setUTCDate(start.getUTCDate() + offset * 7);
  return start.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Race slate — every race folds from records the server already proves
// (the #234 lifetime fold's record families, windowed to one week):
//   roaming_kills     verified_action_ledger: cc_apply_chef_rewards +
//                     cc_settle_offline_roaming → rewards.kills_recorded
//   boss_victories    verified_action_ledger: cc_apply_boss_attempt
//                     with attempt.victory
//   elite_kills       verified_action_ledger: roaming.elite_kill →
//                     elite_kills (0023 telemetry)
//   caches_opened     verified_action_ledger: cc_make_item +
//                     cc_draw_item (the economy meter's cache_opens
//                     definition — both cache-open paths)
//   items_salvaged    verified_action_ledger: cc_recycle_item rows
//   endless_depth     endless_runs: best depth_reached among runs
//                     ENDED in the window (0028 law: an active run
//                     proves nothing)
//   market_sales      verified_action_ledger: cc_accept_listing rows,
//                     attributed to the SELLER named in the result
//                     (listing.seller_user_id) — the row's user is the
//                     buyer; NPC-seeded sales attribute to the NPC
//                     account, which the fold excludes
//   extraction_passes verified_action_ledger: cc_apply_extraction →
//                     passes_completed
// If a stat has no proving record it is not a race — no exceptions.
// ---------------------------------------------------------------------------

export type LeaderboardRaceId =
  | 'roaming_kills'
  | 'boss_victories'
  | 'elite_kills'
  | 'caches_opened'
  | 'items_salvaged'
  | 'endless_depth'
  | 'market_sales'
  | 'extraction_passes';

export interface LeaderboardRaceDef {
  id: LeaderboardRaceId;
  /** Player-facing name. */
  label: string;
  /** What one unit of the race value is ("kills", "victories", …). */
  unit: string;
  /** One-line player-facing description of what counts. */
  blurb: string;
  /**
   * Minimum value to QUALIFY for rewards. Standings list everyone
   * with a value above zero; rewards only pay at or above this —
   * a quiet week must not pay a champion's prize for a token effort.
   */
  minQualifyingValue: number;
}

export const LEADERBOARD_RACES: readonly LeaderboardRaceDef[] = [
  {
    id: 'roaming_kills',
    label: 'Roaming Kills',
    unit: 'kills',
    blurb: 'Hunter kills confirmed by roaming claims and offline settlements.',
    minQualifyingValue: 25,
  },
  {
    id: 'boss_victories',
    label: 'Boss Victories',
    unit: 'victories',
    blurb: 'Verified boss kills this week.',
    minQualifyingValue: 1,
  },
  {
    id: 'elite_kills',
    label: 'Elite Kills',
    unit: 'elites',
    blurb: 'Elite enemies downed while roaming.',
    minQualifyingValue: 1,
  },
  {
    id: 'caches_opened',
    label: 'Caches Opened',
    unit: 'caches',
    blurb: 'Caches opened this week.',
    minQualifyingValue: 1,
  },
  {
    id: 'items_salvaged',
    label: 'Items Salvaged',
    unit: 'items',
    blurb: 'Items recycled through salvage.',
    minQualifyingValue: 5,
  },
  {
    id: 'endless_depth',
    label: 'Endless Depth',
    unit: 'depth',
    blurb: 'Deepest Endless depth reached in a run that ended this week.',
    minQualifyingValue: 1,
  },
  {
    id: 'market_sales',
    label: 'Market Sales',
    unit: 'sales',
    blurb: 'Player-market listings you sold this week.',
    minQualifyingValue: 1,
  },
  {
    id: 'extraction_passes',
    label: 'Extraction Passes',
    unit: 'passes',
    blurb: 'Extraction passes finalized this week.',
    minQualifyingValue: 1,
  },
];

export const LEADERBOARD_RACE_BY_ID: ReadonlyMap<LeaderboardRaceId, LeaderboardRaceDef> =
  new Map(LEADERBOARD_RACES.map((race) => [race.id, race]));

/** How many races run each week. */
export const RACES_PER_WEEK = 4;

// ---------------------------------------------------------------------------
// Rotation — deterministic from the week key alone. A seeded shuffle
// (FNV-1a → mulberry32, the codebase's hash/RNG family) of the full
// slate, first RACES_PER_WEEK entries run. Every server and client
// derives the identical slate for a week with no coordination and
// no stored state — the hot-area/vendor-rotation rule: a rotation
// that dies when a job doesn't fire is not a rotation.
// ---------------------------------------------------------------------------

/** FNV-1a — the same hash family hotArea.ts and the pixel layer use. */
function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The races featured in a week, in board order. Deterministic worldwide. */
export function racesForWeek(weekKey: string): LeaderboardRaceDef[] {
  const rng = mulberry32(hashString(`leaderboard-races:${weekKey}`));
  const shuffled = [...LEADERBOARD_RACES];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, RACES_PER_WEEK);
}

// ---------------------------------------------------------------------------
// Rewards — paid once, at settlement, from the settled standings.
//
// Cache keys: the podium pays 3 / 2 / 1 keys. Sizing against the
// shipped cache economy: since migration 0037 every cache opening
// — free, key-paid, or ad-attested — draws on one daily budget
// (cacheBoxDailyCap, default 10), so keys from ANY source only
// ever buy ad-free openings inside that budget, and a week of
// races mints at most RACES_PER_WEEK × (3 + 2 + 1) = 24 keys
// across the ENTIRE player base — a stock any single active
// player burns through in ~2-3 days of key-paid openings. Keys
// are metered as their own source (cache_keys_from_leaderboards,
// migration 0035), never folded into the openings meters
// (cache_boxes_opened_*), whose accounting counts openings, not
// key sources.
//
// Drop luck: a timed buff recorded server-side (leaderboard_drop_
// buffs) and consumed by the real drop paths — roaming rarity
// weights (Epic/Legendary × (1 + bonus)) and the boss dedicated-
// drop chance (× (1 + bonus)). Buffs never stack: the active bonus
// is the MAX of the player's unexpired grants. Durations run from
// the settlement instant, not the week close.
// ---------------------------------------------------------------------------

export interface LeaderboardRewardTier {
  cacheKeys: number;
  /** Drop-luck bonus fraction (0.25 = +25%). */
  buffBonus: number;
  /** Buff duration from settlement, in hours. */
  buffHours: number;
}

const REWARD_TIERS: readonly (LeaderboardRewardTier | undefined)[] = [
  undefined, // rank 0 — no such rank
  { cacheKeys: 3, buffBonus: 0.25, buffHours: 48 }, // 1st
  { cacheKeys: 2, buffBonus: 0.2, buffHours: 36 }, // 2nd
  { cacheKeys: 1, buffBonus: 0.15, buffHours: 24 }, // 3rd
];

/** Ranks 4–10 earn the finisher buff only — no keys. */
const FINISHER_TIER: LeaderboardRewardTier = { cacheKeys: 0, buffBonus: 0.1, buffHours: 12 };
export const LAST_REWARDED_RANK = 10;

/**
 * The reward a rank earns, or null when the rank pays nothing.
 * Qualification (the race's minQualifyingValue) is applied by the
 * caller — this table is rank-only.
 */
export function rewardForRank(rank: number): LeaderboardRewardTier | null {
  if (!Number.isInteger(rank) || rank < 1 || rank > LAST_REWARDED_RANK) return null;
  return REWARD_TIERS[rank] ?? FINISHER_TIER;
}
