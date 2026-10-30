-- 0010_economy_remainders.sql
-- Fractional accumulation for credits and XP (follow-through on 0009).
--
-- 0009 fixed scrap, whose per-tick rounding paid zero. Credits and XP
-- had the same defect in the other direction: credits 15/min rounded
-- 0.75 up to 1 per tick (+33% overpay), XP rates like 1.2/tick rounded
-- down to 1 (-17%). Both now accrue unrounded in the Chef and bank
-- their fractions on the profile exactly like scrap_remainder.
--
-- The new trailing parameters are defaulted so existing callers keep
-- working; the 0009 signatures are dropped so they stay unambiguous.

alter table public.profiles
  add column if not exists credits_remainder numeric(8, 6) not null default 0;
alter table public.profiles
  add column if not exists xp_remainder numeric(8, 6) not null default 0;

do $$
begin
  alter table public.profiles
    add constraint profiles_credits_remainder_range
    check (credits_remainder >= 0 and credits_remainder < 1);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.profiles
    add constraint profiles_xp_remainder_range
    check (xp_remainder >= 0 and xp_remainder < 1);
exception when duplicate_object then null;
end $$;

drop function if exists public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text, numeric);
drop function if exists public.cc_settle_offline_roaming(uuid, text, bigint, bigint, bigint, integer, jsonb, jsonb, integer, numeric);

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

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_chef_rewards', nonce_key, result);

  return result;
end;
$$;

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
  _xp_remainder numeric default null
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

  cap_ms := (greatest(0.25, coalesce(p.offline_cap_hours, 2)) * 3600 * 1000)::bigint;
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
         last_claimed_tick = new_tick_count,
         last_roaming_settled_at = now_ts,
         last_settlement_nonce = _settlement_nonce,
         updated_at = now_ts
   where id = actor
   returning * into p;

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
    'cap_hours', coalesce(p.offline_cap_hours, 2)::numeric,
    'ticks_requested', ticks_requested,
    'ticks_settled', ticks_requested,
    'new_tick_count', new_tick_count,
    'start_tick', new_tick_count - ticks_requested,
    'end_tick', new_tick_count,
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object('credits_awarded', _credits, 'scrap_awarded', _scrap, 'xp_awarded', _xp, 'cache_fragments_awarded', _fragments, 'materials', coalesce(_materials, '{}'::jsonb), 'essences', coalesce(_essences, '{}'::jsonb), 'kills_recorded', _kills, 'ticks', ticks_requested)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_settle_offline_roaming', nonce_key, result);

  return result;
end;
$$;
