-- 0097 — Cache Hunters: data & progression plumbing (reshape slice (a)).
--
-- Owner-ruled 2026-11-14 (brief: cybercache-prep/cache-hunters/
-- APPROVAL-BRIEF.md §4 slice (a); checks A1–A6). The reshape
-- partitions exactly two things — skill spends and loadout
-- assignments. This migration is ADDITIVE:
--
--   * profiles.active_hunter_id — the fielded hunter ('vesper' |
--     'silas' | 'josie' | 'doc'), seeded from the account's current
--     action_skill_selection (the conversion rule, brief §2.2: the
--     selection names the default active hunter), else 'vesper'.
--   * profiles.hunter_loadouts — per-hunter loadout assignments
--     (3 weapon slots, shield/ordnance/class-mod/relic picks, belt
--     picks, equipped-vehicle choice), seeded for the active hunter
--     from the physically equipped set. The arsenal stays ONE shared
--     pool; assignments never move ownership.
--   * skill_node_definitions rows for the growth branches + the
--     Demolition parity top-up (brief §2.1) — consumed keys only
--     (zero-dead-keys law); the TS twins live in
--     src/constants/skillTrees.ts.
--   * skill_spends SHAPE IS UNCHANGED. Existing spends convert by
--     re-reading the map per tree (zero node-id changes, A1): every
--     derivation now reads the ACTIVE hunter's subset.
--
-- Restated functions (verbatim bodies from their current homes with
-- the marked changes only):
--   * cc_profile_snapshot (from 0083): + active_hunter_id,
--     hunter_loadouts keys.
--   * cc_train_skill (from 0089): the budget check is PER-POOL
--     (spends in the node's own tree <= level - 1).
--   * cc_retrain (from 0094): respec is PER-HUNTER — prices and
--     zeroes only the active hunter's subset (A3).
--   * cc_equip_item (from 0054): class-mod binding — a mod equips
--     only on its tree's hunter, refused with the reason (A5); plus
--     the hunter_loadouts assignment sync.
--   * cc_unequip_slot (from 0021): assignment sync only.
--   * cc_dispatch_depart (from 0068): "spare" now means spare
--     across ALL hunters' loadouts (an assigned item is not spare;
--     an in_service item stays refused as before).
-- New:
--   * cc_set_active_hunter: the switch — saves the outgoing hunter's
--     equipped set as their assignment, equips the incoming hunter's
--     assignment (owned + available only; a mismatched class mod is
--     skipped and its assignment cleared), collapses
--     action_skill_selection to the incoming hunter's tree (the
--     shared charge pool is untouched).
--   * Helpers: cc_hunter_tree / cc_hunter_for_tree /
--     cc_hunter_name_for_tree / cc_profile_active_hunter /
--     cc_profile_active_tree / cc_skill_spends_for_tree /
--     cc_item_in_any_hunter_loadout / cc_sync_active_hunter_loadout.
--
-- Canonical HP (A6): nothing here touches HP inputs — Cache Rank /
-- Thick Skin stay account-level on the one canonical pool.

alter table public.profiles
  add column if not exists active_hunter_id text,
  add column if not exists hunter_loadouts jsonb not null default '{}'::jsonb;

-- Conversion seed 1: the default active hunter comes from the
-- account's current action_skill_selection (brief §2.2).
update public.profiles
   set active_hunter_id = case action_skill_selection
     when 'Demolition' then 'silas'
     when 'Scavenger' then 'josie'
     when 'Fixer' then 'doc'
     else 'vesper'
   end
 where active_hunter_id is null;

-- ─── Helpers ────────────────────────────────────────────────────────

create or replace function public.cc_hunter_tree(hunter_id text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case hunter_id
    when 'silas' then 'Demolition'
    when 'josie' then 'Scavenger'
    when 'doc' then 'Fixer'
    else 'Gunslinger'
  end;
$function$;

create or replace function public.cc_hunter_for_tree(tree_name text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case tree_name
    when 'Demolition' then 'silas'
    when 'Scavenger' then 'josie'
    when 'Fixer' then 'doc'
    else 'vesper'
  end;
$function$;

create or replace function public.cc_hunter_name_for_tree(tree_name text)
 returns text
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case tree_name
    when 'Demolition' then 'Silas Boone'
    when 'Scavenger' then 'Josie Lode'
    when 'Fixer' then 'Doc Sutter'
    when 'Gunslinger' then 'Vesper Cole'
    else tree_name
  end;
$function$;

create or replace function public.cc_profile_active_hunter(profile_row public.profiles)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select case
    when profile_row.active_hunter_id in ('vesper','silas','josie','doc')
      then profile_row.active_hunter_id
    else public.cc_hunter_for_tree(profile_row.action_skill_selection)
  end;
$function$;

create or replace function public.cc_profile_active_tree(profile_row public.profiles)
 returns text
 language sql
 stable
 set search_path to 'public'
as $function$
  select public.cc_hunter_tree(public.cc_profile_active_hunter(profile_row));
$function$;

-- The per-tree subset of a spend map — a hunter's pool (A1/A2). Node
-- ids are never changed by the reshape; the subset is a pure filter
-- over skill_node_definitions.tree.
create or replace function public.cc_skill_spends_for_tree(skill_state jsonb, tree_name text)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select coalesce((
    select jsonb_object_agg(e.key, e.value)
      from jsonb_each(coalesce(skill_state, '{}'::jsonb)) e
      join public.skill_node_definitions d on d.id = e.key
     where d.tree = tree_name
  ), '{}'::jsonb);
$function$;

-- True when an item id is assigned in ANY hunter's loadout (the
-- Dispatch spare test, and the in_service cross-hunter guard's
-- assignment half).
create or replace function public.cc_item_in_any_hunter_loadout(loadouts jsonb, item_id uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select exists (
    select 1
      from jsonb_each(coalesce(loadouts, '{}'::jsonb)) h,
           jsonb_each(h.value) s
     where s.key in ('primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle')
       and s.value = to_jsonb(item_id::text)
  );
$function$;

-- Write the physically equipped snapshot as the active hunter's
-- stored assignment, preserving that hunter's belt picks.
create or replace function public.cc_sync_active_hunter_loadout(loadouts jsonb, hunter_id text, snapshot jsonb)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select jsonb_set(
    coalesce(loadouts, '{}'::jsonb),
    array[hunter_id],
    snapshot || jsonb_build_object('belt', coalesce(
      loadouts -> hunter_id -> 'belt',
      '{"PreFight":null,"MidFight":null,"Emergency":null}'::jsonb
    )),
    true
  );
$function$;

-- Conversion seed 2: the active hunter's assignment starts as the
-- physically equipped set (cc_loadout_snapshot's slot map + an empty
-- belt). Runs after the helpers above; only touches profiles whose
-- assignment map is still empty.
update public.profiles pr
   set hunter_loadouts = jsonb_build_object(
     pr.active_hunter_id,
     public.cc_loadout_snapshot(pr.id) || '{"belt":{"PreFight":null,"MidFight":null,"Emergency":null}}'::jsonb
   )
 where coalesce(pr.hunter_loadouts, '{}'::jsonb) = '{}'::jsonb;

-- ─── Growth branches + Demolition parity top-up (brief §2.1) ───────
-- Node definitions for the new TS nodes in src/constants/skillTrees
-- .ts. Consumed keys only. on conflict do nothing (idempotent).

insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_status_2', 'Gunslinger', 5, 3, 'Tracer Loads', '+5% Status Chance', 'small', 5, 1, '{"statusChance":0.05}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_shield_2', 'Gunslinger', 6, 3, 'Breaching Loads', '+5% Shield Damage', 'small', 5, 1, '{"shieldDamageMod":0.05}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_speed_3', 'Gunslinger', 4, 3, 'Fast Hands', '+8% Attack Speed', 'small', 5, 1, '{"attackSpeed":0.08}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_speed_4', 'Gunslinger', 3, 3, 'Hair Trigger', '+8% Attack Speed', 'small', 5, 1, '{"attackSpeed":0.08}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('gs_major_5', 'Gunslinger', 8, 3, 'The Long Hunt', '+15% Shield Damage and +10% Status Chance — the roaming hunter’s edge.', 'major', 1, 3, '{"shieldDamageMod":0.15,"statusChance":0.1}'::jsonb, ARRAY['gs_status_2','gs_shield_2']::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_shield_2', 'Demolition', 6, 2, 'Ion Cascade', '+10% Shield Break Contribution from Ordnance', 'small', 5, 1, '{"ordnanceShieldBreak":0.1}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_cons_1', 'Demolition', 1, 3, 'Field Kitchen', 'Workshop craft jobs run faster: −2% unit time per point (server-side, snapshotted at enqueue).', 'small', 5, 1, '{"consumableEfficiency":0.04}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_cons_2', 'Demolition', 2, 3, 'Powder Stores', 'Workshop craft jobs run faster: −2% unit time per point (server-side, snapshotted at enqueue).', 'small', 5, 1, '{"consumableEfficiency":0.04}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_cons_3', 'Demolition', 3, 3, 'Grease and Wicks', 'Workshop craft jobs run faster: −2% unit time per point (server-side, snapshotted at enqueue).', 'small', 5, 1, '{"consumableEfficiency":0.04}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_cons_4', 'Demolition', 4, 3, 'Spares Cache', 'Workshop craft jobs run faster: −2% unit time per point (server-side, snapshotted at enqueue).', 'small', 5, 1, '{"consumableEfficiency":0.04}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('demo_cons_5', 'Demolition', 5, 3, 'Forward Stockpile', 'Workshop craft jobs run faster: −2% unit time per point (server-side, snapshotted at enqueue).', 'small', 5, 1, '{"consumableEfficiency":0.04}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_wpn_1', 'Scavenger', 1, 3, 'Borrowed Caliber', '+5% Weapon Damage', 'small', 5, 1, '{"weaponDamage":0.05}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_wpn_2', 'Scavenger', 2, 3, 'Found Ammunition', '+5% Weapon Damage', 'small', 5, 1, '{"weaponDamage":0.05}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_crit_1', 'Scavenger', 3, 3, 'Opportunist', '+3% Crit Chance', 'small', 5, 1, '{"critChance":0.03}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_crit_2', 'Scavenger', 4, 3, 'Cheap Shot', '+3% Crit Chance', 'small', 5, 1, '{"critChance":0.03}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('scav_critdmg_1', 'Scavenger', 5, 3, 'Soft Spot', '+10% Crit Damage', 'small', 5, 1, '{"critDamage":0.1}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_ord_1', 'Fixer', 1, 3, 'Proof Loads', '+10% Ordnance Damage', 'small', 5, 1, '{"ordnanceDamage":0.1}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_ord_2', 'Fixer', 2, 3, 'Bench-Tested', '+10% Ordnance Damage', 'small', 5, 1, '{"ordnanceDamage":0.1}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_exp_1', 'Fixer', 3, 3, 'Measured Charge', '+8% Explosive Damage', 'small', 5, 1, '{"explosiveDamage":0.08}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_armor_1', 'Fixer', 4, 3, 'Stress Points', '+10% Armor Damage', 'small', 5, 1, '{"armorDamageMod":0.1}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_stag_1', 'Fixer', 5, 3, 'Loose Bolts', '+5% Stagger Chance', 'small', 5, 1, '{"staggerChance":0.05}'::jsonb, ARRAY[]::text[], '2026-11-14T00:00:00.000Z'::timestamptz) on conflict do nothing;

-- ─── cc_profile_snapshot (restated from 0083, +0097 keys) ────

CREATE OR REPLACE FUNCTION public.cc_profile_snapshot(profile_row profiles)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'id', profile_row.id,
    'player_level', profile_row.player_level,
    'player_xp', profile_row.player_xp,
    'credits', profile_row.credits,
    'scrap', coalesce((profile_row.materials ->> 'Scrap')::bigint, 0),
    'cache_tokens', profile_row.cache_tokens,
    'cache_key_remainder', coalesce(profile_row.cache_key_remainder, 0),
    'legendary_cores', coalesce(profile_row.legendary_cores, 0),
    'materials', profile_row.materials,
    'essences', profile_row.essences,
    'consumables', profile_row.consumables,
    'consumable_batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', b.id,
        'consumable_type', b.consumable_type,
        'quality_percent', b.quality_percent,
        'quantity', b.quantity,
        'origin', b.origin,
        'creator_user_id', b.creator_user_id,
        'source_recipe_id', b.source_recipe_id,
        'metadata', b.metadata,
        'created_at', b.created_at,
        'updated_at', b.updated_at
      ) order by b.consumable_type, b.quality_percent desc, b.created_at)
      from public.consumable_batches b
      where b.owner_user_id = profile_row.id and b.quantity > 0
    ), '[]'::jsonb),
    'vehicle_fuel', profile_row.vehicle_fuel,
    'skill_spends', profile_row.skill_spends,
    'action_skill_charge', coalesce(profile_row.action_skill_charge, 0),
    'action_skill_selection', profile_row.action_skill_selection,
    'active_hunter_id', profile_row.active_hunter_id,
    'hunter_loadouts', coalesce(profile_row.hunter_loadouts, '{}'::jsonb),
    'cache_rank_tokens', coalesce(profile_row.cache_rank_tokens, 0),
    'cache_rank_grant_level', coalesce(profile_row.cache_rank_grant_level, 0),
    'cache_rank_spends', coalesce(profile_row.cache_rank_spends, '{}'::jsonb),
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at,
    -- 0083: the held (unpaid) offline settlement, so the Home
    -- OFFLINE button and the Return Sheet read server truth — the
    -- same one-row subquery shape as consumable_batches above; the
    -- zeros object is the no-hold shape.
    'offline_hold', coalesce((
      select jsonb_build_object(
        'credits', oh.credits,
        'scrap', oh.scrap,
        'xp', oh.xp,
        'cache_keys', oh.cache_keys,
        'kills', oh.kills,
        'ticks', oh.ticks,
        'materials', oh.materials,
        'essences', oh.essences,
        'item_count', jsonb_array_length(oh.items),
        'elapsed_ms', oh.elapsed_ms,
        'area_id', oh.area_id
      )
      from public.offline_settlement_holds oh
      where oh.player_id = profile_row.id
    ), jsonb_build_object(
      'credits', 0, 'scrap', 0, 'xp', 0, 'cache_keys', 0, 'kills', 0,
      'ticks', 0, 'materials', '{}'::jsonb, 'essences', '{}'::jsonb,
      'item_count', 0, 'elapsed_ms', 0, 'area_id', null
    ))
  );
$function$;

-- ─── cc_train_skill (restated from 0089, per-pool budget) ────

CREATE OR REPLACE FUNCTION public.cc_train_skill(p_player_id uuid, nonce text, node_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  node public.skill_node_definitions%rowtype;
  next_spends jsonb;
  current_node_points integer;
  next_node_points integer;
  total_after integer;
  budget integer;
  result jsonb;
  clean_node_id text := nullif(trim(coalesce(node_id, '')), '');
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if clean_node_id is null then raise exception 'node_id is required'; end if;

  -- Idempotency: a retry with the same nonce returns the prior payload.
  select result_payload into prior
    from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  -- Serialize per-actor mutations to avoid races on skill_spends.
  perform pg_advisory_xact_lock(hashtext(actor::text));

  -- Lock the profile row + look up the node definition in one shot.
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into node from public.skill_node_definitions where id = clean_node_id;
  if not found then raise exception 'Unknown skill node'; end if;

  -- Per-node cap: cannot exceed the node's own max_points.
  current_node_points := coalesce((p.skill_spends ->> clean_node_id)::integer, 0);
  if current_node_points >= node.max_points then
    raise exception 'Skill node % is already maxed', clean_node_id;
  end if;
  next_node_points := current_node_points + 1;

  -- Prerequisite chain: every requires[] entry must have at least 1 point.
  declare
    missing text[];
  begin
    select array_agg(req) into missing
      from unnest(node.requires) as req
     where coalesce((p.skill_spends ->> req)::integer, 0) = 0;
    if missing is not null and array_length(missing, 1) > 0 then
      raise exception 'Missing prerequisites: %', array_to_string(missing, ', ');
    end if;
  end;

  -- Total budget (reshape slice (a), 0097): PER-POOL — the points
  -- spent in the node's OWN tree must remain <= player_level - 1.
  -- Each hunter holds at most (level - 1) in their tree; pools never
  -- stack because only one hunter is fielded at a time.
  total_after := public.cc_skill_spend_cost(public.cc_skill_spends_for_tree(p.skill_spends, node.tree)) + node.per_point_cost;
  budget := greatest(0, p.player_level - 1);
  if total_after > budget then
    raise exception 'Insufficient skill points: have %, need %', budget, total_after;
  end if;

  -- Apply the increment. jsonb_set with create_missing=true handles the
  -- first-ever spend on a node cleanly.
  next_spends := jsonb_set(
    p.skill_spends,
    array[clean_node_id],
    to_jsonb(next_node_points),
    true
  );

  update public.profiles
     set skill_spends = next_spends
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_train_skill',
    'profile', public.cc_profile_snapshot(p),
    'node_id', clean_node_id,
    'node_points', next_node_points,
    'total_spent', public.cc_skill_spend_cost(public.cc_skill_spends_for_tree(p.skill_spends, node.tree))
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_train_skill', nonce, result);
  return result;
end;
$function$;

-- ─── cc_retrain (restated from 0094, per-hunter respec) ────

CREATE OR REPLACE FUNCTION public.cc_retrain(p_player_id uuid, nonce text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  cost bigint;
  v_tree text;
  v_pool jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Respec is PER-HUNTER (reshape slice (a), 0097): the pool is the
  -- ACTIVE hunter's subset of the spend map; only that subset is
  -- priced and zeroed — the other hunters' builds are untouched.
  v_tree := public.cc_profile_active_tree(p);
  v_pool := public.cc_skill_spends_for_tree(p.skill_spends, v_tree);

  -- Zero-spend guard (audit HTR-07), per-hunter: refuse before the
  -- ledger write so a no-op retrain records nothing.
  if public.cc_skill_spend_total(v_pool) = 0 then raise exception 'Nothing to respec'; end if;

  cost := public.cc_skill_spend_cost(v_pool) * 100;
  if p.credits < cost then raise exception 'Insufficient credits'; end if;

  update public.profiles
     set credits = credits - cost,
         skill_spends = coalesce((
           select jsonb_object_agg(e.key, e.value)
             from jsonb_each(p.skill_spends) e
            where not (v_pool ? e.key)
         ), '{}'::jsonb)
   where id = actor returning * into p;

  result := jsonb_build_object('action_type', 'cc_retrain', 'profile', public.cc_profile_snapshot(p), 'total_price', cost);
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_retrain', nonce, result);
  return result;
end;
$function$;

-- ─── cc_equip_item (restated from 0054, +class-mod binding, +assignment sync) ────

CREATE OR REPLACE FUNCTION public.cc_equip_item(p_player_id uuid, nonce text, item_id uuid, slot_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  cleared_items jsonb := '[]'::jsonb;
  result jsonb;
  vehicle_unlock integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slot_name not in ('primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle') then raise exception 'Invalid slot'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.runtime_state in ('listed','consumed','salvaged','in_service') then raise exception 'Item state invalid'; end if;
  if not public.cc_item_accepts_slot(coalesce(item.payload, '{}'::jsonb), slot_name) then raise exception 'Item type does not match loadout slot'; end if;

  -- Class-mod binding (reshape slice (a), 0097): a class mod equips
  -- only on the hunter whose tree it boosts. The refusal names the
  -- owning hunter — every "no" carries its remedy.
  if slot_name = 'classMod' then
    declare
      mod_tree text := item.payload ->> 'treeBonus';
      active_tree text := public.cc_profile_active_tree(p);
    begin
      if mod_tree is not null and mod_tree <> active_tree then
        raise exception 'Class mod is bound to % (%) — field % to equip it',
          public.cc_hunter_name_for_tree(mod_tree), mod_tree, public.cc_hunter_name_for_tree(mod_tree);
      end if;
    end;
  end if;

  if slot_name = 'vehicle' then
    -- Owner ruling 2026-11-02: no player-level gate on equip —
    -- ownership is the gate. The class must still resolve (payload
    -- integrity); the ladder value itself is no longer read here.
    vehicle_unlock := public.cc_vehicle_unlock_level(item.payload ->> 'vehicleClassId');
    if vehicle_unlock is null then raise exception 'Unknown vehicle class'; end if;
  end if;

  with cleared as (
    update public.item_instances
    set equipped_slot = null,
        runtime_state = case when is_locked then 'locked' else 'available' end
    where owner_user_id = actor
      and equipped_slot = slot_name
      and id <> item.id
    returning *
  )
  select coalesce(jsonb_agg(to_jsonb(cleared)), '[]'::jsonb) into cleared_items from cleared;

  update public.item_instances
  set equipped_slot = slot_name,
      runtime_state = 'equipped'
  where id = item.id
  returning * into item;

-- Assignment sync (0097): the physically equipped set IS the
  -- active hunter's loadout assignment — keep hunter_loadouts
  -- mirroring it (belt picks preserved from the stored assignment).
  update public.profiles
     set hunter_loadouts = public.cc_sync_active_hunter_loadout(p.hunter_loadouts, public.cc_profile_active_hunter(p), public.cc_loadout_snapshot(actor))
   where id = actor;

  result := jsonb_build_object(
    'action_type', 'cc_equip_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'items', cleared_items || jsonb_build_array(to_jsonb(item)),
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_equip_item', nonce, result);
  return result;
end;
$function$;

-- ─── cc_unequip_slot (restated from 0021, +assignment sync) ────

CREATE OR REPLACE FUNCTION public.cc_unequip_slot(p_player_id uuid, nonce text, slot_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if slot_name not in ('primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle') then raise exception 'Invalid slot'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;

  update public.item_instances
  set equipped_slot = null,
      runtime_state = case when is_locked then 'locked' else 'available' end
  where owner_user_id = actor and equipped_slot = slot_name
  returning * into item;

-- Assignment sync (0097): the physically equipped set IS the
  -- active hunter's loadout assignment — keep hunter_loadouts
  -- mirroring it (belt picks preserved from the stored assignment).
  update public.profiles
     set hunter_loadouts = public.cc_sync_active_hunter_loadout(p.hunter_loadouts, public.cc_profile_active_hunter(p), public.cc_loadout_snapshot(actor))
   where id = actor;

  result := jsonb_build_object(
    'action_type', 'cc_unequip_slot',
    'profile', public.cc_profile_snapshot(p),
    'item', case when item.id is null then null else to_jsonb(item) end,
    'slot_name', slot_name,
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_unequip_slot', nonce, result);
  return result;
end;
$function$;
-- ─── cc_set_active_hunter (new) ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.cc_set_active_hunter(p_player_id uuid, nonce text, p_hunter_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  result jsonb;
  v_hunter text := nullif(trim(coalesce(p_hunter_id, '')), '');
  v_current text;
  v_loadouts jsonb;
  v_incoming jsonb;
  rec record;
  v_item public.item_instances%rowtype;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if v_hunter is null or v_hunter not in ('vesper','silas','josie','doc') then raise exception 'Unknown hunter'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  v_current := public.cc_profile_active_hunter(p);
  v_loadouts := coalesce(p.hunter_loadouts, '{}'::jsonb);

  if v_current <> v_hunter then
    -- Save the outgoing hunter's physically equipped set as their
    -- assignment (belt preserved from the stored assignment).
    v_loadouts := jsonb_set(v_loadouts, array[v_current],
      public.cc_loadout_snapshot(actor) || jsonb_build_object('belt',
        coalesce(v_loadouts -> v_current -> 'belt', '{"PreFight":null,"MidFight":null,"Emergency":null}'::jsonb)), true);

    update public.item_instances
       set equipped_slot = null,
           runtime_state = case when is_locked then 'locked' else 'available' end
     where owner_user_id = actor and runtime_state = 'equipped';

    -- Equip the incoming hunter's assignment: owned + available
    -- items only. A class mod bound to another hunter is skipped
    -- (and its assignment cleared by the re-read below) — it stays
    -- in the shared pool, usable when its hunter is fielded.
    v_incoming := coalesce(v_loadouts -> v_hunter, '{}'::jsonb);
    for rec in
      select key as slot, value as item_id
        from jsonb_each_text(v_incoming)
       where key in ('primary','secondary','heavy','ordnance','shield','classMod','relic','vehicle')
    loop
      if rec.item_id is null then continue; end if;
      select * into v_item from public.item_instances
       where id = rec.item_id::uuid and owner_user_id = actor for update;
      if not found then continue; end if;
      if v_item.runtime_state not in ('available','locked') then continue; end if;
      if rec.slot = 'classMod'
         and coalesce(v_item.payload ->> 'treeBonus', '') <> ''
         and (v_item.payload ->> 'treeBonus') <> public.cc_hunter_tree(v_hunter) then
        continue;
      end if;
      update public.item_instances
         set equipped_slot = rec.slot, runtime_state = 'equipped'
       where id = v_item.id;
    end loop;

    -- The stored assignment re-reads as what actually equipped.
    v_loadouts := jsonb_set(v_loadouts, array[v_hunter],
      public.cc_loadout_snapshot(actor) || jsonb_build_object('belt',
        coalesce(v_incoming -> 'belt', '{"PreFight":null,"MidFight":null,"Emergency":null}'::jsonb)), true);
  end if;

  -- The selection collapses to the active hunter's signature tree;
  -- the shared charge pool is untouched (brief §2.5).
  update public.profiles
     set active_hunter_id = v_hunter,
         hunter_loadouts = v_loadouts,
         action_skill_selection = public.cc_hunter_tree(v_hunter)
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_set_active_hunter',
    'active_hunter_id', v_hunter,
    'profile', public.cc_profile_snapshot(p),
    'loadout', public.cc_loadout_snapshot(actor)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_set_active_hunter', nonce, result);
  return result;
end;
$function$;

-- ─── cc_dispatch_depart (restated from 0068, spare across all hunters' loadouts) ────

create or replace function public.cc_dispatch_depart(p_player_id uuid, nonce text, p_terms jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  v_family text := p_terms ->> 'family';
  v_duration integer := (p_terms ->> 'duration_hours')::integer;
  v_item_ids uuid[];
  v_item public.item_instances%rowtype;
  v_vehicle public.item_instances%rowtype;
  v_slots integer;
  v_active_count integer;
  v_mission public.dispatch_missions%rowtype;
  result jsonb;
  v_offer_id text := p_terms ->> 'offer_id';
  v_today text;
  v_board_index integer;
  v_offer_pattern text;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if p_terms is null then raise exception 'Dispatch terms are required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  if v_family not in ('foot', 'courier') then raise exception 'Unknown dispatch family'; end if;
  if v_duration not in (2, 8, 24) then raise exception 'Invalid dispatch duration'; end if;
  if coalesce((p_terms ->> 'payout_credits')::bigint, -1) not between 0 and 10000000
     or coalesce((p_terms ->> 'payout_scrap')::bigint, -1) not between 0 and 1000000
     or coalesce((p_terms ->> 'payout_material_units')::integer, -1) not between 0 and 10000 then
    raise exception 'Dispatch payout snapshot out of bounds';
  end if;

  -- Board discipline (0068, economy brief §7.3): the offer must be
  -- on the player's CURRENT board for today (the stored state reads
  -- lazily — a stale day key means board 0), and an offer id already
  -- departed today stays departed (the id is the consumption unit).
  -- The id pattern is the board's address: board 0 is
  -- d<YYYYMMDD>-<0..5>, board n is d<YYYYMMDD>-r<n>-<0..5>; the
  -- route additionally recomputes the board's terms from the
  -- content owner, so a pattern-valid forgery still cannot price.
  v_today := to_char((now() at time zone 'UTC'), 'YYYY-MM-DD');
  v_board_index := case when p.dispatch_board_day = v_today
                        then coalesce(p.dispatch_board_index, 0) else 0 end;
  v_offer_pattern := '^d' || replace(v_today, '-', '')
    || case when v_board_index = 0 then '-[0-5]$'
            else '-r' || v_board_index::text || '-[0-5]$' end;
  if v_offer_id is null or v_offer_id !~ v_offer_pattern then
    raise exception 'Dispatch offer is not on the current board';
  end if;
  if exists (select 1 from public.dispatch_missions
              where user_id = actor and offer_id = v_offer_id) then
    raise exception 'Dispatch offer already departed';
  end if;

  -- One shared queue pool (foot + courier), sized by the lever.
  v_slots := greatest(1, least(8, coalesce(
    public.cc_economy_config_number('dispatchQueueSlots', 2), 2)::integer));
  select count(*) into v_active_count from public.dispatch_missions
   where user_id = actor and status = 'active';
  if v_active_count >= v_slots then raise exception 'Dispatch queue full'; end if;

  if v_family = 'foot' then
    select coalesce(array_agg(x::uuid), '{}') into v_item_ids
      from jsonb_array_elements_text(coalesce(p_terms -> 'loadout_item_ids', '[]'::jsonb)) x;
    if coalesce(array_length(v_item_ids, 1), 0) not between 1 and 8 then
      raise exception 'Dispatch loadout must carry 1 to 8 items';
    end if;
    -- Every committed item: owned, available, unequipped, not a
    -- vehicle. Lock the set into in_service for the duration.
    for v_item in
      select * from public.item_instances where id = any(v_item_ids) and owner_user_id = actor for update
    loop
      if v_item.runtime_state <> 'available' or v_item.equipped_slot is not null
         or public.cc_item_in_any_hunter_loadout(p.hunter_loadouts, v_item.id) then
        raise exception 'Dispatch item is not spare: %', v_item.id;
      end if;
      if v_item.kind = 'vehicle' then
        raise exception 'Vehicles ride courier contracts, not foot loadouts';
      end if;
    end loop;
    if (select count(*) from public.item_instances where id = any(v_item_ids) and owner_user_id = actor)
       <> coalesce(array_length(v_item_ids, 1), 0) then
      raise exception 'Dispatch item not found';
    end if;
    update public.item_instances
       set runtime_state = 'in_service', is_locked = true, updated_at = now()
     where id = any(v_item_ids) and owner_user_id = actor;
  else
    -- Courier: the vehicle does the work. Gate reads the VEHICLE's
    -- class tier (courier brief §2.1), never the player's level:
    -- tier index of the vehicle's class against the tier's anchor
    -- (gate-removal step 5 — the capability carrier that replaced
    -- the class ladder's unlockLevel values 1 / 18 / 42).
    select * into v_vehicle from public.item_instances
     where id = (p_terms ->> 'vehicle_item_id')::uuid and owner_user_id = actor for update;
    if not found then raise exception 'Courier vehicle not found'; end if;
    if v_vehicle.kind <> 'vehicle' then raise exception 'Courier assignment is not a vehicle'; end if;
    if v_vehicle.runtime_state <> 'available' or v_vehicle.equipped_slot is not null
       or public.cc_item_in_any_hunter_loadout(p.hunter_loadouts, v_vehicle.id) then
      raise exception 'Courier vehicle is not spare';
    end if;
    if (v_vehicle.payload ->> 'vehicleClassId') is distinct from (p_terms ->> 'vehicle_class_id') then
      raise exception 'Courier vehicle class mismatch';
    end if;
    if coalesce(public.cc_vehicle_class_tier(v_vehicle.payload ->> 'vehicleClassId'), -1)
       < (case v_duration when 2 then 0 when 8 then 2 when 24 then 4 end) then
      raise exception 'Vehicle class cannot run this courier tier';
    end if;
    -- Fuel is charged in full at departure; never partially.
    if coalesce(p.vehicle_fuel, 0) < coalesce((p_terms ->> 'fuel_charged_units')::numeric, 0) then
      raise exception 'Insufficient vehicle fuel';
    end if;
    update public.profiles
       set vehicle_fuel = vehicle_fuel - coalesce((p_terms ->> 'fuel_charged_units')::numeric, 0),
           updated_at = now()
     where id = actor
     returning * into p;
    update public.item_instances
       set runtime_state = 'in_service', is_locked = true, updated_at = now()
     where id = v_vehicle.id;
  end if;

  insert into public.dispatch_missions (
    user_id, contract_family, offer_id, seed, destination_area_id, duration_hours,
    loadout_item_ids, loadout_strength,
    payout_credits, payout_scrap, payout_material_id, payout_material_units,
    vehicle_item_id, vehicle_class_id, route_ticks, fuel_charged_units,
    condition_at_departure, wear_projected, breakdown_fraction,
    cargo_bonus_units, premium_multiplier,
    departed_at, ends_at
  ) values (
    actor, v_family, p_terms ->> 'offer_id', coalesce(p_terms ->> 'seed', ''),
    p_terms ->> 'area_id', v_duration,
    case when v_family = 'foot' then v_item_ids else '{}' end,
    coalesce((p_terms ->> 'loadout_strength')::numeric, 0),
    coalesce((p_terms ->> 'payout_credits')::bigint, 0),
    coalesce((p_terms ->> 'payout_scrap')::bigint, 0),
    p_terms ->> 'payout_material_id',
    coalesce((p_terms ->> 'payout_material_units')::integer, 0),
    case when v_family = 'courier' then v_vehicle.id else null end,
    case when v_family = 'courier' then p_terms ->> 'vehicle_class_id' else null end,
    case when v_family = 'courier' then (p_terms ->> 'route_ticks')::integer else null end,
    case when v_family = 'courier' then coalesce((p_terms ->> 'fuel_charged_units')::numeric, 0) else 0 end,
    case when v_family = 'courier' then (p_terms ->> 'condition_at_departure')::numeric else null end,
    case when v_family = 'courier' then (p_terms ->> 'wear_projected')::numeric else null end,
    case when v_family = 'courier' then (p_terms ->> 'breakdown_fraction')::numeric else null end,
    coalesce((p_terms ->> 'cargo_bonus_units')::integer, 0),
    case when v_family = 'courier' then (p_terms ->> 'premium_multiplier')::numeric else null end,
    now(), now() + make_interval(hours => v_duration)
  ) returning * into v_mission;

  result := jsonb_build_object(
    'action_type', 'cc_dispatch_depart',
    'mission', to_jsonb(v_mission),
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_dispatch_depart', nonce, result);
  return result;
end;
$function$;

-- ─── Twin-parity gates (0097): direct skill_spends point reads ─────
-- The functions below are restated verbatim from their latest bodies
-- (cc_recycle_item: 0069; cc_accept_listing / cc_quickbuy_fill: 0087)
-- with ONE change each: skill terms that belong to a hunter's pool
-- pay only while that hunter is the profile's fielded hunter — the
-- same gate the TS twins apply through computeHunterSkillBonuses.
-- (The cc_skill_effective_points service-term chain — craft/repair/
-- vendor snapshots — keeps reading its own tree's points in this
-- slice; its TS twins are gated, and the SQL chain gate is the named
-- follow-up. Class-mod boosts in SQL can only arrive via the equipped
-- mod, which cc_equip_item now binds to the fielded hunter.)

create or replace function public.cc_recycle_item(p_player_id uuid, nonce text, item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  award integer;
  mod_payload jsonb;
  hoarder_pts numeric := 0;
  keystone_pts numeric := 0;
  salvage_bonus numeric := 0;
  low_rarity_bonus numeric := 0;
  material_chance numeric := 0;
  skill_mult numeric := 1;
  bonus_material text := null;
  cores integer := 0;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.is_locked then raise exception 'Locked item'; end if;
  if item.runtime_state not in ('available','equipped') then raise exception 'Item state invalid'; end if;

  select * into p from public.profiles where id = actor;

  -- Salvage skill bonuses (0022): effective points for the two
  -- Scavenger salvage nodes from the player's own records — the
  -- equipped gear whose payload carries treeBonus is the class mod
  -- (mirrors classModBoostsFromGear).
  select payload into mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  hoarder_pts := coalesce((p.skill_spends ->> 'scav_major_1')::numeric, 0)
               + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_major_1')::numeric, 0);
  keystone_pts := coalesce((p.skill_spends ->> 'scav_keystone')::numeric, 0)
                + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_keystone')::numeric, 0);
  if mod_payload ->> 'treeBonus' = 'Scavenger' then
    hoarder_pts := least(1::numeric, hoarder_pts + 1);
    keystone_pts := least(1::numeric, keystone_pts + 1);
  end if;
  -- Reshape slice (a) (0097): Hoarder's Instinct / King of Scrap are
  -- Josie Lode's pool — the points pay only while she is fielded.
  if public.cc_profile_active_tree(p) <> 'Scavenger' then
    hoarder_pts := 0;
    keystone_pts := 0;
  end if;
  salvage_bonus := 0.25 * hoarder_pts;
  low_rarity_bonus := 1.0 * keystone_pts;
  material_chance := 0.25 * keystone_pts;

  award := public.cc_salvage_scrap(item.rarity, item.item_level);

  -- Legendary Honesty (0008): Market Crash — this weapon's scrap value
  -- is 4x normal when recycled. The weapon payload is the full item
  -- JSON stored by cc_store_chef_items, which carries legendaryEffectId
  -- for Chef-generated (boss-drop) weapons.
  if item.payload ->> 'legendaryEffectId' = 'market_crash' then
    award := award * 4;
  end if;

  -- Skill multipliers stack on the post-legendary award, rounded
  -- once (cc_salvage_scrap's own rounding convention).
  skill_mult := (1 + salvage_bonus);
  if item.rarity in ('Common', 'Uncommon') then
    skill_mult := skill_mult * (1 + low_rarity_bonus);
  end if;
  award := round(award * skill_mult)::integer;

  -- Legendary cores (0026): salvaging a Legendary also mints cores.
  -- The formula mirrors legendaryCoreYieldFor in
  -- src/content/collections.ts (parity-tested): 1 base, +1 at item
  -- level 25, +1 at item level 50, +1 for a weapon carrying a
  -- legendary effect. Deliberately NOT scaled by the scrap
  -- multipliers above (Market Crash 4x, Hoarder's Haul, King of
  -- Scrap): those are scrap economy; cores stay scarce by design.
  if item.rarity = 'Legendary' then
    cores := 1
      + case when coalesce(item.item_level, 1) >= 25 then 1 else 0 end
      + case when coalesce(item.item_level, 1) >= 50 then 1 else 0 end
      + case when item.kind = 'weapon'
                  and nullif(item.payload ->> 'legendaryEffectId', '') is not null
             then 1 else 0 end;
  end if;

  -- King of Scrap: a salvaged Common can yield a bonus crafting
  -- material, mapped from the item kind (salvageRules convention).
  if item.rarity = 'Common' and material_chance > 0 and random() < material_chance then
    bonus_material := case item.kind
      when 'weapon' then 'BallisticParts'
      when 'shield' then 'ReactiveComponents'
      when 'ordnance' then 'ReactiveComponents'
      when 'classMod' then 'TechFragments'
      when 'relic' then 'TechFragments'
      else 'Scrap'
    end;
  end if;

  update public.item_instances
  set runtime_state = 'consumed', tradeable = false, equipped_slot = null
  where id = item.id
  returning * into item;

  -- Cosmetics (0053): a part salvaged while worn leaves the
  -- selection record in the same transaction (no dangling equip).
  if item.kind = 'cosmetic' then
    update public.player_skin_selection
       set equipped = equipped - (item.payload ->> 'slot'), updated_at = now()
     where user_id = actor
       and equipped ->> (item.payload ->> 'slot') = item.id::text;
  end if;

  -- 0069: the salvage award lands in the unified materials stock
  -- (a separate update so the cores/bonus leg below stays verbatim).
  update public.profiles
  set materials = jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}', to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0) + award), true)
  where id = actor;

  update public.profiles
  set legendary_cores = legendary_cores + cores,
      materials = case when bonus_material is not null then
        jsonb_set(coalesce(materials, '{}'::jsonb), array[bonus_material], to_jsonb(coalesce((materials ->> bonus_material)::integer, 0) + 1), true)
      else materials end
  where id = actor
  returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_recycle_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'scrap_award', award,
    'cores_award', cores,
    'bonus_material', bonus_material,
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_recycle_item', nonce, result);

  return result;
end;
$function$;

create or replace function public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  item public.item_instances%rowtype;
  seller public.profiles%rowtype;
  mod_payload jsonb;
  darknet_pts numeric := 0;
  manip_pts numeric := 0;
  house_pts numeric := 0;
  crafted_item boolean := false;
  fee_reduction numeric := 0;
  fee_credits bigint := 0;
  proceeds_bonus bigint := 0;
  fee_rate numeric := 0.05;
  found_item boolean := false;
  delivered_batch_id uuid;
  buyer_parts integer := 0;
  buyer_tokens integer := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into listing from public.market_listings where id = listing_id for update;
  if not found or listing.status <> 'active' then raise exception 'Active listing not found'; end if;
  -- Pure player market (0081; owner ruling 2026-11-04): an NPC
  -- listing can never be accepted, whatever state the row is in.
  -- Seeded listings were retired by this same migration and the
  -- seed that created them is removed; this guard is the defense
  -- in depth for any row that somehow still exists.
  if coalesce(listing.seller_type, 'player') = 'npc'
     or listing.seller_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'NPC listings are not part of the player market';
  end if;
  if listing.seller_user_id = actor then raise exception 'Cannot accept own listing'; end if;
  if p.credits < listing.price_credits then raise exception 'Insufficient credits'; end if;

  select * into seller from public.profiles where id = listing.seller_user_id;

  if listing.listing_kind in ('gear', 'vehicle', 'cosmetic') then
    -- Market fee (0017; rate levered in 0018): derived from the
    -- seller's OWN database records inside this transaction. NPC
    -- listings (supply_mode 'npc_market') are exempt.
    select * into item from public.item_instances where id = listing.item_instance_id;
    if seller.id is not null and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      manip_pts := coalesce((seller.skill_spends ->> 'scav_major_3')::numeric, 0)
                 + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_major_3')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
        manip_pts := least(1::numeric, manip_pts + 1);
      end if;
      found_item := coalesce(item.payload ->> 'sourceTag', '') in ('World Drop', 'Boss Drop', 'Cache-Forged', 'Event')
        and not exists (
          select 1 from public.verified_action_ledger l
           where l.user_id = seller.id
             and l.action_type = 'cc_accept_listing'
             and l.result_payload -> 'item' ->> 'id' = item.id::text
        );
      -- House Brand (fix_major_3, 0029): the crafted gate is the
      -- economy metrics' crafted-sale rule — payload origin 'crafted'.
      -- Found and crafted are disjoint by the drop-source taxonomy,
      -- so this term never stacks with the Manipulator term.
      house_pts := public.cc_skill_effective_points(
        seller.skill_spends, mod_payload, 'fix_major_3', 'Fixer', 1);
      crafted_item := coalesce(item.payload ->> 'origin', '') = 'crafted';
      -- Reshape slice (a) (0097): the fee levers belong to the
      -- seller's fielded hunter — Darknet Broker / Market Manipulator
      -- are Josie Lode's pool, House Brand is Doc Sutter's.
      if public.cc_profile_active_tree(seller) <> 'Scavenger' then
        darknet_pts := 0;
        manip_pts := 0;
      end if;
      if public.cc_profile_active_tree(seller) <> 'Fixer' then
        house_pts := 0;
      end if;
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when found_item then 0.15 * manip_pts else 0 end
        + case when crafted_item then 0.15 * house_pts else 0 end
        + public.cc_research_bonus_number(seller.id, 'marketFeeReduction')));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  else
    -- Consumable / material sale: same fee, Darknet Broker reduction
    -- only — stacks carry no find provenance, so the Market
    -- Manipulator term never applies. Player listings only (these
    -- kinds have no NPC source; seller_type pins it regardless).
    if seller.id is not null and coalesce(listing.seller_type, 'player') <> 'npc' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      -- House Brand (fix_major_3, 0029) applies to crafted consumable
      -- batches: batch_origin 'crafted' is the metrics crafted-sale
      -- rule. Materials carry no origin and are never crafted.
      house_pts := public.cc_skill_effective_points(
        seller.skill_spends, mod_payload, 'fix_major_3', 'Fixer', 1);
      crafted_item := coalesce(listing.batch_origin, '') = 'crafted';
      if public.cc_profile_active_tree(seller) <> 'Scavenger' then
        darknet_pts := 0;
      end if;
      if public.cc_profile_active_tree(seller) <> 'Fixer' then
        house_pts := 0;
      end if;
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when crafted_item then 0.15 * house_pts else 0 end
        + public.cc_research_bonus_number(seller.id, 'marketFeeReduction')));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  end if;

  -- Cache Rank Silver Tongue (0031; fee floor 0064): the proceeds
  -- uplift applies AFTER the fee, on the post-fee proceeds, and only
  -- where a fee branch ran (real player seller; NPC listings
  -- exempt). The uplift is CLAMPED to the fee it offsets
  -- (least(fee_credits, …)): it is a rebate of the burned fee, never
  -- a mint — seller proceeds can reach the price but never exceed
  -- it. The clamped figure is still reported as
  -- market_fee.cache_rank_proceeds_bonus and folds into
  -- credits_minted_other in cc_compute_economy_metrics, so the
  -- meter's per-sale mint never exceeds its market-fee burn.
  -- Composition order: fee rate (lever) x (1 - Darknet/Manipulator/
  -- House Brand reductions) first, then the clamped uplift.
  if (listing.listing_kind in ('gear', 'vehicle', 'cosmetic') and seller.id is not null
        and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market')
     or (listing.listing_kind not in ('gear', 'vehicle') and seller.id is not null
        and coalesce(listing.seller_type, 'player') <> 'npc') then
    proceeds_bonus := least(fee_credits, floor((listing.price_credits - fee_credits)
      * public.cc_cache_rank_bonus_fraction(seller.cache_rank_spends, 'marketProceeds'))::bigint);
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits + proceeds_bonus) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;

  -- 0087 (tuning D3/P8): the listing deposit snapshotted on the row
  -- at creation returns to the seller in full now that the listing
  -- has sold. It is scrap, not credits — it never touches the fee
  -- math above — and rows created before 0087 carry 0 and refund 0.
  if coalesce(listing.deposit_scrap, 0) > 0 then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, 'Scrap', listing.deposit_scrap::int)
     where id = listing.seller_user_id;
  end if;

  if listing.listing_kind in ('gear', 'vehicle', 'cosmetic') then
    update public.item_instances set owner_user_id = actor, runtime_state = 'available', is_locked = false, equipped_slot = null where id = listing.item_instance_id returning * into item;
  elsif listing.listing_kind = 'consumable' then
    delivered_batch_id := public.cc_add_consumable_batch(
      actor,
      listing.consumable_type,
      listing.quantity,
      listing.quality_percent,
      coalesce(listing.batch_origin, 'market'),
      listing.batch_creator_user_id,
      listing.batch_source_recipe_id,
      'market_buy',
      'Player market purchase',
      jsonb_build_object('listing_id', listing.id, 'seller_user_id', listing.seller_user_id)
    );
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, listing.quantity)
     where id = actor;
  elsif listing.listing_kind = 'material' then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, listing.material_id, listing.quantity)
     where id = actor;
  elsif listing.listing_kind = 'fragment' then
    -- Fragment delivery settles like a reward application (0050):
    -- the shards join the buyer's unescrowed cache_token_parts and
    -- the 5-to-1 auto-conversion runs immediately, so parts never
    -- sit above 4 after a purchase. (Cancels, by contrast, restore
    -- raw -- see cc_market_cancel.)
    buyer_parts := coalesce(p.cache_token_parts, 0) + listing.quantity;
    buyer_tokens := coalesce(p.cache_tokens, 0);
    while buyer_parts >= 5 loop
      buyer_parts := buyer_parts - 5;
      buyer_tokens := buyer_tokens + 1;
    end loop;
    update public.profiles
       set cache_token_parts = buyer_parts,
           cache_tokens = buyer_tokens
     where id = actor;
  elsif listing.listing_kind = 'core' then
    update public.profiles
       set legendary_cores = legendary_cores + listing.quantity
     where id = actor;
  elsif listing.listing_kind = 'essence' then
    update public.profiles
       set essences = public.cc_jsonb_add_int(essences, listing.essence_id, listing.quantity)
     where id = actor;
  end if;

  -- Re-read the buyer so the result snapshot carries the delivery.
  select * into p from public.profiles where id = actor;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'delivery', jsonb_build_object('kind', listing.listing_kind, 'quantity', listing.quantity, 'quality_percent', listing.quality_percent, 'consumable_type', listing.consumable_type, 'material_id', listing.material_id, 'essence_id', listing.essence_id, 'batch_id', delivered_batch_id), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits + proceeds_bonus, 'cache_rank_proceeds_bonus', proceeds_bonus, 'fee_rate', fee_rate, 'fee_reduction', fee_reduction, 'found_item', found_item, 'crafted_item', crafted_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;

create or replace function public.cc_quickbuy_fill(
  p_player_id uuid,
  nonce text,
  p_source text,
  p_good_kind text,
  p_good_id text,
  p_quantity integer,
  p_quoted_total bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  qty integer := greatest(1, coalesce(p_quantity, 1));
  ceiling bigint := coalesce(p_quoted_total, -1);
  v_day date := (now() at time zone 'utc')::date;
  -- market sweep state
  listing public.market_listings%rowtype;
  seller public.profiles%rowtype;
  remaining integer;
  supply integer := 0;
  plan_total bigint := 0;
  take integer;
  leg_charge bigint;
  leg record;
  take_row jsonb;
  legs jsonb := '[]'::jsonb;
  leg_rows jsonb := '[]'::jsonb;
  -- per-leg fee state (cc_accept_listing's stack branch)
  mod_payload jsonb;
  darknet_pts numeric;
  house_pts numeric;
  crafted_item boolean;
  fee_rate numeric;
  fee_reduction numeric;
  fee_credits bigint;
  proceeds_bonus bigint;
  delivered_batch_id uuid;
  -- fragment delivery accumulators (the 0050 conversion runs on the
  -- profile row exactly as cc_accept_listing's does)
  v_parts integer;
  v_tokens integer;
  -- vendor leg state
  v_unit integer;
  vendor_result jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if p_source not in ('market', 'vendor') then raise exception 'Unknown quick-buy source'; end if;
  if p_good_kind not in ('material', 'essence', 'consumable', 'fragment', 'core') then
    raise exception 'Unknown quick-buy good';
  end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- ── Vendor leg ──────────────────────────────────────────────────
  if p_source = 'vendor' then
    v_unit := public.cc_vendor_price(p_good_id, v_day);
    if v_unit is null then
      return public.cc_quickbuy_requote(actor, nonce, 'vendor_unavailable',
        p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
    end if;
    if v_unit::bigint * qty > ceiling then
      return public.cc_quickbuy_requote(actor, nonce, 'price_moved',
        p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
    end if;
    if p.credits < v_unit::bigint * qty then
      return public.cc_quickbuy_requote(actor, nonce, 'insufficient_credits',
        p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
    end if;
    -- Settle through the shipped vendor op itself: rotation, IoTD,
    -- flat-100% batches, counter grants and its ledger row are the
    -- vendor semantics by construction. It re-derives the same
    -- price inside this transaction (now() is transaction-stable),
    -- and the validations above have already guaranteed it cannot
    -- refuse on price or balance.
    vendor_result := public.cc_vendor_buy(actor, nonce || ':vendor', p_good_id, qty);
    result := jsonb_build_object(
      'action_type', 'cc_quickbuy_fill',
      'status', 'filled',
      'source', 'vendor',
      'good', jsonb_build_object('kind', p_good_kind, 'id', p_good_id),
      'quantity', qty,
      'total_charged', vendor_result -> 'total_price',
      'vendor', jsonb_build_object(
        'unit_price', vendor_result -> 'unit_price',
        'item_of_the_day', vendor_result -> 'item_of_the_day',
        'kind', vendor_result -> 'kind',
        'batch_id', vendor_result -> 'batch_id'
      ),
      'profile', vendor_result -> 'profile'
    );
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_quickbuy_fill', nonce, result);
    return result;
  end if;

  -- ── Market leg ──────────────────────────────────────────────────
  -- Plan under lock: walk the good's open stacks cheapest-unit
  -- first (own listings excluded), locking in sweep order.
  remaining := qty;
  for listing in
    select * from public.market_listings l
     where l.status = 'active'
       and l.seller_user_id <> actor
       -- Pure player market (0081): NPC listings are never sweep supply.
       and coalesce(l.seller_type, 'player') <> 'npc'
       and l.seller_user_id <> '00000000-0000-0000-0000-000000000000'::uuid
       and l.listing_kind = p_good_kind
       and (
         (p_good_kind = 'material' and l.material_id = p_good_id)
         or (p_good_kind = 'essence' and l.essence_id = p_good_id)
         or (p_good_kind = 'consumable' and l.consumable_type = p_good_id)
         or p_good_kind in ('fragment', 'core')
       )
     order by (l.price_credits::numeric / nullif(l.quantity, 0)), l.listed_at, l.id
     for update
  loop
    supply := supply + listing.quantity;
    if remaining > 0 then
      take := least(remaining, listing.quantity);
      leg_charge := case when take >= listing.quantity then listing.price_credits
                         else floor(listing.price_credits::numeric * take / listing.quantity)::bigint end;
      plan_total := plan_total + leg_charge;
      legs := legs || jsonb_build_object(
        'listing_id', listing.id,
        'take_qty', take,
        'charge', leg_charge,
        'stack_qty', listing.quantity,
        'stack_price', listing.price_credits
      );
      remaining := remaining - take;
    end if;
  end loop;

  if supply < qty then
    return public.cc_quickbuy_requote(actor, nonce, 'supply_changed',
      p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
  end if;
  if plan_total > ceiling then
    return public.cc_quickbuy_requote(actor, nonce, 'price_moved',
      p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
  end if;
  if p.credits < plan_total then
    return public.cc_quickbuy_requote(actor, nonce, 'insufficient_credits',
      p_good_kind, p_good_id, qty, public.cc_profile_snapshot(p));
  end if;

  -- Charge the buyer once, then settle leg by leg.
  update public.profiles set credits = credits - plan_total where id = actor returning * into p;
  v_parts := coalesce(p.cache_token_parts, 0);
  v_tokens := coalesce(p.cache_tokens, 0);

  for leg in select * from jsonb_to_recordset(legs) as x(listing_id uuid, take_qty integer, charge bigint, stack_qty integer, stack_price bigint)
  loop
    select * into listing from public.market_listings where id = leg.listing_id;
    select * into seller from public.profiles where id = listing.seller_user_id;

    -- Fee: cc_accept_listing's stack branch, applied to the leg's
    -- charge. Player sellers only; NPC-seeded listings are exempt,
    -- as is the Silver Tongue uplift outside a fee branch.
    fee_credits := 0;
    proceeds_bonus := 0;
    fee_rate := 0.05;
    fee_reduction := 0;
    crafted_item := coalesce(listing.batch_origin, '') = 'crafted';
    if seller.id is not null and coalesce(listing.seller_type, 'player') <> 'npc' then
      fee_rate := least(1::numeric, greatest(0::numeric,
        public.cc_economy_config_number('marketFeeRate', 0.05)));
      select payload into mod_payload from public.item_instances
       where owner_user_id = seller.id and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((seller.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      house_pts := public.cc_skill_effective_points(
        seller.skill_spends, mod_payload, 'fix_major_3', 'Fixer', 1);
      if public.cc_profile_active_tree(seller) <> 'Scavenger' then
        darknet_pts := 0;
      end if;
      if public.cc_profile_active_tree(seller) <> 'Fixer' then
        house_pts := 0;
      end if;
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when crafted_item then 0.15 * house_pts else 0 end
        + public.cc_research_bonus_number(seller.id, 'marketFeeReduction')));
      fee_credits := floor(leg.charge * fee_rate * (1 - fee_reduction))::bigint;
      -- Fee floor (0064): the Silver Tongue uplift is clamped to
      -- the leg's fee — a rebate, never a mint (see cc_accept_listing).
      proceeds_bonus := least(fee_credits, floor((leg.charge - fee_credits)
        * public.cc_cache_rank_bonus_fraction(seller.cache_rank_spends, 'marketProceeds'))::bigint);
    end if;

    update public.profiles
       set credits = credits + (leg.charge - fee_credits + proceeds_bonus)
     where id = listing.seller_user_id;

    if leg.take_qty >= listing.quantity then
      update public.market_listings set status = 'sold', sold_at = now() where id = listing.id;
      -- 0087 (tuning D3/P8): this leg CLOSES the listing, so the
      -- deposit snapshotted at creation refunds to the seller in
      -- full. Partial legs refund nothing — the deposit rides with
      -- the listing until it closes, or burns on cancel.
      if coalesce(listing.deposit_scrap, 0) > 0 then
        update public.profiles
           set materials = public.cc_jsonb_add_int(materials, 'Scrap', listing.deposit_scrap::int)
         where id = listing.seller_user_id;
      end if;
    else
      update public.market_listings
         set quantity = listing.quantity - leg.take_qty,
             price_credits = listing.price_credits - leg.charge
       where id = listing.id;
    end if;

    -- Delivery, mirroring cc_accept_listing per kind.
    delivered_batch_id := null;
    if listing.listing_kind = 'consumable' then
      delivered_batch_id := public.cc_add_consumable_batch(
        actor,
        listing.consumable_type,
        leg.take_qty,
        listing.quality_percent,
        coalesce(listing.batch_origin, 'market'),
        listing.batch_creator_user_id,
        listing.batch_source_recipe_id,
        'market_buy',
        'Player market purchase',
        jsonb_build_object('listing_id', listing.id, 'seller_user_id', listing.seller_user_id)
      );
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, leg.take_qty)
       where id = actor;
    elsif listing.listing_kind = 'material' then
      update public.profiles
         set materials = public.cc_jsonb_add_int(materials, listing.material_id, leg.take_qty)
       where id = actor;
    elsif listing.listing_kind = 'essence' then
      update public.profiles
         set essences = public.cc_jsonb_add_int(essences, listing.essence_id, leg.take_qty)
       where id = actor;
    elsif listing.listing_kind = 'fragment' then
      v_parts := v_parts + leg.take_qty;
      while v_parts >= 5 loop
        v_parts := v_parts - 5;
        v_tokens := v_tokens + 1;
      end loop;
      update public.profiles
         set cache_token_parts = v_parts, cache_tokens = v_tokens
       where id = actor;
    elsif listing.listing_kind = 'core' then
      update public.profiles
         set legendary_cores = legendary_cores + leg.take_qty
       where id = actor;
    end if;

    leg_rows := leg_rows || jsonb_build_object(
      'listing_id', listing.id,
      'take_qty', leg.take_qty,
      'charge', leg.charge,
      'fee_credits', fee_credits,
      'seller_proceeds', leg.charge - fee_credits + proceeds_bonus,
      'proceeds_bonus', proceeds_bonus,
      'fee_rate', fee_rate,
      'fee_reduction', fee_reduction,
      'crafted_item', crafted_item,
      'quality_percent', listing.quality_percent,
      'seller_kind', coalesce(listing.seller_type, 'player'),
      'batch_id', delivered_batch_id,
      'listing_snapshot', to_jsonb(listing)
    );
  end loop;

  -- Re-read the buyer so every payload carries the settled state.
  select * into p from public.profiles where id = actor;

  -- Per-leg accept rows (derived nonces): the folds and the
  -- mastery trigger read these exactly as manual accepts.
  for leg in select * from jsonb_to_recordset(leg_rows) as x(
    listing_id uuid, take_qty integer, charge bigint, fee_credits bigint,
    seller_proceeds bigint, proceeds_bonus bigint, fee_rate numeric,
    fee_reduction numeric, crafted_item boolean, quality_percent numeric,
    seller_kind text, batch_id uuid, listing_snapshot jsonb)
  loop
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_accept_listing', nonce || ':leg:' || leg.listing_id::text,
      jsonb_build_object(
        'action_type', 'cc_accept_listing',
        'profile', public.cc_profile_snapshot(p),
        'listing', leg.listing_snapshot || jsonb_build_object(
          'quantity', leg.take_qty,
          'price_credits', leg.charge,
          'status', 'sold',
          'sold_at', now()
        ),
        'item', null,
        'delivery', jsonb_build_object(
          'kind', p_good_kind,
          'quantity', leg.take_qty,
          'quality_percent', leg.quality_percent,
          'consumable_type', case when p_good_kind = 'consumable' then p_good_id else null end,
          'material_id', case when p_good_kind = 'material' then p_good_id else null end,
          'essence_id', case when p_good_kind = 'essence' then p_good_id else null end,
          'batch_id', leg.batch_id
        ),
        'market_fee', jsonb_build_object(
          'fee_credits', leg.fee_credits,
          'seller_proceeds', leg.seller_proceeds,
          'cache_rank_proceeds_bonus', leg.proceeds_bonus,
          'fee_rate', leg.fee_rate,
          'fee_reduction', leg.fee_reduction,
          'found_item', false,
          'crafted_item', leg.crafted_item
        )
      ));
  end loop;

  result := jsonb_build_object(
    'action_type', 'cc_quickbuy_fill',
    'status', 'filled',
    'source', 'market',
    'good', jsonb_build_object('kind', p_good_kind, 'id', p_good_id),
    'quantity', qty,
    'total_charged', plan_total,
    'fills', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'listing_id', (t.r ->> 'listing_id'),
               'take_qty', (t.r ->> 'take_qty')::integer,
               'charge', (t.r ->> 'charge')::bigint,
               'fee_credits', (t.r ->> 'fee_credits')::bigint,
               'seller_proceeds', (t.r ->> 'seller_proceeds')::bigint,
               'quality_percent', (t.r ->> 'quality_percent')::numeric,
               'seller_kind', (t.r ->> 'seller_kind')
             ) order by t.ord), '[]'::jsonb)
        from jsonb_array_elements(leg_rows) with ordinality as t(r, ord)
    ),
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_quickbuy_fill', nonce, result);
  return result;
end;
$function$;
