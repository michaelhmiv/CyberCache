-- 0053: Skins — cosmetic parts system (Parts M4).
--
-- The skins system lands (design record:
-- design-briefs/skins-system-BRIEF.md, owner rulings 2026-11-02):
-- skin parts simply APPEAR IN CRAFTING (no blueprints, no drops),
-- costs are SCRAP-led, ownership = inventory possession, equip =
-- this migration's server selection record, parts are tradeable
-- once unequipped (listing an equipped part auto-unequips it),
-- manufacturer heads join the normal scrap-crafting pool while
-- Standing rank-3 heads stay wearable (grandfathered), and
-- everything is pure cosmetic — ZERO stats: nothing here touches
-- a mechanics snapshot, DPS, or HP path.
--
-- Contents:
--   * player_skin_selection: the Chef loadout record for cosmetics
--     (equipped slot -> item id, plus the head-variant pick, which
--     moves server-side from its device-local store so the look
--     follows the account; the client migrates a local pick once).
--   * market_listings: listing_kind widened (+ 'cosmetic') and two
--     additive card columns (part_id, tint_palette_id; the part's
--     quality rides the existing quality_percent column).
--   * mastery_definitions: the crafting.cosmetics track is seeded
--     (15 XP per completed cosmetic unit; its level widens the
--     finish roll) — without the row, mastery grants FK-fail.
--   * cc_is_material_key / cc_market_create_material: + Chromaweave
--     (the tint material; refined from MycoSteelFiber + VoidEssence
--     by refine_chromaweave, player-market tradable like every
--     material).
--   * cc_craft_recipe_catalog restated: 87 recipes (59 shipped +
--     refine_chromaweave + 26 cosmetic part recipes + tint_craft).
--   * cc_enqueue_craft_job restated (0048 body): the recipe inputs'
--     `Scrap` key verifies/charges the profiles.scrap COLUMN (the
--     bulk currency — cosmetic recipes are scrap-led); per-recipe
--     maxUnits caps bind; the tint recipe refuses the generic path.
--   * cc_enqueue_tint_job (new): item-target job starting a tint
--     craft against an OWNED part (shield-tech enqueue pattern);
--     Chromaweave is priced per palette in the recipe.
--   * cc_complete_craft_unit restated (0044 body): cosmetic branch
--     — part crafts emit a pending output priced by the finish
--     roll (content/skins.ts COSMETIC_QUALITY twin formula); tint
--     jobs write payload.tintPaletteId on the target at completion;
--     mastery maps cosmetic -> crafting.cosmetics at 15 XP/unit.
--   * cc_cancel_craft_job restated (0044 body): the escrow's Scrap
--     leg refunds to the scrap column on the standard schedule.
--   * cc_pending_crafted_cosmetics / cc_finalize_crafted_cosmetic
--     (new): the gear pair's mirror — the TS finalizer turns each
--     pending output into a kind='cosmetic' item_instances row.
--   * cc_cosmetics_view / cc_cosmetic_equip / cc_cosmetic_unequip /
--     cc_cosmetic_set_head_variant (new): the selection record's
--     whole write surface. Equip validates possession server-side;
--     the ONE exception is the grandfathered Standing head: a
--     manufacturer head-variant pick stays legal at rank >= 3 (the
--     0043 unlock fact) without owning the crafted part.
--   * cc_market_create restated (0032 body): the cosmetic branch —
--     identity/card columns from the part payload, auto-unequip on
--     list, tint-in-progress refusal.
--   * cc_accept_listing restated (0050 body): cosmetics join the
--     gear branches (sale fee, proceeds bonus, item transfer).
--   * cc_market_cancel restated (0050 body): cancelling a cosmetic
--     listing restores the item like gear.
--   * cc_recycle_item restated (0026 body): salvaging a part that
--     is currently worn removes it from the selection record in
--     the same transaction.
--
-- LOAD-BEARING: the client and Chef in this slice call the new
-- functions and read the widened listing kind; apply BEFORE the
-- merge deploys (the parent applies it live, per program drill).

-- ------------------------------------------------------------------
-- Schema: the cosmetics selection record + market card columns.
-- ------------------------------------------------------------------

create table if not exists public.player_skin_selection (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  equipped jsonb not null default '{}'::jsonb,
  head_variant text not null default 'visor',
  updated_at timestamptz not null default now()
);

alter table public.market_listings
  add column if not exists part_id text;
alter table public.market_listings
  add column if not exists tint_palette_id text;

alter table public.market_listings
  drop constraint if exists market_listings_listing_kind_check;
alter table public.market_listings
  add constraint market_listings_listing_kind_check
    check (listing_kind in ('gear', 'consumable', 'material', 'vehicle', 'fragment', 'core', 'essence', 'cosmetic'));

-- The cosmetics mastery track, seeded exactly like crafting.refining
-- / crafting.gear in 0024 (category 'economy'): cosmetic completion
-- grants it 15 XP per unit and its level widens the finish roll.
insert into public.mastery_definitions (id, category, label, description, unit_label, xp_per_unit, is_ranked, is_active, created_at, updated_at)
values ('crafting.cosmetics', 'economy', 'Cosmetic Crafting', 'Workshop skin-part and tint crafting experience. Higher levels widen the finish roll toward pristine.', 'parts', 15, true, true, now(), now())
on conflict do nothing;

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
    'WovenCircuits','CondensedVoid','CompositePlating','CircuitLattice','Voidweave','Chromaweave'])
$$;

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
  if material_id not in ('ScrapAlloy','BallisticParts','ReactiveComponents','TechFragments','VoidDust','Siltglass','NitrocellGel','HeartwoodResin','ForgeheartIngots','PrismShards','MagnetiteCores','MycoSteelFiber','RefinedAlloy','TemperedParts','StabilizedCells','WovenCircuits','CondensedVoid','CompositePlating','CircuitLattice','Voidweave','Chromaweave') then
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
      "ScrapAlloy": 15,
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
      "ScrapAlloy": 25,
      "ReactiveComponents": 15,
      "VoidDust": 1
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 10,
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
      "ScrapAlloy": 20,
      "ReactiveComponents": 12
    },
    "unitDurationMs": 900000,
    "requiresLevel": 3,
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
      "ScrapAlloy": 30,
      "ReactiveComponents": 20,
      "VoidDust": 2
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 15,
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
      "ScrapAlloy": 40,
      "ReactiveComponents": 25,
      "VoidDust": 3
    },
    "unitDurationMs": 3600000,
    "requiresLevel": 20,
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
      "ScrapAlloy": 10,
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
      "ScrapAlloy": 18,
      "BallisticParts": 12,
      "TechFragments": 2
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 6,
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
      "ScrapAlloy": 15,
      "BallisticParts": 10
    },
    "unitDurationMs": 900000,
    "requiresLevel": 5,
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
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "IgnitionFluid": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
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
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "ConduitWire": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
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
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "AcidCompound": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
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
      "ScrapAlloy": 15,
      "BallisticParts": 8,
      "CryoGel": 3
    },
    "unitDurationMs": 1080000,
    "requiresLevel": 8,
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
      "ScrapAlloy": 20,
      "BallisticParts": 10,
      "VoidEssence": 5
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 15,
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
      "ScrapAlloy": 12,
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
      "ScrapAlloy": 18,
      "BallisticParts": 8,
      "ConduitWire": 4,
      "TechFragments": 2
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 9,
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
      "ScrapAlloy": 18,
      "BallisticParts": 8,
      "AcidCompound": 4,
      "TechFragments": 2
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 9,
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
      "ScrapAlloy": 25,
      "BallisticParts": 15,
      "VoidDust": 2
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 12,
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
      "ScrapAlloy": 20,
      "BallisticParts": 10,
      "TechFragments": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 8,
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
      "ScrapAlloy": 30,
      "BallisticParts": 15,
      "VoidDust": 5
    },
    "unitDurationMs": 2100000,
    "requiresLevel": 18,
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
      "ScrapAlloy": 15,
      "TechFragments": 8
    },
    "unitDurationMs": 900000,
    "requiresLevel": 5,
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
      "ScrapAlloy": 20,
      "TechFragments": 12
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 10,
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
      "ScrapAlloy": 30,
      "TechFragments": 15,
      "VoidDust": 2
    },
    "unitDurationMs": 2100000,
    "requiresLevel": 15,
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
      "ScrapAlloy": 25,
      "TechFragments": 15,
      "VoidDust": 3
    },
    "unitDurationMs": 2400000,
    "requiresLevel": 18,
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
      "ScrapAlloy": 20,
      "TechFragments": 10,
      "ConduitWire": 2
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
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
      "ScrapAlloy": 15,
      "BallisticParts": 10,
      "TechFragments": 5
    },
    "unitDurationMs": 1320000,
    "requiresLevel": 10,
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
      "ScrapAlloy": 15,
      "TechFragments": 10,
      "ConduitWire": 2
    },
    "unitDurationMs": 1200000,
    "requiresLevel": 7,
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
      "ScrapAlloy": 20,
      "TechFragments": 14,
      "VoidDust": 2
    },
    "unitDurationMs": 1800000,
    "requiresLevel": 12,
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
      "ScrapAlloy": 12,
      "TechFragments": 8
    },
    "unitDurationMs": 960000,
    "requiresLevel": 5,
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
      "ScrapAlloy": 18,
      "TechFragments": 12,
      "VoidDust": 1
    },
    "unitDurationMs": 1440000,
    "requiresLevel": 10,
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
      "ScrapAlloy": 4,
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
      "ScrapAlloy": 6,
      "ReactiveComponents": 3,
      "TechFragments": 1,
      "HeartwoodResin": 1
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
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
      "ScrapAlloy": 8,
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
      "ScrapAlloy": 6,
      "NitrocellGel": 1
    },
    "unitDurationMs": 900000,
    "requiresLevel": 8,
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
    "requiresLevel": 15,
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
      "ScrapAlloy": 10
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
      "ScrapAlloy": 50,
      "ReactiveComponents": 30
    },
    "unitDurationMs": 1980000,
    "requiresLevel": 3,
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
      "ScrapAlloy": 10,
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
      "ScrapAlloy": 30,
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
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
      "ScrapAlloy": 20
    },
    "unitDurationMs": 1500000,
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 10,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 5,
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
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
    "requiresLevel": 12,
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
    if v_key = 'Scrap' then
      -- 0053: the cosmetic recipes' lead input is the scrap COLUMN
      -- (the game's bulk currency), not a material/essence key.
      v_available := coalesce(p.scrap, 0);
      if v_available < v_per_unit * v_units then
        raise exception 'Insufficient scrap';
      end if;
    elsif public.cc_is_material_key(v_key) then
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
    if v_key = 'Scrap' then
      update public.profiles
         set scrap = scrap - v_per_unit::integer,
             updated_at = now()
       where id = actor;
    elsif public.cc_is_material_key(v_key) then
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
  if coalesce(p.scrap, 0) < v_scrap then raise exception 'Insufficient scrap'; end if;
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
       set scrap = scrap - v_scrap, updated_at = now()
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
    v_roll := round((
      ((v_bounds ->> 'min')::numeric
        + random() * greatest(0, (v_bounds ->> 'max')::numeric - (v_bounds ->> 'min')::numeric))
      * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
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
    v_tempered := random() < least(0.3, greatest(0, p_temper_base) + 0.01 * v_ml + v_craft_temper_bonus + v_research_temper);
    v_output := v_output || jsonb_build_object(
      'pending', true,
      'slot', recipe ->> 'gearSlot',
      'rarity', job.snapshot ->> 'gearRarity',
      'item_level', p.player_level,
      'draws', (case when v_tempered then 3 else 1 end)
        + case when job.snapshot ->> 'coreCatalyst' = 'true'
            then 2 + coalesce((job.snapshot ->> 'coreCatalystDrawBonus')::integer, 0)
            else 0 end
        + v_research_draws,
      'tempered', v_tempered
    );
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
        * case job.bench when 2 then 1.05 when 3 then 1.10 else 1.0 end
        * coalesce((job.snapshot ->> 'toolQualityMultiplier')::numeric, 1)
      )::numeric) + v_shift;
      v_roll := least(100, greatest(1, v_roll))::integer;
      v_output := v_output || jsonb_build_object(
        'pending', true,
        'cosmeticPartId', recipe ->> 'cosmeticPartId',
        'quality', v_roll
      );
    end if;
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
  elsif job.kind = 'cosmetic' then
    v_mastery_track := 'crafting.cosmetics'; v_mastery_xp := 15;
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
end;$$;

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
      if v_key = 'Scrap' then
        -- 0053: the cosmetic escrow's scrap leg refunds to the
        -- scrap column on the standard schedule.
        update public.profiles
           set scrap = scrap + v_amount::integer,
               updated_at = now()
         where id = actor;
      elsif public.cc_is_material_key(v_key) then
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

-- ------------------------------------------------------------------
-- The cosmetics selection surface (new in 0053).
--
-- cc_cosmetics_view is the read the whole feature hangs off: the
-- player's selection record, their owned part items (the Wardrobe
-- list — listed/salvaged/consumed parts are not wearable and drop
-- out), and the grandfathered Standing heads (rank >= 3 facts from
-- 0043). cc_hunter_look_view is the PUBLIC projection other
-- hunters render by (Standings): slots + part ids + tint + quality,
-- no item ids.
-- ------------------------------------------------------------------

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
        'tier', (i.payload ->> 'tier')::integer,
        'quality', (i.payload ->> 'quality')::integer,
        'tintPaletteId', i.payload ->> 'tintPaletteId',
        'runtimeState', i.runtime_state
      ) order by i.created_at)
      from public.item_instances i
      where i.owner_user_id = p_player_id
        and i.kind = 'cosmetic'
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

create or replace function public.cc_hunter_look_view(p_player_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  sel public.player_skin_selection%rowtype;
  v_found boolean;
  v_parts jsonb := '{}'::jsonb;
  v_slot text;
  v_item_id text;
  v_item public.item_instances%rowtype;
begin
  select * into sel from public.player_skin_selection where user_id = p_player_id;
  v_found := found;
  if v_found then
    for v_slot, v_item_id in
      select key, value from jsonb_each_text(sel.equipped)
    loop
      select * into v_item from public.item_instances
       where id = v_item_id::uuid and owner_user_id = p_player_id
         and kind = 'cosmetic' and runtime_state in ('available', 'locked');
      if found then
        v_parts := jsonb_set(v_parts, array[v_slot], jsonb_build_object(
          'partId', v_item.payload ->> 'partId',
          'tintPaletteId', v_item.payload ->> 'tintPaletteId',
          'quality', (v_item.payload ->> 'quality')::integer
        ), true);
      end if;
    end loop;
  end if;
  return jsonb_build_object(
    'headVariant', case when v_found then sel.head_variant else 'visor' end,
    'parts', v_parts
  );
end;
$$;

create or replace function public.cc_cosmetic_equip(
  p_player_id uuid, nonce text, item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  item public.item_instances%rowtype;
  v_slot text;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));
  perform public.cc_settle_craft_jobs(actor);

  select * into item from public.item_instances
   where id = item_id and owner_user_id = actor for update;
  if not found then raise exception 'Item not found'; end if;
  if item.kind <> 'cosmetic' then raise exception 'Item is not a cosmetic part'; end if;
  if item.runtime_state <> 'available' then
    raise exception 'Part is not available to equip';
  end if;
  if exists (select 1 from public.craft_jobs
              where owner_user_id = actor and kind = 'cosmetic' and status = 'active'
                and snapshot -> 'tint' ->> 'itemId' = item.id::text) then
    raise exception 'Part is being tinted';
  end if;
  v_slot := item.payload ->> 'slot';
  if v_slot not in ('head','torso','armUpperN','armForeN','armFar',
                    'thighF','thighB','lowerLegF','lowerLegB','back') then
    raise exception 'Part has no wearable slot';
  end if;

  insert into public.player_skin_selection(user_id, equipped)
  values (actor, jsonb_build_object(v_slot, item.id::text))
  on conflict (user_id) do update
    set equipped = public.player_skin_selection.equipped
                   || jsonb_build_object(v_slot, item.id::text),
        updated_at = now();

  result := jsonb_build_object('action_type', 'cc_cosmetic_equip',
    'cosmetics', public.cc_cosmetics_view(actor));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cosmetic_equip', nonce, result);
  return result;
end;
$$;

create or replace function public.cc_cosmetic_unequip(
  p_player_id uuid, nonce text, p_slot text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;
  if p_slot not in ('head','torso','armUpperN','armForeN','armFar',
                    'thighF','thighB','lowerLegF','lowerLegB','back') then
    raise exception 'Unknown cosmetic slot';
  end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  insert into public.player_skin_selection(user_id, equipped)
  values (actor, '{}'::jsonb)
  on conflict (user_id) do update
    set equipped = public.player_skin_selection.equipped - p_slot,
        updated_at = now();

  result := jsonb_build_object('action_type', 'cc_cosmetic_unequip',
    'cosmetics', public.cc_cosmetics_view(actor));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cosmetic_unequip', nonce, result);
  return result;
end;
$$;

create or replace function public.cc_cosmetic_set_head_variant(
  p_player_id uuid, nonce text, p_variant text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := p_player_id;
  prior jsonb;
  v_manufacturer text;
  result jsonb;
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if nonce is null or length(trim(nonce)) < 8 then raise exception 'nonce is required'; end if;

  v_manufacturer := case p_variant
    when 'mfr-redline' then 'Redline'
    when 'mfr-ironwood' then 'Ironwood'
    when 'mfr-blastforge' then 'BlastForge'
    when 'mfr-prismatek' then 'Prismatek'
    when 'mfr-throwtech' then 'ThrowTech'
    when 'mfr-helixworks' then 'HelixWorks'
    else null
  end;
  if p_variant not in ('visor', 'optic', 'hood', 'fin') and v_manufacturer is null then
    raise exception 'Unknown head variant';
  end if;
  -- The grandfather rule (brief §0.6): a manufacturer head PICK
  -- stays legal for a hunter who earned it at Standing rank 3 —
  -- the 0043 unlock record is the entitlement. (Wearing the
  -- CRAFTED manufacturer head part is the equip path and needs no
  -- rank; it is a different record.)
  if v_manufacturer is not null
     and coalesce((
       select rank from public.manufacturer_standing
        where player_id = actor and manufacturer = v_manufacturer
     ), 0) < 3 then
    raise exception 'That head is earned at % rank 3', v_manufacturer;
  end if;

  select result_payload into prior from public.verified_action_ledger
   where user_id = actor and idempotency_key = nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  insert into public.player_skin_selection(user_id, head_variant)
  values (actor, p_variant)
  on conflict (user_id) do update
    set head_variant = excluded.head_variant, updated_at = now();

  result := jsonb_build_object('action_type', 'cc_cosmetic_set_head_variant',
    'cosmetics', public.cc_cosmetics_view(actor));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_cosmetic_set_head_variant', nonce, result);
  return result;
end;
$$;

-- ------------------------------------------------------------------
-- Pending cosmetic outputs (new in 0053): the gear pair's mirror.
-- A completed cosmetic part unit pends in craft_jobs.outputs; the
-- TS finalizer (src/server/writes/craftFinalize.ts) builds the
-- item from the part catalog and stamps it in through
-- cc_finalize_crafted_cosmetic.
-- ------------------------------------------------------------------

create or replace function public.cc_pending_crafted_cosmetics(p_player_id uuid)
returns table(job_id uuid, unit integer, part_id text, quality integer)
language sql
stable
set search_path = public
as $$
  select j.id,
         (o ->> 'unit')::integer,
         o ->> 'cosmeticPartId',
         (o ->> 'quality')::integer
    from public.craft_jobs j,
         jsonb_array_elements(j.outputs) as o
   where j.owner_user_id = p_player_id
     and o ->> 'pending' = 'true'
     and o ? 'cosmeticPartId'
$$;

create or replace function public.cc_finalize_crafted_cosmetic(
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
        and elem ? 'cosmeticPartId'
        then (elem - 'pending' - 'cosmeticPartId' - 'quality')
             || jsonb_build_object('itemId', p_item_id)
      else elem
    end order by ord), '[]'::jsonb)
    into v_outputs
    from jsonb_array_elements(job.outputs) with ordinality as t(elem, ord);

  update public.craft_jobs set outputs = v_outputs where id = job.id;
  return jsonb_build_object('job_id', p_job_id, 'unit', p_unit, 'item_id', p_item_id);
end;
$$;

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
      display_name, seller_type, part_id, tint_palette_id, quality_percent)
    values (
      actor, item.id, price_credits, 'active',
      'cosmetic', 1, null, 'cosmetic:' || (item.payload ->> 'partId'), 'cosmetic',
      item.payload ->> 'name', 'player', item.payload ->> 'partId',
      item.payload ->> 'tintPaletteId', (item.payload ->> 'quality')::numeric)
    returning * into listing;
    update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;
    result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
    insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
    return result;
  end if;

  insert into public.market_listings(
    seller_user_id, item_instance_id, price_credits, status,
    listing_kind, quantity, identity_key, category, display_name,
    weapon_type, element, rarity, item_level, seller_type)
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
    case when coalesce(item.supply_mode, '') = 'npc_market' then 'npc' else 'player' end)
  returning * into listing;

  update public.item_instances set runtime_state = 'listed' where id = item.id returning * into item;

  result := jsonb_build_object('action_type', 'cc_market_create', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_create', nonce, result);
  return result;
end;
$function$;

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

  -- Cache Rank Silver Tongue (0031): the proceeds uplift applies
  -- AFTER the fee, on the post-fee proceeds, and only where a fee
  -- branch ran (real player seller; NPC listings exempt). The
  -- uplift is MINTED to the seller and metered as such
  -- (market_fee.cache_rank_proceeds_bonus folds into
  -- credits_minted_other in cc_compute_economy_metrics).
  -- Composition order: fee rate (lever) x (1 - Darknet/Manipulator/
  -- House Brand reductions) first, then the uplift.
  if (listing.listing_kind in ('gear', 'vehicle', 'cosmetic') and seller.id is not null
        and item.id is not null and coalesce(item.supply_mode, '') <> 'npc_market')
     or (listing.listing_kind not in ('gear', 'vehicle') and seller.id is not null
        and coalesce(listing.seller_type, 'player') <> 'npc') then
    proceeds_bonus := floor((listing.price_credits - fee_credits)
      * public.cc_cache_rank_bonus_fraction(seller.cache_rank_spends, 'marketProceeds'))::bigint;
  end if;

  update public.profiles set credits = credits - listing.price_credits where id = actor returning * into p;
  update public.profiles set credits = credits + (listing.price_credits - fee_credits + proceeds_bonus) where id = listing.seller_user_id;
  update public.market_listings set status = 'sold', sold_at = now() where id = listing.id returning * into listing;

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

  result := jsonb_build_object('action_type', 'cc_market_cancel', 'profile', public.cc_profile_snapshot(p), 'listing', to_jsonb(listing), 'item', to_jsonb(item));
  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload) values (actor, 'cc_market_cancel', nonce, result);
  return result;
end;
$function$;

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
      else 'ScrapAlloy'
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

  update public.profiles
  set scrap = scrap + award,
      legendary_cores = legendary_cores + cores,
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

-- ─── cc_apply_extraction restated (whitelist + Chromaweave) ────
-- The extraction applier validates profile material keys against
-- its embedded whitelist (0033). Chromaweave joins the material
-- set in this migration, so the applier is restated with the one
-- id added — a profile holding Chromaweave must never fail an
-- extraction settlement's material validation. Body otherwise
-- identical to 0033's.
create or replace function public.cc_apply_extraction(
  p_player_id uuid,
  p_nonce text,
  p_passes jsonb
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
  s public.extraction_state%rowtype;
  v_rate numeric := least(0.85, greatest(0.70,
    public.cc_economy_config_number('extractXpRate', 0.75)));
  v_rank_fraction numeric;
  v_pending jsonb;
  v_expected integer;
  v_pass jsonb;
  v_index integer;
  v_draws integer;
  v_units bigint;
  v_key text;
  v_qty bigint;
  v_xp bigint;
  v_next jsonb;
  v_level integer;
  v_level_xp bigint;
  v_total_xp bigint := 0;
  v_materials jsonb := '{}'::jsonb;
  v_essences jsonb := '{}'::jsonb;
  v_results jsonb := '[]'::jsonb;
  result jsonb;
  v_material_ids text[] := array[
    'ScrapAlloy','BallisticParts','ReactiveComponents','TechFragments','VoidDust',
    'Siltglass','NitrocellGel','HeartwoodResin','ForgeheartIngots',
    'PrismShards','MagnetiteCores','MycoSteelFiber',
    'RefinedAlloy','TemperedParts','StabilizedCells','WovenCircuits',
    'CondensedVoid','CompositePlating','CircuitLattice','Voidweave','Chromaweave'];
  v_essence_ids text[] := array[
    'IgnitionFluid','ConduitWire','AcidCompound','CryoGel','VoidEssence'];
begin
  if actor is null then raise exception 'Authentication required'; end if;
  if p_nonce is null or length(trim(p_nonce)) < 8 then raise exception 'nonce is required'; end if;

  select result_payload into prior
  from public.verified_action_ledger vl
  where vl.user_id = actor and vl.idempotency_key = p_nonce;
  if prior is not null then return prior; end if;

  perform pg_advisory_xact_lock(hashtext(actor::text));

  select * into p from public.profiles where id = actor for update;
  if not found then raise exception 'Profile not found'; end if;
  select * into s from public.extraction_state where user_id = actor for update;
  if not found then raise exception 'No extraction state'; end if;

  v_pending := s.pending_passes;
  if jsonb_typeof(p_passes) is distinct from 'array' then
    raise exception 'Extraction passes payload must be an array';
  end if;
  if jsonb_array_length(p_passes) = 0 then
    raise exception 'Extraction settle batch is empty';
  end if;
  if jsonb_array_length(p_passes) > jsonb_array_length(v_pending) then
    raise exception 'Extraction settle claims more passes than are pending';
  end if;

  v_rank_fraction := public.cc_cache_rank_bonus_fraction(
    coalesce(p.cache_rank_spends, '{}'::jsonb), 'xp');
  v_level := p.player_level;
  v_level_xp := p.player_xp;
  v_expected := s.finalized_passes;

  for v_pass in select * from jsonb_array_elements(p_passes) loop
    v_expected := v_expected + 1;
    v_index := (v_pass ->> 'index')::integer;
    if v_index is null or v_index <> v_expected then
      raise exception 'Extraction pass index % does not continue the sequence', v_index;
    end if;
    if (v_pending -> (v_expected - s.finalized_passes - 1) ->> 'areaId')
         is distinct from (v_pass ->> 'area_id')
       or (v_pending -> (v_expected - s.finalized_passes - 1) ->> 'method')
         is distinct from (v_pass ->> 'method') then
      raise exception 'Extraction pass % does not match the pending pass on record', v_index;
    end if;
    v_draws := coalesce((v_pass ->> 'draws')::integer, 0);
    if v_draws < 0 or v_draws > 500 then
      raise exception 'Extraction pass % draws out of bounds', v_index;
    end if;

    -- Whitelist + unit bound across both find maps.
    v_units := 0;
    for v_key, v_qty in
      select key, (value)::bigint
        from jsonb_each_text(coalesce(v_pass -> 'finds_materials', '{}'::jsonb))
    loop
      if not (v_key = any (v_material_ids)) then
        raise exception 'Extraction find % is not a material', v_key;
      end if;
      if v_qty <= 0 then raise exception 'Extraction find quantity must be positive'; end if;
      v_units := v_units + v_qty;
    end loop;
    for v_key, v_qty in
      select key, (value)::bigint
        from jsonb_each_text(coalesce(v_pass -> 'finds_essences', '{}'::jsonb))
    loop
      if not (v_key = any (v_essence_ids)) then
        raise exception 'Extraction find % is not an essence', v_key;
      end if;
      if v_qty <= 0 then raise exception 'Extraction find quantity must be positive'; end if;
      v_units := v_units + v_qty;
    end loop;
    if v_units > 2 * v_draws then
      raise exception 'Extraction pass % finds exceed the per-pass unit bound', v_index;
    end if;

    -- XP priced here, sequentially, from the level sequence.
    v_xp := round(public.cc_extract_pass_xp(v_level, v_rate) * (1 + v_rank_fraction))::bigint;
    v_next := public.cc_apply_xp(v_level, v_level_xp, v_xp);
    v_level := (v_next ->> 'player_level')::integer;
    v_level_xp := (v_next ->> 'player_xp')::bigint;
    v_total_xp := v_total_xp + v_xp;

    for v_key, v_qty in
      select key, (value)::bigint
        from jsonb_each_text(coalesce(v_pass -> 'finds_materials', '{}'::jsonb))
    loop
      p.materials := public.cc_jsonb_add_int(p.materials, v_key, v_qty::integer);
      v_materials := public.cc_jsonb_add_int(v_materials, v_key, v_qty::integer);
    end loop;
    for v_key, v_qty in
      select key, (value)::bigint
        from jsonb_each_text(coalesce(v_pass -> 'finds_essences', '{}'::jsonb))
    loop
      p.essences := public.cc_jsonb_add_int(p.essences, v_key, v_qty::integer);
      v_essences := public.cc_jsonb_add_int(v_essences, v_key, v_qty::integer);
    end loop;

    perform public.cc_add_mastery_xp(actor, 'gathering.extraction', 20);
    perform public.cc_add_stat(actor, 'extraction_passes', 1);

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'index', v_index,
      'area_id', v_pass ->> 'area_id',
      'method', v_pass ->> 'method',
      'draws', v_draws,
      'gear_factor', coalesce((v_pass ->> 'gear_factor')::numeric, 0),
      'deep_degraded', coalesce((v_pass ->> 'deep_degraded')::boolean, false),
      'xp', v_xp,
      'finds_materials', coalesce(v_pass -> 'finds_materials', '{}'::jsonb),
      'finds_essences', coalesce(v_pass -> 'finds_essences', '{}'::jsonb),
      'signature_units', coalesce((v_pass ->> 'signature_units')::integer, 0)
    ));
  end loop;

  update public.extraction_state
     set pending_passes = (
           select coalesce(jsonb_agg(elem order by ord), '[]'::jsonb)
             from jsonb_array_elements(v_pending) with ordinality as t(elem, ord)
            where ord > jsonb_array_length(p_passes)
         ),
         finalized_passes = s.finalized_passes + jsonb_array_length(p_passes),
         total_xp_awarded = s.total_xp_awarded + v_total_xp,
         updated_at = now()
   where user_id = actor;

  update public.profiles
     set player_level = v_level,
         player_xp = v_level_xp,
         materials = p.materials,
         essences = p.essences,
         updated_at = now()
   where id = actor;

  result := jsonb_build_object(
    'settled', true,
    'passes_completed', jsonb_array_length(p_passes),
    'xp_awarded', v_total_xp,
    'mastery_xp', 20 * jsonb_array_length(p_passes),
    'finds_materials', v_materials,
    'finds_essences', v_essences,
    'passes', v_results,
    'player_level', v_level,
    'player_xp', v_level_xp
  );

  insert into public.verified_action_ledger(user_id, action_type, idempotency_key, result_payload)
  values (actor, 'cc_apply_extraction', p_nonce, result);

  return result;
end;
$$;
-- ---------------------------------------------------------------------------
-- 7. cc_set_active_action restated (0028 body + 'extraction' +
--    the accrual hook + start gates/selection sync) and
--    cc_clear_active_action restated (0025 body + the hook).
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
    'market_listing',
    'endless_run',
    'extraction'
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

  -- Repair settler hook (0025): board jobs settle on transitions too.
  perform public.cc_settle_repair_jobs_for(actor);

  -- Extraction settler hook (0033): the outgoing action accrues
  -- its extraction time before the switch. Rolls finalize later,
  -- when the passes are settled at a read/claim (cc_apply_extraction
  -- via the Chef) — time accounting is all that happens here.
  perform public.cc_settle_extraction_time(actor);

  -- Extraction start gates + selection sync (0033): an incoming
  -- 'extraction' set claims the site. Every gate reads server
  -- records only (verified account, no standing death record,
  -- a real + unlocked area, Deep Delve mastery) — client claims
  -- about any of them are never consulted. The standing selection
  -- syncs here so the row the settler reads always names the site
  -- the player chose; the in-progress pass keeps its own terms.
  if normalized_kind = 'extraction' then
    if not public.can_use_player_economy(actor) then
      raise exception 'Verified account required';
    end if;
    if exists (
      select 1 from public.profiles p
      where p.id = actor and coalesce(p.death_state, '{}'::jsonb) <> '{}'::jsonb
    ) then
      raise exception 'Character is dead — resurrect before extracting';
    end if;
    if nullif(target_id, '') is null or not exists (
      select 1 from public.roaming_areas ra where ra.id = target_id
    ) then
      raise exception 'Unknown extraction area';
    end if;
    if (select coalesce(ra.unlock_level, 1) from public.roaming_areas ra where ra.id = target_id)
       > (select coalesce(p.player_level, 1) from public.profiles p where p.id = actor) then
      raise exception 'Area locked for this hunter level';
    end if;
    if coalesce(nullif(activity_payload ->> 'method', ''), 'surface') not in ('surface', 'deep') then
      raise exception 'Unsupported extraction method';
    end if;
    if coalesce(nullif(activity_payload ->> 'method', ''), 'surface') = 'deep'
       and public.cc_player_mastery_level(actor, 'gathering.extraction') < 5 then
      raise exception 'Deep Delve requires Extraction mastery 5';
    end if;
    insert into public.extraction_state (user_id, area_id, method, last_settled_at)
    values (actor, target_id, coalesce(nullif(activity_payload ->> 'method', ''), 'surface'), now())
    on conflict (user_id) do update set
      area_id = excluded.area_id,
      method = excluded.method,
      updated_at = now();
  end if;

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
