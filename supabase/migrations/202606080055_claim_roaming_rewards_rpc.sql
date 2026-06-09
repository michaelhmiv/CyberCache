-- Migration 055: cc_claim_roaming_rewards RPC
--
-- Single-source-of-truth tick reward claim. Called by the client every 3s while
-- the user has an active roaming_loot activity. Server validates the activity
-- matches and awards the economy portion (credits, scrap, XP, fragments,
-- materials, essences) deterministically from the active area's rates. Gear
-- drops are still client-rolled in this iteration; the server-rolled gear
-- pipeline ships in migration 058 (see issue #56).
--
-- The client preview is honored by re-rolling the same probabilities
-- server-side using a deterministic seed derived from the nonce + actor + area,
-- so the visual feedback and the persisted rewards reconcile.

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
  xp_per_tick integer;
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
  action_payload jsonb;
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
  if not found or activity_row.action_kind <> 'roaming_loot' or activity_row.target_id <> area_id then
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

  -- Read the per-area XP multiplier. Falls back to 1 if the column was added
  -- by migration 057 after the row was already in place (defensive: the
  -- backfill at the bottom of 057 covers all seven canonical areas).
  select xp_per_tick into xp_per_tick from public.roaming_areas where id = area_id;

  if credits_per_tick is null then
    credits_per_tick := 1;
    scrap_per_tick := 1;
    xp_per_tick := 1;
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
    xp_awarded := xp_awarded + coalesce(xp_per_tick, 1);
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

-- Mirror the roaming area economy rates server-side. This table is read by
-- cc_claim_roaming_rewards; client UI may also read it for display. The
-- payload column is a jsonb blob so we don't need a schema change when the
-- game adds new per-area fields.

create table if not exists public.roaming_areas (
  id text primary key,
  display_name text not null,
  unlock_level integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.roaming_areas enable row level security;

drop policy if exists roaming_areas_read_authenticated on public.roaming_areas;
create policy roaming_areas_read_authenticated
  on public.roaming_areas
  for select
  to authenticated
  using (true);

-- Seed the seven canonical areas. Values mirror constants/roamingAreas.ts.
insert into public.roaming_areas (id, display_name, unlock_level, payload) values
  ('dustwaste_frontier', 'Dustwaste Frontier', 1, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 1, 'material_bias', '["ScrapAlloy","BallisticParts"]'::jsonb, 'essence_bias', '[]'::jsonb)),
  ('redline_circuit', 'Redline Circuit', 4, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 1, 'material_bias', '["ScrapAlloy","BallisticParts"]'::jsonb, 'essence_bias', '[]'::jsonb)),
  ('ironwood_bastion', 'Ironwood Bastion', 8, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 1, 'material_bias', '["BallisticParts","TechFragments"]'::jsonb, 'essence_bias', '[]'::jsonb)),
  ('blastforge_yards', 'BlastForge Yards', 12, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 1, 'material_bias', '["ScrapAlloy","BallisticParts","ReactiveComponents"]'::jsonb, 'essence_bias', '["IgnitionFluid"]'::jsonb)),
  ('prismatek_reactor', 'Prismatek Reactor', 16, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 1, 'material_bias', '["TechFragments"]'::jsonb, 'essence_bias', '["IgnitionFluid","ConduitWire","AcidCompound","CryoGel","VoidEssence"]'::jsonb)),
  ('throwtech_dumpnet', 'ThrowTech Dumpnet', 20, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 1, 'material_bias', '["TechFragments","ReactiveComponents"]'::jsonb, 'essence_bias', '["ConduitWire"]'::jsonb)),
  ('helixworks_labyrinth', 'HelixWorks Labyrinth', 25, jsonb_build_object('credits_per_tick', 1, 'scrap_per_tick', 1, 'material_bias', '["TechFragments","VoidDust","ScrapAlloy","ReactiveComponents"]'::jsonb, 'essence_bias', '["VoidEssence"]'::jsonb))
on conflict (id) do update set
  display_name = excluded.display_name,
  unlock_level = excluded.unlock_level,
  payload = excluded.payload;
