/**
 * Display-side craft helpers.
 *
 * The craft JOB MODEL lives on the server now (crafting-as-occupation,
 * migration 0024): jobs, timers, escrow, quality rolls, XP and
 * refunds are all Chef state, settled from server timestamps only
 * while `crafting` is the active action. This module keeps exactly
 * one client helper — a materials/level check the screens use to
 * enable or disable a button. It produces no outcomes: the server
 * re-validates everything at enqueue.
 *
 * Deleted with the job model (do not resurrect): the offline queue
 * processor and the client-side craft-time reduction — both computed
 * gameplay results from a local clock. The consumableEfficiency
 * craft-time consumer is server-side now (src/content/crafting.ts,
 * consumableEfficiencyDurationMultiplier), snapshotted at enqueue.
 */
import { CRAFTING_RECIPES } from '../constants/craftingRecipes';
import { getVisualAsset } from '../constants/visualAssets';

export function canStartCraft(
  recipeId: string,
  materials: Record<string, number>,
  essences: Record<string, number>,
  playerLevel: number
): { can: boolean; missing: string[] } {
  const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
  if (!recipe) return { can: false, missing: ['Recipe not found'] };
  if (recipe.requiresLevel && playerLevel < recipe.requiresLevel) {
    return { can: false, missing: [`Requires level ${recipe.requiresLevel}`] };
  }

  const missing: string[] = [];
  Object.entries(recipe.materials).forEach(([key, required]) => {
    const available = materials[key] || 0;
    if (available < required) {
      // Player-facing: display label from the visual registry, never the raw id (audit W1).
      missing.push(`${getVisualAsset('material', key).label}: ${available}/${required}`);
    }
  });

  return { can: missing.length === 0, missing };
}
