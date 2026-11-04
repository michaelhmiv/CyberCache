import { Rarity, Manufacturer, DropSource } from '@/types/game';
import { Relic, Affix } from '@/types/items';
import { RARITIES } from '@/constants/rarities';
import { createRNG, seededInt, seededRandom, pickWeighted, hashString } from '@/lib/utils/rng';
import { generateItemId } from '@/lib/utils/id';
import {
  generateActivityModule,
  pickActivityKind,
} from './activityModuleGenerator';
import { BASE_ACTIVITY_MODULE_CHANCE } from '@/content/activityModuleDefs';
import { RELIC_AFFIX_POOL } from '@/lib/gear/affixPools';
import { craftAffixesForRelic, craftRelicByName } from '@/content/crafting';

const RELIC_MANUFACTURERS: Manufacturer[] = [
  Manufacturer.Prismatek,
  Manufacturer.HelixWorks,
  Manufacturer.ThrowTech,
  Manufacturer.Ironwood,
  Manufacturer.Redline,
  Manufacturer.BlastForge,
];

/**
 * The closed relic name pool — every relic ever minted carries one
 * of these sixteen names (chef drops, NPC stock, and crafting all
 * route through generateRelic below). The relic pixel grammar
 * (src/lib/pixel/relicGrammar.ts) keys a relic's form to its name;
 * its coverage test reads THIS list, so growing the pool without
 * adding a grammar row fails the suite. Order is load-bearing:
 * generation indexes into it with a seeded roll.
 *
 * The last four are the CRAFT relics (economy slice 9): the three
 * converted workshop tools and the Prime Laboratory. A craft
 * relic's name ALWAYS carries its fixed crafting affixes
 * (content/crafting CRAFT_RELICS) — never pool rolls — wherever it
 * was minted: a dropped Precision Calipers is the same instrument
 * as a crafted one.
 */
export const RELIC_NAMES = [
  'Vault Chip', 'Data Shard', 'Neural Key', 'Cache Relic',
  'Echo Stone', 'Void Prism', 'Circuit Totem', 'Ancient Module',
  'Scrap Core', 'Glitched Token', 'Ethereal Drive', 'Quantum Fragment',
  'Precision Calipers', 'Servo Bench Rig', 'Reclaimer Head', 'Prime Laboratory',
] as const;

export function generateRelic(level: number = 1, externalRng?: () => number, rarityWeights?: Partial<Record<Rarity, number>>): Relic {
  const rng = externalRng ?? createRNG(hashString(`relic_${level}_${Date.now()}_${Math.random()}`));

  const rarityKeys = Object.values(Rarity);
  const weights = rarityKeys.map((r) => rarityWeights?.[r] ?? RARITIES[r].dropWeight);
  const rarity = pickWeighted(rarityKeys, weights, rng);
  const rarityDef = RARITIES[rarity];

  // Relics pick a manufacturer for activity module flavor only (not displayed in name)
  const relicMfg = RELIC_MANUFACTURERS[seededInt(0, RELIC_MANUFACTURERS.length - 1, rng)];

  const affixCount = seededInt(Math.max(rarityDef.affixCount.min, 2), Math.max(rarityDef.affixCount.max, 4), rng);
  const affixes: Affix[] = [];
  // The pool is shared with reforge (src/lib/gear/affixPools.ts).
  for (let i = 0; i < affixCount; i++) {
    const def = RELIC_AFFIX_POOL[seededInt(0, RELIC_AFFIX_POOL.length - 1, rng)];
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

  const name = RELIC_NAMES[seededInt(0, RELIC_NAMES.length - 1, rng)];

  // Craft relics (slice 9): the name IS the effect set — fixed
  // crafting affixes replace the pool rolls and the activity
  // module, verbatim from the content table.
  if (craftRelicByName(name)) {
    return {
      id: generateItemId(),
      name,
      level,
      rarity,
      affixes: craftAffixesForRelic(name),
      sourceTag: DropSource.WorldDrop,
      isLocked: false,
    };
  }

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

/**
 * Mint one NAMED craft relic at a fixed rarity (economy slice 9):
 * the craft completion path for the converted tool recipes and the
 * Prime Laboratory. The affixes are the content table's fixed set —
 * no pool rolls, no activity module, no rarity scaling of effects —
 * and the source tag is Crafted (the finalizer's provenance stamps
 * ride on top, as for every crafted item).
 */
export function generateNamedRelic(
  name: string,
  level: number = 1,
  rarity: Rarity = Rarity.Epic,
  externalRng?: () => number,
): Relic {
  if (!craftRelicByName(name)) {
    throw new Error(`generateNamedRelic: "${name}" is not a craft relic`);
  }
  void externalRng; // signature parity with generateRelic; minting is deterministic
  return {
    id: generateItemId(),
    name,
    level,
    rarity,
    affixes: craftAffixesForRelic(name),
    sourceTag: DropSource.Crafted,
    isLocked: false,
  };
}
