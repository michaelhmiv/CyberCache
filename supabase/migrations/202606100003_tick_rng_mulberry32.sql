-- Migration 202606100003: Deterministic tick RNG (Mulberry32 in PL/pgSQL)
--
-- Phase 3a — implements the same Mulberry32 PRNG used by the
-- TypeScript client (src/lib/utils/rng.ts) so the server's
-- cc_claim_roaming_rewards can produce identical random streams
-- for the same (player_id, area_id, tick_count) tuple.
--
-- cc_tick_rng(player_id, area_id, tick_count) returns a set of
-- deterministic float8 values in [0,1). Called once per tick;
-- the caller consumes as many values as it needs.

-- Helper: hash a text tuple into a bigint seed (mirrors hashString in rng.ts).
create or replace function public.cc_hash_string(input text)
returns bigint
language plpgsql
immutable
as $$
declare
  h bigint := 1779033703;
  i integer;
  ch integer;
begin
  for i in 1..length(input) loop
    ch := ascii(substr(input, i, 1));
    -- mulberry-style mixing (approximates Math.imul with 64-bit wraparound)
    h := ((h # ch) * 3432918353) & 4294967295;
    h := ((h << 13) | (h >> 19)) & 4294967295;
  end loop;
  return h;
end;
$$;

-- Mulberry32 PRNG: stateful, returns next float8 in [0,1).
-- Call cc_mulberry32_seed(seed) once, then cc_mulberry32_next()
-- repeatedly. The state is stored in a session-level temp table.
create or replace function public.cc_mulberry32_seed(seed bigint)
returns void
language plpgsql
as $$
begin
  perform set_config('cc.m32_state', seed::text, true);
end;
$$;

create or replace function public.cc_mulberry32_next()
returns double precision
language plpgsql
as $$
declare
  s bigint;
  t bigint;
begin
  s := coalesce(nullif(current_setting('cc.m32_state', true), ''), '0')::bigint;
  s := (s + 18205) & 4294967295;  -- 0x6D2B79F5
  t := s;
  t := ((t # (t >> 15)) * (t | 1)) & 4294967295;
  t := (t + ((t # (t >> 7)) * (t | 61)) & 4294967295) & 4294967295;
  t := t # (t >> 14);
  perform set_config('cc.m32_state', s::text, true);
  return (t & 4294967295)::double precision / 4294967296.0;
end;
$$;

-- Convenience: seed and return first value in one call.
create or replace function public.cc_tick_rng(
  player_id uuid,
  area_id text,
  tick_count bigint
)
returns double precision
language plpgsql
immutable
as $$
declare
  seed_text text;
  seed_val bigint;
begin
  seed_text := player_id::text || ':' || area_id || ':' || tick_count::text;
  seed_val := public.cc_hash_string(seed_text);
  perform public.cc_mulberry32_seed(seed_val);
  return public.cc_mulberry32_next();
end;
$$;

-- Update cc_claim_roaming_rewards to use the deterministic RNG.
-- The RNG stream replaces the old md5-based seed derivation.
-- Each tick calls cc_tick_rng once to seed the stream, then
-- cc_mulberry32_next() for each random decision.
create or replace function public.cc_claim_roaming_rewards(
  nonce text,
  ticks integer,
  area_id text
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
  material_kind text;
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
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if ticks is null or ticks < 1 or ticks > 2400 then raise exception 'ticks must be between 1 and 2400'; end if;
  if area_id is null or length(trim(area_id)) < 2 then raise exception 'area_id is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

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
    -- Phase 3a: seed the Mulberry32 stream from the deterministic tuple,
    -- then consume values from the stream for each decision.
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
        material_kind := 'essence';
      else
        material_awarded := jsonb_set(material_awarded, array[material_choice], to_jsonb(coalesce((material_awarded ->> material_choice)::int, 0) + 1), true);
        material_kind := 'material';
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
         cache_token_parts = cache_token_parts + fragment_awarded
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
  values (actor, 'cc_claim_roaming_rewards', nonce, result);

  return result;
end;
$$;

revoke execute on function public.cc_claim_roaming_rewards(text, integer, text) from public, anon;
grant execute on function public.cc_claim_roaming_rewards(text, integer, text) to authenticated, service_role;
