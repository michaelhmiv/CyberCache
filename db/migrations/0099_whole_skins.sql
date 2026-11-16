-- =====================================================================
-- 0099 — Whole skins (Cache Hunters reshape, slice (d)).
--
-- The reshape retires the segmented part system as a wearing
-- surface (DESIGN.md §12, 2026-11-14 ruling item 3): skins are
-- whole paintings, crafted in the Workshop cosmetic lane, owned
-- as server records, traded as their own market family. This
-- migration is the SQL half; the TS twins land in the same PR.
--
--   * cc_craft_recipe_catalog restated (0088 body): the 20
--     Bulwark + Dreadplate part recipes are REMOVED — no new part
--     crafts. The tint craft and every other recipe stay. (The TS
--     registry keeps the recipes resolvable for in-flight jobs
--     and refuses new enqueues from the catalog `delisted` flag —
--     0086's manufacturer-helm discipline, applied to both sets.)
--     Verified by parsing both catalogs as JSON and deep-comparing:
--     exactly the 20 part recipes removed, none added, none
--     changed (the count is pinned in the slice's test file).
--   * cc_complete_craft_unit restated (0073 body + ONE inserted
--     elsif): a cosmetic recipe carrying cosmeticSkinId completes
--     with the part branch's own finish roll and pends for the
--     skin finalizer pair (new below, the 0053 cosmetic pair's
--     mirror). No recipe carries cosmeticSkinId yet — no whole
--     skin is painted — so the branch is armed, not live.
--   * cc_pending_crafted_skins / cc_finalize_crafted_skin (new).
--   * cc_cosmetics_view restated (0092 body + insertions): parts
--     exclude whole-skin items (payload partId gate) and a new
--     `skins` array carries owned whole skins.
--   * skin_set_paintings (new table, ZERO rows) + 
--     cc_convert_skin_sets (new): complete-set conversion, gated
--     on the painting existing — the table IS the gate. With zero
--     rows it grants nothing, by design, until a set painting is
--     commissioned + owner-approved.
--   * market_listings kind check widened: + 'skin'.
--   * cc_market_create restated (0087 body + ONE inserted branch):
--     a cosmetic item whose payload names a skinId lists in the
--     'skin' family (identity skin:<skinId>); part listings are
--     unchanged (delisted parts are refused in the write stores).
--   * cc_accept_listing restated (0097 body) and cc_market_cancel
--     restated (0087 body): 'skin' joins the item-backed kind
--     lists — a sale moves the item, a cancel returns it.
--   * cc_enqueue_tint_job restated (0075 body + ONE inserted
--     gate): a tint target must carry a part payload — whole
--     skins share the cosmetic kind but are not parts.
--
-- Every restatement is its chain head VERBATIM plus the marked
-- 0099 insertions; the slice's test file proves it mechanically
-- (stripping the insertions reproduces the head byte-for-byte;
-- the catalog is deep-compared as JSON).
--
-- Application: staging rehearsal first, then production — applied
-- manually by the parent before merge; the Chef never runs
-- migrations.
-- =====================================================================

-- ─── cc_craft_recipe_catalog (0088 head − the 20 part recipes) ───

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
      "Scrap": 40,
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
      "Scrap": 125,
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
      "Scrap": 100,
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
      "Scrap": 200,
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
      "Scrap": 300,
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
      "Scrap": 25,
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
      "Scrap": 90,
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
      "Scrap": 75,
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
      "Scrap": 75,
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
      "Scrap": 75,
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
      "Scrap": 75,
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
      "Scrap": 75,
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
      "Scrap": 100,
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
      "Scrap": 75,
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
      "Scrap": 60,
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
      "Scrap": 90,
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
      "Scrap": 90,
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
      "Scrap": 125,
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
    "id": "recipe_overclock_serum",
    "kind": "consumable",
    "name": "Overclock Serum",
    "category": "offense",
    "inputs": {
      "Scrap": 30,
      "BallisticParts": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 1,
    "requiresBench": 1,
    "station": "bench",
    "consumableType": "OverclockSerum"
  },
  {
    "id": "recipe_targetpainter",
    "kind": "consumable",
    "name": "Target Painter",
    "category": "offense",
    "inputs": {
      "Scrap": 100,
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
      "Scrap": 250,
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
      "Scrap": 75,
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
      "Scrap": 100,
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
      "Scrap": 200,
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
      "Scrap": 125,
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
      "Scrap": 100,
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
      "Scrap": 75,
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
      "Scrap": 75,
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
      "Scrap": 100,
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
      "Scrap": 60,
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
      "Scrap": 90,
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
      "Scrap": 10,
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
      "Scrap": 15,
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
      "Scrap": 20,
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
      "Scrap": 15,
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
      "Scrap": 250,
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
      "Scrap": 25,
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
      "Scrap": 150,
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
      "Scrap": 100
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

-- ─── cc_complete_craft_unit (0073 head + skin completion branch) ───

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
    elsif recipe ? 'cosmeticSkinId' then
      -- Whole-skin craft (reshape slice (d), 0099): the same
      -- finish roll as a part craft — the quality is a
      -- collection finish, never a stat — and the output pends
      -- for the skin finalizer (cc_pending_crafted_skins).
      v_ml := public.cc_player_mastery_level(actor, 'crafting.cosmetics');
      v_hi := 95 + least(15, 0.3 * v_ml);
      v_roll := round((
        (35 + random() * greatest(0, v_hi - 35))
        * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
      )::numeric) + v_shift;
      v_roll := least(100, greatest(1, v_roll))::integer;
      v_output := v_output || jsonb_build_object(
        'pending', true,
        'cosmeticSkinId', recipe ->> 'cosmeticSkinId',
        'quality', v_roll
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

-- ─── cc_cosmetics_view (0092 head + skins) ───

create or replace function public.cc_cosmetics_view(p_player_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  sel public.player_skin_selection%rowtype;
  v_found boolean;
begin
  select * into sel from public.player_skin_selection where user_id = p_player_id;
  v_found := found;
  return jsonb_build_object(
    'selectionExists', v_found,
    'selection', jsonb_build_object(
      'equipped', case when v_found then sel.equipped else '{}'::jsonb end,
      'headVariant', case when v_found then sel.head_variant else 'visor' end
    ),
    'parts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'name', i.payload ->> 'name',
        'partId', i.payload ->> 'partId',
        'slot', i.payload ->> 'slot',
        'setId', i.payload ->> 'setId',
        'tier', case when i.payload ->> 'tier' in ('repaint', 'shaped')
                     then i.payload ->> 'tier' else 'palette' end,
        'quality', (i.payload ->> 'quality')::integer,
        'tintPaletteId', i.payload ->> 'tintPaletteId',
        'runtimeState', i.runtime_state
      ) order by i.created_at)
      from public.item_instances i
      where i.owner_user_id = p_player_id
        and i.kind = 'cosmetic'
        and i.payload ? 'partId'
        and i.runtime_state in ('available', 'locked')
    ), '[]'::jsonb),
    'skins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'skinId', i.payload ->> 'skinId',
        'hunterId', i.payload ->> 'hunterId',
        'name', i.payload ->> 'name',
        'setId', i.payload ->> 'setId',
        'quality', (i.payload ->> 'quality')::integer,
        'origin', i.payload ->> 'origin',
        'runtimeState', i.runtime_state
      ) order by i.created_at)
      from public.item_instances i
      where i.owner_user_id = p_player_id
        and i.kind = 'cosmetic'
        and i.payload ? 'skinId'
        and i.runtime_state in ('available', 'locked')
    ), '[]'::jsonb),
    'grandfatherHeads', coalesce((
      select jsonb_agg(ms.manufacturer order by ms.manufacturer)
      from public.manufacturer_standing ms
      where ms.player_id = p_player_id and ms.rank >= 3
    ), '[]'::jsonb)
  );
end;
$$;


-- ------------------------------------------------------------------
-- The 'skin' listing family joins the market_listings kind check
-- (0053's constraint, widened by exactly one value).
-- ------------------------------------------------------------------
alter table public.market_listings
  drop constraint if exists market_listings_listing_kind_check;
alter table public.market_listings
  add constraint market_listings_listing_kind_check
  check (listing_kind in ('gear', 'consumable', 'material', 'vehicle', 'fragment', 'core', 'essence', 'cosmetic', 'skin'));

-- ------------------------------------------------------------------
-- skin_set_paintings: the conversion gate as DATA (brief §2.4).
-- One row per (part set × hunter) whose whole-skin painting EXISTS
-- and is owner-approved; part_ids is the set's complete part list.
-- Seeded with ZERO rows in 0099: neither Bulwark nor Dreadplate is
-- painted as a whole for any hunter yet, so conversion grants
-- nothing until a painting is commissioned, approved, and landed
-- (a future migration seeds the row together with the TS skin def
-- in lib/hunters/hunterSkins.ts — the two are parity-pinned).
-- ------------------------------------------------------------------
create table if not exists public.skin_set_paintings (
  set_id text not null,
  hunter_id text not null,
  skin_id text not null,
  skin_name text not null,
  part_ids text[] not null,
  primary key (set_id, hunter_id)
);

-- ------------------------------------------------------------------
-- cc_convert_skin_sets: complete-set conversion. Runs lazily at
-- the head of the cosmetics read (the Pg getCosmeticsState calls
-- it before cc_cosmetics_view). Idempotent — a held skin is never
-- re-granted (any live row for the skin id blocks, listed ones
-- included; salvaged/consumed rows do not) — and parts are never
-- consumed: they grandfather as collection pieces. Returns the
-- skin ids granted by this call.
-- ------------------------------------------------------------------
create or replace function public.cc_convert_skin_sets(p_player_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  rec record;
  v_granted jsonb := '[]'::jsonb;
  v_payload jsonb;
begin
  for rec in select * from public.skin_set_paintings order by set_id, hunter_id loop
    if exists (
      select 1 from public.item_instances i
       where i.owner_user_id = p_player_id and i.kind = 'cosmetic'
         and i.payload ->> 'skinId' = rec.skin_id
         and i.runtime_state not in ('salvaged', 'consumed')
    ) then
      continue;
    end if;
    if (select count(distinct i.payload ->> 'partId')
          from public.item_instances i
         where i.owner_user_id = p_player_id and i.kind = 'cosmetic'
           and i.runtime_state in ('available', 'locked')
           and i.payload ->> 'partId' = any (rec.part_ids)) = cardinality(rec.part_ids) then
      v_payload := jsonb_build_object(
        'name', rec.skin_name,
        'skinId', rec.skin_id,
        'hunterId', rec.hunter_id,
        'setId', rec.set_id,
        'quality', 100,
        'origin', 'converted',
        'craftedBy', null
      );
      insert into public.item_instances (
        owner_user_id, kind, runtime_state, is_locked, rarity,
        item_level, estimated_value, supply_mode, payload
      ) values (
        p_player_id, 'cosmetic', 'available', false, 'Common', 1,
        public.cc_compute_item_estimated_value(v_payload, 'cosmetic', 'Common', 1),
        'verified_action', v_payload
      );
      v_granted := v_granted || to_jsonb(rec.skin_id);
    end if;
  end loop;
  return jsonb_build_object('granted', v_granted);
end;
$$;

-- ------------------------------------------------------------------
-- Pending whole-skin outputs (new in 0099): the cosmetic pair's
-- mirror. A completed whole-skin unit pends in craft_jobs.outputs;
-- the TS finalizer (src/server/writes/craftFinalize.ts) builds the
-- item from the skin catalog and stamps it in through
-- cc_finalize_crafted_skin.
-- ------------------------------------------------------------------
create or replace function public.cc_pending_crafted_skins(p_player_id uuid)
returns table(job_id uuid, unit integer, skin_id text, quality integer)
language sql
stable
set search_path = public
as $$
  select j.id,
         (o ->> 'unit')::integer,
         o ->> 'cosmeticSkinId',
         (o ->> 'quality')::integer
    from public.craft_jobs j,
         jsonb_array_elements(j.outputs) as o
   where j.owner_user_id = p_player_id
     and o ->> 'pending' = 'true'
     and o ? 'cosmeticSkinId'
$$;

create or replace function public.cc_finalize_crafted_skin(
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
        and elem ? 'cosmeticSkinId'
        then (elem - 'pending' - 'cosmeticSkinId' - 'quality')
             || jsonb_build_object('itemId', p_item_id)
      else elem
    end order by ord), '[]'::jsonb)
    into v_outputs
    from jsonb_array_elements(job.outputs) with ordinality as t(elem, ord);

  update public.craft_jobs set outputs = v_outputs where id = job.id;
  return jsonb_build_object('job_id', p_job_id, 'unit', p_unit, 'item_id', p_item_id);
end;
$$;

-- ─── cc_market_create (0087 head + skin listing branch) ───

create or replace function public.cc_market_create(p_player_id uuid, nonce text, item_id uuid, price_credits bigint)
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
  listing public.market_listings%rowtype;
  v_deposit bigint := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into item from public.item_instances where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.account_bound or not item.tradeable or item.runtime_state in ('listed','equipped','salvaged','consumed','in_service') then raise exception 'Item not listable'; end if;

  -- 0087 (tuning D3/P8): the listing deposit. Charged once here —
  -- before either branch — from the seller's Scrap stack, and
  -- snapshotted onto the listing row by both inserts below. The
  -- amount is the marketListingDepositScrap economy lever (content
  -- default 25, src/lib/market/listingDeposit.ts); the snapshot is
  -- what refunds on sale or burns on cancel, whatever the lever
  -- does later. A seller short on scrap cannot list at all.
  v_deposit := greatest(0, least(100000, coalesce(
    public.cc_economy_config_number('marketListingDepositScrap', 25), 25)))::bigint;
  if coalesce((p.materials ->> 'Scrap')::bigint, 0) < v_deposit then
    raise exception 'Insufficient scrap for the listing deposit';
  end if;
  if v_deposit > 0 then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, 'Scrap', (-v_deposit)::int)
     where id = actor returning * into p;
  end if;

  if item.kind = 'cosmetic' then
    -- Cosmetic part listing (0053): identity + card columns come
    -- from the part payload; listing an EQUIPPED part auto-unequips
    -- it in the same transaction (brief §5.2). A part under an
    -- active tint job cannot be listed mid-tint.
    if item.is_locked then raise exception 'Item is locked'; end if;
    if exists (
      select 1 from public.craft_jobs
       where owner_user_id = actor and kind = 'cosmetic' and status = 'active'
         and snapshot -> 'tint' ->> 'itemId' = item.id::text
    ) then
      raise exception 'Part is being tinted';
    end if;
    if item.payload ? 'skinId' then
      -- Whole-skin listing (reshape slice (d), 0099): skins
      -- trade as their OWN listing family — no part columns,
      -- no auto-unequip (wearing is the device-local wardrobe;
      -- a listed skin stops being owned, and the seller's worn
      -- selection falls back on their next cosmetics read).
      insert into public.market_listings(
        seller_user_id, item_instance_id, price_credits, status,
        listing_kind, quantity, material_id, identity_key, category,
        display_name, seller_type, part_id, tint_palette_id, quality_percent,
        deposit_scrap)
      values (
        actor, item.id, price_credits, 'active',
        'skin', 1, null, 'skin:' || (item.payload ->> 'skinId'), 'skin',
        item.payload ->> 'name', 'player', null,
        null, (item.payload ->> 'quality')::numeric,
        v_deposit)
      returning * into listing;
      update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;
      result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
      insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
      return result;
    end if;
    update public.player_skin_selection
       set equipped = equipped - (item.payload ->> 'slot'), updated_at = now()
     where user_id = actor
       and equipped ->> (item.payload ->> 'slot') = item.id::text;
    insert into public.market_listings(
      seller_user_id, item_instance_id, price_credits, status,
      listing_kind, quantity, material_id, identity_key, category,
      display_name, seller_type, part_id, tint_palette_id, quality_percent,
      deposit_scrap)
    values (
      actor, item.id, price_credits, 'active',
      'cosmetic', 1, null, 'cosmetic:' || (item.payload ->> 'partId'), 'cosmetic',
      item.payload ->> 'name', 'player', item.payload ->> 'partId',
      item.payload ->> 'tintPaletteId', (item.payload ->> 'quality')::numeric,
      v_deposit)
    returning * into listing;
    update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;
    result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
    return result;
  end if;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, identity_key, category, display_name,
    weapon_type, element, rarity, item_level, seller_type, deposit_scrap)
  values (
    actor, item.id, price_credits, 'active',
    case when item.kind = 'vehicle' then 'vehicle' else 'gear' end, 1,
    case when item.kind = 'vehicle'
      then 'vehicle:' || coalesce(item.payload ->> 'vehicleClassId', '') || ':' || item.rarity
      else public.cc_market_gear_identity(item.payload, item.kind, item.rarity, item.item_level) end,
    case when item.kind = 'vehicle' then 'vehicle'
      else public.cc_market_gear_category(item.payload, item.kind) end,
    item.payload ->> 'name',
    item.payload ->> 'weaponType',
    item.payload ->> 'element',
    coalesce(item.rarity, item.payload ->> 'rarity'),
    coalesce(item.item_level, (item.payload ->> 'level')::integer, 1),
    -- seller_type describes the seller (0081; owner ruling
    -- 2026-11-04): this path's actor is always a verified player
    -- (the NPC account never lists through here — the seed wrote
    -- rows directly, and the seed is removed), so the stamp is
    -- 'player'. The item's supply_mode is provenance, not seller
    -- identity; the vendor-weapon create refusal lives in the
    -- write stores and is unchanged.
    'player', v_deposit)
  returning * into listing;

  update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- ─── cc_accept_listing (0097 head + skin as an item-backed kind) ───

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

  if listing.listing_kind in ('gear', 'vehicle', 'cosmetic', 'skin') then
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
  if (listing.listing_kind in ('gear', 'vehicle', 'cosmetic', 'skin') and seller.id is not null
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

  if listing.listing_kind in ('gear', 'vehicle', 'cosmetic', 'skin') then
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

-- ─── cc_market_cancel (0087 head + skin as an item-backed kind) ───

create or replace function public.cc_market_cancel(p_player_id uuid, nonce text, listing_id uuid)
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
  batch public.consumable_batches%rowtype;
  listing public.market_listings%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into listing from public.market_listings where id = listing_id for update;
  if not found or listing.seller_user_id <> actor then raise exception 'Listing not found'; end if;
  if listing.status <> 'active' then raise exception 'Listing not active'; end if;

  update public.market_listings set status = 'cancelled' where id = listing.id returning * into listing;

  if listing.listing_kind in ('gear', 'vehicle', 'cosmetic', 'skin') then
    update public.item_instances set runtime_state = case when is_locked then 'locked' else 'available' end where id = listing.item_instance_id returning * into item;
  elsif listing.listing_kind = 'consumable' then
    update public.consumable_batches
       set quantity = consumable_batches.quantity + listing.quantity, updated_at = now()
     where id = listing.consumable_batch_id
    returning * into batch;
    if batch.id is null then
      -- The escrowed batch row is gone (e.g. progress reset): rebuild
      -- the stack from the listing's snapshot instead of losing it.
      perform public.cc_add_consumable_batch(
        actor, listing.consumable_type, listing.quantity, listing.quality_percent,
        coalesce(listing.batch_origin, 'market'), listing.batch_creator_user_id,
        listing.batch_source_recipe_id, 'market_sell',
        'Listing cancelled — escrow returned', jsonb_build_object('listing_id', listing.id));
    else
      insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
      values (actor, batch.id, listing.consumable_type, listing.quantity, listing.quality_percent, 'market_sell', 'Listing cancelled — escrow returned', jsonb_build_object('listing_id', listing.id));
    end if;
    update public.profiles
       set consumables = public.cc_jsonb_add_int(consumables, listing.consumable_type, listing.quantity)
     where id = actor
    returning * into p;
  elsif listing.listing_kind = 'material' then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, listing.material_id, listing.quantity)
     where id = actor
    returning * into p;
  elsif listing.listing_kind = 'fragment' then
    -- Escrow return (0050): raw restore, NO conversion here. The
    -- balance may sit at 5+ until the next reward application runs
    -- the 5-to-1 conversion -- listed fragments were never converted
    -- while escrowed because the escrow left cache_token_parts at
    -- list time, so the conversion only ever saw unescrowed shards.
    update public.profiles
       set cache_token_parts = cache_token_parts + listing.quantity
     where id = actor
    returning * into p;
  elsif listing.listing_kind = 'core' then
    update public.profiles
       set legendary_cores = legendary_cores + listing.quantity
     where id = actor
    returning * into p;
  elsif listing.listing_kind = 'essence' then
    update public.profiles
       set essences = public.cc_jsonb_add_int(essences, listing.essence_id, listing.quantity)
     where id = actor
    returning * into p;
  end if;

  -- 0087 (tuning D3/P8): the deposit is NOT returned by any branch
  -- above — cancelling burns it. The result names the burned
  -- amount so the burn is traceable in the ledger record.
  result := jsonb_build_object('action_type', 'cc_market_cancel', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item), 'deposit_burned', coalesce(listing.deposit_scrap, 0));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_cancel', nonce, result);
  return result;
end;
$function$;

-- ─── cc_enqueue_tint_job (0075 head + part-payload gate) ───

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
  -- Economy brief §4 (0072): the tint craft's flat Scrap leg resolves
  -- through its lever (recipeScrap.tint_craft) exactly like the
  -- generic enqueue — clamped [0, 100000], catalog literal fallback.
  v_scrap := greatest(0, least(100000, coalesce(
    public.cc_economy_config_number('recipeScrap.tint_craft',
      coalesce((recipe -> 'inputs' ->> 'Scrap')::numeric, 0)),
    coalesce((recipe -> 'inputs' ->> 'Scrap')::numeric, 0))))::integer;

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.kind <> 'cosmetic' then raise exception 'Item is not a cosmetic part'; end if;
  -- Whole skins (slice (d), 0099) share the cosmetic kind but
  -- are not parts: a tint names a part payload or it does not start.
  if not (item.payload ? 'partId') then raise exception 'Item is not a cosmetic part'; end if;
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
  -- the generic enqueue: one running + five queued — widened by
  -- banked bench time exactly like the generic gate (Econ 10,
  -- brief §8.3: three running + fifteen queued while the bank is
  -- above zero), except that this gate has never carried the
  -- Fixer queue bonus and still does not. The settle above has
  -- already drained the bank, so the figure read here is current.
  v_bench := 1;
  if (select count(*) from public.craft_jobs
       where owner_user_id = actor and status = 'active' and bench = v_bench)
       >= (case when coalesce(p.bench_time_banked_seconds, 0) > 0 then 18 else 6 end) then
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
