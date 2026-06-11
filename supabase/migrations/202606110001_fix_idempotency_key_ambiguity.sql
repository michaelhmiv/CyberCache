-- Migration 202606110001: Fix idempotency_key column/variable ambiguity
--
-- PL/pgSQL variable 'idempotency_key' shadows the table column of the same
-- name, causing "column reference 'idempotency_key' is ambiguous" errors.
-- Qualify all references with table aliases.
--
-- Affected functions:
--   - cc_claim_roaming_rewards (migration 202606100004)
--   - cc_apply_chef_rewards  (migration 202606100005)

-- ===================================================================
-- 1. Fix cc_claim_roaming_rewards
-- ===================================================================
create or replace function public.cc_claim_roaming_rewards(
  ticks integer,
  area_id text,
  tick_count bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  xp_awarded bigint := 0;
  credit_awarded bigint := 0;
  scrap_awarded bigint := 0;
  fragment_awarded smallint := 0;
  material_awarded jsonb := '{}'::jsonb;
  essence_awarded jsonb := '{}'::jsonb;
  kill_awarded integer := 0;
  gear_announced jsonb := '[]'::jsonb;
  activity_row public.active_actions%rowtype;
  tick_idx integer;
  tick_roll double precision;
  sub_roll double precision;
  material_pool text[];
  material_choice text;
  material_bias jsonb;
  essence_bias jsonb;
  credits_per_tick integer;
  scrap_per_tick integer;
  xp_per_tick double precision;
  bonus_credits integer := 0;
  bonus_scrap integer := 0;
  offline_cap_ms bigint;
  capped_ticks integer;
  now_ms bigint;
  last_heartbeat_ms bigint;
  elapsed_ms bigint;
  final_ticks integer;
  new_level integer;
  new_xp bigint;
  xp_state jsonb;
  gear_threshold double precision := 0.22;
  fragment_threshold double precision := 0.25;
  material_threshold double precision := 0.33;
  nonce_key text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if ticks is null or ticks < 1 or ticks > 2400 then raise exception 'ticks must be between 1 and 2400'; end if;
  if area_id is null or length(trim(area_id)) < 2 then raise exception 'area_id is required'; end if;
  if tick_count is null or tick_count < 1 then raise exception 'tick_count must be a positive integer'; end if;

  nonce_key := actor::text || ':' || tick_count::text;

  -- FIXED: qualify column with table alias to avoid ambiguity
  select result_payload into prior from public.verified_action_ledger vl
   where vl.user_id = actor and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  if tick_count <= p.last_claimed_tick then
    raise exception 'tick_count % is not after last claimed tick %', tick_count, p.last_claimed_tick;
  end if;

  select * into activity_row
    from public.active_actions
   where user_id = actor
   for update;
  if not found or activity_row.active_action <> 'roaming_loot' or activity_row.target_id <> area_id then
    raise exception 'No active roaming activity for area %', area_id;
  end if;

  select (payload->>'credits_per_tick')::int,
         (payload->>'scrap_per_tick')::int,
         coalesce((payload->>'xp_per_tick')::double precision, 1.0),
         coalesce(payload->'material_bias', '[]'::jsonb),
         coalesce(payload->'essence_bias', '[]'::jsonb)
    into credits_per_tick, scrap_per_tick, xp_per_tick, material_bias, essence_bias
   from public.roaming_areas
  where id = area_id;

  if credits_per_tick is null then
    credits_per_tick := 1;
    scrap_per_tick := 0;
    xp_per_tick := 1.0;
    material_bias := '["ScrapAlloy"]'::jsonb;
    essence_bias := '[]'::jsonb;
  end if;

  offline_cap_ms := greatest(0.25, coalesce(p.offline_cap_hours, 2))::bigint * 3600 * 1000;
  now_ms := (extract(epoch from now()) * 1000)::bigint;
  last_heartbeat_ms := coalesce(
    (extract(epoch from activity_row.last_heartbeat_at) * 1000)::bigint,
    now_ms
  );
  elapsed_ms := greatest(0, now_ms - last_heartbeat_ms);
  capped_ticks := least(ticks, greatest(1, (offline_cap_ms / 3000)::integer));
  final_ticks := least(ticks, capped_ticks);

  for tick_idx in 1..final_ticks loop
    perform public.cc_mulberry32_seed(public.cc_hash_string(actor::text || ':' || area_id || ':' || tick_idx::text));

    tick_roll := public.cc_mulberry32_next();

    if tick_roll < gear_threshold then
      kill_awarded := kill_awarded + 0;
      gear_announced := gear_announced || jsonb_build_object('tick', tick_idx, 'kind', 'pending');
    elsif tick_roll < fragment_threshold then
      fragment_awarded := fragment_awarded + 1;
    elsif tick_roll < material_threshold then
      material_pool := ARRAY(SELECT jsonb_array_elements_text(material_bias));
      if array_length(material_pool, 1) is null then
        material_pool := ARRAY['ScrapAlloy'];
      end if;
      sub_roll := public.cc_mulberry32_next();
      material_choice := material_pool[1 + (floor(sub_roll * array_length(material_pool, 1)))::int];
      if material_choice = any(select jsonb_array_elements_text(essence_bias)) then
        essence_awarded := jsonb_set(essence_awarded, array[material_choice], to_jsonb(coalesce((essence_awarded ->> material_choice)::int, 0) + 1), true);
      else
        material_awarded := jsonb_set(material_awarded, array[material_choice], to_jsonb(coalesce((material_awarded ->> material_choice)::int, 0) + 1), true);
      end if;
    else
      kill_awarded := kill_awarded + 1;
    end if;

    credit_awarded := credit_awarded + credits_per_tick;
    scrap_awarded := scrap_awarded + scrap_per_tick;
    xp_awarded := xp_awarded + round(xp_per_tick);
  end loop;

  bonus_credits := floor(credit_awarded * 0.0)::int;
  bonus_scrap := floor(scrap_awarded * 0.0)::int;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, xp_awarded);
  new_level := (xp_state ->> 'player_level')::int;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  update public.profiles
     set credits = credits + credit_awarded + bonus_credits,
         scrap = scrap + scrap_awarded + bonus_scrap,
         player_level = new_level,
         player_xp = new_xp,
         cache_token_parts = cache_token_parts + fragment_awarded,
         last_claimed_tick = tick_count
   where id = actor
   returning * into p;

  update public.active_actions
     set last_heartbeat_at = now(),
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_claim_ticks', final_ticks, 'last_claim_at', now_ms)
   where user_id = actor
   returning * into activity_row;

  result := jsonb_build_object(
    'action_type', 'cc_claim_roaming_rewards',
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object(
      'ticks', final_ticks,
      'credits_awarded', credit_awarded + bonus_credits,
      'scrap_awarded', scrap_awarded + bonus_scrap,
      'xp_awarded', xp_awarded,
      'cache_fragments_awarded', fragment_awarded,
      'materials', material_awarded,
      'essences', essence_awarded,
      'kills_recorded', kill_awarded,
      'gear_announced', gear_announced
    ),
    'activity', to_jsonb(activity_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_claim_roaming_rewards', nonce_key, result);

  return result;
end;
$$;

-- ===================================================================
-- 2. Fix cc_apply_chef_rewards
-- ===================================================================
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
  _area_id text
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
  -- Validate player
  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Replay protection — FIXED: renamed variable to nonce_key
  nonce_key := _player_id::text || ':chef:' || _tick_count::text;
  select result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = _player_id
     and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  -- Ordering guard
  if _tick_count <= p.last_claimed_tick then
    raise exception 'tick_count % is not after last claimed tick %', _tick_count, p.last_claimed_tick;
  end if;

  -- Validate active activity (best-effort — the Chef already validated this)
  select * into activity_row
    from public.active_actions
   where user_id = _player_id
   for update;
  if not found or activity_row.active_action <> 'roaming_loot' or activity_row.target_id <> _area_id then
    -- Soft fail — the Chef is authoritative, just warn
    raise warning 'No active roaming activity for area %, proceeding anyway', _area_id;
  end if;

  -- Apply XP leveling
  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, _xp);
  new_level := (xp_state ->> 'player_level')::integer;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  -- Merge materials
  next_materials := coalesce(p.materials, '{}'::jsonb);
  for mat_key, mat_val in select * from jsonb_each(_materials) loop
    next_materials := jsonb_set(
      next_materials,
      array[mat_key],
      to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val),
      true
    );
  end loop;

  -- Merge essences
  next_essences := coalesce(p.essences, '{}'::jsonb);
  for ess_key, ess_val in select * from jsonb_each(_essences) loop
    next_essences := jsonb_set(
      next_essences,
      array[ess_key],
      to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val),
      true
    );
  end loop;

  -- Compute cache token fragments → tokens
  next_parts := coalesce(p.cache_token_parts, 0) + _fragments;
  next_tokens := coalesce(p.cache_tokens, 0);
  while next_parts >= 5 loop
    next_parts := next_parts - 5;
    next_tokens := next_tokens + 1;
  end loop;

  -- Update profile
  update public.profiles
     set credits = credits + _credits,
         scrap = scrap + _scrap,
         player_level = new_level,
         player_xp = new_xp,
         cache_token_parts = next_parts,
         cache_tokens = next_tokens,
         materials = next_materials,
         essences = next_essences,
         last_claimed_tick = _tick_count
   where id = _player_id
   returning * into p;

  -- Update activity heartbeat
  if found then
    update public.active_actions
       set last_heartbeat_at = now(),
           activity_payload = coalesce(activity_payload, '{}'::jsonb) ||
             jsonb_build_object('last_claim_ticks', 1, 'last_claim_at',
               (extract(epoch from now()) * 1000)::bigint)
     where user_id = _player_id;
  end if;

  -- Build result
  result := jsonb_build_object(
    'action_type', 'cc_apply_chef_rewards',
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object(
      'credits_awarded', _credits,
      'scrap_awarded', _scrap,
      'xp_awarded', _xp,
      'cache_fragments_awarded', _fragments,
      'materials', _materials,
      'essences', _essences,
      'kills_recorded', _kills
    )
  );

  -- Record in ledger (FIXED: use nonce_key, not idempotency_key)
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_chef_rewards', nonce_key, result);

  return result;
end;
$$;
