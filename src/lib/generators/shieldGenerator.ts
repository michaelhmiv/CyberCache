import { Element, Rarity, DropSource } from '../../types/game';
import { Shield, Affix } from '../../types/items';
import { RARITIES } from '../../constants/rarities';
import { ELEMENTS } from '../../constants/elements';
import { createRNG, seededRandom, seededInt, pickWeighted, hashString } from '../utils/rng';
import { generateItemId } from '../utils/id';

export function generateShield(level: number = 1, externalRng?: () => number): Shield {
  const seedBase = `shield_${level}_${Date.now()}_${Math.random()}`;
  const pixelSeed = hashString(seedBase);
  const rng = externalRng ?? createRNG(pixelSeed);

  const rarityKeys = Object.values(Rarity);
  const weights = rarityKeys.map((r) => RARITIES[r].dropWeight);
  const rarity = pickWeighted(rarityKeys, weights, rng);
  const rarityDef = RARITIES[rarity];

  const elemKeys = Object.values(Element);
  const element = pickWeighted(elemKeys, [1, 1, 1, 1, 1, 1], rng);

  const baseHp = 150 + level * 30;
  const rarityHpMult = rarity === 'Common' ? 1 : rarity === 'Uncommon' ? 1.2 : rarity === 'Rare' ? 1.5 : rarity === 'Epic' ? 1.8 : 2.2;
  let hp = Math.round(baseHp * rarityHpMult * seededRandom(0.9, 1.1, rng));
  let rechargeRate = parseFloat((10 + level * 1.5).toFixed(1));
  let mitigation = parseFloat((0.05 + rarityDef.rollQualityBias * 0.002).toFixed(3));

  const affixCount = seededInt(rarityDef.affixCount.min, rarityDef.affixCount.max, rng);
  const affixes: Affix[] = [];
  const shieldAffixPool = [
    { stat: 'hp', text: '+{v}% Shield HP', min: 5, max: 15 },
    { stat: 'rechargeRate', text: '+{v}% Recharge Rate', min: 5, max: 15 },
    { stat: 'mitigation', text: '+{v}% Mitigation', min: 3, max: 10 },
  ];
  for (let i = 0; i < affixCount; i++) {
    const def = shieldAffixPool[seededInt(0, shieldAffixPool.length - 1, rng)];
    const rollVal = seededInt(def.min, def.max, rng);
    affixes.push({
      id: `${def.stat}_${i}`,
      category: 'combat',
      stat: def.stat,
      value: rollVal / 100,
      displayText: def.text.replace('{v}', String(rollVal)),
    });
  }

  // Bake affixes into stats so they are NOT purely cosmetic.
  // hp and rechargeRate are multiplicative; mitigation is additive.
  for (const affix of affixes) {
    const v = affix.value;
    switch (affix.stat) {
      case 'hp':
        hp = Math.round(hp * (1 + v));
        break;
      case 'rechargeRate':
        rechargeRate = parseFloat((rechargeRate * (1 + v)).toFixed(1));
        break;
      case 'mitigation':
        mitigation = parseFloat((mitigation + v).toFixed(3));
        break;
      default:
        break;
    }
  }

  const elementName = ELEMENTS[element].name;
  const manufacturerNames = ['Ironwood', 'HelixWorks', 'Prismatek', 'ThrowTech', 'Redline'];
  const manufacturer = manufacturerNames[seededInt(0, manufacturerNames.length - 1, rng)];
  const name = `${elementName} ${manufacturer} Shield Mk.${seededInt(1, 5, rng)}`;

  return {
    id: generateItemId(),
    name,
    level,
    rarity,
    hp,
    rechargeRate,
    mitigation,
    element,
    affixes,
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed,
  };
}
