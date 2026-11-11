-- =====================================================================
-- 0087 — Scrap portfolio (economy tuning slice T3; owner ruling
-- D3 = YES, Michael, 2026-11-10; brief: economy-tuning/TUNING-BRIEF.md
-- proposals P7 + P8; P9 stopped on a false premise — see below).
--
-- §1 (below) — P7: cc_craft_recipe_catalog restated from its chain
-- head, migration 0086, with ONLY the 38 consumable Scrap legs
-- repriced (tiered ×2.5–×8.3 per the brief's P7 table; batch legs
-- keep migration 0038's construction — exactly 2.5× the repriced
-- singles). Verified the 0086 way: both catalogs parsed as JSON
-- and deep-compared — 83 recipes in, 83 out, none added, none
-- removed, changed inputs exactly the 38 Scrap values. The TS
-- registry (src/constants/craftingRecipes.ts +
-- src/content/crafting.ts) carries the same 38 values; the
-- recipeScrap.<id> economy lever still resolves on top at enqueue
-- and escrow still snapshots the resolved figure, so jobs already
-- running never reprice.
--
-- §2–§10 — P8: the market listing deposit. Creating any listing
-- charges 25 Scrap (the marketListingDepositScrap economy lever,
-- content default src/lib/market/listingDeposit.ts), snapshotted
-- onto the new market_listings.deposit_scrap column. The deposit
-- REFUNDS IN FULL when the listing sells (cc_accept_listing; for
-- Quick-Buy sweeps, on the leg that closes the listing — partial
-- legs refund nothing) and BURNS when the seller cancels
-- (cc_market_cancel: escrow returns verbatim, the deposit does
-- not). The 5% sale fee and its floor are untouched. A seller
-- whose Scrap stack cannot cover the deposit cannot list
-- ('Insufficient scrap for the listing deposit'), atomically —
-- no escrow moves on a refused create.
--
-- PREMISE FINDING 1 (P8's expiry leg — NOT BUILT): the brief's
-- deposit burns "when the listing is cancelled or expires
-- unsold", but listings never expire in the shipped game —
-- src/lib/market/listingAge.ts states it verbatim ("Listings
-- never expire in the data model"); the 'expired' status exists
-- in the 0003 CHECK constraint but no code or migration ever
-- sets it, and there is no TTL or sweep anywhere. The brief
-- specifies no TTL, so inventing one would be a new design
-- decision, not an implementation of P8. The cancel burn ships;
-- an expiry burn needs an owner-ruled TTL in its own slice.
--
-- PREMISE FINDING 2 (P9 — NOT BUILT): P9 proposed converting
-- reforge from credits to scrap, conditional on reforge charging
-- credits today. It does not: src/content/reforge.ts charges
-- SCRAP ONLY (3× the salvage value of a same-rarity/level item)
-- plus 2 legendary cores on Legendary-rarity gear, both
-- destroyed on use and already metered (scrap_destroyed_reforge,
-- legendary_cores_spent). Reforge is already the portfolio's
-- heavy scrap leg; there is nothing to convert.
--
-- METERING: cc_compute_economy_metrics is deliberately NOT
-- restated here. The meters fold verified-action-ledger payloads
-- (0071's design), and the deposit facts now ride those payloads
-- (deposit_scrap on every listing JSON; deposit_burned on the
-- cancel result), so a deposit breakout can be folded later with
-- no flow change.
--
-- PROVENANCE: every function below is restated from its
-- grep-verified chain head across all migrations 0001–0086
-- (verified 2026-11-10): catalog ← 0086; cc_accept_listing,
-- cc_market_create, cc_quickbuy_fill ← 0081;
-- cc_market_create_consumable ← 0019 (sole definition);
-- cc_market_create_material ← 0069; cc_market_create_core,
-- cc_market_create_essence ← 0050 (sole definitions);
-- cc_market_cancel ← 0053. cc_market_create_fragment takes no
-- deposit: fragments were abolished in 0082 and its create
-- function was dropped there. Deposit changes are marked 0087
-- inline; everything else is verbatim.
--
-- Application: staging rehearsal first, then production — applied
-- manually by the parent before merge; the Chef never runs
-- migrations. NOT applied by this slice.
-- =====================================================================

-- §1 — P7: the repriced catalog (from 0086; 38 Scrap values only).

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

-- =====================================================================
-- §2 — the listing deposit column (P8). The amount charged at
-- creation snapshots onto the listing row, so a later lever move
-- never reprices a live listing (the craft-escrow principle, 0072).
-- Rows created before this migration carry 0 and refund 0.
-- =====================================================================

alter table public.market_listings
  add column if not exists deposit_scrap bigint not null default 0;

-- =====================================================================
-- §3 — cc_accept_listing restated from its chain head, migration
-- 0081, with ONE addition: the deposit refund on sale (marked
-- 0087). Everything else is verbatim.
-- =====================================================================

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

-- =====================================================================
-- §4 — cc_quickbuy_fill restated from its chain head, migration
-- 0081, with ONE addition: on the leg that CLOSES a listing, the
-- snapshotted deposit refunds to the seller (marked 0087). Partial
-- legs refund nothing — the deposit rides with the listing until
-- it closes or burns on cancel.
-- =====================================================================

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

-- =====================================================================
-- §5 — cc_market_create restated from its chain head, migration
-- 0081, with the deposit charge added (marked 0087): charged ONCE,
-- before the cosmetic/gear branch split, snapshotted onto the
-- listing row by both branches' inserts.
-- =====================================================================

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

-- =====================================================================
-- §6 — cc_market_create_consumable restated from its chain head,
-- migration 0019 (its sole definition), with the deposit charge
-- added (marked 0087): charged after the batch is validated,
-- before the escrow decrement, snapshotted onto the listing row.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.cc_market_create_consumable(p_player_id uuid, nonce text, batch_id uuid, quantity integer, price_credits bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  batch public.consumable_batches%rowtype;
  listing public.market_listings%rowtype;
  qty integer := coalesce(quantity, 0);
  v_deposit bigint := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if qty <= 0 then raise exception 'quantity must be positive'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  select * into batch from public.consumable_batches where id = batch_id and owner_user_id = actor for update;
  if not found then raise exception 'Consumable batch not found'; end if;
  if batch.consumable_type = 'ElementalCoating' then raise exception 'Consumable not listable on the player market'; end if;
  if batch.quantity < qty then raise exception 'Insufficient consumable quantity'; end if;

  -- 0087 (tuning D3/P8): the listing deposit — see cc_market_create.
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

  -- NB: `quantity` is also this function's parameter name, so the
  -- column side is table-qualified to stay unambiguous.
  update public.consumable_batches
     set quantity = consumable_batches.quantity - qty, updated_at = now()
   where id = batch.id
  returning * into batch;

  insert into public.consumable_events(user_id, batch_id, consumable_type, quantity_delta, quality_percent, event_type, reason, metadata)
  values (actor, batch.id, batch.consumable_type, -qty, batch.quality_percent, 'market_sell', 'Listed on the player market (escrow)', jsonb_build_object('price_credits', price_credits));

  update public.profiles
     set consumables = public.cc_jsonb_add_int(consumables, batch.consumable_type, -qty)
   where id = actor
  returning * into p;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, quality_percent, consumable_type,
    consumable_batch_id, batch_origin, batch_creator_user_id,
    batch_source_recipe_id, identity_key, category, display_name, seller_type,
    deposit_scrap)
  values (
    actor, null, price_credits, 'active',
    'consumable', qty, batch.quality_percent, batch.consumable_type,
    batch.id, batch.origin, batch.creator_user_id,
    batch.source_recipe_id,
    public.cc_market_consumable_identity(batch.consumable_type, batch.quality_percent),
    'consumable', batch.consumable_type, 'player',
    v_deposit)
  returning * into listing;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', null, 'delivery', jsonb_build_object('kind', 'consumable', 'consumable_type', batch.consumable_type, 'quantity', qty, 'quality_percent', batch.quality_percent, 'batch_id', batch.id));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- =====================================================================
-- §7 — cc_market_create_material restated from its chain head,
-- migration 0069, with the deposit charge added (marked 0087).
-- Same-stack rule: listing Scrap itself escrows from the very
-- stack the deposit draws on, so the deposit check runs against
-- the post-escrow remainder.
-- =====================================================================

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
  v_deposit bigint := 0;
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

  -- 0087 (tuning D3/P8): the listing deposit — see cc_market_create.
  -- Listing Scrap itself draws the escrow from the deposit's own
  -- stack, so the check runs against the post-escrow remainder.
  v_deposit := greatest(0, least(100000, coalesce(
    public.cc_economy_config_number('marketListingDepositScrap', 25), 25)))::bigint;
  if coalesce((p.materials ->> 'Scrap')::bigint, 0)
       - (case when material_id = 'Scrap' then qty else 0 end) < v_deposit then
    raise exception 'Insufficient scrap for the listing deposit';
  end if;
  if v_deposit > 0 then
    update public.profiles
       set materials = public.cc_jsonb_add_int(materials, 'Scrap', (-v_deposit)::int)
     where id = actor returning * into p;
  end if;

  update public.profiles
     set materials = public.cc_jsonb_add_int(materials, material_id, -qty)
   where id = actor
  returning * into p;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, material_id, identity_key, category,
    display_name, seller_type, deposit_scrap)
  values (
    actor, null, price_credits, 'active',
    'material', qty, material_id, 'mat:' || material_id, 'material',
    material_id, 'player', v_deposit)
  returning * into listing;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', null, 'delivery', jsonb_build_object('kind', 'material', 'material_id', material_id, 'quantity', qty));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- =====================================================================
-- §8 — cc_market_create_core restated from its chain head,
-- migration 0050 (its sole definition), with the deposit charge
-- added (marked 0087).
-- =====================================================================

create or replace function public.cc_market_create_core(p_player_id uuid, nonce text, quantity integer, price_credits bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  qty integer := coalesce(quantity, 0);
  v_deposit bigint := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if qty <= 0 then raise exception 'quantity must be positive'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  if coalesce(p.legendary_cores, 0) < qty then raise exception 'Insufficient legendary core quantity'; end if;

  -- 0087 (tuning D3/P8): the listing deposit — see cc_market_create.
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

  update public.profiles
     set legendary_cores = legendary_cores - qty
   where id = actor
  returning * into p;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, identity_key, category, display_name, seller_type,
    deposit_scrap)
  values (
    actor, null, price_credits, 'active',
    'core', qty, 'core:legendary', 'core', 'Legendary Core', 'player',
    v_deposit)
  returning * into listing;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', null, 'delivery', jsonb_build_object('kind', 'core', 'quantity', qty));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- =====================================================================
-- §9 — cc_market_create_essence restated from its chain head,
-- migration 0050 (its sole definition), with the deposit charge
-- added (marked 0087).
-- =====================================================================

create or replace function public.cc_market_create_essence(p_player_id uuid, nonce text, essence_id text, quantity integer, price_credits bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  actor uuid := p_player_id;
  prior jsonb;
  p public.profiles%rowtype;
  listing public.market_listings%rowtype;
  qty integer := coalesce(quantity, 0);
  owned integer := 0;
  essence_name text;
  v_deposit bigint := 0;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if price_credits <= 0 then raise exception 'price_credits must be positive'; end if;
  if qty <= 0 then raise exception 'quantity must be positive'; end if;
  -- The five profile essence types (src/types/game.ts EssenceType);
  -- each trades as its own commodity, keyed 'ess:<id>'.
  essence_name := case essence_id
    when 'IgnitionFluid' then 'Ignition Fluid'
    when 'ConduitWire' then 'Conduit Wire'
    when 'AcidCompound' then 'Acid Compound'
    when 'CryoGel' then 'Cryo Gel'
    when 'VoidEssence' then 'Void Essence'
    else null
  end;
  if essence_name is null then raise exception 'Unknown essence'; end if;
  if not public.can_use_player_economy(actor) then raise exception 'Verified account required'; end if;

  select result_payload into prior from public.verified_action_ledger where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  select * into p from public.profiles where id = actor for update;
  owned := public.cc_jsonb_int(coalesce(p.essences, '{}'::jsonb), essence_id);
  if owned < qty then raise exception 'Insufficient essence quantity'; end if;

  -- 0087 (tuning D3/P8): the listing deposit — see cc_market_create.
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

  update public.profiles
     set essences = public.cc_jsonb_add_int(essences, essence_id, -qty)
   where id = actor
  returning * into p;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, essence_id, identity_key, category, display_name, seller_type,
    deposit_scrap)
  values (
    actor, null, price_credits, 'active',
    'essence', qty, essence_id, 'ess:' || essence_id, 'essence', essence_name, 'player',
    v_deposit)
  returning * into listing;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', null, 'delivery', jsonb_build_object('kind', 'essence', 'essence_id', essence_id, 'quantity', qty));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

-- =====================================================================
-- §10 — cc_market_cancel restated from its chain head, migration
-- 0053. The escrow returns below are VERBATIM: the deposit is
-- burned by ABSENCE — no branch refunds it — and the result now
-- states the burned amount explicitly (marked 0087) so the burn
-- is traceable in the ledger record (Trace Law).
-- =====================================================================

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

  if listing.listing_kind in ('gear', 'vehicle', 'cosmetic') then
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
