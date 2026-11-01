/**
 * LeaderboardStore — weekly race SETTLEMENT (migration 0035).
 *
 * Settlement rides the daily heartbeat (world-boss brief §2.7, the
 * jobs pattern): every week whose close has passed and that has no
 * settlement row settles — one week normally, several after an
 * outage, none idempotently. The Pg implementation claims a week by
 * inserting its leaderboard_settlements row INSIDE the transaction
 * that pays; a conflict means another run owns (or owned) the week
 * and the attempt is a no-op, and a failure anywhere rolls the
 * claim back with the payments so the next heartbeat retries the
 * week whole. Exactly-once is therefore a property of the schema,
 * not of careful coding.
 *
 * Payments, per settled race (content: src/content/leaderboards.ts):
 * qualifiers are standings at or above the race's qualifying
 * minimum; ranks 1–3 receive cache keys (profiles.cache_tokens) and
 * ranks 1–10 receive a drop-luck buff row whose expiry runs from
 * the settlement instant. Every payment writes one
 * verified_action_ledger row ('cc_leaderboard_settlement',
 * idempotency key 'leaderboard-settlement:{week}:{race}') carrying
 * cache_keys_awarded — the economy meter's attribution source
 * (cache_keys_from_leaderboards) and a second exactly-once guard.
 *
 * Both implementations share the standings fold
 * (src/server/leaderboards/fold.ts) and the reward planner below:
 * Pg fetches raw rows and writes outcomes transactionally (the
 * jobs store's direct-table precedent); the in-memory store mirrors
 * the same observable semantics over its seed for tests.
 */
import type { Pool } from 'pg';
import {
  LEADERBOARD_RACE_BY_ID,
  racesForWeek,
  rewardForRank,
  weekKeyOf,
  weekWindow,
  WEEK_MS,
  type LeaderboardRaceId,
} from '../../content/leaderboards';
import { NPC_MARKET_USER_ID } from '../lib/npcMarket';
import {
  computeWeeklyStandings,
  WEEKLY_FOLD_ACTION_TYPES,
  type RaceStanding,
  type WeeklyFoldInput,
} from './fold';

export interface LeaderboardSettlementSummary {
  /** Week keys settled by this call, ascending. */
  settledWeeks: string[];
  rewardsPaid: number;
  cacheKeysPaid: number;
}

export interface LeaderboardStore {
  /**
   * Settle every closed, unsettled week that has any race-relevant
   * record. Safe to call at any cadence — settled weeks are no-ops.
   */
  settleClosedWeeks(now: Date): Promise<LeaderboardSettlementSummary>;
}

/** One planned payment, before either store persists it. */
export interface PlannedReward {
  raceId: LeaderboardRaceId;
  playerId: string;
  rank: number;
  value: number;
  cacheKeys: number;
  buffBonus: number;
  buffHours: number;
  /** ISO instant the buff lapses (settledAt + buffHours); null when no buff. */
  buffExpiresAt: string | null;
}

/**
 * The reward plan for one settled week: standings → payments.
 * Qualification is value ≥ the race's minimum AND a paying rank —
 * both rules live here so the two stores cannot drift on who gets
 * paid. Keyed by the week being settled (never the settlement date:
 * a catch-up settlement pays last week's slate, not this week's).
 */
export function planWeekRewardsFor(
  weekKey: string,
  standingsByRace: Map<LeaderboardRaceId, RaceStanding[]>,
  settledAt: Date,
): PlannedReward[] {
  const planned: PlannedReward[] = [];
  for (const race of racesForWeek(weekKey)) {
    const def = LEADERBOARD_RACE_BY_ID.get(race.id);
    if (!def) continue;
    for (const standing of standingsByRace.get(race.id) ?? []) {
      if (standing.value < def.minQualifyingValue) continue;
      const tier = rewardForRank(standing.rank);
      if (!tier) continue;
      planned.push({
        raceId: race.id,
        playerId: standing.player_id,
        rank: standing.rank,
        value: standing.value,
        cacheKeys: tier.cacheKeys,
        buffBonus: tier.buffBonus,
        buffHours: tier.buffHours,
        buffExpiresAt: tier.buffHours > 0
          ? new Date(settledAt.getTime() + tier.buffHours * 60 * 60 * 1000).toISOString()
          : null,
      });
    }
  }
  return planned;
}

/**
 * Week keys that may need settlement: from the week of the earliest
 * record through the last CLOSED week (the current week never
 * settles). Capped so a pathological history cannot make one
 * heartbeat enumerate forever; the cap self-heals next run because
 * settled weeks drop out of the candidate set.
 */
export function candidateWeekKeys(earliestMs: number, now: Date, cap = 520): string[] {
  const currentWeekStartMs = Date.parse(`${weekKeyOf(now)}T00:00:00.000Z`);
  const firstMs = Date.parse(`${weekKeyOf(new Date(earliestMs))}T00:00:00.000Z`);
  const keys: string[] = [];
  for (let t = firstMs; t < currentWeekStartMs && keys.length < cap; t += WEEK_MS) {
    keys.push(new Date(t).toISOString().slice(0, 10));
  }
  return keys;
}

const FOLD_ACTION_TYPES = WEEKLY_FOLD_ACTION_TYPES;

type Row = Record<string, unknown>;

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function iso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export class PgLeaderboardStore implements LeaderboardStore {
  constructor(private readonly pool: Pool) {}

  async settleClosedWeeks(now: Date): Promise<LeaderboardSettlementSummary> {
    const { rows } = await this.pool.query<{ earliest: unknown }>(
      `select least(
         (select min(created_at) from public.verified_action_ledger),
         (select min(ended_at) from public.endless_runs where ended_at is not null)
       ) as earliest`,
    );
    const earliest = (rows[0] as Row | undefined)?.earliest;
    if (earliest === null || earliest === undefined) {
      return { settledWeeks: [], rewardsPaid: 0, cacheKeysPaid: 0 };
    }
    const summary: LeaderboardSettlementSummary = { settledWeeks: [], rewardsPaid: 0, cacheKeysPaid: 0 };
    for (const weekKey of candidateWeekKeys(Date.parse(iso(earliest)), now)) {
      const settled = await this.settleWeek(weekKey, now);
      if (settled) {
        summary.settledWeeks.push(weekKey);
        summary.rewardsPaid += settled.rewardsPaid;
        summary.cacheKeysPaid += settled.cacheKeysPaid;
      }
    }
    return summary;
  }

  /** Settle one week in a single transaction; null when already settled. */
  private async settleWeek(
    weekKey: string,
    now: Date,
  ): Promise<{ rewardsPaid: number; cacheKeysPaid: number } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      // Claim the week. The settlement row IS the exactly-once key:
      // inserted in the same transaction that pays, so conflicts
      // (already settled) and rollbacks (retry whole) are both free.
      const claim = await client.query(
        `insert into public.leaderboard_settlements (week_key, week_start, settled_at)
         values ($1, $2::date, $3::timestamptz)
         on conflict (week_key) do nothing
         returning week_key`,
        [weekKey, weekKey, now.toISOString()],
      );
      if (!claim.rows.length) {
        await client.query('commit');
        return null;
      }

      const { start, end } = weekWindow(weekKey);
      const input = await this.fetchFoldInput(client, start, end);
      const standings = computeWeeklyStandings(input, weekKey);
      const planned = planWeekRewardsFor(weekKey, standings, now);

      let cacheKeysPaid = 0;
      for (const reward of planned) {
        if (reward.cacheKeys > 0) {
          await client.query(
            'update public.profiles set cache_tokens = cache_tokens + $2 where id = $1',
            [reward.playerId, reward.cacheKeys],
          );
          cacheKeysPaid += reward.cacheKeys;
        }
        await client.query(
          `insert into public.leaderboard_rewards (
             week_key, race_id, player_id, rank, value, cache_keys,
             buff_bonus, buff_hours, buff_expires_at, paid_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            weekKey, reward.raceId, reward.playerId, reward.rank, reward.value,
            reward.cacheKeys, reward.buffBonus, reward.buffHours,
            reward.buffExpiresAt, now.toISOString(),
          ],
        );
        if (reward.buffExpiresAt) {
          await client.query(
            `insert into public.leaderboard_drop_buffs (
               player_id, bonus, source_week_key, source_race_id, granted_at, expires_at)
             values ($1, $2, $3, $4, $5, $6)`,
            [
              reward.playerId, reward.buffBonus, weekKey, reward.raceId,
              now.toISOString(), reward.buffExpiresAt,
            ],
          );
        }
        await client.query(
          `insert into public.verified_action_ledger (
             user_id, action_type, idempotency_key, request_payload, result_payload)
           values ($1, 'cc_leaderboard_settlement', $2, '{}'::jsonb, $3::jsonb)`,
          [
            reward.playerId,
            `leaderboard-settlement:${weekKey}:${reward.raceId}`,
            JSON.stringify({
              week_key: weekKey,
              race_id: reward.raceId,
              rank: reward.rank,
              value: reward.value,
              cache_keys_awarded: reward.cacheKeys,
              drop_buff_bonus: reward.buffBonus,
              drop_buff_hours: reward.buffHours,
              drop_buff_expires_at: reward.buffExpiresAt,
            }),
          ],
        );
      }

      await client.query(
        `update public.leaderboard_settlements
            set races_settled = $2, rewards_paid = $3, cache_keys_paid = $4
          where week_key = $1`,
        [weekKey, racesForWeek(weekKey).length, planned.length, cacheKeysPaid],
      );
      await client.query('commit');
      return { rewardsPaid: planned.length, cacheKeysPaid };
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  private async fetchFoldInput(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
    start: string,
    end: string,
  ): Promise<WeeklyFoldInput> {
    const profiles = await client.query(
      'select id, username, created_at from public.profiles order by created_at asc, id asc',
    );
    const ledger = await client.query(
      `select user_id, action_type, result_payload, created_at
         from public.verified_action_ledger
        where action_type = any($1::text[])
          and created_at >= $2::timestamptz and created_at < $3::timestamptz
        order by created_at asc`,
      [FOLD_ACTION_TYPES, start, end],
    );
    const runs = await client.query(
      `select user_id, status, depth_reached, ended_at
         from public.endless_runs
        where ended_at is not null
          and ended_at >= $1::timestamptz and ended_at < $2::timestamptz`,
      [start, end],
    );
    return {
      profiles: (profiles.rows as Row[]).map((row) => ({
        id: String(row.id),
        username: (row.username as string | null) ?? null,
        created_at: iso(row.created_at),
      })),
      ledger: (ledger.rows as Row[]).map((row) => ({
        user_id: String(row.user_id),
        action_type: String(row.action_type),
        result_payload: (row.result_payload as Record<string, unknown>) ?? {},
        created_at: iso(row.created_at),
      })),
      endlessRuns: (runs.rows as Row[]).map((row) => ({
        user_id: String(row.user_id),
        status: String(row.status),
        depth_reached: num(row.depth_reached),
        ended_at: row.ended_at === null || row.ended_at === undefined ? null : iso(row.ended_at),
      })),
      excludedPlayerIds: [NPC_MARKET_USER_ID],
    };
  }
}

// ---------------------------------------------------------------------------
// In-memory implementation (tests; single-process dev)
// ---------------------------------------------------------------------------

export interface LeaderboardProfileSeed {
  id: string;
  username: string | null;
  created_at: string;
  cache_tokens: number;
}

export interface LeaderboardRewardRecord {
  week_key: string;
  race_id: string;
  player_id: string;
  rank: number;
  value: number;
  cache_keys: number;
  buff_bonus: number;
  buff_hours: number;
  buff_expires_at: string | null;
  paid_at: string;
}

export interface LeaderboardBuffRecord {
  player_id: string;
  bonus: number;
  source_week_key: string;
  source_race_id: string;
  granted_at: string;
  expires_at: string;
}

export interface LeaderboardSettlementLedgerRecord {
  user_id: string;
  action_type: string;
  idempotency_key: string;
  result_payload: Record<string, unknown>;
  created_at: string;
}

export interface LeaderboardSeed {
  profiles: LeaderboardProfileSeed[];
  ledger: WeeklyFoldInput['ledger'];
  endlessRuns: WeeklyFoldInput['endlessRuns'];
  settlements: Array<{ week_key: string; settled_at: string }>;
  rewards: LeaderboardRewardRecord[];
  buffs: LeaderboardBuffRecord[];
  settlementLedger: LeaderboardSettlementLedgerRecord[];
}

export function emptyLeaderboardSeed(): LeaderboardSeed {
  return {
    profiles: [], ledger: [], endlessRuns: [],
    settlements: [], rewards: [], buffs: [], settlementLedger: [],
  };
}

export class InMemoryLeaderboardStore implements LeaderboardStore {
  readonly seed: LeaderboardSeed;

  constructor(seed: LeaderboardSeed = emptyLeaderboardSeed()) {
    this.seed = seed;
  }

  async settleClosedWeeks(now: Date): Promise<LeaderboardSettlementSummary> {
    const stamps: number[] = [
      ...this.seed.ledger.map((row) => Date.parse(row.created_at)),
      ...this.seed.endlessRuns
        .filter((run) => run.ended_at !== null)
        .map((run) => Date.parse(run.ended_at as string)),
    ].filter((t) => Number.isFinite(t));
    const summary: LeaderboardSettlementSummary = { settledWeeks: [], rewardsPaid: 0, cacheKeysPaid: 0 };
    if (!stamps.length) return summary;
    const settledKeys = new Set(this.seed.settlements.map((s) => s.week_key));
    for (const weekKey of candidateWeekKeys(Math.min(...stamps), now)) {
      if (settledKeys.has(weekKey)) continue;
      const standings = computeWeeklyStandings({
        profiles: this.seed.profiles,
        ledger: this.seed.ledger,
        endlessRuns: this.seed.endlessRuns,
        excludedPlayerIds: [NPC_MARKET_USER_ID],
      }, weekKey);
      const planned = planWeekRewardsFor(weekKey, standings, now);
      let cacheKeysPaid = 0;
      for (const reward of planned) {
        if (reward.cacheKeys > 0) {
          const profile = this.seed.profiles.find((p) => p.id === reward.playerId);
          if (profile) profile.cache_tokens += reward.cacheKeys;
          cacheKeysPaid += reward.cacheKeys;
        }
        this.seed.rewards.push({
          week_key: weekKey,
          race_id: reward.raceId,
          player_id: reward.playerId,
          rank: reward.rank,
          value: reward.value,
          cache_keys: reward.cacheKeys,
          buff_bonus: reward.buffBonus,
          buff_hours: reward.buffHours,
          buff_expires_at: reward.buffExpiresAt,
          paid_at: now.toISOString(),
        });
        if (reward.buffExpiresAt) {
          this.seed.buffs.push({
            player_id: reward.playerId,
            bonus: reward.buffBonus,
            source_week_key: weekKey,
            source_race_id: reward.raceId,
            granted_at: now.toISOString(),
            expires_at: reward.buffExpiresAt,
          });
        }
        this.seed.settlementLedger.push({
          user_id: reward.playerId,
          action_type: 'cc_leaderboard_settlement',
          idempotency_key: `leaderboard-settlement:${weekKey}:${reward.raceId}`,
          result_payload: {
            week_key: weekKey,
            race_id: reward.raceId,
            rank: reward.rank,
            value: reward.value,
            cache_keys_awarded: reward.cacheKeys,
            drop_buff_bonus: reward.buffBonus,
            drop_buff_hours: reward.buffHours,
            drop_buff_expires_at: reward.buffExpiresAt,
          },
          created_at: now.toISOString(),
        });
      }
      this.seed.settlements.push({ week_key: weekKey, settled_at: now.toISOString() });
      summary.settledWeeks.push(weekKey);
      summary.rewardsPaid += planned.length;
      summary.cacheKeysPaid += cacheKeysPaid;
    }
    return summary;
  }
}
