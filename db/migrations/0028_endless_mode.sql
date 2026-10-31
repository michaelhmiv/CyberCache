-- 0028: Endless mode — the Chaos Chamber.
--
-- An escalating gauntlet: the player enters with their current
-- loadout, fights server-resolved encounter after encounter at
-- compounding difficulty, and the run ends when they die or bank
-- out. Depth reached is the score. The rules owner is
-- src/content/endless.ts; the encounter engine is
-- processEndlessEncounter in src/server/chef.ts (the shared boss
-- simulator against content-built defs); this migration owns the
-- run state and the money.
--
-- Design rulings (run brief, 2026-10-31):
--
--  * THE SLOT: a run occupies the personal action slot
--    (active_actions kind 'endless_run') for its whole duration —
--    the occupations law (crafting brief F6). cc_start_endless_run
--    takes the slot atomically; every run end releases it.
--  * ESCROW: currency rewards accrue into the run row and are PAID
--    ONLY at run end, from server state. Milestone gear drops are
--    won outright at the milestone and stored by the route through
--    the ordinary item path (boss-loot pattern) — the Chamber taxes
--    the bank, never the trophies.
--  * DEATH IS CONTAINED: dying in the Chamber ends the run but
--    writes NO roaming death record (0013) — no death_state, no
--    death_log entry, no resurrection. The 0013 system prices its
--    paid resurrection from the death AREA's unlockLevel, and a
--    Chamber death has no honest area; death is also the mode's
--    expected ending ("load up, go until you die"), not an accident
--    to double-punish with a roaming lockout. The price of dying is
--    the escrow tax: death pays floor(escrow × fraction) with the
--    fraction a live lever (endlessDeathPayoutFraction, default
--    0.5); banking out alive pays 100%. Starting a new run over an
--    active one settles the old run as 'abandoned' at the SAME
--    fraction — walking away mid-run is carried out on the same
--    stretcher.
--  * CONSUMABLES: the prepared belt (boss-prep semantics) is burned
--    ONCE at run start through cc_consume_consumable_batch (with
--    the boss applier's legacy backfill), then priced into every
--    encounter's sim by the route/engine. The run is one attempt;
--    its encounters are phases.
--  * ENTRY FEE: perLevel × playerLevel, doubled per run already
--    started today (UTC), capped — the boss rematch shape
--    (src/lib/bossFees.ts) with starts in place of victories. The
--    applier recomputes it from economy_config and charges ITS
--    figure; the fee is destroyed and metered.
--  * RECORDS: completed-run rows with depth + UTC timestamps are
--    the leaderboard slice's future input; best depth is DERIVED
--    from ended rows (no profile column, no snapshot change).
--
-- Restated surfaces (all old-code compatible):
--   * active_actions CHECK constraint gains 'endless_run'.
--   * cc_set_active_action: the 0025 body + 'endless_run'.
--   * cc_compute_economy_metrics: the 0027 body + endless meters
--     (fees fold into credits_destroyed_total; payouts fold into
--     credits_minted_total — the dedicated endless_* columns carry
--     the per-mode breakdown).

-- ─── 1. endless_runs ────────────────────────────────────────────────

create table if not exists public.endless_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'banked', 'died', 'abandoned')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  start_level integer not null,
  risk text not null default 'Balanced',
  prepared_consumables jsonb not null default '{}'::jsonb,
  depth_reached integer not null default 0,
  escrow_credits bigint not null default 0,
  escrow_xp bigint not null default 0,
  escrow_scrap bigint not null default 0,
  entry_fee bigint not null default 0,
  encounters jsonb not null default '[]'::jsonb,
  milestone_drops jsonb not null default '[]'::jsonb,
  paid_credits bigint not null default 0,
  paid_xp bigint not null default 0,
  paid_scrap bigint not null default 0,
  payout_fraction numeric
);

create index if not exists endless_runs_user_status_idx
  on public.endless_runs (user_id, status, started_at desc);
create index if not exists endless_runs_ended_depth_idx
  on public.endless_runs (ended_at desc, depth_reached desc)
  where status <> 'active';

-- ─── 2. The action slot learns 'endless_run' ────────────────────────

alter table public.active_actions
  drop constraint if exists active_actions_active_action_check;
alter table public.active_actions
  add constraint active_actions_active_action_check
  check (active_action = any (array[
    'none', 'idle_standby', 'roaming_loot', 'boss_prep', 'boss_fight',
    'crafting', 'salvaging', 'workshop_service', 'market_listing',
    'endless_run'
  ]));

-- cc_endless_run_snapshot: the run's client/read shape (one owner,
-- shared by all three appliers).
create or replace function public.cc_endless_run_snapshot(run_row public.endless_runs)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', run_row.id,
    'status', run_row.status,
    'started_at', run_row.started_at,
    'ended_at', run_row.ended_at,
    'start_level', run_row.start_level,
    'risk', run_row.risk,
    'prepared_consumables', run_row.prepared_consumables,
    'depth_reached', run_row.depth_reached,
    'escrow_credits', run_row.escrow_credits,
    'escrow_xp', run_row.escrow_xp,
    'escrow_scrap', run_row.escrow_scrap,
    'entry_fee', run_row.entry_fee,
    'milestone_drops', run_row.milestone_drops,
    'paid_credits', run_row.paid_credits,
    'paid_xp', run_row.paid_xp,
    'paid_scrap', run_row.paid_scrap,
    'payout_fraction', run_row.payout_fraction
  );
$$;

-- ─── 3. cc_start_endless_run ────────────────────────────────────────
--
-- Atomic entry: settle any still-active run as abandoned (death
-- fraction), burn the prepared belt, charge the recomputed entry
-- fee, open the run row, and take the action slot — one transaction,
-- nonce-idempotent through the verified action ledger.

create or replace function public.cc_start_endless_run(
  _player_id uuid,
  _nonce text,
  _risk text,
  _prepared jsonb,
  _expected_fee bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_fraction numeric := public.cc_economy_config_number('endlessDeathPayoutFraction', 0.5);
  v_fee_per_level numeric := public.cc_economy_config_number('endlessEntryFeePerLevel', 10);
  v_fee_cap numeric := public.cc_economy_config_number('endlessFeeEscalationCap', 8);
  v_runs_today bigint;
  v_fee bigint;
  v_run public.endless_runs%rowtype;
  v_old public.endless_runs%rowtype;
  v_abandoned jsonb := null;
  v_pay_credits bigint;
  v_pay_xp bigint;
  v_pay_scrap bigint;
  xp_state jsonb;
  next_consumables jsonb;
  con_key text;
  con_val integer;
  current_count integer;
  consumed_batches jsonb := '[]'::jsonb;
  consumed_one jsonb;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  -- The Chamber takes living hunters only: a standing roaming death
  -- (0013) must be resolved first. Endless deaths themselves never
  -- write that record (containment ruling, header).
  if coalesce(p.death_state, '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'Hunter is dead — resurrect before entering the Chamber';
  end if;

  -- Settle a still-active run first: abandoned at the death
  -- fraction. Its payout lands before the fee check, so a carried-out
  -- bank can fund the next entry.
  select * into v_old from public.endless_runs
   where user_id = _player_id and status = 'active' for update;
  if found then
    v_pay_credits := floor(v_old.escrow_credits * v_fraction)::bigint;
    v_pay_xp := floor(v_old.escrow_xp * v_fraction)::bigint;
    v_pay_scrap := floor(v_old.escrow_scrap * v_fraction)::bigint;
    xp_state := public.cc_apply_xp(p.player_level, p.player_xp, v_pay_xp);
    update public.profiles
       set credits = credits + v_pay_credits,
           scrap = scrap + v_pay_scrap,
           player_level = (xp_state ->> 'player_level')::integer,
           player_xp = (xp_state ->> 'player_xp')::bigint,
           updated_at = now()
     where id = _player_id
     returning * into p;
    update public.endless_runs
       set status = 'abandoned', ended_at = now(),
           paid_credits = v_pay_credits, paid_xp = v_pay_xp,
           paid_scrap = v_pay_scrap, payout_fraction = v_fraction
     where id = v_old.id
     returning * into v_old;
    v_abandoned := jsonb_build_object(
      'run_id', v_old.id,
      'depth_reached', v_old.depth_reached,
      'payout', jsonb_build_object(
        'credits', v_pay_credits, 'xp', v_pay_xp, 'scrap', v_pay_scrap,
        'fraction', v_fraction));
  end if;

  -- Burn the prepared belt (boss-applier semantics exactly: validate
  -- against profiles.consumables, backfill legacy counts into 100%
  -- batches, consume through the batch path).
  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for con_key, con_val in
    select key, value::integer from jsonb_each_text(coalesce(_prepared, '{}'::jsonb))
  loop
    if con_val <= 0 then continue; end if;
    current_count := coalesce((next_consumables ->> con_key)::integer, 0);
    if current_count < con_val then
      raise exception 'Insufficient consumable quantity for %', con_key;
    end if;
    if not exists (
      select 1 from public.consumable_batches
       where owner_user_id = _player_id and consumable_type = con_key and quantity > 0
    ) then
      perform public.cc_add_consumable_batch(
        _player_id, con_key, current_count, 100, 'vendor', null, null,
        'admin_adjust',
        'Backfilled legacy count into 100% batch before endless belt burn',
        '{}'::jsonb);
    end if;
    consumed_one := public.cc_consume_consumable_batch(
      _player_id, con_key, con_val, 'endless', 'Endless Chamber entry belt',
      jsonb_build_object('mode', 'chaos_chamber'));
    consumed_batches := consumed_batches || jsonb_build_array(consumed_one);
    next_consumables := jsonb_set(next_consumables, array[con_key], to_jsonb(greatest(current_count - con_val, 0)), true);
  end loop;

  -- Entry fee: recomputed from live levers — perLevel × level,
  -- doubled per run already started today (UTC), capped. The
  -- route's _expected_fee is never charged.
  select count(*) into v_runs_today
    from public.verified_action_ledger
   where user_id = _player_id
     and action_type = 'cc_start_endless_run'
     and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
  v_fee := (round(v_fee_per_level * greatest(1, p.player_level))
            * least(v_fee_cap, power(2, least(v_runs_today, 20))))::bigint;
  if p.credits < v_fee then
    raise exception 'Insufficient credits for endless entry fee';
  end if;

  update public.profiles
     set credits = credits - v_fee,
         consumables = next_consumables,
         updated_at = now()
   where id = _player_id
   returning * into p;

  insert into public.endless_runs (
    user_id, status, start_level, risk, prepared_consumables, entry_fee
  ) values (
    _player_id, 'active', p.player_level,
    coalesce(nullif(trim(_risk), ''), 'Balanced'),
    coalesce(_prepared, '{}'::jsonb), v_fee
  )
  returning * into v_run;

  -- Take the personal action slot (the cc_set_active_action upsert
  -- shape, written directly: this applier IS the transition).
  insert into public.active_actions as aa (
    user_id, active_action, started_at, completes_at, target_type,
    target_id, target_label, scene_key, notes, activity_payload,
    public_payload, last_heartbeat_at, public_visible, schema_version,
    updated_at
  ) values (
    _player_id, 'endless_run', now(), null, 'endless', v_run.id::text,
    'Chaos Chamber — Endless', 'endless:chaos_chamber',
    'Endless run in progress',
    jsonb_build_object('run_id', v_run.id, 'mode', 'chaos_chamber'),
    jsonb_build_object('activity_label', 'Endless — Chaos Chamber', 'scene_key', 'endless:chaos_chamber'),
    now(), true, 1, now()
  )
  on conflict (user_id) do update set
    active_action = excluded.active_action,
    started_at = excluded.started_at,
    completes_at = excluded.completes_at,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    scene_key = excluded.scene_key,
    notes = excluded.notes,
    activity_payload = excluded.activity_payload,
    public_payload = excluded.public_payload,
    last_heartbeat_at = excluded.last_heartbeat_at,
    public_visible = excluded.public_visible,
    schema_version = excluded.schema_version,
    updated_at = excluded.updated_at;

  result := jsonb_build_object(
    'action_type', 'cc_start_endless_run',
    'run', public.cc_endless_run_snapshot(v_run),
    'entry_fee', v_fee,
    'runs_started_today', v_runs_today + 1,
    'abandoned_settlement', v_abandoned,
    'consumed_batches', consumed_batches,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_start_endless_run', _nonce, result);

  return result;
end;
$$;

-- ─── 4. cc_apply_endless_encounter ──────────────────────────────────
--
-- Persists ONE engine-resolved encounter. Depth comes from the run
-- row (the route passes depth_reached + 1; the applier enforces it),
-- so a forged body can name no depth and no rewards beyond what the
-- engine produced. Victory escrows; defeat (or the depth cap) ends
-- the run and settles escrow in this same transaction.

create or replace function public.cc_apply_endless_encounter(
  _player_id uuid,
  _nonce text,
  _run_id uuid,
  _depth integer,
  _victory boolean,
  _rewards jsonb,
  _encounter jsonb,
  _milestone_drop jsonb default null,
  _cap_reached boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_run public.endless_runs%rowtype;
  v_slot public.active_actions%rowtype;
  v_fraction numeric := public.cc_economy_config_number('endlessDeathPayoutFraction', 0.5);
  v_xp bigint := greatest(0, coalesce((_rewards ->> 'xp')::bigint, 0));
  v_credits bigint := greatest(0, coalesce((_rewards ->> 'credits')::bigint, 0));
  v_scrap bigint := greatest(0, coalesce((_rewards ->> 'scrap')::bigint, 0));
  v_payout jsonb := null;
  v_pay_credits bigint;
  v_pay_xp bigint;
  v_pay_scrap bigint;
  v_pay_fraction numeric;
  xp_state jsonb;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_run from public.endless_runs
   where id = _run_id and user_id = _player_id for update;
  if not found then raise exception 'Endless run not found'; end if;
  if v_run.status <> 'active' then raise exception 'Endless run is not active'; end if;

  -- The run must hold the personal slot (occupations law): switching
  -- away mid-run pauses the Chamber until the player returns to it.
  select * into v_slot from public.active_actions where user_id = _player_id;
  if not found or v_slot.active_action <> 'endless_run' or v_slot.target_id <> _run_id::text then
    raise exception 'Endless run does not hold the action slot';
  end if;

  if _depth <> v_run.depth_reached + 1 then
    raise exception 'Endless depth mismatch';
  end if;

  v_run.encounters := v_run.encounters || jsonb_build_array(
    coalesce(_encounter, '{}'::jsonb) || jsonb_build_object('depth', _depth, 'victory', _victory));

  if _victory then
    v_run.escrow_credits := v_run.escrow_credits + v_credits;
    v_run.escrow_xp := v_run.escrow_xp + v_xp;
    v_run.escrow_scrap := v_run.escrow_scrap + v_scrap;
    v_run.depth_reached := _depth;
    if _milestone_drop is not null then
      v_run.milestone_drops := v_run.milestone_drops || jsonb_build_array(jsonb_build_object(
        'depth', _depth,
        'rarity', _milestone_drop ->> 'rarity',
        'kind', _milestone_drop ->> 'kind',
        'name', _milestone_drop ->> 'name'));
    end if;
    if _cap_reached then
      v_run.status := 'banked';
      v_pay_fraction := 1;
    end if;
  else
    v_run.status := 'died';
    v_pay_fraction := v_fraction;
  end if;

  if v_run.status <> 'active' then
    -- Run end: settle escrow from the run row's own totals — the
    -- only payout source. XP rides cc_apply_xp like every faucet.
    v_pay_credits := floor(v_run.escrow_credits * v_pay_fraction)::bigint;
    v_pay_xp := floor(v_run.escrow_xp * v_pay_fraction)::bigint;
    v_pay_scrap := floor(v_run.escrow_scrap * v_pay_fraction)::bigint;
    xp_state := public.cc_apply_xp(p.player_level, p.player_xp, v_pay_xp);
    update public.profiles
       set credits = credits + v_pay_credits,
           scrap = scrap + v_pay_scrap,
           player_level = (xp_state ->> 'player_level')::integer,
           player_xp = (xp_state ->> 'player_xp')::bigint,
           updated_at = now()
     where id = _player_id
     returning * into p;
    v_run.ended_at := now();
    v_run.paid_credits := v_pay_credits;
    v_run.paid_xp := v_pay_xp;
    v_run.paid_scrap := v_pay_scrap;
    v_run.payout_fraction := v_pay_fraction;
    v_payout := jsonb_build_object(
      'credits', v_pay_credits, 'xp', v_pay_xp, 'scrap', v_pay_scrap,
      'fraction', v_pay_fraction);
    -- Release the slot (only when it still points at this run).
    update public.active_actions
       set active_action = 'idle_standby', target_type = null,
           target_id = null, target_label = null, scene_key = null,
           notes = null, activity_payload = '{}'::jsonb,
           public_payload = '{}'::jsonb, updated_at = now()
     where user_id = _player_id and active_action = 'endless_run'
       and target_id = _run_id::text;
  end if;

  update public.endless_runs
     set encounters = v_run.encounters,
         escrow_credits = v_run.escrow_credits,
         escrow_xp = v_run.escrow_xp,
         escrow_scrap = v_run.escrow_scrap,
         depth_reached = v_run.depth_reached,
         milestone_drops = v_run.milestone_drops,
         status = v_run.status,
         ended_at = v_run.ended_at,
         paid_credits = v_run.paid_credits,
         paid_xp = v_run.paid_xp,
         paid_scrap = v_run.paid_scrap,
         payout_fraction = v_run.payout_fraction
   where id = v_run.id
   returning * into v_run;

  result := jsonb_build_object(
    'action_type', 'cc_apply_endless_encounter',
    'run_id', v_run.id,
    'depth', _depth,
    'victory', _victory,
    'rewards', jsonb_build_object('xp', v_xp, 'credits', v_credits, 'scrap', v_scrap),
    'escrow', jsonb_build_object(
      'credits', v_run.escrow_credits, 'xp', v_run.escrow_xp, 'scrap', v_run.escrow_scrap),
    'run_status', v_run.status,
    'milestone_drop', _milestone_drop,
    'payout', v_payout,
    'profile', public.cc_profile_snapshot(p),
    'run', public.cc_endless_run_snapshot(v_run)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_endless_encounter', _nonce, result);

  return result;
end;
$$;

-- ─── 5. cc_end_endless_run ──────────────────────────────────────────
--
-- Voluntary bank: ends the player's ACTIVE run — the run is derived
-- from server state, never named by the caller — paying escrow in
-- full and releasing the slot. A no-active-run call returns
-- ended=false and is NOT ledgered, so the negative answer can never
-- poison a nonce.

create or replace function public.cc_end_endless_run(
  _player_id uuid,
  _nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_run public.endless_runs%rowtype;
  xp_state jsonb;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_run from public.endless_runs
   where user_id = _player_id and status = 'active' for update;
  if not found then
    return jsonb_build_object(
      'action_type', 'cc_end_endless_run',
      'ended', false,
      'reason', 'no_active_run');
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, v_run.escrow_xp);
  update public.profiles
     set credits = credits + v_run.escrow_credits,
         scrap = scrap + v_run.escrow_scrap,
         player_level = (xp_state ->> 'player_level')::integer,
         player_xp = (xp_state ->> 'player_xp')::bigint,
         updated_at = now()
   where id = _player_id
   returning * into p;

  update public.endless_runs
     set status = 'banked', ended_at = now(),
         paid_credits = escrow_credits, paid_xp = escrow_xp,
         paid_scrap = escrow_scrap, payout_fraction = 1
   where id = v_run.id
   returning * into v_run;

  update public.active_actions
     set active_action = 'idle_standby', target_type = null,
         target_id = null, target_label = null, scene_key = null,
         notes = null, activity_payload = '{}'::jsonb,
         public_payload = '{}'::jsonb, updated_at = now()
   where user_id = _player_id and active_action = 'endless_run'
     and target_id = v_run.id::text;

  result := jsonb_build_object(
    'action_type', 'cc_end_endless_run',
    'ended', true,
    'run_id', v_run.id,
    'depth_reached', v_run.depth_reached,
    'payout', jsonb_build_object(
      'credits', v_run.paid_credits, 'xp', v_run.paid_xp,
      'scrap', v_run.paid_scrap, 'fraction', 1),
    'profile', public.cc_profile_snapshot(p),
    'run', public.cc_endless_run_snapshot(v_run)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_end_endless_run', _nonce, result);

  return result;
end;
$$;

-- ─── 6. cc_set_active_action restated (0025 body + 'endless_run') ───
--
-- The generic activity writer learns the new kind so clients can
-- also stage/observe the slot through the ordinary activity path;
-- the endless appliers themselves write the slot row directly.

CREATE OR REPLACE FUNCTION public.cc_set_active_action(p_player_id uuid, nonce text, action_kind text, target_type text DEFAULT NULL::text, target_id text DEFAULT NULL::text, target_label text DEFAULT NULL::text, scene_key text DEFAULT NULL::text, expected_finish_at timestamp with time zone DEFAULT NULL::timestamp with time zone, notes text DEFAULT NULL::text, activity_payload jsonb DEFAULT '{}'::jsonb, public_payload jsonb DEFAULT '{}'::jsonb, public_visible boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result_row public.active_actions%rowtype;
  normalized_kind text := coalesce(nullif(trim(action_kind), ''), 'idle_standby');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  if normalized_kind not in (
    'none',
    'idle_standby',
    'roaming_loot',
    'boss_prep',
    'boss_fight',
    'crafting',
    'salvaging',
    'workshop_service',
    'market_listing',
    'endless_run'
  ) then
    raise exception 'Unsupported active action: %', normalized_kind;
  end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Crafting settler hook (0024): the outgoing action settles its
  -- craft jobs before the switch, at their exact accrued values.
  perform public.cc_settle_craft_jobs(actor);

  -- Repair settler hook (0025): board jobs settle on transitions too.
  perform public.cc_settle_repair_jobs_for(actor);

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    normalized_kind,
    now(),
    expected_finish_at,
    nullif(target_type, ''),
    nullif(target_id, ''),
    nullif(target_label, ''),
    nullif(scene_key, ''),
    nullif(notes, ''),
    coalesce(activity_payload, '{}'::jsonb),
    coalesce(public_payload, '{}'::jsonb),
    now(),
    coalesce(public_visible, true),
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = excluded.active_action,
    started_at = excluded.started_at,
    completes_at = excluded.completes_at,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    scene_key = excluded.scene_key,
    notes = excluded.notes,
    activity_payload = excluded.activity_payload,
    public_payload = excluded.public_payload,
    last_heartbeat_at = excluded.last_heartbeat_at,
    public_visible = excluded.public_visible,
    schema_version = excluded.schema_version,
    updated_at = excluded.updated_at
  returning * into result_row;

  prior := jsonb_build_object(
    'action_type', 'cc_set_active_action',
    'activity', public.cc_active_action_snapshot(result_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_set_active_action', nonce, prior);

  return prior;
end;
$function$;

-- ─── 7. Economy metrics: endless meters ─────────────────────────────

alter table public.economy_metrics
  add column if not exists endless_runs_started integer not null default 0,
  add column if not exists endless_runs_ended integer not null default 0,
  add column if not exists endless_encounters_cleared integer not null default 0,
  add column if not exists endless_deepest_depth integer not null default 0,
  add column if not exists endless_credits_paid bigint not null default 0,
  add column if not exists endless_xp_paid bigint not null default 0,
  add column if not exists endless_fees_destroyed bigint not null default 0,
  add column if not exists endless_milestone_drops integer not null default 0,
  add column if not exists endless_milestone_drops_by_rarity jsonb not null default '{}'::jsonb;

-- cc_compute_economy_metrics restated (0027 body + endless terms):
-- endless payouts fold into credits_minted_total (they are a real
-- faucet; the endless_credits_paid column carries the breakdown) and
-- endless entry fees fold into credits_destroyed_total.

create or replace function public.cc_compute_economy_metrics(_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := (_day::timestamp) at time zone 'UTC';
  v_end timestamptz := ((_day + 1)::timestamp) at time zone 'UTC';
  m record;
  v_minted_total bigint;
  v_destroyed_total bigint;
  cj record;
  rj record;
  er record;
begin
  select
    -- Mints -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_apply_chef_rewards'), 0) as minted_roaming,
    coalesce(sum(
      case when coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)
        then coalesce((result_payload -> 'attempt' ->> 'creditsGained')::bigint, 0)
           + coalesce((result_payload ->> 'entry_fee')::bigint, 0)
        else 0 end)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as minted_boss,
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_settle_offline_roaming'), 0) as minted_offline,
    (coalesce(sum((result_payload -> 'rewards' ->> 'credits')::bigint)
        filter (where action_type = 'cc_idle_claim'), 0)
     + coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
        filter (where action_type = 'cc_claim_roaming_rewards'), 0)
     + 5000 * count(*) filter (where action_type = 'cc_initial_bundle')
    ) as minted_other,
    -- Sinks -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'market_fee' ->> 'fee_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as destroyed_market_fees,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_vendor_buy'), 0) as destroyed_vendor,
    coalesce(sum((result_payload ->> 'creditsCharged')::bigint)
      filter (where action_type = 'cc_resurrect'), 0) as destroyed_resurrection,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_retrain'), 0) as destroyed_respec,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as destroyed_boss_entry_fees,
    coalesce(sum(greatest(0,
        coalesce((result_payload -> 'attempt' ->> 'creditsLost')::bigint, 0)
        - coalesce((result_payload ->> 'entry_fee')::bigint, 0)))
      filter (where action_type = 'cc_apply_boss_attempt'
        and not coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)),
      0) as destroyed_boss_death_fees,
    -- Market ----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_market_create') as market_listings_created,
    count(*) filter (where action_type = 'cc_accept_listing') as market_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as market_volume,
    -- Crafted market sales (0024) -------------------------------------------
    count(*) filter (where action_type = 'cc_accept_listing'
      and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
        or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')) as crafted_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'
        and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
          or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')), 0) as crafted_volume,
    -- Cache -----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_claim_rewarded_cache_key') as cache_keys_from_ads,
    count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded,
    -- Legendary salvage + cores (0026): destroyed legendaries are a
    -- LEDGER fact (the recycle result carries the consumed item) —
    -- distinct from legendaries_minted_by_source above, which counts
    -- item_instances at creation. No double counting: creation and
    -- destruction are separate meters by design.
    count(*) filter (where action_type = 'cc_recycle_item'
      and result_payload -> 'item' ->> 'rarity' = 'Legendary') as legendaries_salvaged,
    coalesce(sum((result_payload ->> 'cores_award')::bigint)
      filter (where action_type = 'cc_recycle_item'), 0) as legendary_cores_minted,
    (coalesce(sum((result_payload -> 'job' ->> 'escrow_cores')::bigint)
        filter (where action_type = 'cc_enqueue_craft_job'), 0)
     - coalesce(sum((result_payload ->> 'cores_refunded')::bigint)
        filter (where action_type = 'cc_cancel_craft_job'), 0)
     -- Reforge (0027): cores destroyed outright extend the spent
     -- meter — each destroyed core is counted exactly once, here;
     -- the dedicated column below breaks the reforge share out.
     + coalesce(sum((result_payload ->> 'cores_charged')::bigint)
        filter (where action_type = 'cc_reforge_item'), 0)) as legendary_cores_spent,
    -- Reforge meters (0027): completions, scrap destroyed, cores
    -- destroyed — all ledger facts from cc_reforge_item results.
    count(*) filter (where action_type = 'cc_reforge_item') as reforges_completed,
    coalesce(sum((result_payload ->> 'scrap_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as scrap_destroyed_reforge,
    coalesce(sum((result_payload ->> 'cores_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as legendary_cores_destroyed_reforge,
    -- Endless meters (0028): runs, encounters, fees, payouts — all
    -- ledger facts from the three endless appliers' result payloads.
    -- Run-end payouts appear on cc_end_endless_run (bank), on
    -- cc_apply_endless_encounter (death / depth-cap bank), and as
    -- abandoned_settlement inside cc_start_endless_run.
    count(*) filter (where action_type = 'cc_start_endless_run') as endless_runs_started,
    (count(*) filter (where action_type = 'cc_end_endless_run'
        and coalesce((result_payload ->> 'ended')::boolean, false))
     + count(*) filter (where action_type = 'cc_apply_endless_encounter'
        and result_payload ->> 'run_status' in ('died', 'banked'))
     + count(*) filter (where action_type = 'cc_start_endless_run'
        and result_payload -> 'abandoned_settlement' is not null
        and result_payload -> 'abandoned_settlement' <> 'null'::jsonb)) as endless_runs_ended,
    count(*) filter (where action_type = 'cc_apply_endless_encounter'
      and coalesce((result_payload ->> 'victory')::boolean, false)) as endless_encounters_cleared,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_start_endless_run'), 0) as endless_fees_destroyed,
    (coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'credits')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_credits_paid,
    (coalesce(sum((result_payload -> 'payout' ->> 'xp')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'xp')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_xp_paid
  into m
  from public.verified_action_ledger
  where created_at >= v_start and created_at < v_end;

  -- Craft job meters (0024): jobs_completed is a job-level fact
  -- (status + completed_at); units / XP / refined output are counted
  -- per OUTPUT at the unit's settle-day stamp, across jobs of ANY
  -- status — units produced inside a job that is later cancelled (or
  -- still running at day's end) are real production and real XP.
  select
    (select count(*) from public.craft_jobs j
      where j.status = 'complete'
        and j.completed_at >= v_start and j.completed_at < v_end) as jobs_completed,
    count(*)::integer as units_completed,
    coalesce(sum((o ->> 'xp')::bigint), 0)::bigint as xp_awarded,
    coalesce(sum((o ->> 'outputQuantity')::integer)
      filter (where o ->> 'kind' = 'refine'), 0)::integer as refined_units
  into cj
  from public.craft_jobs j,
       lateral jsonb_array_elements(j.outputs) o
  where (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
    and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint;

  -- Repair meters (0025): job-level facts from service_jobs at
  -- their terminal day (posted counted at posting day); self-repair
  -- kit consumption counted per completed repair UNIT output, the
  -- same settle-day stamp the craft meters use.
  select
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.created_at >= v_start and j.created_at < v_end) as jobs_posted,
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair' and j.status = 'completed'
        and j.completed_at >= v_start and j.completed_at < v_end)::integer as jobs_completed,
    (select coalesce(sum(j.points_restored), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled')) as points_restored,
    (select coalesce(sum(j.paid_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as credits_volume,
    (select coalesce(sum(j.fee_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as fees_destroyed,
    (select coalesce(sum(j.xp_awarded), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as xp_awarded,
    ((select coalesce(sum(jsonb_array_length(j.kits_consumed)), 0)
        from public.service_jobs j
       where j.profession_id = 'repair'
         and j.completed_at >= v_start and j.completed_at < v_end
         and j.status in ('completed', 'cancelled'))
     + (select count(*) from public.craft_jobs j,
              lateral jsonb_array_elements(j.outputs) o
         where o ->> 'kind' = 'repair'
           and (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
           and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint))::integer as kits_consumed
  into rj;

  -- Endless depth + milestone facts (0028): deepest run ENDED today
  -- (bank, death, cap, or carried-out abandonment — each ending is a
  -- ledger fact on its own row), and milestone drops by rarity from
  -- the encounter payloads that recorded them.
  select
    (select coalesce(max(d), 0)::integer from (
       select (result_payload ->> 'depth_reached')::integer as d
         from public.verified_action_ledger
        where action_type = 'cc_end_endless_run'
          and coalesce((result_payload ->> 'ended')::boolean, false)
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload ->> 'depth')::integer
         from public.verified_action_ledger
        where action_type = 'cc_apply_endless_encounter'
          and result_payload ->> 'run_status' in ('died', 'banked')
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload -> 'abandoned_settlement' ->> 'depth_reached')::integer
         from public.verified_action_ledger
        where action_type = 'cc_start_endless_run'
          and result_payload -> 'abandoned_settlement' is not null
          and created_at >= v_start and created_at < v_end
     ) depths) as deepest_depth,
    (select count(*)::integer
       from public.verified_action_ledger
      where action_type = 'cc_apply_endless_encounter'
        and created_at >= v_start and created_at < v_end
        and result_payload -> 'milestone_drop' ->> 'rarity' is not null) as milestone_drops,
    (select coalesce(jsonb_object_agg(g.rarity, g.cnt), '{}'::jsonb)
       from (
         select result_payload -> 'milestone_drop' ->> 'rarity' as rarity,
                count(*)::integer as cnt
           from public.verified_action_ledger
          where action_type = 'cc_apply_endless_encounter'
            and created_at >= v_start and created_at < v_end
            and result_payload -> 'milestone_drop' ->> 'rarity' is not null
          group by 1
       ) g) as milestone_by_rarity
  into er;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other
    + m.endless_credits_paid;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed + m.endless_fees_destroyed;

  insert into public.economy_metrics (
    day,
    credits_minted_roaming, credits_minted_boss, credits_minted_offline,
    credits_minted_other, credits_minted_total,
    credits_destroyed_market_fees, credits_destroyed_vendor,
    credits_destroyed_resurrection, credits_destroyed_respec,
    credits_destroyed_boss_entry_fees, credits_destroyed_boss_death_fees,
    credits_destroyed_total, net_credit_change,
    legendaries_roaming, legendaries_boss, legendaries_cache, legendaries_total,
    market_listings_created, market_sales, market_volume,
    market_median_price, market_median_by_rarity,
    cache_keys_from_ads, cache_opens, cache_fragments_awarded,
    craft_jobs_completed, craft_units_completed, craft_xp_awarded,
    materials_destroyed_crafting, refined_units_produced,
    gear_items_crafted, crafted_market_sales, crafted_market_volume,
    repair_jobs_posted, repair_jobs_completed, repair_points_restored,
    repair_credits_volume, repair_fees_destroyed, repair_kits_consumed,
    repair_xp_awarded,
    legendaries_salvaged, legendary_cores_minted, legendary_cores_spent,
    reforges_completed, scrap_destroyed_reforge, legendary_cores_destroyed_reforge,
    endless_runs_started, endless_runs_ended, endless_encounters_cleared,
    endless_deepest_depth, endless_credits_paid, endless_xp_paid,
    endless_fees_destroyed, endless_milestone_drops,
    endless_milestone_drops_by_rarity,
    computed_at
  )
  select
    _day,
    m.minted_roaming, m.minted_boss, m.minted_offline, m.minted_other,
    v_minted_total,
    m.destroyed_market_fees, m.destroyed_vendor, m.destroyed_resurrection,
    m.destroyed_respec, m.destroyed_boss_entry_fees, m.destroyed_boss_death_fees,
    v_destroyed_total, v_minted_total - v_destroyed_total,
    leg.roaming, leg.boss, leg.cache, leg.roaming + leg.boss + leg.cache,
    m.market_listings_created, m.market_sales, m.market_volume,
    (select percentile_cont(0.5) within group (
        order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric)
       from public.verified_action_ledger l
      where l.action_type = 'cc_accept_listing'
        and l.created_at >= v_start and l.created_at < v_end),
    (select coalesce(jsonb_object_agg(g.rarity, g.median), '{}'::jsonb)
       from (
         select l.result_payload -> 'item' ->> 'rarity' as rarity,
                percentile_cont(0.5) within group (
                  order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric) as median
           from public.verified_action_ledger l
          where l.action_type = 'cc_accept_listing'
            and l.created_at >= v_start and l.created_at < v_end
            and l.result_payload -> 'item' ->> 'rarity' is not null
          group by 1
       ) g),
    m.cache_keys_from_ads, m.cache_opens, m.cache_fragments_awarded,
    cj.jobs_completed, cj.units_completed, cj.xp_awarded,
    (select coalesce(jsonb_object_agg(key, net), '{}'::jsonb)
       from (
         select d.key, sum(d.delta) as net
           from (
             select e.key as key, (e.value)::bigint as delta
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, (e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_catalyst', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, -(e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'refunded_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_cancel_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
           ) d
          group by d.key
         having sum(d.delta) > 0
       ) nets),
    cj.refined_units,
    (select count(*)::integer from public.item_instances
      where payload ->> 'origin' = 'crafted'
        and created_at >= v_start and created_at < v_end),
    m.crafted_sales, m.crafted_volume,
    rj.jobs_posted, rj.jobs_completed, rj.points_restored,
    rj.credits_volume, rj.fees_destroyed, rj.kits_consumed,
    rj.xp_awarded,
    m.legendaries_salvaged, m.legendary_cores_minted, m.legendary_cores_spent,
    m.reforges_completed, m.scrap_destroyed_reforge, m.legendary_cores_destroyed_reforge,
    m.endless_runs_started, m.endless_runs_ended, m.endless_encounters_cleared,
    er.deepest_depth, m.endless_credits_paid, m.endless_xp_paid,
    m.endless_fees_destroyed, er.milestone_drops,
    er.milestone_by_rarity,
    now()
  from (
    select
      count(*) filter (where payload ->> 'sourceTag' = 'World Drop') as roaming,
      count(*) filter (where payload ->> 'sourceTag' = 'Boss Drop') as boss,
      count(*) filter (where payload ->> 'sourceTag' = 'Cache-Forged') as cache
    from public.item_instances
    where rarity = 'Legendary' and created_at >= v_start and created_at < v_end
  ) leg
  on conflict (day) do update set
    credits_minted_roaming = excluded.credits_minted_roaming,
    credits_minted_boss = excluded.credits_minted_boss,
    credits_minted_offline = excluded.credits_minted_offline,
    credits_minted_other = excluded.credits_minted_other,
    credits_minted_total = excluded.credits_minted_total,
    credits_destroyed_market_fees = excluded.credits_destroyed_market_fees,
    credits_destroyed_vendor = excluded.credits_destroyed_vendor,
    credits_destroyed_resurrection = excluded.credits_destroyed_resurrection,
    credits_destroyed_respec = excluded.credits_destroyed_respec,
    credits_destroyed_boss_entry_fees = excluded.credits_destroyed_boss_entry_fees,
    credits_destroyed_boss_death_fees = excluded.credits_destroyed_boss_death_fees,
    credits_destroyed_total = excluded.credits_destroyed_total,
    net_credit_change = excluded.net_credit_change,
    legendaries_roaming = excluded.legendaries_roaming,
    legendaries_boss = excluded.legendaries_boss,
    legendaries_cache = excluded.legendaries_cache,
    legendaries_total = excluded.legendaries_total,
    market_listings_created = excluded.market_listings_created,
    market_sales = excluded.market_sales,
    market_volume = excluded.market_volume,
    market_median_price = excluded.market_median_price,
    market_median_by_rarity = excluded.market_median_by_rarity,
    cache_keys_from_ads = excluded.cache_keys_from_ads,
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
    craft_jobs_completed = excluded.craft_jobs_completed,
    craft_units_completed = excluded.craft_units_completed,
    craft_xp_awarded = excluded.craft_xp_awarded,
    materials_destroyed_crafting = excluded.materials_destroyed_crafting,
    refined_units_produced = excluded.refined_units_produced,
    gear_items_crafted = excluded.gear_items_crafted,
    crafted_market_sales = excluded.crafted_market_sales,
    crafted_market_volume = excluded.crafted_market_volume,
    repair_jobs_posted = excluded.repair_jobs_posted,
    repair_jobs_completed = excluded.repair_jobs_completed,
    repair_points_restored = excluded.repair_points_restored,
    repair_credits_volume = excluded.repair_credits_volume,
    repair_fees_destroyed = excluded.repair_fees_destroyed,
    repair_kits_consumed = excluded.repair_kits_consumed,
    repair_xp_awarded = excluded.repair_xp_awarded,
    legendaries_salvaged = excluded.legendaries_salvaged,
    legendary_cores_minted = excluded.legendary_cores_minted,
    legendary_cores_spent = excluded.legendary_cores_spent,
    reforges_completed = excluded.reforges_completed,
    scrap_destroyed_reforge = excluded.scrap_destroyed_reforge,
    legendary_cores_destroyed_reforge = excluded.legendary_cores_destroyed_reforge,
    endless_runs_started = excluded.endless_runs_started,
    endless_runs_ended = excluded.endless_runs_ended,
    endless_encounters_cleared = excluded.endless_encounters_cleared,
    endless_deepest_depth = excluded.endless_deepest_depth,
    endless_credits_paid = excluded.endless_credits_paid,
    endless_xp_paid = excluded.endless_xp_paid,
    endless_fees_destroyed = excluded.endless_fees_destroyed,
    endless_milestone_drops = excluded.endless_milestone_drops,
    endless_milestone_drops_by_rarity = excluded.endless_milestone_drops_by_rarity,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;
$$;
