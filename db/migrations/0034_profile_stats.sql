-- 0034_profile_stats.sql
--
-- Profile showcase + lifetime stats (expansion run unit 28): the
-- trophy record gains its one missing per-player kill breakdown —
-- kills by weapon type.
--
-- Every other lifetime stat the Profile shows folds from records
-- that already exist (verified_action_ledger, collection_discoveries,
-- endless_runs, dispatch_missions, craft_jobs, service_jobs,
-- consumable_events, extraction_state, market_listings). Roaming
-- kills were the exception: the appliers recorded the COUNT
-- (rewards.kills_recorded in the ledger) but never the weapon held.
--
-- Recording point: the two roaming-kill appliers are the ONLY paths
-- that settle roaming kills — cc_apply_chef_rewards (foreground
-- claims) and cc_settle_offline_roaming (offline settlement). Both
-- already run under the profile row lock on the pay path only (their
-- idempotency early-returns fire first, so a replay can never
-- double-count). Each now calls cc_record_kill_stats, which derives
-- the equipped weapon from item_instances (runtime_state =
-- 'equipped', equipped_slot = 'weapon' — the serverLoadout
-- derivation) and accumulates into player_kill_stats. No weapon
-- equipped records under 'unarmed'. Boss and endless kills are NOT
-- roaming kills and stay out of this table (boss victories fold from
-- the boss-attempt ledger; endless depth from endless_runs).
--
-- History note: kills before this migration land in the ledger
-- counts but have no weapon-type attribution — the table starts
-- empty and accrues from the first claim after it applies.

create table if not exists public.player_kill_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  weapon_type text not null,
  kills bigint not null default 0 check (kills >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, weapon_type)
);

-- ---------------------------------------------------------------------
-- cc_record_kill_stats (internal): accumulate one claim's kills
-- under the weapon the hunter holds right now. Chef-only helper in
-- the posture of the other cc_* internals; called solely by the two
-- roaming appliers below, on their pay paths.
-- ---------------------------------------------------------------------
create or replace function public.cc_record_kill_stats(_player_id uuid, _kills integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_weapon_type text;
begin
  if _kills is null or _kills <= 0 then return; end if;
  select payload ->> 'weaponType' into v_weapon_type
    from public.item_instances
   where owner_user_id = _player_id
     and runtime_state = 'equipped'
     and equipped_slot = 'weapon'
   limit 1;
  insert into public.player_kill_stats(user_id, weapon_type, kills)
  values (_player_id, coalesce(v_weapon_type, 'unarmed'), _kills)
  on conflict (user_id, weapon_type)
  do update set kills = public.player_kill_stats.kills + excluded.kills,
                updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------
-- cc_apply_chef_rewards: the 0014 definition verbatim, plus the
-- 0034 kill-record call on the pay path (after the idempotency
-- early-return, before the ledger insert). Same 13-argument
-- signature; no caller changes.
-- ---------------------------------------------------------------------
create or replace function public.cc_apply_chef_rewards(
  _player_id uuid,
  _credits bigint,
  _scrap bigint,
  _xp bigint,
  _fragments integer,
  _materials jsonb,
  _essences jsonb,
  _kills integer,
  _tick_count bigint,
  _area_id text,
  _scrap_remainder numeric default null,
  _credits_remainder numeric default null,
  _xp_remainder numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  result jsonb;
  xp_state jsonb;
  new_level integer;
  new_xp bigint;
  activity_row public.active_actions%rowtype;
  nonce_key text;
  prior jsonb;
  next_materials jsonb;
  next_essences jsonb;
  next_parts integer;
  next_tokens integer;
  mat_key text;
  mat_val integer;
  ess_key text;
  ess_val integer;
begin
  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  nonce_key := _player_id::text || ':chef:' || _tick_count::text;
  select vl.result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = _player_id
     and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  if _tick_count <= p.last_claimed_tick then
    raise exception 'tick_count % is not after last claimed tick %', _tick_count, p.last_claimed_tick;
  end if;

  select * into activity_row
    from public.active_actions
   where user_id = _player_id
   for update;
  if not found or activity_row.active_action <> 'roaming_loot' or activity_row.target_id <> _area_id then
    raise warning 'No active roaming activity for area %, proceeding anyway', _area_id;
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, _xp);
  new_level := (xp_state ->> 'player_level')::integer;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  next_materials := coalesce(p.materials, '{}'::jsonb);
  for mat_key, mat_val in
    select key, value::integer from jsonb_each_text(coalesce(_materials, '{}'::jsonb))
  loop
    next_materials := jsonb_set(next_materials, array[mat_key], to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val), true);
  end loop;

  next_essences := coalesce(p.essences, '{}'::jsonb);
  for ess_key, ess_val in
    select key, value::integer from jsonb_each_text(coalesce(_essences, '{}'::jsonb))
  loop
    next_essences := jsonb_set(next_essences, array[ess_key], to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val), true);
  end loop;

  next_parts := coalesce(p.cache_token_parts, 0) + _fragments;
  next_tokens := coalesce(p.cache_tokens, 0);
  while next_parts >= 5 loop
    next_parts := next_parts - 5;
    next_tokens := next_tokens + 1;
  end loop;

  update public.profiles
     set credits = credits + _credits,
         credits_remainder = coalesce(_credits_remainder, credits_remainder),
         scrap = scrap + _scrap,
         scrap_remainder = coalesce(_scrap_remainder, scrap_remainder),
         player_level = new_level,
         player_xp = new_xp,
         xp_remainder = coalesce(_xp_remainder, xp_remainder),
         cache_token_parts = next_parts,
         cache_tokens = next_tokens,
         materials = next_materials,
         essences = next_essences,
         last_claimed_tick = _tick_count,
         last_roaming_settled_at = now(),
         updated_at = now()
   where id = _player_id
   returning * into p;

  update public.active_actions
     set last_heartbeat_at = now(),
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_claim_ticks', 1, 'last_claim_at', (extract(epoch from now()) * 1000)::bigint)
   where user_id = _player_id;

  result := jsonb_build_object(
    'action_type', 'cc_apply_chef_rewards',
    'profile', public.cc_profile_snapshot(p),
    -- 0014: the area this claim farmed, for the mastery trigger.
    'area_id', _area_id,
    'rewards', jsonb_build_object(
      'credits_awarded', _credits,
      'scrap_awarded', _scrap,
      'xp_awarded', _xp,
      'cache_fragments_awarded', _fragments,
      'materials', coalesce(_materials, '{}'::jsonb),
      'essences', coalesce(_essences, '{}'::jsonb),
      'kills_recorded', _kills
    )
  );

  -- 0034: lifetime kill record — this claim's kills land under the
  -- weapon the hunter currently holds (derived server-side).
  perform public.cc_record_kill_stats(_player_id, _kills);

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_chef_rewards', nonce_key, result);

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- cc_settle_offline_roaming: the 0015 definition verbatim, plus the
-- 0034 kill-record call on the settled path (the early 'settled:
-- false' returns and the idempotency early-return never reach it).
-- Same 14-argument signature; no caller changes.
-- ---------------------------------------------------------------------
create or replace function public.cc_settle_offline_roaming(
  _player_id uuid,
  _settlement_nonce text,
  _credits bigint,
  _scrap bigint,
  _xp bigint,
  _fragments integer,
  _materials jsonb,
  _essences jsonb,
  _kills integer,
  _scrap_remainder numeric default null,
  _credits_remainder numeric default null,
  _xp_remainder numeric default null,
  _consumed_consumables jsonb default null,
  _cap_hours numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := _player_id;
  p public.profiles%rowtype;
  aa public.active_actions%rowtype;
  prior jsonb;
  settle_from timestamptz;
  now_ts timestamptz := now();
  raw_elapsed_ms bigint;
  cap_ms bigint;
  elapsed_ms bigint;
  cap_reached boolean;
  ticks_requested integer;
  new_tick_count bigint;
  tick_ms constant integer := 3000;
  xp_state jsonb;
  new_level integer;
  new_xp bigint;
  next_materials jsonb;
  next_essences jsonb;
  next_consumables jsonb;
  applied_consumables jsonb := '{}'::jsonb;
  cons_key text;
  cons_val integer;
  applied_val integer;
  next_parts integer;
  next_tokens integer;
  mat_key text;
  mat_val integer;
  ess_key text;
  ess_val integer;
  nonce_key text;
  result jsonb;
begin
  if actor is null then raise exception '_player_id is required'; end if;
  if _settlement_nonce is null or length(trim(_settlement_nonce)) < 8 then
    raise exception 'settlement_nonce is required (min 8 chars)';
  end if;

  nonce_key := actor::text || ':offline_settle:' || _settlement_nonce;
  select vl.result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = actor
     and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into aa from public.active_actions where user_id = actor for update;
  if not found or aa.active_action <> 'roaming_loot' then
    return jsonb_build_object('settled', false, 'reason', 'not_roaming', 'active_action', coalesce(aa.active_action, 'none'));
  end if;

  settle_from := coalesce(p.last_roaming_settled_at, aa.started_at);
  if settle_from is null then
    return jsonb_build_object('settled', false, 'reason', 'no_elapsed', 'detail', 'No settlement start timestamp available');
  end if;

  raw_elapsed_ms := (extract(epoch from now_ts) * 1000)::bigint - (extract(epoch from settle_from) * 1000)::bigint;
  if raw_elapsed_ms < 0 then raw_elapsed_ms := 0; end if;

  -- 0015: the route's server-derived earned cap wins over the stored
  -- preference whenever it is supplied.
  cap_ms := (greatest(0.25, coalesce(_cap_hours, p.offline_cap_hours, 2)) * 3600 * 1000)::bigint;
  cap_reached := raw_elapsed_ms > cap_ms;
  elapsed_ms := least(raw_elapsed_ms, cap_ms);

  ticks_requested := floor(elapsed_ms / tick_ms)::integer;
  if ticks_requested <= 0 then
    return jsonb_build_object('settled', false, 'reason', 'no_elapsed', 'elapsed_ms', elapsed_ms);
  end if;

  new_tick_count := coalesce(p.last_claimed_tick, 0) + ticks_requested;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, _xp);
  new_level := (xp_state ->> 'player_level')::integer;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  next_materials := coalesce(p.materials, '{}'::jsonb);
  for mat_key, mat_val in select key, value::integer from jsonb_each_text(coalesce(_materials, '{}'::jsonb)) loop
    next_materials := jsonb_set(next_materials, array[mat_key], to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val), true);
  end loop;

  next_essences := coalesce(p.essences, '{}'::jsonb);
  for ess_key, ess_val in select key, value::integer from jsonb_each_text(coalesce(_essences, '{}'::jsonb)) loop
    next_essences := jsonb_set(next_essences, array[ess_key], to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val), true);
  end loop;

  -- 0012: fold the engine's consumed set into the settlement, clamped
  -- per type to the owned count (same rule as
  -- cc_consume_roaming_consumables). The SRF columns are aliased for
  -- the same reason as in that function (0007 note): unaliased
  -- key/value output columns collide with the loop variables.
  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for cons_key, cons_val in select e.key, e.value::integer from jsonb_each_text(coalesce(_consumed_consumables, '{}'::jsonb)) as e loop
    if cons_val <= 0 then continue; end if;
    applied_val := least(cons_val, coalesce((next_consumables ->> cons_key)::integer, 0));
    if applied_val <= 0 then continue; end if;
    next_consumables := jsonb_set(next_consumables, array[cons_key], to_jsonb(coalesce((next_consumables ->> cons_key)::integer, 0) - applied_val), true);
    applied_consumables := jsonb_set(applied_consumables, array[cons_key], to_jsonb(applied_val), true);
  end loop;

  next_parts := coalesce(p.cache_token_parts, 0) + _fragments;
  next_tokens := coalesce(p.cache_tokens, 0);
  while next_parts >= 5 loop
    next_parts := next_parts - 5;
    next_tokens := next_tokens + 1;
  end loop;

  update public.profiles
     set credits = credits + _credits,
         credits_remainder = coalesce(_credits_remainder, credits_remainder),
         scrap = scrap + _scrap,
         scrap_remainder = coalesce(_scrap_remainder, scrap_remainder),
         player_level = new_level,
         player_xp = new_xp,
         xp_remainder = coalesce(_xp_remainder, xp_remainder),
         cache_token_parts = next_parts,
         cache_tokens = next_tokens,
         materials = next_materials,
         essences = next_essences,
         consumables = next_consumables,
         last_claimed_tick = new_tick_count,
         last_roaming_settled_at = now_ts,
         last_settlement_nonce = _settlement_nonce,
         updated_at = now_ts
   where id = actor
   returning * into p;

  -- 0012: audit rows for the applied decrements (same shape the
  -- foreground consumption function writes).
  for cons_key, applied_val in select e.key, e.value::integer from jsonb_each_text(applied_consumables) as e loop
    insert into consumable_events (
      user_id, consumable_type, quantity_delta,
      event_type, activity_type, reason
    )
    values (
      actor, cons_key, -applied_val,
      'used', 'roaming_loot',
      'Consumed during offline settlement in ' || coalesce(aa.target_id, '')
    );
  end loop;

  update public.active_actions
     set last_heartbeat_at = now_ts,
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_offline_settle_at', (extract(epoch from now_ts) * 1000)::bigint, 'last_offline_settle_ticks', ticks_requested)
   where user_id = actor;

  result := jsonb_build_object(
    'settled', true,
    'atomic', true,
    'area_id', aa.target_id,
    'settle_from', settle_from,
    'settled_at', now_ts,
    'raw_elapsed_ms', raw_elapsed_ms,
    'elapsed_ms', elapsed_ms,
    'capped_ms', cap_ms,
    'cap_reached', cap_reached,
    'cap_hours', coalesce(_cap_hours, p.offline_cap_hours, 2)::numeric,
    'ticks_requested', ticks_requested,
    'ticks_settled', ticks_requested,
    'new_tick_count', new_tick_count,
    'start_tick', new_tick_count - ticks_requested,
    'end_tick', new_tick_count,
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object('credits_awarded', _credits, 'scrap_awarded', _scrap, 'xp_awarded', _xp, 'cache_fragments_awarded', _fragments, 'materials', coalesce(_materials, '{}'::jsonb), 'essences', coalesce(_essences, '{}'::jsonb), 'kills_recorded', _kills, 'ticks', ticks_requested),
    'consumed_consumables', applied_consumables
  );

  -- 0034: lifetime kill record — same rule as the foreground claim.
  perform public.cc_record_kill_stats(actor, _kills);

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_settle_offline_roaming', nonce_key, result);

  return result;
end;
$$;
