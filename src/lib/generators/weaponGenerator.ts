import {
  Element,
  Rarity,
  WeaponType,
  Manufacturer,
  DropSource,
} from '../../types/game';
import { Weapon, WeaponPart, Affix } from '../../types/items';
import { WEAPON_TYPES } from '../../constants/weaponTypes';
import { RARITIES, rollQualityLabel } from '../../constants/rarities';
import { MANUFACTURERS } from '../../constants/manufacturers';
import { ELEMENTS } from '../../constants/elements';
import { getEligibleLegendaryEffects } from '../../constants/legendaryEffects';
import { createRNG, seededRandom, seededInt, pickWeighted, hashString } from '../utils/rng';
import { generateItemId } from '../utils/id';
import { generateWeaponName } from '../utils/naming';

export interface GenerateWeaponOptions {
  source: DropSource;
  level?: number;
  forcedType?: WeaponType;
  forcedRarity?: Rarity;
  forcedElement?: Element;
  forcedManufacturer?: Manufacturer;
  luckBonus?: number; // 0-1 flat increase to rarity roll
  bossTier?: number;
}

export function generateWeapon(options: GenerateWeaponOptions): Weapon {
  const {
    source,
    level = 1,
    forcedType,
    forcedRarity,
    forcedElement,
    forcedManufacturer,
    luckBonus = 0,
    bossTier,
  } = options;

  // Seed based on item identity components for deterministic art/name
  const seedBase = `${source}_${level}_${Date.now()}_${Math.random()}`;
  const seed = hashString(seedBase);
  const rng = createRNG(seed);

  // 3. Roll rarity
  const rarityWeights = Object.values(RARITIES).map((r) =>
    source === 'Cache-Forged' && r.id === Rarity.Legendary
      ? r.dropWeight * 1.5
      : r.dropWeight
  );
  const rarity = forcedRarity || (pickWeighted(Object.values(RARITIES), rarityWeights, rng).id as Rarity);
  const rarityDef = RARITIES[rarity];

  // 4. Weapon type
  const typeKeys = Object.values(WeaponType);
  const typeWeights = typeKeys.map(() => 1);
  const weaponType = forcedType || pickWeighted(typeKeys, typeWeights, rng);
  const typeDef = WEAPON_TYPES[weaponType];

  // 5. Manufacturer
  const mfgKeys = Object.values(Manufacturer);
  const mfgWeights = mfgKeys.map(() => 1);
  const manufacturer = forcedManufacturer || pickWeighted(mfgKeys, mfgWeights, rng);
  const mfgDef = MANUFACTURERS[manufacturer];

  // 6. Element
  const elemKeys = Object.values(Element);
  const elemWeights = elemKeys.map((e) => {
    let w = 1;
    // Manufacturer bias
    if (mfgDef.id === Manufacturer.Prismatek && e !== Element.Kinetic) w = 1.8;
    if (mfgDef.id === Manufacturer.BlastForge && e === Element.Fire) w = 1.4;
    return w;
  });
  const element = forcedElement || pickWeighted(elemKeys, elemWeights, rng);

  // 7. Base stats from type & level
  const levelScalar = 1 + (level - 1) * 0.08;
  const rarityScalar = rarity === 'Common' ? 1 : rarity === 'Uncommon' ? 1.1 : rarity === 'Rare' ? 1.25 : rarity === 'Epic' ? 1.45 : 1.7;

  let stats = {
    baseDamage: Math.round(typeDef.baseStats.baseDamage * levelScalar * rarityScalar),
    attackSpeed: parseFloat((typeDef.baseStats.attackSpeed * levelScalar * 0.98).toFixed(2)),
    critChance: parseFloat((typeDef.baseStats.critChance * levelScalar * 0.95).toFixed(3)),
    critDamage: parseFloat((typeDef.baseStats.critDamage * levelScalar * 0.97).toFixed(2)),
    statusChance: parseFloat((typeDef.baseStats.statusChance * levelScalar).toFixed(3)),
    statusDamage: parseFloat((typeDef.baseStats.statusDamage * levelScalar * 0.96).toFixed(2)),
    bossDamageMod: typeDef.baseStats.bossDamageMod,
    waveDamageMod: typeDef.baseStats.waveDamageMod,
    shieldDamageMod: typeDef.baseStats.shieldDamageMod,
    armorDamageMod: typeDef.baseStats.armorDamageMod,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
  };

  // 8. Apply manufacturer behavior
  if (mfgDef.baseStatBias) {
    for (const [key, mult] of Object.entries(mfgDef.baseStatBias)) {
      const k = key as keyof typeof stats;
      if (stats[k] !== undefined) {
        (stats as any)[k] = parseFloat((stats[k] * mult).toFixed(3));
      }
    }
  }

  // Redline mechanic: ramping damage baked into stat variance
  if (mfgDef.id === Manufacturer.Redline) {
    stats.baseDamage = Math.round(stats.baseDamage * 1.08);
  }
  // HelixWorks mechanic: improved roll quality floor
  const helixBonus = mfgDef.id === Manufacturer.HelixWorks ? 10 : 0;

  // 9. Generate parts (6 slots)
  const partSlots: WeaponPart['slot'][] = ['Barrel', 'Grip', 'Core', 'Magazine', 'Sight', 'Chamber'];
  const parts: WeaponPart[] = partSlots.map((slot) => {
    const modKey = seededInt(0, 5, rng);
    const modKeys: (keyof typeof stats)[] = ['baseDamage', 'attackSpeed', 'critChance', 'critDamage', 'statusChance', 'bossDamageMod'];
    const chosenStat = modKeys[modKey];
    const val = parseFloat((1 + seededRandom(-0.08, 0.12, rng)).toFixed(3));
    return {
      slot,
      modifier: { [chosenStat]: val } as Partial<typeof stats>,
    };
  });

  // Apply parts
  parts.forEach((part) => {
    for (const [k, v] of Object.entries(part.modifier)) {
      const key = k as keyof typeof stats;
      if (typeof stats[key] === 'number') {
        (stats as any)[key] = parseFloat(((stats[key] as number) * (v as number)).toFixed(3));
      }
    }
  });

  // 10. Roll affixes
  const affixCount = seededInt(rarityDef.affixCount.min, rarityDef.affixCount.max, rng);
  const affixes: Affix[] = [];
  const combatAffixPool = [
    { stat: 'baseDamage', text: '+{v}% Damage', min: 3, max: 12 },
    { stat: 'critChance', text: '+{v}% Crit Chance', min: 2, max: 8 },
    { stat: 'critDamage', text: '+{v}% Crit Damage', min: 5, max: 20 },
    { stat: 'attackSpeed', text: '+{v}% Attack Speed', min: 3, max: 10 },
    { stat: 'bossDamageMod', text: '+{v}% Boss Damage', min: 5, max: 15 },
    { stat: 'waveDamageMod', text: '+{v}% Wave Damage', min: 5, max: 15 },
  ];
  const bossAffixPool = [
    { stat: 'shieldDamageMod', text: '+{v}% Shield Break', min: 8, max: 20 },
    { stat: 'armorDamageMod', text: '+{v}% Armor Break', min: 8, max: 20 },
  ];
  const idleAffixPool = [
    { stat: 'offlineEarningsMod', text: '+{v}% Offline Earnings', min: 5, max: 15 },
    { stat: 'rareDropChanceMod', text: '+{v}% Rare Drop Chance', min: 3, max: 10 },
    { stat: 'scrapYieldMod', text: '+{v}% Scrap Yield', min: 5, max: 20 },
  ];

  for (let i = 0; i < affixCount; i++) {
    const pool = seededRandom(0, 1, rng) > 0.7 ? (seededRandom(0, 1, rng) > 0.5 ? bossAffixPool : idleAffixPool) : combatAffixPool;
    const def = pool[seededInt(0, pool.length - 1, rng)];
    const rollVal = seededInt(def.min, def.max, rng);
    affixes.push({
      id: `${def.stat}_${i}`,
      category: pool === combatAffixPool ? 'combat' : pool === bossAffixPool ? 'boss' : 'idle',
      stat: def.stat,
      value: rollVal / 100,
      displayText: def.text.replace('{v}', String(rollVal)),
    });
  }

  // 12. Roll quality 0-100
  let rollQuality = seededInt(0 + rarityDef.rollQualityBias + helixBonus, 100, rng);
  rollQuality = Math.min(100, rollQuality);

  // 11. Legendary effect
  let legendaryEffectId: string | undefined;
  if (rarity === Rarity.Legendary) {
    const eligible = getEligibleLegendaryEffects(source, bossTier);
    if (eligible.length > 0) {
      const eff = eligible[seededInt(0, eligible.length - 1, rng)];
      legendaryEffectId = eff.id;
    }
  }

  // 13. Source tag already set
  // 14. Calculate effective power
  const combatPower = Math.round(
    stats.baseDamage * stats.attackSpeed * (1 + stats.critChance * (stats.critDamage - 1)) * (1 + stats.statusChance * 0.5)
  );
  const bossPower = Math.round(combatPower * (1 + stats.bossDamageMod) * (1 + stats.shieldDamageMod * 0.3) * (1 + stats.armorDamageMod * 0.3));
  const farmPower = Math.round(combatPower * (1 + stats.waveDamageMod) * (1 + stats.attackSpeed * 0.2));
  const economyScore = Math.round((stats.rareDropChanceMod + stats.scrapYieldMod + stats.offlineEarningsMod) * 100);

  // 15. Name
  const name = generateWeaponName(weaponType, manufacturer, element, rng);

  return {
    id: generateItemId(),
    name,
    level,
    rarity,
    weaponType,
    manufacturer,
    element,
    rollQuality,
    ...stats,
    parts,
    affixes,
    legendaryEffectId,
    sourceTag: source,
    isLocked: false,
    pixelSeed: seed,
    combatPower,
    bossPower,
    farmPower,
    economyScore,
  };
}
