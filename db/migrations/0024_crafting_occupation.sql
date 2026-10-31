-- 0024_crafting_occupation.sql
--
-- Crafting-as-occupation (design brief: crafting-as-occupation.md,
-- Michael's occupations law 2026-10-30). The Workshop stops being a
-- client-side timer fiction and becomes a server job model:
--
--   1. craft_jobs + profiles.workshop_benches / workshop_tools — the
--      job table and the bench/tool state (§2.1, §2.2, §2.5e). Jobs
--      progress ONLY while `crafting` is the player's active action;
--      progress accrues from server timestamps through
--      cc_settle_craft_jobs, which runs at every activity transition
--      (cc_set_active_action / cc_clear_active_action are restated
--      with the settle hook), at workshop reads, at craft ops, and —
--      capped by the effective offline cap, flag F5 — at offline
--      settlement. Escrow is taken atomically at enqueue; cancel
--      refunds follow the §2.1 table.
--
--   2. The catalog + formulas as SQL twins of src/content/crafting.ts:
--      cc_craft_recipe (all 49 recipes), cc_craft_quality_bounds
--      (§2.4), cc_craft_unit_xp (§2.3: XP pegged to roaming's XP/hour,
--      rate = the craftXpRate lever clamped to [0.70, 0.85]).
--      Quality rolls happen at unit completion; crafted consumables
--      land as batches through cc_add_consumable_batch (origin
--      'crafted'), and the claim/boss engines now price consumed
--      effects from those batches' quality (§2.4 wiring, TS side).
--
--   3. Gear frames complete as PENDING outputs on the job; the Chef
--      finalizes them through the shared TS generators
--      (cc_pending_crafted_gear / cc_finalize_crafted_gear) because
--      only weapons ever had a SQL payload generator. Crafted rarity
--      is capped at Epic and crafted gear never carries a
--      legendaryEffectId (enforced in the generators' caller).
--
--   4. Restatements: cc_market_create_material's whitelist grows
--      12 -> 20 material ids (refined + composite materials become
--      listable, §2.6); cc_refuel_vehicle / cc_use_patch_kit learn
--      the crafted FuelCell / patch-kit tiers (§2.5d — the old
--      signatures are dropped first so calls can't go ambiguous);
--      cc_compute_economy_metrics gains the seven craft meters (§2.10)
--      and economy_metrics the matching columns.
--
--   5. New mastery tracks: crafting.refining (10 XP/unit) and
--      crafting.gear (25 XP/unit), seeded like crafting_consumables.
--
-- COMPATIBILITY: the 29 legacy recipes keep their ids/inputs/times
-- (they are rows in the catalog below); existing batches keep their
-- quality semantics; in-flight CLIENT queues at deploy simply vanish
-- (the server never held their materials or outputs — nothing
-- recorded is lost). cc_claim_crafted_consumable (0004) stays
-- callable but is DEPRECATED by this migration: the job model is the
-- only crafting path the client uses from this slice on, and a later
-- cleanup migration retires the legacy claim.
--
-- Idempotent migration: create-if-missing tables/columns,
-- create-or-replace functions; safe to apply twice.

-- ---------------------------------------------------------------------------
-- Schema: craft_jobs + profile workshop state
-- ---------------------------------------------------------------------------

create table if not exists public.craft_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  bench smallint not null,
  kind text not null,
  recipe_id text not null,
  units_total integer not null,
  units_completed integer not null default 0,
  unit_duration_ms bigint not null,
  accrued_ms bigint not null default 0,
  status text not null default 'active',
  escrow_inputs jsonb not null default '{}'::jsonb,
  escrow_catalyst jsonb not null default '{}'::jsonb,
  rush_ticket_quality numeric,
  rush_ticket_origin text,
  snapshot jsonb not null default '{}'::jsonb,
  xp_awarded bigint not null default 0,
  outputs jsonb not null default '[]'::jsonb,
  tool_charged boolean not null default false,
  created_at timestamptz not null default now(),
  last_settled_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists craft_jobs_owner_status_idx
  on public.craft_jobs (owner_user_id, status);

alter table public.profiles
  add column if not exists workshop_benches smallint not null default 1;
alter table public.profiles
  add column if not exists workshop_tools jsonb not null default '{}'::jsonb;

-- New mastery tracks (§2.7), seeded exactly like crafting_consumables
-- in 0004 (category 'economy').
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at)
values ('crafting.refining', 'economy', 'Refining', 'Workshop refining experience. Higher levels improve the refining yield toward 100%.', 'refines', 10, true, true, now(), now())
on conflict do nothing;
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at)
values ('crafting.gear', 'economy', 'Gear Crafting', 'Workshop gear-frame and tool crafting experience. Higher levels widen frame quality bounds and raise the temper chance.', 'frames', 25, true, true, now(), now())
on conflict do nothing;

-- Economy metrics: the seven craft meters (§2.10).
alter table public.economy_metrics
  add column if not exists craft_jobs_completed integer not null default 0;
alter table public.economy_metrics
  add column if not exists craft_units_completed integer not null default 0;
alter table public.economy_metrics
  add column if not exists craft_xp_awarded bigint not null default 0;
alter table public.economy_metrics
  add column if not exists materials_destroyed_crafting jsonb not null default '{}'::jsonb;
alter table public.economy_metrics
  add column if not exists refined_units_produced integer not null default 0;
alter table public.economy_metrics
  add column if not exists gear_items_crafted integer not null default 0;
alter table public.economy_metrics
  add column if not exists crafted_market_sales integer not null default 0;
alter table public.economy_metrics
  add column if not exists crafted_market_volume bigint not null default 0;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Remove keys whose value is JSON null — the TS twins build output
-- objects by omitting absent fields, so SQL outputs strip nulls to
-- keep the shapes identical.
create or replace function public.cc_jsonb_strip_nulls(p_obj jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
  from jsonb_each(coalesce(p_obj, '{}'::jsonb))
  where value <> 'null'::jsonb
$$;

-- Earned offline-cap tier hours (src/content/offlineCap.ts twin):
-- base 2h; L20 -> 4, L40 -> 6, L60 -> 8, L80 -> 12.
create or replace function public.cc_earned_offline_cap_hours(p_level integer)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(p_level, 1) >= 80 then 12::numeric
    when coalesce(p_level, 1) >= 60 then 8::numeric
    when coalesce(p_level, 1) >= 40 then 6::numeric
    when coalesce(p_level, 1) >= 20 then 4::numeric
    else 2::numeric
  end
$$;

-- The unified craft catalog (§2.5): the SQL twin of ALL_CRAFT_RECIPES
-- in src/content/crafting.ts, generated from that module and pinned
-- to it by the parity tests. Keys mirror the CraftRecipe interface
-- (camelCase); absent optionals are omitted.
create or replace function public.cc_craft_recipe_catalog()
returns jsonb
language sql
immutable
set search_path = public
as $$
  select $catalog$[{"id":"recipe_medkit","kind":"consumable","name":"Med Kit","category":"survival","inputs":{"ScrapAlloy":15,"ReactiveComponents":8},"unitDurationMs":720000,"requiresLevel":1,"requiresBench":1,"station":"bench","consumableType":"MedKit"},{"id":"recipe_medkit_refined","kind":"consumable","name":"Med Kit (Refined)","category":"survival","inputs":{"ScrapAlloy":25,"ReactiveComponents":15,"VoidDust":1},"unitDurationMs":1500000,"requiresLevel":10,"requiresBench":1,"station":"bench","consumableType":"MedKitRefined"},{"id":"recipe_shieldcell","kind":"consumable","name":"Shield Cell","category":"survival","inputs":{"ScrapAlloy":20,"ReactiveComponents":12},"unitDurationMs":900000,"requiresLevel":3,"requiresBench":1,"station":"bench","consumableType":"ShieldCell"},{"id":"recipe_nanoswarm","kind":"consumable","name":"Nano-Swarm","category":"survival","inputs":{"ScrapAlloy":30,"ReactiveComponents":20,"VoidDust":2},"unitDurationMs":2400000,"requiresLevel":15,"requiresBench":1,"station":"bench","consumableType":"NanoSwarm"},{"id":"recipe_adrenaline","kind":"consumable","name":"Adrenaline Shot","category":"survival","inputs":{"ScrapAlloy":40,"ReactiveComponents":25,"VoidDust":3},"unitDurationMs":3600000,"requiresLevel":20,"requiresBench":1,"station":"bench","consumableType":"AdrenalineShot"},{"id":"recipe_ammo_pack","kind":"consumable","name":"Ammo Pack","category":"offense","inputs":{"ScrapAlloy":10,"BallisticParts":6},"unitDurationMs":600000,"requiresLevel":1,"requiresBench":1,"station":"bench","consumableType":"AmmoPack"},{"id":"recipe_high_capacity_ammo_pack","kind":"consumable","name":"High-Capacity Ammo Pack","category":"offense","inputs":{"ScrapAlloy":18,"BallisticParts":12,"TechFragments":2},"unitDurationMs":1080000,"requiresLevel":6,"requiresBench":1,"station":"bench","consumableType":"HighCapacityAmmoPack"},{"id":"recipe_ap_ammo","kind":"consumable","name":"Armor-Piercing Ammo","category":"offense","inputs":{"ScrapAlloy":15,"BallisticParts":10},"unitDurationMs":900000,"requiresLevel":5,"requiresBench":1,"station":"bench","consumableType":"ArmorPiercingAmmo"},{"id":"recipe_fire_ammo","kind":"consumable","name":"Incendiary Ammo","category":"offense","inputs":{"ScrapAlloy":15,"BallisticParts":8,"IgnitionFluid":3},"unitDurationMs":1080000,"requiresLevel":8,"requiresBench":1,"station":"bench","consumableType":"IncendiaryAmmo"},{"id":"recipe_shock_ammo","kind":"consumable","name":"Shock Ammo","category":"offense","inputs":{"ScrapAlloy":15,"BallisticParts":8,"ConduitWire":3},"unitDurationMs":1080000,"requiresLevel":8,"requiresBench":1,"station":"bench","consumableType":"ShockAmmo"},{"id":"recipe_corrosive_ammo","kind":"consumable","name":"Corrosive Ammo","category":"offense","inputs":{"ScrapAlloy":15,"BallisticParts":8,"AcidCompound":3},"unitDurationMs":1080000,"requiresLevel":8,"requiresBench":1,"station":"bench","consumableType":"CorrosiveAmmo"},{"id":"recipe_cryo_ammo","kind":"consumable","name":"Cryo Ammo","category":"offense","inputs":{"ScrapAlloy":15,"BallisticParts":8,"CryoGel":3},"unitDurationMs":1080000,"requiresLevel":8,"requiresBench":1,"station":"bench","consumableType":"CryoAmmo"},{"id":"recipe_void_ammo","kind":"consumable","name":"Void Ammo","category":"offense","inputs":{"ScrapAlloy":20,"BallisticParts":10,"VoidEssence":5},"unitDurationMs":1500000,"requiresLevel":15,"requiresBench":1,"station":"bench","consumableType":"VoidAmmo"},{"id":"recipe_ordnance","kind":"consumable","name":"Ordnance Charge","category":"offense","inputs":{"ScrapAlloy":12,"BallisticParts":10},"unitDurationMs":720000,"requiresLevel":1,"requiresBench":1,"station":"bench","consumableType":"OrdnanceCharge"},{"id":"recipe_emp_charge","kind":"consumable","name":"EMP Charge","category":"offense","inputs":{"ScrapAlloy":18,"BallisticParts":8,"ConduitWire":4,"TechFragments":2},"unitDurationMs":1320000,"requiresLevel":9,"requiresBench":1,"station":"bench","consumableType":"EMPCharge"},{"id":"recipe_corrosive_charge","kind":"consumable","name":"Corrosive Charge","category":"offense","inputs":{"ScrapAlloy":18,"BallisticParts":8,"AcidCompound":4,"TechFragments":2},"unitDurationMs":1320000,"requiresLevel":9,"requiresBench":1,"station":"bench","consumableType":"CorrosiveCharge"},{"id":"recipe_overcharge","kind":"consumable","name":"Overcharge Stim","category":"offense","inputs":{"ScrapAlloy":25,"BallisticParts":15,"VoidDust":2},"unitDurationMs":1800000,"requiresLevel":12,"requiresBench":1,"station":"bench","consumableType":"OverchargeStim"},{"id":"recipe_targetpainter","kind":"consumable","name":"Target Painter","category":"offense","inputs":{"ScrapAlloy":20,"BallisticParts":10,"TechFragments":2},"unitDurationMs":1200000,"requiresLevel":8,"requiresBench":1,"station":"bench","consumableType":"TargetPainter"},{"id":"recipe_phaseshift","kind":"consumable","name":"Phase Shift Grenade","category":"offense","inputs":{"ScrapAlloy":30,"BallisticParts":15,"VoidDust":5},"unitDurationMs":2100000,"requiresLevel":18,"requiresBench":1,"station":"bench","consumableType":"PhaseShiftGrenade"},{"id":"recipe_luck","kind":"consumable","name":"Luck Booster","category":"utility","inputs":{"ScrapAlloy":15,"TechFragments":8},"unitDurationMs":900000,"requiresLevel":5,"requiresBench":1,"station":"bench","consumableType":"LuckBooster"},{"id":"recipe_scanner","kind":"consumable","name":"Boss Scanner","category":"utility","inputs":{"ScrapAlloy":20,"TechFragments":12},"unitDurationMs":1200000,"requiresLevel":10,"requiresBench":1,"station":"bench","consumableType":"BossScanner"},{"id":"recipe_insurance","kind":"consumable","name":"Insurance Token","category":"utility","inputs":{"ScrapAlloy":30,"TechFragments":15,"VoidDust":2},"unitDurationMs":2100000,"requiresLevel":15,"requiresBench":1,"station":"bench","consumableType":"InsuranceToken"},{"id":"recipe_dataskimmer","kind":"consumable","name":"Data Skimmer","category":"utility","inputs":{"ScrapAlloy":25,"TechFragments":15,"VoidDust":3},"unitDurationMs":2400000,"requiresLevel":18,"requiresBench":1,"station":"bench","consumableType":"DataSkimmer"},{"id":"recipe_jammer","kind":"consumable","name":"Jammer","category":"utility","inputs":{"ScrapAlloy":20,"TechFragments":10,"ConduitWire":2},"unitDurationMs":1500000,"requiresLevel":12,"requiresBench":1,"station":"bench","consumableType":"Jammer"},{"id":"recipe_magnetized","kind":"consumable","name":"Magnetized Payload","category":"utility","inputs":{"ScrapAlloy":15,"BallisticParts":10,"TechFragments":5},"unitDurationMs":1320000,"requiresLevel":10,"requiresBench":1,"station":"bench","consumableType":"MagnetizedPayload"},{"id":"recipe_signal_scrambler","kind":"consumable","name":"Signal Scrambler","category":"utility","inputs":{"ScrapAlloy":15,"TechFragments":10,"ConduitWire":2},"unitDurationMs":1200000,"requiresLevel":7,"requiresBench":1,"station":"bench","consumableType":"SignalScrambler"},{"id":"recipe_loot_beacon","kind":"consumable","name":"Loot Beacon","category":"utility","inputs":{"ScrapAlloy":20,"TechFragments":14,"VoidDust":2},"unitDurationMs":1800000,"requiresLevel":12,"requiresBench":1,"station":"bench","consumableType":"LootBeacon"},{"id":"recipe_salvage_contract","kind":"consumable","name":"Salvage Contract","category":"utility","inputs":{"ScrapAlloy":12,"TechFragments":8},"unitDurationMs":960000,"requiresLevel":5,"requiresBench":1,"station":"bench","consumableType":"SalvageContract"},{"id":"recipe_workshop_rush_ticket","kind":"consumable","name":"Workshop Rush Ticket","category":"utility","inputs":{"ScrapAlloy":18,"TechFragments":12,"VoidDust":1},"unitDurationMs":1440000,"requiresLevel":10,"requiresBench":1,"station":"bench","consumableType":"WorkshopRushTicket"},{"id":"recipe_patch_kit","kind":"consumable","name":"Patch Kit","category":"utility","inputs":{"ScrapAlloy":4,"ReactiveComponents":1},"unitDurationMs":720000,"requiresLevel":1,"requiresBench":1,"station":"bench","consumableType":"PatchKit"},{"id":"recipe_field_patch_kit","kind":"consumable","name":"Field Patch Kit","category":"utility","inputs":{"ScrapAlloy":6,"ReactiveComponents":3,"TechFragments":1,"HeartwoodResin":1},"unitDurationMs":1500000,"requiresLevel":12,"requiresBench":1,"station":"bench","consumableType":"FieldPatchKit"},{"id":"recipe_master_patch_kit","kind":"consumable","name":"Master Patch Kit","category":"utility","inputs":{"ScrapAlloy":8,"ReactiveComponents":5,"TechFragments":3,"VoidDust":1},"unitDurationMs":2700000,"requiresLevel":1,"requiresBench":1,"station":"bench","requiresMastery":{"track":"crafting_consumables","level":15},"consumableType":"MasterPatchKit"},{"id":"recipe_fuel_cell","kind":"consumable","name":"Fuel Cell","category":"utility","inputs":{"ScrapAlloy":6,"NitrocellGel":1},"unitDurationMs":900000,"requiresLevel":8,"requiresBench":1,"station":"bench","consumableType":"FuelCell"},{"id":"refine_refined_alloy","kind":"refine","name":"Refined Alloy","category":"refining","inputs":{"ScrapAlloy":10},"unitDurationMs":1200000,"requiresLevel":1,"requiresBench":1,"station":"crusher","outputMaterial":"RefinedAlloy","outputBase":8},{"id":"refine_tempered_parts","kind":"refine","name":"Tempered Parts","category":"refining","inputs":{"BallisticParts":10},"unitDurationMs":1200000,"requiresLevel":1,"requiresBench":1,"station":"crusher","outputMaterial":"TemperedParts","outputBase":8},{"id":"refine_stabilized_cells","kind":"refine","name":"Stabilized Cells","category":"refining","inputs":{"ReactiveComponents":10},"unitDurationMs":1200000,"requiresLevel":1,"requiresBench":1,"station":"crusher","outputMaterial":"StabilizedCells","outputBase":8},{"id":"refine_woven_circuits","kind":"refine","name":"Woven Circuits","category":"refining","inputs":{"TechFragments":10},"unitDurationMs":1200000,"requiresLevel":1,"requiresBench":1,"station":"crusher","outputMaterial":"WovenCircuits","outputBase":8},{"id":"refine_condensed_void","kind":"refine","name":"Condensed Void","category":"refining","inputs":{"VoidDust":10},"unitDurationMs":1500000,"requiresLevel":1,"requiresBench":1,"station":"crusher","outputMaterial":"CondensedVoid","outputBase":8},{"id":"refine_composite_plating","kind":"refine","name":"Composite Plating","category":"refining","inputs":{"RefinedAlloy":4,"StabilizedCells":2},"unitDurationMs":2700000,"requiresLevel":1,"requiresBench":3,"station":"furnace","outputMaterial":"CompositePlating","outputBase":2},{"id":"refine_circuit_lattice","kind":"refine","name":"Circuit Lattice","category":"refining","inputs":{"WovenCircuits":4,"TemperedParts":2},"unitDurationMs":2700000,"requiresLevel":1,"requiresBench":3,"station":"furnace","outputMaterial":"CircuitLattice","outputBase":2},{"id":"refine_voidweave","kind":"refine","name":"Voidweave","category":"refining","inputs":{"CondensedVoid":2,"WovenCircuits":2},"unitDurationMs":2700000,"requiresLevel":1,"requiresBench":3,"station":"furnace","outputMaterial":"Voidweave","outputBase":2},{"id":"frame_weapon","kind":"gear","name":"Weapon Frame","category":"gear","inputs":{"RefinedAlloy":6,"TemperedParts":4,"ForgeheartIngots":2},"unitDurationMs":0,"requiresLevel":1,"requiresBench":1,"station":"bench","gearSlot":"weapon","durationByRarityMs":{"Common":5400000,"Uncommon":5400000,"Rare":9000000,"Epic":14400000}},{"id":"frame_shield","kind":"gear","name":"Shield Frame","category":"gear","inputs":{"StabilizedCells":6,"RefinedAlloy":4,"HeartwoodResin":2},"unitDurationMs":0,"requiresLevel":1,"requiresBench":1,"station":"bench","gearSlot":"shield","durationByRarityMs":{"Common":5400000,"Uncommon":5400000,"Rare":9000000,"Epic":14400000}},{"id":"frame_class_mod","kind":"gear","name":"Class Mod Frame","category":"gear","inputs":{"WovenCircuits":5,"CircuitLattice":2,"PrismShards":2},"unitDurationMs":0,"requiresLevel":1,"requiresBench":1,"station":"bench","gearSlot":"classMod","durationByRarityMs":{"Common":5400000,"Uncommon":5400000,"Rare":9000000,"Epic":14400000}},{"id":"frame_relic","kind":"gear","name":"Relic Frame","category":"gear","inputs":{"CondensedVoid":4,"Voidweave":2,"MycoSteelFiber":2},"unitDurationMs":0,"requiresLevel":1,"requiresBench":1,"station":"bench","gearSlot":"relic","durationByRarityMs":{"Common":5400000,"Uncommon":5400000,"Rare":9000000,"Epic":14400000}},{"id":"frame_ordnance","kind":"gear","name":"Ordnance Frame","category":"gear","inputs":{"TemperedParts":6,"StabilizedCells":3,"ForgeheartIngots":2},"unitDurationMs":0,"requiresLevel":1,"requiresBench":1,"station":"bench","gearSlot":"ordnance","durationByRarityMs":{"Common":5400000,"Uncommon":5400000,"Rare":9000000,"Epic":14400000}},{"id":"tool_precision_calipers","kind":"tool","name":"Precision Calipers","category":"tools","inputs":{"CircuitLattice":2,"PrismShards":2},"unitDurationMs":3600000,"requiresLevel":1,"requiresBench":1,"station":"bench","toolId":"tool_precision_calipers"},{"id":"tool_servo_bench_rig","kind":"tool","name":"Servo Bench Rig","category":"tools","inputs":{"CompositePlating":2,"MagnetiteCores":2},"unitDurationMs":3600000,"requiresLevel":1,"requiresBench":1,"station":"bench","toolId":"tool_servo_bench_rig"},{"id":"tool_reclaimer_head","kind":"tool","name":"Reclaimer Head","category":"tools","inputs":{"CompositePlating":1,"CircuitLattice":1,"Voidweave":1},"unitDurationMs":3600000,"requiresLevel":1,"requiresBench":1,"station":"bench","toolId":"tool_reclaimer_head"}]$catalog$::jsonb
$$;

create or replace function public.cc_craft_recipe(p_recipe_id text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select elem
  from jsonb_array_elements(public.cc_craft_recipe_catalog()) as elem
  where elem ->> 'id' = p_recipe_id
  limit 1
$$;

-- The §2.4 quality bounds function (TS twin: craftQualityBounds in
-- src/content/crafting.ts). Base bounds are the defs' craft ranges
-- with the brief's overrides applied (Patch Kit crafts at 75-130,
-- §2.5d); the cap is the def cap (175 for every craftable def).
--   min = baseMin + min(20, 1.5 x (mastery-1)) + [Lab +5] + shift
--         + [catalyst +10]
--   max = baseMax + min(25, 2.0 x (mastery-1)) + shift + [catalyst +15],
--         capped at 175; min never exceeds max.
-- Unknown item keys fall back to the gear-frame band (75-150).
create or replace function public.cc_craft_quality_bounds(
  p_item_key text,
  p_mastery_level integer,
  p_bench integer,
  p_catalyst boolean,
  p_quality_shift numeric
)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_base_min numeric;
  v_base_max numeric;
  v_cap numeric := 175;
  v_mastery numeric := greatest(1, coalesce(p_mastery_level, 1));
  v_min numeric;
  v_max numeric;
begin
  select craft_min, craft_max into v_base_min, v_base_max
  from (values
    ('MedKit', 75::numeric, 125::numeric),
    ('MedKitRefined', 80::numeric, 140::numeric),
    ('ShieldCell', 75::numeric, 130::numeric),
    ('NanoSwarm', 80::numeric, 145::numeric),
    ('AdrenalineShot', 75::numeric, 150::numeric),
    ('AmmoPack', 70::numeric, 125::numeric),
    ('HighCapacityAmmoPack', 75::numeric, 140::numeric),
    ('ArmorPiercingAmmo', 75::numeric, 135::numeric),
    ('IncendiaryAmmo', 75::numeric, 140::numeric),
    ('ShockAmmo', 75::numeric, 140::numeric),
    ('CorrosiveAmmo', 75::numeric, 140::numeric),
    ('CryoAmmo', 75::numeric, 140::numeric),
    ('VoidAmmo', 70::numeric, 155::numeric),
    ('OrdnanceCharge', 75::numeric, 145::numeric),
    ('EMPCharge', 75::numeric, 145::numeric),
    ('CorrosiveCharge', 75::numeric, 145::numeric),
    ('OverchargeStim', 70::numeric, 150::numeric),
    ('TargetPainter', 75::numeric, 145::numeric),
    ('PhaseShiftGrenade', 75::numeric, 155::numeric),
    ('LuckBooster', 75::numeric, 135::numeric),
    ('BossScanner', 80::numeric, 160::numeric),
    ('InsuranceToken', 80::numeric, 145::numeric),
    ('DataSkimmer', 75::numeric, 150::numeric),
    ('Jammer', 75::numeric, 150::numeric),
    ('MagnetizedPayload', 75::numeric, 150::numeric),
    ('SignalScrambler', 75::numeric, 145::numeric),
    ('LootBeacon', 70::numeric, 150::numeric),
    ('SalvageContract', 75::numeric, 150::numeric),
    ('WorkshopRushTicket', 75::numeric, 150::numeric),
    ('PatchKit', 75::numeric, 130::numeric),
    ('FieldPatchKit', 75::numeric, 140::numeric),
    ('MasterPatchKit', 80::numeric, 160::numeric),
    ('FuelCell', 75::numeric, 150::numeric)
  ) as bounds(consumable_type, craft_min, craft_max)
  where consumable_type = p_item_key;

  v_min := coalesce(v_base_min, 75)
    + least(20, 1.5 * (v_mastery - 1))
    + case when coalesce(p_bench, 1) >= 3 then 5 else 0 end
    + coalesce(p_quality_shift, 0);
  v_max := coalesce(v_base_max, 150)
    + least(25, 2.0 * (v_mastery - 1))
    + coalesce(p_quality_shift, 0);
  if coalesce(p_catalyst, false) then
    v_min := v_min + 10;
    v_max := v_max + 15;
  end if;
  v_max := least(v_max, 175);
  if v_min > v_max then v_min := v_max; end if;
  return jsonb_build_object('min', v_min, 'max', v_max, 'cap', v_cap);
end;
$$;

-- The §2.3 unit XP formula (TS twin: craftUnitXp). The benchmark is
-- 1200 ticks/hour x the best unlocked area's idleXpPerTick (the
-- roamingAreas table by unlock level: 1/4/8/12/16/20/25 ->
-- 1.0/1.2/1.4/1.65/1.9/2.15/2.4).
create or replace function public.cc_craft_unit_xp(
  p_duration_ms bigint,
  p_level integer,
  p_rate numeric
)
returns bigint
language sql
immutable
set search_path = public
as $$
  select round(
    (greatest(0, coalesce(p_duration_ms, 0))::numeric / 3600000)
    * 1200
    * case
        when coalesce(p_level, 1) >= 25 then 2.4
        when coalesce(p_level, 1) >= 20 then 2.15
        when coalesce(p_level, 1) >= 16 then 1.9
        when coalesce(p_level, 1) >= 12 then 1.65
        when coalesce(p_level, 1) >= 8 then 1.4
        when coalesce(p_level, 1) >= 4 then 1.2
        else 1.0
      end
    * coalesce(p_rate, 0.775)
  )::bigint
$$;

-- A player's mastery level for a track (1 when no row exists).
create or replace function public.cc_player_mastery_level(p_player_id uuid, p_track text)
returns integer
language sql
stable
set search_path = public
as $$
  select greatest(1, coalesce(
    (select mastery_level from public.player_masteries
      where user_id = p_player_id and mastery_id = p_track),
    1))
$$;

-- ---------------------------------------------------------------------------
-- Unit completion + the settler (§2.1)
-- ---------------------------------------------------------------------------

-- Complete ONE unit of a job: price its output from the state at the
-- completion instant (level/mastery reads happen before this unit's
-- own XP/mastery land, exactly like the TS engine), persist the
-- output, grant mastery + player XP, and append the output record to
-- the job. Gear units record a PENDING output — the Chef finalizes
-- the item through the shared TS generators (see the header).
-- Returns the output object (nulls stripped).
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
begin
  select * into job from public.craft_jobs where id = p_job_id for update;
  if not found then raise exception 'Job not found'; end if;
  actor := job.owner_user_id;
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
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
      p_quality_shift
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
    v_tempered := random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', case when v_tempered then 3 else 1 end,
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

-- The settler (§2.1): advance every active job from server timestamps.
-- Progress accrues ONLY while `crafting` is the recorded active
-- action. Every call rebases last_settled_at on every active job, so
-- paused or capped time is consumed by the settle that observes it
-- and can never accrue later. With p_max_advance_ms null (lazy
-- settles: reads, transitions, craft ops), attended time — up to the
-- last activity heartbeat + 5 minutes of grace — is never truncated
-- and only the away tail is capped, by the internal effective cap
-- (earned tier + the player's limiter, 24h ceiling, WITHOUT the
-- Scavenger keystone bonus). With p_max_advance_ms set (offline
-- settlement, F5), the caller computed the exact cap including the
-- bonus and the WHOLE delta is capped by it — the rule
-- cc_settle_offline_roaming applies. Levers resolve live at
-- completion through cc_economy_config_number, SQL-clamped to their
-- registry ranges.
create or replace function public.cc_settle_craft_jobs(
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
  v_xp_rate numeric := least(0.85, greatest(0.70,
    public.cc_economy_config_number('craftXpRate', 0.775)));
  v_shift numeric := least(10, greatest(-10,
    public.cc_economy_config_number('craftQualityShift', 0)));
  v_temper numeric := least(0.30, greatest(0,
    public.cc_economy_config_number('gearTemperBaseChance', 0.05)));
  v_yield_base numeric := least(1.0, greatest(0.5,
    public.cc_economy_config_number('refineBaseYield', 0.8)));
  v_ids uuid[] := '{}';
  v_benches integer[] := '{}';
  v_advances bigint[] := '{}';
  v_job record;
  v_start_ms bigint;
  v_raw bigint;
  v_attended bigint;
  v_advance bigint;
  v_bench integer;
  v_budget bigint;
  v_need bigint;
  v_output jsonb;
  v_tools jsonb;
  v_tool_id text;
  v_charges integer;
  v_fitted_key text;
  v_total_xp bigint := 0;
  v_jobs_completed integer := 0;
  v_max_advance bigint := 0;
  v_completions jsonb := '[]'::jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  select * into p from public.profiles where id = actor for update;
  if not found then
    return jsonb_build_object('settled', false, 'reason', 'no_profile',
      'advanced_ms', 0, 'xp_awarded', 0, 'jobs_completed', 0,
      'completions', '[]'::jsonb);
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

  -- Pass 1: rebase every active job and price its advance.
  for v_job in
    select * from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by created_at asc, id asc
     for update
  loop
    v_start_ms := (extract(epoch from v_job.last_settled_at) * 1000)::bigint;
    v_raw := greatest(0, v_now_ms - v_start_ms);
    update public.craft_jobs set last_settled_at = v_now where id = v_job.id;
    if v_action is distinct from 'crafting' or v_raw <= 0 then
      v_advance := 0;
    elsif p_max_advance_ms is not null then
      v_advance := least(v_raw, greatest(0, p_max_advance_ms));
    else
      v_attended := least(v_raw, greatest(0,
        coalesce(v_heartbeat_ms, v_start_ms) + 300000 - v_start_ms));
      v_advance := v_attended + least(v_raw - v_attended, v_away_cap_ms);
    end if;
    v_ids := v_ids || v_job.id;
    v_benches := v_benches || v_job.bench;
    v_advances := v_advances || v_advance;
    v_max_advance := greatest(v_max_advance, v_advance);
  end loop;

  if v_action is distinct from 'crafting' then
    return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
      'xp_awarded', 0, 'jobs_completed', 0, 'completions', '[]'::jsonb);
  end if;

  -- Pass 2: each bench's queue consumes its window in order; leftover
  -- flows to the next job on the bench.
  for v_bench in
    select distinct bench from public.craft_jobs
     where owner_user_id = actor and status = 'active'
     order by bench asc
  loop
    select coalesce(max(adv), 0) into v_budget
      from unnest(v_ids, v_benches, v_advances) as t(jid, b, adv)
     where b = v_bench;
    for v_job in
      select * from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench
       order by created_at asc, id asc
       for update
    loop
      exit when v_budget <= 0;
      -- A fitted tool's charge is spent when the job actually starts.
      if not v_job.tool_charged and (v_job.snapshot ->> 'toolId') is not null then
        v_tool_id := v_job.snapshot ->> 'toolId';
        update public.craft_jobs set tool_charged = true where id = v_job.id;
        select * into p from public.profiles where id = actor;
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
         where id = actor;
      end if;
      while v_budget > 0 and v_job.units_completed < v_job.units_total loop
        v_need := v_job.unit_duration_ms - v_job.accrued_ms;
        if v_budget < v_need then
          update public.craft_jobs
             set accrued_ms = accrued_ms + v_budget where id = v_job.id;
          v_budget := 0;
        else
          v_budget := v_budget - v_need;
          update public.craft_jobs set accrued_ms = 0 where id = v_job.id;
          v_output := public.cc_complete_craft_unit(
            v_job.id, v_xp_rate, v_shift, v_temper, v_yield_base);
          v_total_xp := v_total_xp + (v_output ->> 'xp')::bigint;
          v_completions := v_completions || jsonb_build_array(
            v_output || jsonb_build_object('jobId', v_job.id, 'recipeId', v_job.recipe_id));
          v_job.units_completed := v_job.units_completed + 1;
        end if;
      end loop;
      if v_job.units_completed >= v_job.units_total then
        update public.craft_jobs
           set status = 'complete', completed_at = v_now where id = v_job.id;
        v_jobs_completed := v_jobs_completed + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('settled', true, 'advanced_ms', v_max_advance,
    'xp_awarded', v_total_xp, 'jobs_completed', v_jobs_completed,
    'completions', v_completions);
end;
$$;

-- ---------------------------------------------------------------------------
-- Enqueue / cancel / bench unlock / tool fitting (§2.1, §2.2, §2.5e)
-- ---------------------------------------------------------------------------

-- The material key space (profiles.materials); every other recipe
-- input key resolves against profiles.essences (the legacy recipe
-- convention). TS twin: isMaterialInput in src/content/crafting.ts.
create or replace function public.cc_is_material_key(p_key text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_key = any (array[
    'ScrapAlloy','BallisticParts','ReactiveComponents','TechFragments','VoidDust',
    'Siltglass','NitrocellGel','HeartwoodResin','ForgeheartIngots','PrismShards',
    'MagnetiteCores','MycoSteelFiber','RefinedAlloy','TemperedParts','StabilizedCells',
    'WovenCircuits','CondensedVoid','CompositePlating','CircuitLattice','Voidweave'])
$$;

-- The job record as jsonb, keyed exactly like the TS CraftJobRecord
-- (epoch-ms timestamps) so both stores hand the client one shape.
create or replace function public.cc_craft_job_json(j public.craft_jobs)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', j.id,
    'owner_user_id', j.owner_user_id,
    'bench', j.bench,
    'kind', j.kind,
    'recipe_id', j.recipe_id,
    'units_total', j.units_total,
    'units_completed', j.units_completed,
    'unit_duration_ms', j.unit_duration_ms,
    'accrued_ms', j.accrued_ms,
    'status', j.status,
    'escrow_inputs', j.escrow_inputs,
    'escrow_catalyst', j.escrow_catalyst,
    'rush_ticket_quality', j.rush_ticket_quality,
    'rush_ticket_origin', j.rush_ticket_origin,
    'snapshot', j.snapshot,
    'xp_awarded', j.xp_awarded,
    'outputs', j.outputs,
    'tool_charged', j.tool_charged,
    'created_at_ms', (extract(epoch from j.created_at) * 1000)::bigint,
    'last_settled_ms', (extract(epoch from j.last_settled_at) * 1000)::bigint,
    'completed_at_ms', case when j.completed_at is null then null
      else (extract(epoch from j.completed_at) * 1000)::bigint end
  )
$$;

-- Enqueue: settle first, gate, verify the FULL escrow, take it, and
-- insert the job with its snapshotted modifiers. The efficiency
-- bonus is a trusted server parameter: the Chef derives it from the
-- player's skill spends + equipped class mod (skillBonusesFromRecords)
-- and passes it in — it never comes from the request body (§2.7).
create or replace function public.cc_enqueue_craft_job(
  p_player_id uuid,
  nonce text,
  p_bench integer,
  p_recipe_id text,
  p_units integer,
  p_rarity text,
  p_use_catalyst boolean,
  p_use_rush_ticket boolean,
  p_efficiency_bonus numeric
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
  v_consumed jsonb;
  v_skill_mult numeric;
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

  -- Queue capacity: one running + five queued per bench.
  if (select count(*) from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench) >= 6 then
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
    v_rush_reduction := least(0.45, 0.2 * coalesce(v_rush_quality, 100) / 100);
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

  -- Snapshotted unit duration: base x skill x tool x scalar x rush.
  v_skill_mult := 1 - least(0.20, 0.02 * round(greatest(0, coalesce(p_efficiency_bonus, 0)) * 10));
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
    escrow_inputs, escrow_catalyst, rush_ticket_quality, rush_ticket_origin,
    snapshot)
  values (
    actor, v_bench, v_kind, p_recipe_id, v_units, v_duration,
    v_escrow, v_escrow_catalyst, v_rush_quality, v_rush_origin,
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
      'gearRarity', case when v_kind = 'gear' then v_rarity else null end
    ))
  returning * into v_job;

  select * into p from public.profiles where id = actor;
  result := jsonb_build_object(
    'action_type', 'cc_enqueue_craft_job',
    'profile', public.cc_profile_snapshot(p),
    'job', public.cc_craft_job_json(v_job)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enqueue_craft_job', nonce, result);
  return result;
end;
$$;

-- Cancel (§2.1 refund table): queued units refund 100%; the
-- in-progress unit refunds floor(50%) of each input; completed units
-- are kept. The rush ticket returns as a batch at its escrowed
-- quality only when the job never started — on a started job it is
-- spent. Refunds return the ORIGINAL inputs (materials/essences and
-- the catalyst alike).
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
    'rush_ticket_refunded', v_rush_refunded
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cancel_craft_job', nonce, result);
  return result;
end;
$$;

-- Bench unlock (§2.2): the next bench, charged atomically into the
-- credit sink. Prices are MECHANICS.md §8 verbatim except Bench 1,
-- which ships free at level 1 (flag F3).
create or replace function public.cc_unlock_bench(p_player_id uuid, nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  v_next integer;
  v_level integer;
  v_cost bigint;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  v_next := coalesce(p.workshop_benches, 1) + 1;
  if v_next > 3 then raise exception 'All benches already unlocked'; end if;
  if v_next = 2 then
    v_level := 15; v_cost := 5000;
  else
    v_level := 30; v_cost := 25000;
  end if;
  if p.player_level < v_level then
    raise exception 'Bench % requires level %', v_next, v_level;
  end if;
  if p.credits < v_cost then raise exception 'Insufficient credits'; end if;
  if v_next = 3 and coalesce((p.materials ->> 'VoidDust')::integer, 0) < 10 then
    raise exception 'Insufficient material %', 'VoidDust';
  end if;

  update public.profiles
     set credits = credits - v_cost,
         materials = case when v_next = 3
           then public.cc_jsonb_add_int(materials, 'VoidDust', -10)
           else materials end,
         workshop_benches = v_next,
         updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_unlock_bench',
    'profile', public.cc_profile_snapshot(p),
    'benches', v_next
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_unlock_bench', nonce, result);
  return result;
end;
$$;

-- Fit (or un-fit, with a null tool) a workshop tool on a bench
-- (§2.5e). One bench per tool: fitting it here un-fits it elsewhere.
create or replace function public.cc_fit_workshop_tool(
  p_player_id uuid,
  nonce text,
  p_bench integer,
  p_tool_id text
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
  v_tools jsonb;
  v_key text;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  if coalesce(p_bench, 0) < 1 or p_bench > coalesce(p.workshop_benches, 1) then
    raise exception 'Bench not unlocked';
  end if;

  v_tools := coalesce(p.workshop_tools, '{}'::jsonb);
  if p_tool_id is not null then
    if p_tool_id not in ('tool_precision_calipers', 'tool_servo_bench_rig', 'tool_reclaimer_head') then
      raise exception 'Unknown tool';
    end if;
    if coalesce(v_tools -> 'owned' ->> p_tool_id, 'false') <> 'true' then
      raise exception 'Tool not owned';
    end if;
    for v_key in select key from jsonb_each(coalesce(v_tools -> 'fitted', '{}'::jsonb))
    loop
      if v_tools -> 'fitted' ->> v_key = p_tool_id then
        v_tools := jsonb_set(v_tools, array['fitted', v_key], 'null'::jsonb, true);
      end if;
    end loop;
  end if;
  v_tools := jsonb_set(v_tools, array['fitted', p_bench::text],
    coalesce(to_jsonb(p_tool_id), 'null'::jsonb), true);

  update public.profiles set workshop_tools = v_tools, updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_fit_workshop_tool',
    'profile', public.cc_profile_snapshot(p),
    'fitted', coalesce(p.workshop_tools -> 'fitted', '{}'::jsonb)
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_fit_workshop_tool', nonce, result);
  return result;
end;
$$;

-- Pending crafted gear (§2.5c): gear units complete as pending
-- outputs; the Chef reads them here, generates the item through the
-- shared TS generators, inserts it, and calls cc_finalize_crafted_gear.
create or replace function public.cc_pending_crafted_gear(p_player_id uuid)
returns table(job_id uuid, unit integer, slot text, rarity text, item_level integer, draws integer)
language sql
stable
set search_path = public
as $$
  select j.id,
         (o ->> 'unit')::integer,
         o ->> 'slot',
         o ->> 'rarity',
         (o ->> 'item_level')::integer,
         (o ->> 'draws')::integer
    from public.craft_jobs j,
         jsonb_array_elements(j.outputs) as o
   where j.owner_user_id = p_player_id
     and o ->> 'pending' = 'true'
$$;

create or replace function public.cc_finalize_crafted_gear(
  p_player_id uuid,
  p_job_id uuid,
  p_unit integer,
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  job public.craft_jobs%rowtype;
  v_outputs jsonb;
begin
  select * into job from public.craft_jobs
   where id = p_job_id and owner_user_id = p_player_id for update;
  if not found then raise exception 'Job not found'; end if;

  select coalesce(jsonb_agg(
    case
      when (elem ->> 'unit')::integer = p_unit and elem ->> 'pending' = 'true'
        then (elem - 'pending' - 'slot' - 'draws' - 'item_level')
             || jsonb_build_object('itemId', p_item_id)
      else elem
    end order by ord), '[]'::jsonb)
    into v_outputs
    from jsonb_array_elements(job.outputs) with ordinality as t(elem, ord);

  update public.craft_jobs set outputs = v_outputs where id = job.id;
  return jsonb_build_object('job_id', p_job_id, 'unit', p_unit, 'item_id', p_item_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Restated: activity transitions settle the outgoing action's jobs (§2.1)
-- 0004 bodies verbatim + one settle call after the advisory lock.
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
    'market_listing'
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
-- Restated: cc_market_create_material — 0023 definition verbatim except
-- the material whitelist grows 12 -> 20 ids (§2.6: refined + composite
-- materials become listable; essences remain unlistable).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cc_market_create_material(p_player_id uuid, nonce text, material_id text, quantity integer, price_credits bigint)
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
  if material_id not in ('ScrapAlloy','BallisticParts','ReactiveComponents','TechFragments','VoidDust','Siltglass','NitrocellGel','HeartwoodResin','ForgeheartIngots','PrismShards','MagnetiteCores','MycoSteelFiber','RefinedAlloy','TemperedParts','StabilizedCells','WovenCircuits','CondensedVoid','CompositePlating','CircuitLattice','Voidweave') then
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

-- ---------------------------------------------------------------------------
-- Restated: cc_refuel_vehicle / cc_use_patch_kit learn the crafted
-- types (§2.5d). The old signatures are dropped first so no call can
-- go ambiguous between the 0021 and 0024 arities.
-- ---------------------------------------------------------------------------

drop function if exists public.cc_refuel_vehicle(uuid, text, integer);
drop function if exists public.cc_use_patch_kit(uuid, text, uuid);

-- Fuel per cell = sum over the FIFO-consumed batches of
-- take x quality x (100 units / 100): the vendor's Generic cell is a
-- flat-100 batch, so it loads exactly 100 as shipped; a crafted
-- FuelCell loads 100 x its batches' weighted quality.
CREATE OR REPLACE FUNCTION public.cc_refuel_vehicle(p_player_id uuid, nonce text, cells integer, p_item_key text DEFAULT 'GenericFuelCell')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  qty integer := coalesce(cells, 0);
  current_count integer;
  consumed jsonb;
  fuel_added bigint;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if qty < 1 then raise exception 'cells must be a positive integer'; end if;
  if p_item_key not in ('GenericFuelCell', 'FuelCell') then raise exception 'Unknown fuel cell type'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;

  current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> p_item_key)::integer, 0);
  if current_count < qty then raise exception 'Insufficient consumable quantity for %', p_item_key; end if;

  if not exists (select 1 from public.consumable_batches where owner_user_id = actor and consumable_type = p_item_key and quantity > 0) then
    perform public.cc_add_consumable_batch(actor, p_item_key, current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
  end if;
  consumed := public.cc_consume_consumable_batch(actor, p_item_key, qty, 'vehicle', 'Loaded into vehicle tank', '{}'::jsonb);
  select coalesce(round(sum((entry ->> 'quantity')::numeric * (entry ->> 'quality_percent')::numeric)), 0)::bigint
    into fuel_added
    from jsonb_array_elements(consumed -> 'consumed') as entry;

  update public.profiles
     set consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array[p_item_key], to_jsonb(greatest(current_count - qty, 0)), true),
         vehicle_fuel = vehicle_fuel + fuel_added,
         updated_at = now()
   where id = actor
   returning * into p;

  result := jsonb_build_object(
    'action_type', 'cc_refuel_vehicle',
    'profile', public.cc_profile_snapshot(p),
    'cells_loaded', qty,
    'fuel_units_added', fuel_added,
    'vehicle_fuel', p.vehicle_fuel
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_refuel_vehicle', nonce, result);
  return result;
end;
$function$;

-- Patch-kit tiers (§2.5d, flag F1): bases 30 / 45 / 80 by type, each
-- scaled by the consumed batch's quality (the shipped formula).
CREATE OR REPLACE FUNCTION public.cc_use_patch_kit(p_player_id uuid, nonce text, item_id uuid, p_item_key text DEFAULT 'PatchKit')
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
  current_count integer;
  consumed jsonb;
  kit_quality numeric;
  kit_base numeric;
  restored numeric;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  kit_base := case p_item_key
    when 'PatchKit' then 30
    when 'FieldPatchKit' then 45
    when 'MasterPatchKit' then 80
    else null
  end;
  if kit_base is null then raise exception 'Unknown patch kit type'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.kind <> 'vehicle' then raise exception 'Item is not a vehicle'; end if;
  if item.runtime_state in ('listed','consumed','salvaged') then raise exception 'Item state invalid'; end if;

  current_count := coalesce((coalesce(p.consumables, '{}'::jsonb) ->> p_item_key)::integer, 0);
  if current_count < 1 then raise exception 'Insufficient consumable quantity for %', p_item_key; end if;

  if not exists (select 1 from public.consumable_batches where owner_user_id = actor and consumable_type = p_item_key and quantity > 0) then
    perform public.cc_add_consumable_batch(actor, p_item_key, current_count, 100, 'vendor', null, null, 'admin_adjust', 'Backfilled legacy count into 100% batch before consumption', '{}'::jsonb);
  end if;
  consumed := public.cc_consume_consumable_batch(actor, p_item_key, 1, 'vehicle', 'Vehicle condition repair', '{}'::jsonb);
  kit_quality := coalesce((consumed -> 'consumed' -> 0 ->> 'quality_percent')::numeric, 100);
  restored := greatest(1, round(kit_base * kit_quality / 100));

  update public.profiles
     set consumables = jsonb_set(coalesce(consumables, '{}'::jsonb), array[p_item_key], to_jsonb(greatest(current_count - 1, 0)), true),
         updated_at = now()
   where id = actor
   returning * into p;

  update public.item_instances
     set condition_current = least(coalesce(condition_max, 100), coalesce(condition_current, coalesce(condition_max, 100)) + restored),
         updated_at = now()
   where id = item.id
   returning * into item;

  result := jsonb_build_object(
    'action_type', 'cc_use_patch_kit',
    'profile', public.cc_profile_snapshot(p),
    'item', to_jsonb(item),
    'restored', restored,
    'condition_current', item.condition_current,
    'condition_max', item.condition_max
  );
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_use_patch_kit', nonce, result);
  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Restated: cc_compute_economy_metrics — the 0018 definition plus the
-- seven craft meters (§2.10). Craft attribution rules:
--   * Jobs/units/XP/refined output read from craft_jobs by completion
--     day (the settler's own record; the settler writes no ledger
--     rows of its own).
--   * Materials destroyed by crafting = enqueue escrows (inputs +
--     catalyst, from the cc_enqueue_craft_job ledger payloads) minus
--     cancel refunds (cc_cancel_craft_job payloads), per material id,
--     positive nets only.
--   * Crafted gear counts item_instances whose payload origin is
--     'crafted' (stamped by the shared-generator finalizer).
--   * Crafted market sales = accepted listings whose listing carried
--     a crafted batch origin or whose item payload is origin
--     'crafted'.
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
      filter (where action_type in ('cc_apply_chef_rewards', 'cc_settle_offline_roaming', 'cc_claim_roaming_rewards')), 0) as cache_fragments_awarded
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

  v_minted_total := m.minted_roaming + m.minted_boss + m.minted_offline + m.minted_other;
  v_destroyed_total := m.destroyed_market_fees + m.destroyed_vendor
    + m.destroyed_resurrection + m.destroyed_respec
    + m.destroyed_boss_entry_fees + m.destroyed_boss_death_fees;

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
    computed_at = excluded.computed_at;

  return (select to_jsonb(e) from public.economy_metrics e where e.day = _day);
end;
$$;
