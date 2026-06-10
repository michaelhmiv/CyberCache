import { Rarity, DropSource } from '../../types/game';
import { Relic, Affix } from '../../types/items';
import { RARITIES } from '../../constants/rarities';
import { createRNG, seededInt, pickWeighted, hashString } from '../utils/rng';
import { generateItemId } from '../utils/id';

export function generateRelic(level: number = 1, externalRng?: () => number): Relic {
  const rng = externalRng ?? createRNG(hashString(`relic_${level}_${Date.now()}_${Math.random()}`));

  const rarityKeys = Object.values(Rarity);
  const weights = rarityKeys.map((r) => RARITIES[r].dropWeight);
  const rarity = pickWeighted(rarityKeys, weights, rng);
  const rarityDef = RARITIES[rarity];

  const affixCount = seededInt(Math.max(rarityDef.affixCount.min, 2), Math.max(rarityDef.affixCount.max, 4), rng);
  const affixes: Affix[] = [];
  const relicAffixPool = [
    { stat: 'offlineEarningsMod', text: '+{v}% Offline Earnings', min: 8, max: 20, category: 'idle' as const },
    { stat: 'rareDropChanceMod', text: '+{v}% Rare Drop Chance', min: 5, max: 15, category: 'idle' as const },
    { stat: 'scrapYieldMod', text: '+{v}% Scrap Yield', min: 8, max: 25, category: 'idle' as const },
    { stat: 'xpBoostMod', text: '+{v}% XP Gain', min: 5, max: 20, category: 'idle' as const },
    { stat: 'cacheKeyChanceMod', text: '+{v}% Cache Key Drop Rate', min: 5, max: 15, category: 'idle' as const },
    { stat: 'bossDamageMod', text: '+{v}% Boss Damage', min: 5, max: 12, category: 'boss' as const },
    { stat: 'survivalBoost', text: '+{v}% Survival', min: 5, max: 15, category: 'boss' as const },
    { stat: 'consumableEfficiency', text: '+{v}% Consumable Efficiency', min: 5, max: 20, category: 'skill' as const },
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
