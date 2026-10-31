-- Migration 0029 — the Fixer skill tree (fourth tree).
--
-- APPLY BEFORE MERGE. Additive and signature-preserving: one new
-- helper function, 17 seeded rows in skill_node_definitions, and six
-- restated functions whose signatures are unchanged and whose math
-- reduces EXACTLY to the pre-0029 formulas when the actor has no
-- Fixer spends (every Fixer term is additive/multiplicative over a
-- zero default), so old code running against the new functions — or
-- new code against un-migrated databases for the read paths — sees
-- no behavior change for non-Fixer players. Applies cleanly after
-- 0028 (Endless) if that lands first; the two migrations touch
-- disjoint objects.
--
-- What lands:
--   1. cc_skill_effective_points: the ONE SQL mirror of
--      computeSkillBonuses' per-node effective-points rule (spends
--      + class-mod nodeBoosts; the mod's treeBonus adds +1 capped at
--      the node's maxPoints). Every Fixer derivation below reads the
--      actor's OWN records (profiles.skill_spends + the equipped
--      class mod payload) through it — no new trusted parameters.
--   2. The 17 Fixer rows in skill_node_definitions (0014-era seed
--      pattern; required or cc_train_skill rejects the nodes). The
--      point budget does NOT change: level - 1, enforced by
--      cc_train_skill as shipped; cc_retrain zeroes the whole spends
--      map, so respec covers the new tree untouched.
--   3. Restated consumers (latest bodies: craft from 0026, repair
--      from 0025, cc_vendor_sell from 0020, cc_accept_listing from
--      0021), each gaining its Fixer term at the brief's seam:
--        cc_enqueue_craft_job  — craft-speed duration multiplier
--          (multiplicative after the Scavenger term, combined 0.60x
--          floor), bench queue 6 + workshop_queue_bonus, rush cap
--          0.45 + rush_cap_bonus, coreCatalystDrawBonus snapshot.
--        cc_complete_craft_unit — composed quality shift
--          clamp(lever + craft_quality_bonus, -10, +20) into
--          cc_craft_quality_bounds; temper + craft_temper_bonus
--          under the 0.30 cap; core-catalyst draws
--          2 + snapshot coreCatalystDrawBonus.
--        cc_enqueue_repair_job — repair efficiency
--          min(1.80, mastery x (1 + repair_efficiency_bonus)),
--          duration x (1 - min(0.30, repair_speed_bonus)), self-
--          repair cap 3 + bonus_repair_jobs (Second Shift).
--        cc_accept_repair_job  — the MECHANIC's terms in the accept
--          snapshot: work rate / (1 - min(0.30, speed bonus)),
--          efficiency composed as above.
--        cc_vendor_sell        — rate = min(0.90, lever +
--          vendor_buyback_bonus) (Appraiser's Eye).
--        cc_accept_listing     — House Brand: + craftedItemFee
--          Reduction when the sale is crafted (payload origin
--          'crafted' for gear/vehicles, batch_origin 'crafted' for
--          consumables — the economy metrics' crafted-sale rule).
--          Found and crafted are disjoint by the drop-source
--          taxonomy; the result's market_fee gains crafted_item.
--      Vehicle yield/fuel/decay terms are TS-only (the Chef tick has
--      no SQL twin; #214 parity runs through processRoamingClaim).
--
-- Deliberate seam note (brief SS3.3k): the brief cited
-- MAX_ACTIVE_REPAIR_JOBS as "enforced at board accept" — in the
-- shipped code that cap lives on SELF-repair enqueue (here and in
-- craftEngine.enqueueRepairJob); board accepts carry no concurrency
-- cap (board work is sequential by design). Second Shift raises the
-- cap that exists, for its holder, in both twins.

-- ─── 1. Effective-points helper ────────────────────────────────────

create or replace function public.cc_skill_effective_points(
  p_spends jsonb,
  p_mod_payload jsonb,
  p_node_id text,
  p_tree text,
  p_max_points integer
)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when p_mod_payload ->> 'treeBonus' = p_tree
      then least(p_max_points::numeric,
        coalesce((p_spends ->> p_node_id)::numeric, 0)
        + coalesce((p_mod_payload -> 'nodeBoosts' ->> p_node_id)::numeric, 0) + 1)
    else coalesce((p_spends ->> p_node_id)::numeric, 0)
       + coalesce((p_mod_payload -> 'nodeBoosts' ->> p_node_id)::numeric, 0)
  end;
$$;

-- ─── 2. Fixer node definitions ─────────────────────────────────────

insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_craft_time_1', 'Fixer', 1, 1, 'Assembly Rhythm', 'Workshop craft jobs run faster: −2.5% unit time per point (server-side, snapshotted at enqueue).', 'small', 5, 1, '{"craftSpeedBonus":0.025}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_craft_time_2', 'Fixer', 1, 2, 'Parallel Hands', 'Workshop craft jobs run faster: −2.5% unit time per point (−25% across both nodes).', 'small', 5, 1, '{"craftSpeedBonus":0.025}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_quality_1', 'Fixer', 2, 1, 'Calibrated Eye', '+1 crafted quality shift per point (server-side, applied when a unit completes).', 'small', 5, 1, '{"craftQualityBonus":1}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_quality_2', 'Fixer', 2, 2, 'Tolerance Stacking', '+1 crafted quality shift per point (+10 across both nodes).', 'small', 5, 1, '{"craftQualityBonus":1}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_repair_speed_1', 'Fixer', 3, 1, 'Torque Discipline', 'Repair work runs faster: −3% unit time per point (snapshotted at enqueue/accept).', 'small', 5, 1, '{"repairSpeedBonus":0.03}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_repair_speed_2', 'Fixer', 3, 2, 'Bay Choreography', 'Repair work runs faster: −3% unit time per point (−30% across both nodes).', 'small', 5, 1, '{"repairSpeedBonus":0.03}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_repair_eff_1', 'Fixer', 4, 1, 'Kit Stretching', 'Patch kits restore +2.5% more condition per point (multiplies repair efficiency).', 'small', 5, 1, '{"repairEfficiencyBonus":0.025}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_repair_eff_2', 'Fixer', 4, 2, 'Salvage Solder', 'Patch kits restore +2.5% more condition per point (+25% across both nodes).', 'small', 5, 1, '{"repairEfficiencyBonus":0.025}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_vehicle_yield_1', 'Fixer', 5, 1, 'Rig Tuning', '+2% vehicle yield bonus per point (adds into the yield affix bracket).', 'small', 5, 1, '{"vehicleYieldBonus":0.02}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_vehicle_yield_2', 'Fixer', 5, 2, 'Aero Fairings', '+2% vehicle yield bonus per point (+20% across both nodes).', 'small', 5, 1, '{"vehicleYieldBonus":0.02}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_vehicle_fuel_1', 'Fixer', 6, 1, 'Lean Burn', 'Vehicles burn −3% fuel per point (applied after fuel-efficiency affixes).', 'small', 5, 1, '{"vehicleFuelBonus":0.03}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_vendor_1', 'Fixer', 6, 2, 'Appraiser''s Eye', '+1% vendor buyback rate per point (added to the buyback lever; the rate caps at 90%).', 'small', 5, 1, '{"vendorBuybackBonus":0.01}'::jsonb, ARRAY[]::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_major_1', 'Fixer', 7, 1, 'Master Artificer', 'Crafted gear temper chance +5%.', 'major', 1, 3, '{"craftTemperBonus":0.05}'::jsonb, ARRAY['fix_quality_1', 'fix_quality_2']::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_major_2', 'Fixer', 7, 2, 'Fleet Engineer', 'Vehicles lose 25% less condition per fueled tick.', 'major', 1, 3, '{"vehicleDecayReduction":0.25}'::jsonb, ARRAY['fix_vehicle_yield_1', 'fix_vehicle_yield_2']::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_major_3', 'Fixer', 8, 1, 'House Brand', 'Marketplace listing fees reduced an additional 15% for Workshop-crafted items you sell.', 'major', 1, 3, '{"craftedItemFeeReduction":0.15}'::jsonb, ARRAY['fix_vendor_1']::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_major_4', 'Fixer', 8, 2, 'Second Shift', '+1 concurrent self-repair job.', 'major', 1, 3, '{"bonusRepairJobs":1}'::jsonb, ARRAY['fix_repair_speed_1', 'fix_repair_speed_2']::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;
insert into public.skill_node_definitions (id, tree, tier, slot_index, name, description, node_type, max_points, per_point_cost, effects, requires, created_at) values ('fix_keystone', 'Fixer', 9, 1, 'The Fixer', 'Legendary Core Catalyst gear crafts gain +1 generation draw per unit. Each bench queue holds +1 job. Workshop Rush Ticket reduction cap rises to 55%.', 'keystone', 1, 5, '{"coreCatalystDrawBonus":1,"workshopQueueBonus":1,"rushReductionCapBonus":0.1}'::jsonb, ARRAY['fix_major_1', 'fix_major_2', 'fix_major_4']::text[], '2026-10-31T00:00:00.000Z'::timestamptz) on conflict do nothing;

-- ─── 3a. cc_enqueue_craft_job (0026 body + Fixer terms) ───

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
  -- Guest gate (§2.1): enqueueing is a verified-account action, the
  -- player-market lock treatment; vendor staples stay the guest path.
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

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
  if v_fitted is not null
     and coalesce((v_tools -> 'charges' ->> v_fitted)::integer, 0) <= 0 then
    v_fitted := null;
  end if;
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

-- ─── 3b. cc_complete_craft_unit (0026 body + Fixer terms) ───

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
  return v_output;
end;
$$;

-- ─── 3c. cc_enqueue_repair_job (0025 body + Fixer terms) ───

create or replace function public.cc_enqueue_repair_job(
  p_player_id uuid, nonce text, item_id uuid, p_kit_type text, p_units integer
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
  v_job public.craft_jobs%rowtype;
  v_units integer := coalesce(p_units, 0);
  v_kit_base numeric;
  v_recipe text;
  v_count integer;
  v_burn jsonb;
  v_entry jsonb;
  v_batch record;
  v_i integer;
  v_qualities jsonb := '[]'::jsonb;
  v_origins jsonb := '[]'::jsonb;
  v_mastery integer;
  v_base numeric := least(200, greatest(1,
    public.cc_economy_config_number('repairWorkRateBase', 20)));
  v_speed numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasterySpeedPerLevel', 0.02)));
  v_eff numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasteryEfficiencyPerLevel', 0.02)));
  v_rate numeric;
  v_efficiency numeric;
  v_duration bigint;
  v_mod_payload jsonb;
  v_repair_speed_bonus numeric := 0;
  v_repair_efficiency_bonus numeric := 0;
  v_bonus_repair_jobs integer := 0;
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

  -- Fixer derivation (0029): the owner's OWN records.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_repair_speed_bonus := 0.03 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_speed_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_speed_2', 'Fixer', 5));
  v_repair_efficiency_bonus := 0.025 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_eff_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_eff_2', 'Fixer', 5));
  v_bonus_repair_jobs :=
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_major_4', 'Fixer', 1)::integer;

  v_kit_base := case p_kit_type
    when 'PatchKit' then 30 when 'FieldPatchKit' then 45
    when 'MasterPatchKit' then 80 else null end;
  v_recipe := case p_kit_type
    when 'PatchKit' then 'repair_patch_kit'
    when 'FieldPatchKit' then 'repair_field_patch_kit'
    when 'MasterPatchKit' then 'repair_master_patch_kit' else null end;
  if v_kit_base is null then raise exception 'Unknown patch kit type'; end if;
  if v_units < 1 then raise exception 'units must be a positive integer'; end if;
  if v_units > 500 then raise exception 'units exceeds the per-job maximum of 500'; end if;

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Vehicle not found'; end if;
  if item.kind <> 'vehicle' then raise exception 'Only vehicles can be repaired'; end if;
  if item.runtime_state in ('listed', 'consumed', 'salvaged', 'in_service') then
    raise exception 'Vehicle is not available for repair';
  end if;
  if coalesce(item.condition_current, item.condition_max, 100)
     >= coalesce(item.condition_max, 100) then
    raise exception 'Vehicle is already at full condition';
  end if;
  if exists (select 1 from public.craft_jobs
              where owner_user_id = actor and kind = 'repair' and status = 'active'
                and snapshot -> 'repair' ->> 'itemId' = item.id::text) then
    raise exception 'A repair job is already running for this vehicle';
  end if;
  select count(*) into v_count from public.craft_jobs
   where owner_user_id = actor and kind = 'repair' and status = 'active';
  -- Second Shift (fix_major_4): +1 concurrent self-repair job. This
  -- self-repair cap is the one repair-concurrency cap the shipped
  -- game enforces; board work is uncapped-but-sequential by design.
  if v_count >= 3 + v_bonus_repair_jobs then raise exception 'Too many repair jobs already running'; end if;
  if coalesce((p.consumables ->> p_kit_type)::integer, 0) < v_units then
    raise exception 'Not enough % in inventory', p_kit_type;
  end if;

  -- Escrow the kits: burn FIFO and record each unit's quality and
  -- origin, so completion prices the ACTUAL kit and refunds return
  -- the exact batches. Legacy counts backfill first (the
  -- cc_consume_consumable guard).
  if not exists (select 1 from public.consumable_batches
                  where owner_user_id = actor and consumable_type = p_kit_type
                    and quantity > 0) then
    perform public.cc_add_consumable_batch(actor, p_kit_type,
      (p.consumables ->> p_kit_type)::integer, 100, 'vendor', null, null,
      'admin_adjust', 'Backfilled legacy count into 100% batch before consumption',
      '{}'::jsonb);
  end if;
  v_burn := public.cc_consume_consumable_batch(
    actor, p_kit_type, v_units, 'workshop_service', 'repair_self', '{}'::jsonb);
  for v_entry in select * from jsonb_array_elements(v_burn -> 'consumed') loop
    select origin into v_batch from public.consumable_batches
     where id = (v_entry ->> 'batch_id')::uuid;
    for v_i in 1 .. (v_entry ->> 'quantity')::integer loop
      v_qualities := v_qualities || jsonb_build_array((v_entry ->> 'quality_percent')::numeric);
      v_origins := v_origins || jsonb_build_array(coalesce(v_batch.origin, 'vendor'));
    end loop;
  end loop;
  update public.profiles
     set consumables = public.cc_jsonb_add_int(consumables, p_kit_type, -v_units),
         updated_at = now()
   where id = actor returning * into p;

  v_mastery := public.cc_player_mastery_level(actor, 'services.repair');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1));
  -- Fixer composition (0029): efficiency = min(1.80, mastery x
  -- (1 + repair_efficiency_bonus)); the snapshotted duration takes
  -- the repair_speed_bonus multiplier (1 - min(0.30, bonus)).
  v_efficiency := least(1.80, least(1.5, 1 + v_eff * greatest(0, v_mastery - 1))
    * (1 + greatest(0, v_repair_efficiency_bonus)));
  v_duration := greatest(1, ceil(v_kit_base
    * (1 - least(0.30, greatest(0, v_repair_speed_bonus))) / v_rate * 3600000))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (actor, 0, 'repair', v_recipe, v_units, v_duration,
    '{}'::jsonb, '{}'::jsonb, null, null,
    jsonb_build_object(
      'toolId', null, 'toolQualityMultiplier', 1, 'toolDurationMultiplier', 1,
      'toolRefineYieldBonus', 0, 'toolBonusUnitChance', 0,
      'skillDurationMultiplier', 1, 'rushReduction', 0, 'craftTimeScalar', 1,
      'catalystMaterialId', null, 'gearRarity', null,
      'repair', jsonb_build_object(
        'itemId', item.id, 'kitType', p_kit_type, 'kitBase', v_kit_base,
        'kitQualities', v_qualities, 'kitOrigins', v_origins,
        'efficiency', v_efficiency, 'workRatePointsPerHour', v_rate,
        'masteryLevel', v_mastery)))
  returning * into v_job;

  result := jsonb_build_object('action_type', 'cc_enqueue_repair_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_repair_job', nonce, result);
  return result;
end;
$$;

-- ─── 3d. cc_accept_repair_job (0025 body + Fixer terms) ───

create or replace function public.cc_accept_repair_job(
  p_player_id uuid, nonce text, job_id uuid, p_kit_type text
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
  job public.service_jobs%rowtype;
  v_mastery integer;
  v_base numeric := least(200, greatest(1,
    public.cc_economy_config_number('repairWorkRateBase', 20)));
  v_speed numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasterySpeedPerLevel', 0.02)));
  v_eff numeric := least(0.1, greatest(0,
    public.cc_economy_config_number('repairMasteryEfficiencyPerLevel', 0.02)));
  v_rate numeric;
  v_efficiency numeric;
  v_mod_payload jsonb;
  v_repair_speed_bonus numeric := 0;
  v_repair_efficiency_bonus numeric := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into job from public.service_jobs where id = job_id for update;
  if not found or job.profession_id <> 'repair' then raise exception 'Repair job not found'; end if;
  if job.status = 'listed' and job.expires_at is not null and job.expires_at <= now() then
    perform public.cc_repair_finalize_job(job.id, 'expired');
    raise exception 'Listing has expired';
  end if;
  if job.status <> 'listed' then raise exception 'Service job not available'; end if;
  if job.owner_user_id = actor then raise exception 'Cannot accept own job'; end if;
  if p_kit_type not in ('PatchKit', 'FieldPatchKit', 'MasterPatchKit') then
    raise exception 'Unknown patch kit type';
  end if;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce((p.consumables ->> p_kit_type)::integer, 0) < 1 then
    raise exception 'No % available', p_kit_type;
  end if;

  -- Fixer derivation (0029): the MECHANIC's OWN records price the
  -- snapshot — the speed term raises the snapshotted work rate (the
  -- rate form of the duration multiplier; board work accrues points
  -- over time) and the efficiency term composes past the mastery cap.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_repair_speed_bonus := 0.03 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_speed_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_speed_2', 'Fixer', 5));
  v_repair_efficiency_bonus := 0.025 * (
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_eff_1', 'Fixer', 5)
    + public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_repair_eff_2', 'Fixer', 5));

  v_mastery := public.cc_player_mastery_level(actor, 'services.repair');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1))
    / (1 - least(0.30, greatest(0, v_repair_speed_bonus)));
  v_efficiency := least(1.80, least(1.5, 1 + v_eff * greatest(0, v_mastery - 1))
    * (1 + greatest(0, v_repair_efficiency_bonus)));
  update public.service_jobs
     set provider_user_id = actor, status = 'active', kit_type = p_kit_type,
         repair_snapshot = jsonb_build_object(
           'masteryLevel', v_mastery,
           'workRatePointsPerHour', v_rate,
           'efficiency', v_efficiency),
         accepted_at = now(), last_settled_at = now(), last_progress_at = now()
   where id = job.id returning * into job;
  update public.escrow_records set payee_user_id = actor
   where id = job.escrow_id;

  result := jsonb_build_object('action_type', 'cc_accept_repair_job',
    'profile', public.cc_profile_snapshot(p), 'job', to_jsonb(job));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_accept_repair_job', nonce, result);
  return result;
end;
$$;

-- ─── 3e. cc_vendor_sell (0020 body + Appraiser's Eye) ───

create or replace function public.cc_vendor_sell(
  p_player_id uuid,
  nonce text,
  p_kind text,
  p_item_id uuid default null,
  p_batch_id uuid default null,
  p_material_id text default null,
  p_quantity integer default 1
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
  result jsonb;
  rate numeric := least(0.9::numeric, greatest(0::numeric,
    public.cc_economy_config_number('vendorBuybackRate', 0.4)));
  qty integer := greatest(1, coalesce(p_quantity, 1));
  item public.item_instances%rowtype;
  batch public.consumable_batches%rowtype;
  v_pool text;
  base_price integer;
  vendor_value numeric := 0;
  payout bigint := 0;
  current_count integer;
  v_mod_payload jsonb;
  v_vendor_buyback_bonus numeric := 0;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  -- Appraiser's Eye (Fixer small, 0029): the seller's
  -- vendor_buyback_bonus adds onto the levered rate under the same
  -- 0.90 ceiling, derived from the seller's OWN records.
  select payload into v_mod_payload from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and payload ? 'treeBonus'
   limit 1;
  v_vendor_buyback_bonus := 0.01 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_vendor_1', 'Fixer', 5);
  rate := least(0.9::numeric, rate + greatest(0, v_vendor_buyback_bonus));

  if p_kind = 'gear' then
    select * into item from public.item_instances where id = p_item_id and owner_user_id = actor for update;
    if not found then raise exception 'Item not found'; end if;
    if item.is_locked then raise exception 'Locked item'; end if;
    if item.runtime_state <> 'available' then raise exception 'Item state invalid'; end if;

    vendor_value := greatest(0, coalesce(item.estimated_value, 0));
    payout := floor(vendor_value * rate)::bigint;

    update public.item_instances
    set runtime_state = 'consumed', tradeable = false, equipped_slot = null
    where id = item.id
    returning * into item;

    update public.profiles set credits = credits + payout where id = actor returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'gear',
      'item', to_jsonb(item),
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', 1,
      'total_payout', payout,
      'loadout', public.cc_loadout_snapshot(actor)
    );
  elsif p_kind = 'consumable' then
    select * into batch from public.consumable_batches where id = p_batch_id and owner_user_id = actor for update;
    if not found then raise exception 'Batch not found'; end if;
    if batch.quantity < qty then raise exception 'Insufficient quantity'; end if;

    base_price := public.cc_vendor_base_price(batch.consumable_type);
    if base_price is null then raise exception 'Item has no vendor value'; end if;

    vendor_value := base_price * batch.quality_percent / 100 * qty;
    payout := floor(vendor_value * rate)::bigint;

    update public.consumable_batches
    set quantity = quantity - qty, updated_at = now()
    where id = batch.id;

    current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> batch.consumable_type)::integer, 0);
    update public.profiles
    set credits = credits + payout,
        consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array[batch.consumable_type],
          to_jsonb(greatest(current_count - qty, 0)), true)
    where id = actor
    returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'consumable',
      'item_key', batch.consumable_type,
      'batch_id', batch.id,
      'quality_percent', batch.quality_percent,
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', qty,
      'total_payout', payout
    );
  elsif p_kind = 'material' then
    select c.pool, c.base_price into v_pool, base_price
      from public.cc_vendor_catalog() c where c.item_key = p_material_id;
    if v_pool is null or v_pool not in ('material', 'essence') then
      raise exception 'Unknown material';
    end if;

    if v_pool = 'material' then
      current_count := coalesce((coalesce(p.materials, '{}'::jsonb) ->> p_material_id)::integer, 0);
    else
      current_count := coalesce((coalesce(p.essences, '{}'::jsonb) ->> p_material_id)::integer, 0);
    end if;
    if current_count < qty then raise exception 'Insufficient material %', p_material_id; end if;

    vendor_value := base_price * qty;
    payout := floor(vendor_value * rate)::bigint;

    update public.profiles
    set credits = credits + payout,
        materials = case when v_pool = 'material'
          then public.cc_jsonb_add_int(materials, p_material_id, -qty) else materials end,
        essences = case when v_pool = 'essence'
          then public.cc_jsonb_add_int(essences, p_material_id, -qty) else essences end
    where id = actor
    returning * into p;

    result := jsonb_build_object(
      'action_type', 'cc_vendor_sell',
      'profile', public.cc_profile_snapshot(p),
      'kind', 'material',
      'item_key', p_material_id,
      'vendor_value', vendor_value,
      'buyback_rate', rate,
      'quantity', qty,
      'total_payout', payout
    );
  else
    raise exception 'Unknown vendor sell kind';
  end if;

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_vendor_sell', nonce, result);

  return result;
end;
$function$;


-- ─── 3f. cc_accept_listing (0021 body + House Brand) ───

CREATE OR REPLACE FUNCTION public.cc_accept_listing(p_player_id uuid, nonce text, listing_id uuid)
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
  fee_rate numeric := 0.05;
  found_item boolean := false;
  delivered_batch_id uuid;
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
  if listing.seller_user_id = actor then raise exception 'Cannot accept own listing'; end if;
  if p.credits < listing.price_credits then raise exception 'Insufficient credits'; end if;

  select * into seller from public.profiles where id = listing.seller_user_id;

  if listing.listing_kind in ('gear', 'vehicle') then
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
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when found_item then 0.15 * manip_pts else 0 end
        + case when crafted_item then 0.15 * house_pts else 0 end));
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
      fee_reduction := least(1::numeric, greatest(0::numeric,
        0.05 * darknet_pts + case when crafted_item then 0.15 * house_pts else 0 end));
      fee_credits := floor(listing.price_credits * fee_rate * (1 - fee_reduction))::bigint;
    end if;
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;

  if listing.listing_kind in ('gear', 'vehicle') then
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
  end if;

  -- Re-read the buyer so the result snapshot carries the delivery.
  select * into p from public.profiles where id = actor;

  result := jsonb_build_object('action_type', 'cc_accept_listing', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'delivery', jsonb_build_object('kind', listing.listing_kind, 'quantity', listing.quantity, 'quality_percent', listing.quality_percent, 'consumable_type', listing.consumable_type, 'material_id', listing.material_id, 'batch_id', delivered_batch_id), 'market_fee', jsonb_build_object('fee_credits', fee_credits, 'seller_proceeds', listing.price_credits - fee_credits, 'fee_rate', fee_rate, 'fee_reduction', fee_reduction, 'found_item', found_item, 'crafted_item', crafted_item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_accept_listing', nonce, result);
  return result;
end;
$function$;
