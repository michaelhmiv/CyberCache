/**
 * Weekly leaderboard standings — the ONE fold both the read path
 * (src/server/reads) and settlement (src/server/leaderboards/store)
 * run, fed the same input shape by the Pg and in-memory stores, so
 * the board a player sees and the standings settlement pays from
 * can never disagree about what a record means.
 *
 * The discipline is #234's: every value folds from server records
 * only (the verified action ledger's result payloads + ended
 * endless_runs rows), ranks are computed from in-window records
 * only, and no client-reported number enters the chain. A player
 * appears only if a profile row exists (the legacy leaderboard's
 * inner-join rule) and they are not on the exclusion list (the NPC
 * market account — its seeded sales are not a player's race).
 *
 * Tie-breaking (content law, src/content/leaderboards.ts): value
 * desc, then EARLIEST to reach the final value (the timestamp of
 * the last contributing record — contributions are non-negative,
 * so a total first equals its final value at its last contribution;
 * for endless depth, the earliest ended run that set the max),
 * then account creation order, then player id — fully
 * deterministic, no shared ranks.
 */
import {
  racesForWeek,
  weekWindow,
  type LeaderboardRaceId,
} from '../../content/leaderboards';

/** Ledger action types the weekly fold reads (fetches filter on this). */
export const WEEKLY_FOLD_ACTION_TYPES: readonly string[] = [
  'cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'roaming.elite_kill',
  'cc_apply_boss_attempt', 'cc_make_item', 'cc_draw_item',
  'cc_recycle_item', 'cc_accept_listing', 'cc_apply_extraction',
];

export interface WeeklyProfileData {
  id: string;
  username: string | null;
  /** Account creation (ISO) — the third tie-break. */
  created_at: string;
}

export interface WeeklyLedgerData {
  user_id: string;
  action_type: string;
  result_payload: Record<string, unknown>;
  created_at: string;
}

export interface WeeklyEndlessRunData {
  user_id: string;
  status: string;
  depth_reached: number;
  ended_at: string | null;
}

/** Raw record set for the weekly fold — one shape for every store. */
export interface WeeklyFoldInput {
  profiles: WeeklyProfileData[];
  ledger: WeeklyLedgerData[];
  endlessRuns: WeeklyEndlessRunData[];
  /** Player ids that never rank (the NPC market account). */
  excludedPlayerIds?: readonly string[];
}

export interface RaceStanding {
  rank: number;
  player_id: string;
  username: string | null;
  value: number;
  /** ISO instant the player reached their final value. */
  reached_at: string;
}

function foldRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function foldNum(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

interface Accumulator {
  value: number;
  reachedAtMs: number;
}

function bump(acc: Map<string, Accumulator>, playerId: string, delta: number, atMs: number): void {
  if (delta <= 0) return;
  const current = acc.get(playerId);
  if (current) {
    current.value += delta;
    current.reachedAtMs = atMs;
  } else {
    acc.set(playerId, { value: delta, reachedAtMs: atMs });
  }
}

/**
 * One race's contribution from one ledger row: the attributed
 * player + a non-negative delta, or null when the row does not
 * count for this race. Attribution is per-race: market sales belong
 * to the SELLER named in the result (the row's user is the buyer);
 * everything else belongs to the row's user.
 */
function ledgerContribution(
  raceId: LeaderboardRaceId,
  row: WeeklyLedgerData,
): { playerId: string; delta: number } | null {
  const payload = foldRecord(row.result_payload);
  switch (raceId) {
    case 'roaming_kills':
      if (row.action_type === 'cc_apply_chef_rewards' || row.action_type === 'cc_settle_offline_roaming') {
        return { playerId: row.user_id, delta: foldNum(foldRecord(payload.rewards).kills_recorded) };
      }
      return null;
    case 'boss_victories':
      if (row.action_type === 'cc_apply_boss_attempt' && foldRecord(payload.attempt).victory === true) {
        return { playerId: row.user_id, delta: 1 };
      }
      return null;
    case 'elite_kills':
      if (row.action_type === 'roaming.elite_kill') {
        return { playerId: row.user_id, delta: foldNum(payload.elite_kills) };
      }
      return null;
    case 'caches_opened':
      if (row.action_type === 'cc_make_item' || row.action_type === 'cc_draw_item') {
        return { playerId: row.user_id, delta: 1 };
      }
      return null;
    case 'items_salvaged':
      if (row.action_type === 'cc_recycle_item') {
        return { playerId: row.user_id, delta: 1 };
      }
      return null;
    case 'market_sales': {
      if (row.action_type !== 'cc_accept_listing') return null;
      const seller = foldRecord(payload.listing).seller_user_id;
      return typeof seller === 'string' && seller.length > 0
        ? { playerId: seller, delta: 1 }
        : null;
    }
    case 'extraction_passes':
      if (row.action_type === 'cc_apply_extraction') {
        return { playerId: row.user_id, delta: foldNum(payload.passes_completed) };
      }
      return null;
    case 'endless_depth':
      return null; // folds from endless_runs rows, never the ledger
    default:
      return null;
  }
}

/**
 * Ranked standings for one race over one window. Everyone with a
 * value above zero is listed (reward qualification is a separate,
 * settlement-side rule); ranks are dense and unique.
 */
export function computeRaceStandings(
  input: WeeklyFoldInput,
  raceId: LeaderboardRaceId,
  windowStart: string,
  windowEnd: string,
): RaceStanding[] {
  const startMs = Date.parse(windowStart);
  const endMs = Date.parse(windowEnd);
  const profiles = new Map(input.profiles.map((p) => [p.id, p]));
  const excluded = new Set(input.excludedPlayerIds ?? []);
  const acc = new Map<string, Accumulator>();

  if (raceId === 'endless_depth') {
    const runs = input.endlessRuns
      .filter((run) => run.status !== 'active' && run.ended_at !== null)
      .map((run) => ({ run, endedMs: Date.parse(run.ended_at as string) }))
      .filter(({ endedMs }) => endedMs >= startMs && endedMs < endMs)
      .sort((a, b) => a.endedMs - b.endedMs);
    for (const { run, endedMs } of runs) {
      if (run.depth_reached <= 0) continue;
      const current = acc.get(run.user_id);
      // Strictly-greater updates only: reached_at stays at the
      // EARLIEST ended run that achieved the final max depth.
      if (!current || run.depth_reached > current.value) {
        acc.set(run.user_id, { value: run.depth_reached, reachedAtMs: endedMs });
      }
    }
  } else {
    const rows = [...input.ledger].sort(
      (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at),
    );
    for (const row of rows) {
      const atMs = Date.parse(row.created_at);
      if (atMs < startMs || atMs >= endMs) continue;
      const contribution = ledgerContribution(raceId, row);
      if (contribution) bump(acc, contribution.playerId, contribution.delta, atMs);
    }
  }

  const standings: Array<RaceStanding & { accountCreatedMs: number }> = [];
  for (const [playerId, entry] of acc) {
    if (entry.value <= 0 || excluded.has(playerId)) continue;
    const profile = profiles.get(playerId);
    if (!profile) continue; // inner join: no profile, no board row
    standings.push({
      rank: 0,
      player_id: playerId,
      username: profile.username,
      value: entry.value,
      reached_at: new Date(entry.reachedAtMs).toISOString(),
      accountCreatedMs: Date.parse(profile.created_at),
    });
  }
  standings.sort((a, b) =>
    b.value - a.value
    || a.reached_at.localeCompare(b.reached_at)
    || a.accountCreatedMs - b.accountCreatedMs
    || a.player_id.localeCompare(b.player_id));
  standings.forEach((row, i) => { row.rank = i + 1; });
  return standings.map(({ accountCreatedMs: _ignored, ...row }) => row);
}

/** Standings for every race featured in a week, keyed by race id. */
export function computeWeeklyStandings(
  input: WeeklyFoldInput,
  weekKey: string,
): Map<LeaderboardRaceId, RaceStanding[]> {
  const { start, end } = weekWindow(weekKey);
  const out = new Map<LeaderboardRaceId, RaceStanding[]>();
  for (const race of racesForWeek(weekKey)) {
    out.set(race.id, computeRaceStandings(input, race.id, start, end));
  }
  return out;
}
