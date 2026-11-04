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
import type { CraftRecipe } from '../../content/crafting';

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
