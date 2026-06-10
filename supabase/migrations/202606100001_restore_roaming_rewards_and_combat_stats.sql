-- Restore runtime backend pieces used by the live idle ticker.
-- Migration 202606100001: combat_stats table + per-area cc_claim_roaming_rewards RPC.
--
-- The client calls cc_claim_roaming_rewards every 3s during roaming and persists
-- combat telemetry through public.combat_stats. The RPC reads per-area economy
-- rates from the roaming_areas table so different turfs give different rewards.

-- 1. combat_stats table (safe — no-op if already exists from 056)
create table if not exists public.combat_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  total_kills bigint not null default 0 check (total_kills >= 0),
  total_deaths bigint not null default 0 check (total_deaths >= 0),
  longest_kill_streak bigint not null default 0 check (longest_kill_streak >= 0),
  last_kill_at timestamptz,
  run_started_at timestamptz,
  kills_by_area jsonb not null default '{}'::jsonb,
  kills_by_weapon_type jsonb not null default '{}'::jsonb,
  kills_by_boss jsonb not null default '{}'::jsonb,
  kills_by_element jsonb not null default '{}'::jsonb,
  highest_boss_tier integer not null default 0 check (highest_boss_tier >= 0),
  active_play_seconds bigint not null default 0 check (active_play_seconds >= 0),
  idle_play_seconds bigint not null default 0 check (idle_play_seconds >= 0),
  updated_at timestamptz not null default now()
);

alter table public.combat_stats enable row level security;

drop policy if exists combat_stats_select_own on public.combat_stats;
create policy combat_stats_select_own on public.combat_stats
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists combat_stats_insert_own on public.combat_stats;
create policy combat_stats_insert_own on public.combat_stats
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists combat_stats_update_own on public.combat_stats;
create policy combat_stats_update_own on public.combat_stats
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. offline_cap_hours column (safe — no-op if already exists from 060)
alter table public.profiles
  add column if not exists offline_cap_hours numeric not null default 2;

-- 3. Per-area cc_claim_roaming_rewards RPC.
--    Reads per-area economy rates from roaming_areas table (created in 055).
--    Uses active_action (not action_kind — fixed in 059).
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
  fragment_roll double precision;
  material_roll double precision;
  gear_roll double precision;
  material_kind text;
  material_pool text[];
  material_choice text;
  rng_seed bigint;
  material_bias jsonb;
  essence_bias jsonb;
  credits_per_tick integer;
  scrap_per_tick integer;
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

  -- Verify active action matches the requested area.
  select * into activity_row
    from public.active_actions
   where user_id = actor
   for update;
  if not found or activity_row.active_action <> 'roaming_loot' or activity_row.target_id <> area_id then
    raise exception 'No active roaming activity for area %', area_id;
  end if;

  -- Look up the area for its economy rates. Areas live in code; we keep an
  -- authoritative mirror in JSONB for the server side. If the row is missing
  -- (e.g. legacy area), fall back to safe defaults.
  select (payload->>'credits_per_tick')::int,
         (payload->>'scrap_per_tick')::int,
         coalesce(payload->'material_bias', '[]'::jsonb),
         coalesce(payload->'essence_bias', '[]'::jsonb)
    into credits_per_tick, scrap_per_tick, material_bias, essence_bias
   from public.roaming_areas
  where id = area_id;

  if credits_per_tick is null then
    credits_per_tick := 1;
    scrap_per_tick := 1;
    material_bias := '["ScrapAlloy"]'::jsonb;
    essence_bias := '[]'::jsonb;
  end if;

  -- Cap the tick batch to the player's offline cap so an offline catchup can
  -- never overflow the economy in a single call.
  offline_cap_ms := greatest(0.25, coalesce(p.offline_cap_hours, 2))::bigint * 3600 * 1000;
  now_ms := (extract(epoch from now()) * 1000)::bigint;
  last_heartbeat_ms := coalesce(
    (extract(epoch from activity_row.last_heartbeat_at) * 1000)::bigint,
    now_ms
  );
  elapsed_ms := greatest(0, now_ms - last_heartbeat_ms);
  capped_ticks := least(ticks, greatest(1, (offline_cap_ms / 3000)::integer));
  final_ticks := least(ticks, capped_ticks);

  -- Per-tick deterministic seed: hash of nonce + actor + area + tick index.
  p_actor_alias := actor::text;
  p_nonce_alias := nonce;
  p_area_alias := area_id;

  for tick_idx in 1..final_ticks loop
    rng_seed := ('x' || substr(md5(p_actor_alias || ':' || p_nonce_alias || ':' || p_area_alias || ':' || tick_idx::text), 1, 16))::bit(64)::bigint;
    if rng_seed < 0 then rng_seed := -rng_seed; end if;

    gear_roll := (rng_seed % 10000) / 10000.0;
    fragment_roll := ((rng_seed / 10000) % 10000) / 10000.0;
    material_roll := ((rng_seed / 100000000) % 10000) / 10000.0;

    if gear_roll < 0.22 then
      kill_awarded := kill_awarded + 0;  -- gear drop announced; client mints.
      gear_announced := gear_announced || jsonb_build_object('tick', tick_idx, 'kind', 'pending');
    elsif fragment_roll < 0.03 then
      fragment_awarded := fragment_awarded + 1;
    elsif material_roll < 0.08 then
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
    xp_awarded := xp_awarded + 1;
  end loop;

  -- Apply skill-tree bonuses (offlineEarnings, scrapYield) as multipliers.
  bonus_credits := floor(credit_awarded * 0.0)::int;  -- placeholder for future skill integration
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
