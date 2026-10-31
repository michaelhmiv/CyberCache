-- 0030_action_skills.sql
--
-- Action skills: one signature charged ability per skill tree
-- (Gunslinger / Demolition / Scavenger / Fixer), fired inside boss
-- attempts and endless encounters, plus the Fixer's Overclock
-- workshop fire (Fixer brief §3.7 — specified there, built here).
-- Content owner: src/content/actionSkills.ts.
--
-- THE MODEL
--   - profiles.action_skill_charge (numeric, 0..100) is the ONE
--     charge pool, shared by the combat fire and the workshop fire
--     (the Fixer brief fixes one pool). profiles.action_skill_selection
--     records the ONE active signature (a tree name, or null).
--   - Qualification is keystone ownership at effective points >= 1,
--     derived from the player's OWN records (profiles.skill_spends +
--     the equipped class mod) through cc_skill_effective_points
--     (0029) — the same derivation every server-side skill consumer
--     uses. A client-supplied tree is never trusted: routes pass only
--     the route-resolved tree, and every applier below re-validates
--     selection + qualification + charge under the profile row lock.
--   - Charge accrues ONLY from verified server settlements: resolved
--     boss attempts and endless encounters at the framework lever
--     rates (the firing resolution itself grants none), plus — for
--     Fixer-selected players — craft units completed and repair
--     points restored (the brief's Fixer sources). Endless run end
--     (death, cap bank, voluntary bank, carried-out abandonment)
--     resets the pool to 0; boss charge persists across attempts.
--   - Firing mints and destroys NO currency. The Scavenger surge
--     bends drop odds inside the shipped drop pipeline (metered by
--     the existing drop meters); the fire meters below count fires
--     per tree per day from the appliers' ledger payloads.
--   - Roaming claims never fire (non-goal of this slice).
--
-- All changes are old-code compatible: the two new profile columns
-- default to an empty pool / no selection, every restated applier
-- keeps its prior signature working (the new action-skill arguments
-- are trailing and defaulted), and pre-0030 code paths simply never
-- pass a tree, so they accrue nothing and fire nothing — charge state
-- only moves once the 0030 server is live.

-- ─── 1. Profile state ───────────────────────────────────────────────

alter table public.profiles
  add column if not exists action_skill_charge numeric not null default 0,
  add column if not exists action_skill_selection text;

-- ─── 2. cc_profile_snapshot restated (0026 body + action skill) ─────

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
    'scrap', profile_row.scrap,
    'cache_tokens', profile_row.cache_tokens,
    'cache_token_parts', profile_row.cache_token_parts,
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
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at
  );
$function$;

-- ─── 3. Qualification helper ────────────────────────────────────────
--
-- cc_action_skill_qualified(spends, mod_payload, tree): keystone
-- ownership for one tree, through cc_skill_effective_points — the
-- SQL twin of qualifiedActionSkillTrees in src/content/actionSkills.ts
-- (which merges through effectiveSkillPoints, the same math).

create or replace function public.cc_action_skill_qualified(
  p_spends jsonb,
  p_mod_payload jsonb,
  p_tree text
)
returns boolean
language sql
stable
set search_path = public
as $$
  select case p_tree
    when 'Gunslinger' then public.cc_skill_effective_points(p_spends, p_mod_payload, 'gs_keystone', 'Gunslinger', 1) >= 1
    when 'Demolition' then public.cc_skill_effective_points(p_spends, p_mod_payload, 'demo_keystone', 'Demolition', 1) >= 1
    when 'Scavenger' then public.cc_skill_effective_points(p_spends, p_mod_payload, 'scav_keystone', 'Scavenger', 1) >= 1
    when 'Fixer' then public.cc_skill_effective_points(p_spends, p_mod_payload, 'fix_keystone', 'Fixer', 1) >= 1
    else false
  end;
$$;

-- The equipped class mod payload, the 0022 derivation preamble every
-- consumer repeats: the equipped item whose payload carries treeBonus.
-- (Inlined per call site below, matching the house pattern.)

-- ─── 4. cc_apply_chef_boss_attempt restated (0011 body + fire) ──────
--
-- A twelfth argument, _action_skill_tree (default null): the tree the
-- route resolved from server records for a fire intent, or null for
-- an ordinary attempt. Under the row lock the applier re-validates:
-- the tree is a known signature, the profile's recorded selection
-- equals it, the keystone qualification holds (derived here from
-- spends + the equipped class mod), and the pool is full — then the
-- pool zeroes in the same transaction that persists the attempt. A
-- non-firing attempt accrues at the lever rate, capped at 100. A
-- nonce replay returns before any of this: it can never double-fire
-- or double-accrue. The 0011 eleven-argument signature is dropped
-- first so eleven-argument calls cannot resolve ambiguously.

drop function if exists public.cc_apply_chef_boss_attempt(uuid, text, bigint, boolean, bigint, bigint, jsonb, jsonb, text, bigint, bigint);

create or replace function public.cc_apply_chef_boss_attempt(
  _player_id uuid,
  _boss_id text,
  _attempt_nonce bigint,
  _victory boolean,
  _credits_delta bigint,
  _xp bigint,
  _consumables jsonb,
  _attempt jsonb,
  _unlocked_boss_id text default null,
  _scrap_delta bigint default 0,
  _entry_fee bigint default 0,
  _action_skill_tree text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  result jsonb;
  prior jsonb;
  nonce_key text;
  xp_state jsonb;
  next_level integer;
  next_xp bigint;
  next_consumables jsonb;
  con_key text;
  con_val integer;
  current_count integer;
  consumed_batches jsonb := '[]'::jsonb;
  consumed_one jsonb;
  boss_state_next jsonb;
  defeated_ids jsonb;
  unlocked_ids jsonb;
  pity_counters jsonb;
  current_pity integer;
  -- 0030: action skill charge resolution.
  v_mod_payload jsonb;
  v_charge_after numeric;
  v_charge_rate numeric := least(100, greatest(0,
    public.cc_economy_config_number('actionSkillChargePerBossAttempt', 34)));
begin
  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  nonce_key := _player_id::text || ':chef-boss:' || _boss_id || ':' || _attempt_nonce::text;
  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id
     and idempotency_key = nonce_key;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  -- 0011: entry-fee affordability guard, under the row lock. A replay
  -- returned above never reaches this — its fee was already charged.
  if coalesce(_entry_fee, 0) > 0 and p.credits < _entry_fee then
    raise exception 'Insufficient credits for boss entry fee';
  end if;

  -- 0030: action skill spend / accrue. A fire validates selection,
  -- qualification (own records only), and a full pool, then zeroes
  -- the pool; any other resolved attempt accrues at the lever rate.
  if _action_skill_tree is not null then
    if _action_skill_tree not in ('Gunslinger', 'Demolition', 'Scavenger', 'Fixer') then
      raise exception 'Unknown action skill tree: %', _action_skill_tree;
    end if;
    if coalesce(p.action_skill_selection, '') <> _action_skill_tree then
      raise exception 'Action skill selection mismatch';
    end if;
    select payload into v_mod_payload from public.item_instances
     where owner_user_id = _player_id and runtime_state = 'equipped' and payload ? 'treeBonus'
     limit 1;
    if not public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, _action_skill_tree) then
      raise exception 'Action skill not qualified for the selected tree';
    end if;
    if coalesce(p.action_skill_charge, 0) < 100 then
      raise exception 'Action skill is not charged';
    end if;
    v_charge_after := 0;
  else
    v_charge_after := least(100, coalesce(p.action_skill_charge, 0) + v_charge_rate);
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, greatest(_xp, 0));
  next_level := (xp_state ->> 'player_level')::integer;
  next_xp := (xp_state ->> 'player_xp')::bigint;

  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for con_key, con_val in select key, value::integer from jsonb_each_text(coalesce(_consumables, '{}'::jsonb)) loop
    current_count := coalesce((next_consumables ->> con_key)::integer, 0);
    if current_count < con_val then raise exception 'Insufficient consumable quantity for %', con_key; end if;

    if not exists (select 1 from public.consumable_batches where owner_user_id = _player_id and consumable_type = con_key and quantity > 0) then
      perform public.cc_add_consumable_batch(_player_id, con_key, current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before boss consumption', '{}'::jsonb);
    end if;

    consumed_one := public.cc_consume_consumable_batch(_player_id, con_key, con_val, 'boss', 'Boss attempt consumption', jsonb_build_object('boss_id', _boss_id, 'attempt_nonce', _attempt_nonce));
    consumed_batches := consumed_batches || jsonb_build_array(consumed_one);
    next_consumables := jsonb_set(next_consumables, array[con_key], to_jsonb(greatest(current_count - con_val, 0)), true);
  end loop;

  boss_state_next := coalesce(p.boss_state, '{}'::jsonb);
  defeated_ids := coalesce(boss_state_next -> 'defeatedBossIds', '[]'::jsonb);
  unlocked_ids := coalesce(boss_state_next -> 'unlockedBossIds', '["dune_tyrant"]'::jsonb);
  pity_counters := coalesce(boss_state_next -> 'pityCounters', '{}'::jsonb);
  current_pity := coalesce((pity_counters ->> _boss_id)::integer, 0);

  if _victory then
    if not defeated_ids ? _boss_id then defeated_ids := defeated_ids || to_jsonb(_boss_id); end if;
    if _unlocked_boss_id is not null and not unlocked_ids ? _unlocked_boss_id then unlocked_ids := unlocked_ids || to_jsonb(_unlocked_boss_id); end if;
    pity_counters := jsonb_set(pity_counters, array[_boss_id], '0'::jsonb, true);
  else
    pity_counters := jsonb_set(pity_counters, array[_boss_id], to_jsonb(current_pity + 1), true);
  end if;

  boss_state_next := boss_state_next || jsonb_build_object('defeatedBossIds', defeated_ids, 'unlockedBossIds', unlocked_ids, 'pityCounters', pity_counters, 'lastBossAttempt', _attempt);

  update public.profiles
     set credits = greatest(0, credits + _credits_delta),
         scrap = scrap + coalesce(_scrap_delta, 0),
         player_level = next_level,
         player_xp = next_xp,
         consumables = next_consumables,
         boss_state = boss_state_next,
         action_skill_charge = v_charge_after,
         updated_at = now()
   where id = _player_id
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_apply_boss_attempt',
    'profile', public.cc_profile_snapshot(p),
    'boss_id', _boss_id,
    'attempt', _attempt,
    'consumed_batches', consumed_batches,
    'scrap_awarded', coalesce(_scrap_delta, 0),
    'entry_fee', coalesce(_entry_fee, 0),
    'action_skill', jsonb_build_object(
      'tree', _action_skill_tree,
      'fired', _action_skill_tree is not null,
      'charge_after', v_charge_after)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_boss_attempt', nonce_key, result);

  return result;
end;
$$;

-- ─── 5. cc_apply_endless_encounter restated (0028 body + fire) ──────
--
-- An eighth argument, _action_skill_tree (default null), with the
-- boss applier's exact validation: known tree, recorded selection
-- matches, keystone qualification from the player's own records,
-- full pool — then the pool zeroes. A non-firing encounter accrues
-- at the endless lever rate. When the encounter ENDS the run (death
-- or the depth-cap bank), the pool resets to 0 after the
-- spend/accrue — charge carries across encounters within a run and
-- never out of it. Replays return before any of this. The 0028
-- seven-argument signature is dropped first.

drop function if exists public.cc_apply_endless_encounter(uuid, text, uuid, integer, boolean, jsonb, jsonb, jsonb, boolean);

create or replace function public.cc_apply_endless_encounter(
  _player_id uuid,
  _nonce text,
  _run_id uuid,
  _depth integer,
  _victory boolean,
  _rewards jsonb,
  _encounter jsonb,
  _milestone_drop jsonb default null,
  _cap_reached boolean default false,
  _action_skill_tree text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_run public.endless_runs%rowtype;
  v_slot public.active_actions%rowtype;
  v_fraction numeric := public.cc_economy_config_number('endlessDeathPayoutFraction', 0.5);
  v_xp bigint := greatest(0, coalesce((_rewards ->> 'xp')::bigint, 0));
  v_credits bigint := greatest(0, coalesce((_rewards ->> 'credits')::bigint, 0));
  v_scrap bigint := greatest(0, coalesce((_rewards ->> 'scrap')::bigint, 0));
  v_payout jsonb := null;
  v_pay_credits bigint;
  v_pay_xp bigint;
  v_pay_scrap bigint;
  v_pay_fraction numeric;
  xp_state jsonb;
  -- 0030: action skill charge resolution.
  v_mod_payload jsonb;
  v_charge_after numeric;
  v_charge_rate numeric := least(100, greatest(0,
    public.cc_economy_config_number('actionSkillChargePerEndlessEncounter', 20)));
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_run from public.endless_runs
   where id = _run_id and user_id = _player_id for update;
  if not found then raise exception 'Endless run not found'; end if;
  if v_run.status <> 'active' then raise exception 'Endless run is not active'; end if;

  -- The run must hold the personal slot (occupations law): switching
  -- away mid-run pauses the Chamber until the player returns to it.
  select * into v_slot from public.active_actions where user_id = _player_id;
  if not found or v_slot.active_action <> 'endless_run' or v_slot.target_id <> _run_id::text then
    raise exception 'Endless run does not hold the action slot';
  end if;

  if _depth <> v_run.depth_reached + 1 then
    raise exception 'Endless depth mismatch';
  end if;

  -- 0030: action skill spend / accrue (the boss applier's block).
  if _action_skill_tree is not null then
    if _action_skill_tree not in ('Gunslinger', 'Demolition', 'Scavenger', 'Fixer') then
      raise exception 'Unknown action skill tree: %', _action_skill_tree;
    end if;
    if coalesce(p.action_skill_selection, '') <> _action_skill_tree then
      raise exception 'Action skill selection mismatch';
    end if;
    select payload into v_mod_payload from public.item_instances
     where owner_user_id = _player_id and runtime_state = 'equipped' and payload ? 'treeBonus'
     limit 1;
    if not public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, _action_skill_tree) then
      raise exception 'Action skill not qualified for the selected tree';
    end if;
    if coalesce(p.action_skill_charge, 0) < 100 then
      raise exception 'Action skill is not charged';
    end if;
    v_charge_after := 0;
  else
    v_charge_after := least(100, coalesce(p.action_skill_charge, 0) + v_charge_rate);
  end if;

  v_run.encounters := v_run.encounters || jsonb_build_array(
    coalesce(_encounter, '{}'::jsonb) || jsonb_build_object('depth', _depth, 'victory', _victory));

  if _victory then
    v_run.escrow_credits := v_run.escrow_credits + v_credits;
    v_run.escrow_xp := v_run.escrow_xp + v_xp;
    v_run.escrow_scrap := v_run.escrow_scrap + v_scrap;
    v_run.depth_reached := _depth;
    if _milestone_drop is not null then
      v_run.milestone_drops := v_run.milestone_drops || jsonb_build_array(jsonb_build_object(
        'depth', _depth,
        'rarity', _milestone_drop ->> 'rarity',
        'kind', _milestone_drop ->> 'kind',
        'name', _milestone_drop ->> 'name'));
    end if;
    if _cap_reached then
      v_run.status := 'banked';
      v_pay_fraction := 1;
    end if;
  else
    v_run.status := 'died';
    v_pay_fraction := v_fraction;
  end if;

  if v_run.status <> 'active' then
    -- Run end: settle escrow from the run row's own totals — the
    -- only payout source. XP rides cc_apply_xp like every faucet.
    -- 0030: the charge pool resets at run end, in the same update.
    v_pay_credits := floor(v_run.escrow_credits * v_pay_fraction)::bigint;
    v_pay_xp := floor(v_run.escrow_xp * v_pay_fraction)::bigint;
    v_pay_scrap := floor(v_run.escrow_scrap * v_pay_fraction)::bigint;
    xp_state := public.cc_apply_xp(p.player_level, p.player_xp, v_pay_xp);
    update public.profiles
       set credits = credits + v_pay_credits,
           scrap = scrap + v_pay_scrap,
           player_level = (xp_state ->> 'player_level')::integer,
           player_xp = (xp_state ->> 'player_xp')::bigint,
           action_skill_charge = 0,
           updated_at = now()
     where id = _player_id
     returning * into p;
    v_charge_after := 0;
    v_run.ended_at := now();
    v_run.paid_credits := v_pay_credits;
    v_run.paid_xp := v_pay_xp;
    v_run.paid_scrap := v_pay_scrap;
    v_run.payout_fraction := v_pay_fraction;
    v_payout := jsonb_build_object(
      'credits', v_pay_credits, 'xp', v_pay_xp, 'scrap', v_pay_scrap,
      'fraction', v_pay_fraction);
    -- Release the slot (only when it still points at this run).
    update public.active_actions
       set active_action = 'idle_standby', target_type = null,
           target_id = null, target_label = null, scene_key = null,
           notes = null, activity_payload = '{}'::jsonb,
           public_payload = '{}'::jsonb, updated_at = now()
     where user_id = _player_id and active_action = 'endless_run'
       and target_id = _run_id::text;
  else
    -- Run continues: persist the encounter's charge outcome.
    update public.profiles
       set action_skill_charge = v_charge_after,
           updated_at = now()
     where id = _player_id
     returning * into p;
  end if;

  update public.endless_runs
     set encounters = v_run.encounters,
         escrow_credits = v_run.escrow_credits,
         escrow_xp = v_run.escrow_xp,
         escrow_scrap = v_run.escrow_scrap,
         depth_reached = v_run.depth_reached,
         milestone_drops = v_run.milestone_drops,
         status = v_run.status,
         ended_at = v_run.ended_at,
         paid_credits = v_run.paid_credits,
         paid_xp = v_run.paid_xp,
         paid_scrap = v_run.paid_scrap,
         payout_fraction = v_run.payout_fraction
   where id = v_run.id
   returning * into v_run;

  result := jsonb_build_object(
    'action_type', 'cc_apply_endless_encounter',
    'run_id', v_run.id,
    'depth', _depth,
    'victory', _victory,
    'rewards', jsonb_build_object('xp', v_xp, 'credits', v_credits, 'scrap', v_scrap),
    'escrow', jsonb_build_object(
      'credits', v_run.escrow_credits, 'xp', v_run.escrow_xp, 'scrap', v_run.escrow_scrap),
    'run_status', v_run.status,
    'milestone_drop', _milestone_drop,
    'payout', v_payout,
    'action_skill', jsonb_build_object(
      'tree', _action_skill_tree,
      'fired', _action_skill_tree is not null,
      'charge_after', v_charge_after),
    'profile', public.cc_profile_snapshot(p),
    'run', public.cc_endless_run_snapshot(v_run)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_endless_encounter', _nonce, result);

  return result;
end;
$$;

-- ─── 6. cc_end_endless_run restated (0028 body + pool reset) ────────
--
-- The voluntary bank is a run ending: the charge pool resets in the
-- same update that pays the escrow. Everything else is the 0028 body.

create or replace function public.cc_end_endless_run(
  _player_id uuid,
  _nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_run public.endless_runs%rowtype;
  xp_state jsonb;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into v_run from public.endless_runs
   where user_id = _player_id and status = 'active' for update;
  if not found then
    return jsonb_build_object(
      'action_type', 'cc_end_endless_run',
      'ended', false,
      'reason', 'no_active_run');
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, v_run.escrow_xp);
  update public.profiles
     set credits = credits + v_run.escrow_credits,
         scrap = scrap + v_run.escrow_scrap,
         player_level = (xp_state ->> 'player_level')::integer,
         player_xp = (xp_state ->> 'player_xp')::bigint,
         action_skill_charge = 0,
         updated_at = now()
   where id = _player_id
   returning * into p;

  update public.endless_runs
     set status = 'banked', ended_at = now(),
         paid_credits = escrow_credits, paid_xp = escrow_xp,
         paid_scrap = escrow_scrap, payout_fraction = 1
   where id = v_run.id
   returning * into v_run;

  update public.active_actions
     set active_action = 'idle_standby', target_type = null,
         target_id = null, target_label = null, scene_key = null,
         notes = null, activity_payload = '{}'::jsonb,
         public_payload = '{}'::jsonb, updated_at = now()
   where user_id = _player_id and active_action = 'endless_run'
     and target_id = v_run.id::text;

  result := jsonb_build_object(
    'action_type', 'cc_end_endless_run',
    'ended', true,
    'run_id', v_run.id,
    'depth_reached', v_run.depth_reached,
    'payout', jsonb_build_object(
      'credits', v_run.paid_credits, 'xp', v_run.paid_xp,
      'scrap', v_run.paid_scrap, 'fraction', 1),
    'profile', public.cc_profile_snapshot(p),
    'run', public.cc_endless_run_snapshot(v_run)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_end_endless_run', _nonce, result);

  return result;
end;
$$;

-- ─── 7. cc_start_endless_run restated (0028 body + pool reset) ──────
--
-- Carrying out a still-active run is a run ending (abandonment): the
-- settlement update now also resets the charge pool. A fresh entry
-- with no prior run touches nothing. Everything else is the 0028 body.

create or replace function public.cc_start_endless_run(
  _player_id uuid,
  _nonce text,
  _risk text,
  _prepared jsonb,
  _expected_fee bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_fraction numeric := public.cc_economy_config_number('endlessDeathPayoutFraction', 0.5);
  v_fee_per_level numeric := public.cc_economy_config_number('endlessEntryFeePerLevel', 10);
  v_fee_cap numeric := public.cc_economy_config_number('endlessFeeEscalationCap', 8);
  v_runs_today bigint;
  v_fee bigint;
  v_run public.endless_runs%rowtype;
  v_old public.endless_runs%rowtype;
  v_abandoned jsonb := null;
  v_pay_credits bigint;
  v_pay_xp bigint;
  v_pay_scrap bigint;
  xp_state jsonb;
  next_consumables jsonb;
  con_key text;
  con_val integer;
  current_count integer;
  consumed_batches jsonb := '[]'::jsonb;
  consumed_one jsonb;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  -- The Chamber takes living hunters only: a standing roaming death
  -- (0013) must be resolved first. Endless deaths themselves never
  -- write that record (containment ruling, header).
  if coalesce(p.death_state, '{}'::jsonb) <> '{}'::jsonb then
    raise exception 'Hunter is dead — resurrect before entering the Chamber';
  end if;

  -- Settle a still-active run first: abandoned at the death
  -- fraction. Its payout lands before the fee check, so a carried-out
  -- bank can fund the next entry. 0030: the abandonment is a run
  -- ending — the charge pool resets in the same update.
  select * into v_old from public.endless_runs
   where user_id = _player_id and status = 'active' for update;
  if found then
    v_pay_credits := floor(v_old.escrow_credits * v_fraction)::bigint;
    v_pay_xp := floor(v_old.escrow_xp * v_fraction)::bigint;
    v_pay_scrap := floor(v_old.escrow_scrap * v_fraction)::bigint;
    xp_state := public.cc_apply_xp(p.player_level, p.player_xp, v_pay_xp);
    update public.profiles
       set credits = credits + v_pay_credits,
           scrap = scrap + v_pay_scrap,
           player_level = (xp_state ->> 'player_level')::integer,
           player_xp = (xp_state ->> 'player_xp')::bigint,
           action_skill_charge = 0,
           updated_at = now()
     where id = _player_id
     returning * into p;
    update public.endless_runs
       set status = 'abandoned', ended_at = now(),
           paid_credits = v_pay_credits, paid_xp = v_pay_xp,
           paid_scrap = v_pay_scrap, payout_fraction = v_fraction
     where id = v_old.id
     returning * into v_old;
    v_abandoned := jsonb_build_object(
      'run_id', v_old.id,
      'depth_reached', v_old.depth_reached,
      'payout', jsonb_build_object(
        'credits', v_pay_credits, 'xp', v_pay_xp, 'scrap', v_pay_scrap,
        'fraction', v_fraction));
  end if;

  -- Burn the prepared belt (boss-applier semantics exactly: validate
  -- against profiles.consumables, backfill legacy counts into 100%
  -- batches, consume through the batch path).
  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for con_key, con_val in
    select key, value::integer from jsonb_each_text(coalesce(_prepared, '{}'::jsonb))
  loop
    if con_val <= 0 then continue; end if;
    current_count := coalesce((next_consumables ->> con_key)::integer, 0);
    if current_count < con_val then
      raise exception 'Insufficient consumable quantity for %', con_key;
    end if;
    if not exists (
      select 1 from public.consumable_batches
       where owner_user_id = _player_id and consumable_type = con_key and quantity > 0
    ) then
      perform public.cc_add_consumable_batch(
        _player_id, con_key, current_count, 100, 'vendor', null, null,
        'admin_adjust',
        'Backfilled legacy count into 100% batch before endless belt burn',
        '{}'::jsonb);
    end if;
    consumed_one := public.cc_consume_consumable_batch(
      _player_id, con_key, con_val, 'endless', 'Endless Chamber entry belt',
      jsonb_build_object('mode', 'chaos_chamber'));
    consumed_batches := consumed_batches || jsonb_build_array(consumed_one);
    next_consumables := jsonb_set(next_consumables, array[con_key], to_jsonb(greatest(current_count - con_val, 0)), true);
  end loop;

  -- Entry fee: recomputed from live levers — perLevel × level,
  -- doubled per run already started today (UTC), capped. The
  -- route's _expected_fee is never charged.
  select count(*) into v_runs_today
    from public.verified_action_ledger
   where user_id = _player_id
     and action_type = 'cc_start_endless_run'
     and created_at >= (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC');
  v_fee := (round(v_fee_per_level * greatest(1, p.player_level))
            * least(v_fee_cap, power(2, least(v_runs_today, 20))))::bigint;
  if p.credits < v_fee then
    raise exception 'Insufficient credits for endless entry fee';
  end if;

  update public.profiles
     set credits = credits - v_fee,
         consumables = next_consumables,
         updated_at = now()
   where id = _player_id
   returning * into p;

  insert into public.endless_runs (
    user_id, status, start_level, risk, prepared_consumables, entry_fee
  ) values (
    _player_id, 'active', p.player_level,
    coalesce(nullif(trim(_risk), ''), 'Balanced'),
    coalesce(_prepared, '{}'::jsonb), v_fee
  )
  returning * into v_run;

  -- Take the personal action slot (the cc_set_active_action upsert
  -- shape, written directly: this applier IS the transition).
  insert into public.active_actions as aa (
    user_id, active_action, started_at, completes_at, target_type,
    target_id, target_label, scene_key, notes, activity_payload,
    public_payload, last_heartbeat_at, public_visible, schema_version,
    updated_at
  ) values (
    _player_id, 'endless_run', now(), null, 'endless', v_run.id::text,
    'Chaos Chamber — Endless', 'endless:chaos_chamber',
    'Endless run in progress',
    jsonb_build_object('run_id', v_run.id, 'mode', 'chaos_chamber'),
    jsonb_build_object('activity_label', 'Endless — Chaos Chamber', 'scene_key', 'endless:chaos_chamber'),
    now(), true, 1, now()
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
    updated_at = excluded.updated_at;

  result := jsonb_build_object(
    'action_type', 'cc_start_endless_run',
    'run', public.cc_endless_run_snapshot(v_run),
    'entry_fee', v_fee,
    'runs_started_today', v_runs_today + 1,
    'abandoned_settlement', v_abandoned,
    'consumed_batches', consumed_batches,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_start_endless_run', _nonce, result);

  return result;
end;
$$;

-- ─── 8. cc_set_action_skill_selection (new) ─────────────────────────
--
-- Record the ONE active signature. Setting a tree validates keystone
-- qualification from the player's own records under the row lock —
-- an unqualified pick is refused, never stored. Clearing (null) is
-- always legal. Nonce-idempotent through the verified action ledger;
-- the same op serves the skill screen's picker and the respec flow
-- (cc_retrain leaves the stored value alone — a selection whose
-- keystone is respecced away simply stops resolving).

create or replace function public.cc_set_action_skill_selection(
  _player_id uuid,
  _nonce text,
  _tree text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_mod_payload jsonb;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  if _tree is not null then
    if _tree not in ('Gunslinger', 'Demolition', 'Scavenger', 'Fixer') then
      raise exception 'Unknown action skill tree: %', _tree;
    end if;
    select payload into v_mod_payload from public.item_instances
     where owner_user_id = _player_id and runtime_state = 'equipped' and payload ? 'treeBonus'
     limit 1;
    if not public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, _tree) then
      raise exception 'Action skill not qualified for the selected tree';
    end if;
  end if;

  update public.profiles
     set action_skill_selection = _tree,
         updated_at = now()
   where id = _player_id
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_set_action_skill_selection',
    'selection', _tree,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_set_action_skill_selection', _nonce, result);

  return result;
end;
$$;

-- ─── 9. cc_fire_overclock_workshop (new) ────────────────────────────
--
-- The Fixer's Overclock workshop fire (brief §3.7): discharging the
-- pool at the Workshop instantly completes the in-progress unit on
-- every active bench — each unit through cc_complete_craft_unit, the
-- normal settler's own completion function (same outputs, same
-- quality roll, same pegged XP; it buys time, never output).
--
-- Validation order is deliberate: Fixer selection, keystone
-- qualification (own records), full charge, and a unit actually in
-- progress are ALL checked before the pool is spent — a refused fire
-- (nothing on the benches) spends nothing. A fitted tool's charge is
-- spent when a fired job's first unit completes, with the settler's
-- exact block. The completions themselves accrue charge normally
-- (cc_complete_craft_unit's 0030 accrual) — after the spend.
-- Action-lane and offline-cap rules do not apply: this is an instant
-- discharge, not a settlement window.

create or replace function public.cc_fire_overclock_workshop(
  _player_id uuid,
  _nonce text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  prior jsonb;
  result jsonb;
  v_mod_payload jsonb;
  v_xp_rate numeric := least(0.85, greatest(0.70,
    public.cc_economy_config_number('craftXpRate', 0.775)));
  v_shift numeric := least(10, greatest(-10,
    public.cc_economy_config_number('craftQualityShift', 0)));
  v_temper numeric := least(0.30, greatest(0,
    public.cc_economy_config_number('gearTemperBaseChance', 0.05)));
  v_yield_base numeric := least(1.0, greatest(0.5,
    public.cc_economy_config_number('refineBaseYield', 0.8)));
  v_job public.craft_jobs%rowtype;
  v_bench integer;
  v_output jsonb;
  v_completions jsonb := '[]'::jsonb;
  v_jobs_completed integer := 0;
  v_total_xp bigint := 0;
  v_tools jsonb;
  v_tool_id text;
  v_charges integer;
  v_fitted_key text;
  v_i integer;
begin
  if _player_id is null then raise exception 'Authentication required'; end if;
  if _nonce is null or length(trim(_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id and idempotency_key = _nonce;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  if coalesce(p.action_skill_selection, '') <> 'Fixer' then
    raise exception 'Overclock requires the Fixer signature selected';
  end if;
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = _player_id and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  if not public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
    raise exception 'Action skill not qualified for the selected tree';
  end if;
  if coalesce(p.action_skill_charge, 0) < 100 then
    raise exception 'Action skill is not charged';
  end if;
  if not exists (
    select 1 from public.craft_jobs
     where owner_user_id = _player_id and status = 'active'
       and units_completed < units_total
  ) then
    raise exception 'No craft unit in progress';
  end if;

  -- Spend the pool.
  update public.profiles
     set action_skill_charge = 0, updated_at = now()
   where id = _player_id
   returning * into p;

  -- Complete the in-progress unit on every bench: the head job of
  -- each bench (earliest created), exactly one unit per bench.
  for v_bench in
    select distinct bench from public.craft_jobs
     where owner_user_id = _player_id and status = 'active'
       and units_completed < units_total
     order by bench
  loop
    select * into v_job from public.craft_jobs
     where owner_user_id = _player_id and status = 'active' and bench = v_bench
       and units_completed < units_total
     order by created_at asc, id asc
     limit 1
     for update;
    if not found then continue; end if;

    -- The settler's tool-charge block: a fitted tool's charge is
    -- spent when the job actually starts (its first unit completes).
    if not v_job.tool_charged and v_job.snapshot ->> 'toolId' is not null then
      v_tool_id := v_job.snapshot ->> 'toolId';
      update public.craft_jobs set tool_charged = true where id = v_job.id;
      select * into p from public.profiles where id = _player_id;
      v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
      v_charges := coalesce((v_tools -> 'charges' ->> v_tool_id)::integer, 0) - 1;
      v_tools := jsonb_set(v_tools, array['charges', v_tool_id],
        to_jsonb(greatest(0, v_charges)), true);
      if v_charges <= 0 then
        v_tools := jsonb_set(v_tools, array['owned', v_tool_id], 'false'::jsonb, true);
        for v_fitted_key in
          select key from jsonb_each(coalesce(v_tools -> 'fitted', '{}'::jsonb))
        loop
          if v_tools -> 'fitted' ->> v_fitted_key = v_tool_id then
            v_tools := jsonb_set(v_tools, array['fitted', v_fitted_key], 'null'::jsonb, true);
          end if;
        end loop;
      end if;
      update public.profiles set workshop_tools = v_tools, updated_at = now()
       where id = _player_id;
    end if;

    update public.craft_jobs set accrued_ms = 0 where id = v_job.id;
    v_output := public.cc_complete_craft_unit(
      v_job.id, v_xp_rate, v_shift, v_temper, v_yield_base);

    if coalesce((v_output ->> 'vehicleFull')::boolean, false) then
      -- Repair job whose vehicle is already whole (or gone): end it
      -- and refund every unstarted kit at its escrowed quality — the
      -- settler's 0025 block verbatim, including the count bump
      -- (cc_add_consumable_batch does not move profiles.consumables).
      select * into v_job from public.craft_jobs where id = v_job.id;
      for v_i in v_job.units_completed .. v_job.units_total - 1 loop
        perform public.cc_add_consumable_batch(_player_id,
          v_job.snapshot -> 'repair' ->> 'kitType', 1,
          (v_job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
          coalesce(v_job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
          _player_id, null, 'repair_refund',
          'Patch kit refunded (vehicle already at full condition)',
          '{}'::jsonb);
      end loop;
      if v_job.units_total - v_job.units_completed > 0 then
        update public.profiles
           set consumables = public.cc_jsonb_add_int(consumables,
                 v_job.snapshot -> 'repair' ->> 'kitType',
                 v_job.units_total - v_job.units_completed),
               updated_at = now()
         where id = _player_id;
      end if;
      update public.craft_jobs
         set status = 'complete', completed_at = now()
       where id = v_job.id;
      v_jobs_completed := v_jobs_completed + 1;
      continue;
    end if;

    v_total_xp := v_total_xp + coalesce((v_output ->> 'xp')::bigint, 0);
    v_completions := v_completions || jsonb_build_array(
      v_output || jsonb_build_object('jobId', v_job.id, 'recipeId', v_job.recipe_id));
    select * into v_job from public.craft_jobs where id = v_job.id;
    if v_job.units_completed >= v_job.units_total then
      update public.craft_jobs
         set status = 'complete', completed_at = now()
       where id = v_job.id;
      v_jobs_completed := v_jobs_completed + 1;
    end if;
  end loop;

  select * into p from public.profiles where id = _player_id;

  result := jsonb_build_object(
    'action_type', 'cc_fire_overclock_workshop',
    'fired', true,
    'completions', v_completions,
    'jobs_completed', v_jobs_completed,
    'xp_awarded', v_total_xp,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_fire_overclock_workshop', _nonce, result);

  return result;
end;
$$;

-- ─── 10. cc_complete_craft_unit restated (0029 body + accrual) ──────
--
-- Two accrual blocks, both gated on the completing player's OWN
-- records (selection 'Fixer' + keystone qualification re-derived at
-- completion): a completed craft unit grants the per-unit lever rate;
-- a completed self-repair unit grants the per-point rate × points
-- actually restored. The blocks sit after the unit's own updates, so
-- a unit completed BY an Overclock workshop fire accrues normally —
-- after that fire's spend, exactly like every other settlement.

create or replace function public.cc_complete_craft_unit(
  p_job_id uuid,
  p_xp_rate numeric,
  p_quality_shift numeric,
  p_temper_base numeric,
  p_refine_base numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  job public.craft_jobs%rowtype;
  p public.profiles%rowtype;
  recipe jsonb;
  v_xp bigint;
  v_output jsonb;
  v_next jsonb;
  v_mastery_track text;
  v_mastery_xp integer;
  -- consumable completion
  v_type text;
  v_ml integer;
  v_bounds jsonb;
  v_roll numeric;
  v_qty integer;
  v_bonus boolean;
  -- refine completion
  v_yield numeric;
  v_count integer;
  -- gear completion
  v_tempered boolean;
  -- repair completion (0025)
  v_item public.item_instances%rowtype;
  -- Fixer completion terms (0029)
  v_mod_payload jsonb;
  v_craft_quality_bonus numeric := 0;
  v_craft_temper_bonus numeric := 0;
  v_shift numeric;
  v_kit_base numeric;
  v_quality numeric;
  v_before numeric;
  v_restore numeric;
  v_restored numeric;
begin
  select * into job from public.craft_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  actor := job.owner_user_id;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if job.kind = 'repair' then
    -- Self-repair unit (0025): apply the next escrowed patch kit.
    -- Restoration = kit base x kit quality% x the owner's repair
    -- efficiency snapshot, clamped at the vehicle's max; the kit is
    -- spent even when the clamp wastes part of it. No player XP
    -- (consumption); repair mastery trains by points restored.
    v_output := jsonb_build_object(
      'unit', job.units_completed + 1,
      'kind', 'repair',
      'xp', 0,
      'completedAtMs', (extract(epoch from now()) * 1000)::bigint
    );
    select * into v_item from public.item_instances
     where id = (job.snapshot -> 'repair' ->> 'itemId')::uuid
       and owner_user_id = actor;
    if not found or v_item.kind <> 'vehicle'
       or v_item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service')
       or coalesce(v_item.condition_current, v_item.condition_max, 100)
          >= coalesce(v_item.condition_max, 100) then
      -- The unit never starts: the settler ends the job here and
      -- refunds this and every later kit at its recorded quality.
      return v_output || jsonb_build_object('vehicleFull', true);
    end if;
    v_kit_base := case job.snapshot -> 'repair' ->> 'kitType'
      when 'PatchKit' then 30 when 'FieldPatchKit' then 45
      when 'MasterPatchKit' then 80 else 0 end;
    v_quality := coalesce(
      (job.snapshot -> 'repair' -> 'kitQualities' ->> job.units_completed)::numeric, 100);
    v_before := coalesce(v_item.condition_current, v_item.condition_max, 100);
    v_restore := round(v_kit_base * v_quality / 100
      * coalesce((job.snapshot -> 'repair' ->> 'efficiency')::numeric, 1), 2);
    update public.item_instances
       set condition_current = least(coalesce(condition_max, 100), v_before + v_restore),
           updated_at = now()
     where id = v_item.id
     returning condition_current into v_item.condition_current;
    v_restored := round(v_item.condition_current - v_before, 2);
    if v_restored > 0 then
      perform public.cc_add_mastery_xp(actor, 'services.repair', ceil(v_restored)::integer);
    end if;
    v_output := v_output || jsonb_build_object(
      'itemId', v_item.id,
      'quality', v_quality,
      'pointsRestored', v_restored,
      'conditionCurrent', v_item.condition_current
    );
    v_output := public.cc_jsonb_strip_nulls(v_output);
    update public.craft_jobs
       set units_completed = units_completed + 1,
           outputs = outputs || jsonb_build_array(v_output)
     where id = job.id;
    -- 0030: Overclock charge accrual — self-repair points restored
    -- charge a Fixer-selected owner's pool (per-point lever rate).
    if v_restored > 0 and coalesce(p.action_skill_selection, '') = 'Fixer' then
      select payload into v_mod_payload from public.item_instances
       where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
       limit 1;
      if public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
        update public.profiles
           set action_skill_charge = least(100, action_skill_charge
             + least(2, greatest(0, public.cc_economy_config_number('actionSkillChargePerRepairPoint', 0.2))) * v_restored)
         where id = actor;
      end if;
    end if;
    return v_output;
  end if;

  -- Fixer derivation (0029): the completing crafter's OWN records.
  -- The quality shift composes lever + skill under ONE clamp
  -- [-10, +20] (a future Research shift joins the same sum); the
  -- temper term adds Master Artificer's flat bonus under the 0.30 cap.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_craft_quality_bonus := 1.0 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_quality_2', 'Fixer', 5));
  v_craft_temper_bonus := 0.05 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_major_1', 'Fixer', 1);
  v_shift := least(20, greatest(-10, p_quality_shift + v_craft_quality_bonus));

  recipe := public.cc_craft_recipe(job.recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;

  v_xp := public.cc_craft_unit_xp(job.unit_duration_ms, p.player_level, p_xp_rate);
  v_output := jsonb_build_object(
    'unit', job.units_completed + 1,
    'kind', job.kind,
    'xp', v_xp,
    -- The settle instant is the production instant for metrics: the
    -- outputs (and their XP/materials) observably land at settlement.
    'completedAtMs', (extract(epoch from now()) * 1000)::bigint
  );

  if job.kind = 'consumable' then
    v_type := recipe ->> 'consumableType';
    v_ml := public.cc_player_mastery_level(actor, 'crafting_consumables');
    v_bounds := public.cc_craft_quality_bounds(
      v_type, v_ml, job.bench,
      (job.snapshot ->> 'catalystMaterialId') is not null,
      v_shift
    );
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
      * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
    )::numeric, 2);
    v_roll := least((v_bounds ->> 'cap')::numeric, greatest(1, v_roll));
    v_qty := 1;
    v_bonus := false;
    if coalesce((job.snapshot ->> 'toolBonusUnitChance')::numeric, 0) > 0
       and random() < (job.snapshot ->> 'toolBonusUnitChance')::numeric then
      v_qty := 2;
      v_bonus := true;
    end if;
    perform public.cc_add_consumable_batch(
      actor, v_type, v_qty, v_roll, 'crafted', actor, job.recipe_id,
      'crafted', 'Crafted at the Workshop', '{}'::jsonb);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, v_type, v_qty),
           updated_at = now()
     where id = actor;
    perform public.cc_add_stat(actor, 'consumables_crafted', v_qty);
    v_output := v_output || jsonb_build_object(
      'consumableType', v_type,
      'quality', v_roll,
      'quantity', v_qty,
      'bonusUnit', v_bonus
    );
  elsif job.kind = 'refine' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.refining');
    v_yield := least(1, p_refine_base + 0.004 * v_ml
      + coalesce((job.snapshot ->> 'toolRefineYieldBonus')::numeric, 0));
    if coalesce((recipe ->> 'outputBase')::numeric, 0) <= 0 or p_refine_base <= 0 then
      v_count := coalesce((recipe ->> 'outputBase')::integer, 0);
    else
      v_count := floor((recipe ->> 'outputBase')::numeric * v_yield / p_refine_base)::integer;
    end if;
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, recipe ->> 'outputMaterial', v_count),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object(
      'outputMaterial', recipe ->> 'outputMaterial',
      'outputQuantity', v_count
    );
  elsif job.kind = 'gear' then
    v_ml := public.cc_player_mastery_level(actor, 'crafting.gear');
    v_tempered := random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml + v_craft_temper_bonus);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', (case when v_tempered then 3 else 1 end)
        + case when job.snapshot ->> 'coreCatalyst' = 'true'
            then 2 + coalesce((job.snapshot ->> 'coreCatalystDrawBonus')::integer, 0)
            else 0 end,
      'tempered', v_tempered
    );
  elsif job.kind = 'tool' then
    -- All three fitted tools carry 25 jobs of durability (§2.5e).
    update public.profiles
       set workshop_tools = jsonb_set(
             jsonb_set(coalesce(workshop_tools, '{}'::jsonb),
               array['owned', recipe ->> 'toolId'], 'true'::jsonb, true),
             array['charges', recipe ->> 'toolId'], '25'::jsonb, true),
           updated_at = now()
     where id = actor;
    v_output := v_output || jsonb_build_object('toolId', recipe ->> 'toolId');
  end if;

  -- Mastery + player XP land after the output is priced.
  if job.kind = 'refine' then
    v_mastery_track := 'crafting.refining'; v_mastery_xp := 10;
  elsif job.kind in ('gear', 'tool') then
    v_mastery_track := 'crafting.gear'; v_mastery_xp := 25;
  else
    v_mastery_track := 'crafting_consumables'; v_mastery_xp := 10;
  end if;
  perform public.cc_add_mastery_xp(actor, v_mastery_track, v_mastery_xp);
  v_next := public.cc_apply_xp(p.player_level, p.player_xp, v_xp);
  update public.profiles
     set player_level = (v_next ->> 'player_level')::integer,
         player_xp = (v_next ->> 'player_xp')::bigint,
         updated_at = now()
   where id = actor;

  v_output := public.cc_jsonb_strip_nulls(v_output);
  update public.craft_jobs
     set units_completed = units_completed + 1,
         xp_awarded = xp_awarded + v_xp,
         outputs = outputs || jsonb_build_array(v_output)
   where id = job.id;
  -- 0030: Overclock charge accrual — a completed craft unit charges
  -- a Fixer-selected crafter's pool (per-unit lever rate).
  if coalesce(p.action_skill_selection, '') = 'Fixer'
     and public.cc_action_skill_qualified(p.skill_spends, v_mod_payload, 'Fixer') then
    update public.profiles
       set action_skill_charge = least(100, action_skill_charge
         + least(25, greatest(0, public.cc_economy_config_number('actionSkillChargePerCraftUnit', 3))))
     where id = actor;
  end if;
  return v_output;
end;
$$;

-- ─── 11. cc_repair_finalize_job restated (0025 body + accrual) ──────
--
-- One accrual block in the provider's work section: board repair
-- points restored charge a Fixer-selected mechanic's pool at the
-- per-point lever rate, gated on the mechanic's own keystone
-- qualification. Everything else is the 0025 body.

create or replace function public.cc_repair_finalize_job(p_job_id uuid, p_outcome text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.service_jobs%rowtype;
  provider public.profiles%rowtype;
  v_price bigint;
  v_restored numeric;
  v_target integer;
  v_payout bigint := 0;
  v_fee_rate numeric := least(1, greatest(0,
    public.cc_economy_config_number('marketFeeRate', 0.05)));
  v_xp_per_point numeric := least(10, greatest(0,
    public.cc_economy_config_number('serviceXpPerPoint', 2)));
  mod_payload jsonb;
  darknet_pts numeric := 0;
  v_fee_reduction numeric := 0;
  v_fee bigint := 0;
  v_xp bigint := 0;
  v_next jsonb;
begin
  select * into job from public.service_jobs where id = p_job_id for update;
  if not found then raise exception 'Repair job not found'; end if;
  if job.status in ('completed', 'cancelled') then
    return jsonb_build_object('job_id', job.id, 'outcome', job.outcome,
      'already_terminal', true);
  end if;

  v_price := coalesce(job.quoted_price_credits, 0);
  v_restored := coalesce(job.points_restored, 0);
  v_target := coalesce(job.target_points, 0);
  -- Price is per-point under the hood: full completion pays in
  -- full; anything else pays floor(price x restored / target).
  if p_outcome = 'completed' then
    v_payout := v_price;
  elsif v_target > 0 and v_restored > 0 then
    v_payout := floor(v_price * v_restored / v_target)::bigint;
  end if;

  if job.provider_user_id is not null then
    select * into provider from public.profiles where id = job.provider_user_id for update;
    if found and v_payout > 0 then
      -- The ONE player-to-player fee rule: the shared market fee,
      -- with the mechanic's Darknet Broker derivation mirrored from
      -- cc_accept_listing (0017) — skill_spends + equipped class mod.
      select payload into mod_payload from public.item_instances
       where owner_user_id = provider.id and runtime_state = 'equipped'
         and payload ? 'treeBonus'
       limit 1;
      darknet_pts := coalesce((provider.skill_spends ->> 'scav_fee_1')::numeric, 0)
                   + coalesce((mod_payload -> 'nodeBoosts' ->> 'scav_fee_1')::numeric, 0);
      if mod_payload ->> 'treeBonus' = 'Scavenger' then
        darknet_pts := least(5::numeric, darknet_pts + 1);
      end if;
      v_fee_reduction := least(1::numeric, greatest(0::numeric, 0.05 * darknet_pts));
      v_fee := floor(v_payout * v_fee_rate * (1 - v_fee_reduction))::bigint;
      update public.profiles
         set credits = credits + (v_payout - v_fee), updated_at = now()
       where id = provider.id;
    end if;
    if found and v_restored > 0 then
      v_xp := round(v_xp_per_point * v_restored)::bigint;
      if v_xp > 0 then
        v_next := public.cc_apply_xp(provider.player_level, provider.player_xp, v_xp);
        update public.profiles
           set player_level = (v_next ->> 'player_level')::integer,
               player_xp = (v_next ->> 'player_xp')::bigint,
               updated_at = now()
         where id = provider.id;
      end if;
      perform public.cc_add_mastery_xp(provider.id, 'services.repair', ceil(v_restored)::integer);
      if p_outcome = 'completed' then
        perform public.cc_add_stat(provider.id, 'services.completed', 1);
      end if;
      -- 0030: Overclock charge accrual — board repair points charge
      -- a Fixer-selected mechanic's pool (per-point lever rate).
      if coalesce(provider.action_skill_selection, '') = 'Fixer' then
        select payload into mod_payload from public.item_instances
         where owner_user_id = provider.id and runtime_state = 'equipped'
           and payload ? 'treeBonus'
         limit 1;
        if public.cc_action_skill_qualified(provider.skill_spends, mod_payload, 'Fixer') then
          update public.profiles
             set action_skill_charge = least(100, action_skill_charge
               + least(2, greatest(0, public.cc_economy_config_number('actionSkillChargePerRepairPoint', 0.2))) * v_restored),
                 updated_at = now()
           where id = provider.id;
        end if;
      end if;
    end if;
    -- Abandonment is a conduct record, not work: it lands even when
    -- zero points were restored (the usual case).
    if found and p_outcome = 'abandoned' then
      perform public.cc_add_stat(provider.id, 'services.abandoned', 1);
    end if;
  end if;

  -- The unspent escrow returns to the owner; the fee is destroyed
  -- (credited to nobody), exactly like a market fee.
  if v_price - v_payout > 0 then
    update public.profiles
       set credits = credits + (v_price - v_payout), updated_at = now()
     where id = job.owner_user_id;
  end if;
  if job.escrow_id is not null then
    update public.escrow_records
       set status = case when v_payout > 0 then 'released' else 'refunded' end,
           released_at = now()
     where id = job.escrow_id;
  end if;
  -- The vehicle is never hostage: every terminal state releases it.
  update public.item_instances
     set runtime_state = 'available', is_locked = false, updated_at = now()
   where id = job.target_item_instance_id;
  update public.service_jobs
     set status = case when p_outcome in ('completed', 'delivered_partial')
                     then 'completed' else 'cancelled' end,
         outcome = p_outcome,
         paid_credits = v_payout,
         fee_credits = v_fee,
         xp_awarded = v_xp,
         completed_at = now()
   where id = job.id;

  return jsonb_build_object('job_id', job.id, 'outcome', p_outcome,
    'paid_credits', v_payout, 'fee_credits', v_fee, 'xp_awarded', v_xp,
    'points_restored', v_restored);
end;
$$;

-- ─── 12. Economy metrics: action skill fire meters ──────────────────

alter table public.economy_metrics
  add column if not exists action_skill_fires_gunslinger integer not null default 0,
  add column if not exists action_skill_fires_demolition integer not null default 0,
  add column if not exists action_skill_fires_scavenger integer not null default 0,
  add column if not exists action_skill_fires_fixer integer not null default 0;

-- cc_compute_economy_metrics restated (0028 body + fire terms): the
-- four fire counts fold from the appliers' ledger payloads — the
-- action_skill block the boss and endless appliers record, plus the
-- workshop fire's own action type (a Fixer fire). Firing moves no
-- currency, so minted/destroyed totals are untouched.

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
     + count(*) filter (where action_type = 'cc_fire_overclock_workshop')) as action_skill_fires_fixer
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
    + m.endless_credits_paid;
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
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;
$$;
