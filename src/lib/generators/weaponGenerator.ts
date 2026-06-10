import {
  Element,
  Rarity,
  WeaponType,
  Manufacturer,
  DropSource,
} from '../../types/game';
import { Weapon, WeaponPart, Affix } from '../../types/items';
import { WEAPON_TYPES } from '../../constants/weaponTypes';
import { RARITIES } from '../../constants/rarities';
import { MANUFACTURERS } from '../../constants/manufacturers';
import { getEligibleLegendaryEffects } from '../../constants/legendaryEffects';
import { rollRarityForDrop } from '../../content/lootResolver';
import { createRNG, seededRandom, seededInt, pickWeighted, hashString } from '../utils/rng';
import { generateItemId } from '../utils/id';
import { generateWeaponName } from '../utils/naming';
import { computeStandardDps } from '../stats/dpsChain';
import {
  generateActivityModule,
  pickActivityKind,
} from '../generators/activityModuleGenerator';
import { BASE_ACTIVITY_MODULE_CHANCE } from '../../content/activityModuleDefs';

export interface GenerateWeaponOptions {
  source: DropSource;
  level?: number;
  forcedType?: WeaponType;
  forcedRarity?: Rarity;
  forcedElement?: Element;
  forcedManufacturer?: Manufacturer;
  luckBonus?: number; // 0-1 flat increase to rarity roll
  bossTier?: number;
  zoneWeights?: Record<string, number>; // per-zone rarity weights
  _luckBonus?: number; // internal — destructured from options
}

export function generateWeapon(options: GenerateWeaponOptions, externalRng?: () => number): Weapon {
  const {
    source,
    level = 1,
    forcedType,
    forcedRarity,
    forcedElement,
    forcedManufacturer,
    _luckBonus = 0,
    bossTier,
    zoneWeights,
  } = options;

  // Phase 2b: when an external RNG is provided (ticker path), use it
  // directly for deterministic, server-reproducible items. Otherwise
  // fall back to the legacy Date.now() + Math.random() seed.
  const seedBase = `${source}_${level}_${Date.now()}_${Math.random()}`;
  const pixelSeed = hashString(seedBase);
  const rng = externalRng ?? createRNG(pixelSeed);

  // 3. Roll rarity through the content resolver so drop-source weighting has one owner.
  const rarity = forcedRarity || rollRarityForDrop({ source, zoneWeights }, rng).id;
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

  const stats = {
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
        (stats as Record<string, number>)[k] = parseFloat((stats[k] * (mult as number)).toFixed(3));
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
        (stats as Record<string, number>)[key] = parseFloat(((stats[key] as number) * (v as number)).toFixed(3));
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

  // 10b. Bake affixes into stats so they are NOT purely cosmetic.
  // Multiplicative stats (baseDamage, attackSpeed) multiply the base.
  // Additive stats (crit, modifiers) add to the existing value.
  for (const affix of affixes) {
    const v = affix.value;
    switch (affix.stat) {
      case 'baseDamage':
        stats.baseDamage = Math.round(stats.baseDamage * (1 + v));
        break;
      case 'attackSpeed':
        stats.attackSpeed = parseFloat((stats.attackSpeed * (1 + v)).toFixed(2));
        break;
      case 'critChance':
        stats.critChance = parseFloat((stats.critChance + v).toFixed(3));
        break;
      case 'critDamage':
        stats.critDamage = parseFloat((stats.critDamage + v).toFixed(2));
        break;
      case 'bossDamageMod':
        stats.bossDamageMod = parseFloat((stats.bossDamageMod + v).toFixed(3));
        break;
      case 'waveDamageMod':
        stats.waveDamageMod = parseFloat((stats.waveDamageMod + v).toFixed(3));
        break;
      case 'shieldDamageMod':
        stats.shieldDamageMod = parseFloat((stats.shieldDamageMod + v).toFixed(3));
        break;
      case 'armorDamageMod':
        stats.armorDamageMod = parseFloat((stats.armorDamageMod + v).toFixed(3));
        break;
      case 'offlineEarningsMod':
        stats.offlineEarningsMod = parseFloat((stats.offlineEarningsMod + v).toFixed(3));
        break;
      case 'rareDropChanceMod':
        stats.rareDropChanceMod = parseFloat((stats.rareDropChanceMod + v).toFixed(3));
        break;
      case 'scrapYieldMod':
        stats.scrapYieldMod = parseFloat((stats.scrapYieldMod + v).toFixed(3));
        break;
      // Unknown stat from future affixes — silently skip.
      default:
        break;
    }
  }

  // 10c. Roll activity module (procedural, Borderlands-style)
  // Chance increases with rarity: Common 15%, Uncommon 20%, Rare 30%, Epic 40%, Legendary 55%
  const activityChance = BASE_ACTIVITY_MODULE_CHANCE
    + (rarity === Rarity.Uncommon ? 0.05 : rarity === Rarity.Rare ? 0.15 : rarity === Rarity.Epic ? 0.25 : rarity === Rarity.Legendary ? 0.35 : 0);
  if (seededRandom(0, 1, rng) < activityChance) {
    const activityKind = pickActivityKind('weapon', rng);
    if (activityKind) {
      const module = generateActivityModule({
        itemLevel: level,
        itemRarity: rarity,
        manufacturer,
        slot: 'weapon',
        activityKind,
        rng,
      });
      if (module) {
        affixes.push(module);
      }
    }
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
  // 14. Calculate effective power.
  //
  //   `combatPower` is the chain's "vs standard target" DPS, computed via
  //   `computeStandardDps(weapon)`. The chain (src/lib/stats/dpsChain.ts)
  //   is the single source of truth for "how much damage does this weapon
  //   do per second against a generic target" — we delegate to it here so
  //   the frozen value on the Weapon record and the value the diorama /
  //   gear inspect show cannot diverge. The parity test in
  //   src/test/weaponGenerator.test.ts asserts they match.
  //
  //   `bossPower` and `farmPower` are composite derived stats, not pure
  //   DPS. They fold in shield/armor break bonuses and wave damage mod
  //   respectively — domain facts the generator owns, not the chain.
  //   `bossPower` is `combatPower * (1 + bossDamageMod) * (1 + shield
  //   damage mod 0.3) * (1 + armor damage mod 0.3)`. `farmPower` is
  //   `combatPower * (1 + waveDamageMod) * (1 + attackSpeed * 0.2)`.
  //
  //   We assemble the weapon first with placeholder power values, then
  //   call the chain on the assembled weapon to compute combatPower.
  //   The chain only reads baseDamage / attackSpeed / critChance /
  //   critDamage / element / manufacturer — none of which depend on
  //   combatPower, so the placeholder is safe.
  //
  //   This intentionally changes the visible `Combat Power` and
  //   `Farm Power` chips on every existing weapon. The new value uses
  //   the chain's formula (`(1 + critChance * critDamage)`) which is
  //   the correct interpretation per the locked decision in
  //   `.hermes/plans/dps-chain-v2-plan.md` (D1: "vs standard" = raw
  //   hit, no element multiplier). The previous generator formula
  //   (`(1 + critChance * (critDamage - 1)) * (1 + statusChance *
  //   0.5)`) treated critDamage as a partial multiplier and status
  //   chance as a DPS contributor; both are now removed because
  //   neither is folded into the chain's standard-target DPS.
  const stub: Weapon = {
    id: generateItemId(),
    name: '',
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
    pixelSeed,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
  };
  const combatPower = Math.round(computeStandardDps(stub));
  const bossPower = Math.round(combatPower * (1 + stats.bossDamageMod) * (1 + stats.shieldDamageMod * 0.3) * (1 + stats.armorDamageMod * 0.3));
  const farmPower = Math.round(combatPower * (1 + stats.waveDamageMod) * (1 + stats.attackSpeed * 0.2));
  const economyScore = Math.round((stats.rareDropChanceMod + stats.scrapYieldMod + stats.offlineEarningsMod) * 100);

  // 15. Name
  const name = generateWeaponName(weaponType, manufacturer, element, rng);

  return {
    ...stub,
    name,
    combatPower,
    bossPower,
    farmPower,
    economyScore,
  };
}
