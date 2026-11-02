/**
 * Crafting recipes — the unified Workshop catalog: consumables,
 * refining, gear frames, and tools, with inputs, times, and every
 * gate (level / bench / mastery / research / standing).
 * Owner: src/content/crafting.ts (ALL_CRAFT_RECIPES — the catalog
 * the Workshop and the Chef both read; research course names resolve
 * through src/content/research.ts, consumable output names through
 * src/constants/consumables.ts).
 */
import { ALL_CRAFT_RECIPES, CRAFT_TOOLS, type CraftRecipe } from '../../src/content/crafting';
import { CONSUMABLES } from '../../src/constants/consumables';
import { RESEARCH_COURSES } from '../../src/content/research';
import { type GenBlock, mins, table } from './lib';

function outputOf(r: CraftRecipe): string {
  switch (r.kind) {
    case 'consumable': {
      const name = r.consumableType ? (CONSUMABLES[r.consumableType]?.name ?? r.consumableType) : r.name;
      return (r.outputQuantity ?? 1) > 1 ? `${name} ×${r.outputQuantity}` : name;
    }
    case 'refine':
      return `${r.outputMaterial} ×${r.outputBase}`;
    case 'gear':
      return `${r.gearSlot} frame`;
    case 'tool':
      return CRAFT_TOOLS.find((t) => t.id === r.toolId)?.name ?? r.name;
    default:
      return r.name;
  }
}

function timeOf(r: CraftRecipe): string {
  if (r.kind === 'gear' && r.durationByRarityMs) {
    return Object.entries(r.durationByRarityMs)
      .map(([rarity, ms]) => `${rarity} ${mins(ms ?? 0)}`)
      .join(' · ');
  }
  return mins(r.unitDurationMs);
}

function gatesOf(r: CraftRecipe): string {
  const gates: string[] = [];
  if (r.requiresLevel > 1) gates.push(`Level ${r.requiresLevel}`);
  if (r.requiresBench > 1) gates.push(`Bench ${r.requiresBench}`);
  if (r.requiresMastery) gates.push(`Mastery: ${r.requiresMastery.track} ${r.requiresMastery.level}`);
  if (r.requiresResearch) {
    const course = RESEARCH_COURSES.find((c) => c.id === r.requiresResearch);
    gates.push(`Research: ${course?.name ?? r.requiresResearch}`);
  }
  if (r.requiresStanding) gates.push(`Standing: ${r.requiresStanding.manufacturer} rank ${r.requiresStanding.rank}`);
  return gates.length ? gates.join(' · ') : '—';
}

function recipesBody(): string {
  const rows = ALL_CRAFT_RECIPES.map((r) => [
    `**${r.name}**`,
    r.kind,
    outputOf(r),
    Object.entries(r.inputs)
      .map(([mat, n]) => `${mat} ×${n}`)
      .join(', '),
    timeOf(r),
    gatesOf(r),
    r.station,
  ]);
  return table(['Recipe', 'Kind', 'Output (per unit)', 'Inputs (per unit)', 'Time', 'Gates', 'Station'], rows);
}

export const recipesBlock: GenBlock = {
  id: 'recipes',
  owners: ['src/content/crafting.ts', 'src/constants/craftingRecipes.ts'],
  render: recipesBody,
};
