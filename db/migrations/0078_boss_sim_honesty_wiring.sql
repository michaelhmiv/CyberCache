-- 0078 — Boss-sim honesty wiring: Grenade -> OrdnanceCharge merge +
-- Workshop Rush Ticket repair scope (owner wiring package, 2026-11-04).
--
-- Provenance (chain heads grepped 2026-11-04 before restating):
--   cc_vendor_catalog      <- 0071_vendor_scrap_meters.sql (verbatim
--                             except the two staple/rotation rows in §1)
--   cc_enqueue_repair_job  <- 0038_research.sql (verbatim + the rush
--                             wiring in §2; signature gains a 6th arg,
--                             so the 5-arg form is dropped first)
--   cc_cancel_craft_job    <- 0069_scrap_merge.sql (verbatim + the
--                             repair-branch rush refund in §3)
-- 0077 (Elemental Coating recipe) restates different functions
-- (cc_craft_recipe_catalog / cc_craft_quality_bounds); no shared
-- surface. Apply order is numeric: 0077 first, then 0078.
--
-- CONSERVATION PROOF for §4 (run before and after applying; the two
-- totals must be equal — the conversion only relabels and merges):
--   select
--     (select coalesce(sum((consumables ->> 'Grenade')::bigint),0)
--        + coalesce(sum((consumables ->> 'OrdnanceCharge')::bigint),0)
--        from public.profiles) as profile_units,
--     (select coalesce(sum(quantity),0) from public.consumable_batches
--        where consumable_type in ('Grenade','OrdnanceCharge')) as batch_units,
--     (select coalesce(sum(quantity),0) from public.market_listings
--        where consumable_type in ('Grenade','OrdnanceCharge')
--          and status = 'active') as listed_units;
-- Post-check: no row anywhere still reads 'Grenade' —
--   profiles with the key, batches, and listings all return 0.

-- ---------------------------------------------------------------------
-- §1. Vendor catalog: the vendor staple 'Grenade' and the crafted
-- OrdnanceCharge were one item wearing two IDs (same display name,
-- same paper effect, same 400cr). The merge keeps ONE definition:
-- OrdnanceCharge becomes the staple at 400 and leaves the rotation
-- pool (staples are never rotation stock). 0071 body otherwise
-- verbatim.
-- ---------------------------------------------------------------------

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
    ('OrdnanceCharge', 400, 'staple'),
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

-- ---------------------------------------------------------------------
-- §2. cc_enqueue_repair_job: the Workshop Rush Ticket's repair scope
-- was dead text — the enqueue hardcoded rush stamps null / reduction
-- 0. The 6-arg form wires it exactly like crafting (0029): ticket
-- escrowed at enqueue (FIFO burn), quality prices the reduction
-- through least(0.45 + Fixer-keystone cap bonus, 0.2 x q / 100), the
-- snapshotted unit duration scales by (1 - reduction), and the job
-- stamps quality/origin for the cancel refund. 0038 body otherwise
-- verbatim. The 5-arg form is dropped first (the Chef store passes
-- the flag explicitly from this migration's release on).
-- ---------------------------------------------------------------------

drop function if exists public.cc_enqueue_repair_job(uuid, text, uuid, text, integer);

create or replace function public.cc_enqueue_repair_job(
  p_player_id uuid, nonce text, item_id uuid, p_kit_type text, p_units integer,
  p_use_rush_ticket boolean default false
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
  v_ticket_count integer := 0;
  v_rush_quality numeric := null;
  v_rush_origin text := null;
  v_rush_reduction numeric := 0;
  v_rush_cap_bonus numeric := 0;
  v_rush_consumed jsonb;
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
  -- Rush cap bonus (0029): the Fixer keystone raises the ticket's
  -- 0.45 reduction cap by 0.10 when spent (0078 repair wiring).
  v_rush_cap_bonus := 0.10 *
    public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1);

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

  v_ticket_count := coalesce((p.consumables ->> 'WorkshopRushTicket')::integer, 0);
  if coalesce(p_use_rush_ticket, false) and v_ticket_count < 1 then
    raise exception 'No Workshop Rush Ticket available';
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

  -- Rush ticket (0078): escrowed at enqueue like the kits — the
  -- ticket's definition claims the repair scope; the burn takes it
  -- out of inventory now (FIFO, lowest quality first, the shipped
  -- burn order) and its quality prices the reduction through the
  -- crafting path's clamp (least(0.45 + cap bonus, 0.2 x q / 100)).
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
    v_rush_consumed := public.cc_consume_consumable_batch(actor, 'WorkshopRushTicket', 1,
      'workshop_service', 'Workshop Rush Ticket', '{}'::jsonb);
    v_rush_quality := (v_rush_consumed -> 'consumed' -> 0 ->> 'quality_percent')::numeric;
    v_rush_reduction := least(0.45 + v_rush_cap_bonus, 0.2 * coalesce(v_rush_quality, 100) / 100);
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, 'WorkshopRushTicket', -1),
           updated_at = now()
     where id = actor returning * into p;
  end if;

  v_mastery := public.cc_player_mastery_level(actor, 'services.repair');
  v_rate := v_base * least(2.0, 1 + v_speed * greatest(0, v_mastery - 1))
    * (1 + public.cc_research_bonus_number(actor, 'repairWorkRateBonus'));
  -- Fixer composition (0029): efficiency = min(1.80, mastery x
  -- (1 + repair_efficiency_bonus)); the snapshotted duration takes
  -- the repair_speed_bonus multiplier (1 - min(0.30, bonus)).
  v_efficiency := least(1.80, least(1.5, 1 + v_eff * greatest(0, v_mastery - 1))
    * (1 + greatest(0, v_repair_efficiency_bonus)));
  v_duration := greatest(1, ceil(v_kit_base
    * (1 - least(0.30, greatest(0, v_repair_speed_bonus))) / v_rate * 3600000))::bigint;
  -- Rush composes last, on the snapshotted duration, exactly as the
  -- TS twin rounds the computed unit duration by (1 - reduction).
  v_duration := greatest(1, round(v_duration * (1 - v_rush_reduction)))::bigint;

  insert into public.craft_jobs(
    owner_user_id, bench, kind, recipe_id, units_total, unit_duration_ms,
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (actor, 0, 'repair', v_recipe, v_units, v_duration,
    '{}'::jsonb, '{}'::jsonb, v_rush_quality, v_rush_origin,
    jsonb_build_object(
      'toolId', null, 'toolQualityMultiplier', 1, 'toolDurationMultiplier', 1,
      'toolRefineYieldBonus', 0, 'toolBonusUnitChance', 0,
      'skillDurationMultiplier', 1, 'rushReduction', v_rush_reduction, 'craftTimeScalar', 1,
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

-- ---------------------------------------------------------------------
-- §3. cc_cancel_craft_job: the repair branch hardcoded
-- rush_ticket_refunded false because repair jobs could not carry a
-- ticket. §2 changes that, so the branch gains the generic path's
-- refund (batch at escrowed quality, unstarted jobs only). 0069 body
-- otherwise verbatim.
-- ---------------------------------------------------------------------

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

    -- Rush ticket (0078): refunded as a batch at its escrowed
    -- quality only when the job never started — the generic path's
    -- rule below, now reachable for repair jobs, which can carry a
    -- ticket since the 0078 enqueue wiring. On a started job the
    -- ticket is spent.
    if job.rush_ticket_quality is not null
       and not (job.units_completed > 0 or job.accrued_ms > 0) then
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
      'rush_ticket_refunded', v_rush_refunded
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

-- ---------------------------------------------------------------------
-- §4. Stock conversion: every player-held 'Grenade' unit becomes an
-- OrdnanceCharge unit, 1:1, quality and origin preserved.
--   - profiles.consumables: the Grenade count folds into the
--     OrdnanceCharge count and the key is removed (only rows that
--     actually hold Grenade units are touched).
--   - consumable_batches: a plain type relabel — the table has no
--     unique constraint on (owner, type, quality, origin), so no
--     collision is possible and per-batch quality/origin survive
--     exactly.
--   - market_listings: active consumable listings relabel, so a
--     later cancel/delist refunds OrdnanceCharge batches.
-- Historical records (ledger payloads, consumable_events) keep the
-- old label: they are history, not stock.
-- ---------------------------------------------------------------------

update public.profiles
   set consumables = (consumables - 'Grenade')
       || jsonb_build_object('OrdnanceCharge',
            coalesce((consumables ->> 'OrdnanceCharge')::integer, 0)
            + (consumables ->> 'Grenade')::integer),
       updated_at = now()
 where consumables ? 'Grenade'
   and coalesce((consumables ->> 'Grenade')::integer, 0) > 0;

update public.consumable_batches
   set consumable_type = 'OrdnanceCharge',
       updated_at = now()
 where consumable_type = 'Grenade';

update public.market_listings
   set consumable_type = 'OrdnanceCharge'
 where consumable_type = 'Grenade'
   and status = 'active';
