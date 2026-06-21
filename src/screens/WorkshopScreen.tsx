import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ChevronDown, Search, X, ArrowUpDown } from 'lucide-react';
import { useActivityStore, usePlayerStore, useWorkshopStore, useSkillStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { ChipRail } from '@/components/common/ChipRail';
import { CRAFTING_RECIPES } from '@/constants/craftingRecipes';
import { CONSUMABLES, getConsumableQualityBand } from '@/constants/consumables';
import { canStartCraft, getCraftTimeWithReduction } from '@/lib/craftingEngine';
import { buildCraftingActivity } from '@/lib/activity/activityBuilders';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { useFilterSort } from '@/lib/hooks/useFilterSort';
import { chipClip } from '@/lib/ui/clips';
import type { WorkshopQueue, CraftingRecipe } from '@/types/workshop';

const MAX_BENCHES = 3;

const CATEGORIES: Array<{ key: CraftingRecipe['category']; label: string }> = [
  { key: 'survival', label: 'Survival' },
  { key: 'offense', label: 'Offense' },
  { key: 'utility', label: 'Utility' },
];

function findAvailableBench(activeQueues: WorkshopQueue[], unlockedCount: number): number | null {
  const usedBenchIds = new Set(activeQueues.map((q) => q.benchId));
  for (let id = 1; id <= Math.min(unlockedCount, MAX_BENCHES); id++) {
    if (!usedBenchIds.has(id)) return id;
  }
  return null;
}

function formatTimeRemaining(now: number, startedAt: number, durationMs: number): string {
  const elapsed = now - startedAt;
  const currentCycle = elapsed % durationMs;
  const remaining = durationMs - currentCycle;
  if (remaining <= 0) return 'Done';
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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

const MATERIAL_KEYS = new Set(['ScrapAlloy', 'BallisticParts', 'ReactiveComponents', 'TechFragments', 'VoidDust']);

export const WorkshopScreen: React.FC<{ onNavigate?: (screen: string) => void }> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const workshop = useWorkshopStore();
  const skillBonuses = useSkillStore().getBonuses();
  const activity = useActivityStore();
  const [expandedMaterials, setExpandedMaterials] = useState(false);
  const [justCrafted, setJustCrafted] = useState<string | null>(null);
  const [expandedQueue, setExpandedQueue] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [claimingQueueId, setClaimingQueueId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  const sortOptions = useMemo(
    () => [
      { key: 'level', label: 'Level ↑', compare: (a, b) => (a.requiresLevel ?? 0) - (b.requiresLevel ?? 0) },
      { key: 'time', label: 'Time ↑', compare: (a, b) => a.craftTimeMs - b.craftTimeMs },
      { key: 'name', label: 'Name A-Z', compare: (a, b) => a.name.localeCompare(b.name) },
    ],
    [],
  );

  const {
    filtered: filteredRecipes,
    search,
    setSearch,
    activeFacets,
    toggleFacet,
    clearFacets,
    sortKey,
    setSortKey,
    hasActiveFilters,
  } = useFilterSort({
    items: CRAFTING_RECIPES,
    searchFields: [(r) => r.name],
    facets: [
      {
        key: 'category',
        label: 'Category',
        values: () => CATEGORIES.map((c) => c.key),
        matches: (item, value) => item.category === value,
      },
    ],
    sorts: sortOptions,
    defaultSortKey: 'level',
  });

  const hasMaterials =
    Object.values(player.materials).some((count) => count > 0) ||
    Object.values(player.essences).some((count) => count > 0);

  const sortedMaterials = useMemo(
    () =>
      Object.entries({ ...player.materials, ...player.essences })
        .filter(([, count]) => count > 0)
        .sort(([, a], [, b]) => b - a),
    [player.materials, player.essences],
  );

  const handleCraft = useCallback(
    async (recipeId: string) => {
      const recipe = CRAFTING_RECIPES.find((r) => r.id === recipeId);
      if (!recipe) return;

      const { can } = canStartCraft(recipeId, player.materials, player.essences, player.level);
      if (!can) return;

      const availableBench = findAvailableBench(workshop.activeQueues, workshop.unlockedBenchCount);
      if (availableBench === null) return;

      setActivityError(null);
      try {
        await activity.start(buildCraftingActivity(recipe, availableBench));
      } catch (error) {
        setActivityError(error instanceof Error ? error.message : 'Unable to sync crafting activity.');
        return;
      }

      try {
        Object.entries(recipe.materials).forEach(([key, amount]) => {
          if (MATERIAL_KEYS.has(key)) player.removeMaterial(key, amount);
          else player.removeEssence(key, amount);
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

        setJustCrafted(recipeId);
        window.setTimeout(() => setJustCrafted(null), 600);
      } finally {
        activity.clear().catch((error) => console.warn('Crafting activity clear skipped:', error));
      }
    },
    [activity, player, workshop, skillBonuses],
  );

  const handleClaim = useCallback(
    async (queueId: string) => {
      const queue = workshop.activeQueues.find((q) => q.id === queueId);
      if (!queue || claimingQueueId) return;
      const recipe = CRAFTING_RECIPES.find((r) => r.id === queue.recipeId);
      if (!recipe) return;

      const elapsed = Date.now() - queue.startedAt;
      const completed = Math.min(queue.count, Math.floor(elapsed / queue.durationMs));
      const newlyCompleted = completed - queue.claimedCount;
      if (newlyCompleted <= 0) return;

      setClaimingQueueId(queueId);
      setActivityError(null);
      try {
        await verifiedOps.claimCraftedConsumable({
          recipeId: recipe.id,
          itemKey: recipe.consumableType,
          quantity: newlyCompleted * recipe.outputCount,
        });
        workshop.claimQueue(queueId);
      } catch (error) {
        setActivityError(error instanceof Error ? error.message : 'Unable to claim crafted consumable batch.');
      } finally {
        setClaimingQueueId(null);
      }
    },
    [workshop, claimingQueueId],
  );

  const handleCancel = useCallback(
    (queueId: string) => {
      const queue = workshop.activeQueues.find((q) => q.id === queueId);
      if (!queue) return;
      const recipe = CRAFTING_RECIPES.find((r) => r.id === queue.recipeId);
      if (recipe) {
        Object.entries(recipe.materials).forEach(([key, amount]) => {
          const refund = Math.ceil(amount / 2);
          if (MATERIAL_KEYS.has(key)) player.addMaterial(key, refund);
          else player.addEssence(key, refund);
        });
      }
      workshop.removeQueue(queueId);
    },
    [workshop, player],
  );

  const usedBenchIds = new Set(workshop.activeQueues.map((q) => q.benchId));
  const nextAvailableBench = findAvailableBench(workshop.activeQueues, workshop.unlockedBenchCount);
  const isCraftingActivity = activity.current.kind === 'crafting';
  const activityDetail = isCraftingActivity
    ? activity.current.targetLabel ?? 'Dispatching craft job'
    : workshop.activeQueues.length > 0
      ? `${workshop.activeQueues.length} passive bench queue${workshop.activeQueues.length === 1 ? '' : 's'} running`
      : 'No active character workshop task';

  const activeCategories = activeFacets.category ?? new Set<string>();

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div className="bl-title text-3xl leading-none text-text-primary">Workshop</div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted bg-surface-raised border-2 border-border rounded-full px-2.5 py-1">
          {Array.from({ length: workshop.unlockedBenchCount }, (_, i) => (
            <span key={i} className={`w-2 h-2 rounded-full ${!usedBenchIds.has(i + 1) ? 'bg-green' : 'bg-amber'}`} />
          ))}
          <span className="ml-1">{workshop.unlockedBenchCount - usedBenchIds.size}/{workshop.unlockedBenchCount} free</span>
        </div>
      </div>
      <div className="text-xs text-text-muted">Craft quality-rolled consumable batches from salvaged materials.</div>

      <MobileCard className="space-y-1 border-amber/30 bg-amber/5">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber">
          <span style={{ fontSize: '13px' }}>⚙</span> Workshop Activity
        </div>
        <div className="text-[10px] text-text-secondary leading-relaxed">
          Craft dispatch briefly claims the character activity. Claiming a completed queue now creates a verified quality batch.
        </div>
        <div className="text-[10px] text-text-muted">{activity.pending ? 'Syncing activity...' : activityDetail}</div>
        {activityError && <div className="text-[10px] text-red">{activityError}</div>}
      </MobileCard>

      {!hasMaterials && (
        <MobileCard className="space-y-2 border-amber/30 bg-amber/5">
          <div className="text-[10px] text-text-secondary">
            <span className="font-bold text-amber">No materials yet!</span> Salvage weapons from the Loot tab to get crafting materials and essences.
          </div>
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => onNavigate?.('loot')} className="w-full py-2 rounded-lg bg-amber/10 border border-amber/30 text-amber text-xs font-bold active:bg-amber/20 transition-colors">
            Go to Loot
          </motion.button>
        </MobileCard>
      )}

      {hasMaterials && (
        <MobileCard className="space-y-2">
          <button onClick={() => setExpandedMaterials(!expandedMaterials)} className="w-full flex items-center justify-between text-xs font-bold text-amber uppercase">
            <span>Materials & Essences ({sortedMaterials.length})</span>
            <motion.span animate={{ rotate: expandedMaterials ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={14} />
            </motion.span>
          </button>
          <div className={`grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] overflow-hidden transition-all ${expandedMaterials ? 'max-h-[500px] opacity-100' : 'max-h-16 opacity-70'}`}>
            {sortedMaterials.slice(0, expandedMaterials ? sortedMaterials.length : 4).map(([type, count]) => {
              const colorClass = MATERIAL_COLORS[type] || 'text-text-secondary';
              const icon = MATERIAL_ICONS[type] || '';
              return (
                <div key={type} className="flex items-center justify-between">
                  <span className={`truncate ${colorClass}`}>{icon} {type}</span>
                  <span className="font-bold ml-1 text-text-primary">{count}</span>
                </div>
              );
            })}
          </div>
        </MobileCard>
      )}

      <AnimatePresence mode="popLayout">
        {workshop.activeQueues.length > 0 && (
          <motion.div layout className="space-y-2">
            <div className="text-xs font-bold text-text-muted uppercase">Passive Bench Queues</div>
            {workshop.activeQueues.map((q) => {
              const recipe = CRAFTING_RECIPES.find((r) => r.id === q.recipeId);
              const def = recipe ? CONSUMABLES[recipe.consumableType] : undefined;
              const elapsed = now - q.startedAt;
              const completed = Math.min(q.count, Math.floor(elapsed / q.durationMs));
              const pct = Math.min(100, (elapsed % q.durationMs) / q.durationMs * 100);
              const timeLeft = formatTimeRemaining(now, q.startedAt, q.durationMs);
              const hasReady = completed > q.claimedCount;
              const isExpanded = expandedQueue === q.id;
              const claiming = claimingQueueId === q.id;

              return (
                <motion.div key={q.id} layout initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
                  <MobileCard className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${hasReady ? 'bg-green animate-pulse' : 'bg-amber'}`} />
                        <span className="text-[10px] font-bold text-text-muted">Bench {q.benchId}</span>
                      </div>
                      <button onClick={() => setExpandedQueue(isExpanded ? null : q.id)} className="text-[10px] text-text-muted hover:text-text-secondary transition-colors">
                        {isExpanded ? 'Less' : 'More'}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      {def && <span className="grid h-7 w-7 place-items-center rounded border border-border bg-bg text-sm font-black">{def.visual.glyph}</span>}
                      <div>
                        <div className="text-xs font-bold text-text-primary">{recipe?.name || q.recipeId}</div>
                        {def && <div className="text-[9px] text-amber">Rolls {def.quality.craftMin}%–{def.quality.craftMax}% · {getConsumableQualityBand(def.quality.craftMax)} ceiling</div>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-text-muted">
                      <span>{completed}/{q.count} completed</span>
                      <span className="flex items-center gap-1"><Clock size={10} /> {timeLeft}</span>
                    </div>
                    <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
                      <motion.div className="h-full bg-amber rounded-full" animate={{ width: `${pct}%` }} transition={{ duration: 0.5, ease: 'linear' }} />
                    </div>
                    <div className="flex gap-2">
                      {hasReady && (
                        <motion.button whileTap={{ scale: 0.95 }} onClick={() => { void handleClaim(q.id); }} disabled={claiming} className="flex-1 py-2 rounded-lg bg-amber text-bg text-[11px] font-bold active:bg-amber/80 transition-colors disabled:opacity-50">
                          {claiming ? 'Claiming…' : `Claim Ready (${completed - q.claimedCount})`}
                        </motion.button>
                      )}
                      <motion.button whileTap={{ scale: 0.95 }} onClick={() => handleCancel(q.id)} className="py-2 px-3 rounded-lg bg-red/10 border border-red/30 text-red text-[10px] font-bold active:bg-red/20 transition-colors">
                        Cancel (50% refund)
                      </motion.button>
                    </div>
                    {isExpanded && recipe && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} className="pt-1.5 border-t border-border/50 space-y-1">
                        <div className="text-[10px] text-text-muted">Materials used: {Object.entries(recipe.materials).map(([k, v]) => `${MATERIAL_ICONS[k] || ''}${k}×${v}`).join(' · ')}</div>
                        <div className="text-[10px] text-text-muted">Output: {recipe.outputCount}× {recipe.name} per craft</div>
                      </motion.div>
                    )}
                  </MobileCard>
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <ChipRail>
        {CATEGORIES.map(({ key, label }) => {
          const active = activeCategories.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggleFacet('category', key)}
              className={`shrink-0 py-2 px-3 text-[10px] font-black border transition-colors ${
                active
                  ? 'bl-primary border-transparent'
                  : 'bl-secondary text-text-secondary border-border bg-surface hover:bg-surface hover:text-text-primary'
              }`}
              style={chipClip}
            >
              {label}
            </button>
          );
        })}
      </ChipRail>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipes…"
            className="w-full h-9 pl-8 pr-8 rounded-lg border border-border bg-surface-raised text-xs text-text-primary placeholder:text-text-muted"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <ArrowUpDown size={11} className="text-text-muted" />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            className="shrink-0 text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
          >
            {sortOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>{opt.label}</option>
            ))}
          </select>
        </div>
        {hasActiveFilters && (
          <button type="button" onClick={clearFacets} className="text-[10px] font-black text-red hover:text-red/80 shrink-0">
            Clear
          </button>
        )}
      </div>

      <div className="space-y-2">
        {filteredRecipes.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-xs">
            {hasActiveFilters ? 'No recipes match your search or filter.' : 'No recipes in this category.'}
          </div>
        ) : (
          filteredRecipes.map((recipe) => {
            const { can } = canStartCraft(recipe.id, player.materials, player.essences, player.level);
            const def = CONSUMABLES[recipe.consumableType];
            const isLevelLocked = recipe.requiresLevel !== undefined && player.level < recipe.requiresLevel;
            const benchFull = nextAvailableBench === null;
            const justClicked = justCrafted === recipe.id;
            const materialEntries = Object.entries(recipe.materials).map(([key, required]) => {
              const available = MATERIAL_KEYS.has(key) ? player.materials[key] || 0 : player.essences[key] || 0;
              return { key, required, available, hasEnough: available >= required };
            });
            const canCraftNow = can && !benchFull && !isLevelLocked && !activity.pending;
            const disabledReason = activity.pending
              ? 'Syncing activity'
              : isLevelLocked
                ? `Lv.${recipe.requiresLevel}`
                : benchFull
                  ? 'All benches busy'
                  : can
                    ? ''
                    : 'Missing materials';

            return (
              <MobileCard key={recipe.id} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {def && <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-border bg-bg text-sm font-black">{def.visual.glyph}</span>}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-bold text-text-primary">{recipe.name}</span>
                        {recipe.requiresLevel !== undefined && (
                          <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${isLevelLocked ? 'bg-red/15 text-red' : 'bg-surface-raised text-text-muted'}`}>Lv.{recipe.requiresLevel}</span>
                        )}
                      </div>
                      {def && <div className="text-[9px] text-amber">Quality roll {def.quality.craftMin}%–{def.quality.craftMax}% · {def.runtime.layoutChannel}</div>}
                    </div>
                  </div>
                  <span className="text-[10px] text-text-muted flex items-center gap-1"><Clock size={10} />{recipe.craftTimeMs >= 60000 ? `${(recipe.craftTimeMs / 60000).toFixed(0)}m` : `${(recipe.craftTimeMs / 1000).toFixed(0)}s`}</span>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
                  {materialEntries.map(({ key, required, available, hasEnough }) => {
                    const colorClass = MATERIAL_COLORS[key] || 'text-text-muted';
                    const icon = MATERIAL_ICONS[key] || '';
                    return <span key={key} className={`${hasEnough ? colorClass : 'text-red-400 line-through'} flex items-center gap-0.5`}>{icon}<span>{available}/{required}</span></span>;
                  })}
                </div>
                <motion.button whileTap={canCraftNow ? { scale: 0.95 } : {}} onClick={() => { if (canCraftNow) void handleCraft(recipe.id); }} disabled={!canCraftNow} className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-all ${canCraftNow ? `bg-amber text-bg active:bg-amber/80 cursor-pointer ${justClicked ? 'ring-2 ring-amber/80' : ''}` : 'bg-surface-raised text-text-muted border border-border cursor-not-allowed'}`}>
                  {canCraftNow ? justClicked ? '✓ Dispatched!' : 'CRAFT' : disabledReason}
                </motion.button>
              </MobileCard>
            );
          })
        )}
      </div>

      {hasMaterials && (
        <div className="text-center">
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => onNavigate?.('loot')} className="text-[10px] text-text-muted underline hover:text-amber active:text-amber transition-colors">
            Salvage more items from Loot
          </motion.button>
        </div>
      )}
    </div>
  );
};
