import { Element, Rarity, Manufacturer, DropSource } from '@/types/game';
import { Ordnance, Affix } from '@/types/items';
import { RARITIES } from '@/constants/rarities';
import { ELEMENTS } from '@/constants/elements';
import { createRNG, seededRandom, seededInt, pickWeighted, hashString } from '@/lib/utils/rng';
import { generateItemId } from '@/lib/utils/id';
import {
  generateActivityModule,
  pickActivityKind,
} from './activityModuleGenerator';
import { BASE_ACTIVITY_MODULE_CHANCE } from '@/content/activityModuleDefs';

const ORDNANCE_EFFECTS = [
  'Fragmentation: +15% area damage',
  'EMP Payload: +25% shield break',
  'Acid Burst: Corrosive DoT for 6s',
  'Cryo Shell: Slows boss by 20% for 8s',
  'Incendiary: Fire DoT for 5s',
  'Cluster: Splits into 3 bomblets',
  'Seeker: Homes on weakpoints (+15% crit)',
  'Shockwave: +40% stagger chance',
  'Void Tap: 10% chance to refund charge',
  'Kinetic Slam: +30% armor break',
];

const ORDNANCE_MANUFACTURERS: Manufacturer[] = [
  Manufacturer.BlastForge,
  Manufacturer.ThrowTech,
  Manufacturer.Redline,
  Manufacturer.Ironwood,
  Manufacturer.Prismatek,
  Manufacturer.HelixWorks,
];

const ORDNANCE_COMBAT_POOL = [
  { stat: 'damage', text: '+{v}% Ordnance Damage', min: 5, max: 15 },
  { stat: 'shieldDamage', text: '+{v}% Shield Break', min: 8, max: 20 },
  { stat: 'armorDamage', text: '+{v}% Armor Break', min: 8, max: 20 },
];

export function generateOrdnance(level: number = 1, externalRng?: () => number, rarityWeights?: Partial<Record<Rarity, number>>): Ordnance {
  const seedBase = `ordnance_${level}_${Date.now()}_${Math.random()}`;
  const pixelSeed = hashString(seedBase);
  const rng = externalRng ?? createRNG(pixelSeed);

  const rarityKeys = Object.values(Rarity);
  const weights = rarityKeys.map((r) => rarityWeights?.[r] ?? RARITIES[r].dropWeight);
  const rarity = pickWeighted(rarityKeys, weights, rng);
  const rarityDef = RARITIES[rarity];

  const elemKeys = Object.values(Element);
  const element = pickWeighted(elemKeys, [1, 1, 1, 1, 1, 1], rng);

  // Pick a manufacturer for activity module purposes
  const ordnanceMfg = ORDNANCE_MANUFACTURERS[seededInt(0, ORDNANCE_MANUFACTURERS.length - 1, rng)];

  const rarityDmgMult = rarity === 'Common' ? 1 : rarity === 'Uncommon' ? 1.2 : rarity === 'Rare' ? 1.5 : rarity === 'Epic' ? 1.8 : 2.2;
  let baseDamage = Math.round((80 + level * 15) * rarityDmgMult * seededRandom(0.9, 1.1, rng));
  let shieldDamage = Math.round(baseDamage * seededRandom(0.6, 1.4, rng));
  let armorDamage = Math.round(baseDamage * seededRandom(0.6, 1.4, rng));
  const effect = ORDNANCE_EFFECTS[seededInt(0, ORDNANCE_EFFECTS.length - 1, rng)];

  // Roll combat affixes
  const affixCount = seededInt(rarityDef.affixCount.min, rarityDef.affixCount.max, rng);
  const affixes: Affix[] = [];
  for (let i = 0; i < affixCount; i++) {
    const def = ORDNANCE_COMBAT_POOL[seededInt(0, ORDNANCE_COMBAT_POOL.length - 1, rng)];
    const rollVal = seededInt(def.min, def.max, rng);
    affixes.push({
      id: `${def.stat}_${i}`,
      category: 'combat',
      stat: def.stat,
      value: rollVal / 100,
      displayText: def.text.replace('{v}', String(rollVal)),
    });
  }

  // Bake combat affixes into stats
  for (const affix of affixes) {
    const v = affix.value;
    switch (affix.stat) {
      case 'damage':
        baseDamage = Math.round(baseDamage * (1 + v));
        break;
      case 'shieldDamage':
        shieldDamage = Math.round(shieldDamage * (1 + v));
        break;
      case 'armorDamage':
        armorDamage = Math.round(armorDamage * (1 + v));
        break;
      default:
        break;
    }
  }

  // Roll activity module (ordnance favors salvaging/workshop)
  const activityChance = BASE_ACTIVITY_MODULE_CHANCE
    + (rarity === Rarity.Uncommon ? 0.05 : rarity === Rarity.Rare ? 0.15 : rarity === Rarity.Epic ? 0.25 : rarity === Rarity.Legendary ? 0.35 : 0);
  if (seededRandom(0, 1, rng) < activityChance) {
    const activityKind = pickActivityKind('ordnance', rng);
    if (activityKind) {
      const module = generateActivityModule({
        itemLevel: level,
        itemRarity: rarity,
        manufacturer: ordnanceMfg,
        slot: 'ordnance',
        activityKind,
        rng,
      });
      if (module) {
        affixes.push(module);
      }
    }
  }

  const typeNames = ['Grenade', 'Charge', 'Payload', 'Canister', 'Deployable'];
  const typeName = typeNames[seededInt(0, typeNames.length - 1, rng)];
  const elementName = ELEMENTS[element].name;
  const name = `${elementName} ${typeName}`;

  return {
    id: generateItemId(),
    name,
    level,
    rarity,
    damage: baseDamage,
    shieldDamage,
    armorDamage,
    element,
    effect,
    affixes,
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed,
  };
}
