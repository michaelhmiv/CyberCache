import { Element, Rarity, DropSource } from '../../types/game';
import { Ordnance, Affix } from '../../types/items';
import { RARITIES } from '../../constants/rarities';
import { ELEMENTS } from '../../constants/elements';
import { createRNG, seededRandom, seededInt, pickWeighted, hashString } from '../utils/rng';
import { generateItemId } from '../utils/id';

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

export function generateOrdnance(level: number = 1): Ordnance {
  const seed = hashString(`ordnance_${level}_${Date.now()}_${Math.random()}`);
  const rng = createRNG(seed);

  const rarityKeys = Object.values(Rarity);
  const weights = rarityKeys.map((r) => RARITIES[r].dropWeight);
  const rarity = pickWeighted(rarityKeys, weights, rng);
  const rarityDef = RARITIES[rarity];

  const elemKeys = Object.values(Element);
  const element = pickWeighted(elemKeys, [1, 1, 1, 1, 1, 1], rng);

  const rarityDmgMult = rarity === 'Common' ? 1 : rarity === 'Uncommon' ? 1.2 : rarity === 'Rare' ? 1.5 : rarity === 'Epic' ? 1.8 : 2.2;
  const baseDamage = Math.round((80 + level * 15) * rarityDmgMult * seededRandom(0.9, 1.1, rng));
  const shieldDamage = Math.round(baseDamage * seededRandom(0.6, 1.4, rng));
  const armorDamage = Math.round(baseDamage * seededRandom(0.6, 1.4, rng));
  const effect = ORDNANCE_EFFECTS[seededInt(0, ORDNANCE_EFFECTS.length - 1, rng)];

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
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}
