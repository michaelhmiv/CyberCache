/**
 * MaterialUsageSheet — "Used in:" lookup for a material or essence.
 *
 * Lists every crafting recipe that consumes the material, read from
 * the single recipe source of truth (CRAFTING_RECIPES via
 * getRecipesUsingMaterial). Shared by the Workshop materials list and
 * the Market material cards so a material tap answers the same way
 * everywhere materials are shown.
 */
import React from 'react';
import { Clock } from 'lucide-react';
import { PickerSheet } from '@/components/common/PickerSheet';
import { getRecipesUsingMaterial } from '@/constants/craftingRecipes';
import { getVisualAsset } from '@/constants/visualAssets';

function formatCraftTime(ms: number): string {
  if (ms >= 60000) return `${Math.round(ms / 60000)}m`;
  return `${Math.round(ms / 1000)}s`;
}

export const MaterialUsageSheet: React.FC<{
  materialId: string | null;
  onClose: () => void;
}> = ({ materialId, onClose }) => {
  if (!materialId) return null;
  const label = getVisualAsset('material', materialId).label;
  const recipes = getRecipesUsingMaterial(materialId);

  return (
    <PickerSheet title={label} subtitle={`Used in ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}`} onClose={onClose}>
      {recipes.length === 0 ? (
        <div className="p-4 text-center text-xs text-text-muted">
          No crafting recipes use {label} yet.
        </div>
      ) : (
        <div className="space-y-1.5 p-3">
          {recipes.map((recipe) => (
            <div key={recipe.id} className="flex items-center justify-between gap-3 border-2 border-border bg-surface/90 p-2.5">
              <div className="min-w-0">
                <div className="truncate text-xs font-black text-text-primary">{recipe.name}</div>
                <div className="text-[9px] uppercase tracking-wide text-text-muted">
                  {recipe.category} · needs {recipe.materials[materialId]} × {label} · makes {recipe.outputCount}
                  {recipe.requiresLevel ? ` · Lv.${recipe.requiresLevel}` : ''}
                </div>
              </div>
              <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-text-muted">
                <Clock size={10} />
                {formatCraftTime(recipe.craftTimeMs)}
              </span>
            </div>
          ))}
        </div>
      )}
    </PickerSheet>
  );
};
