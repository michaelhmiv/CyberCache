-- 0073 — Economy slice 9: BENCH COLLAPSE + RELIC MERGER
-- (economy brief §8 as amended by ruling 9, 2026-11-03).
--
-- The three bench tiers (Basic / Forge / Lab) become ONE bench:
-- always owned, ×1.00, no quality scaling of its own. The three
-- crafted workshop tools (Precision Calipers, Servo Bench Rig,
-- Reclaimer Head — fittable, expiring assets under the old law)
-- convert into the relic family with their effects intact, as
-- permanent hunter-equipped relics; the fit mechanic retires.
-- The Lab's ×1.10 / +5 ceiling survives ONLY as a top-end relic
-- effect (the Prime Laboratory, a new named craft relic), hard-
-- clamped at exactly ×1.10 / +5 in both twins' composers.
--
-- Data pass (this file):
--   §1  bench_relic_conversion_audit — the conversion record.
--   §2  Collapse refunds (brief §8.6): a profile at bench 2 is
--       refunded 5,000 cr; at bench 3, 30,000 cr + 10 VoidDust.
--       (Pre-flight fact, verified 2026-11-03: all 310 live
--       profiles own exactly 1 bench, so the expected payout is
--       zero — the rule ships anyway, and the scratch-cluster
--       verification exercises it on fixtures.)
--   §3  Tool → relic conversion: every owned tool becomes an
--       Epic named relic item (level = the profile's level),
--       unequipped in inventory, affixes byte-identical to the
--       TS generator's craftAffixesForRelic output.
--   §4  Active kind='tool' jobs finish as what they now are:
--       gear jobs minting the named relic at Epic.
--   §5  Every active generic job moves to bench 1 (bench 0 is
--       the repair/shield-tech service lane — untouched), and
--       profiles are tombstoned: workshop_benches = 1,
--       workshop_tools = '{}' (kept as a column; no reader
--       remains — the state views report it empty).
--
-- Function provenance (collision law — restated from chain heads):
--   cc_craft_recipe_catalog   regenerated from TS content
--                             (src/content/crafting.ts ALL_CRAFT_RECIPES)
--   cc_craft_quality_bounds   0044 body, Lab bench term removed
--   cc_enqueue_craft_job      0069 body (Econ 5's restatement)
--   cc_enqueue_tint_job       0069 body
--   cc_complete_craft_unit    0067 body (Econ 4's restatement)
--   cc_pending_crafted_gear   0067 body (+ named_relic column)
--   cc_research_course        0038 body (requiresBench keys out)
--   cc_research_catalog       0038 body (requiresBench keys out)
--   cc_enroll_research        0038 body (bench gate out)
--   RETIRED: cc_unlock_bench (0061), cc_fit_workshop_tool (0024)
--   NOT restated (verified no functional delta): cc_settle_craft_jobs
--   and cc_fire_overclock_workshop (0067) — their per-bench loops
--   already span benches {0, 1} and their tool_charged marking is
--   snapshot-driven; cc_cancel_craft_job (0069) has no bench/tool
--   references at all.
--
-- Idempotent: the whole file applies twice cleanly (the bench
-- re-check + scratch-cluster proof lives with the slice record).

-- ─── §1. Conversion audit table ───────────────────────────────────

create table if not exists public.bench_relic_conversion_audit (
  profile_id uuid not null,
  tool_id text not null,
  relic_item_id uuid not null,
  relic_name text not null,
  affixes jsonb not null,
  converted_at timestamptz not null default now(),
  primary key (profile_id, tool_id)
);

-- ─── §2. Collapse refunds (brief §8.6) ────────────────────────────
-- Paid BEFORE the bench count is tombstoned to 1; each payment is
-- ledgered under a deterministic idempotency key, so a re-run
-- (when every profile already sits at bench 1) pays nothing.

do $$
declare
  r record;
  v_credits bigint;
  v_dust integer;
begin
  for r in
    select id, workshop_benches from public.profiles
     where coalesce(workshop_benches, 1) >= 2
  loop
    v_credits := case when r.workshop_benches >= 3 then 30000 else 5000 end;
    v_dust := case when r.workshop_benches >= 3 then 10 else 0 end;
    if exists (select 1 from public.verified_action_ledger
                where user_id = r.id
                  and idempotency_key = 'bench-collapse-refund') then
      continue;
    end if;
    update public.profiles
       set credits = credits + v_credits,
           essences = case when v_dust > 0
             then public.cc_jsonb_add_int(essences, 'VoidDust', v_dust)
             else essences end,
           updated_at = now()
     where id = r.id;
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
    values (r.id, 'bench_collapse_refund', 'bench-collapse-refund',
      jsonb_build_object(
        'action_type', 'bench_collapse_refund',
        'benches_before', r.workshop_benches,
        'credits_refunded', v_credits,
        'void_dust_refunded', v_dust));
  end loop;
end $$;

-- ─── §3. Tool → relic conversion ──────────────────────────────────
-- Every owned workshop tool becomes its named relic: Epic, item
-- level = the profile's player level, UNEQUIPPED in inventory
-- (never auto-equipped — equip is the player's act). The affix
-- payloads below are byte-identical to the TS generator's
-- craftAffixesForRelic output for the same names (dumped from
-- src/content/crafting.ts at slice build time).

do $$
declare
  r record;
  v_id uuid;
  v_payload jsonb;
begin
  for r in
    select p.id as profile_id,
           greatest(1, coalesce(p.player_level, 1)) as lvl,
           t.tool_id, t.relic_name, t.affixes
      from public.profiles p
      join (values
        ('tool_precision_calipers', 'Precision Calipers',
         '[{"id": "craftQualityMultiplier_0", "category": "crafting", "stat": "craftQualityMultiplier", "value": 1.08, "displayText": "Craft quality ×1.08 while equipped"}]'::jsonb),
        ('tool_servo_bench_rig', 'Servo Bench Rig',
         '[{"id": "craftDurationMultiplier_0", "category": "crafting", "stat": "craftDurationMultiplier", "value": 0.85, "displayText": "Craft durations ×0.85 while equipped"}]'::jsonb),
        ('tool_reclaimer_head', 'Reclaimer Head',
         '[{"id": "craftRefineYieldBonus_0", "category": "crafting", "stat": "craftRefineYieldBonus", "value": 0.05, "displayText": "Refining yield +5pts while equipped"}, {"id": "craftBonusUnitChance_1", "category": "crafting", "stat": "craftBonusUnitChance", "value": 0.1, "displayText": "Consumable crafts: 10% chance of a bonus unit while equipped"}]'::jsonb)
      ) as t(tool_id, relic_name, affixes)
        on coalesce(p.workshop_tools -> 'owned' ->> t.tool_id, 'false') = 'true'
  loop
    v_id := gen_random_uuid();
    v_payload := jsonb_build_object(
      'id', v_id,
      'name', r.relic_name,
      'level', r.lvl,
      'rarity', 'Epic',
      'affixes', r.affixes,
      'sourceTag', 'Crafted',
      'isLocked', false);
    insert into public.item_instances (
      id, owner_user_id, kind, runtime_state, is_locked, rarity,
      item_level, estimated_value, supply_mode, creator_user_id, payload)
    values (
      v_id, r.profile_id, 'relic', 'available', false, 'Epic',
      r.lvl,
      public.cc_compute_item_estimated_value(v_payload, 'relic', 'Epic', r.lvl),
      'verified_action', r.profile_id, v_payload);
    insert into public.bench_relic_conversion_audit(
      profile_id, tool_id, relic_item_id, relic_name, affixes)
    values (r.profile_id, r.tool_id, v_id, r.relic_name, r.affixes)
    on conflict (profile_id, tool_id) do nothing;
  end loop;
end $$;

-- ─── §4. Active tool jobs become relic crafts ─────────────────────

update public.craft_jobs
   set kind = 'gear',
       snapshot = snapshot || jsonb_build_object(
         'gearRarity', 'Epic',
         'namedRelic', case recipe_id
           when 'tool_precision_calipers' then 'Precision Calipers'
           when 'tool_servo_bench_rig' then 'Servo Bench Rig'
           when 'tool_reclaimer_head' then 'Reclaimer Head'
           else null end)
 where status = 'active' and kind = 'tool';

-- ─── §5. One bench ────────────────────────────────────────────────

update public.craft_jobs set bench = 1
 where status = 'active' and bench > 1;

update public.profiles
   set workshop_benches = 1,
       workshop_tools = '{}'::jsonb,
       updated_at = now()
 where coalesce(workshop_benches, 1) <> 1
    or coalesce(workshop_tools, '{}'::jsonb) <> '{}'::jsonb;


-- ─── §6. cc_craft_recipe_catalog — regenerated from TS content.
-- -- Every requiresBench is 1; the three tool recipes are now
-- -- gear recipes minting named relics (kind 'gear', gearSlot
-- -- 'relic', namedRelic + fixedRarity 'Epic'); the Prime
-- -- Laboratory joins as relic_prime_laboratory. ───

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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    },
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "weapon"
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
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    },
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "shield"
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
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    },
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "classMod"
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
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    },
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "relic"
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
    "durationByRarityMs": {
      "Common": 5400000,
      "Uncommon": 5400000,
      "Rare": 9000000,
      "Epic": 14400000
    },
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "ordnance"
  },
  {
    "id": "tool_precision_calipers",
    "kind": "gear",
    "name": "Precision Calipers",
    "category": "gear",
    "inputs": {
      "CircuitLattice": 2,
      "PrismShards": 2
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "relic",
    "namedRelic": "Precision Calipers",
    "fixedRarity": "Epic"
  },
  {
    "id": "tool_servo_bench_rig",
    "kind": "gear",
    "name": "Servo Bench Rig",
    "category": "gear",
    "inputs": {
      "CompositePlating": 2,
      "MagnetiteCores": 2
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "relic",
    "namedRelic": "Servo Bench Rig",
    "fixedRarity": "Epic"
  },
  {
    "id": "tool_reclaimer_head",
    "kind": "gear",
    "name": "Reclaimer Head",
    "category": "gear",
    "inputs": {
      "CompositePlating": 1,
      "CircuitLattice": 1,
      "Voidweave": 1
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "relic",
    "namedRelic": "Reclaimer Head",
    "fixedRarity": "Epic"
  },
  {
    "id": "relic_prime_laboratory",
    "kind": "gear",
    "name": "Prime Laboratory",
    "category": "gear",
    "inputs": {
      "Voidweave": 2,
      "CircuitLattice": 2,
      "CompositePlating": 2,
      "PrismShards": 4
    },
    "unitDurationMs": 14400000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "gearSlot": "relic",
    "namedRelic": "Prime Laboratory",
    "fixedRarity": "Epic"
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
    "requiresResearch": "production_systems",
    "outputQuantity": 3
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
    "requiresResearch": "production_systems",
    "outputQuantity": 3
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
    "requiresResearch": "production_systems",
    "outputQuantity": 3
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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
    "requiresBench": 1,
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

-- ─── §7. cc_craft_quality_bounds — 0044 body; the Lab +5 bench
-- -- term is removed (the bench parameter is now inert; the +5
-- -- arrives via the snapshot's relicMinQualityBonus). ───

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
    ('FuelCell', 75::numeric, 150::numeric),
    ('CalibrationCore', 75::numeric, 150::numeric),
    ('RedlineTonic', 70::numeric, 150::numeric),
    ('HeartwoodSightOil', 75::numeric, 150::numeric),
    ('ForgeheartCharge', 70::numeric, 150::numeric),
    ('PrismCoating', 75::numeric, 150::numeric),
    ('ThrowTechDecoyKit', 75::numeric, 150::numeric),
    ('HelixCalibrationKit', 75::numeric, 150::numeric)
  ) as bounds(consumable_type, craft_min, craft_max)
  where consumable_type = p_item_key;

  v_min := coalesce(v_base_min, 75)
    + least(20, 1.5 * (v_mastery - 1))
    -- (slice 9: the retired Lab bench +5 sat here; the +5 now
    -- arrives as the equipped relic's snapshotted
    -- relicMinQualityBonus, applied by the caller.)
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

-- ─── §8. cc_enqueue_craft_job — 0069 body; bench forced to 1,
-- -- rarity bench gates out, tool uniqueness out, catalyst
-- -- bench gates out, named-relic catalyst refusal in, the
-- -- fitted-tool snapshot replaced by the equipped-relic
-- -- composition under the ×1.10/+5 ceilings. ───

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
  v_catalyst text := null;
  v_escrow jsonb := '{}'::jsonb;
  v_escrow_catalyst jsonb := '{}'::jsonb;
  v_key text;
  v_per_unit numeric;
  v_available integer;
  v_relic_id uuid;
  v_relic_payload jsonb;
  v_aff jsonb;
  v_relic_min_bonus numeric := 0;
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
  -- Bench collapse (slice 9): one bench. Requests naming a
  -- retired tier land on it; every profile owns it and every
  -- catalog requiresBench is 1.
  v_bench := 1;
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

  -- Gear rarity: forced at enqueue, Epic-capped by law. The
  -- rarity bench gates retired with the collapse (slice 9) — Epic
  -- keeps its surviving carrier, the mastery gate. Named relics
  -- mint at the recipe's fixed rarity; the caller's rarity and
  -- the mastery gate do not apply to them.
  if v_kind = 'gear' then
    if recipe ->> 'namedRelic' is not null then
      v_rarity := recipe ->> 'fixedRarity';
    else
      if v_rarity is null or v_rarity not in ('Common', 'Uncommon', 'Rare', 'Epic') then
        if v_rarity = 'Legendary' then
          raise exception 'Legendary gear cannot be crafted';
        end if;
        raise exception 'A craftable rarity (Common–Epic) is required';
      end if;
      if v_rarity = 'Epic'
         and public.cc_player_mastery_level(actor, 'crafting.gear') < 10 then
        raise exception 'Epic frames require crafting.gear mastery 10';
      end if;
    end if;
  end if;

  -- Named relics take no catalyst (slice 9): their affixes are
  -- fixed, so a catalyst would burn for zero effect — the refusal
  -- is the remedy (the §9.1 defect class).
  if recipe ->> 'namedRelic' is not null
     and (coalesce(p_use_catalyst, false) or v_core_catalyst) then
    raise exception 'Named relic crafts take no catalyst — the relic is fixed';
  end if;

  -- Queue capacity — THE BENCH ENVELOPE (slice 9): one running
  -- + five queued on the bench (content/crafting.ts
  -- RUNNING_JOBS_ON_BENCH + QUEUED_JOBS_PER_BENCH), plus the
  -- Fixer keystone's workshop_queue_bonus (0029). Econ 10
  -- (banked bench time) widens the envelope HERE.
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
    -- (slice 9: catalysts run on the one bench — the Forge
    -- bench gate retired with the tiers.)
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

  -- Equipped-relic snapshot (slice 9): the crafting effects of
  -- the relic the hunter carries, read from its affixes and
  -- composed under the relic ceilings — quality multipliers
  -- compose multiplicatively, clamped at x1.10 total; min-quality
  -- bonuses add, clamped at +5 total; durations compose; refine
  -- yield and bonus-unit chance add (chance clamped at 1). The TS
  -- twin is composeCraftRelicEffects (content/crafting.ts) — keep
  -- the clamps equal. The snapshot freezes the effects onto the
  -- job: swapping the relic mid-job never reprices a running job.
  select id, payload into v_relic_id, v_relic_payload
    from public.item_instances
   where owner_user_id = actor and runtime_state = 'equipped' and kind = 'relic'
   limit 1;
  if v_relic_payload is not null then
    for v_aff in
      select value from jsonb_array_elements(coalesce(v_relic_payload -> 'affixes', '[]'::jsonb))
    loop
      case v_aff ->> 'stat'
        when 'craftQualityMultiplier' then
          v_tool_quality := v_tool_quality * (v_aff ->> 'value')::numeric;
        when 'craftMinQualityBonus' then
          v_relic_min_bonus := v_relic_min_bonus + (v_aff ->> 'value')::numeric;
        when 'craftDurationMultiplier' then
          v_tool_duration := v_tool_duration * (v_aff ->> 'value')::numeric;
        when 'craftRefineYieldBonus' then
          v_tool_yield := v_tool_yield + (v_aff ->> 'value')::numeric;
        when 'craftBonusUnitChance' then
          v_tool_bonus := v_tool_bonus + (v_aff ->> 'value')::numeric;
        else null;
      end case;
    end loop;
    v_tool_quality := least(v_tool_quality, 1.10);
    v_relic_min_bonus := least(v_relic_min_bonus, 5);
    v_tool_bonus := least(v_tool_bonus, 1);
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
  if v_kind = 'gear' and recipe ->> 'namedRelic' is null then
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
      'toolId', v_relic_id,
      'relicMinQualityBonus', v_relic_min_bonus,
      'namedRelic', recipe ->> 'namedRelic',
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

-- ─── §9. cc_enqueue_tint_job — 0069 body; the bench search loop
-- -- collapses to the one bench. ───

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

  -- The one bench (slice 9), under the same capacity rule as
  -- the generic enqueue: one running + five queued.
  v_bench := 1;
  if (select count(*) from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench) >= 6 then
    raise exception 'Bench queue is full';
  end if;

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

-- ─── §10. cc_complete_craft_unit — 0067 body; bench quality
-- -- factors out of the consumable + cosmetic rolls, the relic
-- -- min-quality bonus applied at both bounds call sites, named
-- -- relics complete fixed (no temper, one draw, bounds always
-- -- stamped), the tool completion branch retired. ───

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
  v_hi numeric;
  v_bool boolean;
  v_bounds jsonb;
  v_roll numeric;
  v_qty integer;
  v_bonus boolean;
  -- refine completion
  v_yield numeric;
  v_expect numeric;
  v_count integer;
  -- gear completion
  v_tempered boolean;
  -- repair completion (0025)
  v_item public.item_instances%rowtype;
  -- Fixer completion terms (0029)
  v_mod_payload jsonb;
  v_craft_quality_bonus numeric := 0;
  v_research_shift numeric := 0;
  v_research_temper numeric := 0;
  v_research_draws integer := 0;
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
  -- Research (0038): the owner's completion-derived terms, read once
  -- from research_completions (server records only).
  v_research_shift := public.cc_research_bonus_number(p.id, 'craftQualityShift');
  v_research_temper := public.cc_research_bonus_number(p.id, 'gearTemperBonus');
  v_research_draws := public.cc_research_bonus_number(p.id, 'gearDrawBonus')::integer;
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
      perform public.cc_add_stat(actor, 'services.points_restored', round(v_restored)::bigint);
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

  if job.kind = 'shieldtech' then
    -- Self-lane recalibration unit (0044): apply the next escrowed
    -- Calibration Core. Its capacity (base 2,500 x quality% x the
    -- owner's efficiency snapshot) accrues toward the target; the
    -- flip lands only when the accumulated points cover the target,
    -- and only if the shield is still exactly the shield that was
    -- enqueued (identity diff outside behavior/hp/rechargeRate —
    -- the finalize rule). No player XP (consumption, the self-repair
    -- rule); shield-tech mastery trains by points applied.
    v_output := jsonb_build_object(
      'unit', job.units_completed + 1,
      'kind', 'shieldtech',
      'xp', 0,
      'completedAtMs', (extract(epoch from now()) * 1000)::bigint
    );
    select * into v_item from public.item_instances
     where id = (job.snapshot -> 'shieldtech' ->> 'itemId')::uuid
       and owner_user_id = actor;
    if not found or v_item.kind <> 'shield'
       or v_item.runtime_state <> 'available' or v_item.is_locked
       or public.cc_shieldtech_behavior_of(v_item.payload)
          is distinct from (job.snapshot -> 'shieldtech' ->> 'fromBehavior') then
      -- The unit never starts: the settler ends the job here and
      -- refunds this and every later core at its recorded quality.
      return v_output || jsonb_build_object('shieldUnavailable', true);
    end if;
    v_quality := coalesce(
      (job.snapshot -> 'shieldtech' -> 'coreQualities' ->> job.units_completed)::numeric, 100);
    v_restore := round(2500 * v_quality / 100
      * coalesce((job.snapshot -> 'shieldtech' ->> 'efficiency')::numeric, 1), 2);
    v_restored := round(coalesce(
      (job.snapshot -> 'shieldtech' ->> 'pointsApplied')::numeric, 0) + v_restore, 4);
    update public.craft_jobs
       set snapshot = jsonb_set(snapshot, '{shieldtech,pointsApplied}',
             to_jsonb(v_restored), true)
     where id = job.id
     returning * into job;
    if v_restore > 0 then
      perform public.cc_add_mastery_xp(actor, 'services.shield_tech',
        ceil(v_restore / 10)::integer);
    end if;
    v_output := v_output || jsonb_build_object(
      'itemId', v_item.id,
      'quality', v_quality,
      'pointsApplied', v_restore,
      'totalPointsApplied', v_restored
    );
    if v_restored >= (job.snapshot -> 'shieldtech' ->> 'targetPoints')::numeric then
      if (v_item.payload - 'behavior' - 'hp' - 'rechargeRate')
         is distinct from ((job.snapshot -> 'shieldtech' -> 'payload')
           - 'behavior' - 'hp' - 'rechargeRate') then
        -- The shield changed under the job (e.g. a reforge landed
        -- first): the flip refuses; the settler ends the job and
        -- refunds the unstarted cores. This core is spent — the
        -- work happened.
        v_output := v_output || jsonb_build_object('shieldDrift', true);
      else
        update public.item_instances
           set payload = public.cc_shieldtech_rebased_payload(v_item.payload,
                 job.snapshot -> 'shieldtech' ->> 'fromBehavior',
                 job.snapshot -> 'shieldtech' ->> 'toBehavior'),
               updated_at = now()
         where id = v_item.id;
        v_output := v_output || jsonb_build_object(
          'flipped', true,
          'fromBehavior', job.snapshot -> 'shieldtech' ->> 'fromBehavior',
          'toBehavior', job.snapshot -> 'shieldtech' ->> 'toBehavior',
          'shieldtechComplete', true);
      end if;
    end if;
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
  v_shift := least(20, greatest(-10, p_quality_shift + v_craft_quality_bonus + v_research_shift));

  recipe := public.cc_craft_recipe(job.recipe_id);
  if recipe is null then raise exception 'Unknown craft recipe'; end if;

  v_xp := public.cc_craft_unit_xp(job.unit_duration_ms, p.player_level, p_xp_rate);
  -- Cache Rank Fast Learner (0031): craft XP carries the same XP
  -- bonus as every other source (applied after the peg rate,
  -- before cc_apply_xp — the shipped composition order).
  v_xp := round(v_xp * (1 + public.cc_cache_rank_bonus_fraction(p.cache_rank_spends, 'xp')))::bigint;
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
    -- The equipped relic's min-quality bonus (slice 9 — the old
    -- Lab +5, now the Prime Laboratory's snapshotted effect):
    -- raises the floor only, never past the max (the TS bounds
    -- function's composition).
    v_bounds := jsonb_set(v_bounds, '{min}', to_jsonb(least(
      (v_bounds ->> 'max')::numeric,
      (v_bounds ->> 'min')::numeric
        + coalesce((job.snapshot ->> 'relicMinQualityBonus')::numeric, 0))));
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
    )::numeric, 2);
    v_roll := least((v_bounds ->> 'cap')::numeric, greatest(1, v_roll));
    v_qty := coalesce((recipe ->> 'outputQuantity')::integer, 1);
    v_bonus := false;
    if coalesce((job.snapshot ->> 'toolBonusUnitChance')::numeric, 0) > 0
       and random() < (job.snapshot ->> 'toolBonusUnitChance')::numeric then
      v_qty := v_qty + 1;
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
      -- Stochastic rounding (economy brief §9.3, 0067): floor(x)
      -- plus one extra unit with probability frac(x), keeping the
      -- expectation of the old floor formula while making mastery
      -- and the Reclaimer Head real on the outputBase-2 furnace
      -- recipes. random() is drawn only when frac(x) > 0, mirroring
      -- the TS twin (rollRefineOutputCount).
      v_expect := (recipe ->> 'outputBase')::numeric * v_yield / p_refine_base;
      v_count := floor(v_expect)::integer;
      if v_expect - floor(v_expect) > 0
         and random() < v_expect - floor(v_expect) then
        v_count := v_count + 1;
      end if;
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
    -- Named relics (slice 9) mint fixed: no temper roll —
    -- v_tempered stays false and draws stay 1 below.
    v_tempered := coalesce(recipe ->> 'namedRelic', '') = ''
      and random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml + v_craft_temper_bonus + v_research_temper);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', case when recipe ->> 'namedRelic' is not null then 1
        else (case when v_tempered then 3 else 1 end)
          + case when job.snapshot ->> 'coreCatalyst' = 'true'
              then 2 + coalesce((job.snapshot ->> 'coreCatalystDrawBonus')::integer, 0)
              else 0 end
          + v_research_draws end,
      'tempered', v_tempered,
      'namedRelic', recipe ->> 'namedRelic'
    );
    -- Material catalyst (economy brief §9.1, 0067): a gear unit that
    -- escrowed a material catalyst carries its bounds -- computed by
    -- the shared bounds function with the catalyst flag set (+10 min
    -- / +15 max over the frame bounds, the consumable branch's own
    -- shift) -- on the pending output. Generation stays TS-side
    -- (cc_pending_crafted_gear -> the finalizer): each candidate draw
    -- rolls inside these bounds and the best bounds roll is kept.
    if (job.snapshot ->> 'catalystMaterialId') is not null
       or recipe ->> 'namedRelic' is not null then
      v_bounds := public.cc_craft_quality_bounds(null, v_ml, job.bench,
        (job.snapshot ->> 'catalystMaterialId') is not null, v_shift);
      v_bounds := jsonb_set(v_bounds, '{min}', to_jsonb(least(
        (v_bounds ->> 'max')::numeric,
        (v_bounds ->> 'min')::numeric
          + coalesce((job.snapshot ->> 'relicMinQualityBonus')::numeric, 0))));
      v_output := v_output || jsonb_build_object('qualityBounds', v_bounds);
    end if;
  elsif job.kind = 'cosmetic' then
    if coalesce((recipe ->> 'tintCraft')::boolean, false) then
      -- Tint job (0053): the craft lands on the TARGET part item,
      -- re-read at completion. If the part left the workshop state
      -- (sold underneath would have been refused at listing; this
      -- covers salvage/transfer races), the tint simply does not
      -- apply and the output records it.
      v_ml := public.cc_player_mastery_level(actor, 'crafting.cosmetics');
      select * into v_item from public.item_instances
       where id = (job.snapshot -> 'tint' ->> 'itemId')::uuid
         and owner_user_id = actor for update;
      v_bool := found and v_item.kind = 'cosmetic'
        and v_item.runtime_state in ('available', 'locked');
      if v_bool then
        update public.item_instances
           set payload = jsonb_set(payload, '{tintPaletteId}',
                 to_jsonb(job.snapshot -> 'tint' ->> 'paletteId'), true),
               updated_at = now()
         where id = v_item.id;
      end if;
      v_output := v_output || jsonb_build_object(
        'cosmeticPartId', v_item.payload ->> 'partId',
        'itemId', job.snapshot -> 'tint' ->> 'itemId',
        'paletteId', job.snapshot -> 'tint' ->> 'paletteId',
        'tintApplied', v_bool
      );
    else
      -- Skin part craft (0053): the finish roll (content/skins.ts
      -- COSMETIC_QUALITY — the twin formula) prices the part's
      -- permanent quality; the output pends for the finalizer.
      v_ml := public.cc_player_mastery_level(actor, 'crafting.cosmetics');
      v_hi := 95 + least(15, 0.3 * v_ml);
      v_roll := round((
        (35 + random() * greatest(0, v_hi - 35))
        * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
      )::numeric) + v_shift;
      v_roll := least(100, greatest(1, v_roll))::integer;
      v_output := v_output || jsonb_build_object(
        'pending', true,
        'cosmeticPartId', recipe ->> 'cosmeticPartId',
        'quality', v_roll
      );
    end if;
  end if;

  -- Mastery + player XP land after the output is priced.
  if job.kind = 'refine' then
    v_mastery_track := 'crafting.refining'; v_mastery_xp := 10;
  elsif job.kind = 'cosmetic' then
    v_mastery_track := 'crafting.cosmetics'; v_mastery_xp := 15;
  elsif job.kind = 'gear' then
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
end;$$;

-- ── 2. cc_settle_craft_jobs (0063 body; charge burn removed) ────

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
  v_total_xp bigint := 0;
  v_jobs_completed integer := 0;
  v_max_advance bigint := 0;
  v_completions jsonb := '[]'::jsonb;
  v_i integer;
  v_force_complete boolean := false;
  v_refund_from integer := 0;
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

  -- Internal away cap: min(earned cap, limiter when set), [1h, 24h].
  v_away_cap_ms := (greatest(1, least(
      public.cc_earned_offline_cap_hours_for(p.id),
      coalesce(nullif(p.offline_cap_hours, 0)::numeric,
               public.cc_earned_offline_cap_hours_for(p.id))
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
    if v_action is distinct from (case when v_job.kind in ('repair', 'shieldtech')
          then 'workshop_service' else 'crafting' end) or v_raw <= 0 then
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

  if v_action is distinct from 'crafting' and v_action is distinct from 'workshop_service' then
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
      -- Tools are permanent (economy brief §9.2, 0067): the job is
      -- still marked tool_charged at its first unit for the record,
      -- but no charge is spent -- a fitted tool is never consumed,
      -- un-owned, or unfitted by use. Pre-0067 charges values stored
      -- in profiles.workshop_tools are inert.
      if not v_job.tool_charged and (v_job.snapshot ->> 'toolId') is not null then
        update public.craft_jobs set tool_charged = true where id = v_job.id;
      end if;
      v_force_complete := false;
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
          if coalesce((v_output ->> 'shieldUnavailable')::boolean, false) then
            -- Shield-tech self-lane (0044): the shield is gone, busy,
            -- or no longer carries the enqueued behavior — this unit
            -- never started. End the job and refund this and every
            -- later core at its escrowed quality/origin.
            for v_i in v_job.units_completed .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                'CalibrationCore', 1,
                (v_job.snapshot -> 'shieldtech' -> 'coreQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'shieldtech' -> 'coreOrigins' ->> v_i, 'crafted'),
                actor, null, 'shieldtech_refund',
                'Calibration Core refunded (shield no longer recalibratable)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_job.units_completed > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       'CalibrationCore',
                       v_job.units_total - v_job.units_completed),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
            exit;
          end if;
          if coalesce((v_output ->> 'shieldtechComplete')::boolean, false)
             or coalesce((v_output ->> 'shieldDrift')::boolean, false) then
            -- The job's work is done (flip landed, or the flip was
            -- refused on drift): this unit's core is spent; refund
            -- only the unstarted cores and end the job. Completion
            -- accounting below still records the unit.
            v_refund_from := v_job.units_completed + 1;
            for v_i in v_refund_from .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                'CalibrationCore', 1,
                (v_job.snapshot -> 'shieldtech' -> 'coreQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'shieldtech' -> 'coreOrigins' ->> v_i, 'crafted'),
                actor, null, 'shieldtech_refund',
                'Calibration Core refunded (recalibration job ended)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_refund_from > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       'CalibrationCore',
                       v_job.units_total - v_refund_from),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
          end if;
          if coalesce((v_output ->> 'vehicleFull')::boolean, false) then
            -- Repair job whose vehicle is already whole (or gone):
            -- end it and refund every unstarted kit at its escrowed
            -- quality/origin (0025).
            for v_i in v_job.units_completed .. v_job.units_total - 1 loop
              perform public.cc_add_consumable_batch(actor,
                v_job.snapshot -> 'repair' ->> 'kitType', 1,
                (v_job.snapshot -> 'repair' -> 'kitQualities' ->> v_i)::numeric,
                coalesce(v_job.snapshot -> 'repair' -> 'kitOrigins' ->> v_i, 'crafted'),
                actor, null, 'repair_refund',
                'Patch kit refunded (vehicle already at full condition)',
                '{}'::jsonb);
            end loop;
            if v_job.units_total - v_job.units_completed > 0 then
              update public.profiles
                 set consumables = public.cc_jsonb_add_int(consumables,
                       v_job.snapshot -> 'repair' ->> 'kitType',
                       v_job.units_total - v_job.units_completed),
                     updated_at = now()
               where id = actor;
            end if;
            v_force_complete := true;
            exit;
          end if;
          v_total_xp := v_total_xp + (v_output ->> 'xp')::bigint;
          v_completions := v_completions || jsonb_build_array(
            v_output || jsonb_build_object('jobId', v_job.id, 'recipeId', v_job.recipe_id));
          v_job.units_completed := v_job.units_completed + 1;
        end if;
      end loop;
      if v_force_complete or v_job.units_completed >= v_job.units_total then
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

-- ─── §11. cc_pending_crafted_gear — 0067 body; the pending output
-- -- now surfaces named_relic for the TS finalizer. ───

drop function if exists public.cc_pending_crafted_gear(uuid);

create or replace function public.cc_pending_crafted_gear(p_player_id uuid)
returns table(job_id uuid, unit integer, slot text, rarity text, item_level integer, draws integer, bench integer, tool_quality_multiplier numeric, quality_bounds jsonb, named_relic text)
language sql
stable
set search_path = public
as $$
  select j.id,
         (o ->> 'unit')::integer,
         o ->> 'slot',
         o ->> 'rarity',
         (o ->> 'item_level')::integer,
         (o ->> 'draws')::integer,
         j.bench,
         coalesce((j.snapshot ->> 'toolQualityMultiplier')::numeric, 1),
         o -> 'qualityBounds',
         o ->> 'namedRelic'
    from public.craft_jobs j,
         jsonb_array_elements(j.outputs) as o
   where j.owner_user_id = p_player_id
     and o ->> 'pending' = 'true'
$$;

-- ─── §12. Research — 0038 bodies; the courses lose requiresBench
-- -- and enrollment loses the bench gate. ───

create or replace function public.cc_research_course(p_course_id text)
returns jsonb
language sql
stable
as $func$
  select c.course
    from jsonb_array_elements($catalog$[
  {
    "id": "shop_fundamentals",
    "faculty": "fabrication",
    "tier": 1,
    "name": "Shop Fundamentals",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
    "effects": {
      "craftQualityShift": 2
    }
  },
  {
    "id": "production_systems",
    "faculty": "fabrication",
    "tier": 2,
    "name": "Production Systems",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "shop_fundamentals",
    "effects": {}
  },
  {
    "id": "master_fabricator",
    "faculty": "fabrication",
    "tier": 3,
    "name": "Master Fabricator Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "production_systems",
    "effects": {
      "gearTemperBonus": 0.03,
      "gearDrawBonus": 1
    }
  },
  {
    "id": "wrench_basics",
    "faculty": "field_mechanics",
    "tier": 1,
    "name": "Wrench Basics",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
    "effects": {
      "repairWorkRateBonus": 0.05
    }
  },
  {
    "id": "powertrain_systems",
    "faculty": "field_mechanics",
    "tier": 2,
    "name": "Powertrain Systems",
    "durationHours": 48,
    "costCredits": 15000,
    "requiresLevel": 20,
    "prerequisite": "wrench_basics",
    "effects": {
      "vehicleDecayReduction": 0.1
    }
  },
  {
    "id": "master_mechanic",
    "faculty": "field_mechanics",
    "tier": 3,
    "name": "Master Mechanic Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "requiresLevel": 40,
    "prerequisite": "powertrain_systems",
    "effects": {
      "repairServiceXpBonus": 1
    }
  },
  {
    "id": "street_economics",
    "faculty": "logistics_markets",
    "tier": 1,
    "name": "Street Economics",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
    "effects": {
      "vendorBuybackBonus": 0.02
    }
  },
  {
    "id": "supply_chains",
    "faculty": "logistics_markets",
    "tier": 2,
    "name": "Supply Chains",
    "durationHours": 48,
    "costCredits": 15000,
    "requiresLevel": 20,
    "prerequisite": "street_economics",
    "effects": {
      "offlineCapBonus": 1
    }
  },
  {
    "id": "syndicate_ledger",
    "faculty": "logistics_markets",
    "tier": 3,
    "name": "Syndicate Ledger",
    "durationHours": 168,
    "costCredits": 60000,
    "requiresLevel": 40,
    "prerequisite": "supply_chains",
    "effects": {
      "marketFeeReduction": 0.05
    }
  },
  {
    "id": "ballistics_theory",
    "faculty": "xenotech",
    "tier": 1,
    "name": "Ballistics Theory",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
    "effects": {
      "weaponDamage": 0.01
    }
  },
  {
    "id": "shield_dynamics",
    "faculty": "xenotech",
    "tier": 2,
    "name": "Shield Dynamics",
    "durationHours": 48,
    "costCredits": 15000,
    "requiresLevel": 20,
    "prerequisite": "ballistics_theory",
    "effects": {
      "shieldCapacity": 0.02
    }
  },
  {
    "id": "void_theory",
    "faculty": "xenotech",
    "tier": 3,
    "name": "Void Theory Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "requiresLevel": 40,
    "prerequisite": "shield_dynamics",
    "effects": {
      "bossDedicatedChanceBonus": 0.01
    }
  }
]$catalog$::jsonb) as c(course)
   where c.course ->> 'id' = p_course_id
   limit 1;
$func$;

create or replace function public.cc_research_catalog()
returns jsonb
language sql
stable
as $func$
  select $catalog$[
  {
    "id": "shop_fundamentals",
    "faculty": "fabrication",
    "tier": 1,
    "name": "Shop Fundamentals",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
    "effects": {
      "craftQualityShift": 2
    }
  },
  {
    "id": "production_systems",
    "faculty": "fabrication",
    "tier": 2,
    "name": "Production Systems",
    "durationHours": 48,
    "costCredits": 15000,
    "prerequisite": "shop_fundamentals",
    "effects": {}
  },
  {
    "id": "master_fabricator",
    "faculty": "fabrication",
    "tier": 3,
    "name": "Master Fabricator Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "prerequisite": "production_systems",
    "effects": {
      "gearTemperBonus": 0.03,
      "gearDrawBonus": 1
    }
  },
  {
    "id": "wrench_basics",
    "faculty": "field_mechanics",
    "tier": 1,
    "name": "Wrench Basics",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
    "effects": {
      "repairWorkRateBonus": 0.05
    }
  },
  {
    "id": "powertrain_systems",
    "faculty": "field_mechanics",
    "tier": 2,
    "name": "Powertrain Systems",
    "durationHours": 48,
    "costCredits": 15000,
    "requiresLevel": 20,
    "prerequisite": "wrench_basics",
    "effects": {
      "vehicleDecayReduction": 0.1
    }
  },
  {
    "id": "master_mechanic",
    "faculty": "field_mechanics",
    "tier": 3,
    "name": "Master Mechanic Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "requiresLevel": 40,
    "prerequisite": "powertrain_systems",
    "effects": {
      "repairServiceXpBonus": 1
    }
  },
  {
    "id": "street_economics",
    "faculty": "logistics_markets",
    "tier": 1,
    "name": "Street Economics",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
    "effects": {
      "vendorBuybackBonus": 0.02
    }
  },
  {
    "id": "supply_chains",
    "faculty": "logistics_markets",
    "tier": 2,
    "name": "Supply Chains",
    "durationHours": 48,
    "costCredits": 15000,
    "requiresLevel": 20,
    "prerequisite": "street_economics",
    "effects": {
      "offlineCapBonus": 1
    }
  },
  {
    "id": "syndicate_ledger",
    "faculty": "logistics_markets",
    "tier": 3,
    "name": "Syndicate Ledger",
    "durationHours": 168,
    "costCredits": 60000,
    "requiresLevel": 40,
    "prerequisite": "supply_chains",
    "effects": {
      "marketFeeReduction": 0.05
    }
  },
  {
    "id": "ballistics_theory",
    "faculty": "xenotech",
    "tier": 1,
    "name": "Ballistics Theory",
    "durationHours": 6,
    "costCredits": 2500,
    "requiresLevel": 5,
    "effects": {
      "weaponDamage": 0.01
    }
  },
  {
    "id": "shield_dynamics",
    "faculty": "xenotech",
    "tier": 2,
    "name": "Shield Dynamics",
    "durationHours": 48,
    "costCredits": 15000,
    "requiresLevel": 20,
    "prerequisite": "ballistics_theory",
    "effects": {
      "shieldCapacity": 0.02
    }
  },
  {
    "id": "void_theory",
    "faculty": "xenotech",
    "tier": 3,
    "name": "Void Theory Certification",
    "durationHours": 168,
    "costCredits": 60000,
    "requiresLevel": 40,
    "prerequisite": "shield_dynamics",
    "effects": {
      "bossDedicatedChanceBonus": 0.01
    }
  }
]$catalog$::jsonb;
$func$;

create or replace function public.cc_enroll_research(p_player_id uuid, p_nonce text, p_course_id text)
returns jsonb
language plpgsql
as $func$
declare
  actor uuid := p_player_id;
  p public.profiles%rowtype;
  v_key text := 'cc_enroll_research:' || coalesce(p_nonce, '');
  prior jsonb;
  course jsonb;
  v_cost bigint;
  v_duration_ms bigint;
  v_now timestamptz := now();
  v_completes timestamptz;
  result jsonb;
begin
  if actor is null then raise exception 'not_authenticated'; end if;
  if p_nonce is null or length(p_nonce) = 0 then
    raise exception 'cc_enroll_research requires a nonce';
  end if;
  select result_payload into prior from public.verified_action_ledger
   where idempotency_key = v_key;
  if prior is not null then
    return prior || jsonb_build_object('idempotent_replay', true);
  end if;

  perform public.cc_settle_research(actor);

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'profile_not_found'; end if;

  course := public.cc_research_course(p_course_id);
  if course is null then raise exception 'unknown_course'; end if;
  if exists (select 1 from public.research_completions
              where user_id = actor and course_id = p_course_id) then
    raise exception 'course_already_completed';
  end if;
  if exists (select 1 from public.research_enrollments where user_id = actor) then
    raise exception 'research_already_enrolled';
  end if;
  if (course ? 'requiresLevel')
     and p.player_level < (course ->> 'requiresLevel')::int then
    raise exception 'level_too_low';
  end if;
  if (course ? 'prerequisite')
     and not exists (select 1 from public.research_completions
                      where user_id = actor
                        and course_id = course ->> 'prerequisite') then
    raise exception 'prerequisite_not_met';
  end if;
  -- (slice 9: the courses' bench gate retired with the bench
  -- tiers — Production Systems and Master Fabricator no
  -- longer require a bench the player cannot lack.)

  v_cost := floor((course ->> 'costCredits')::numeric
    * least(3::numeric, greatest(0.5::numeric,
        public.cc_economy_config_number('researchCostScalar', 1))))::bigint;
  v_duration_ms := round((course ->> 'durationHours')::numeric * 3600000
    * least(2::numeric, greatest(0.5::numeric,
        public.cc_economy_config_number('researchDurationScalar', 1))))::bigint;
  if p.credits < v_cost then raise exception 'insufficient_credits'; end if;

  update public.profiles set credits = credits - v_cost
   where id = actor returning * into p;
  v_completes := v_now + (v_duration_ms::text || ' milliseconds')::interval;
  insert into public.research_enrollments
    (user_id, course_id, enrolled_at, completes_at, snapshot)
  values (actor, p_course_id, v_now, v_completes,
          jsonb_build_object('costCredits', v_cost, 'durationMs', v_duration_ms));

  result := jsonb_build_object(
    'course_id', p_course_id,
    'cost_credits', v_cost,
    'duration_ms', v_duration_ms,
    'enrolled_at', v_now,
    'completes_at', v_completes,
    'profile', public.cc_profile_snapshot(p));
  insert into public.verified_action_ledger
    (user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_enroll_research', v_key, result);
  return result;
end;
$func$;


-- ─── §13. Retired functions ───────────────────────────────────────
-- cc_unlock_bench (0061) and cc_fit_workshop_tool (0024) have no
-- callers left: the routes, both stores, and the client lost them
-- in this slice. Dropped so no path can resurrect a bench purchase
-- or a tool fitting.

drop function if exists public.cc_unlock_bench(uuid, text);
drop function if exists public.cc_fit_workshop_tool(uuid, text, integer, text);
