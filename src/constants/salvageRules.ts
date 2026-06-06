import { Element, Rarity } from '../types/game';
import { GearItem, Weapon } from '../types/items';

export interface SalvageYield {
  scrapAlloy: number;
  ballisticParts: number;
  reactiveComponents: number;
  techFragments: number;
  voidDust: number;
  essences: Record<string, number>;
}

const RARITY_MULTIPLIERS: Record<string, number> = {
  Common: 1.0,
  Uncommon: 1.5,
  Rare: 2.5,
  Epic: 4.0,
  Legendary: 8.0,
};

const ELEMENT_TO_ESSENCE: Record<string, string> = {
  Fire: 'IgnitionFluid',
  Shock: 'ConduitWire',
  Corrosive: 'AcidCompound',
  Cryo: 'CryoGel',
  Void: 'VoidEssence',
};

export function calculateSalvageYield(item: GearItem): SalvageYield {
  const rarityMult = RARITY_MULTIPLIERS[item.rarity] || 1.0;
  const level = item.level || 1;
  const rollQuality = (item as any).rollQuality || 50;
  const qualityMultiplier = 0.5 + rollQuality / 100;

  // 1. Scrap Alloy (all gear)
  let scrapAlloy = Math.floor((level * 5 + 10) * rarityMult * qualityMultiplier);
  scrapAlloy = Math.max(5, scrapAlloy);

  // 2. Type-specific materials
  let ballisticParts = 0;
  let reactiveComponents = 0;
  let techFragments = 0;

  if ('weaponType' in item) {
    // Weapon
    ballisticParts = Math.round((level / 3 + 1) * rarityMult * 0.6);
    // Part bonus
    const parts = (item as Weapon).parts;
    if (parts && parts.length > 0) {
      scrapAlloy += parts.length * Math.floor(level / 5);
    }
  } else if ('hp' in item && !('weaponType' in item)) {
    // Shield
    reactiveComponents = Math.round((level / 3 + 1) * rarityMult * 0.6);
  } else if ('damage' in item && 'effect' in item) {
    // Ordnance
    reactiveComponents = Math.round((level / 3 + 1) * rarityMult * 0.6);
  } else if ('treeBonus' in item) {
    // ClassMod
    techFragments = Math.round((level / 4 + 1) * rarityMult * 0.5);
  } else if ('affixes' in item && !('weaponType' in item) && !('hp' in item) && !('treeBonus' in item) && !('damage' in item)) {
    // Relic
    techFragments = Math.round((level / 4 + 1) * rarityMult * 0.5);
  }

  // 3. Void Dust (Epic+)
  let voidDust = 0;
  if (item.rarity === 'Epic' || item.rarity === 'Legendary') {
    voidDust = Math.ceil(rarityMult / 4);
    if (rollQuality > 80) {
      voidDust *= 2;
    }
  }

  // 4. Essences (elemental gear)
  const essences: Record<string, number> = {};
  const element = (item as any).element as Element;
  if (element && element !== Element.Kinetic && ELEMENT_TO_ESSENCE[element]) {
    const baseEssence = Math.ceil(rarityMult / 2);
    const bonus = rollQuality > 75 ? 1 : 0;
    const total = baseEssence + bonus;
    const essenceKey = ELEMENT_TO_ESSENCE[element];
    essences[essenceKey] = total;
  }

  return {
    scrapAlloy,
    ballisticParts,
    reactiveComponents,
    techFragments,
    voidDust,
    essences,
  };
}
