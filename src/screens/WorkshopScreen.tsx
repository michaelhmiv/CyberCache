import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Hammer, Clock, AlertCircle, ChevronDown } from 'lucide-react';
import { usePlayerStore, useWorkshopStore, useSkillStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { CRAFTING_RECIPES } from '@/constants/craftingRecipes';
import { canStartCraft, getCraftTimeWithReduction } from '@/lib/craftingEngine';
import type { WorkshopQueue } from '@/types/workshop';

const MAX_BENCHES = 3;

/** Find the first available bench (1-3) with no active queue */
function findAvailableBench(activeQueues: WorkshopQueue[], unlockedCount: number): number | null {
  const usedBenchIds = new Set(activeQueues.map((q) => q.benchId));
  for (let id = 1; id <= Math.min(unlockedCount, MAX_BENCHES); id++) {
    if (!usedBenchIds.has(id)) return id;
  }
  return null;
}

/** Format ms as human-readable time remaining */
function formatTimeRemaining(startedAt: number, durationMs: number, count: number): string {
  const elapsed = Date.now() - startedAt;
  const currentCycle = elapsed % durationMs;
  const remaining = durationMs - currentCycle;
  if (remaining <= 0) return 'Done';
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Material color mapping for visual badges */
const MATERIAL_COLORS: Record<string, string> = {
  ScrapAlloy: 'text-gray-400',
  BallisticParts: 'text-red-400',
  ReactiveComponents: 'text-blue-400',
  TechFragments: 'text-purple-400',
  VoidDust: 'text-amber-400',
  IgnitionFluid: 'text-orange-400',
  ConduitWire: 'text-cyan-400',
  AcidCompound: 'text-green-400',
  CryoGel: 'text-sky-400',
  VoidEssence: 'text-violet-400',
};

const MATERIAL_ICONS: Record<string, string> = {
  ScrapAlloy: '🔩',
  BallisticParts: '🔫',
  ReactiveComponents: '⚡',
  TechFragments: '💾',
  VoidDust: '✨',
  IgnitionFluid: '🔥',
  ConduitWire: '🔌',
  AcidCompound: '🧪',
  CryoGel: '❄️',
  VoidEssence: '🌀',
};

export const WorkshopScreen: React.FC<{ onNavigate?: (screen: string) => void }> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const workshop = useWorkshopStore();
  const skillBonuses = useSkillStore().getBonuses();
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'survival' | 'offense' | 'utility'>('all');
  const [expandedMaterials, setExpandedMaterials] = useState(false);
  const [justCrafted, setJustCrafted] = useState<string | null>(null);
  const [expandedQueue, setExpandedQueue] = useState<string | null>(null);

  const filteredRecipes = useMemo(
    () =>
      selectedCategory === 'all'
        ? CRAFTING_RECIPES
        : CRAFTING_RECIPES.filter((r) => r.category === selectedCategory),
    [selectedCategory],
  );

  const hasMaterials =
    Object.values(player.materials).some((count) => count > 0) ||
    Object.values(player.essences).some((count) => count > 0);

  // Material entires sorted by count (most first)
  const sortedMaterials = useMemo(
    () =>
      Object.entries({ ...player.materials, ...player.essences })
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a),
    [player.materials, player.essences],
  );

  const handleCraft = useCallback(
    (recipeId: string) => {
      const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
      if (!recipe) return;

      const { can } = canStartCraft(recipeId, player.materials, player.essences, player.level);
      if (!can) return;

      const availableBench = findAvailableBench(workshop.activeQueues, workshop.unlockedBenchCount);
      if (availableBench === null) return;

      // Deduct materials
      Object.entries(recipe.materials).forEach(([key, amount]) => {
        if (
          key === 'ScrapAlloy' ||
          key === 'BallisticParts' ||
          key === 'ReactiveComponents' ||
          key === 'TechFragments' ||
          key === 'VoidDust'
        ) {
          player.removeMaterial(key, amount);
        } else {
          player.removeEssence(key, amount);
        }
      });

      const scavengerPoints = (skillBonuses.consumableEfficiency || 0) * 10;
      const craftTime = getCraftTimeWithReduction(recipe.craftTimeMs, scavengerPoints);
      workshop.addQueue({
        id: crypto.randomUUID(),
        benchId: availableBench,
        recipeId: recipe.id,
        count: 1,
        startedAt: Date.now(),
        durationMs: craftTime,
        claimedCount: 0,
      });

      // Flash feedback
      setJustCrafted(recipeId);
      setTimeout(() => setJustCrafted(null), 600);
    },
    [player, workshop, skillBonuses],
  );

  const handleClaim = useCallback(
    (queueId: string) => {
      const queue = workshop.activeQueues.find((q) => q.id === queueId);
      const beforeClaim = queue?.claimedCount || 0;
      const claimed = workshop.claimQueue(queueId);
      if (claimed) {
        const recipe = CRAFTING_RECIPES.find((r) => r.id === claimed.recipeId);
        if (recipe) {
          const newlyCompleted = claimed.claimedCount - beforeClaim;
          player.addConsumable(recipe.consumableType, newlyCompleted * recipe.outputCount);
        }
      }
    },
    [workshop, player],
  );

  const handleCancel = useCallback(
    (queueId: string) => {
      const queue = workshop.activeQueues.find((q) => q.id === queueId);
      if (!queue) return;
      // Refund half materials
      const recipe = CRAFTING_RECIPES.find((r) => r.id === queue.recipeId);
      if (recipe) {
        Object.entries(recipe.materials).forEach(([key, amount]) => {
          const refund = Math.ceil(amount / 2);
          if (
            key === 'ScrapAlloy' ||
            key === 'BallisticParts' ||
            key === 'ReactiveComponents' ||
            key === 'TechFragments' ||
            key === 'VoidDust'
          ) {
            player.addMaterial(key, refund);
          } else {
            player.addEssence(key, refund);
          }
        });
      }
      workshop.removeQueue(queueId);
    },
    [workshop, player],
  );

  // Bench availability for UI
  const usedBenchIds = new Set(workshop.activeQueues.map((q) => q.benchId));
  const nextAvailableBench = findAvailableBench(workshop.activeQueues, workshop.unlockedBenchCount);

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div className="text-lg font-black text-text-primary">Workshop</div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted bg-surface-raised rounded-full px-2.5 py-1">
          {Array.from({ length: workshop.unlockedBenchCount }, (_, i) => (
            <span
              key={i}
              className={`w-2 h-2 rounded-full ${
                !usedBenchIds.has(i + 1) ? 'bg-green' : 'bg-amber'
              }`}
            />
          ))}
          <span className="ml-1">{workshop.unlockedBenchCount - usedBenchIds.size}/{workshop.unlockedBenchCount} free</span>
        </div>
      </div>
      <div className="text-xs text-text-muted">Craft consumables and ammo from salvaged materials.</div>

      {/* Material source hint (empty state) */}
      {!hasMaterials && (
        <MobileCard className="space-y-2 border-amber/30 bg-amber/5">
          <div className="text-[10px] text-text-secondary">
            <span className="font-bold text-amber">No materials yet!</span> Salvage weapons from the Loot tab to get
            crafting materials and essences.
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => onNavigate?.('loot')}
            className="w-full py-2 rounded-lg bg-amber/10 border border-amber/30 text-amber text-xs font-bold 
                       active:bg-amber/20 transition-colors"
          >
            Go to Loot
          </motion.button>
        </MobileCard>
      )}

      {/* Materials & Essences (collapsible) */}
      {hasMaterials && (
        <MobileCard className="space-y-2">
          <button
            onClick={() => setExpandedMaterials(!expandedMaterials)}
            className="w-full flex items-center justify-between text-xs font-bold text-amber uppercase"
          >
            <span>Materials & Essences ({sortedMaterials.length})</span>
            <motion.span animate={{ rotate: expandedMaterials ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={14} />
            </motion.span>
          </button>
          <div
            className={`grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] overflow-hidden transition-all ${
              expandedMaterials ? 'max-h-[500px] opacity-100' : 'max-h-16 opacity-70'
            }`}
          >
            {sortedMaterials
              .slice(0, expandedMaterials ? sortedMaterials.length : 4)
              .map(([type, count]) => {
                const colorClass = MATERIAL_COLORS[type] || 'text-text-secondary';
                const icon = MATERIAL_ICONS[type] || '';
                return (
                  <div key={type} className="flex items-center justify-between">
                    <span className={`truncate ${colorClass}`}>
                      {icon} {type}
                    </span>
                    <span className="font-bold ml-1 text-text-primary">{count}</span>
                  </div>
                );
              })}
          </div>
        </MobileCard>
      )}

      {/* Active Queues */}
      <AnimatePresence mode="popLayout">
        {workshop.activeQueues.length > 0 && (
          <motion.div layout className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase">Active Benches</div>
            {workshop.activeQueues.map((q) => {
              const recipe = CRAFTING_RECIPES.find((r) => r.id === q.recipeId);
              const elapsed = Date.now() - q.startedAt;
              const completed = Math.min(q.count, Math.floor(elapsed / q.durationMs));
              const pct = Math.min(100, (elapsed % q.durationMs) / q.durationMs * 100);
              const timeLeft = formatTimeRemaining(q.startedAt, q.durationMs, q.count);
              const hasReady = completed > q.claimedCount;
              const isExpanded = expandedQueue === q.id;

              return (
                <motion.div
                  key={q.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                >
                  <MobileCard className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            hasReady ? 'bg-green animate-pulse' : 'bg-amber'
                          }`}
                        />
                        <span className="text-[10px] font-bold text-text-muted">Bench {q.benchId}</span>
                      </div>
                      <button
                        onClick={() => setExpandedQueue(isExpanded ? null : q.id)}
                        className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
                      >
                        {isExpanded ? 'Less' : 'More'}
                      </button>
                    </div>
                    <div className="text-xs font-bold text-text-primary">{recipe?.name || q.recipeId}</div>
                    <div className="flex items-center justify-between text-[10px] text-text-muted">
                      <span>
                        {completed}/{q.count} completed
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} /> {timeLeft}
                      </span>
                    </div>
                    <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-amber rounded-full"
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, ease: 'linear' }}
                      />
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      {hasReady && (
                        <motion.button
                          whileTap={{ scale: 0.95 }}
                          onClick={() => handleClaim(q.id)}
                          className="flex-1 py-2 rounded-lg bg-amber text-bg text-[11px] font-bold 
                                     active:bg-amber/80 transition-colors"
                        >
                          Claim Ready ({completed - q.claimedCount})
                        </motion.button>
                      )}
                      <motion.button
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleCancel(q.id)}
                        className="py-2 px-3 rounded-lg bg-red/10 border border-red/30 text-red text-[10px] font-bold
                                   active:bg-red/20 transition-colors"
                      >
                        Cancel (50% refund)
                      </motion.button>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && recipe && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="pt-1.5 border-t border-border/50 space-y-1"
                      >
                        <div className="text-[10px] text-text-muted">
                          Materials used:{' '}
                          {Object.entries(recipe.materials)
                            .map(([k, v]) => `${MATERIAL_ICONS[k] || ''}${k}×${v}`)
                            .join(' · ')}
                        </div>
                        <div className="text-[10px] text-text-muted">
                          Output: {recipe.outputCount}× {recipe.name} per craft
                        </div>
                      </motion.div>
                    )}
                  </MobileCard>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Category Filter */}
      <div className="grid grid-cols-4 gap-2">
        {(['all', 'survival', 'offense', 'utility'] as const).map((cat) => (
          <motion.button
            key={cat}
            whileTap={{ scale: 0.95 }}
            onClick={() => setSelectedCategory(cat)}
            className={`py-2 rounded-lg text-[10px] font-bold border transition-colors ${
              selectedCategory === cat
                ? 'bg-amber text-bg border-amber'
                : 'bg-surface-raised text-text-secondary border-border hover:bg-surface hover:text-text-primary'
            }`}
          >
            {cat === 'all' ? 'All' : cat.charAt(0).toUpperCase() + cat.slice(1)}
          </motion.button>
        ))}
      </div>

      {/* Recipes */}
      <div className="space-y-2">
        {filteredRecipes.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-xs">No recipes in this category.</div>
        ) : (
          filteredRecipes.map((recipe) => {
            const { can, missing } = canStartCraft(
              recipe.id,
              player.materials,
              player.essences,
              player.level,
            );
            const isLevelLocked =
              recipe.requiresLevel !== undefined && player.level < recipe.requiresLevel;
            const benchFull = nextAvailableBench === null;
            const justClicked = justCrafted === recipe.id;

            // Parse which specific materials are short
            const materialEntries = Object.entries(recipe.materials).map(([key, required]) => {
              const available =
                key === 'ScrapAlloy' ||
                key === 'BallisticParts' ||
                key === 'ReactiveComponents' ||
                key === 'TechFragments' ||
                key === 'VoidDust'
                  ? player.materials[key] || 0
                  : player.essences[key] || 0;
              return { key, required, available, hasEnough: available >= required };
            });

            const canCraftNow = can && !benchFull && !isLevelLocked;
            const disabledReason = isLevelLocked
              ? `Lv.${recipe.requiresLevel}`
              : benchFull
                ? 'All benches busy'
                : can
                  ? ''
                  : 'Missing materials';

            return (
              <MobileCard key={recipe.id} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-text-primary">{recipe.name}</span>
                    {recipe.requiresLevel !== undefined && (
                      <span
                        className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                          isLevelLocked ? 'bg-red/15 text-red' : 'bg-surface-raised text-text-muted'
                        }`}
                      >
                        Lv.{recipe.requiresLevel}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted flex items-center gap-1">
                    <Clock size={10} />
                    {recipe.craftTimeMs >= 60000
                      ? `${(recipe.craftTimeMs / 60000).toFixed(0)}m`
                      : `${(recipe.craftTimeMs / 1000).toFixed(0)}s`}
                  </span>
                </div>

                {/* Materials needed with availability */}
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
                  {materialEntries.map(({ key, required, available, hasEnough }) => {
                    const colorClass = MATERIAL_COLORS[key] || 'text-text-muted';
                    const icon = MATERIAL_ICONS[key] || '';
                    return (
                      <span
                        key={key}
                        className={`${hasEnough ? colorClass : 'text-red-400 line-through'} flex items-center gap-0.5`}
                      >
                        {icon}
                        <span>
                          {available}/{required}
                        </span>
                      </span>
                    );
                  })}
                </div>

                <motion.button
                  whileTap={canCraftNow ? { scale: 0.95 } : {}}
                  onClick={() => canCraftNow && handleCraft(recipe.id)}
                  disabled={!canCraftNow}
                  className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                    canCraftNow
                      ? `bg-amber text-bg active:bg-amber/80 cursor-pointer ${
                          justClicked ? 'ring-2 ring-amber/50' : ''
                        }`
                      : 'bg-surface-raised text-text-muted border border-border cursor-not-allowed'
                  }`}
                >
                  {canCraftNow
                    ? justClicked
                      ? '✓ Crafted!'
                      : 'CRAFT'
                    : disabledReason}
                </motion.button>
              </MobileCard>
            );
          })
        )}
      </div>

      {/* Footer */}
      {hasMaterials && (
        <div className="text-center">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate?.('loot')}
            className="text-[10px] text-text-muted underline hover:text-amber active:text-amber transition-colors"
          >
            Salvage more items from Loot
          </motion.button>
        </div>
      )}
    </div>
  );
};
