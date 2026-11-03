-- 0069: Economy slice 5 -- the Scrap Merge (economy redesign brief
-- §3). DRAFT -- the parent applies this live before the slice's PR
-- merges.
--
-- THE RULING (brief §0.1 / §3.1): ONE tradeable Scrap, merged INTO
-- the item. THREE stocks existed: the profile scrap CURRENCY
-- (profiles.scrap), the materials['Scrap'] stack, and the
-- ScrapAlloy MATERIAL (38 recipe inputs, the roaming material
-- drop, the salvage bonus fallback, the vendor's 10 cr line). The
-- ruling renames ScrapAlloy INTO Scrap and converts the currency:
-- afterward every faucet, sink, recipe, display and the player
-- market runs on the single materials['Scrap'] stack. There is no
-- conversion back and no second scrap anywhere -- the ScrapAlloy
-- key ceases to exist in profile data, the recipe catalog, the
-- vendor catalog, and the material whitelists. The vendor keeps
-- selling the (renamed) stock at the old 10 cr anchor for exactly
-- one slice; brief §6 removes that line in slice 6, not here.
--
-- WHAT THIS FILE DOES, in order:
--   §1 The one-time, total conversion: every profile's column scrap
--      AND ScrapAlloy stack fold into materials['Scrap'], the
--      ScrapAlloy key is removed, and the column zeroes, with a
--      per-profile audit row in public.scrap_merge_audit (the
--      conversion's own ledger -- economy_metrics is a credits-only
--      daily aggregate with no scrap columns until slice 6's §4.4
--      breakouts). A self-check raises if any column balance or any
--      ScrapAlloy key survives.
--   §2 The key space: cc_is_material_key and the
--      cc_market_create_material whitelist swap 'ScrapAlloy' for
--      'Scrap' (21 ids), which is what makes the unified stock
--      listable end-to-end -- and the retired key unlistable.
--   §3 Faucets restated onto the stack: cc_apply_chef_rewards
--      (roaming claim), cc_settle_offline_roaming (offline settle;
--      the fractional scrap_remainder accounting is unchanged),
--      cc_recycle_item (salvage, single + the 0055 batch that calls
--      it), cc_dispatch_settle_mission, cc_apply_chef_boss_attempt
--      (twin-roll auto-scrap), the endless trio (escrow payouts),
--      cc_initial_bundle (+500). NO yield number changes anywhere --
--      only the ledger the amount lands in.
--   §4 Sinks restated onto the stack: cc_enqueue_craft_job and
--      cc_cancel_craft_job lose the 0053 scrap-column special case
--      ('Scrap' is an ordinary material key now), cc_enqueue_tint_job,
--      cc_reforge_item (still salvageValue x 3, in the unified
--      stock), cc_reroll_contract (100 / 400, unchanged).
--   §5 Readers: cc_profile_snapshot and the player_public_stats view
--      project `scrap` from the stack (wire shape unchanged);
--      cc_recalculate_net_worth counts the stack; cc_reset_progress
--      reseeds the stack and zeroes the column.
--   §6 The rename's stored-data rewrites (brief §3.3 steps 2-4):
--      cc_craft_recipe_catalog restated from 0057 with every input
--      key ScrapAlloy -> Scrap (amounts untouched);
--      cc_vendor_catalog restated from 0021 with its material row
--      renamed (price 10 unchanged -- slice 6 removes the line);
--      in-flight craft_jobs escrow snapshots rekeyed; open market
--      listings relabeled; unsettled dispatch missions' payout
--      material rekeyed.
--
-- The profiles.scrap COLUMN stays in place as a tombstone for one
-- release (a later cleanup migration drops it); after this file no
-- live function reads or writes it. In-flight craft_jobs escrow
-- snapshots keyed 'Scrap' need NO rewrite: the key is unchanged --
-- only the ledger it settles against moved. Escrows keyed
-- 'ScrapAlloy' DO get rewritten (§6).
--
-- CONVERSION RACE (stated plainly): awards settling in the minutes
-- between this file's live apply and the merged code deploy would
-- credit the old column under the old build and be missed by the
-- one-time conversion. Normal apply->deploy gap; negligible volume
-- at current traffic; the pre-open-beta reset caps the tail risk.
-- The merged supply is the SUM of the two old ledgers by design --
-- this file deliberately does NOT rebalance any price (repricing is
-- the §4 lever's job, exercised as live-ops after the merge).


-- =====================================================================
-- §1. The conversion (one-time, total, audited, idempotent)
-- =====================================================================

create table if not exists public.scrap_merge_audit (
  profile_id uuid primary key,
  column_scrap bigint not null,
  alloy_scrap bigint not null,
  existing_stack bigint not null,
  converted_total bigint not null,
  applied_at timestamptz not null default now()
);

comment on table public.scrap_merge_audit is
  '0069: one row per profile whose scrap holdings were converted into the unified materials[''Scrap''] stack: the profiles.scrap column balance plus the renamed ScrapAlloy stack. The merge''s audit ledger; never written again after the conversion.';

insert into public.scrap_merge_audit (profile_id, column_scrap, alloy_scrap, existing_stack, converted_total)
select id,
       scrap::bigint,
       coalesce((materials ->> 'ScrapAlloy')::bigint, 0),
       coalesce((materials ->> 'Scrap')::bigint, 0),
       scrap::bigint
         + coalesce((materials ->> 'ScrapAlloy')::bigint, 0)
         + coalesce((materials ->> 'Scrap')::bigint, 0)
  from public.profiles
 where scrap > 0
    or coalesce((materials ->> 'ScrapAlloy')::bigint, 0) > 0
on conflict (profile_id) do nothing;

update public.profiles
   set materials = (jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}',
                      to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0)
                               + scrap::bigint
                               + coalesce((materials ->> 'ScrapAlloy')::bigint, 0)), true)
                    - 'ScrapAlloy'),
       scrap = 0,
       updated_at = now()
 where scrap > 0
    or (materials ? 'ScrapAlloy');

do $$
begin
  if exists (select 1 from public.profiles where scrap <> 0) then
    raise exception '0069 self-check failed: a profiles.scrap balance survived the conversion';
  end if;
  if exists (select 1 from public.profiles where materials ? 'ScrapAlloy') then
    raise exception '0069 self-check failed: a ScrapAlloy stack survived the conversion';
  end if;
end $$;

-- §2a. cc_is_material_key (restated from 0053): 'ScrapAlloy' -> 'Scrap'.
create or replace function public.cc_is_material_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key = any (array[
    'Scrap','BallisticParts','ReactiveComponents','TechFragments','VoidDust',
    'Siltglass','NitrocellGel','HeartwoodResin','ForgeheartIngots','PrismShards',
    'MagnetiteCores','MycoSteelFiber','RefinedAlloy','TemperedParts','StabilizedCells',
    'WovenCircuits','CondensedVoid','CompositePlating','CircuitLattice','Voidweave','Chromaweave'])
$$;

-- §2b. cc_market_create_material (restated from 0053): the whitelist
-- swaps 'ScrapAlloy' for 'Scrap' -- the unified stock becomes
-- listable and the retired key unlistable. The escrow and delivery
-- legs were already generic material paths.
create or replace function public.cc_market_create_material(p_player_id uuid, nonce text, material_id text, quantity integer, price_credits bigint)
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
  qty integer := coalesce(quantity, 0);
  owned integer := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if qty <= 0 then raise exception 'quantity must be positive'; end if;
  if material_id not in ('Scrap','BallisticParts','ReactiveComponents','TechFragments','VoidDust','Siltglass','NitrocellGel','HeartwoodResin','ForgeheartIngots','PrismShards','MagnetiteCores','MycoSteelFiber','RefinedAlloy','TemperedParts','StabilizedCells','WovenCircuits','CondensedVoid','CompositePlating','CircuitLattice','Voidweave','Chromaweave') then
    raise exception 'Unknown material';
  end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  owned := public.cc_jsonb_int(coalesce(p.materials, '{}'::jsonb), material_id);
  if owned < qty then raise exception 'Insufficient material quantity'; end if;

  update public.profiles
     set materials = public.cc_jsonb_add_int(materials, material_id, -qty)
   where id = actor
  returning * into p;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, material_id, identity_key, category,
    display_name, seller_type)
  values (
    actor, null, price_credits, 'active',
    'material', qty, material_id, 'mat:' || material_id, 'material',
    material_id, 'player')
  returning * into listing;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', null, 'delivery', jsonb_build_object('kind', 'material', 'material_id', material_id, 'quantity', qty));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- §3. cc_apply_chef_rewards (restated from 0034): roaming claim pays the stack.
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
  -- 0069: the claim's scrap leg lands in the unified materials stock.
  next_materials := jsonb_set(next_materials, '{Scrap}', to_jsonb(coalesce((next_materials ->> 'Scrap')::bigint, 0) + _scrap), true);

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

  -- 0034: lifetime kill record — this claim's kills land under the
  -- weapon the hunter currently holds (derived server-side).
  perform public.cc_record_kill_stats(_player_id, _kills);

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (_player_id, 'cc_apply_chef_rewards', nonce_key, result);

  return result;
end;
$$;

-- §3. cc_settle_offline_roaming (restated from 0034): offline settle pays the stack.
create or replace function public.cc_settle_offline_roaming(
  _player_id uuid,
  _settlement_nonce text,
  _credits bigint,
  _scrap bigint,
  _xp bigint,
  _fragments integer,
  _materials jsonb,
  _essences jsonb,
  _kills integer,
  _scrap_remainder numeric default null,
  _credits_remainder numeric default null,
  _xp_remainder numeric default null,
  _consumed_consumables jsonb default null,
  _cap_hours numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := _player_id;
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
  next_consumables jsonb;
  applied_consumables jsonb := '{}'::jsonb;
  cons_key text;
  cons_val integer;
  applied_val integer;
  next_parts integer;
  next_tokens integer;
  mat_key text;
  mat_val integer;
  ess_key text;
  ess_val integer;
  nonce_key text;
  result jsonb;
begin
  if actor is null then raise exception '_player_id is required'; end if;
  if _settlement_nonce is null or length(trim(_settlement_nonce)) < 8 then
    raise exception 'settlement_nonce is required (min 8 chars)';
  end if;

  nonce_key := actor::text || ':offline_settle:' || _settlement_nonce;
  select vl.result_payload into prior
    from public.verified_action_ledger vl
   where vl.user_id = actor
     and vl.idempotency_key = nonce_key;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  select * into aa from public.active_actions where user_id = actor for update;
  if not found or aa.active_action <> 'roaming_loot' then
    return jsonb_build_object('settled', false, 'reason', 'not_roaming', 'active_action', coalesce(aa.active_action, 'none'));
  end if;

  settle_from := coalesce(p.last_roaming_settled_at, aa.started_at);
  if settle_from is null then
    return jsonb_build_object('settled', false, 'reason', 'no_elapsed', 'detail', 'No settlement start timestamp available');
  end if;

  raw_elapsed_ms := (extract(epoch from now_ts) * 1000)::bigint - (extract(epoch from settle_from) * 1000)::bigint;
  if raw_elapsed_ms < 0 then raw_elapsed_ms := 0; end if;

  -- 0015: the route's server-derived earned cap wins over the stored
  -- preference whenever it is supplied.
  cap_ms := (greatest(0.25, coalesce(_cap_hours, p.offline_cap_hours, 2)) * 3600 * 1000)::bigint;
  cap_reached := raw_elapsed_ms > cap_ms;
  elapsed_ms := least(raw_elapsed_ms, cap_ms);

  ticks_requested := floor(elapsed_ms / tick_ms)::integer;
  if ticks_requested <= 0 then
    return jsonb_build_object('settled', false, 'reason', 'no_elapsed', 'elapsed_ms', elapsed_ms);
  end if;

  new_tick_count := coalesce(p.last_claimed_tick, 0) + ticks_requested;

  xp_state := public.cc_apply_xp(p.player_level, p.player_xp, _xp);
  new_level := (xp_state ->> 'player_level')::integer;
  new_xp := (xp_state ->> 'player_xp')::bigint;

  next_materials := coalesce(p.materials, '{}'::jsonb);
  for mat_key, mat_val in select key, value::integer from jsonb_each_text(coalesce(_materials, '{}'::jsonb)) loop
    next_materials := jsonb_set(next_materials, array[mat_key], to_jsonb(coalesce((next_materials ->> mat_key)::integer, 0) + mat_val), true);
  end loop;
  -- 0069: the settlement's scrap leg lands in the unified materials stock.
  next_materials := jsonb_set(next_materials, '{Scrap}', to_jsonb(coalesce((next_materials ->> 'Scrap')::bigint, 0) + _scrap), true);

  next_essences := coalesce(p.essences, '{}'::jsonb);
  for ess_key, ess_val in select key, value::integer from jsonb_each_text(coalesce(_essences, '{}'::jsonb)) loop
    next_essences := jsonb_set(next_essences, array[ess_key], to_jsonb(coalesce((next_essences ->> ess_key)::integer, 0) + ess_val), true);
  end loop;

  -- 0012: fold the engine's consumed set into the settlement, clamped
  -- per type to the owned count (same rule as
  -- cc_consume_roaming_consumables). The SRF columns are aliased for
  -- the same reason as in that function (0007 note): unaliased
  -- key/value output columns collide with the loop variables.
  next_consumables := coalesce(p.consumables, '{}'::jsonb);
  for cons_key, cons_val in select e.key, e.value::integer from jsonb_each_text(coalesce(_consumed_consumables, '{}'::jsonb)) as e loop
    if cons_val <= 0 then continue; end if;
    applied_val := least(cons_val, coalesce((next_consumables ->> cons_key)::integer, 0));
    if applied_val <= 0 then continue; end if;
    next_consumables := jsonb_set(next_consumables, array[cons_key], to_jsonb(coalesce((next_consumables ->> cons_key)::integer, 0) - applied_val), true);
    applied_consumables := jsonb_set(applied_consumables, array[cons_key], to_jsonb(applied_val), true);
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
         scrap_remainder = coalesce(_scrap_remainder, scrap_remainder),
         player_level = new_level,
         player_xp = new_xp,
         xp_remainder = coalesce(_xp_remainder, xp_remainder),
         cache_token_parts = next_parts,
         cache_tokens = next_tokens,
         materials = next_materials,
         essences = next_essences,
         consumables = next_consumables,
         last_claimed_tick = new_tick_count,
         last_roaming_settled_at = now_ts,
         last_settlement_nonce = _settlement_nonce,
         updated_at = now_ts
   where id = actor
   returning * into p;

  -- 0012: audit rows for the applied decrements (same shape the
  -- foreground consumption function writes).
  for cons_key, applied_val in select e.key, e.value::integer from jsonb_each_text(applied_consumables) as e loop
    insert into consumable_events (
      user_id, consumable_type, quantity_delta,
      event_type, activity_type, reason
    )
    values (
      actor, cons_key, -applied_val,
      'used', 'roaming_loot',
      'Consumed during offline settlement in ' || coalesce(aa.target_id, '')
    );
  end loop;

  update public.active_actions
     set last_heartbeat_at = now_ts,
         activity_payload = coalesce(activity_payload, '{}'::jsonb) || jsonb_build_object('last_offline_settle_at', (extract(epoch from now_ts) * 1000)::bigint, 'last_offline_settle_ticks', ticks_requested)
   where user_id = actor;

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
    'cap_hours', coalesce(_cap_hours, p.offline_cap_hours, 2)::numeric,
    'ticks_requested', ticks_requested,
    'ticks_settled', ticks_requested,
    'new_tick_count', new_tick_count,
    'start_tick', new_tick_count - ticks_requested,
    'end_tick', new_tick_count,
    'profile', public.cc_profile_snapshot(p),
    'rewards', jsonb_build_object('credits_awarded', _credits, 'scrap_awarded', _scrap, 'xp_awarded', _xp, 'cache_fragments_awarded', _fragments, 'materials', coalesce(_materials, '{}'::jsonb), 'essences', coalesce(_essences, '{}'::jsonb), 'kills_recorded', _kills, 'ticks', ticks_requested),
    'consumed_consumables', applied_consumables
  );

  -- 0034: lifetime kill record — same rule as the foreground claim.
  perform public.cc_record_kill_stats(actor, _kills);

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_settle_offline_roaming', nonce_key, result);

  return result;
end;
$$;

-- §3. cc_recycle_item (restated from 0053): salvage pays the stack.
-- cc_recycle_batch (0055) calls this per item, so batch salvage
-- follows unchanged. The salvage VALUE formula is untouched.
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

-- §3. cc_dispatch_settle_mission (restated from 0032): pays the stack.
create or replace function public.cc_dispatch_settle_mission(
  p_mission public.dispatch_missions,
  p_fraction numeric,
  p_recalled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  actor uuid := p_mission.user_id;
  p public.profiles%rowtype;
  f numeric := least(1, greatest(0, coalesce(p_fraction, 1)));
  v_credits bigint := floor(p_mission.payout_credits * f);
  v_scrap bigint := floor(p_mission.payout_scrap * f);
  v_units integer := floor(p_mission.payout_material_units * f);
  v_wear numeric := null;
  v_refund numeric := 0;
  result jsonb;
begin
  select * into p from public.profiles where id = actor for update;

  -- Release the committed loadout (foot) — only rows still in the
  -- dispatch state; a row the owner somehow moved is left alone.
  if coalesce(array_length(p_mission.loadout_item_ids, 1), 0) > 0 then
    update public.item_instances
       set runtime_state = 'available', is_locked = false, updated_at = now()
     where id = any(p_mission.loadout_item_ids)
       and owner_user_id = actor
       and runtime_state = 'in_service';
  end if;

  if p_mission.contract_family = 'courier' and p_mission.vehicle_item_id is not null then
    v_wear := coalesce(p_mission.wear_projected, 0) * f;
    v_refund := coalesce(p_mission.fuel_charged_units, 0) * (1 - f);
    update public.item_instances
       set runtime_state = 'available', is_locked = false,
           condition_current = greatest(0, coalesce(p_mission.condition_at_departure, 0) - v_wear),
           updated_at = now()
     where id = p_mission.vehicle_item_id
       and owner_user_id = actor
       and runtime_state = 'in_service';
  end if;

  -- 0069: the payout's scrap leg lands in the unified materials
  -- stock first, so the payout-material case below composes on top.
  update public.profiles
     set materials = jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}',
               to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0) + v_scrap), true)
   where id = actor;

  update public.profiles
     set credits = credits + v_credits,
         materials = case
           when p_mission.payout_material_id is not null and v_units > 0 then
             jsonb_set(coalesce(materials, '{}'::jsonb), array[p_mission.payout_material_id],
               to_jsonb(coalesce((materials ->> p_mission.payout_material_id)::bigint, 0) + v_units), true)
           else materials end,
         vehicle_fuel = vehicle_fuel + v_refund,
         updated_at = now()
   where id = actor
   returning * into p;

  update public.dispatch_missions
     set status = case when p_recalled then 'recalled' else 'settled' end,
         settled_at = now(),
         payout_fraction = f,
         wear_applied = v_wear,
         fuel_refunded_units = v_refund
   where id = p_mission.id;

  result := jsonb_build_object(
    'action_type', 'cc_dispatch_settle',
    'mission_id', p_mission.id,
    'family', p_mission.contract_family,
    'offer_id', p_mission.offer_id,
    'area_id', p_mission.destination_area_id,
    'duration_hours', p_mission.duration_hours,
    'fraction', f,
    'recalled', p_recalled,
    'breakdown', p_mission.breakdown_fraction is not null and p_mission.breakdown_fraction < 1 and f >= p_mission.breakdown_fraction - 0.000000001,
    'payout', jsonb_build_object(
      'credits', v_credits,
      'scrap', v_scrap,
      'material_id', p_mission.payout_material_id,
      'material_units', v_units
    ),
    'wear_applied', v_wear,
    'fuel_refunded_units', v_refund,
    'profile', public.cc_profile_snapshot(p)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_dispatch_settle', 'dispatch-settle:' || p_mission.id::text, result)
  on conflict (user_id, idempotency_key) do nothing;
  return result;
end;
$function$;

-- §3. cc_apply_chef_boss_attempt (restated from 0040): the twin-roll
-- auto-scrap delta lands in the stack (an award, >= 0 by construction
-- in the Chef engine, exactly as the column add behaved).
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
  _action_skill_tree text default null,
  _items jsonb default '[]'::jsonb
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
         materials = jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}', to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0) + coalesce(_scrap_delta, 0)), true),
         player_level = next_level,
         player_xp = next_xp,
         consumables = next_consumables,
         boss_state = boss_state_next,
         action_skill_charge = v_charge_after,
         updated_at = now()
   where id = _player_id
   returning * into p;

  -- Audit fix A (0040): the attempt's rolled loot is stored INSIDE this
  -- transaction. Before 0040 the route stored items in a second call
  -- after this applier had already committed, so a failure there (the
  -- 0039 cc_store_chef_items overload incident) left a fully recorded
  -- victory whose loot never arrived — the profile fold then counted a
  -- victory the collection fold disagreed with (CONS-02). Storing here
  -- makes attempt + rewards + loot + ledger row one atomic commit; any
  -- failure rolls the whole attempt back. cc_store_chef_items is
  -- idempotent per item id, and a nonce replay returns before this
  -- point, so loot can never double-store.
  perform public.cc_store_chef_items(_player_id, coalesce(_items, '[]'::jsonb));

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

-- §3. cc_apply_endless_encounter (restated from 0030): escrow payout on encounter settle pays the stack.
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
           materials = jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}', to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0) + v_pay_scrap), true),
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

-- §3. cc_start_endless_run (restated from 0030): prior-run escrow payout on start pays the stack.
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
           materials = jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}', to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0) + v_pay_scrap), true),
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

-- §3. cc_end_endless_run (restated from 0030): escrow payout on run end pays the stack.
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
         materials = jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}', to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0) + v_run.escrow_scrap), true),
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

-- §3. cc_initial_bundle (restated from 0021): the +500 lands in the stack.
CREATE OR REPLACE FUNCTION public.cc_initial_bundle(p_player_id uuid, nonce text)
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
  bike_id uuid;
  bike public.item_instances%rowtype;
  has_equipped_vehicle boolean;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce(p.boss_state ->> 'initial_bundle_claimed', 'false') = 'true' then raise exception 'Initial bundle already claimed'; end if;

  update public.profiles
  set credits = credits + 5000,
      materials = jsonb_set(coalesce(materials, '{}'::jsonb), '{Scrap}', to_jsonb(coalesce((materials ->> 'Scrap')::bigint, 0) + 500), true),
      cache_tokens = cache_tokens + 3,
      boss_state = jsonb_set(coalesce(boss_state, '{}'::jsonb), '{initial_bundle_claimed}', 'true'::jsonb, true)
  where id = actor
  returning * into p;

  -- Starter vehicle: granted once, auto-equipped when the vehicle
  -- slot is empty. (The bundle claim flag already makes this
  -- once-only; the grantSource existence check is the belt to that
  -- suspender for profiles whose flag predates this migration.)
  if not exists (
    select 1 from public.item_instances
    where owner_user_id = actor and kind = 'vehicle' and payload ->> 'grantSource' = 'initial_bundle'
  ) then
    bike_id := gen_random_uuid();
    has_equipped_vehicle := exists (
      select 1 from public.item_instances
      where owner_user_id = actor and runtime_state = 'equipped' and equipped_slot = 'vehicle'
    );
    insert into public.item_instances (
      id, owner_user_id, kind, item_level, rarity, condition_current, condition_max,
      supply_mode, tradeable, account_bound, payload, runtime_state, equipped_slot, estimated_value
    ) values (
      bike_id, actor, 'vehicle', 1, 'Common', 100, 100,
      'verified_action', true, false,
      jsonb_build_object(
        'id', bike_id::text,
        'name', 'Scrap Bike',
        'vehicleClassId', 'scrap_bike',
        'level', 1,
        'rarity', 'Common',
        'affixes', '[]'::jsonb,
        'sourceTag', 'World Drop',
        'isLocked', false,
        'pixelSeed', 0,
        'grantSource', 'initial_bundle'
      ),
      case when has_equipped_vehicle then 'available' else 'equipped' end,
      case when has_equipped_vehicle then null else 'vehicle' end,
      public.cc_compute_item_estimated_value(
        jsonb_build_object('affixes', '[]'::jsonb), 'vehicle', 'Common', 1)
    ) returning * into bike;
  end if;

  result := jsonb_build_object(
    'action_type', 'cc_initial_bundle',
    'profile', public.cc_profile_snapshot(p),
    'item', case when bike.id is null then null else to_jsonb(bike) end,
    'loadout', public.cc_loadout_snapshot(actor)
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_initial_bundle', nonce, result);

  return result;
end;
$function$;

-- §4. cc_enqueue_craft_job (restated from 0067): the 0053 scrap-column
-- special case is DELETED in both the availability check and the
-- escrow debit -- 'Scrap' resolves through cc_is_material_key like
-- every other material (so an unaffordable Scrap leg now raises the
-- generic 'Insufficient material Scrap', twin-identical).
create or replace function public.cc_enqueue_craft_job(
  p_player_id uuid,
  nonce text,
  p_bench integer,
  p_recipe_id text,
  p_units integer,
  p_rarity text,
  p_use_catalyst boolean,
  p_use_rush_ticket boolean,
  p_efficiency_bonus numeric,
  p_use_core_catalyst boolean default false
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
  recipe jsonb;
  v_units integer := coalesce(p_units, 0);
  v_bench integer := coalesce(p_bench, 0);
  v_kind text;
  v_rarity text := nullif(coalesce(p_rarity, ''), '');
  v_rarity_bench integer := 1;
  v_catalyst text := null;
  v_escrow jsonb := '{}'::jsonb;
  v_escrow_catalyst jsonb := '{}'::jsonb;
  v_key text;
  v_per_unit numeric;
  v_available integer;
  v_tools jsonb;
  v_fitted text;
  v_tool_quality numeric := 1;
  v_tool_duration numeric := 1;
  v_tool_yield numeric := 0;
  v_tool_bonus numeric := 0;
  v_rush_quality numeric := null;
  v_rush_origin text := null;
  v_rush_reduction numeric := 0;
  v_ticket_count integer;
  v_core_catalyst boolean := coalesce(p_use_core_catalyst, false);
  v_escrow_cores integer := 0;
  v_consumed jsonb;
  v_skill_mult numeric;
  v_mod_payload jsonb;
  v_craft_speed_bonus numeric := 0;
  v_workshop_queue_bonus integer := 0;
  v_rush_cap_bonus numeric := 0;
  v_core_draw_bonus integer := 0;
  v_scalar numeric := least(2.0, greatest(0.5,
    public.cc_economy_config_number('craftTimeScalar', 1.0)));
  v_base_duration bigint;
  v_duration bigint;
  v_job public.craft_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  -- Settle first: gates and snapshots read post-settle state.
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  -- Guest access (0048): enqueueing is open to every authenticated
  -- account, guests included (Michael's ruling, 2026-11-01:
  -- "Verified account shouldn't be needed for crafting"). The
  -- player-market gate is a separate treatment and is NOT changed:
  -- can_use_player_economy still guards the market ops, standing
  -- ops, and every other economy surface that carries it.

  -- Fixer derivation (0029): every Fixer term reads the player's OWN
  -- records (skill_spends + the equipped class mod payload) through
  -- cc_skill_effective_points — the SQL mirror of computeSkillBonuses.
  -- No request parameter carries a Fixer value.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_craft_speed_bonus := 0.025 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_craft_time_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_craft_time_2', 'Fixer', 5));
  v_workshop_queue_bonus :=
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1)::integer;
  v_rush_cap_bonus := 0.10 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1);
  v_core_draw_bonus :=
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1)::integer;

  recipe := public.cc_craft_recipe(p_recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;
  v_kind := recipe ->> 'kind';

  -- Cosmetics (0053): the tint craft is an item-target job and
  -- starts only through cc_enqueue_tint_job; per-recipe unit caps
  -- (prestige crafts) bind here.
  if coalesce((recipe ->> 'tintCraft')::boolean, false) then
    raise exception 'Tint crafts start from the Tinting action';
  end if;
  if recipe ->> 'maxUnits' is not null
     and v_units > (recipe ->> 'maxUnits')::integer then
    raise exception 'This craft runs at most % units at a time', recipe ->> 'maxUnits';
  end if;

  if v_units < 1 then raise exception 'units must be a positive integer'; end if;
  if v_units > 500 then raise exception 'units exceeds the per-job maximum of 500'; end if;
  if v_bench < 1 or v_bench > 3 then raise exception 'bench must be 1, 2 or 3'; end if;
  if v_bench > coalesce(p.workshop_benches, 1) then raise exception 'Bench not unlocked'; end if;
  if v_bench < (recipe ->> 'requiresBench')::integer then
    raise exception 'Recipe requires bench % or higher', recipe ->> 'requiresBench';
  end if;
  if p.player_level < (recipe ->> 'requiresLevel')::integer then
    raise exception 'Requires level %', recipe ->> 'requiresLevel';
  end if;
  if recipe ->> 'requiresResearch' is not null
     and not exists (
       select 1 from public.research_completions
        where user_id = actor and course_id = recipe ->> 'requiresResearch'
     ) then
    raise exception 'research_required';
  end if;

  -- Manufacturer Standing (0043): the rank gate, beside the research
  -- gate. Rank is a granted fact on manufacturer_standing; a missing
  -- row is rank 0.
  if recipe -> 'requiresStanding' is not null
     and coalesce((
       select rank from public.manufacturer_standing
        where player_id = actor
          and manufacturer = recipe -> 'requiresStanding' ->> 'manufacturer'
     ), 0) < (recipe -> 'requiresStanding' ->> 'rank')::integer then
    raise exception 'standing_required';
  end if;
  if recipe -> 'requiresMastery' is not null
     and public.cc_player_mastery_level(actor, recipe -> 'requiresMastery' ->> 'track')
         < (recipe -> 'requiresMastery' ->> 'level')::integer then
    raise exception 'Requires % mastery %',
      recipe -> 'requiresMastery' ->> 'track', recipe -> 'requiresMastery' ->> 'level';
  end if;

  -- Gear rarity: forced at enqueue, Epic-capped by law.
  if v_kind = 'gear' then
    if v_rarity is null or v_rarity not in ('Common', 'Uncommon', 'Rare', 'Epic') then
      if v_rarity = 'Legendary' then
        raise exception 'Legendary gear cannot be crafted';
      end if;
      raise exception 'A craftable rarity (Common–Epic) is required';
    end if;
    v_rarity_bench := case v_rarity when 'Epic' then 3 when 'Rare' then 2 else 1 end;
    if v_bench < v_rarity_bench then
      raise exception '% frames require bench %', v_rarity, v_rarity_bench;
    end if;
    if v_rarity = 'Epic'
       and public.cc_player_mastery_level(actor, 'crafting.gear') < 10 then
      raise exception 'Epic frames require crafting.gear mastery 10';
    end if;
  end if;

  -- Tools are unique workshop assets: no duplicates owned or queued.
  if v_kind = 'tool' then
    if coalesce(p.workshop_tools -> 'owned' ->> (recipe ->> 'toolId'), 'false') = 'true' then
      raise exception 'Tool already fitted in the workshop';
    end if;
    if exists (select 1 from public.craft_jobs
                where owner_user_id = actor and status = 'active'
                  and recipe_id = p_recipe_id) then
      raise exception 'A job for this tool is already queued';
    end if;
  end if;

  -- Queue capacity: one running + five queued per bench, plus the
  -- Fixer keystone's workshop_queue_bonus (0029).
  if (select count(*) from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench) >= 6 + v_workshop_queue_bonus then
    raise exception 'Bench queue is full';
  end if;

  -- Catalyst (§2.5b): first match in the TS CATALYSTS order wins.
  if coalesce(p_use_catalyst, false) then
    v_catalyst := case
      when recipe ->> 'consumableType' in ('BossScanner', 'DataSkimmer') then 'Siltglass'
      when recipe ->> 'consumableType' in ('OverchargeStim', 'IncendiaryAmmo', 'ShockAmmo', 'CorrosiveAmmo', 'CryoAmmo', 'VoidAmmo') then 'NitrocellGel'
      when recipe ->> 'consumableType' in ('ShieldCell', 'PatchKit', 'FieldPatchKit', 'MasterPatchKit') then 'HeartwoodResin'
      when recipe ->> 'consumableType' in ('OrdnanceCharge', 'EMPCharge', 'CorrosiveCharge') then 'ForgeheartIngots'
      when recipe ->> 'consumableType' = 'LuckBooster' then 'PrismShards'
      when recipe ->> 'consumableType' in ('SalvageContract', 'MagnetizedPayload') then 'MagnetiteCores'
      when recipe ->> 'consumableType' in ('NanoSwarm', 'AdrenalineShot') then 'MycoSteelFiber'
      when v_kind = 'gear' then 'ForgeheartIngots'
      else null
    end;
    if v_catalyst is null then raise exception 'Recipe takes no catalyst'; end if;
    if v_bench < 2 then raise exception 'Catalysts require the Forge (bench 2)'; end if;
  end if;

  -- Legendary Core Catalyst (0026): gear frames only — one legendary
  -- core per unit escrowed at enqueue buys +2 generation draws per
  -- completed unit (the gear system's quality currency; consumables
  -- keep the material catalyst family). Mutually exclusive with the
  -- material catalyst, Forge-gated like it.
  if v_core_catalyst then
    if v_catalyst is not null then
      raise exception 'Choose one catalyst: material or legendary core';
    end if;
    if v_kind <> 'gear' then
      raise exception 'Legendary core catalyst applies to gear frames only';
    end if;
    if v_bench < 2 then raise exception 'Catalysts require the Forge (bench 2)'; end if;
    v_escrow_cores := v_units;
  end if;

  -- Verify the full escrow before taking any of it (atomicity).
  for v_key, v_per_unit in
    select key, value::numeric from jsonb_each_text(recipe -> 'inputs')
  loop
    v_escrow := jsonb_set(v_escrow, array[v_key], to_jsonb((v_per_unit * v_units)::bigint));
    if public.cc_is_material_key(v_key) then
      v_available := coalesce((p.materials ->> v_key)::integer, 0);
      if v_available < v_per_unit * v_units then
        raise exception 'Insufficient material %', v_key;
      end if;
    else
      v_available := coalesce((p.essences ->> v_key)::integer, 0);
      if v_available < v_per_unit * v_units then
        raise exception 'Insufficient essence %', v_key;
      end if;
    end if;
  end loop;
  if v_catalyst is not null then
    v_escrow_catalyst := jsonb_build_object(v_catalyst, v_units);
    if coalesce((p.materials ->> v_catalyst)::integer, 0) < v_units then
      raise exception 'Insufficient material %', v_catalyst;
    end if;
  end if;
  if v_escrow_cores > 0 and coalesce(p.legendary_cores, 0) < v_escrow_cores then
    raise exception 'Insufficient legendary cores';
  end if;
  v_ticket_count := coalesce((p.consumables ->> 'WorkshopRushTicket')::integer, 0);
  if coalesce(p_use_rush_ticket, false) and v_ticket_count < 1 then
    raise exception 'No Workshop Rush Ticket available';
  end if;

  -- Fitted tool snapshot for this bench.
  v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
  v_fitted := v_tools -> 'fitted' ->> v_bench::text;
  -- Tools are permanent (economy brief §9.2, 0067): a fitted tool
  -- applies on every job. The pre-0067 rule that read a fitted tool
  -- as absent at 0 stored charges is gone; stored charges are inert.
  if v_fitted = 'tool_precision_calipers' then
    v_tool_quality := 1.08;
  elsif v_fitted = 'tool_servo_bench_rig' then
    v_tool_duration := 0.85;
  elsif v_fitted = 'tool_reclaimer_head' then
    v_tool_yield := 0.05;
    v_tool_bonus := 0.10;
  elsif v_fitted is not null then
    v_fitted := null;
  end if;

  -- Rush ticket: escrowed at enqueue, burned at job start (FIFO,
  -- lowest quality first — the shipped burn order); its quality
  -- prices the reduction through the def's own scaling (0.2 base,
  -- capped at 0.45 — getConsumableRuntimeEffects' FULL_CHANCE mode).
  if coalesce(p_use_rush_ticket, false) then
    if not exists (select 1 from public.consumable_batches
                    where owner_user_id = actor
                      and consumable_type = 'WorkshopRushTicket' and quantity > 0) then
      perform public.cc_add_consumable_batch(actor, 'WorkshopRushTicket',
        v_ticket_count, 100, 'vendor', null, null, 'admin_adjust',
        'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
    end if;
    select origin into v_rush_origin from public.consumable_batches
     where owner_user_id = actor and consumable_type = 'WorkshopRushTicket'
       and quantity > 0
     order by quality_percent asc, created_at asc
     limit 1;
    v_consumed := public.cc_consume_consumable_batch(actor, 'WorkshopRushTicket', 1,
      'crafting', 'Workshop Rush Ticket', '{}'::jsonb);
    v_rush_quality := (v_consumed -> 'consumed' -> 0 ->> 'quality_percent')::numeric;
    -- The Fixer keystone raises the reduction cap (rush_cap_bonus).
    v_rush_reduction := least(0.45 + v_rush_cap_bonus, 0.2 * coalesce(v_rush_quality, 100) / 100);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, 'WorkshopRushTicket', -1),
           updated_at = now()
     where id = actor;
  end if;

  -- Take the escrow.
  for v_key, v_per_unit in select key, value::numeric from jsonb_each_text(v_escrow)
  loop
    if public.cc_is_material_key(v_key) then
      update public.profiles
         set materials = public.cc_jsonb_add_int(materials, v_key, -v_per_unit::integer),
             updated_at = now()
       where id = actor;
    else
      update public.profiles
         set essences = public.cc_jsonb_add_int(essences, v_key, -v_per_unit::integer),
             updated_at = now()
       where id = actor;
    end if;
  end loop;
  if v_catalyst is not null then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, v_catalyst, -v_units),
           updated_at = now()
     where id = actor;
  end if;
  if v_escrow_cores > 0 then
    update public.profiles
       set legendary_cores = legendary_cores - v_escrow_cores,
           updated_at = now()
     where id = actor;
  end if;

  -- Snapshotted unit duration: base x skill x tool x scalar x rush.
  -- The Fixer craft-speed term composes MULTIPLICATIVELY after the
  -- Scavenger term, under a combined 0.60x floor (0029).
  v_skill_mult := 1 - least(0.20, 0.02 * round(greatest(0, coalesce(p_efficiency_bonus, 0)) * 10));
  v_skill_mult := greatest(0.60, v_skill_mult * (1 - least(0.25, greatest(0, v_craft_speed_bonus))));
  if v_kind = 'gear' then
    v_base_duration := (recipe -> 'durationByRarityMs' ->> v_rarity)::bigint;
  else
    v_base_duration := (recipe ->> 'unitDurationMs')::bigint;
  end if;
  v_duration := greatest(1, round(
    v_base_duration * v_skill_mult * v_tool_duration * v_scalar * (1 - v_rush_reduction)
  ))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, escrow_cores, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (
    actor, v_bench, v_kind, p_recipe_id, v_units, v_duration,
    v_escrow, v_escrow_catalyst, v_escrow_cores, v_rush_quality, v_rush_origin,
    jsonb_build_object(
      'toolId', v_fitted,
      'toolQualityMultiplier', v_tool_quality,
      'toolDurationMultiplier', v_tool_duration,
      'toolRefineYieldBonus', v_tool_yield,
      'toolBonusUnitChance', v_tool_bonus,
      'skillDurationMultiplier', v_skill_mult,
      'rushReduction', v_rush_reduction,
      'craftTimeScalar', v_scalar,
      'catalystMaterialId', v_catalyst,
      'coreCatalyst', v_core_catalyst,
      'coreCatalystDrawBonus', v_core_draw_bonus,
      'gearRarity', case when v_kind = 'gear' then v_rarity else null end
    ))
  returning * into v_job;

  select * into p from public.profiles where id = actor;
  result := jsonb_build_object(
    'action_type', 'cc_enqueue_craft_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job),
    'escrow_cores', v_escrow_cores
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_craft_job', nonce, result);
  return result;
end;
$$;

-- §4. cc_enqueue_tint_job (restated from 0053): the tint Scrap leg
-- charges the stack (the escrow snapshot key stays 'Scrap').
create or replace function public.cc_enqueue_tint_job(
  p_player_id uuid, nonce text, item_id uuid, p_palette_id text
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
  item public.item_instances%rowtype;
  recipe jsonb;
  v_palette jsonb;
  v_chroma integer := 0;
  v_scrap integer := 0;
  v_bench integer := 0;
  v_i integer;
  v_escrow jsonb := '{}'::jsonb;
  v_job public.craft_jobs%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  recipe := public.cc_craft_recipe('tint_craft');
  if recipe is null then raise exception 'Unknown craft recipe'; end if;
  select elem into v_palette
    from jsonb_array_elements(recipe -> 'tintPalettes') as elem
   where elem ->> 'id' = p_palette_id
   limit 1;
  if v_palette is null then raise exception 'Unknown tint palette'; end if;
  v_chroma := coalesce((v_palette ->> 'chromaweave')::integer, 0);
  v_scrap := coalesce((recipe -> 'inputs' ->> 'Scrap')::integer, 0);

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.kind <> 'cosmetic' then raise exception 'Item is not a cosmetic part'; end if;
  if item.runtime_state <> 'available' or item.is_locked then
    raise exception 'Part is not available for tinting';
  end if;
  if coalesce(item.payload ->> 'tintPaletteId', '') = p_palette_id then
    raise exception 'Part already carries that tint';
  end if;
  if exists (select 1 from public.craft_jobs
              where owner_user_id = actor and kind = 'cosmetic' and status = 'active'
                and snapshot -> 'tint' ->> 'itemId' = item.id::text) then
    raise exception 'A tint job is already running for this part';
  end if;

  -- Verify the full escrow before taking any of it (atomicity):
  -- the recipe's flat Scrap leg plus the palette's Chromaweave.
  if coalesce((p.materials ->> 'Scrap')::bigint, 0) < v_scrap then raise exception 'Insufficient scrap'; end if;
  if v_chroma > 0
     and coalesce((p.materials ->> 'Chromaweave')::integer, 0) < v_chroma then
    raise exception 'Insufficient material Chromaweave';
  end if;

  -- First bench with queue room (same capacity rule as the generic
  -- enqueue: one running + five queued).
  for v_i in 1 .. greatest(1, coalesce(p.workshop_benches, 1)) loop
    if (select count(*) from public.craft_jobs
         where owner_user_id = actor and status = 'active' and bench = v_i) < 6 then
      v_bench := v_i;
      exit;
    end if;
  end loop;
  if v_bench = 0 then raise exception 'Bench queue is full'; end if;

  if v_scrap > 0 then
    v_escrow := jsonb_set(v_escrow, array['Scrap'], to_jsonb(v_scrap), true);
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, 'Scrap', -v_scrap), updated_at = now()
     where id = actor;
  end if;
  if v_chroma > 0 then
    v_escrow := jsonb_set(v_escrow, array['Chromaweave'], to_jsonb(v_chroma), true);
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, 'Chromaweave', -v_chroma),
           updated_at = now()
     where id = actor;
  end if;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (actor, v_bench, 'cosmetic', 'tint_craft', 1,
    (recipe ->> 'unitDurationMs')::bigint,
    v_escrow, '{}'::jsonb, null, null,
    jsonb_build_object(
      'toolId', null, 'toolQualityMultiplier', 1, 'toolDurationMultiplier', 1,
      'toolRefineYieldBonus', 0, 'toolBonusUnitChance', 0,
      'skillDurationMultiplier', 1, 'rushReduction', 0, 'craftTimeScalar', 1,
      'catalystMaterialId', null, 'gearRarity', null,
      'tint', jsonb_build_object(
        'itemId', item.id, 'paletteId', p_palette_id,
        'fromPaletteId', item.payload ->> 'tintPaletteId')))
  returning * into v_job;

  select * into p from public.profiles where id = actor;
  result := jsonb_build_object('action_type', 'cc_enqueue_tint_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_tint_job', nonce, result);
  return result;
end;
$$;

-- §4. cc_cancel_craft_job (restated from 0053): the escrow refund's
-- Scrap leg rides the generic material refund -- same schedule
-- (full for unstarted units, half-floored for the in-progress one).
create or replace function public.cc_cancel_craft_job(
  p_player_id uuid,
  nonce text,
  p_job_id uuid
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
  job public.craft_jobs%rowtype;
  v_started boolean;
  v_in_progress integer;
  v_unstarted integer;
  v_key text;
  v_total numeric;
  v_per_unit numeric;
  v_amount bigint;
  v_refunded jsonb := '{}'::jsonb;
  v_rush_refunded boolean := false;
  v_cores_refunded bigint := 0;
  v_i integer;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_craft_jobs(actor);
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into job from public.craft_jobs
   where id = p_job_id and owner_user_id = actor for update;
  if not found then raise exception 'Job not found'; end if;
  if job.status <> 'active' then raise exception 'Job is not active'; end if;

  if job.kind = 'repair' then
    -- Repair jobs (0025): kits are discrete items, not divisible
    -- inputs — every kit not yet applied refunds whole, including
    -- the in-progress unit's kit (it has not been applied yet).
    v_refunded := '{}'::jsonb;
    for v_i in job.units_completed .. job.units_total - 1 loop
      perform public.cc_add_consumable_batch(actor,
        job.snapshot -> 'repair' ->> 'kitType', 1,
        (job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
        coalesce(job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
        actor, null, 'repair_refund',
        'Patch kit refunded (repair job cancelled)', '{}'::jsonb);
    end loop;
    if job.units_total - job.units_completed > 0 then
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables,
               job.snapshot -> 'repair' ->> 'kitType',
               job.units_total - job.units_completed),
             updated_at = now()
       where id = actor;
      v_refunded := jsonb_build_object(
        job.snapshot -> 'repair' ->> 'kitType',
        job.units_total - job.units_completed);
    end if;
    update public.craft_jobs set status = 'cancelled' where id = job.id;
    select * into p from public.profiles where id = actor;
    result := jsonb_build_object(
      'action_type', 'cc_cancel_craft_job',
      'profile', public.cc_profile_snapshot(p),
      'job_id', job.id,
      'refunded_inputs', v_refunded,
      'rush_ticket_refunded', false
    );
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_cancel_craft_job', nonce, result);
    return result;
  end if;

  if job.kind = 'shieldtech' then
    -- Shield-tech jobs (0044): cores are discrete items, not
    -- divisible inputs — every core not yet applied refunds whole,
    -- including the in-progress unit's core (it has not been applied
    -- yet). Applied cores stay spent; the shield is unchanged (the
    -- flip only ever lands at full coverage, inside the completion
    -- that ends the job).
    v_refunded := '{}'::jsonb;
    for v_i in job.units_completed .. job.units_total - 1 loop
      perform public.cc_add_consumable_batch(actor,
        'CalibrationCore', 1,
        (job.snapshot -> 'shieldtech' -> 'coreQualities' ->> v_i)::numeric,
        coalesce(job.snapshot -> 'shieldtech' -> 'coreOrigins' ->> v_i, 'crafted'),
        actor, null, 'shieldtech_refund',
        'Calibration Core refunded (recalibration job cancelled)', '{}'::jsonb);
    end loop;
    if job.units_total - job.units_completed > 0 then
      update public.profiles
         set consumables = public.cc_jsonb_add_int(consumables,
               'CalibrationCore',
               job.units_total - job.units_completed),
             updated_at = now()
       where id = actor;
      v_refunded := jsonb_build_object(
        'CalibrationCore', job.units_total - job.units_completed);
    end if;
    update public.craft_jobs set status = 'cancelled' where id = job.id;
    select * into p from public.profiles where id = actor;
    result := jsonb_build_object(
      'action_type', 'cc_cancel_craft_job',
      'profile', public.cc_profile_snapshot(p),
      'job_id', job.id,
      'refunded_inputs', v_refunded,
      'rush_ticket_refunded', false
    );
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (actor, 'cc_cancel_craft_job', nonce, result);
    return result;
  end if;

  v_started := job.units_completed > 0 or job.accrued_ms > 0;
  v_in_progress := case when job.accrued_ms > 0 then 1 else 0 end;
  v_unstarted := job.units_total - job.units_completed - v_in_progress;

  for v_key, v_total in
    select key, value::numeric from jsonb_each_text(job.escrow_inputs)
  loop
    v_per_unit := v_total / job.units_total;
    v_amount := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_amount > 0 then
      v_refunded := jsonb_set(v_refunded, array[v_key],
        to_jsonb(coalesce((v_refunded ->> v_key)::bigint, 0) + v_amount), true);
      if public.cc_is_material_key(v_key) then
        update public.profiles
           set materials = public.cc_jsonb_add_int(materials, v_key, v_amount::integer),
               updated_at = now()
         where id = actor;
      else
        update public.profiles
           set essences = public.cc_jsonb_add_int(essences, v_key, v_amount::integer),
               updated_at = now()
         where id = actor;
      end if;
    end if;
  end loop;
  for v_key, v_total in
    select key, value::numeric from jsonb_each_text(job.escrow_catalyst)
  loop
    v_per_unit := v_total / job.units_total;
    v_amount := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_amount > 0 then
      v_refunded := jsonb_set(v_refunded, array[v_key],
        to_jsonb(coalesce((v_refunded ->> v_key)::bigint, 0) + v_amount), true);
      update public.profiles
         set materials = public.cc_jsonb_add_int(materials, v_key, v_amount::integer),
             updated_at = now()
       where id = actor;
    end if;
  end loop;

  -- Legendary cores (0026): escrowed cores refund on the material
  -- catalyst's schedule — full for unstarted units, half (floored)
  -- for the in-progress unit.
  if coalesce(job.escrow_cores, 0) > 0 then
    v_per_unit := job.escrow_cores::numeric / job.units_total;
    v_cores_refunded := (v_per_unit * v_unstarted)::bigint
      + case when v_in_progress = 1 then floor(v_per_unit * 0.5)::bigint else 0 end;
    if v_cores_refunded > 0 then
      update public.profiles
         set legendary_cores = legendary_cores + v_cores_refunded::integer,
             updated_at = now()
       where id = actor;
    end if;
  end if;

  if job.rush_ticket_quality is not null and not v_started then
    perform public.cc_add_consumable_batch(actor, 'WorkshopRushTicket', 1,
      job.rush_ticket_quality, coalesce(job.rush_ticket_origin, 'crafted'),
      actor, null, 'crafted', 'Rush ticket refunded (job cancelled before start)',
      '{}'::jsonb);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, 'WorkshopRushTicket', 1),
           updated_at = now()
     where id = actor;
    v_rush_refunded := true;
  end if;

  update public.craft_jobs set status = 'cancelled' where id = job.id;
  select * into p from public.profiles where id = actor;
  result := jsonb_build_object(
    'action_type', 'cc_cancel_craft_job',
    'profile', public.cc_profile_snapshot(p),
    'job_id', job.id,
    'refunded_inputs', v_refunded,
    'rush_ticket_refunded', v_rush_refunded,
    'cores_refunded', v_cores_refunded
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cancel_craft_job', nonce, result);
  return result;
end;
$$;

-- §4. cc_reforge_item (restated from 0027): the cost is still
-- ceil(salvageValue x 3 x reforgeScrapScalar) -- charged from the stack.
create or replace function public.cc_reforge_item(
  p_player_id uuid,
  nonce text,
  item_id uuid,
  affix_id text,
  p_expected_old_affix jsonb,
  p_new_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  item public.item_instances%rowtype;
  result jsonb;
  v_affixes jsonb;
  v_new_affixes jsonb;
  v_idx integer := -1;
  v_old_affix jsonb;
  v_new_affix jsonb;
  v_scalar numeric;
  v_core_cost numeric;
  v_scrap_cost bigint;
  v_cores_cost integer;
  i integer;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.is_locked then raise exception 'Locked item'; end if;
  if item.runtime_state <> 'available' then raise exception 'Item state invalid'; end if;
  if item.kind not in ('weapon', 'shield', 'classMod', 'relic', 'ordnance') then
    raise exception 'Item cannot be reforged';
  end if;

  -- Locate the affix entry in the CURRENT payload (server truth).
  v_affixes := coalesce(item.payload -> 'affixes', '[]'::jsonb);
  for i in 0 .. greatest(jsonb_array_length(v_affixes) - 1, -1) loop
    if v_affixes -> i ->> 'id' = affix_id then
      v_idx := i;
      v_old_affix := v_affixes -> i;
    end if;
  end loop;
  if v_idx < 0 then raise exception 'Affix not found'; end if;
  if coalesce(v_old_affix ->> 'category', '') = 'activity' then
    raise exception 'Affix cannot be reforged';
  end if;
  -- The roll was computed from this exact entry; a mismatch means
  -- the item changed under the request — refuse, charge nothing.
  if p_expected_old_affix is null or v_old_affix <> p_expected_old_affix then
    raise exception 'Item changed since the roll was computed';
  end if;

  -- Payload invariants: the new payload must be the same item with
  -- exactly the one affix entry swapped (derived stats recomputed
  -- by the shared TS module; identity fields pinned here).
  if p_new_payload is null then raise exception 'Reforge payload rejected'; end if;
  if (p_new_payload ->> 'id') is distinct from (item.payload ->> 'id')
     or (p_new_payload ->> 'rarity') is distinct from (item.payload ->> 'rarity')
     or (p_new_payload ->> 'level') is distinct from (item.payload ->> 'level')
     or (p_new_payload ->> 'legendaryEffectId') is distinct from (item.payload ->> 'legendaryEffectId')
     or (p_new_payload ->> 'element') is distinct from (item.payload ->> 'element')
     or (p_new_payload ->> 'weaponType') is distinct from (item.payload ->> 'weaponType')
     or (p_new_payload ->> 'manufacturer') is distinct from (item.payload ->> 'manufacturer')
     or (p_new_payload ->> 'treeBonus') is distinct from (item.payload ->> 'treeBonus')
     or (p_new_payload ->> 'effect') is distinct from (item.payload ->> 'effect')
     or (p_new_payload ->> 'behavior') is distinct from (item.payload ->> 'behavior')
     or (p_new_payload -> 'rollQuality') is distinct from (item.payload -> 'rollQuality')
     or (p_new_payload -> 'parts') is distinct from (item.payload -> 'parts')
     or (p_new_payload -> 'nodeBoosts') is distinct from (item.payload -> 'nodeBoosts')
  then
    raise exception 'Reforge payload rejected';
  end if;

  v_new_affixes := coalesce(p_new_payload -> 'affixes', '[]'::jsonb);
  if jsonb_array_length(v_new_affixes) <> jsonb_array_length(v_affixes) then
    raise exception 'Reforge payload rejected';
  end if;
  for i in 0 .. greatest(jsonb_array_length(v_affixes) - 1, -1) loop
    if i <> v_idx and (v_new_affixes -> i) is distinct from (v_affixes -> i) then
      raise exception 'Reforge payload rejected';
    end if;
  end loop;
  v_new_affix := v_new_affixes -> v_idx;
  -- The replacement must actually replace: a different entry, the
  -- generator's id convention for its slot, and no stat duplicated
  -- across the item's other affixes — unless it is the replaced
  -- affix's own stat re-rolled (the pool-exhausted fallback, whose
  -- value must then differ, which the entry-difference check pins).
  if v_new_affix is null or v_new_affix = v_old_affix
     or (v_new_affix ->> 'id') is distinct from ((v_new_affix ->> 'stat') || '_' || v_idx::text)
     or coalesce(v_new_affix ->> 'category', '') = 'activity'
  then
    raise exception 'Reforge payload rejected';
  end if;
  if (v_new_affix ->> 'stat') <> (v_old_affix ->> 'stat')
     and exists (
       select 1 from jsonb_array_elements(v_new_affixes) as e(affix)
        where (e.affix ->> 'stat') = (v_new_affix ->> 'stat')
          and (e.affix ->> 'id') <> (v_new_affix ->> 'id')
     )
  then
    raise exception 'Reforge payload rejected';
  end if;

  -- Cost: recomputed here from the lever table — the charging
  -- authority (mirrors reforgeCostFor in src/content/reforge.ts).
  v_scalar := public.cc_economy_config_number('reforgeScrapScalar', 1);
  v_core_cost := public.cc_economy_config_number('reforgeLegendaryCoreCost', 2);
  v_scrap_cost := ceil(public.cc_salvage_scrap(item.rarity, item.item_level) * 3 * v_scalar)::bigint;
  v_cores_cost := case when item.rarity = 'Legendary' then floor(v_core_cost)::integer else 0 end;

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce((p.materials ->> 'Scrap')::bigint, 0) < v_scrap_cost then raise exception 'Insufficient scrap'; end if;
  if coalesce(p.legendary_cores, 0) < v_cores_cost then raise exception 'Insufficient legendary cores'; end if;

  update public.profiles
     set materials = public.cc_jsonb_add_int(materials, 'Scrap', -v_scrap_cost::integer),
         legendary_cores = legendary_cores - v_cores_cost
   where id = actor
   returning * into p;

  update public.item_instances
     set payload = p_new_payload,
         estimated_value = public.cc_compute_item_estimated_value(
           p_new_payload, item.kind, item.rarity, item.item_level)
   where id = item.id
   returning * into item;

  result := jsonb_build_object(
    'action_type', 'cc_reforge_item',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'old_affix', v_old_affix,
    'new_affix', v_new_affix,
    'scrap_charged', v_scrap_cost,
    'cores_charged', v_cores_cost
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_reforge_item', nonce, result);
  return result;
end;
$function$;

-- §4. cc_reroll_contract (restated from 0042): reroll costs (100 /
-- 400 by board cadence, lever-driven) charge the stack.
create or replace function public.cc_reroll_contract(
  p_player_id uuid,
  p_nonce text,
  p_instance_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.profiles%rowtype;
  inst public.contract_instances%rowtype;
  v_replay jsonb;
  v_progress jsonb;
  v_end timestamptz;
  v_used integer;
  v_cost bigint;
  v_free boolean;
  v_exclude text[];
  v_families text[];
  v_band_index integer;
  v_draw jsonb;
  v_terms jsonb;
  v_new_id uuid;
  v_seed text;
  v_result jsonb;
begin
  if p_player_id is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(p_nonce) < 8 then raise exception 'A reroll nonce is required'; end if;

  perform pg_advisory_xact_lock(hashtext(p_player_id::text));

  select * into p from public.profiles where id = p_player_id for update;
  if not found then raise exception 'Profile not found'; end if;

  select result_payload into v_replay from public.verified_action_ledger
   where user_id = p_player_id and idempotency_key = p_nonce
     and action_type = 'cc_reroll_contract';
  if v_replay is not null then return v_replay; end if;

  select * into inst from public.contract_instances where id = p_instance_id and user_id = p_player_id;
  if not found then raise exception 'Contract not found'; end if;
  if inst.status = 'claimed' then raise exception 'Claimed contracts cannot be rerolled'; end if;
  if inst.status = 'rerolled' then raise exception 'Contract already rerolled'; end if;

  v_end := (inst.period_key || 'T00:00:00Z')::timestamptz
    + (case when inst.period_kind = 'daily' then interval '1 day' else interval '7 days' end);
  if now() >= v_end then raise exception 'Contract expired — the window has closed'; end if;

  v_progress := public.cc_contract_progress(p_instance_id);
  if coalesce((v_progress ->> 'complete')::boolean, false) then
    raise exception 'Contract complete — claim it or let it expire';
  end if;

  select count(*) into v_used from public.contract_instances
   where user_id = p_player_id and period_kind = inst.period_kind
     and period_key = inst.period_key and status = 'rerolled';
  v_free := v_used < 1;
  if v_free then
    v_cost := 0;
  elsif inst.period_kind = 'daily' then
    v_cost := greatest(0, least(1000,
      public.cc_economy_config_number('contractRerollScrapDaily', 100)))::bigint;
  else
    v_cost := greatest(0, least(5000,
      public.cc_economy_config_number('contractRerollScrapWeekly', 400)))::bigint;
  end if;
  if v_cost > 0 and coalesce((p.materials ->> 'Scrap')::bigint, 0) < v_cost then
    raise exception 'Insufficient scrap for a reroll';
  end if;

  -- The set as it stands (current generation per slot), templates
  -- excluded wholesale; the family cap counts the OTHER members.
  select coalesce(array_agg(cur.template_id), '{}'::text[]),
         coalesce(array_agg(d.family) filter (where cur.slot <> inst.slot), '{}'::text[])
    into v_exclude, v_families
    from public.contract_instances cur
    join public.contract_template_definitions d on d.template_id = cur.template_id
   where cur.user_id = p_player_id
     and cur.period_kind = inst.period_kind
     and cur.period_key = inst.period_key
     and cur.generation = (
       select max(g.generation) from public.contract_instances g
        where g.user_id = cur.user_id and g.period_kind = cur.period_kind
          and g.period_key = cur.period_key and g.slot = cur.slot);

  select band_index into v_band_index from public.contract_bands where band_id = inst.band;

  v_seed := 'contracts:reroll:' || inst.period_kind || ':' || inst.period_key || ':'
    || p_player_id::text || ':' || inst.slot::text || ':' || (inst.generation + 1)::text;
  v_draw := public.cc_contract_draw_reroll(v_seed, inst.period_kind, v_band_index, v_exclude, v_families);
  if v_draw is null then raise exception 'No replacement contract available on this board'; end if;

  v_terms := public.cc_contract_terms(p_player_id, v_draw ->> 'template_id', inst.period_kind, v_band_index);

  if v_cost > 0 then
    update public.profiles set materials = public.cc_jsonb_add_int(materials, 'Scrap', -v_cost::integer), updated_at = now() where id = p_player_id;
  end if;

  update public.contract_instances set status = 'rerolled' where id = p_instance_id;

  insert into public.contract_instances (
    user_id, period_kind, period_key, slot, generation, template_id, band,
    params, baseline, target, reward, status
  ) values (
    p_player_id, inst.period_kind, inst.period_key, inst.slot, inst.generation + 1,
    v_draw ->> 'template_id', inst.band, coalesce(v_draw -> 'params', '{}'::jsonb),
    v_terms -> 'baseline', (v_terms ->> 'target')::integer, v_terms -> 'reward', 'active'
  ) returning id into v_new_id;

  select * into p from public.profiles where id = p_player_id;

  v_result := jsonb_build_object(
    'action_type', 'cc_reroll_contract',
    'instance_id', v_new_id,
    'replaced_instance_id', inst.id,
    'template_id', v_draw ->> 'template_id',
    'period_kind', inst.period_kind,
    'period_key', inst.period_key,
    'scrap_charged', v_cost,
    'free_reroll', v_free,
    'profile', public.cc_profile_snapshot(p)
  );

  insert into public.verified_action_ledger (user_id, action_type, idempotency_key, result_payload)
  values (p_player_id, 'cc_reroll_contract', p_nonce, v_result);

  return v_result;
end;
$$;

-- §5. cc_profile_snapshot (restated from 0031): the payload's scrap
-- key now reports the stack; the wire shape is unchanged.
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
    'cache_rank_tokens', coalesce(profile_row.cache_rank_tokens, 0),
    'cache_rank_grant_level', coalesce(profile_row.cache_rank_grant_level, 0),
    'cache_rank_spends', coalesce(profile_row.cache_rank_spends, '{}'::jsonb),
    'boss_state', profile_row.boss_state,
    'last_idle_claim_at', profile_row.last_idle_claim_at
  );
$function$;

-- §5. player_public_stats (restated from 0040): scrap reads the
-- stack. cc_compute_player_snapshot reads this view, so progression
-- snapshots follow with no restatement of their own.
create or replace view public.player_public_stats as
select
  p.id as user_id,
  p.username,
  p.display_name,
  p.player_level,
  p.player_xp,
  p.credits,
  coalesce((p.materials ->> 'Scrap')::bigint, 0) as scrap,
  p.cache_tokens,
  p.cache_token_parts,
  coalesce(c.total_kills, 0) as total_kills,
  coalesce(c.total_deaths, 0) as total_deaths,
  (coalesce(c.total_kills, 0)::numeric / nullif(c.total_deaths, 0)::numeric) as kill_death_ratio,
  coalesce(c.highest_boss_tier, 0) as highest_boss_tier,
  coalesce(c.longest_kill_streak, 0) as longest_kill_streak,
  coalesce(c.active_play_seconds, 0) as active_play_seconds,
  coalesce(c.idle_play_seconds, 0) as idle_play_seconds,
  coalesce(c.kills_by_area, '{}'::jsonb) as kills_by_area,
  coalesce(c.kills_by_weapon_type, '{}'::jsonb) as kills_by_weapon_type,
  coalesce(c.kills_by_element, '{}'::jsonb) as kills_by_element,
  coalesce(psc.stat_value, 0) as net_worth,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind <> 'vehicle' and not (ii.kind = 'weapon' and ii.payload -> 'baseDamage' is null)) as total_items,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind = 'weapon' and ii.payload -> 'baseDamage' is not null) as weapons_owned,
  (select count(*) from public.item_instances ii where ii.owner_user_id = p.id and ii.rarity = 'Legendary' and ii.kind <> 'vehicle' and not (ii.kind = 'weapon' and ii.payload -> 'baseDamage' is null)) as legendary_items,
  (select coalesce(max(ii.item_level), 0) from public.item_instances ii where ii.owner_user_id = p.id and ii.kind <> 'vehicle' and not (ii.kind = 'weapon' and ii.payload -> 'baseDamage' is null)) as highest_item_level,
  (select coalesce(sum(pm.mastery_xp), 0) from public.player_masteries pm where pm.user_id = p.id) as total_mastery_xp,
  (select coalesce(max(pm.mastery_level), 0) from public.player_masteries pm where pm.user_id = p.id) as highest_mastery_level,
  p.updated_at as last_active_at,
  p.created_at as joined_at
from public.profiles p
left join public.combat_stats c on c.user_id = p.id
left join public.player_stat_counters psc on psc.user_id = p.id and psc.stat_key = 'account.net_worth';

-- §5. cc_recalculate_net_worth (restated from 0004): net worth keeps
-- counting the hunter's scrap wealth -- now the stack.
CREATE OR REPLACE FUNCTION public.cc_recalculate_net_worth(_player_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_credits bigint;
  v_scrap bigint;
  v_items bigint;
  v_total bigint;
begin
  if _player_id is null then return 0; end if;

  select coalesce(credits, 0), coalesce((materials ->> 'Scrap')::bigint, 0)
    into v_credits, v_scrap
    from public.profiles
   where id = _player_id;

  if not found then return 0; end if;

  select coalesce(sum(estimated_value), 0)
    into v_items
    from public.item_instances
   where owner_user_id = _player_id;

  v_total := v_credits + v_scrap + v_items;
  v_total := greatest(0, v_total);

  perform public.cc_set_stat(_player_id, 'account.net_worth', v_total);
  perform public.cc_set_mastery_xp(_player_id, 'account.net_worth', v_total);

  return v_total;
end;
$function$;

-- §5. cc_reset_progress (restated from 0004): the reset reseeds the
-- starting 500 into the stack and zeroes the retired column.
CREATE OR REPLACE FUNCTION public.cc_reset_progress(p_player_id uuid, nonce text)
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
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger
  where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  delete from public.service_jobs
  where owner_user_id = actor or provider_user_id = actor;

  delete from public.market_listings
  where seller_user_id = actor
     or item_instance_id in (
       select id from public.item_instances where owner_user_id = actor
     );

  delete from public.escrow_records
  where payer_user_id = actor or payee_user_id = actor;

  delete from public.item_instances
  where owner_user_id = actor;

  delete from public.consumable_events where user_id = actor;
  delete from public.consumable_batches where owner_user_id = actor;
  delete from public.player_professions where user_id = actor;
  delete from public.active_actions where user_id = actor;
  delete from public.player_stat_counters where user_id = actor;
  delete from public.player_masteries where user_id = actor;
  delete from public.player_runtime_snapshots where user_id = actor;

  update public.profiles
  set player_level = 1,
      player_xp = 0,
      credits = 5000,
      scrap = 0,
      cache_tokens = 3,
      cache_token_parts = 0,
      materials = '{"Scrap": 500}'::jsonb,
      essences = '{}'::jsonb,
      consumables = '{}'::jsonb,
      skill_spends = '{}'::jsonb,
      boss_state = jsonb_build_object('initial_bundle_claimed', true),
      last_idle_claim_at = now(),
      updated_at = now()
  where id = actor
  returning * into p;

  if not found then raise exception 'Profile not found'; end if;

  result := jsonb_build_object('action_type', 'cc_reset_progress', 'profile', public.cc_profile_snapshot(p));

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_reset_progress', nonce, result);

  return result;
end;
$function$;

-- =====================================================================
-- §6. The rename's stored-data rewrites (brief §3.3 steps 2-4)
-- =====================================================================

-- In-flight craft_jobs (step 3): escrow snapshots keyed 'ScrapAlloy'
-- are rekeyed to 'Scrap', folding into an existing 'Scrap' leg if a
-- job somehow carries both, so a job enqueued before the merge
-- settles and refunds against the merged stack.
update public.craft_jobs
   set escrow_inputs = (escrow_inputs - 'ScrapAlloy')
         || jsonb_build_object('Scrap',
              coalesce((escrow_inputs ->> 'Scrap')::bigint, 0)
              + (escrow_inputs ->> 'ScrapAlloy')::bigint)
 where status = 'active' and escrow_inputs ? 'ScrapAlloy';

update public.craft_jobs
   set escrow_catalyst = (escrow_catalyst - 'ScrapAlloy')
         || jsonb_build_object('Scrap',
              coalesce((escrow_catalyst ->> 'Scrap')::bigint, 0)
              + (escrow_catalyst ->> 'ScrapAlloy')::bigint)
 where status = 'active' and coalesce(escrow_catalyst, '{}'::jsonb) ? 'ScrapAlloy';

-- Open market listings (step 4): the good is the same good renamed;
-- price, quantity, and seller are untouched.
update public.market_listings
   set material_id = 'Scrap', identity_key = 'mat:Scrap'
 where material_id = 'ScrapAlloy' and status = 'active';

-- Unsettled dispatch missions: a mission that departed before the
-- merge with a ScrapAlloy payout line settles into the merged stack.
update public.dispatch_missions
   set payout_material_id = 'Scrap'
 where payout_material_id = 'ScrapAlloy' and status = 'active';

-- §6. cc_vendor_catalog (restated from 0021): the material row is
-- renamed with the good; the 10 cr price is unchanged (brief §3.3
-- step 5 -- slice 6 removes the vendor's scrap line outright).
create or replace function public.cc_vendor_catalog()
returns table(item_key text, base_price integer, pool text)
language sql
immutable
set search_path = public
as $$
  values
    -- Staples (consumable defs with market.vendorStocked)
    ('MedKit', 250, 'staple'),
    ('ShieldCell', 300, 'staple'),
    ('AmmoPack', 150, 'staple'),
    ('Grenade', 400, 'staple'),
    ('BossScanner', 600, 'staple'),
    ('InsuranceToken', 800, 'staple'),
    ('LuckBooster', 350, 'staple'),
    ('GenericFuelCell', 40, 'staple'),
    ('PatchKit', 150, 'staple'),
    -- Rotation consumables (priced, player-marketable, not staples)
    ('MedKitRefined', 600, 'rotation'),
    ('NanoSwarm', 800, 'rotation'),
    ('AdrenalineShot', 1200, 'rotation'),
    ('HighCapacityAmmoPack', 375, 'rotation'),
    ('ArmorPiercingAmmo', 400, 'rotation'),
    ('IncendiaryAmmo', 450, 'rotation'),
    ('ShockAmmo', 450, 'rotation'),
    ('CorrosiveAmmo', 450, 'rotation'),
    ('CryoAmmo', 450, 'rotation'),
    ('VoidAmmo', 700, 'rotation'),
    ('OrdnanceCharge', 400, 'rotation'),
    ('EMPCharge', 650, 'rotation'),
    ('CorrosiveCharge', 650, 'rotation'),
    ('PhaseShiftGrenade', 1000, 'rotation'),
    ('MagnetizedPayload', 650, 'rotation'),
    ('OverchargeStim', 800, 'rotation'),
    ('TargetPainter', 600, 'rotation'),
    ('Jammer', 750, 'rotation'),
    ('SignalScrambler', 500, 'rotation'),
    ('LootBeacon', 900, 'rotation'),
    ('DataSkimmer', 900, 'rotation'),
    ('SalvageContract', 700, 'rotation'),
    ('WorkshopRushTicket', 1000, 'rotation'),
    -- Materials (profile counters; rotation pool + buyback values)
    ('Scrap', 10, 'material'),
    ('BallisticParts', 15, 'material'),
    ('ReactiveComponents', 20, 'material'),
    ('TechFragments', 35, 'material'),
    ('VoidDust', 75, 'material'),
    -- Essences (profile counters; rotation pool + buyback values)
    ('IgnitionFluid', 30, 'essence'),
    ('ConduitWire', 30, 'essence'),
    ('AcidCompound', 30, 'essence'),
    ('CryoGel', 30, 'essence'),
    ('VoidEssence', 90, 'essence')
$$;
-- §6. cc_craft_recipe_catalog (restated from 0057): every recipe
-- input key ScrapAlloy -> Scrap at the SAME literal amount (brief
-- §3.3 step 2) -- the merge is behavior-preserving per recipe. No
-- other catalog field changes.
create or replace function public.cc_craft_recipe_catalog()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select $catalog$
[
  {
    "id": "recipe_medkit",
    "kind": "consumable",
    "name": "Med Kit",
    "category": "survival",
    "inputs": {
      "Scrap": 15,
      "ReactiveComponents": 8
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MedKit"
  },
  {
    "id": "recipe_medkit_refined",
    "kind": "consumable",
    "name": "Med Kit (Refined)",
    "category": "survival",
    "inputs": {
      "Scrap": 25,
      "ReactiveComponents": 15,
      "VoidDust": 1
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MedKitRefined"
  },
  {
    "id": "recipe_shieldcell",
    "kind": "consumable",
    "name": "Shield Cell",
    "category": "survival",
    "inputs": {
      "Scrap": 20,
      "ReactiveComponents": 12
    },
    "unitDurationMs": 900000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShieldCell"
  },
  {
    "id": "recipe_nanoswarm",
    "kind": "consumable",
    "name": "Nano-Swarm",
    "category": "survival",
    "inputs": {
      "Scrap": 30,
      "ReactiveComponents": 20,
      "VoidDust": 2
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "NanoSwarm"
  },
  {
    "id": "recipe_adrenaline",
    "kind": "consumable",
    "name": "Adrenaline Shot",
    "category": "survival",
    "inputs": {
      "Scrap": 40,
      "ReactiveComponents": 25,
      "VoidDust": 3
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "AdrenalineShot"
  },
  {
    "id": "recipe_ammo_pack",
    "kind": "consumable",
    "name": "Ammo Pack",
    "category": "offense",
    "inputs": {
      "Scrap": 10,
      "BallisticParts": 6
    },
    "unitDurationMs": 600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "AmmoPack"
  },
  {
    "id": "recipe_high_capacity_ammo_pack",
    "kind": "consumable",
    "name": "High-Capacity Ammo Pack",
    "category": "offense",
    "inputs": {
      "Scrap": 18,
      "BallisticParts": 12,
      "TechFragments": 2
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "HighCapacityAmmoPack"
  },
  {
    "id": "recipe_ap_ammo",
    "kind": "consumable",
    "name": "Armor-Piercing Ammo",
    "category": "offense",
    "inputs": {
      "Scrap": 15,
      "BallisticParts": 10
    },
    "unitDurationMs": 900000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ArmorPiercingAmmo"
  },
  {
    "id": "recipe_fire_ammo",
    "kind": "consumable",
    "name": "Incendiary Ammo",
    "category": "offense",
    "inputs": {
      "Scrap": 15,
      "BallisticParts": 8,
      "IgnitionFluid": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "IncendiaryAmmo"
  },
  {
    "id": "recipe_shock_ammo",
    "kind": "consumable",
    "name": "Shock Ammo",
    "category": "offense",
    "inputs": {
      "Scrap": 15,
      "BallisticParts": 8,
      "ConduitWire": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShockAmmo"
  },
  {
    "id": "recipe_corrosive_ammo",
    "kind": "consumable",
    "name": "Corrosive Ammo",
    "category": "offense",
    "inputs": {
      "Scrap": 15,
      "BallisticParts": 8,
      "AcidCompound": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CorrosiveAmmo"
  },
  {
    "id": "recipe_cryo_ammo",
    "kind": "consumable",
    "name": "Cryo Ammo",
    "category": "offense",
    "inputs": {
      "Scrap": 15,
      "BallisticParts": 8,
      "CryoGel": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CryoAmmo"
  },
  {
    "id": "recipe_void_ammo",
    "kind": "consumable",
    "name": "Void Ammo",
    "category": "offense",
    "inputs": {
      "Scrap": 20,
      "BallisticParts": 10,
      "VoidEssence": 5
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "VoidAmmo"
  },
  {
    "id": "recipe_ordnance",
    "kind": "consumable",
    "name": "Ordnance Charge",
    "category": "offense",
    "inputs": {
      "Scrap": 12,
      "BallisticParts": 10
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OrdnanceCharge"
  },
  {
    "id": "recipe_emp_charge",
    "kind": "consumable",
    "name": "EMP Charge",
    "category": "offense",
    "inputs": {
      "Scrap": 18,
      "BallisticParts": 8,
      "ConduitWire": 4,
      "TechFragments": 2
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "EMPCharge"
  },
  {
    "id": "recipe_corrosive_charge",
    "kind": "consumable",
    "name": "Corrosive Charge",
    "category": "offense",
    "inputs": {
      "Scrap": 18,
      "BallisticParts": 8,
      "AcidCompound": 4,
      "TechFragments": 2
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "CorrosiveCharge"
  },
  {
    "id": "recipe_overcharge",
    "kind": "consumable",
    "name": "Overcharge Stim",
    "category": "offense",
    "inputs": {
      "Scrap": 25,
      "BallisticParts": 15,
      "VoidDust": 2
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OverchargeStim"
  },
  {
    "id": "recipe_targetpainter",
    "kind": "consumable",
    "name": "Target Painter",
    "category": "offense",
    "inputs": {
      "Scrap": 20,
      "BallisticParts": 10,
      "TechFragments": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "TargetPainter"
  },
  {
    "id": "recipe_phaseshift",
    "kind": "consumable",
    "name": "Phase Shift Grenade",
    "category": "offense",
    "inputs": {
      "Scrap": 30,
      "BallisticParts": 15,
      "VoidDust": 5
    },
    "unitDurationMs": 2100000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PhaseShiftGrenade"
  },
  {
    "id": "recipe_luck",
    "kind": "consumable",
    "name": "Luck Booster",
    "category": "utility",
    "inputs": {
      "Scrap": 15,
      "TechFragments": 8
    },
    "unitDurationMs": 900000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "LuckBooster"
  },
  {
    "id": "recipe_scanner",
    "kind": "consumable",
    "name": "Boss Scanner",
    "category": "utility",
    "inputs": {
      "Scrap": 20,
      "TechFragments": 12
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "BossScanner"
  },
  {
    "id": "recipe_insurance",
    "kind": "consumable",
    "name": "Insurance Token",
    "category": "utility",
    "inputs": {
      "Scrap": 30,
      "TechFragments": 15,
      "VoidDust": 2
    },
    "unitDurationMs": 2100000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "InsuranceToken"
  },
  {
    "id": "recipe_dataskimmer",
    "kind": "consumable",
    "name": "Data Skimmer",
    "category": "utility",
    "inputs": {
      "Scrap": 25,
      "TechFragments": 15,
      "VoidDust": 3
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "DataSkimmer"
  },
  {
    "id": "recipe_jammer",
    "kind": "consumable",
    "name": "Jammer",
    "category": "utility",
    "inputs": {
      "Scrap": 20,
      "TechFragments": 10,
      "ConduitWire": 2
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "Jammer"
  },
  {
    "id": "recipe_magnetized",
    "kind": "consumable",
    "name": "Magnetized Payload",
    "category": "utility",
    "inputs": {
      "Scrap": 15,
      "BallisticParts": 10,
      "TechFragments": 5
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MagnetizedPayload"
  },
  {
    "id": "recipe_signal_scrambler",
    "kind": "consumable",
    "name": "Signal Scrambler",
    "category": "utility",
    "inputs": {
      "Scrap": 15,
      "TechFragments": 10,
      "ConduitWire": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "SignalScrambler"
  },
  {
    "id": "recipe_loot_beacon",
    "kind": "consumable",
    "name": "Loot Beacon",
    "category": "utility",
    "inputs": {
      "Scrap": 20,
      "TechFragments": 14,
      "VoidDust": 2
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "LootBeacon"
  },
  {
    "id": "recipe_salvage_contract",
    "kind": "consumable",
    "name": "Salvage Contract",
    "category": "utility",
    "inputs": {
      "Scrap": 12,
      "TechFragments": 8
    },
    "unitDurationMs": 960000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "SalvageContract"
  },
  {
    "id": "recipe_workshop_rush_ticket",
    "kind": "consumable",
    "name": "Workshop Rush Ticket",
    "category": "utility",
    "inputs": {
      "Scrap": 18,
      "TechFragments": 12,
      "VoidDust": 1
    },
    "unitDurationMs": 1440000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "WorkshopRushTicket"
  },
  {
    "id": "recipe_patch_kit",
    "kind": "consumable",
    "name": "Patch Kit",
    "category": "utility",
    "inputs": {
      "Scrap": 4,
      "ReactiveComponents": 1
    },
    "unitDurationMs": 720000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PatchKit"
  },
  {
    "id": "recipe_field_patch_kit",
    "kind": "consumable",
    "name": "Field Patch Kit",
    "category": "utility",
    "inputs": {
      "Scrap": 6,
      "ReactiveComponents": 3,
      "TechFragments": 1,
      "HeartwoodResin": 1
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "FieldPatchKit"
  },
  {
    "id": "recipe_master_patch_kit",
    "kind": "consumable",
    "name": "Master Patch Kit",
    "category": "utility",
    "inputs": {
      "Scrap": 8,
      "ReactiveComponents": 5,
      "TechFragments": 3,
      "VoidDust": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "MasterPatchKit",
    "requiresMastery": {
      "track": "crafting_consumables",
      "level": 15
    }
  },
  {
    "id": "recipe_fuel_cell",
    "kind": "consumable",
    "name": "Fuel Cell",
    "category": "utility",
    "inputs": {
      "Scrap": 6,
      "NitrocellGel": 1
    },
    "unitDurationMs": 900000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "FuelCell"
  },
  {
    "id": "recipe_calibration_core",
    "kind": "consumable",
    "name": "Calibration Core",
    "category": "utility",
    "inputs": {
      "ReactiveComponents": 20,
      "TechFragments": 15,
      "PrismShards": 2,
      "VoidDust": 2
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "consumableType": "CalibrationCore"
  },
  {
    "id": "refine_refined_alloy",
    "kind": "refine",
    "name": "Refined Alloy",
    "category": "refining",
    "inputs": {
      "Scrap": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "RefinedAlloy",
    "outputBase": 8
  },
  {
    "id": "refine_tempered_parts",
    "kind": "refine",
    "name": "Tempered Parts",
    "category": "refining",
    "inputs": {
      "BallisticParts": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "TemperedParts",
    "outputBase": 8
  },
  {
    "id": "refine_stabilized_cells",
    "kind": "refine",
    "name": "Stabilized Cells",
    "category": "refining",
    "inputs": {
      "ReactiveComponents": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "StabilizedCells",
    "outputBase": 8
  },
  {
    "id": "refine_woven_circuits",
    "kind": "refine",
    "name": "Woven Circuits",
    "category": "refining",
    "inputs": {
      "TechFragments": 10
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "WovenCircuits",
    "outputBase": 8
  },
  {
    "id": "refine_condensed_void",
    "kind": "refine",
    "name": "Condensed Void",
    "category": "refining",
    "inputs": {
      "VoidDust": 10
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "crusher",
    "outputMaterial": "CondensedVoid",
    "outputBase": 8
  },
  {
    "id": "refine_composite_plating",
    "kind": "refine",
    "name": "Composite Plating",
    "category": "refining",
    "inputs": {
      "RefinedAlloy": 4,
      "StabilizedCells": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "CompositePlating",
    "outputBase": 2
  },
  {
    "id": "refine_circuit_lattice",
    "kind": "refine",
    "name": "Circuit Lattice",
    "category": "refining",
    "inputs": {
      "WovenCircuits": 4,
      "TemperedParts": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "CircuitLattice",
    "outputBase": 2
  },
  {
    "id": "refine_voidweave",
    "kind": "refine",
    "name": "Voidweave",
    "category": "refining",
    "inputs": {
      "CondensedVoid": 2,
      "WovenCircuits": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "furnace",
    "outputMaterial": "Voidweave",
    "outputBase": 2
  },
  {
    "id": "refine_chromaweave",
    "kind": "refine",
    "name": "Chromaweave",
    "category": "refining",
    "inputs": {
      "MycoSteelFiber": 2,
      "VoidEssence": 1
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "furnace",
    "outputMaterial": "Chromaweave",
    "outputBase": 2
  },
  {
    "id": "frame_weapon",
    "kind": "gear",
    "name": "Weapon Frame",
    "category": "gear",
    "inputs": {
      "RefinedAlloy": 6,
      "TemperedParts": 4,
      "ForgeheartIngots": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "weapon",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_shield",
    "kind": "gear",
    "name": "Shield Frame",
    "category": "gear",
    "inputs": {
      "StabilizedCells": 6,
      "RefinedAlloy": 4,
      "HeartwoodResin": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "shield",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_class_mod",
    "kind": "gear",
    "name": "Class Mod Frame",
    "category": "gear",
    "inputs": {
      "WovenCircuits": 5,
      "CircuitLattice": 2,
      "PrismShards": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "classMod",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_relic",
    "kind": "gear",
    "name": "Relic Frame",
    "category": "gear",
    "inputs": {
      "CondensedVoid": 4,
      "Voidweave": 2,
      "MycoSteelFiber": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "relic",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "frame_ordnance",
    "kind": "gear",
    "name": "Ordnance Frame",
    "category": "gear",
    "inputs": {
      "TemperedParts": 6,
      "StabilizedCells": 3,
      "ForgeheartIngots": 2
    },
    "unitDurationMs": 0,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "ordnance",
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    }
  },
  {
    "id": "tool_precision_calipers",
    "kind": "tool",
    "name": "Precision Calipers",
    "category": "tools",
    "inputs": {
      "CircuitLattice": 2,
      "PrismShards": 2
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_precision_calipers"
  },
  {
    "id": "tool_servo_bench_rig",
    "kind": "tool",
    "name": "Servo Bench Rig",
    "category": "tools",
    "inputs": {
      "CompositePlating": 2,
      "MagnetiteCores": 2
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_servo_bench_rig"
  },
  {
    "id": "tool_reclaimer_head",
    "kind": "tool",
    "name": "Reclaimer Head",
    "category": "tools",
    "inputs": {
      "CompositePlating": 1,
      "CircuitLattice": 1,
      "Voidweave": 1
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "toolId": "tool_reclaimer_head"
  },
  {
    "id": "recipe_shield_cell_batch",
    "kind": "consumable",
    "name": "Shield Cell ×3 (Batch)",
    "category": "survival",
    "inputs": {
      "Scrap": 50,
      "ReactiveComponents": 30
    },
    "unitDurationMs": 1980000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ShieldCell",
    "outputQuantity": 3,
    "requiresResearch": "production_systems"
  },
  {
    "id": "recipe_patch_kit_batch",
    "kind": "consumable",
    "name": "Patch Kit ×3 (Batch)",
    "category": "utility",
    "inputs": {
      "Scrap": 10,
      "ReactiveComponents": 3
    },
    "unitDurationMs": 1584000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PatchKit",
    "outputQuantity": 3,
    "requiresResearch": "production_systems"
  },
  {
    "id": "recipe_ordnance_batch",
    "kind": "consumable",
    "name": "Ordnance Charge ×3 (Batch)",
    "category": "offense",
    "inputs": {
      "Scrap": 30,
      "BallisticParts": 25
    },
    "unitDurationMs": 1584000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OrdnanceCharge",
    "outputQuantity": 3,
    "requiresResearch": "production_systems"
  },
  {
    "id": "recipe_redline_standing",
    "kind": "consumable",
    "name": "Redline Tonic",
    "category": "offense",
    "inputs": {
      "BallisticParts": 12,
      "NitrocellGel": 2,
      "ReactiveComponents": 6
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "RedlineTonic",
    "requiresStanding": {
      "manufacturer": "Redline",
      "rank": 2
    }
  },
  {
    "id": "recipe_ironwood_standing",
    "kind": "consumable",
    "name": "Heartwood Sight Oil",
    "category": "offense",
    "inputs": {
      "HeartwoodResin": 2,
      "TechFragments": 10,
      "ReactiveComponents": 6
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "HeartwoodSightOil",
    "requiresStanding": {
      "manufacturer": "Ironwood",
      "rank": 2
    }
  },
  {
    "id": "recipe_blastforge_standing",
    "kind": "consumable",
    "name": "Forgeheart Charge",
    "category": "offense",
    "inputs": {
      "ForgeheartIngots": 2,
      "BallisticParts": 12,
      "ReactiveComponents": 8
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ForgeheartCharge",
    "requiresStanding": {
      "manufacturer": "BlastForge",
      "rank": 2
    }
  },
  {
    "id": "recipe_prismatek_standing",
    "kind": "consumable",
    "name": "Prism Coating",
    "category": "offense",
    "inputs": {
      "PrismShards": 2,
      "VoidEssence": 3,
      "TechFragments": 8
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "PrismCoating",
    "requiresStanding": {
      "manufacturer": "Prismatek",
      "rank": 2
    }
  },
  {
    "id": "recipe_throwtech_standing",
    "kind": "consumable",
    "name": "ThrowTech Decoy Kit",
    "category": "utility",
    "inputs": {
      "MagnetiteCores": 2,
      "TechFragments": 12,
      "Scrap": 20
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ThrowTechDecoyKit",
    "requiresStanding": {
      "manufacturer": "ThrowTech",
      "rank": 2
    }
  },
  {
    "id": "recipe_helixworks_standing",
    "kind": "consumable",
    "name": "Helix Calibration Kit",
    "category": "utility",
    "inputs": {
      "Siltglass": 2,
      "TechFragments": 12,
      "VoidDust": 2
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "HelixCalibrationKit",
    "requiresStanding": {
      "manufacturer": "HelixWorks",
      "rank": 2
    }
  },
  {
    "id": "recipe_skin_bulwark_head",
    "kind": "cosmetic",
    "name": "Bulwark Helm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 3200,
      "CompositePlating": 2,
      "PrismShards": 2
    },
    "unitDurationMs": 10800000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-head",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_torso",
    "kind": "cosmetic",
    "name": "Bulwark Siege Torso",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 3600,
      "CompositePlating": 3,
      "RefinedAlloy": 4
    },
    "unitDurationMs": 12600000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-torso",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_arm_upper_n",
    "kind": "cosmetic",
    "name": "Bulwark Pauldron Arm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 2000,
      "TemperedParts": 3
    },
    "unitDurationMs": 7200000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-arm-upper-n",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_arm_fore_n",
    "kind": "cosmetic",
    "name": "Bulwark Gauntlet",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 2000,
      "TemperedParts": 3
    },
    "unitDurationMs": 7200000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-arm-fore-n",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_arm_far",
    "kind": "cosmetic",
    "name": "Bulwark Support Arm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 1800,
      "TemperedParts": 2
    },
    "unitDurationMs": 6300000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-arm-far",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_thigh_f",
    "kind": "cosmetic",
    "name": "Bulwark Thigh (Near)",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 2200,
      "RefinedAlloy": 3
    },
    "unitDurationMs": 7200000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-thigh-f",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_thigh_b",
    "kind": "cosmetic",
    "name": "Bulwark Thigh (Far)",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 2200,
      "RefinedAlloy": 3
    },
    "unitDurationMs": 7200000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-thigh-b",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_lower_leg_f",
    "kind": "cosmetic",
    "name": "Stomper Leg (Near)",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 2800,
      "CompositePlating": 1,
      "TemperedParts": 2
    },
    "unitDurationMs": 9000000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-lower-leg-f",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_lower_leg_b",
    "kind": "cosmetic",
    "name": "Stomper Leg (Far)",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 2800,
      "CompositePlating": 1,
      "TemperedParts": 2
    },
    "unitDurationMs": 9000000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-lower-leg-b",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_bulwark_back",
    "kind": "cosmetic",
    "name": "Packmaster Tank",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 2600,
      "CircuitLattice": 2,
      "WovenCircuits": 2
    },
    "unitDurationMs": 9000000,
    "requiresLevel": 1,
    "requiresBench": 3,
    "station": "bench",
    "cosmeticPartId": "bulwark-back",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_dread_head",
    "kind": "cosmetic",
    "name": "Dreadplate Helm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 700,
      "PrismShards": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-head",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_torso",
    "kind": "cosmetic",
    "name": "Dreadplate Torso",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "RefinedAlloy": 2
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-torso",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_arm_upper_n",
    "kind": "cosmetic",
    "name": "Dreadplate Upper Arm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "TemperedParts": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-arm-upper-n",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_arm_fore_n",
    "kind": "cosmetic",
    "name": "Dreadplate Forearm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "TemperedParts": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-arm-fore-n",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_arm_far",
    "kind": "cosmetic",
    "name": "Dreadplate Support Arm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "TemperedParts": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-arm-far",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_thigh_f",
    "kind": "cosmetic",
    "name": "Dreadplate Thigh (Near)",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "RefinedAlloy": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-thigh-f",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_thigh_b",
    "kind": "cosmetic",
    "name": "Dreadplate Thigh (Far)",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "RefinedAlloy": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-thigh-b",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_lower_leg_f",
    "kind": "cosmetic",
    "name": "Dreadplate Lower Leg (Near)",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "TemperedParts": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-lower-leg-f",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_lower_leg_b",
    "kind": "cosmetic",
    "name": "Dreadplate Lower Leg (Far)",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "TemperedParts": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-lower-leg-b",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_dread_back",
    "kind": "cosmetic",
    "name": "Dreadplate Back Rig",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 600,
      "WovenCircuits": 1
    },
    "unitDurationMs": 2700000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "dread-back",
    "maxUnits": 10
  },
  {
    "id": "recipe_skin_mfr_head_redline",
    "kind": "cosmetic",
    "name": "Redline Helm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 1800,
      "NitrocellGel": 2
    },
    "unitDurationMs": 5400000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "mfr-head-redline",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_mfr_head_ironwood",
    "kind": "cosmetic",
    "name": "Ironwood Helm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 1800,
      "HeartwoodResin": 2
    },
    "unitDurationMs": 5400000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "mfr-head-ironwood",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_mfr_head_blastforge",
    "kind": "cosmetic",
    "name": "BlastForge Helm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 1800,
      "ForgeheartIngots": 2
    },
    "unitDurationMs": 5400000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "mfr-head-blastforge",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_mfr_head_prismatek",
    "kind": "cosmetic",
    "name": "Prismatek Helm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 1800,
      "PrismShards": 2
    },
    "unitDurationMs": 5400000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "mfr-head-prismatek",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_mfr_head_throwtech",
    "kind": "cosmetic",
    "name": "ThrowTech Helm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 1800,
      "MagnetiteCores": 2
    },
    "unitDurationMs": 5400000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "mfr-head-throwtech",
    "maxUnits": 1
  },
  {
    "id": "recipe_skin_mfr_head_helixworks",
    "kind": "cosmetic",
    "name": "HelixWorks Helm",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 1800,
      "Siltglass": 2
    },
    "unitDurationMs": 5400000,
    "requiresLevel": 1,
    "requiresBench": 2,
    "station": "bench",
    "cosmeticPartId": "mfr-head-helixworks",
    "maxUnits": 1
  },
  {
    "id": "tint_craft",
    "kind": "cosmetic",
    "name": "Tint a Part",
    "category": "cosmetics",
    "inputs": {
      "Scrap": 25
    },
    "unitDurationMs": 300000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "tintCraft": true,
    "tintPalettes": [
      {
        "id": "arctic",
        "chromaweave": 0
      },
      {
        "id": "void",
        "chromaweave": 0
      },
      {
        "id": "crimson",
        "chromaweave": 1
      },
      {
        "id": "verdant",
        "chromaweave": 1
      },
      {
        "id": "solar",
        "chromaweave": 1
      },
      {
        "id": "abyss",
        "chromaweave": 1
      },
      {
        "id": "royal",
        "chromaweave": 1
      }
    ],
    "maxUnits": 1
  }
]
$catalog$::jsonb
$$;
