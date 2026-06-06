export interface WorkshopQueue {
  id: string;
  benchId: number;
  recipeId: string;
  count: number;
  startedAt: number;
  durationMs: number;
  claimedCount: number;
  completed?: boolean;
}

export interface CraftingRecipe {
  id: string;
  consumableType: string;
  name: string;
  category: 'survival' | 'offense' | 'utility';
  materials: Record<string, number>;
  craftTimeMs: number;
  outputCount: number;
  requiresLevel?: number;
  requiresSkillNodeId?: string;
}
