import { WorkshopQueue } from '../types/workshop';
import { CRAFTING_RECIPES } from '../constants/craftingRecipes';

export interface OfflineCraftingResult {
  completedItems: Record<string, number>;
  remainingQueues: WorkshopQueue[];
}

export function processOfflineCrafting(
  queues: WorkshopQueue[],
  lastTick: number,
  now: number
): OfflineCraftingResult {
  const elapsed = now - lastTick;
  const completedItems: Record<string, number> = {};
  const remainingQueues: WorkshopQueue[] = [];

  queues.forEach((queue) => {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === queue.recipeId);
    if (!recipe) return;

    const totalTimePassed = elapsed + (queue.claimedCount * queue.durationMs);
    const completedCount = Math.min(queue.count, Math.floor(totalTimePassed / queue.durationMs));
    const newlyCompleted = completedCount - queue.claimedCount;

    if (newlyCompleted > 0) {
      completedItems[recipe.consumableType] = (completedItems[recipe.consumableType] || 0) + newlyCompleted * recipe.outputCount;
    }

    if (completedCount < queue.count) {
      // Queue still active — adjust start time so elapsed math works for next tick
      const adjustedStart = now - (totalTimePassed % queue.durationMs);
      remainingQueues.push({
        ...queue,
        startedAt: adjustedStart,
        claimedCount: completedCount,
      });
    }
  });

  return { completedItems, remainingQueues };
}

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
      missing.push(`${key}: ${available}/${required}`);
    }
  });

  return { can: missing.length === 0, missing };
}

export function getCraftTimeWithReduction(
  baseTimeMs: number,
  scavengerSkillPoints: number
): number {
  // scav_cons_1 + scav_cons_2 = up to 10 points × 2% = 20%
  // scav_keystone = additional 15%
  const smallReduction = Math.min(0.20, scavengerSkillPoints * 0.02);
  // For simplicity, assume max 20% from small nodes, 15% from keystone if we pass a flag
  // In real impl, we'd read actual skill tree state
  return Math.round(baseTimeMs * (1 - smallReduction));
}
