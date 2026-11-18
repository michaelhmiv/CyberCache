-- 0101_login_streak_day_boundary.sql
--
-- THE STREAK DAY STARTS AT 08:00 UTC (owner ruling 2026-11-17),
-- AND A PAID TODAY SHOWS ITS CHECK.
--
-- Two defects, one root area (the full investigation:
-- streak-audit-2026-11-17):
--
--  1. THE BOUNDARY. Through 0082 the streak day was the plain
--     UTC calendar date, so the day rolled at 19:00 Eastern.
--     An evening player straddled two game days inside one
--     local day: consecutive local-day sessions could land two
--     game days apart and reset the streak, and a morning
--     reward expired unpaid mid-evening (the owner's own Nov 17:
--     a 100-credit reward recorded 11:38 UTC expired at 00:00
--     UTC — 19:00 his time — 45 minutes before his claim tap).
--     The day key is now the UTC date of (now − 8 hours):
--     the day starts at 08:00 UTC, 3 AM Eastern / midnight
--     Pacific. Expiry moves with the boundary (an unclaimed
--     reward now lives until 08:00 UTC); reward amounts, the
--     miss rule, and the claim's exactly-once paid stamp do
--     NOT change. The offset belongs to the streak alone — the
--     other daily systems keep their own UTC days.
--
--  2. THE CHECK MARK (fixed in the state view, not here): the
--     ladder derived its day states from cycle position alone,
--     so the paid flag never reached the track and a successful
--     claim changed nothing on it. The content module now
--     derives an 'earned-today' state for a paid today; this
--     migration carries the boundary half.
--
-- This migration:
--   §1 cc_record_login_streak_day restated from its chain head
--      (0082 §10) with ONLY the day derivation changed.
--   §2 cc_claim_login_streak_day restated from its chain head
--      (0079 §3 — never restated since) with ONLY the day
--      derivation changed. The fragment leg stays: fragments
--      remain a live currency in 0101 even though the record
--      side awards none.
--   §3 TRANSITION: the recorded history is re-keyed onto the
--      new day so no player loses a streak day or a paid
--      reward because of the move (cases pinned in the drill
--      pack, mig0101/CASES.md):
--        * login_streak_claims.claimed_at is the record
--          instant (0036 inserts it as the record's p_now), so
--          a row still keyed under the OLD rule is exactly a
--          row whose claim_day equals the UTC date of
--          claimed_at. Rows recorded 00:00–08:00 UTC belong,
--          under the new rule, to the previous streak day.
--        * COLLISIONS: when two of a player's rows land on one
--          new day, ONE survives — the paid row if exactly one
--          is paid (a payment already made stays the day's
--          record; deleting it would reopen the day to a
--          second claim), else the earliest recorded (the new
--          rule's first check-in of the day is the record; the
--          later row would have been its replay). The loser's
--          streak day is not lost: it IS the survivor's day.
--        * STATE: login_streak_state is rebuilt from the
--          re-keyed rows — last_claim_day follows the rows, and
--          current_streak is the recomputed run FLOORED at its
--          pre-migration value, so a merge inside a run can
--          never shorten a streak the old rules had already
--          counted (cycle position and tier follow the floored
--          streak by the standard formulas).
--        * IDEMPOTENT: the shift condition matches only
--          old-keyed rows; a re-keyed row — and any row the
--          new functions record before 08:00 UTC — already
--          carries claim_day = utc date − 1 and never shifts
--          twice. The merge and the rebuild are set-based and
--          re-derive the same result.
--
-- Ledger idempotency keys embed the OLD day strings
-- ('login-streak:<player>:<day>'); they are historical records
-- of payments actually made and are NOT re-keyed — exactly-once
-- rides on the claim row's paid_at, never on re-deriving a key.
--
-- Guarded like its predecessors: raises unless the streak
-- tables exist.

do $$
begin
  if to_regclass('public.login_streak_claims') is null
     or to_regclass('public.login_streak_state') is null then
    raise exception '0101 requires the login streak tables (0036)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. cc_record_login_streak_day — 0082 §10 verbatim except the
--    day line: v_today is the STREAK day, (p_now − 8h)'s UTC date.
-- ---------------------------------------------------------------------

create or replace function public.cc_record_login_streak_day(
  p_player_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := ((p_now - interval '8 hours') at time zone 'UTC')::date;
  p public.profiles%rowtype;
  s public.login_streak_state%rowtype;
  c public.login_streak_claims%rowtype;
  d public.login_streak_reward_definitions%rowtype;
  v_streak integer;
  v_cycle_day integer;
  v_tier integer;
  v_credits bigint;
  v_keys integer;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  -- The day is recorded exactly once: today's claim row IS the
  -- record anchor. A replay returns the stored claim; whether its
  -- reward is still claimable rides on paid_at.
  select * into c from public.login_streak_claims
  where player_id = p_player_id and claim_day = v_today;
  if found then
    return jsonb_build_object(
      'action_type', 'cc_login_streak_claim',
      'already_claimed', true,
      'claimable', c.paid_at is null,
      'day', c.claim_day,
      'streak_length', c.streak_length,
      'cycle_day', c.cycle_day,
      'tier', c.tier,
      'credits_awarded', c.credits_awarded,
      'fragments_awarded', c.fragments_awarded,
      'cache_keys_awarded', c.cache_keys_awarded,
      'profile', public.cc_profile_snapshot(p)
    );
  end if;

  select * into s from public.login_streak_state where player_id = p_player_id;

  -- Streak arithmetic (mirrors loginStreakLengthAfter in the
  -- content module): yesterday extends, any older gap restarts.
  -- Recorded days only — payment state never enters this math.
  if s.player_id is not null and s.last_claim_day = v_today - 1 then
    v_streak := s.current_streak + 1;
  else
    v_streak := 1;
  end if;
  v_cycle_day := ((v_streak - 1) % 7) + 1;
  v_tier := least(5, ((v_streak - 1) / 7) + 1);

  select * into d from public.login_streak_reward_definitions
  where cycle_day = v_cycle_day and tier = v_tier;
  if not found then raise exception 'Login streak reward definition missing'; end if;

  -- Lever scalars (0018): the economy-critical magnitudes, read
  -- from economy_config with the content module's defaults and
  -- clamped identically ([0, 3]) at this call site. The amounts
  -- are STORED on the claim row now and paid verbatim by the
  -- claim — lever changes after the record never reprice a held
  -- reward.
  v_credits := floor(d.credits * greatest(0, least(3,
    public.cc_economy_config_number('streakCreditScalar', 1))))::bigint;
  v_keys := d.cache_keys;

  insert into public.login_streak_claims (
    player_id, claim_day, streak_length, cycle_day, tier,
    credits_awarded, fragments_awarded, cache_keys_awarded, claimed_at
  ) values (
    p_player_id, v_today, v_streak, v_cycle_day, v_tier,
    v_credits, 0, v_keys, p_now
  );

  insert into public.login_streak_state (
    player_id, current_streak, longest_streak,
    last_claim_day, last_cycle_day, last_tier, updated_at
  ) values (
    p_player_id, v_streak, v_streak, v_today, v_cycle_day, v_tier, p_now
  )
  on conflict (player_id) do update
  set current_streak = excluded.current_streak,
      longest_streak = greatest(public.login_streak_state.longest_streak, excluded.longest_streak),
      last_claim_day = excluded.last_claim_day,
      last_cycle_day = excluded.last_cycle_day,
      last_tier = excluded.last_tier,
      updated_at = excluded.updated_at;

  return jsonb_build_object(
    'action_type', 'cc_login_streak_claim',
    'already_claimed', false,
    'claimable', true,
    'day', v_today,
    'streak_length', v_streak,
    'cycle_day', v_cycle_day,
    'tier', v_tier,
    'credits_awarded', v_credits,
    'fragments_awarded', 0,
    'cache_keys_awarded', v_keys,
    'profile', public.cc_profile_snapshot(p)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 2. cc_claim_login_streak_day — 0079 §3 verbatim except the day
--    line. Only the row keyed to the (new) today can be paid, so
--    an unclaimed reward now expires at 08:00 UTC.
-- ---------------------------------------------------------------------

create or replace function public.cc_claim_login_streak_day(
  p_player_id uuid,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := ((p_now - interval '8 hours') at time zone 'UTC')::date;
  p public.profiles%rowtype;
  c public.login_streak_claims%rowtype;
  result jsonb;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Only TODAY's row can ever be paid: an unpaid row from a
  -- previous day is expired by construction (the 00:00 UTC
  -- rollover), never swept, never payable.
  select * into c from public.login_streak_claims
  where player_id = p_player_id and claim_day = v_today
  for update;
  if not found then raise exception 'No streak reward recorded today'; end if;

  -- Exactly-once: the paid stamp is the anchor. A replayed claim
  -- returns the stored claim and pays nothing again.
  if c.paid_at is not null then
    return jsonb_build_object(
      'action_type', 'cc_login_streak_claim',
      'already_claimed', true,
      'claimable', false,
      'day', c.claim_day,
      'streak_length', c.streak_length,
      'cycle_day', c.cycle_day,
      'tier', c.tier,
      'credits_awarded', c.credits_awarded,
      'fragments_awarded', c.fragments_awarded,
      'cache_keys_awarded', c.cache_keys_awarded,
      'profile', public.cc_profile_snapshot(p)
    );
  end if;

  -- The payment: 0036's application block, verbatim, moved from
  -- record time to claim time. Amounts are the row's stored
  -- (post-lever) stamps — the claim pays what the sheet showed.
  update public.profiles
  set credits = credits + c.credits_awarded,
      cache_token_parts = cache_token_parts + c.fragments_awarded,
      cache_tokens = cache_tokens + c.cache_keys_awarded
  where id = p_player_id
  returning * into p;

  update public.login_streak_claims
  set paid_at = p_now
  where player_id = p_player_id and claim_day = v_today;

  result := jsonb_build_object(
    'action_type', 'cc_login_streak_claim',
    'already_claimed', false,
    'claimable', false,
    'day', v_today,
    'streak_length', c.streak_length,
    'cycle_day', c.cycle_day,
    'tier', c.tier,
    'credits_awarded', c.credits_awarded,
    'fragments_awarded', c.fragments_awarded,
    'cache_keys_awarded', c.cache_keys_awarded,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_login_streak_claim',
          'login-streak:' || p_player_id::text || ':' || v_today::text, result);

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. TRANSITION — re-key the recorded history onto the new day.
--
-- A row's NEW day, in every era: claim_day − 1 when the row is
-- still keyed under the old rule (claim_day = the UTC date of
-- claimed_at) and it was recorded before 08:00 UTC; claim_day
-- itself otherwise. Already-migrated rows and rows the new
-- functions write both satisfy the second arm, which is what
-- makes every step below safe to re-apply.
-- ---------------------------------------------------------------------

-- 3a. Collision merge, judged on new-day keys before anything
-- moves: a row is deleted when a strictly-better sibling lands
-- on the same new day — a paid sibling over an unpaid row, or
-- an earlier-recorded sibling at equal paid-ness.
delete from public.login_streak_claims c
where exists (
  select 1
  from public.login_streak_claims o
  where o.player_id = c.player_id
    and o.claim_day - (case
          when o.claim_day = (o.claimed_at at time zone 'UTC')::date
           and extract(hour from (o.claimed_at at time zone 'UTC')) < 8
          then 1 else 0 end)
      = c.claim_day - (case
          when c.claim_day = (c.claimed_at at time zone 'UTC')::date
           and extract(hour from (c.claimed_at at time zone 'UTC')) < 8
          then 1 else 0 end)
    and (
      (o.paid_at is not null and c.paid_at is null)
      or ((o.paid_at is not null) = (c.paid_at is not null)
          and o.claimed_at < c.claimed_at)
    )
);

-- 3b. The shift, in two phases so the (player_id, claim_day)
-- key can never collide transiently (a survivor shifting onto
-- the day another survivor is vacating): phase 1 parks the
-- shifting rows 100,000 days in the past — a range no real row
-- occupies, with relative spacing preserved — and phase 2
-- lands them on their new day (net −1).
update public.login_streak_claims
set claim_day = claim_day - 100000
where claim_day = (claimed_at at time zone 'UTC')::date
  and extract(hour from (claimed_at at time zone 'UTC')) < 8;

update public.login_streak_claims
set claim_day = claim_day + 99999
where claim_day < date '1900-01-01';

-- 3c. State rebuild from the re-keyed rows. The current streak
-- is the run of consecutive days ending at the last recorded
-- day (gaps-and-islands), FLOORED at the pre-migration value:
-- a merge inside a run shrinks the recomputed run, and no
-- player loses streak length the old rules had counted. Cycle
-- position and tier follow the floored streak by the standard
-- formulas (the same arithmetic as the record function), NOT
-- the max-day row's stored position, which can disagree with
-- the floor exactly in the merge cases. longest only grows.
-- Rows whose state already matches are left untouched,
-- updated_at included.
with islands as (
  select player_id,
         claim_day,
         claim_day - (row_number() over (
           partition by player_id order by claim_day))::integer as island
  from public.login_streak_claims
),
last_island as (
  select distinct on (player_id) player_id, claim_day as last_day, island
  from islands
  order by player_id, claim_day desc
),
runs as (
  select l.player_id,
         l.last_day,
         count(*)::integer as run_length
  from last_island l
  join islands i
    on i.player_id = l.player_id and i.island = l.island
  group by l.player_id, l.last_day
)
update public.login_streak_state s
set last_claim_day = r.last_day,
    current_streak = greatest(s.current_streak, r.run_length),
    longest_streak = greatest(s.longest_streak,
                               greatest(s.current_streak, r.run_length)),
    last_cycle_day = ((greatest(s.current_streak, r.run_length) - 1) % 7) + 1,
    last_tier = least(5, ((greatest(s.current_streak, r.run_length) - 1) / 7) + 1),
    updated_at = now()
from runs r
where r.player_id = s.player_id
  and (s.last_claim_day is distinct from r.last_day
       or s.current_streak is distinct from greatest(s.current_streak, r.run_length));
