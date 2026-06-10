-- Migration 202606100002: Fix per-area economy rates
--
-- Phase 1d — the roaming_areas seed data previously hardcoded
-- credits_per_tick=1 and scrap_per_tick=1 for every area, and the
-- RPC hardcoded 1 XP per tick. The client constants have per-area
-- values (idleCreditsPerMinute, idleScrapPerMinute, idleXpPerTick).
--
-- Per-tick conversion: credits = round(creditsPerMinute / 20),
-- scrap = round(scrapPerMinute / 20), xp = idleXpPerTick.
--
-- This also fixes the conditional probability bug (Phase 1a) in the
-- RPC: the old elsif chain reduced fragment/material rates. The new
-- version uses a single cumulative roll from the deterministic seed.

-- 1. Update area seed data with correct per-tick values.
truncate table public.roaming_areas;
insert into public.roaming_areas (id, display_name, unlock_level, payload) values
  ('dustwaste_frontier',  'Dustwaste Frontier',   1,  jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 0, 'xp_per_tick', 1.0,  'material_bias', '["ScrapAlloy","BallisticParts"]'::jsonb,                              'essence_bias', '[]'::jsonb)),
  ('redline_circuit',     'Redline Circuit',      4,  jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 0, 'xp_per_tick', 1.2,  'material_bias', '["ScrapAlloy","BallisticParts"]'::jsonb,                              'essence_bias', '[]'::jsonb)),
  ('ironwood_bastion',    'Ironwood Bastion',     8,  jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 0, 'xp_per_tick', 1.4,  'material_bias', '["BallisticParts","TechFragments"]'::jsonb,                           'essence_bias', '[]'::jsonb)),
  ('blastforge_yards',    'BlastForge Yards',     12, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 0, 'xp_per_tick', 1.65, 'material_bias', '["ScrapAlloy","BallisticParts","ReactiveComponents"]'::jsonb,        'essence_bias', '["IgnitionFluid"]'::jsonb)),
  ('prismatek_reactor',   'Prismatek Reactor',    16, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 0, 'xp_per_tick', 1.9,  'material_bias', '["TechFragments"]'::jsonb,                                            'essence_bias', '["IgnitionFluid","ConduitWire","AcidCompound","CryoGel","VoidEssence"]'::jsonb)),
  ('throwtech_dumpnet',   'ThrowTech Dumpnet',    20, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 0, 'xp_per_tick', 2.15, 'material_bias', '["TechFragments","ReactiveComponents"]'::jsonb,                       'essence_bias', '["ConduitWire"]'::jsonb)),
  ('helixworks_labyrinth', 'HelixWorks Labyrinth', 25, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 0, 'xp_per_tick', 2.4,  'material_bias', '["TechFragments","VoidDust","ScrapAlloy","ReactiveComponents"]'::jsonb, 'essence_bias', '["VoidEssence"]'::jsonb))
on conflict (id) do update set
  display_name = excluded.display_name,
  unlock_level = excluded.unlock_level,
  payload = excluded.payload;

-- 2. Replace cc_claim_roaming_rewards with corrected probabilities and per-area XP.
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
  material_kind text;
  material_pool text[];
  material_choice text;
  rng_seed bigint;
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
  p_actor_alias text;
  p_nonce_alias text;
  p_area_alias text;
  -- Phase 1a constants: single cumulative thresholds
  gear_threshold double precision := 0.22;
  fragment_threshold double precision := 0.25;  -- 0.22 + 0.03
  material_threshold double precision := 0.33;  -- 0.22 + 0.03 + 0.08
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

  p_actor_alias := actor::text;
  p_nonce_alias := nonce;
  p_area_alias := area_id;

  for tick_idx in 1..final_ticks loop
    rng_seed := ('x' || substr(md5(p_actor_alias || ':' || p_nonce_alias || ':' || p_area_alias || ':' || tick_idx::text), 1, 16))::bit(64)::bigint;
    if rng_seed < 0 then rng_seed := -rng_seed; end if;

    -- Phase 1a: single cumulative roll using one derived value from the seed.
    -- Three thresholds stacked: gear at 0.22, fragment at 0.25, material at 0.33.
    tick_roll := (rng_seed % 10000) / 10000.0;

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
      material_choice := material_pool[1 + (rng_seed % array_length(material_pool, 1))::int];
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
