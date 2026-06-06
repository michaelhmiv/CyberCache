import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { usePlayerStore, useWorkshopStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { CRAFTING_RECIPES } from '@/constants/craftingRecipes';
import { canStartCraft, getCraftTimeWithReduction } from '@/lib/craftingEngine';

export const WorkshopScreen: React.FC = () => {
  const player = usePlayerStore();
  const workshop = useWorkshopStore();
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'survival' | 'offense' | 'utility'>('all');

  const filteredRecipes = selectedCategory === 'all'
    ? CRAFTING_RECIPES
    : CRAFTING_RECIPES.filter((r) => r.category === selectedCategory);

  const handleCraft = (recipeId: string) => {
    const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return;

    const { can, missing } = canStartCraft(
      recipeId,
      player.materials,
      player.essences,
      player.level
    );
    if (!can) return;

    // Deduct materials
    Object.entries(recipe.materials).forEach(([key, amount]) => {
      if (key === 'ScrapAlloy' || key === 'BallisticParts' || key === 'ReactiveComponents' || key === 'TechFragments' || key === 'VoidDust') {
        player.removeMaterial(key, amount);
      } else {
        player.removeEssence(key, amount);
      }
    });

    // Create queue
    const craftTime = getCraftTimeWithReduction(recipe.craftTimeMs, 0);
    workshop.addQueue({
      id: crypto.randomUUID(),
      benchId: 1, // TODO: assign to first available bench
      recipeId: recipe.id,
      count: 1,
      startedAt: Date.now(),
      durationMs: craftTime,
      claimedCount: 0,
    });
  };

  const handleClaim = (queueId: string) => {
    const claimed = workshop.claimQueue(queueId);
    if (claimed) {
      const recipe = CRAFTING_RECIPES.find((r) => r.id === claimed.recipeId);
      if (recipe) {
        const newlyCompleted = claimed.claimedCount - (claimed.claimedCount - 1); // approximate
        player.addConsumable(recipe.consumableType, newlyCompleted * recipe.outputCount);
      }
    }
  };

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-lg font-black text-text-primary">Workshop</div>
      <div className="text-xs text-text-muted">Craft consumables and ammo from salvaged materials.</div>

      {/* Materials Display */}
      <MobileCard className="space-y-1">
        <div className="text-xs font-bold text-amber uppercase">Materials</div>
        <div className="grid grid-cols-2 gap-1 text-[10px] text-text-secondary">
          <div>Scrap Alloy: {player.materials['ScrapAlloy'] || 0}</div>
          <div>Ballistic Parts: {player.materials['BallisticParts'] || 0}</div>
          <div>Reactive Comp: {player.materials['ReactiveComponents'] || 0}</div>
          <div>Tech Fragments: {player.materials['TechFragments'] || 0}</div>
          <div>Void Dust: {player.materials['VoidDust'] || 0}</div>
        </div>
      </MobileCard>

      {/* Essences Display */}
      <MobileCard className="space-y-1">
        <div className="text-xs font-bold text-amber uppercase">Essences</div>
        <div className="grid grid-cols-2 gap-1 text-[10px] text-text-secondary">
          <div>Ignition Fluid: {player.essences['IgnitionFluid'] || 0}</div>
          <div>Conduit Wire: {player.essences['ConduitWire'] || 0}</div>
          <div>Acid Compound: {player.essences['AcidCompound'] || 0}</div>
          <div>Cryo Gel: {player.essences['CryoGel'] || 0}</div>
          <div>Void Essence: {player.essences['VoidEssence'] || 0}</div>
        </div>
      </MobileCard>

      {/* Active Queues */}
      {workshop.activeQueues.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted uppercase">Active Queues</div>
          {workshop.activeQueues.map((q) => {
            const recipe = CRAFTING_RECIPES.find((r) => r.id === q.recipeId);
            const elapsed = Date.now() - q.startedAt;
            const completed = Math.min(q.count, Math.floor(elapsed / q.durationMs));
            const pct = Math.min(100, (elapsed % q.durationMs) / q.durationMs * 100);
            return (
              <MobileCard key={q.id} className="space-y-1">
                <div className="text-xs font-bold text-text-primary">{recipe?.name || q.recipeId}</div>
                <div className="text-[10px] text-text-muted">{completed}/{q.count} completed</div>
                <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
                  <motion.div className="h-full bg-amber rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <button
                  onClick={() => handleClaim(q.id)}
                  className="w-full py-1.5 rounded-lg bg-amber text-bg text-[10px] font-bold"
                >
                  Claim Ready
                </button>
              </MobileCard>
            );
          })}
        </div>
      )}

      {/* Category Filter */}
      <div className="grid grid-cols-4 gap-2">
        {(['all', 'survival', 'offense', 'utility'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`py-2 rounded-lg text-[10px] font-bold border transition-colors ${
              selectedCategory === cat ? 'bg-amber text-bg border-amber' : 'bg-surface-raised text-text-secondary border-border'
            }`}
          >
            {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
          </button>
        ))}
      </div>

      {/* Recipes */}
      <div className="space-y-2">
        {filteredRecipes.map((recipe) => {
          const { can, missing } = canStartCraft(recipe.id, player.materials, player.essences, player.level);
          return (
            <MobileCard key={recipe.id} className="space-y-1">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-text-primary">{recipe.name}</div>
                <div className="text-[10px] text-text-muted">{(recipe.craftTimeMs / 60000).toFixed(0)} min</div>
              </div>
              <div className="text-[10px] text-text-muted">
                {Object.entries(recipe.materials).map(([k, v]) => `${k}: ${v}`).join(' · ')}
              </div>
              <button
                onClick={() => handleCraft(recipe.id)}
                disabled={!can}
                className="w-full py-1.5 rounded-lg bg-amber text-bg text-[10px] font-bold disabled:opacity-40"
              >
                {can ? 'CRAFT' : `NEED: ${missing[0] || 'Level'}`}
              </button>
            </MobileCard>
          );
        })}
      </div>
    </div>
  );
};
