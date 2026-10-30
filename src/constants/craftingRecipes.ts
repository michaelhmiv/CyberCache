import { CraftingRecipe } from '../types/workshop';

export const CRAFTING_RECIPES: CraftingRecipe[] = [
  // Survival
  { id: 'recipe_medkit', consumableType: 'MedKit', name: 'Med Kit', category: 'survival', materials: { ScrapAlloy: 15, ReactiveComponents: 8 }, craftTimeMs: 12 * 60 * 1000, outputCount: 1, requiresLevel: 1 },
  { id: 'recipe_medkit_refined', consumableType: 'MedKitRefined', name: 'Med Kit (Refined)', category: 'survival', materials: { ScrapAlloy: 25, ReactiveComponents: 15, VoidDust: 1 }, craftTimeMs: 25 * 60 * 1000, outputCount: 1, requiresLevel: 10 },
  { id: 'recipe_shieldcell', consumableType: 'ShieldCell', name: 'Shield Cell', category: 'survival', materials: { ScrapAlloy: 20, ReactiveComponents: 12 }, craftTimeMs: 15 * 60 * 1000, outputCount: 1, requiresLevel: 3 },
  { id: 'recipe_nanoswarm', consumableType: 'NanoSwarm', name: 'Nano-Swarm', category: 'survival', materials: { ScrapAlloy: 30, ReactiveComponents: 20, VoidDust: 2 }, craftTimeMs: 40 * 60 * 1000, outputCount: 1, requiresLevel: 15 },
  { id: 'recipe_adrenaline', consumableType: 'AdrenalineShot', name: 'Adrenaline Shot', category: 'survival', materials: { ScrapAlloy: 40, ReactiveComponents: 25, VoidDust: 3 }, craftTimeMs: 60 * 60 * 1000, outputCount: 1, requiresLevel: 20 },

  // Offense — Ammo
  { id: 'recipe_ammo_pack', consumableType: 'AmmoPack', name: 'Ammo Pack', category: 'offense', materials: { ScrapAlloy: 10, BallisticParts: 6 }, craftTimeMs: 10 * 60 * 1000, outputCount: 1, requiresLevel: 1 },
  { id: 'recipe_high_capacity_ammo_pack', consumableType: 'HighCapacityAmmoPack', name: 'High-Capacity Ammo Pack', category: 'offense', materials: { ScrapAlloy: 18, BallisticParts: 12, TechFragments: 2 }, craftTimeMs: 18 * 60 * 1000, outputCount: 1, requiresLevel: 6 },
  { id: 'recipe_ap_ammo', consumableType: 'ArmorPiercingAmmo', name: 'Armor-Piercing Ammo', category: 'offense', materials: { ScrapAlloy: 15, BallisticParts: 10 }, craftTimeMs: 15 * 60 * 1000, outputCount: 1, requiresLevel: 5 },
  { id: 'recipe_fire_ammo', consumableType: 'IncendiaryAmmo', name: 'Incendiary Ammo', category: 'offense', materials: { ScrapAlloy: 15, BallisticParts: 8, IgnitionFluid: 3 }, craftTimeMs: 18 * 60 * 1000, outputCount: 1, requiresLevel: 8 },
  { id: 'recipe_shock_ammo', consumableType: 'ShockAmmo', name: 'Shock Ammo', category: 'offense', materials: { ScrapAlloy: 15, BallisticParts: 8, ConduitWire: 3 }, craftTimeMs: 18 * 60 * 1000, outputCount: 1, requiresLevel: 8 },
  { id: 'recipe_corrosive_ammo', consumableType: 'CorrosiveAmmo', name: 'Corrosive Ammo', category: 'offense', materials: { ScrapAlloy: 15, BallisticParts: 8, AcidCompound: 3 }, craftTimeMs: 18 * 60 * 1000, outputCount: 1, requiresLevel: 8 },
  { id: 'recipe_cryo_ammo', consumableType: 'CryoAmmo', name: 'Cryo Ammo', category: 'offense', materials: { ScrapAlloy: 15, BallisticParts: 8, CryoGel: 3 }, craftTimeMs: 18 * 60 * 1000, outputCount: 1, requiresLevel: 8 },
  { id: 'recipe_void_ammo', consumableType: 'VoidAmmo', name: 'Void Ammo', category: 'offense', materials: { ScrapAlloy: 20, BallisticParts: 10, VoidEssence: 5 }, craftTimeMs: 25 * 60 * 1000, outputCount: 1, requiresLevel: 15 },

  // Offense — Ordnance / Stim / Grenades
  { id: 'recipe_ordnance', consumableType: 'OrdnanceCharge', name: 'Ordnance Charge', category: 'offense', materials: { ScrapAlloy: 12, BallisticParts: 10 }, craftTimeMs: 12 * 60 * 1000, outputCount: 1, requiresLevel: 1 },
  { id: 'recipe_emp_charge', consumableType: 'EMPCharge', name: 'EMP Charge', category: 'offense', materials: { ScrapAlloy: 18, BallisticParts: 8, ConduitWire: 4, TechFragments: 2 }, craftTimeMs: 22 * 60 * 1000, outputCount: 1, requiresLevel: 9 },
  { id: 'recipe_corrosive_charge', consumableType: 'CorrosiveCharge', name: 'Corrosive Charge', category: 'offense', materials: { ScrapAlloy: 18, BallisticParts: 8, AcidCompound: 4, TechFragments: 2 }, craftTimeMs: 22 * 60 * 1000, outputCount: 1, requiresLevel: 9 },
  { id: 'recipe_overcharge', consumableType: 'OverchargeStim', name: 'Overcharge Stim', category: 'offense', materials: { ScrapAlloy: 25, BallisticParts: 15, VoidDust: 2 }, craftTimeMs: 30 * 60 * 1000, outputCount: 1, requiresLevel: 12 },
  { id: 'recipe_targetpainter', consumableType: 'TargetPainter', name: 'Target Painter', category: 'offense', materials: { ScrapAlloy: 20, BallisticParts: 10, TechFragments: 2 }, craftTimeMs: 20 * 60 * 1000, outputCount: 1, requiresLevel: 8 },
  { id: 'recipe_phaseshift', consumableType: 'PhaseShiftGrenade', name: 'Phase Shift Grenade', category: 'offense', materials: { ScrapAlloy: 30, BallisticParts: 15, VoidDust: 5 }, craftTimeMs: 35 * 60 * 1000, outputCount: 1, requiresLevel: 18 },

  // Utility / economy
  { id: 'recipe_luck', consumableType: 'LuckBooster', name: 'Luck Booster', category: 'utility', materials: { ScrapAlloy: 15, TechFragments: 8 }, craftTimeMs: 15 * 60 * 1000, outputCount: 1, requiresLevel: 5 },
  { id: 'recipe_scanner', consumableType: 'BossScanner', name: 'Boss Scanner', category: 'utility', materials: { ScrapAlloy: 20, TechFragments: 12 }, craftTimeMs: 20 * 60 * 1000, outputCount: 1, requiresLevel: 10 },
  { id: 'recipe_insurance', consumableType: 'InsuranceToken', name: 'Insurance Token', category: 'utility', materials: { ScrapAlloy: 30, TechFragments: 15, VoidDust: 2 }, craftTimeMs: 35 * 60 * 1000, outputCount: 1, requiresLevel: 15 },
  { id: 'recipe_dataskimmer', consumableType: 'DataSkimmer', name: 'Data Skimmer', category: 'utility', materials: { ScrapAlloy: 25, TechFragments: 15, VoidDust: 3 }, craftTimeMs: 40 * 60 * 1000, outputCount: 1, requiresLevel: 18 },
  { id: 'recipe_jammer', consumableType: 'Jammer', name: 'Jammer', category: 'utility', materials: { ScrapAlloy: 20, TechFragments: 10, ConduitWire: 2 }, craftTimeMs: 25 * 60 * 1000, outputCount: 1, requiresLevel: 12 },
  { id: 'recipe_magnetized', consumableType: 'MagnetizedPayload', name: 'Magnetized Payload', category: 'utility', materials: { ScrapAlloy: 15, BallisticParts: 10, TechFragments: 5 }, craftTimeMs: 22 * 60 * 1000, outputCount: 1, requiresLevel: 10 },
  { id: 'recipe_signal_scrambler', consumableType: 'SignalScrambler', name: 'Signal Scrambler', category: 'utility', materials: { ScrapAlloy: 15, TechFragments: 10, ConduitWire: 2 }, craftTimeMs: 20 * 60 * 1000, outputCount: 1, requiresLevel: 7 },
  { id: 'recipe_loot_beacon', consumableType: 'LootBeacon', name: 'Loot Beacon', category: 'utility', materials: { ScrapAlloy: 20, TechFragments: 14, VoidDust: 2 }, craftTimeMs: 30 * 60 * 1000, outputCount: 1, requiresLevel: 12 },
  { id: 'recipe_salvage_contract', consumableType: 'SalvageContract', name: 'Salvage Contract', category: 'utility', materials: { ScrapAlloy: 12, TechFragments: 8 }, craftTimeMs: 16 * 60 * 1000, outputCount: 1, requiresLevel: 5 },
  { id: 'recipe_workshop_rush_ticket', consumableType: 'WorkshopRushTicket', name: 'Workshop Rush Ticket', category: 'utility', materials: { ScrapAlloy: 18, TechFragments: 12, VoidDust: 1 }, craftTimeMs: 24 * 60 * 1000, outputCount: 1, requiresLevel: 10 },
];

export function getRecipeById(id: string): CraftingRecipe | undefined {
  return CRAFTING_RECIPES.find((r) => r.id === id);
}

export function getRecipesByCategory(category: string): CraftingRecipe[] {
  return CRAFTING_RECIPES.filter((r) => r.category === category);
}

/** Every recipe that consumes the given material or essence id. */
export function getRecipesUsingMaterial(materialId: string): CraftingRecipe[] {
  return CRAFTING_RECIPES.filter((r) => (r.materials[materialId] ?? 0) > 0);
}
