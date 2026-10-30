-- 0014_mastery_alignment.sql
--
-- Phase 0 Slice 5: mastery alignment — shipped play feeds the mastery
-- engine. The mechanics audit found the mastery trigger
-- (cc_apply_mastery_for_verified_action, 0004) only understood the
-- LEGACY action vocabulary (cc_idle_claim, cc_boss_attempt,
-- cc_battle_result, rewards.xp, consumedConsumables), while the
-- shipped Chef flows write ledger rows as cc_apply_chef_rewards,
-- cc_apply_boss_attempt and cc_settle_offline_roaming with different
-- payload keys (rewards.xp_awarded, consumed_batches,
-- consumed_consumables). Roaming and boss play — the two
-- highest-volume activities in the game — therefore granted no
-- location, combat or consumable mastery at all. weapons.* masteries
-- had no grantor anywhere, and locations.* was only ever fed a
-- hardcoded 'locations.dustwaste'.
--
-- THE FIX IS IN THE TRIGGER, deliberately. The shipped action types
-- are load-bearing elsewhere and must not be renamed back:
-- trg_record_snapshot_on_verified_action keys progression snapshots
-- on 'cc_apply_chef_rewards' / 'cc_settle_offline_roaming', and the
-- TypeScript stores, routes and client sync code all key on the
-- shipped names. So this migration teaches the trigger the shipped
-- vocabulary instead, at the one point every verified action passes
-- through.
--
-- Two payload completions ride along because the definitions' own
-- grant rules need inputs the payloads did not carry. Both are
-- additive jsonb fields on the SAME function signatures (no caller
-- changes, no drops):
--   * cc_apply_chef_rewards records 'area_id' (it already receives
--     _area_id; it just never wrote it down) so location mastery can
--     be fed the REAL area farmed.
--   * cc_apply_chef_boss_attempt records 'xp_awarded' (greatest(_xp,
--     0); the Chef already victory-gates XP) so weapon mastery can
--     follow the weapons.* definitions' rule: xp_per_unit = 1 per
--     unit of player XP earned with that weapon type equipped.
--
-- Grant rules for the shipped branches mirror the trigger's legacy
-- rules exactly (no curve changes):
--   * locations.<area>: greatest(1, xp_awarded) per claim/settlement
--     (the legacy cc_idle_claim rule), fed the real area id. Boss
--     attempts grant NO location mastery: bosses have no area in the
--     data model, and the legacy branch's flat locations.dustwaste
--     grant for boss fights was part of the fiction.
--   * weapons.<type>: xp_awarded, for the equipped primary weapon's
--     type (read from item_instances at ledger time — the server's
--     own loadout record).
--   * combat.boss_attempts +20 / combat.boss_defeats +100 on victory
--     (the legacy boss branch's amounts), victory read from
--     attempt.victory.
--   * consumable.efficiency + combat.ordnance: the legacy
--     consumedConsumables block now also reads the shipped shapes —
--     boss consumed_batches (summed per type) and offline
--     consumed_consumables — with the same per-use amounts.
--
-- Grants for locations/weapons go through
-- cc_add_mastery_xp_if_defined so a claim in an area (or with a
-- weapon type) that has no mastery definition yet can never fail the
-- ledger insert — and therefore the claim — on the player_masteries
-- foreign key. The missing definitions for the six post-Dustwaste
-- areas and the Sniper/Launcher/Beam weapon types are seeded below.

-- ---------------------------------------------------------------------
-- Mastery definitions for the content the shipped game already has
-- (0004 seeded only locations.dustwaste and four of six weapon
-- types). Same shape/units as the 0004 seeds: locations are
-- 'activity' at 25 xp/unit, weapons are 'XP' at 1 xp/unit.
-- ---------------------------------------------------------------------
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('locations.redline_circuit', 'locations', 'Redline Circuit Mastery', 'Activity completed in the Redline Circuit region.', 'activity', 25, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('locations.ironwood_bastion', 'locations', 'Ironwood Bastion Mastery', 'Activity completed in the Ironwood Bastion region.', 'activity', 25, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('locations.blastforge_yards', 'locations', 'BlastForge Yards Mastery', 'Activity completed in the BlastForge Yards region.', 'activity', 25, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('locations.prismatek_reactor', 'locations', 'Prismatek Reactor Mastery', 'Activity completed in the Prismatek Reactor region.', 'activity', 25, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('locations.throwtech_dumpnet', 'locations', 'ThrowTech Dumpnet Mastery', 'Activity completed in the ThrowTech Dumpnet region.', 'activity', 25, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('locations.helixworks_labyrinth', 'locations', 'HelixWorks Labyrinth Mastery', 'Activity completed in the HelixWorks Labyrinth region.', 'activity', 25, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('weapons.sniper', 'weapons', 'Sniper Mastery', 'Sniper usage and sniper-driven victories.', 'XP', 1, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('weapons.launcher', 'weapons', 'Launcher Mastery', 'Launcher usage and launcher-driven victories.', 'XP', 1, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at) values ('weapons.beam', 'weapons', 'Beam Mastery', 'Beam usage and beam-driven victories.', 'XP', 1, true, true, '2026-10-30T00:00:00.000Z'::timestamptz, '2026-10-30T00:00:00.000Z'::timestamptz) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Mapping + guarded-grant helpers used by the trigger below.
-- ---------------------------------------------------------------------

-- Roaming area id -> locations mastery id. The Dustwaste Frontier's
-- mastery predates the area-id scheme (its definition is
-- 'locations.dustwaste', and existing player_masteries rows reference
-- it), so it is special-cased rather than renamed.
CREATE OR REPLACE FUNCTION public.cc_location_mastery_id(p_area_id text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_area_id is null or p_area_id = '' then null
    when p_area_id = 'dustwaste_frontier' then 'locations.dustwaste'
    else 'locations.' || p_area_id
  end;
$function$;

-- The mastery id for the player's equipped primary weapon, read from
-- the server's own loadout record (item_instances), or null when no
-- primary weapon is equipped.
CREATE OR REPLACE FUNCTION public.cc_equipped_weapon_mastery_id(p_user_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  weapon_type text;
begin
  select payload ->> 'weaponType' into weapon_type
    from public.item_instances
   where owner_user_id = p_user_id
     and runtime_state = 'equipped'
     and equipped_slot = 'primary'
   limit 1;
  if weapon_type is null or weapon_type = '' then
    return null;
  end if;
  return 'weapons.' || lower(weapon_type);
end;
$function$;

-- cc_add_mastery_xp with a definition-existence guard: a grant for a
-- mastery that has no (active) definition is skipped instead of
-- failing the player_masteries foreign key — which, inside the
-- ledger trigger, would fail the whole verified action.
CREATE OR REPLACE FUNCTION public.cc_add_mastery_xp_if_defined(p_user_id uuid, p_mastery_id text, p_xp_amount bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if p_user_id is null or p_mastery_id is null or coalesce(p_xp_amount, 0) = 0 then
    return;
  end if;
  if not exists (
    select 1 from public.mastery_definitions
     where id = p_mastery_id and is_active
  ) then
    return;
  end if;
  perform public.cc_add_mastery_xp(p_user_id, p_mastery_id, p_xp_amount);
end;
$function$;

-- ---------------------------------------------------------------------
-- cc_apply_chef_rewards: the 0010 definition verbatim, plus the
-- result payload now records 'area_id' (the _area_id the function
-- already receives and validates against the active action) so the
-- mastery trigger can feed location mastery the real area farmed.
-- Same 13-argument signature; no caller changes.
-- ---------------------------------------------------------------------
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
  _area_id text,
  _scrap_remainder numeric default null,
  _credits_remainder numeric default null,
  _xp_remainder numeric default null
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
  nonce_key text;
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
  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  nonce_key := _player_id::text || ':chef:' || _tick_count::text;
  select vl.result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = _player_id
     and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  if _tick_count <= p.last_claimed_tick then
    raise exception 'tick_count % is not after last claimed tick %', _tick_count, p.last_claimed_tick;
  end if;

  select * into activity_row
    from public.active_actions
   where user_id = _player_id
   for update;
  if not found or activity_row.active_action <> 'roaming_loot' or activity_row.target_id <> _area_id then
    raise warning 'No active roaming activity for area %, proceeding anyway', _area_id;
  end if;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, _xp);
  new_level := (xp_state ->> 'player_level')::integer;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  next_materials := coalesce(p.materials, '{}'::jsonb);
  for mat_key, mat_val in
    select key, value::integer from jsonb_each_text(coalesce(_materials, '{}'::jsonb))
  loop
    next_materials := jsonb_set(next_materials, array[mat_key], to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val), true);
  end loop;

  next_essences := coalesce(p.essences, '{}'::jsonb);
  for ess_key, ess_val in
    select key, value::integer from jsonb_each_text(coalesce(_essences, '{}'::jsonb))
  loop
    next_essences := jsonb_set(next_essences, array[ess_key], to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val), true);
  end loop;

  next_parts := coalesce(p.cache_token_parts, 0) + _fragments;
  next_tokens := coalesce(p.cache_tokens, 0);
  while next_parts >= 5 loop
    next_parts := next_parts - 5;
    next_tokens := next_tokens + 1;
  end loop;

  update public.profiles
     set credits = credits + _credits,
         credits_remainder = coalesce(_credits_remainder, credits_remainder),
         scrap = scrap + _scrap,
         scrap_remainder = coalesce(_scrap_remainder, scrap_remainder),
         player_level = new_level,
         player_xp = new_xp,
         xp_remainder = coalesce(_xp_remainder, xp_remainder),
         cache_token_parts = next_parts,
         cache_tokens = next_tokens,
         materials = next_materials,
         essences = next_essences,
         last_claimed_tick = _tick_count,
         last_roaming_settled_at = now(),
         updated_at = now()
   where id = _player_id
   returning * into p;

  update public.active_actions
     set last_heartbeat_at = now(),
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_claim_ticks', 1, 'last_claim_at', (extract(epoch from now()) * 1000)::bigint)
   where user_id = _player_id;

  result := jsonb_build_object(
    'action_type', 'cc_apply_chef_rewards',
    'profile', public.cc_profile_snapshot(p),
    -- 0014: the area this claim farmed, for the mastery trigger.
    'area_id', _area_id,
    'rewards', jsonb_build_object(
      'credits_awarded', _credits,
      'scrap_awarded', _scrap,
      'xp_awarded', _xp,
      'cache_fragments_awarded', _fragments,
      'materials', coalesce(_materials, '{}'::jsonb),
      'essences', coalesce(_essences, '{}'::jsonb),
      'kills_recorded', _kills
    )
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_chef_rewards', nonce_key, result);

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- cc_apply_chef_boss_attempt: the 0011 definition verbatim, plus the
-- result payload now records 'xp_awarded' so the mastery trigger can
-- grant weapon mastery per the weapons.* definitions' rule (1
-- mastery XP per player XP earned; the Chef victory-gates _xp, so
-- defeats record 0). Same 11-argument signature; no caller changes.
-- ---------------------------------------------------------------------
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
  _entry_fee bigint default 0
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
begin
  select * into p from public.profiles where id = _player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  nonce_key := _player_id::text || ':chef-boss:' || _boss_id || ':' || _attempt_nonce::text;
  select result_payload into prior
    from public.verified_action_ledger
   where user_id = _player_id
     and idempotency_key = nonce_key;
  if prior is not null then return prior || jsonb_build_object('idempotent_replay', true); end if;

  -- 0011: entry-fee affordability guard, under the row lock.
  if coalesce(_entry_fee, 0) > 0 and p.credits < _entry_fee then
    raise exception 'Insufficient credits for boss entry fee';
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
    -- 0014: XP the attempt awarded (victory-gated by the Chef), for
    -- the mastery trigger's weapon grants.
    'xp_awarded', greatest(_xp, 0)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_boss_attempt', nonce_key, result);

  return result;
end;
$$;

-- ---------------------------------------------------------------------
-- cc_apply_mastery_for_verified_action: the 0004 trigger body
-- verbatim, plus branches for the shipped Chef action types (0014).
-- Legacy branches (cc_idle_claim, cc_boss_attempt, cc_battle_result,
-- and the rest) are unchanged, including their hardcoded Dustwaste
-- grants — they serve the legacy ops, which still exist.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cc_apply_mastery_for_verified_action()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  profile_payload jsonb := coalesce(new.result_payload -> 'profile', '{}'::jsonb);
  reward_payload jsonb := coalesce(new.result_payload -> 'rewards', '{}'::jsonb);
  action text := new.action_type;
  amount bigint;
  won boolean;
  credits_value bigint;
  scrap_value bigint;
  net_worth_value bigint;
  consumed_map jsonb;
  consumable_type text;
  consumable_count integer;
begin
  perform public.cc_add_stat(new.user_id, 'actions.total', 1);
  perform public.cc_add_stat(new.user_id, 'actions.' || action, 1);

  if action in ('cc_make_item', 'cc_draw_item') then
    perform public.cc_add_stat(new.user_id, 'inventory.cache_draws', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.cache_draws', 30);
  elsif action in ('cc_recycle_item', 'cc_salvage_item') then
    amount := greatest(0, coalesce((new.result_payload ->> 'scrap_award')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'inventory.recycle.count', 1);
    perform public.cc_add_stat(new.user_id, 'inventory.scrap_generated', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.recycle', 25);
    perform public.cc_add_mastery_xp(new.user_id, 'inventory.scrap_generated', amount);
  elsif action = 'cc_vendor_buy' then
    amount := greatest(1, coalesce((new.result_payload ->> 'quantity')::bigint, 1));
    perform public.cc_add_stat(new.user_id, 'economy.vendor_buys', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.vendor_buys', amount * 15);
  elsif action = 'cc_market_create' then
    perform public.cc_add_stat(new.user_id, 'economy.market_listings', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_listings', 20);
  elsif action in ('cc_accept_listing', 'cc_market_transfer') then
    amount := greatest(0, coalesce((new.result_payload -> 'listing' ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'economy.market_sales', 1);
    perform public.cc_add_stat(new.user_id, 'economy.trade_volume', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.market_sales', 50);
    perform public.cc_add_mastery_xp(new.user_id, 'economy.trade_volume', amount);
  elsif action in ('cc_item_service_request', 'cc_item_service_accept') then
    perform public.cc_add_stat(new.user_id, 'services.jobs_touched', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 10);
  elsif action = 'cc_item_job_finish' then
    amount := greatest(0, coalesce((new.result_payload ->> 'price_credits')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'services.completed', 1);
    perform public.cc_add_stat(new.user_id, 'services.revenue', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'services.repair', 50 + amount);
  elsif action in ('cc_battle_result', 'cc_boss_attempt') then
    won := coalesce(new.result_payload -> 'draw' ->> 'outcome', '') = 'victory';
    perform public.cc_add_stat(new.user_id, 'combat.boss_attempts', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_attempts', 20);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', 25);
    if won then
      perform public.cc_add_stat(new.user_id, 'combat.boss_defeats', 1);
      perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_defeats', 100);
    end if;
  elsif action in ('cc_retrain', 'cc_skill_reset') then
    perform public.cc_add_stat(new.user_id, 'skills.retrain', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'skills.training', 25);
  elsif action = 'cc_idle_claim' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp(new.user_id, 'locations.dustwaste', greatest(1, amount));
  -- 0014: the shipped Chef flows. Same grant rules as the legacy
  -- branches above, fed the shipped payload keys and the real
  -- area / equipped weapon instead of a hardcoded Dustwaste.
  elsif action = 'cc_apply_chef_rewards' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp_awarded')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_location_mastery_id(new.result_payload ->> 'area_id'),
      greatest(1, amount)
    );
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_equipped_weapon_mastery_id(new.user_id),
      amount
    );
  elsif action = 'cc_settle_offline_roaming' then
    amount := greatest(0, coalesce((reward_payload ->> 'xp_awarded')::bigint, 0));
    perform public.cc_add_stat(new.user_id, 'combat.idle_xp_claimed', amount);
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_location_mastery_id(new.result_payload ->> 'area_id'),
      greatest(1, amount)
    );
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_equipped_weapon_mastery_id(new.user_id),
      amount
    );
  elsif action = 'cc_apply_boss_attempt' then
    won := coalesce((new.result_payload -> 'attempt' ->> 'victory')::boolean, false);
    perform public.cc_add_stat(new.user_id, 'combat.boss_attempts', 1);
    perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_attempts', 20);
    if won then
      perform public.cc_add_stat(new.user_id, 'combat.boss_defeats', 1);
      perform public.cc_add_mastery_xp(new.user_id, 'combat.boss_defeats', 100);
    end if;
    -- No location grant: bosses have no area in the data model.
    amount := greatest(0, coalesce((new.result_payload ->> 'xp_awarded')::bigint, 0));
    perform public.cc_add_mastery_xp_if_defined(
      new.user_id,
      public.cc_equipped_weapon_mastery_id(new.user_id),
      amount
    );
  end if;

  -- Consumable usage mastery (from roaming claims)
  consumed_map := coalesce(new.result_payload -> 'consumedConsumables', '{}'::jsonb);
  -- 0014: the shipped flows carry consumption under their own keys —
  -- boss attempts as consumed_batches (one batch wrapper per type,
  -- summed here per type) and offline settlements as
  -- consumed_consumables. Translate both into the type -> count map
  -- the grants below already understand.
  if action = 'cc_apply_boss_attempt' then
    select coalesce(jsonb_object_agg(per_type.consumable_type, per_type.total), '{}'::jsonb)
      into consumed_map
      from (
        select entry ->> 'consumable_type' as consumable_type,
               sum((entry ->> 'quantity')::integer) as total
          from jsonb_array_elements(coalesce(new.result_payload -> 'consumed_batches', '[]'::jsonb)) as wrapper,
               jsonb_array_elements(coalesce(wrapper -> 'consumed', '[]'::jsonb)) as entry
         group by entry ->> 'consumable_type'
      ) per_type;
    if consumed_map is null then
      consumed_map := '{}'::jsonb;
    end if;
  elsif action = 'cc_settle_offline_roaming' then
    consumed_map := coalesce(new.result_payload -> 'consumed_consumables', '{}'::jsonb);
  end if;
  if consumed_map <> '{}'::jsonb then
    for consumable_type, consumable_count in select key, value::integer from jsonb_each_text(consumed_map)
    loop
      if consumable_count > 0 then
        perform public.cc_add_mastery_xp(new.user_id, 'consumable.efficiency', consumable_count * 10);
        -- Ordnance family gets combat.ordnance mastery
        if consumable_type like 'Ordnance%'
           or consumable_type like 'EMP%'
           or consumable_type like 'Corrosive%'
           or consumable_type like 'Magnetized%'
           or consumable_type like 'PhaseShift%'
           or consumable_type like 'Void%'
        then
          perform public.cc_add_mastery_xp(new.user_id, 'combat.ordnance', consumable_count * 10);
        end if;
      end if;
    end loop;
  end if;

  if profile_payload ? 'credits' then
    credits_value := greatest(0, coalesce((profile_payload ->> 'credits')::bigint, 0));
    scrap_value := greatest(0, coalesce((profile_payload ->> 'scrap')::bigint, 0));
    net_worth_value := credits_value + scrap_value;
    perform public.cc_set_stat(new.user_id, 'account.net_worth', net_worth_value);
    perform public.cc_set_mastery_xp(new.user_id, 'account.net_worth', net_worth_value);
  end if;

  return new;
end;
$function$;
