/**
 * Resolved recipe costs (Economy brief §4, Econ 7) — display side.
 *
 * The server resolves each recipe's Scrap leg through its
 * per-recipe lever (recipeScrap.<recipeId>) and ships the resolved
 * map on the Workshop state snapshot as `recipeScrapCosts`. Every
 * display of a recipe's Scrap cost goes through here so the number
 * the player sees is the number the enqueue charges: the server map
 * wins, and the content literal is the fallback for payloads that
 * predate the field. Only the Scrap leg is config-backed — every
 * other input is always the content literal.
 */
import { getCraftRecipe, type CraftRecipe } from '../../content/crafting';

/** The recipe's Scrap cost per unit as the server will charge it. */
export function resolvedScrapCost(
  recipe: CraftRecipe,
  recipeScrapCosts?: Record<string, number>,
): number {
  const literal = recipe.inputs['Scrap'];
  if (literal === undefined) return 0;
  const resolved = recipeScrapCosts?.[recipe.id];
  return typeof resolved === 'number' && Number.isFinite(resolved) && resolved >= 0
    ? Math.round(resolved)
    : literal;
}

/** The recipe's full input bill with the Scrap leg resolved. */
export function resolvedRecipeInputs(
  recipe: CraftRecipe,
  recipeScrapCosts?: Record<string, number>,
): Record<string, number> {
  if (recipe.inputs['Scrap'] === undefined) return recipe.inputs;
  return { ...recipe.inputs, Scrap: resolvedScrapCost(recipe, recipeScrapCosts) };
}

/** Craft duration in the Workshop's own grammar (mirrors MaterialUsageSheet). */
export function formatCraftTime(ms: number): string {
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

/**
 * The one-line cost summary a craftable row prints: resolved inputs
 * plus the recipe's real craft duration. Gear-truth: the Wardrobe's
 * pre-fix line read `durationMinutes` / `requiredBenchLevel` —
 * fields that do not exist on CraftRecipe — so every row printed
 * "undefined min · Bench undefined". The duration is
 * unitDurationMs; the bench segment is gone entirely (one bench
 * since the Econ 9 collapse, so a bench number carries no
 * information).
 */
export function recipeCostLine(recipeId: string, recipeScrapCosts?: Record<string, number>): string {
  const recipe = getCraftRecipe(recipeId);
  if (!recipe) return 'Craft in the Workshop';
  const inputs = Object.entries(resolvedRecipeInputs(recipe, recipeScrapCosts))
    .map(([key, qty]) => `${qty.toLocaleString('en-US')} ${key === 'Scrap' ? 'Scrap' : key}`)
    .join(' + ');
  return `${inputs} · ${formatCraftTime(recipe.unitDurationMs)}`;
}
