-- 0033_extraction.sql
--
-- Extraction occupation (Expansion Pack run, unit 21/32). Design:
-- src/content/extraction.ts (the content owner) and
-- design-briefs/expansion-pack/extraction-occupation.md (defaults
-- approved by Michael 2026-10-31, DECISIONS.md record).
--
-- Extraction is a personal-action-slot occupation: the hunter works
-- one site (area + method) in 10-minute passes that complete
-- back-to-back ONLY while 'extraction' is the active action. Each
-- completed pass rolls the area's shipped material find pool
-- (192 draws/hour Surface; 288/hour Deep Delve at mastery >= 5 with
-- a server-computed gear factor >= 0.80) and pays XP pegged at
-- 0.75 x the roaming benchmark through the crafting peg machinery.
-- Finds are materials and essences ONLY — no gear, no credits, no
-- scrap, no fragments, no cores (the crafter-economy supply lane).
--
-- Settlement mirrors crafting (0024) exactly: time accrues under
-- the same window math (attended = heartbeat + 300s grace; the
-- away tail is capped by min(earned offline tier, user limiter)
-- clamped [1h, 24h]; an explicit max-advance caps the whole delta
-- for offline settlement). Accrual and finalization are split the
-- way the systems divide: accrual is pure time accounting and
-- lives here (cc_settle_extraction_time, called from the activity
-- transition hooks and by the Chef before every roll); the rolls
-- themselves are TypeScript (the find pool and the tick-RNG
-- streams have no SQL twin), finalized through cc_apply_extraction,
-- which re-validates everything it is handed — sequential pass
-- indexes continuing the finalized count, finds keys inside the
-- material/essence whitelist, per-pass unit bounds — and prices
-- XP itself from the level sequence, so a forged batch settles
-- from server records or not at all.
--
-- What lands here:
--   1. public.extraction_state — the per-player occupation row.
--      pending_passes stores {index, areaId, method} per completed
--      pass (each pass keeps the terms it STARTED on; the standing
--      selection adopts at the boundary). NOTE (deviation from
--      the brief's bare count): the terms must be stored, not
--      counted, or a pass that started before a site/method switch
--      cannot be priced as begun.
--   1b. active_actions CHECK restated (0028 pattern) so the slot
--      accepts 'extraction'.
--   2. mastery_definitions seed: gathering.extraction (20 XP/pass).
--   3. Economy metrics columns: extraction_passes,
--      extraction_xp_awarded, materials_minted_extraction (the
--      per-material mint mirror of materials_destroyed_crafting).
--   4. cc_extract_pass_xp — delegates to cc_craft_unit_xp at the
--      pass duration so the peg twins can never drift.
--   5. cc_settle_extraction_time — accrual only (window math).
--   6. cc_apply_extraction — the validating batch applier.
--   7. cc_set_active_action restated (0028 body + 'extraction' in
--      the kind whitelist + the accrual hook + the start gates and
--      selection sync); cc_clear_active_action restated (0025 body
--      + the accrual hook).
--   8. cc_compute_economy_metrics restated (0032 body + the three
--      extraction meters).
--
-- APPLY BEFORE MERGE. No backfill: extraction_state rows are
-- created lazily by cc_set_active_action on the first claim.
-- ---------------------------------------------------------------------------
-- 1. extraction_state — the occupation row.
-- ---------------------------------------------------------------------------

create table if not exists public.extraction_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  -- Standing selection: adopted by the next pass at its boundary.
  area_id text not null,
  method text not null default 'surface' check (method in ('surface', 'deep')),
  -- Terms of the in-progress pass (null until the first pass starts).
  pass_area_id text,
  pass_method text check (pass_method in ('surface', 'deep')),
  -- Progress inside the in-progress pass, ms [0, 600000).
  accrued_ms bigint not null default 0,
  -- Completed passes awaiting finalization, oldest first:
  -- [{index, areaId, method}] on the terms each pass started on.
  pending_passes jsonb not null default '[]'::jsonb,
  -- Passes finalized all-time (the next index is finalized + 1).
  finalized_passes integer not null default 0,
  total_xp_awarded bigint not null default 0,
  last_settled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The action slot learns 'extraction' (the 0028 pattern).
alter table public.active_actions
  drop constraint if exists active_actions_active_action_check;
alter table public.active_actions
  add constraint active_actions_active_action_check
  check (active_action = any (array[
    'none', 'idle_standby', 'roaming_loot', 'boss_prep', 'boss_fight',
    'crafting', 'salvaging', 'workshop_service', 'market_listing',
    'endless_run', 'extraction'
  ]));

-- ---------------------------------------------------------------------------
-- 2. Mastery seed: gathering.extraction (§2.6 of the brief).
-- ---------------------------------------------------------------------------

insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at)
values ('gathering.extraction', 'economy', 'Extraction', 'Site extraction experience. Higher levels raise extraction yield, and level 5 unlocks Deep Delve.', 'passes', 20, true, true, now(), now())
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Economy metrics: the three extraction meters (§2.8).
-- ---------------------------------------------------------------------------

alter table public.economy_metrics
  add column if not exists extraction_passes integer not null default 0;
alter table public.economy_metrics
  add column if not exists extraction_xp_awarded bigint not null default 0;
alter table public.economy_metrics
  add column if not exists materials_minted_extraction jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- 4. cc_extract_pass_xp — the peg twin. A pass is 600000 ms of
--    occupation time priced by the crafting peg machinery itself
--    (1200 ticks/hour x the best unlocked area's idleXpPerTick), so
--    extraction and crafting can never drift apart. The rate is
--    clamped by the CALLER to the hard [0.70, 0.85] band.
-- ---------------------------------------------------------------------------

create or replace function public.cc_extract_pass_xp(
  p_level integer,
  p_rate numeric
)
returns bigint
language sql
immutable
set search_path = public
as $$
  select public.cc_craft_unit_xp(600000, coalesce(p_level, 1), coalesce(p_rate, 0.75))
$$;

-- ---------------------------------------------------------------------------
-- 5. cc_settle_extraction_time — accrual only. The window math is
--    cc_settle_craft_jobs' (0024), verbatim in shape: attended time
--    runs to the activity heartbeat + 300s grace and is never
--    truncated; the away tail is capped by the internal away cap
--    (min(earned tier, limiter), [1h, 24h] — WITHOUT the keystone
--    bonus, like crafting's lazy settles); an explicit max-advance
--    (offline settlement, which computes the cap WITH the keystone
--    in the route) caps the whole delta. Whole passes convert at
--    600000 ms onto the terms they started on; the standing
--    selection adopts for each subsequent pass. last_settled_at
--    rebases on every call, active or not — paused time earns
--    nothing because the advance is 0 off-action and the rebase
--    discards the gap.
-- ---------------------------------------------------------------------------

create or replace function public.cc_settle_extraction_time(
  p_player_id uuid,
  p_max_advance_ms bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
  v_now timestamptz := now();
  v_now_ms bigint := (extract(epoch from v_now) * 1000)::bigint;
  v_action text;
  v_heartbeat_ms bigint;
  v_away_cap_ms bigint;
  s public.extraction_state%rowtype;
  v_start_ms bigint;
  v_raw bigint;
  v_attended bigint;
  v_advance bigint := 0;
  v_total bigint;
  v_new_passes integer := 0;
  v_pass_index integer;
  v_pending jsonb;
  v_area text;
  v_method text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_profile',
      'advanced_ms', 0, 'new_passes', 0,
      'pending_passes', '[]'::jsonb, 'accrued_ms', 0);
  end if;

  select * into s from public.extraction_state where user_id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_extraction_state',
      'advanced_ms', 0, 'new_passes', 0,
      'pending_passes', '[]'::jsonb, 'accrued_ms', 0);
  end if;

  select active_action, (extract(epoch from last_heartbeat_at) * 1000)::bigint
    into v_action, v_heartbeat_ms
    from public.active_actions where user_id = actor;

  -- Internal away cap: min(earned tier, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours(p.player_level),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours(p.player_level))
    )) * 3600000)::bigint;

  v_start_ms := (extract(epoch from s.last_settled_at) * 1000)::bigint;
  v_raw := greatest(0, v_now_ms - v_start_ms);
  if v_action is distinct from 'extraction' or v_raw <= 0 then
    v_advance := 0;
  elsif p_max_advance_ms is not null then
    v_advance := least(v_raw, greatest(0, p_max_advance_ms));
  else
    v_attended := least(v_raw, greatest(0,
      coalesce(v_heartbeat_ms, v_start_ms) + 300000 - v_start_ms));
    v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
  end if;

  v_total := s.accrued_ms + v_advance;
  v_pending := s.pending_passes;
  v_area := coalesce(s.pass_area_id, s.area_id);
  v_method := coalesce(s.pass_method, s.method);
  v_pass_index := s.finalized_passes + jsonb_array_length(v_pending);
  while v_total >= 600000 loop
    v_total := v_total - 600000;
    v_pass_index := v_pass_index + 1;
    v_pending := v_pending || jsonb_build_array(jsonb_build_object(
      'index', v_pass_index, 'areaId', v_area, 'method', v_method));
    v_new_passes := v_new_passes + 1;
    v_area := s.area_id;
    v_method := s.method;
  end loop;

  update public.extraction_state
     set accrued_ms = v_total,
         pending_passes = v_pending,
         pass_area_id = v_area,
         pass_method = v_method,
         last_settled_at = v_now,
         updated_at = v_now
   where user_id = actor;

  return jsonb_build_object('settled', true, 'advanced_ms', v_advance,
    'new_passes', v_new_passes, 'pending_passes', v_pending,
    'accrued_ms', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. cc_apply_extraction — the batch applier. The Chef rolls the
--    pending passes (pool + tick-RNG are TypeScript) and hands the
--    batch here; this function trusts none of it:
--      * nonce idempotency (a replayed batch pays once);
--      * pass indexes must continue finalized_passes + 1 in order,
--        and each pass must BE the pending pass on record (area /
--        method read from extraction_state, not from the claim);
--      * every find key must sit inside the material / essence
--        whitelist (the shipped id sets, TS twin:
--        EXTRACTION_MATERIAL_IDS / EXTRACTION_ESSENCE_IDS in
--        src/content/extraction.ts);
--      * per-pass units are bounded by 2 x draws (each draw yields
--        at most one find, plus Scavenger's +1 at most once per
--        find), and draws by the 500 hard bound;
--      * XP is priced HERE, per pass, from the player's level
--        sequence: cc_extract_pass_xp at the clamped lever rate,
--        composed ONCE with the Cache Rank XP bonus fraction and
--        applied through cc_apply_xp, so a mid-batch level-up
--        reprices the later passes exactly like the Chef's twin.
--    Mastery lands per pass through cc_add_mastery_xp (the 0024
--    precedent). One ledger row per batch feeds the generic stats
--    trigger and the economy metrics fold.
-- ---------------------------------------------------------------------------

create or replace function public.cc_apply_extraction(
  p_player_id uuid,
  p_nonce text,
  p_passes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  s public.extraction_state%rowtype;
  v_rate numeric := least(0.85, greatest(0.70,
    public.cc_economy_config_number('extractXpRate', 0.75)));
  v_rank_fraction numeric;
  v_pending jsonb;
  v_expected integer;
  v_pass jsonb;
  v_index integer;
  v_draws integer;
  v_units bigint;
  v_key text;
  v_qty bigint;
  v_xp bigint;
  v_next jsonb;
  v_level integer;
  v_level_xp bigint;
  v_total_xp bigint := 0;
  v_materials jsonb := '{}'::jsonb;
  v_essences jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  result jsonb;
  v_material_ids text[] := array[
    'ScrapAlloy','BallisticParts','ReactiveComponents','TechFragments','VoidDust',
    'Siltglass','NitrocellGel','HeartwoodResin','ForgeheartIngots',
    'PrismShards','MagnetiteCores','MycoSteelFiber',
    'RefinedAlloy','TemperedParts','StabilizedCells','WovenCircuits',
    'CondensedVoid','CompositePlating','CircuitLattice','Voidweave'];
  v_essence_ids text[] := array[
    'IgnitionFluid','ConduitWire','AcidCompound','CryoGel','VoidEssence'];
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(trim(p_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = p_nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into s from public.extraction_state where user_id = actor for update;
  if not found then raise exception 'No extraction state'; end if;

  v_pending := s.pending_passes;
  if jsonb_typeof(p_passes) is distinct from 'array' then
    raise exception 'Extraction passes payload must be an array';
  end if;
  if jsonb_array_length(p_passes) = 0 then
    raise exception 'Extraction settle batch is empty';
  end if;
  if jsonb_array_length(p_passes) > jsonb_array_length(v_pending) then
    raise exception 'Extraction settle claims more passes than are pending';
  end if;

  v_rank_fraction := public.cc_cache_rank_bonus_fraction(
    coalesce(p.cache_rank_spends, '{}'::jsonb), 'xp');
  v_level := p.player_level;
  v_level_xp := p.player_xp;
  v_expected := s.finalized_passes;

  for v_pass in select * from jsonb_array_elements(p_passes) loop
    v_expected := v_expected + 1;
    v_index := (v_pass ->> 'index')::integer;
    if v_index is null or v_index <> v_expected then
      raise exception 'Extraction pass index % does not continue the sequence', v_index;
    end if;
    if (v_pending -> (v_expected - s.finalized_passes - 1) ->> 'areaId')
         is distinct from (v_pass ->> 'area_id')
       or (v_pending -> (v_expected - s.finalized_passes - 1) ->> 'method')
         is distinct from (v_pass ->> 'method') then
      raise exception 'Extraction pass % does not match the pending pass on record', v_index;
    end if;
    v_draws := coalesce((v_pass ->> 'draws')::integer, 0);
    if v_draws < 0 or v_draws > 500 then
      raise exception 'Extraction pass % draws out of bounds', v_index;
    end if;

    -- Whitelist + unit bound across both find maps.
    v_units := 0;
    for v_key, v_qty in
      select key, (value)::bigint
        from jsonb_each_text(coalesce(v_pass -> 'finds_materials', '{}'::jsonb))
    loop
      if not (v_key = any (v_material_ids)) then
        raise exception 'Extraction find % is not a material', v_key;
      end if;
      if v_qty <= 0 then raise exception 'Extraction find quantity must be positive'; end if;
      v_units := v_units + v_qty;
    end loop;
    for v_key, v_qty in
      select key, (value)::bigint
        from jsonb_each_text(coalesce(v_pass -> 'finds_essences', '{}'::jsonb))
    loop
      if not (v_key = any (v_essence_ids)) then
        raise exception 'Extraction find % is not an essence', v_key;
      end if;
      if v_qty <= 0 then raise exception 'Extraction find quantity must be positive'; end if;
      v_units := v_units + v_qty;
    end loop;
    if v_units > 2 * v_draws then
      raise exception 'Extraction pass % finds exceed the per-pass unit bound', v_index;
    end if;

    -- XP priced here, sequentially, from the level sequence.
    v_xp := round(public.cc_extract_pass_xp(v_level, v_rate) * (1 + v_rank_fraction))::bigint;
    v_next := public.cc_apply_xp(v_level, v_level_xp, v_xp);
    v_level := (v_next ->> 'player_level')::integer;
    v_level_xp := (v_next ->> 'player_xp')::bigint;
    v_total_xp := v_total_xp + v_xp;

    for v_key, v_qty in
      select key, (value)::bigint
        from jsonb_each_text(coalesce(v_pass -> 'finds_materials', '{}'::jsonb))
    loop
      p.materials := public.cc_jsonb_add_int(p.materials, v_key, v_qty::integer);
      v_materials := public.cc_jsonb_add_int(v_materials, v_key, v_qty::integer);
    end loop;
    for v_key, v_qty in
      select key, (value)::bigint
        from jsonb_each_text(coalesce(v_pass -> 'finds_essences', '{}'::jsonb))
    loop
      p.essences := public.cc_jsonb_add_int(p.essences, v_key, v_qty::integer);
      v_essences := public.cc_jsonb_add_int(v_essences, v_key, v_qty::integer);
    end loop;

    perform public.cc_add_mastery_xp(actor, 'gathering.extraction', 20);
    perform public.cc_add_stat(actor, 'extraction_passes', 1);

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'index', v_index,
      'area_id', v_pass ->> 'area_id',
      'method', v_pass ->> 'method',
      'draws', v_draws,
      'gear_factor', coalesce((v_pass ->> 'gear_factor')::numeric, 0),
      'deep_degraded', coalesce((v_pass ->> 'deep_degraded')::boolean, false),
      'xp', v_xp,
      'finds_materials', coalesce(v_pass -> 'finds_materials', '{}'::jsonb),
      'finds_essences', coalesce(v_pass -> 'finds_essences', '{}'::jsonb),
      'signature_units', coalesce((v_pass ->> 'signature_units')::integer, 0)
    ));
  end loop;

  update public.extraction_state
     set pending_passes = (
           select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
             from jsonb_array_elements(v_pending) with ordinality as t(elem, ord)
            where ord > jsonb_array_length(p_passes)
         ),
         finalized_passes = s.finalized_passes + jsonb_array_length(p_passes),
         total_xp_awarded = s.total_xp_awarded + v_total_xp,
         updated_at = now()
   where user_id = actor;

  update public.profiles
     set player_level = v_level,
         player_xp = v_level_xp,
         materials = p.materials,
         essences = p.essences,
         updated_at = now()
   where id = actor;

  result := jsonb_build_object(
    'settled', true,
    'passes_completed', jsonb_array_length(p_passes),
    'xp_awarded', v_total_xp,
    'mastery_xp', 20 * jsonb_array_length(p_passes),
    'finds_materials', v_materials,
    'finds_essences', v_essences,
    'passes', v_results,
    'player_level', v_level,
    'player_xp', v_level_xp
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_apply_extraction', p_nonce, result);

  return result;
end;
$$;
-- ---------------------------------------------------------------------------
-- 7. cc_set_active_action restated (0028 body + 'extraction' +
--    the accrual hook + start gates/selection sync) and
--    cc_clear_active_action restated (0025 body + the hook).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_set_active_action(p_player_id uuid, nonce text, action_kind text, target_type text DEFAULT NULL::text, target_id text DEFAULT NULL::text, target_label text DEFAULT NULL::text, scene_key text DEFAULT NULL::text, expected_finish_at timestamp with time zone DEFAULT NULL::timestamp with time zone, notes text DEFAULT NULL::text, activity_payload jsonb DEFAULT '{}'::jsonb, public_payload jsonb DEFAULT '{}'::jsonb, public_visible boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result_row public.active_actions%rowtype;
  normalized_kind text := coalesce(nullif(trim(action_kind), ''), 'idle_standby');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  if normalized_kind not in (
    'none',
    'idle_standby',
    'roaming_loot',
    'boss_prep',
    'boss_fight',
    'crafting',
    'salvaging',
    'workshop_service',
    'market_listing',
    'endless_run',
    'extraction'
  ) then
    raise exception 'Unsupported active action: %', normalized_kind;
  end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Crafting settler hook (0024): the outgoing action settles its
  -- craft jobs before the switch, at their exact accrued values.
  perform public.cc_settle_craft_jobs(actor);

  -- Repair settler hook (0025): board jobs settle on transitions too.
  perform public.cc_settle_repair_jobs_for(actor);

  -- Extraction settler hook (0033): the outgoing action accrues
  -- its extraction time before the switch. Rolls finalize later,
  -- when the passes are settled at a read/claim (cc_apply_extraction
  -- via the Chef) — time accounting is all that happens here.
  perform public.cc_settle_extraction_time(actor);

  -- Extraction start gates + selection sync (0033): an incoming
  -- 'extraction' set claims the site. Every gate reads server
  -- records only (verified account, no standing death record,
  -- a real + unlocked area, Deep Delve mastery) — client claims
  -- about any of them are never consulted. The standing selection
  -- syncs here so the row the settler reads always names the site
  -- the player chose; the in-progress pass keeps its own terms.
  if normalized_kind = 'extraction' then
    if not public.can_use_player_economy(actor) then
      raise exception 'Verified account required';
    end if;
    if exists (
      select 1 from public.profiles p
      where p.id = actor and coalesce(p.death_state, '{}'::jsonb) <> '{}'::jsonb
    ) then
      raise exception 'Character is dead — resurrect before extracting';
    end if;
    if nullif(target_id, '') is null or not exists (
      select 1 from public.roaming_areas ra where ra.id = target_id
    ) then
      raise exception 'Unknown extraction area';
    end if;
    if (select coalesce(ra.unlock_level, 1) from public.roaming_areas ra where ra.id = target_id)
       > (select coalesce(p.player_level, 1) from public.profiles p where p.id = actor) then
      raise exception 'Area locked for this hunter level';
    end if;
    if coalesce(nullif(activity_payload ->> 'method', ''), 'surface') not in ('surface', 'deep') then
      raise exception 'Unsupported extraction method';
    end if;
    if coalesce(nullif(activity_payload ->> 'method', ''), 'surface') = 'deep'
       and public.cc_player_mastery_level(actor, 'gathering.extraction') < 5 then
      raise exception 'Deep Delve requires Extraction mastery 5';
    end if;
    insert into public.extraction_state (user_id, area_id, method, last_settled_at)
    values (actor, target_id, coalesce(nullif(activity_payload ->> 'method', ''), 'surface'), now())
    on conflict (user_id) do update set
      area_id = excluded.area_id,
      method = excluded.method,
      updated_at = now();
  end if;

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    normalized_kind,
    now(),
    expected_finish_at,
    nullif(target_type, ''),
    nullif(target_id, ''),
    nullif(target_label, ''),
    nullif(scene_key, ''),
    nullif(notes, ''),
    coalesce(activity_payload, '{}'::jsonb),
    coalesce(public_payload, '{}'::jsonb),
    now(),
    coalesce(public_visible, true),
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = excluded.active_action,
    started_at = excluded.started_at,
    completes_at = excluded.completes_at,
    target_type = excluded.target_type,
    target_id = excluded.target_id,
    target_label = excluded.target_label,
    scene_key = excluded.scene_key,
    notes = excluded.notes,
    activity_payload = excluded.activity_payload,
    public_payload = excluded.public_payload,
    last_heartbeat_at = excluded.last_heartbeat_at,
    public_visible = excluded.public_visible,
    schema_version = excluded.schema_version,
    updated_at = excluded.updated_at
  returning * into result_row;

  prior := jsonb_build_object(
    'action_type', 'cc_set_active_action',
    'activity', public.cc_active_action_snapshot(result_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_set_active_action', nonce, prior);

  return prior;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_clear_active_action(p_player_id uuid, nonce text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result_row public.active_actions%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Crafting settler hook (0024), same as cc_set_active_action.
  perform public.cc_settle_craft_jobs(actor);

  -- Repair settler hook (0025), same as cc_set_active_action.
  perform public.cc_settle_repair_jobs_for(actor);

  -- Extraction settler hook (0033), same as cc_set_active_action.
  perform public.cc_settle_extraction_time(actor);

  insert into public.active_actions as aa (
    user_id,
    active_action,
    started_at,
    completes_at,
    target_type,
    target_id,
    target_label,
    scene_key,
    notes,
    activity_payload,
    public_payload,
    last_heartbeat_at,
    public_visible,
    schema_version,
    updated_at
  ) values (
    actor,
    'idle_standby',
    now(),
    null,
    null,
    null,
    null,
    null,
    null,
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    true,
    1,
    now()
  )
  on conflict (user_id) do update set
    active_action = 'idle_standby',
    started_at = now(),
    completes_at = null,
    target_type = null,
    target_id = null,
    target_label = null,
    scene_key = null,
    notes = null,
    activity_payload = '{}'::jsonb,
    public_payload = '{}'::jsonb,
    last_heartbeat_at = now(),
    public_visible = true,
    schema_version = 1,
    updated_at = now()
  returning * into result_row;

  prior := jsonb_build_object(
    'action_type', 'cc_clear_active_action',
    'activity', public.cc_active_action_snapshot(result_row)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_clear_active_action', nonce, prior);

  return prior;
end;
$function$;
-- ---------------------------------------------------------------------------
-- 8. cc_compute_economy_metrics restated (0032 body + the three
--    extraction meters: passes + XP fold the cc_apply_extraction
--    ledger payloads; materials_minted_extraction aggregates the
--    per-id finds across finds_materials and finds_essences — the
--    id spaces are disjoint — mirroring how
--    materials_destroyed_crafting aggregates crafting's escrow).
-- ---------------------------------------------------------------------------

create or replace function public.cc_compute_economy_metrics(_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := (_day::timestamp) at time zone 'UTC';
  v_end timestamptz := ((_day + 1)::timestamp) at time zone 'UTC';
  m record;
  v_minted_total bigint;
  v_destroyed_total bigint;
  cj record;
  rj record;
  er record;
begin
  select
    -- Mints -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_apply_chef_rewards'), 0) as minted_roaming,
    coalesce(sum(
      case when coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)
        then coalesce((result_payload -> 'attempt' ->> 'creditsGained')::bigint, 0)
           + coalesce((result_payload ->> 'entry_fee')::bigint, 0)
        else 0 end)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as minted_boss,
    coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
      filter (where action_type = 'cc_settle_offline_roaming'), 0) as minted_offline,
    (coalesce(sum((result_payload -> 'rewards' ->> 'credits')::bigint)
        filter (where action_type = 'cc_idle_claim'), 0)
     + coalesce(sum((result_payload -> 'rewards' ->> 'credits_awarded')::bigint)
        filter (where action_type = 'cc_claim_roaming_rewards'), 0)
     + 5000 * count(*) filter (where action_type = 'cc_initial_bundle')
     + coalesce(sum((result_payload -> 'market_fee' ->> 'cache_rank_proceeds_bonus')::bigint)
        filter (where action_type = 'cc_accept_listing'), 0)
    ) as minted_other,
    -- Sinks -----------------------------------------------------------------
    coalesce(sum((result_payload -> 'market_fee' ->> 'fee_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as destroyed_market_fees,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_vendor_buy'), 0) as destroyed_vendor,
    coalesce(sum((result_payload ->> 'creditsCharged')::bigint)
      filter (where action_type = 'cc_resurrect'), 0) as destroyed_resurrection,
    coalesce(sum((result_payload ->> 'total_price')::bigint)
      filter (where action_type = 'cc_retrain'), 0) as destroyed_respec,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_apply_boss_attempt'), 0) as destroyed_boss_entry_fees,
    coalesce(sum(greatest(0,
        coalesce((result_payload -> 'attempt' ->> 'creditsLost')::bigint, 0)
        - coalesce((result_payload ->> 'entry_fee')::bigint, 0)))
      filter (where action_type = 'cc_apply_boss_attempt'
        and not coalesce((result_payload -> 'attempt' ->> 'victory')::boolean, false)),
      0) as destroyed_boss_death_fees,
    -- Market ----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_market_create') as market_listings_created,
    count(*) filter (where action_type = 'cc_accept_listing') as market_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'), 0) as market_volume,
    -- Crafted market sales (0024) -------------------------------------------
    count(*) filter (where action_type = 'cc_accept_listing'
      and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
        or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')) as crafted_sales,
    coalesce(sum((result_payload -> 'listing' ->> 'price_credits')::bigint)
      filter (where action_type = 'cc_accept_listing'
        and (result_payload -> 'listing' ->> 'batch_origin' = 'crafted'
          or result_payload -> 'item' -> 'payload' ->> 'origin' = 'crafted')), 0) as crafted_volume,
    -- Cache -----------------------------------------------------------------
    count(*) filter (where action_type = 'cc_claim_rewarded_cache_key') as cache_keys_from_ads,
    count(*) filter (where action_type in ('cc_make_item', 'cc_draw_item')) as cache_opens,
    coalesce(sum((result_payload -> 'rewards' ->> 'cache_fragments_awarded')::bigint)
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded,
    -- Legendary salvage + cores (0026): destroyed legendaries are a
    -- LEDGER fact (the recycle result carries the consumed item) —
    -- distinct from legendaries_minted_by_source above, which counts
    -- item_instances at creation. No double counting: creation and
    -- destruction are separate meters by design.
    count(*) filter (where action_type = 'cc_recycle_item'
      and result_payload -> 'item' ->> 'rarity' = 'Legendary') as legendaries_salvaged,
    coalesce(sum((result_payload ->> 'cores_award')::bigint)
      filter (where action_type = 'cc_recycle_item'), 0) as legendary_cores_minted,
    -- Cache Rank (0031): token meters — counted from the grant /
    -- spend ledger payloads (tokens are not credits; these never
    -- enter the minted/destroyed credit totals).
    coalesce(sum((result_payload ->> 'tokens_granted')::bigint)
      filter (where action_type = 'cc_cache_rank_grant'), 0) as cache_rank_tokens_granted,
    coalesce(sum((result_payload ->> 'cost')::bigint)
      filter (where action_type = 'cc_cache_rank_spend'), 0) as cache_rank_tokens_spent,
    (coalesce(sum((result_payload -> 'job' ->> 'escrow_cores')::bigint)
        filter (where action_type = 'cc_enqueue_craft_job'), 0)
     - coalesce(sum((result_payload ->> 'cores_refunded')::bigint)
        filter (where action_type = 'cc_cancel_craft_job'), 0)
     -- Reforge (0027): cores destroyed outright extend the spent
     -- meter — each destroyed core is counted exactly once, here;
     -- the dedicated column below breaks the reforge share out.
     + coalesce(sum((result_payload ->> 'cores_charged')::bigint)
        filter (where action_type = 'cc_reforge_item'), 0)) as legendary_cores_spent,
    -- Reforge meters (0027): completions, scrap destroyed, cores
    -- destroyed — all ledger facts from cc_reforge_item results.
    count(*) filter (where action_type = 'cc_reforge_item') as reforges_completed,
    coalesce(sum((result_payload ->> 'scrap_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as scrap_destroyed_reforge,
    coalesce(sum((result_payload ->> 'cores_charged')::bigint)
      filter (where action_type = 'cc_reforge_item'), 0) as legendary_cores_destroyed_reforge,
    -- Endless meters (0028): runs, encounters, fees, payouts — all
    -- ledger facts from the three endless appliers' result payloads.
    -- Run-end payouts appear on cc_end_endless_run (bank), on
    -- cc_apply_endless_encounter (death / depth-cap bank), and as
    -- abandoned_settlement inside cc_start_endless_run.
    count(*) filter (where action_type = 'cc_start_endless_run') as endless_runs_started,
    (count(*) filter (where action_type = 'cc_end_endless_run'
        and coalesce((result_payload ->> 'ended')::boolean, false))
     + count(*) filter (where action_type = 'cc_apply_endless_encounter'
        and result_payload ->> 'run_status' in ('died', 'banked'))
     + count(*) filter (where action_type = 'cc_start_endless_run'
        and result_payload -> 'abandoned_settlement' is not null
        and result_payload -> 'abandoned_settlement' <> 'null'::jsonb)) as endless_runs_ended,
    count(*) filter (where action_type = 'cc_apply_endless_encounter'
      and coalesce((result_payload ->> 'victory')::boolean, false)) as endless_encounters_cleared,
    coalesce(sum((result_payload ->> 'entry_fee')::bigint)
      filter (where action_type = 'cc_start_endless_run'), 0) as endless_fees_destroyed,
    (coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'credits')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_credits_paid,
    (coalesce(sum((result_payload -> 'payout' ->> 'xp')::bigint)
        filter (where action_type in ('cc_end_endless_run', 'cc_apply_endless_encounter')), 0)
     + coalesce(sum((result_payload -> 'abandoned_settlement' -> 'payout' ->> 'xp')::bigint)
        filter (where action_type = 'cc_start_endless_run'), 0)) as endless_xp_paid,
    -- Action skill fires (0030): counted from the appliers' recorded
    -- action_skill blocks; the workshop fire's own ledger rows are
    -- Fixer fires. Firing moves no currency — these are pure counts.
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Gunslinger') as action_skill_fires_gunslinger,
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Demolition') as action_skill_fires_demolition,
    count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
      and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
      and result_payload -> 'action_skill' ->> 'tree' = 'Scavenger') as action_skill_fires_scavenger,
    (count(*) filter (where action_type in ('cc_apply_boss_attempt', 'cc_apply_endless_encounter')
        and coalesce((result_payload -> 'action_skill' ->> 'fired')::boolean, false)
        and result_payload -> 'action_skill' ->> 'tree' = 'Fixer')
     + count(*) filter (where action_type = 'cc_fire_overclock_workshop')) as action_skill_fires_fixer,
    -- Dispatch meters (0032): foot + courier settle payouts — real
    -- mints from the cc_dispatch_settle ledger payloads (recalls
    -- included: a pro-rata payout is still a payout). The courier
    -- column is the premium family's breakout of the same fold.
    coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
      filter (where action_type = 'cc_dispatch_settle'
        and result_payload ->> 'family' = 'foot'), 0) as minted_dispatch,
    coalesce(sum((result_payload -> 'payout' ->> 'credits')::bigint)
      filter (where action_type = 'cc_dispatch_settle'
        and result_payload ->> 'family' = 'courier'), 0) as minted_courier,
    coalesce(sum((result_payload ->> 'passes_completed')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0) as extraction_passes,
    coalesce(sum((result_payload ->> 'xp_awarded')::bigint)
      filter (where action_type = 'cc_apply_extraction'), 0) as extraction_xp
  into m
  from public.verified_action_ledger
  where created_at >= v_start and created_at < v_end;

  -- Craft job meters (0024): jobs_completed is a job-level fact
  -- (status + completed_at); units / XP / refined output are counted
  -- per OUTPUT at the unit's settle-day stamp, across jobs of ANY
  -- status — units produced inside a job that is later cancelled (or
  -- still running at day's end) are real production and real XP.
  select
    (select count(*) from public.craft_jobs j
      where j.status = 'complete'
        and j.completed_at >= v_start and j.completed_at < v_end) as jobs_completed,
    count(*)::integer as units_completed,
    coalesce(sum((o ->> 'xp')::bigint), 0)::bigint as xp_awarded,
    coalesce(sum((o ->> 'outputQuantity')::integer)
      filter (where o ->> 'kind' = 'refine'), 0)::integer as refined_units
  into cj
  from public.craft_jobs j,
       lateral jsonb_array_elements(j.outputs) o
  where (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
    and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint;

  -- Repair meters (0025): job-level facts from service_jobs at
  -- their terminal day (posted counted at posting day); self-repair
  -- kit consumption counted per completed repair UNIT output, the
  -- same settle-day stamp the craft meters use.
  select
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.created_at >= v_start and j.created_at < v_end) as jobs_posted,
    (select count(*) from public.service_jobs j
      where j.profession_id = 'repair' and j.status = 'completed'
        and j.completed_at >= v_start and j.completed_at < v_end)::integer as jobs_completed,
    (select coalesce(sum(j.points_restored), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled')) as points_restored,
    (select coalesce(sum(j.paid_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as credits_volume,
    (select coalesce(sum(j.fee_credits), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as fees_destroyed,
    (select coalesce(sum(j.xp_awarded), 0) from public.service_jobs j
      where j.profession_id = 'repair'
        and j.completed_at >= v_start and j.completed_at < v_end
        and j.status in ('completed', 'cancelled'))::bigint as xp_awarded,
    ((select coalesce(sum(jsonb_array_length(j.kits_consumed)), 0)
        from public.service_jobs j
       where j.profession_id = 'repair'
         and j.completed_at >= v_start and j.completed_at < v_end
         and j.status in ('completed', 'cancelled'))
     + (select count(*) from public.craft_jobs j,
              lateral jsonb_array_elements(j.outputs) o
         where o ->> 'kind' = 'repair'
           and (o ->> 'completedAtMs')::bigint >= (extract(epoch from v_start) * 1000)::bigint
           and (o ->> 'completedAtMs')::bigint < (extract(epoch from v_end) * 1000)::bigint))::integer as kits_consumed
  into rj;

  -- Endless depth + milestone facts (0028): deepest run ENDED today
  -- (bank, death, cap, or carried-out abandonment — each ending is a
  -- ledger fact on its own row), and milestone drops by rarity from
  -- the encounter payloads that recorded them.
  select
    (select coalesce(max(d), 0)::integer from (
       select (result_payload ->> 'depth_reached')::integer as d
         from public.verified_action_ledger
        where action_type = 'cc_end_endless_run'
          and coalesce((result_payload ->> 'ended')::boolean, false)
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload ->> 'depth')::integer
         from public.verified_action_ledger
        where action_type = 'cc_apply_endless_encounter'
          and result_payload ->> 'run_status' in ('died', 'banked')
          and created_at >= v_start and created_at < v_end
       union all
       select (result_payload -> 'abandoned_settlement' ->> 'depth_reached')::integer
         from public.verified_action_ledger
        where action_type = 'cc_start_endless_run'
          and result_payload -> 'abandoned_settlement' is not null
          and result_payload -> 'abandoned_settlement' <> 'null'::jsonb
          and created_at >= v_start and created_at < v_end
     ) depths) as deepest_depth,
    (select count(*)::integer
       from public.verified_action_ledger
      where action_type = 'cc_apply_endless_encounter'
        and created_at >= v_start and created_at < v_end
        and result_payload -> 'milestone_drop' ->> 'rarity' is not null) as milestone_drops,
    (select coalesce(jsonb_object_agg(g.rarity, g.cnt), '{}'::jsonb)
       from (
         select result_payload -> 'milestone_drop' ->> 'rarity' as rarity,
                count(*)::integer as cnt
           from public.verified_action_ledger
          where action_type = 'cc_apply_endless_encounter'
            and created_at >= v_start and created_at < v_end
            and result_payload -> 'milestone_drop' ->> 'rarity' is not null
          group by 1
       ) g) as milestone_by_rarity
  into er;

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other
    + m.endless_credits_paid + m.minted_dispatch + m.minted_courier;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees
    + rj.fees_destroyed + m.endless_fees_destroyed;

  insert into public.economy_metrics (
    day,
    credits_minted_roaming, credits_minted_boss, credits_minted_offline,
    credits_minted_other, credits_minted_total,
    credits_destroyed_market_fees, credits_destroyed_vendor,
    credits_destroyed_resurrection, credits_destroyed_respec,
    credits_destroyed_boss_entry_fees, credits_destroyed_boss_death_fees,
    credits_destroyed_total, net_credit_change,
    legendaries_roaming, legendaries_boss, legendaries_cache, legendaries_total,
    market_listings_created, market_sales, market_volume,
    market_median_price, market_median_by_rarity,
    cache_keys_from_ads, cache_opens, cache_fragments_awarded,
    craft_jobs_completed, craft_units_completed, craft_xp_awarded,
    materials_destroyed_crafting, refined_units_produced,
    gear_items_crafted, crafted_market_sales, crafted_market_volume,
    repair_jobs_posted, repair_jobs_completed, repair_points_restored,
    repair_credits_volume, repair_fees_destroyed, repair_kits_consumed,
    repair_xp_awarded,
    legendaries_salvaged, legendary_cores_minted, legendary_cores_spent,
    reforges_completed, scrap_destroyed_reforge, legendary_cores_destroyed_reforge,
    endless_runs_started, endless_runs_ended, endless_encounters_cleared,
    endless_deepest_depth, endless_credits_paid, endless_xp_paid,
    endless_fees_destroyed, endless_milestone_drops,
    endless_milestone_drops_by_rarity,
    action_skill_fires_gunslinger, action_skill_fires_demolition,
    action_skill_fires_scavenger, action_skill_fires_fixer,
    cache_rank_tokens_granted, cache_rank_tokens_spent,
    credits_minted_dispatch, credits_minted_courier,
    extraction_passes, extraction_xp_awarded, materials_minted_extraction,
    computed_at
  )
  select
    _day,
    m.minted_roaming, m.minted_boss, m.minted_offline, m.minted_other,
    v_minted_total,
    m.destroyed_market_fees, m.destroyed_vendor, m.destroyed_resurrection,
    m.destroyed_respec, m.destroyed_boss_entry_fees, m.destroyed_boss_death_fees,
    v_destroyed_total, v_minted_total - v_destroyed_total,
    leg.roaming, leg.boss, leg.cache, leg.roaming + leg.boss + leg.cache,
    m.market_listings_created, m.market_sales, m.market_volume,
    (select percentile_cont(0.5) within group (
        order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric)
       from public.verified_action_ledger l
      where l.action_type = 'cc_accept_listing'
        and l.created_at >= v_start and l.created_at < v_end),
    (select coalesce(jsonb_object_agg(g.rarity, g.median), '{}'::jsonb)
       from (
         select l.result_payload -> 'item' ->> 'rarity' as rarity,
                percentile_cont(0.5) within group (
                  order by (l.result_payload -> 'listing' ->> 'price_credits')::numeric) as median
           from public.verified_action_ledger l
          where l.action_type = 'cc_accept_listing'
            and l.created_at >= v_start and l.created_at < v_end
            and l.result_payload -> 'item' ->> 'rarity' is not null
          group by 1
       ) g),
    m.cache_keys_from_ads, m.cache_opens, m.cache_fragments_awarded,
    cj.jobs_completed, cj.units_completed, cj.xp_awarded,
    (select coalesce(jsonb_object_agg(key, net), '{}'::jsonb)
       from (
         select d.key, sum(d.delta) as net
           from (
             select e.key as key, (e.value)::bigint as delta
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, (e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'job' -> 'escrow_catalyst', '{}'::jsonb)) as e
              where l.action_type = 'cc_enqueue_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
             union all
             select e.key, -(e.value)::bigint
               from public.verified_action_ledger l,
                    jsonb_each_text(coalesce(l.result_payload -> 'refunded_inputs', '{}'::jsonb)) as e
              where l.action_type = 'cc_cancel_craft_job'
                and l.created_at >= v_start and l.created_at < v_end
           ) d
          group by d.key
         having sum(d.delta) > 0
       ) nets),
    cj.refined_units,
    (select count(*)::integer from public.item_instances
      where payload ->> 'origin' = 'crafted'
        and created_at >= v_start and created_at < v_end),
    m.crafted_sales, m.crafted_volume,
    rj.jobs_posted, rj.jobs_completed, rj.points_restored,
    rj.credits_volume, rj.fees_destroyed, rj.kits_consumed,
    rj.xp_awarded,
    m.legendaries_salvaged, m.legendary_cores_minted, m.legendary_cores_spent,
    m.reforges_completed, m.scrap_destroyed_reforge, m.legendary_cores_destroyed_reforge,
    m.endless_runs_started, m.endless_runs_ended, m.endless_encounters_cleared,
    er.deepest_depth, m.endless_credits_paid, m.endless_xp_paid,
    m.endless_fees_destroyed, er.milestone_drops,
    er.milestone_by_rarity,
    m.action_skill_fires_gunslinger, m.action_skill_fires_demolition,
    m.action_skill_fires_scavenger, m.action_skill_fires_fixer,
    m.cache_rank_tokens_granted, m.cache_rank_tokens_spent,
    m.minted_dispatch, m.minted_courier,
    m.extraction_passes::integer, m.extraction_xp,
    (select coalesce(jsonb_object_agg(key, total), '{}'::jsonb)
       from (
         select f.key, sum((f.value)::bigint) as total
           from public.verified_action_ledger l,
                jsonb_each_text(
                  coalesce(l.result_payload -> 'finds_materials', '{}'::jsonb)
                  || coalesce(l.result_payload -> 'finds_essences', '{}'::jsonb)) as f
          where l.action_type = 'cc_apply_extraction'
            and l.created_at >= v_start and l.created_at < v_end
          group by f.key
         having sum((f.value)::bigint) > 0
       ) minted),
    now()
  from (
    select
      count(*) filter (where payload ->> 'sourceTag' = 'World Drop') as roaming,
      count(*) filter (where payload ->> 'sourceTag' = 'Boss Drop') as boss,
      count(*) filter (where payload ->> 'sourceTag' = 'Cache-Forged') as cache
    from public.item_instances
    where rarity = 'Legendary' and created_at >= v_start and created_at < v_end
  ) leg
  on conflict (day) do update set
    credits_minted_roaming = excluded.credits_minted_roaming,
    credits_minted_boss = excluded.credits_minted_boss,
    credits_minted_offline = excluded.credits_minted_offline,
    credits_minted_other = excluded.credits_minted_other,
    credits_minted_total = excluded.credits_minted_total,
    credits_destroyed_market_fees = excluded.credits_destroyed_market_fees,
    credits_destroyed_vendor = excluded.credits_destroyed_vendor,
    credits_destroyed_resurrection = excluded.credits_destroyed_resurrection,
    credits_destroyed_respec = excluded.credits_destroyed_respec,
    credits_destroyed_boss_entry_fees = excluded.credits_destroyed_boss_entry_fees,
    credits_destroyed_boss_death_fees = excluded.credits_destroyed_boss_death_fees,
    credits_destroyed_total = excluded.credits_destroyed_total,
    net_credit_change = excluded.net_credit_change,
    legendaries_roaming = excluded.legendaries_roaming,
    legendaries_boss = excluded.legendaries_boss,
    legendaries_cache = excluded.legendaries_cache,
    legendaries_total = excluded.legendaries_total,
    market_listings_created = excluded.market_listings_created,
    market_sales = excluded.market_sales,
    market_volume = excluded.market_volume,
    market_median_price = excluded.market_median_price,
    market_median_by_rarity = excluded.market_median_by_rarity,
    cache_keys_from_ads = excluded.cache_keys_from_ads,
    cache_opens = excluded.cache_opens,
    cache_fragments_awarded = excluded.cache_fragments_awarded,
    craft_jobs_completed = excluded.craft_jobs_completed,
    craft_units_completed = excluded.craft_units_completed,
    craft_xp_awarded = excluded.craft_xp_awarded,
    materials_destroyed_crafting = excluded.materials_destroyed_crafting,
    refined_units_produced = excluded.refined_units_produced,
    gear_items_crafted = excluded.gear_items_crafted,
    crafted_market_sales = excluded.crafted_market_sales,
    crafted_market_volume = excluded.crafted_market_volume,
    repair_jobs_posted = excluded.repair_jobs_posted,
    repair_jobs_completed = excluded.repair_jobs_completed,
    repair_points_restored = excluded.repair_points_restored,
    repair_credits_volume = excluded.repair_credits_volume,
    repair_fees_destroyed = excluded.repair_fees_destroyed,
    repair_kits_consumed = excluded.repair_kits_consumed,
    repair_xp_awarded = excluded.repair_xp_awarded,
    legendaries_salvaged = excluded.legendaries_salvaged,
    legendary_cores_minted = excluded.legendary_cores_minted,
    legendary_cores_spent = excluded.legendary_cores_spent,
    reforges_completed = excluded.reforges_completed,
    scrap_destroyed_reforge = excluded.scrap_destroyed_reforge,
    legendary_cores_destroyed_reforge = excluded.legendary_cores_destroyed_reforge,
    endless_runs_started = excluded.endless_runs_started,
    endless_runs_ended = excluded.endless_runs_ended,
    endless_encounters_cleared = excluded.endless_encounters_cleared,
    endless_deepest_depth = excluded.endless_deepest_depth,
    endless_credits_paid = excluded.endless_credits_paid,
    endless_xp_paid = excluded.endless_xp_paid,
    endless_fees_destroyed = excluded.endless_fees_destroyed,
    endless_milestone_drops = excluded.endless_milestone_drops,
    endless_milestone_drops_by_rarity = excluded.endless_milestone_drops_by_rarity,
    action_skill_fires_gunslinger = excluded.action_skill_fires_gunslinger,
    action_skill_fires_demolition = excluded.action_skill_fires_demolition,
    action_skill_fires_scavenger = excluded.action_skill_fires_scavenger,
    action_skill_fires_fixer = excluded.action_skill_fires_fixer,
    cache_rank_tokens_granted = excluded.cache_rank_tokens_granted,
    cache_rank_tokens_spent = excluded.cache_rank_tokens_spent,
    credits_minted_dispatch = excluded.credits_minted_dispatch,
    credits_minted_courier = excluded.credits_minted_courier,
    extraction_passes = excluded.extraction_passes,
    extraction_xp_awarded = excluded.extraction_xp_awarded,
    materials_minted_extraction = excluded.materials_minted_extraction,
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;$$;
