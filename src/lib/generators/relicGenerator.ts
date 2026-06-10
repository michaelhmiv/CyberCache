import { Rarity, Manufacturer, DropSource } from '../../types/game';
import { Relic, Affix } from '../../types/items';
import { RARITIES } from '../../constants/rarities';
import { createRNG, seededInt, seededRandom, pickWeighted, hashString } from '../utils/rng';
import { generateItemId } from '../utils/id';
import {
  generateActivityModule,
  pickActivityKind,
} from '../generators/activityModuleGenerator';
import { BASE_ACTIVITY_MODULE_CHANCE } from '../../content/activityModuleDefs';

const RELIC_MANUFACTURERS: Manufacturer[] = [
  Manufacturer.Prismatek,
  Manufacturer.HelixWorks,
  Manufacturer.ThrowTech,
  Manufacturer.Ironwood,
  Manufacturer.Redline,
  Manufacturer.BlastForge,
];

export function generateRelic(level: number = 1, externalRng?: () => number): Relic {
  const rng = externalRng ?? createRNG(hashString(`relic_${level}_${Date.now()}_${Math.random()}`));

  const rarityKeys = Object.values(Rarity);
  const weights = rarityKeys.map((r) => RARITIES[r].dropWeight);
  const rarity = pickWeighted(rarityKeys, weights, rng);
  const rarityDef = RARITIES[rarity];

  // Relics pick a manufacturer for activity module flavor only (not displayed in name)
  const relicMfg = RELIC_MANUFACTURERS[seededInt(0, RELIC_MANUFACTURERS.length - 1, rng)];

  const affixCount = seededInt(Math.max(rarityDef.affixCount.min, 2), Math.max(rarityDef.affixCount.max, 4), rng);
  const affixes: Affix[] = [];
  const relicAffixPool: Array<{ stat: string; text: string; min: number; max: number; category: Affix['category'] }> = [
    { stat: 'offlineEarningsMod', text: '+{v}% Offline Earnings', min: 8, max: 20, category: 'idle' },
    { stat: 'rareDropChanceMod', text: '+{v}% Rare Drop Chance', min: 5, max: 15, category: 'idle' },
    { stat: 'scrapYieldMod', text: '+{v}% Scrap Yield', min: 8, max: 25, category: 'idle' },
    { stat: 'xpBoostMod', text: '+{v}% XP Gain', min: 5, max: 20, category: 'idle' },
    { stat: 'cacheKeyChanceMod', text: '+{v}% Cache Key Drop Rate', min: 5, max: 15, category: 'idle' },
    { stat: 'bossDamageMod', text: '+{v}% Boss Damage', min: 5, max: 12, category: 'boss' },
    { stat: 'survivalBoost', text: '+{v}% Survival', min: 5, max: 15, category: 'boss' },
    { stat: 'consumableEfficiency', text: '+{v}% Consumable Efficiency', min: 5, max: 20, category: 'skill' },
  ];
  for (let i = 0; i < affixCount; i++) {
    const def = relicAffixPool[seededInt(0, relicAffixPool.length - 1, rng)];
    const rollVal = seededInt(def.min, def.max, rng);
    affixes.push({
      id: `${def.stat}_${i}`,
      category: def.category,
      stat: def.stat,
      value: rollVal / 100,
      displayText: def.text.replace('{v}', String(rollVal)),
    });
  }

  // Roll activity module (relics are activity-heavy — higher base chance)
  const relicActivityChance = BASE_ACTIVITY_MODULE_CHANCE + 0.10
    + (rarity === Rarity.Uncommon ? 0.05 : rarity === Rarity.Rare ? 0.15 : rarity === Rarity.Epic ? 0.25 : rarity === Rarity.Legendary ? 0.35 : 0);
  if (seededRandom(0, 1, rng) < relicActivityChance) {
    const activityKind = pickActivityKind('relic', rng);
    if (activityKind) {
      const module = generateActivityModule({
        itemLevel: level,
        itemRarity: rarity,
        manufacturer: relicMfg,
        slot: 'relic',
        activityKind,
        rng,
      });
      if (module) {
        affixes.push(module);
      }
    }
  }

  const relicNames = [
    'Vault Chip', 'Data Shard', 'Neural Key', 'Cache Relic',
    'Echo Stone', 'Void Prism', 'Circuit Totem', 'Ancient Module',
    'Scrap Core', 'Glitched Token', 'Ethereal Drive', 'Quantum Fragment',
  ];
  const name = relicNames[seededInt(0, relicNames.length - 1, rng)];

  return {
    id: generateItemId(),
    name,
    level,
    rarity,
    affixes,
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}
