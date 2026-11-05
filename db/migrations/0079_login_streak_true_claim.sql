-- =====================================================================
-- 0079 — Daily login streak: TRUE CLAIM (owner decision 2026-11-04,
-- feedback-legibility pass; design brief:
-- ~/workspace/cybercache-prep/design-briefs/feedback-legibility-2026-11-04.md).
--
-- The model changes, the arithmetic doesn't. Through 0036 the
-- check-in read recorded the day AND paid the ladder reward in the
-- same op — the player was informed about money that had already
-- moved, and the owner rejected that model on device. From here:
--
--   - cc_record_login_streak_day (restated from its 0036 chain
--     head — 0036 is the function's only prior definition) records
--     the day and stamps the lever-scaled reward on the claim row
--     UNPAID. No profile update, no ledger row: nothing has been
--     earned yet, so nothing is metered yet.
--   - cc_claim_login_streak_day (new) pays the stored reward
--     exactly once. The row's new paid_at stamp is the
--     exactly-once anchor: a replayed claim returns the stored
--     claim with already_claimed = true and pays nothing. The
--     payment writes the verified_action_ledger row 0036 used to
--     write at record time (action_type 'cc_login_streak_claim',
--     idempotency key 'login-streak:<player>:<day>' — unchanged),
--     so the 0036 §5 economy meters fold the same event, now at
--     CLAIM time: credits_minted_login_streak,
--     cache_fragments_from_login_streak,
--     cache_keys_from_login_streak move when the player claims,
--     not when they check in.
--   - EXPIRY IS STRUCTURAL. The claim op only ever pays TODAY's
--     row (the day comes from the database clock). An unpaid row
--     from a previous day can never be paid — the reward expired
--     at the 00:00 UTC rollover — while the streak itself is
--     untouched: streak continuity reads recorded days
--     (login_streak_state.last_claim_day / the claims rows), never
--     payments, so an expired reward never breaks a streak.
--
-- Backfill: every pre-0079 claim row was paid at record time by
-- construction, so paid_at = claimed_at for all history — nobody
-- can re-claim a past day and nobody loses one.
--
-- Guests claim identically — grants key on the profile row, never
-- on account state (0036's posture, unchanged).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The paid stamp: null = recorded, held unpaid; set = paid at
--    that moment. This stamp replaces the bare row-exists check as
--    the payment's exactly-once anchor.
-- ---------------------------------------------------------------------
alter table public.login_streak_claims
  add column if not exists paid_at timestamptz;

update public.login_streak_claims
set paid_at = claimed_at
where paid_at is null;

-- ---------------------------------------------------------------------
-- 2. The check-in, restated (0036 body minus the payment): streak
--    arithmetic, lever scalars, claim + state writes — but the
--    profile is NOT credited and NO ledger row is written. The
--    stored amounts stay stamped on the row (post-lever), face-up
--    for the claim surface, until the claim pays them verbatim.
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
  v_today date := (p_now at time zone 'UTC')::date;
  p public.profiles%rowtype;
  s public.login_streak_state%rowtype;
  c public.login_streak_claims%rowtype;
  d public.login_streak_reward_definitions%rowtype;
  v_streak integer;
  v_cycle_day integer;
  v_tier integer;
  v_credits bigint;
  v_fragments bigint;
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
  v_fragments := floor(d.fragments * greatest(0, least(3,
    public.cc_economy_config_number('streakFragmentScalar', 1))))::bigint;
  v_keys := d.cache_keys;

  insert into public.login_streak_claims (
    player_id, claim_day, streak_length, cycle_day, tier,
    credits_awarded, fragments_awarded, cache_keys_awarded, claimed_at
  ) values (
    p_player_id, v_today, v_streak, v_cycle_day, v_tier,
    v_credits, v_fragments, v_keys, p_now
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
    'fragments_awarded', v_fragments,
    'cache_keys_awarded', v_keys,
    'profile', public.cc_profile_snapshot(p)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 3. The claim: pays TODAY's recorded row exactly once. paid_at is
--    the anchor — set it and the money moves in the same op, or
--    neither happens. The ledger row (and therefore every streak
--    economy meter) is written HERE, at claim time, with 0036's
--    payload shape and idempotency key unchanged.
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
  v_today date := (p_now at time zone 'UTC')::date;
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
