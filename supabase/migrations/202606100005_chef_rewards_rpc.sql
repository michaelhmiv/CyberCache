-- Migration 202606100005: Chef reward application RPC
--
-- The Chef worker (src/server/chef.ts) is the authoritative gameplay
-- engine. It processes tick claims, generates items, computes rewards,
-- and writes results to Supabase. This migration adds:
--
--   1. cc_apply_chef_rewards — stores pre-computed rewards from the Chef
--   2. cc_store_chef_items — inserts generated items into item_instances
--
-- These are intended to replace cc_claim_roaming_rewards when the Chef
-- is active. The old RPC remains as a fallback for direct client claims.

-- -------------------------------------------------------------------
-- 1. cc_apply_chef_rewards — store pre-computed roaming rewards
-- -------------------------------------------------------------------
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
  idempotency_key text;
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

  -- Replay protection
  idempotency_key := _player_id::text || ':chef:' || _tick_count::text;
  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id
     and idempotency_key = idempotency_key;
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

  -- Record in ledger
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_chef_rewards', idempotency_key, result);

  return result;
end;
$$;

revoke execute on function public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text) from public, anon;
grant execute on function public.cc_apply_chef_rewards(uuid, bigint, bigint, bigint, integer, jsonb, jsonb, integer, bigint, text) to authenticated, service_role;

-- -------------------------------------------------------------------
-- 2. cc_store_chef_items — store items generated by the Chef
-- -------------------------------------------------------------------
create or replace function public.cc_store_chef_items(
  _player_id uuid,
  _items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  inserted_count integer := 0;
begin
  if _items is null or jsonb_array_length(_items) = 0 then
    return jsonb_build_object('inserted', 0);
  end if;

  for item in select * from jsonb_array_elements(_items) loop
    insert into public.item_instances (
      owner_user_id,
      runtime_state,
      is_locked,
      rarity,
      item_level,
      payload
    ) values (
      _player_id,
      'available',
      false,
      item ->> 'rarity',
      coalesce((item ->> 'level')::integer, 1),
      item
    );
    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count);
end;
$$;

revoke execute on function public.cc_store_chef_items(uuid, jsonb) from public, anon;
grant execute on function public.cc_store_chef_items(uuid, jsonb) to service_role;

-- -------------------------------------------------------------------
-- 3. cc_increment_pity — increment boss pity counter
-- -------------------------------------------------------------------
create or replace function public.cc_increment_pity(
  _player_id uuid,
  _boss_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  current_boss_state jsonb;
  current_pity integer;
begin
  select * into p from public.profiles where id = _player_id;
  if not found then raise exception 'Profile not found'; end if;

  current_boss_state := coalesce(p.boss_state, '{}'::jsonb);
  current_pity := coalesce((current_boss_state -> ('pity_' || _boss_id))::integer, 0);

  update public.profiles
     set boss_state = current_boss_state ||
           jsonb_build_object(('pity_' || _boss_id), current_pity + 1)
   where id = _player_id;

  return jsonb_build_object('boss_id', _boss_id, 'pity', current_pity + 1);
end;
$$;

revoke execute on function public.cc_increment_pity(uuid, text) from public, anon;
grant execute on function public.cc_increment_pity(uuid, text) to authenticated, service_role;

-- -------------------------------------------------------------------
-- 4. cc_record_boss_victory — record a verified boss kill
-- -------------------------------------------------------------------
create or replace function public.cc_record_boss_victory(
  _player_id uuid,
  _boss_id text,
  _damage_dealt integer,
  _medkits_consumed integer,
  _duration_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  current_boss_state jsonb;
begin
  select * into p from public.profiles where id = _player_id;
  if not found then raise exception 'Profile not found'; end if;

  current_boss_state := coalesce(p.boss_state, '{}'::jsonb);

  update public.profiles
     set boss_state = current_boss_state ||
           jsonb_build_object(
             ('defeated_' || _boss_id), true,
             ('pity_' || _boss_id), 0,
             ('last_boss_victory', jsonb_build_object(
               'boss_id', _boss_id,
               'damage_dealt', _damage_dealt,
               'medkits_consumed', _medkits_consumed,
               'duration_ms', _duration_ms,
               'at', extract(epoch from now())::bigint
             ))
           )
   where id = _player_id
   returning * into p;

  return jsonb_build_object(
    'action_type', 'cc_record_boss_victory',
    'profile', public.cc_profile_snapshot(p),
    'boss_id', _boss_id
  );
end;
$$;

revoke execute on function public.cc_record_boss_victory(uuid, text, integer, integer, integer) from public, anon;
grant execute on function public.cc_record_boss_victory(uuid, text, integer, integer, integer) to service_role;
