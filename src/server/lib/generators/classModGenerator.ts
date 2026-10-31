import { Rarity, Manufacturer, DropSource, SkillTreeType } from '@/types/game';
import { ClassMod, Affix } from '@/types/items';
import { RARITIES } from '@/constants/rarities';
import { createRNG, seededInt, seededRandom, pickWeighted, hashString } from '@/lib/utils/rng';
import { generateItemId } from '@/lib/utils/id';
import {
  generateActivityModule,
  pickActivityKind,
} from './activityModuleGenerator';
import { BASE_ACTIVITY_MODULE_CHANCE } from '@/content/activityModuleDefs';
import { CLASSMOD_AFFIX_POOL } from '@/lib/gear/affixPools';
import { SKILL_NODES } from '@/constants/skillTrees';

/**
 * The class-mod node-boost pool: every SMALL node id, DERIVED from
 * the one SKILL_NODES registry (migration 0029 removed the hand-
 * copied literal, which had silently frozen the pool at the original
 * 35 nodes). SKILL_NODES order is append-only, so the derived list
 * keeps the legacy 35 ids in their exact legacy positions and appends
 * new trees' smalls after them — pinned by the parity test in
 * src/test/fixerSkillTree.test.ts.
 */
export const SKILL_NODE_IDS: string[] = SKILL_NODES
  .filter((n) => n.type === 'small')
  .map((n) => n.id);

const TREE_NAMES: Record<SkillTreeType, string> = {
  [SkillTreeType.Gunslinger]: 'Gunslinger',
  [SkillTreeType.Demolition]: 'Demolition',
  [SkillTreeType.Scavenger]: 'Scavenger',
  [SkillTreeType.Fixer]: 'Fixer',
};

const CLASSMOD_MANUFACTURERS: Manufacturer[] = [
  Manufacturer.HelixWorks,
  Manufacturer.Ironwood,
  Manufacturer.ThrowTech,
  Manufacturer.Prismatek,
  Manufacturer.Redline,
  Manufacturer.BlastForge,
];

export function generateClassMod(level: number = 1, externalRng?: () => number, rarityWeights?: Partial<Record<Rarity, number>>): ClassMod {
  const rng = externalRng ?? createRNG(hashString(`classmod_${level}_${Date.now()}_${Math.random()}`));

  const rarityKeys = Object.values(Rarity);
  const weights = rarityKeys.map((r) => rarityWeights?.[r] ?? RARITIES[r].dropWeight);
  const rarity = pickWeighted(rarityKeys, weights, rng);
  const rarityDef = RARITIES[rarity];

  const trees = Object.values(SkillTreeType);
  const treeBonus = trees[seededInt(0, trees.length - 1, rng)];

  // Boost 2-3 random nodes
  const numBoosts = seededInt(2, 4, rng);
  const nodeBoosts: Record<string, number> = {};
  for (let i = 0; i < numBoosts; i++) {
    const nodeId = SKILL_NODE_IDS[seededInt(0, SKILL_NODE_IDS.length - 1, rng)];
    nodeBoosts[nodeId] = seededInt(1, 3, rng);
  }

  const affixCount = seededInt(rarityDef.affixCount.min, rarityDef.affixCount.max, rng);
  const affixes: Affix[] = [];
  // The pool is shared with reforge (src/lib/gear/affixPools.ts).
  for (let i = 0; i < affixCount; i++) {
    const def = CLASSMOD_AFFIX_POOL[seededInt(0, CLASSMOD_AFFIX_POOL.length - 1, rng)];
    const rollVal = seededInt(def.min, def.max, rng);
    affixes.push({
      id: `${def.stat}_${i}`,
      category: 'skill',
      stat: def.stat,
      value: rollVal / 100,
      displayText: def.text.replace('{v}', String(rollVal)),
    });
  }

  // Roll activity module (class mods specialize in crafting/workshop/market)
  const classModMfg = CLASSMOD_MANUFACTURERS[seededInt(0, CLASSMOD_MANUFACTURERS.length - 1, rng)];
  const activityChance = BASE_ACTIVITY_MODULE_CHANCE + 0.05
    + (rarity === Rarity.Uncommon ? 0.05 : rarity === Rarity.Rare ? 0.15 : rarity === Rarity.Epic ? 0.25 : rarity === Rarity.Legendary ? 0.35 : 0);
  if (seededRandom(0, 1, rng) < activityChance) {
    const activityKind = pickActivityKind('classMod', rng);
    if (activityKind) {
      const module = generateActivityModule({
        itemLevel: level,
        itemRarity: rarity,
        manufacturer: classModMfg,
        slot: 'classMod',
        activityKind,
        rng,
      });
      if (module) {
        affixes.push(module);
      }
    }
  }

  const treeName = TREE_NAMES[treeBonus];
  const prefixes = ['Prototype', 'Field-Issue', 'Elite', 'Tactical', 'Optimized'];
  const prefix = prefixes[seededInt(0, prefixes.length - 1, rng)];
  const name = `${prefix} ${treeName} Class Mod`;

  return {
    id: generateItemId(),
    name,
    level,
    rarity,
    treeBonus,
    nodeBoosts,
    affixes,
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}
