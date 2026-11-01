/**
 * Daily login streak — the escalating daily-return ladder
 * (login-streak slice, migration 0036).
 *
 * This module is the ONE content owner for the streak rules: the
 * 7-day reward ladder, the tiered cycle repeat, the streak
 * arithmetic (consecutive UTC days), the lever surface (defaults +
 * hard clamps), and the state-view derivation the Dashboard panel
 * renders. Engines, routes, stores, and screens all read from
 * here — nobody re-derives a magnitude.
 *
 * The laws this file encodes:
 *
 *  - THE ANCHOR IS A SERVER-RECORDED DAY, NEVER A CLIENT CLOCK.
 *    A streak day is earned when the server records the player's
 *    first authenticated check-in of a UTC day
 *    (cc_record_login_streak_day, invoked by the observe-and-record
 *    GET /api/login-streak/me — the Cache Rank pattern). The day
 *    comes from the database clock; no request body field can name
 *    a day, a streak length, or an amount.
 *  - EXACTLY ONCE PER UTC DAY. The login_streak_claims row keyed
 *    (player, day) is the idempotency anchor: a replayed check-in
 *    returns the stored claim and grants nothing again.
 *  - CONSECUTIVE OR RESET. A claim on the UTC day after the last
 *    claim extends the streak; any larger gap restarts it at 1.
 *    The longest streak is kept forever (login_streak_state +
 *    max(streak_length) over the claims — the profile fold's
 *    record, in its own style).
 *  - THE LADDER REPEATS IN TIERS. Days 1–6 escalate credits into
 *    credits + cache fragments; day 7 adds a cache KEY. After day 7
 *    the cycle repeats at the next tier (×1.5 per tier step),
 *    capped at tier 5 (×3). The key never scales: one per completed
 *    cycle, a ceiling by construction (≤1 key/week/player), and it
 *    is metered as its own source — not a leaderboard key, not
 *    cache-lane (ad) issuance.
 *  - SIZING IS DELIBERATELY SMALL. Baseline roaming pays
 *    ~15 credits/minute (area idleCreditsPerMinute), so a tier-1
 *    week (1,900 credits) is ≈2 hours of baseline roaming spread
 *    across 7 days, and the 9 tier-1 fragments ≈1 hour of roaming
 *    fragment drops (0.008/tick) — a real welcome-back nudge for a
 *    returning player, small change for an established one. The
 *    credit/fragment magnitudes are economy levers
 *    (streakCreditScalar / streakFragmentScalar); the ladder shape
 *    and the key are content, not levers.
 *  - GUESTS EARN IDENTICALLY. Guest accounts are full accounts in
 *    this game (guest start stays); grants key on the profile row,
 *    never on account state — same posture as Cache Rank.
 */

// ─── The ladder ──────────────────────────────────────────────────────

/** Days per streak cycle; the ladder is one week long. */
export const LOGIN_STREAK_CYCLE_DAYS = 7;

/**
 * Highest cycle tier. Tier t pays the tier-1 ladder scaled by
 * 1 + 0.5 × (t − 1), so the ceiling tier 5 pays ×3. A streak longer
 * than 35 days keeps cycling at tier 5.
 */
export const LOGIN_STREAK_TIER_CEILING = 5;

export interface LoginStreakReward {
  cycleDay: number;
  tier: number;
  credits: number;
  fragments: number;
  cacheKeys: number;
}

/** Tier-1 ladder, cycle days 1–7 (credits, fragments, cache keys). */
const LOGIN_STREAK_TIER_ONE: ReadonlyArray<{
  credits: number;
  fragments: number;
  cacheKeys: number;
}> = [
  { credits: 100, fragments: 0, cacheKeys: 0 },
  { credits: 150, fragments: 0, cacheKeys: 0 },
  { credits: 200, fragments: 1, cacheKeys: 0 },
  { credits: 250, fragments: 1, cacheKeys: 0 },
  { credits: 300, fragments: 2, cacheKeys: 0 },
  { credits: 400, fragments: 2, cacheKeys: 0 },
  { credits: 500, fragments: 3, cacheKeys: 1 },
];

/** Tier scaling: tier 1 ×1, tier 2 ×1.5, … tier 5 ×3. */
export function loginStreakTierMultiplier(tier: number): number {
  const t = Math.min(LOGIN_STREAK_TIER_CEILING, Math.max(1, Math.trunc(tier) || 1));
  return 1 + 0.5 * (t - 1);
}

/** The BASE reward (before levers) for a cycle day at a tier. */
export function loginStreakReward(cycleDay: number, tier: number): LoginStreakReward {
  const day = Math.min(LOGIN_STREAK_CYCLE_DAYS, Math.max(1, Math.trunc(cycleDay) || 1));
  const t = Math.min(LOGIN_STREAK_TIER_CEILING, Math.max(1, Math.trunc(tier) || 1));
  const base = LOGIN_STREAK_TIER_ONE[day - 1];
  const mult = loginStreakTierMultiplier(t);
  return {
    cycleDay: day,
    tier: t,
    credits: Math.floor(base.credits * mult),
    fragments: Math.floor(base.fragments * mult),
    cacheKeys: base.cacheKeys,
  };
}

/**
 * The full seeded table (tiers 1–5 × days 1–7, ordered by tier then
 * cycle day) — mirrored row-for-row by the
 * login_streak_reward_definitions seed in migration 0036 and
 * pinned equal by tests + the SQL harness.
 */
export const LOGIN_STREAK_REWARD_TABLE: LoginStreakReward[] = (() => {
  const rows: LoginStreakReward[] = [];
  for (let tier = 1; tier <= LOGIN_STREAK_TIER_CEILING; tier += 1) {
    for (let day = 1; day <= LOGIN_STREAK_CYCLE_DAYS; day += 1) {
      rows.push(loginStreakReward(day, tier));
    }
  }
  return rows;
})();

// ─── Streak arithmetic (UTC days as YYYY-MM-DD strings) ─────────────

/** UTC day (YYYY-MM-DD) of a Date — the codebase's UTC-day convention. */
export function loginStreakUtcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD day by whole UTC days. */
export function loginStreakAddDays(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Where a streak length lands in the ladder: its cycle day + tier. */
export function loginStreakPositionFor(streakLength: number): { cycleDay: number; tier: number } {
  const len = Math.max(1, Math.trunc(streakLength) || 1);
  return {
    cycleDay: ((len - 1) % LOGIN_STREAK_CYCLE_DAYS) + 1,
    tier: Math.min(LOGIN_STREAK_TIER_CEILING, Math.floor((len - 1) / LOGIN_STREAK_CYCLE_DAYS) + 1),
  };
}

/**
 * The streak length a claim on `today` produces, given the stored
 * streak and the last claimed day: yesterday's claim extends it,
 * today's claim keeps it (the exactly-once row makes that path a
 * replay, not a new grant), anything older restarts it at 1.
 */
export function loginStreakLengthAfter(
  lastClaimDay: string | null,
  currentStreak: number,
  today: string,
): number {
  if (lastClaimDay === today) return Math.max(1, Math.trunc(currentStreak) || 1);
  if (lastClaimDay !== null && lastClaimDay === loginStreakAddDays(today, -1)) {
    return Math.max(1, Math.trunc(currentStreak) || 0) + 1;
  }
  return 1;
}

// ─── Levers ──────────────────────────────────────────────────────────

/**
 * The login-streak lever surface. The amounts are the
 * economy-critical constants, so they are live economy levers
 * (0018 pattern: registered in src/server/economy/config.ts, read
 * through the ONE EconomyConfig accessor, mirrored into SQL by
 * cc_economy_config_number with the same clamps at the SQL call
 * site). Defaults and hard clamps live HERE (content) and the
 * config registry mirrors them, pinned equal by tests — TS and SQL
 * can never disagree about the shipped default.
 */
export interface LoginStreakLeverValues {
  /** Scalar on every ladder credit amount (floored after scaling). */
  streakCreditScalar: number;
  /** Scalar on every ladder fragment amount (floored after scaling). */
  streakFragmentScalar: number;
}

export const LOGIN_STREAK_LEVER_DEFAULTS: LoginStreakLeverValues = {
  streakCreditScalar: 1,
  streakFragmentScalar: 1,
};

/** Hard clamps per lever — the SQL call site clamps identically. */
export const LOGIN_STREAK_LEVER_CLAMPS: Record<
  keyof LoginStreakLeverValues,
  { min: number; max: number; integer?: boolean }
> = {
  streakCreditScalar: { min: 0, max: 3 },
  streakFragmentScalar: { min: 0, max: 3 },
};

function clampLever(key: keyof LoginStreakLeverValues, value: number): number {
  const clamp = LOGIN_STREAK_LEVER_CLAMPS[key];
  const clamped = Math.min(clamp.max, Math.max(clamp.min, value));
  return clamp.integer ? Math.trunc(clamped) : clamped;
}

/**
 * Merge raw lever values over the shipped defaults, dropping
 * anything non-numeric and clamping the rest — the cache-rank
 * resolve shape, so a stored value can never push a grant outside
 * the documented band.
 */
export function resolveLoginStreakLevers(
  partial?: Partial<LoginStreakLeverValues> | null,
): LoginStreakLeverValues {
  const values: LoginStreakLeverValues = { ...LOGIN_STREAK_LEVER_DEFAULTS };
  if (!partial) return values;
  for (const key of Object.keys(LOGIN_STREAK_LEVER_DEFAULTS) as Array<keyof LoginStreakLeverValues>) {
    const raw = partial[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      values[key] = clampLever(key, raw);
    }
  }
  return values;
}

/** A ladder reward with the levers applied (the grant amounts). */
export function loginStreakGrantFor(
  cycleDay: number,
  tier: number,
  levers: LoginStreakLeverValues,
): LoginStreakReward {
  const base = loginStreakReward(cycleDay, tier);
  return {
    ...base,
    credits: Math.floor(base.credits * levers.streakCreditScalar),
    fragments: Math.floor(base.fragments * levers.streakFragmentScalar),
  };
}

// ─── Facts + state view ──────────────────────────────────────────────

/** One recorded claim day (a login_streak_claims row, camel-cased). */
export interface LoginStreakClaim {
  day: string;
  streakLength: number;
  cycleDay: number;
  tier: number;
  creditsAwarded: number;
  fragmentsAwarded: number;
  cacheKeysAwarded: number;
}

/** Server-record facts the view derives from (routes/stores supply). */
export interface LoginStreakFacts {
  /** Streak length as of the last claim (stored state). */
  currentStreak: number;
  /** Best streak ever (stored state; also max over the claims). */
  longestStreak: number;
  /** YYYY-MM-DD of the last recorded claim, or null if never. */
  lastClaimDay: string | null;
  /** Today's claim when it exists (the check-in records it first). */
  todayClaim: LoginStreakClaim | null;
}

export type LoginStreakDayState = 'earned' | 'today' | 'upcoming';

export interface LoginStreakDayView extends LoginStreakReward {
  state: LoginStreakDayState;
}

export interface LoginStreakStateView {
  /** Effective current streak (0 once a missed day has broken it). */
  currentStreak: number;
  longestStreak: number;
  /** Tier of the cycle the ladder displays. */
  tier: number;
  /** Cycle day the next claim lands on within the displayed cycle. */
  cycleDay: number;
  /** 'earned' once today's claim is recorded, else 'pending'. */
  todayState: 'earned' | 'pending';
  /** What today's claim paid (null until recorded). */
  todayReward: LoginStreakReward | null;
  /** What the next claim day pays (lever-applied ladder amounts). */
  nextReward: LoginStreakReward;
  /** The streak length the next claim produces. */
  nextStreakLength: number;
  /** The 7-day ladder at the displayed tier, lever-applied. */
  ladder: LoginStreakDayView[];
  /** Player-facing statement of the miss rule. */
  missRule: string;
}

export const LOGIN_STREAK_MISS_RULE =
  'Miss a day and the streak restarts at Day 1 — your longest streak is kept on your profile.';

/**
 * Derive the panel view from server facts. Pure: the routes (and
 * the in-memory twin's tests) share this derivation, so the Pg and
 * memory paths can never show different streaks.
 */
export function loginStreakStateView(
  facts: LoginStreakFacts,
  levers: LoginStreakLeverValues,
  today: string,
): LoginStreakStateView {
  const claim = facts.todayClaim;
  let currentStreak: number;
  let position: { cycleDay: number; tier: number };
  let ladderStates: LoginStreakDayState[];
  let nextStreakLength: number;
  let todayReward: LoginStreakReward | null = null;

  if (claim) {
    currentStreak = claim.streakLength;
    position = { cycleDay: claim.cycleDay, tier: claim.tier };
    todayReward = {
      cycleDay: claim.cycleDay,
      tier: claim.tier,
      credits: claim.creditsAwarded,
      fragments: claim.fragmentsAwarded,
      cacheKeys: claim.cacheKeysAwarded,
    };
    ladderStates = Array.from({ length: LOGIN_STREAK_CYCLE_DAYS }, (_, i) =>
      i + 1 < claim.cycleDay ? 'earned' : i + 1 === claim.cycleDay ? 'today' : 'upcoming',
    );
    nextStreakLength = claim.streakLength + 1;
  } else {
    // Not yet recorded today: the streak is alive only if the last
    // claim was yesterday; the ladder shows the cycle the next
    // claim lands in, with its earlier days already earned.
    const alive = facts.lastClaimDay !== null && facts.lastClaimDay === loginStreakAddDays(today, -1);
    currentStreak = alive ? Math.max(0, Math.trunc(facts.currentStreak) || 0) : 0;
    nextStreakLength = currentStreak + 1;
    position = loginStreakPositionFor(nextStreakLength);
    ladderStates = Array.from({ length: LOGIN_STREAK_CYCLE_DAYS }, (_, i) =>
      i + 1 < position.cycleDay ? 'earned' : i + 1 === position.cycleDay ? 'today' : 'upcoming',
    );
  }

  const nextPosition = loginStreakPositionFor(nextStreakLength);
  return {
    currentStreak,
    longestStreak: Math.max(
      Math.trunc(facts.longestStreak) || 0,
      claim ? claim.streakLength : 0,
    ),
    tier: position.tier,
    cycleDay: position.cycleDay,
    todayState: claim ? 'earned' : 'pending',
    todayReward,
    nextReward: loginStreakGrantFor(nextPosition.cycleDay, nextPosition.tier, levers),
    nextStreakLength,
    ladder: Array.from({ length: LOGIN_STREAK_CYCLE_DAYS }, (_, i) => ({
      ...loginStreakGrantFor(i + 1, position.tier, levers),
      state: ladderStates[i],
    })),
    missRule: LOGIN_STREAK_MISS_RULE,
  };
}

/** Compact one-line reward label for the panel ("200 cr · 1 frag · key"). */
export function formatLoginStreakReward(reward: LoginStreakReward): string {
  const parts: string[] = [];
  if (reward.credits > 0) parts.push(`${reward.credits} cr`);
  if (reward.fragments > 0) parts.push(`${reward.fragments} frag`);
  if (reward.cacheKeys > 0) parts.push(reward.cacheKeys === 1 ? 'cache key' : `${reward.cacheKeys} keys`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}
