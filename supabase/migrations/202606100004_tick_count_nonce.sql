-- Migration 202606100004: Tick-count nonce and replay protection
--
-- Phase 4a-c — replaces the random-UUID nonce system with a
-- monotonically-increasing tick_count. The server uses (actor, tick_count)
-- as the idempotency key, so:
--   1. Replay of the same tick returns the cached result (no double-claim)
--   2. Claims with tick_count <= last_claimed_tick are rejected
--   3. Two clients with the same tick_count get identical results
--
-- Also adds last_claimed_tick to profiles to enforce ordering.

-- 1. Add last_claimed_tick to profiles.
alter table public.profiles
  add column if not exists last_claimed_tick bigint not null default 0;

-- 2. Replace cc_claim_roaming_rewards with tick_count-based version.
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
  idempotency_key text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if ticks is null or ticks < 1 or ticks > 2400 then raise exception 'ticks must be between 1 and 2400'; end if;
  if area_id is null or length(trim(area_id)) < 2 then raise exception 'area_id is required'; end if;
  if tick_count is null or tick_count < 1 then raise exception 'tick_count must be a positive integer'; end if;

  -- Phase 4: idempotency keyed on (actor, tick_count). If this tick was
  -- already processed, return the cached result. If this tick is before
  -- the last claimed tick, reject.
  idempotency_key := actor::text || ':' || tick_count::text;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = idempotency_key;
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
  values (actor, 'cc_claim_roaming_rewards', idempotency_key, result);

  return result;
end;
$$;

-- Drop the old signature (with nonce parameter) — the new signature
-- uses tick_count as the third parameter. The client must be updated to
-- call cc_claim_roaming_rewards(ticks, area_id, tick_count).
drop function if exists public.cc_claim_roaming_rewards(text, integer, text);

revoke execute on function public.cc_claim_roaming_rewards(integer, text, bigint) from public, anon;
grant execute on function public.cc_claim_roaming_rewards(integer, text, bigint) to authenticated, service_role;
