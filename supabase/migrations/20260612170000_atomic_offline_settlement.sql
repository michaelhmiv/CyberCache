-- Migration 20260612170000: offline settlement atomicity and canonical timestamp
--
-- Fix 4: cc_apply_chef_rewards now advances last_roaming_settled_at.
--   Every successful roaming reward application (foreground AND offline)
--   updates the canonical settlement timestamp. This ensures the next
--   offline settlement computes elapsed time from the last claim time,
--   not from some stale initial started_at.
--
--   When last_roaming_settled_at is NULL (first-ever claim), set it to
--   now(); otherwise advance it. This ensures the column is never NULL
--   after the first reward application.
--
-- Fix 5: cc_settle_offline_roaming — atomic offline settlement RPC.
--   The client POSTs a nonce (UUID); the server verifies the authenticated
--   user, locks the profile and active action, computes elapsed time using
--   DB now(), applies the offline cap, computes eligible ticks, enforces
--   idempotency, updates rewards + last_claimed_tick + last_roaming_settled_at
--   + last_settlement_nonce, and returns the full recap payload.
--
--   This replaces the multi-step route approach (read profile, read action,
--   process, apply rewards, update tracking) with a single atomic DB
--   transaction, eliminating race conditions between the read and write.

-- ============================================================================
-- 1. Update cc_apply_chef_rewards to advance last_roaming_settled_at
-- ============================================================================

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
  -- FIX 4: Also advance last_roaming_settled_at so the canonical settlement
  -- timestamp moves forward on every claim (foreground AND offline).
  -- NULL-safe: if this is the first-ever claim, set it to now().
  update public.profiles
     set credits = credits + _credits,
         scrap = scrap + _scrap,
         player_level = new_level,
         player_xp = new_xp,
         cache_token_parts = next_parts,
         cache_tokens = next_tokens,
         materials = next_materials,
         essences = next_essences,
         last_claimed_tick = _tick_count,
         last_roaming_settled_at = coalesce(last_roaming_settled_at, now()),
         updated_at = now()
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

-- ============================================================================
-- 2. cc_settle_offline_roaming — atomic offline settlement RPC
--
--    Handles the full settlement lifecycle in a single DB transaction:
--    authenticate, lock profile + active_action, verify roaming,
--    compute elapsed with DB now(), apply offline cap, compute ticks,
--    enforce idempotency, apply rewards, update last_claimed_tick,
--    last_roaming_settled_at, and last_settlement_nonce.
--
--    The Chef server generates rewards before calling this RPC.
--    The RPC persists them atomically so there is no gap between
--    the elapsed-time read and the reward write.
-- ============================================================================

create or replace function public.cc_settle_offline_roaming(
  _settlement_nonce text,
  _credits bigint,
  _scrap bigint,
  _xp bigint,
  _fragments integer,
  _materials jsonb,
  _essences jsonb,
  _kills integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
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
  idempotency_key text;
  result jsonb;
begin
  -- Authentication
  if actor is null then raise exception 'Authentication required'; end if;
  if _settlement_nonce is null or length(trim(_settlement_nonce)) < 8 then
    raise exception 'settlement_nonce is required (min 8 chars)';
  end if;

  -- Idempotency check via verified_action_ledger
  idempotency_key := actor::text || ':offline_settle:' || _settlement_nonce;
  select result_payload into prior
    from public.verified_action_ledger
   where user_id = actor
     and idempotency_key = idempotency_key;
  if prior is not null then return prior; end if;

  -- Serialize concurrent settlements
  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Lock profile FOR UPDATE
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Lock active action FOR UPDATE
  select * into aa
    from public.active_actions
   where user_id = actor
   for update;

  -- Must be roaming
  if not found or aa.active_action <> 'roaming_loot' then
    return jsonb_build_object(
      'settled', false,
      'reason', 'not_roaming',
      'active_action', coalesce(aa.active_action, 'none')
    );
  end if;

  -- Compute elapsed time using server-authoritative timestamps
  settle_from := coalesce(p.last_roaming_settled_at, aa.started_at);
  if settle_from is null then
    return jsonb_build_object(
      'settled', false,
      'reason', 'no_elapsed',
      'detail', 'No settlement start timestamp available'
    );
  end if;

  raw_elapsed_ms := (extract(epoch from now_ts) * 1000)::bigint
                    - (extract(epoch from settle_from) * 1000)::bigint;
  if raw_elapsed_ms < 0 then raw_elapsed_ms := 0; end if;

  -- Apply offline cap
  cap_ms := coalesce(p.offline_cap_hours, 2)::bigint * 3600 * 1000;
  cap_reached := raw_elapsed_ms > cap_ms;
  elapsed_ms := least(raw_elapsed_ms, cap_ms);

  -- Compute eligible ticks
  ticks_requested := floor(elapsed_ms / tick_ms)::integer;
  if ticks_requested <= 0 then
    return jsonb_build_object(
      'settled', false,
      'reason', 'no_elapsed',
      'elapsed_ms', elapsed_ms
    );
  end if;

  -- Compute new tick count
  new_tick_count := coalesce(p.last_claimed_tick, 0) + ticks_requested;

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

  -- Atomic update: rewards + tracking all in one statement
  -- last_roaming_settled_at = now_ts (NOT settle_from + cap_ms) so
  -- repeated resumes cannot re-claim old capped time windows.
  update public.profiles
     set credits = credits + _credits,
         scrap = scrap + _scrap,
         player_level = new_level,
         player_xp = new_xp,
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

  -- Update activity heartbeat
  update public.active_actions
     set last_heartbeat_at = now_ts,
         activity_payload = coalesce(activity_payload, '{}'::jsonb) ||
           jsonb_build_object('last_offline_settle_at',
             (extract(epoch from now_ts) * 1000)::bigint)
   where user_id = actor;

  -- Build result
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
    'cap_hours', coalesce(p.offline_cap_hours, 2)::integer,
    'ticks_requested', ticks_requested,
    'ticks_settled', ticks_requested,
    'new_tick_count', new_tick_count,
    'start_tick', coalesce(p.last_claimed_tick, 0) - ticks_requested,
    'end_tick', new_tick_count,
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object(
      'credits_awarded', _credits,
      'scrap_awarded', _scrap,
      'xp_awarded', _xp,
      'cache_fragments_awarded', _fragments,
      'materials', _materials,
      'essences', _essences,
      'kills_recorded', _kills,
      'ticks', ticks_requested
    )
  );

  -- Record in ledger for idempotency
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_settle_offline_roaming', idempotency_key, result);

  return result;
end;
$$;

revoke execute on function public.cc_settle_offline_roaming(text, bigint, bigint, bigint, integer, jsonb, jsonb, integer) from public, anon;
grant execute on function public.cc_settle_offline_roaming(text, bigint, bigint, bigint, integer, jsonb, jsonb, integer) to authenticated, service_role;

comment on function public.cc_settle_offline_roaming(text, bigint, bigint, bigint, integer, jsonb, jsonb, integer) is
  'Atomic offline roaming settlement. Computes elapsed time from server timestamps, applies offline cap, persists rewards + last_claimed_tick + last_roaming_settled_at + last_settlement_nonce in a single DB transaction. Chef generates rewards before calling this RPC.';
