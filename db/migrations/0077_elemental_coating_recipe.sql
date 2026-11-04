-- 0077_elemental_coating_recipe.sql
--
-- Elemental Coating gains its one acquisition path: a crafting
-- recipe (fleet coverage audit 2026-11-04; owner disposition —
-- crafting recipe, not vendor stock). The consumable was defined
-- but unobtainable: no recipe output, no vendor stock, no rotation
-- entry.
--
-- Provenance (grep the chain before restating):
--   cc_craft_recipe_catalog — created 0024; restated 0038, 0043,
--     0044, 0053, 0056, 0057, 0069; chain head = 0073. This body is
--     0073's verbatim except the catalog JSON gains ONE row,
--     recipe_elemental_coating (Scrap 15 + BallisticParts 8 +
--     VoidEssence 3, 20 min), regenerated from src/content/
--     crafting.ts — 89 recipes, deep-equal pinned by test.
--   cc_craft_quality_bounds — created 0024; restated 0043, 0044;
--     chain head = 0073. This body is 0073's verbatim except the
--     bounds table gains ('ElementalCoating', 75, 150), matching
--     the def's new craft quality bounds in
--     src/constants/consumables.ts.
--
-- Nothing else moves: cc_enqueue_craft_job and the settlers read
-- the catalog function at runtime, and the per-recipe Scrap lever
-- (0072) resolves recipeScrap.recipe_elemental_coating from the
-- same catalog row. The 0019 player-market exclusion for this
-- consumable type stands — crafted batches are consumable, not
-- listable.
--
-- Apply order (owner migration routine): staging clone first,
-- verified, then production — applied manually by the parent
-- before merge; the Chef never runs migrations.

-- ─── §1. cc_craft_recipe_catalog — 0073 body; the catalog JSON
-- -- gains recipe_elemental_coating (89 recipes). ───

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
    "id": "recipe_elemental_coating",
    "kind": "consumable",
    "name": "Elemental Coating",
    "category": "offense",
    "inputs": {
      "Scrap": 15,
      "BallisticParts": 8,
      "VoidEssence": 3
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "ElementalCoating"
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

-- ─── §2. cc_craft_quality_bounds — 0073 body; the bounds table
-- -- gains the ElementalCoating row (75/150). ───

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
    ('HelixCalibrationKit', 75::numeric, 150::numeric),
    ('ElementalCoating', 75::numeric, 150::numeric)
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
