import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, ChevronDown, Search, X, Lock } from 'lucide-react';
import { useActivityStore, usePlayerStore, useWorkshopStore } from '@/store';
import { useAuth } from '@/auth/AuthProvider';
import { isVerifiedAccount } from '@/auth/accountState';
import { MobileCard } from '@/components/layout/MobileCard';
import { ChipRail } from '@/components/common/ChipRail';
import { MaterialUsageSheet } from '@/components/common/MaterialUsageSheet';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { getVisualAsset } from '@/constants/visualAssets';
import { CONSUMABLES, getConsumableQualityBand } from '@/constants/consumables';
import {
  ALL_CRAFT_RECIPES,
  CRAFT_BENCHES,
  CRAFT_TOOLS,
  CRAFT_XP_RATE_DEFAULT,
  CRAFTABLE_GEAR_RARITIES,
  REFINE_BASE_YIELD_DEFAULT,
  benchDef,
  catalystForRecipe,
  craftQualityBounds,
  craftUnitXp,
  gearRarityRequiresBench,
  isMaterialInput,
  refineOutputCount,
  type CraftRecipe,
} from '@/content/crafting';
import { GRAMMAR } from '@/lib/pixel/grammar';
import { Rarity } from '@/types/game';
import { buildCraftingActivity } from '@/lib/activity/activityBuilders';
import { useFilterSort } from '@/lib/hooks/useFilterSort';
import { chipClip } from '@/lib/ui/clips';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';

/**
 * The Workshop — crafting's one home, rebuilt on the server job model
 * (crafting-as-occupation, migration 0024).
 *
 * Jobs are server state: they progress only while Crafting is the
 * active action, settle from server timestamps, and pay out at
 * completion (batches, refined materials, gear, XP). This screen is a
 * consumer: it reads the server's workshop view, shows the player's
 * ACTUAL quality bounds and XP rates from the shared content
 * functions, and sends enqueue/cancel/unlock/fit intents. It computes
 * no outcomes and runs no craft timers — progress bars animate the
 * server's numbers between reads, nothing more.
 */

const CATEGORIES: Array<{ key: CraftRecipe['category']; label: string }> = [
  { key: 'survival', label: 'Survival' },
  { key: 'offense', label: 'Offense' },
  { key: 'utility', label: 'Utility' },
  { key: 'refining', label: 'Refining' },
  { key: 'gear', label: 'Gear Frames' },
  { key: 'tools', label: 'Tools' },
];

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

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  return `${secs}s`;
}

function pausedReason(activeActionKind: string | null): string {
  switch (activeActionKind) {
    case 'roaming_loot':
      return "you're roaming";
    case 'boss_prep':
    case 'boss_fight':
      return "you're in a boss fight";
    case 'salvaging':
      return "you're salvaging";
    case 'market_listing':
      return "you're at the market";
    default:
      return "you're away";
  }
}

export const WorkshopScreen: React.FC<{ onNavigate?: (screen: string) => void }> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const workshop = useWorkshopStore();
  const activity = useActivityStore();
  const { account } = useAuth();
  const verified = isVerifiedAccount(account);
  const [expandedMaterials, setExpandedMaterials] = useState(false);
  const [usageMaterialId, setUsageMaterialId] = useState<string | null>(null);
  const [selectedBenchRaw, setSelectedBench] = useState(1);
  const [activityError, setActivityError] = useState<string | null>(null);

  const server = workshop.server;
  const benchesOwned = server?.benches ?? 1;
  const jobs = useMemo(() => server?.jobs ?? [], [server]);
  const activeJobs = useMemo(
    () => jobs.filter((j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused'),
    [jobs],
  );
  const masteries = server?.masteries ?? {};
  const isCrafting = activity.current.kind === 'crafting';

  // The server settles jobs on every state read; refresh on mount,
  // on activity transitions (they settle the outgoing action), and on
  // a light poll while the screen is open.
  const refresh = workshop.refresh;
  useEffect(() => {
    void refresh();
  }, [refresh, activity.current.kind]);
  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Derived clamp: the viewed bench can never exceed ownership.
  const selectedBench = Math.min(selectedBenchRaw, benchesOwned);

  const startCrafting = useCallback(async () => {
    setActivityError(null);
    const head = activeJobs[0];
    const recipe = head ? ALL_CRAFT_RECIPES.find((r) => r.id === head.recipeId) : undefined;
    try {
      await activity.start(
        buildCraftingActivity(recipe ?? { id: 'workshop', name: 'Workshop', category: 'utility' }, head?.bench ?? selectedBench),
      );
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : 'Unable to switch to crafting.');
    }
  }, [activity, activeJobs, selectedBench]);

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
    items: ALL_CRAFT_RECIPES,
    searchFields: [(r: CraftRecipe) => r.name],
    facets: [
      {
        key: 'category',
        label: 'Category',
        values: () => CATEGORIES.map((c) => c.key),
        matches: (item: CraftRecipe, value: string) => item.category === value,
      },
    ],
    sorts: [
      { key: 'level', label: 'Level ↑', compare: (a: CraftRecipe, b: CraftRecipe) => a.requiresLevel - b.requiresLevel },
      { key: 'time', label: 'Time ↑', compare: (a: CraftRecipe, b: CraftRecipe) => a.unitDurationMs - b.unitDurationMs },
      { key: 'name', label: 'Name A-Z', compare: (a: CraftRecipe, b: CraftRecipe) => a.name.localeCompare(b.name) },
    ],
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

  const activeCategories = activeFacets.category ?? new Set<string>();
  const stageBench = benchDef(selectedBench);
  const runningJob = activeJobs.find((j) => j.state === 'running');

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div className="flex items-center justify-between">
        <div className="bl-title text-3xl leading-none text-text-primary">Workshop</div>
        <div className="flex items-center gap-1.5 text-[10px] text-text-muted bg-surface-raised border-2 border-border rounded-full px-2.5 py-1">
          {CRAFT_BENCHES.map((b) => (
            <span
              key={b.bench}
              className={`w-2 h-2 rounded-full ${b.bench > benchesOwned ? 'bg-border' : activeJobs.some((j) => j.bench === b.bench) ? 'bg-amber' : 'bg-green'}`}
            />
          ))}
          <span className="ml-1">{benchesOwned} bench{benchesOwned === 1 ? '' : 'es'}</span>
        </div>
      </div>
      <div className="text-xs text-text-muted">
        Real work, real time: jobs run only while Crafting is your current action, and every unit pays XP and rolls its quality on the server.
      </div>

      {/* The bench stage (§2.9): the selected bench's station, the
          hunter at work while crafting is active; paused jobs sit
          idle-dark under a Paused pennant. */}
      <div className="relative overflow-hidden rounded-lg border-2 border-border">
        <CraftingBenchScene benchSpriteId={stageBench.spriteId} />
        <div className="absolute left-2 top-2 flex gap-1.5">
          {CRAFT_BENCHES.map((b) => {
            const locked = b.bench > benchesOwned;
            const running = activeJobs.some((j) => j.bench === b.bench);
            return (
              <button
                key={b.bench}
                type="button"
                disabled={locked}
                onClick={() => setSelectedBench(b.bench)}
                className={`px-2 py-1 text-[10px] font-black border ${
                  selectedBench === b.bench
                    ? 'bl-primary border-transparent'
                    : 'bg-bg/80 text-text-secondary border-border'
                } ${locked ? 'opacity-50' : ''}`}
                style={chipClip}
              >
                {locked ? <Lock size={10} className="inline" /> : null} {b.name}
                {running ? ' ●' : ''}
              </button>
            );
          })}
        </div>
        {!isCrafting && activeJobs.length > 0 && (
          <div className="absolute right-2 top-2 bg-red/85 text-white text-[10px] font-black px-2 py-1" style={chipClip}>
            ⛳ Paused — {pausedReason(activity.current.kind)}
          </div>
        )}
        {isCrafting && runningJob && (
          <div className="absolute bottom-2 left-2 bg-bg/85 text-amber text-[10px] font-bold px-2 py-1 border border-amber/40" style={chipClip}>
            Working: {runningJob.name} · {runningJob.unitsCompleted}/{runningJob.unitsTotal}
          </div>
        )}
      </div>

      <MobileCard className="space-y-1 border-amber/30 bg-amber/5">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-amber">
          <span style={{ fontSize: '13px' }}>⚙</span> Workshop Activity
        </div>
        <div className="text-[10px] text-text-secondary leading-relaxed">
          {isCrafting
            ? 'You are at the benches — the running job on each bench is progressing now.'
            : 'Jobs pause while you do anything else. Switch to Crafting to work the benches; roaming, boss fights and salvaging all hold the action slot instead.'}
        </div>
        {!isCrafting && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => void startCrafting()}
            disabled={activity.pending}
            className="w-full py-2 rounded-lg bg-amber text-bg text-xs font-bold active:bg-amber/80 transition-colors disabled:opacity-50"
          >
            {activity.pending ? 'Syncing…' : 'Work the Benches'}
          </motion.button>
        )}
        {activityError && <div className="text-[10px] text-red">{activityError}</div>}
        {workshop.error && <div className="text-[10px] text-red">{workshop.error}</div>}
        {!verified && (
          <div className="text-[10px] text-text-secondary leading-relaxed">
            <span className="font-bold text-amber">Guests browse free.</span> Running the benches takes a verified
            account — the vendor sells flat-100% staples meanwhile, and crafted quality above 100% comes from
            verified crafters on the market.
          </div>
        )}
      </MobileCard>

      {server && server.recentCompletions.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted uppercase">Fresh off the bench</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {server.recentCompletions.slice(-4).reverse().map((c, i) => {
              const quality = typeof c.quality === 'number' ? c.quality : null;
              return (
                <div
                  key={`${c.jobId}-${i}`}
                  className="shrink-0 border-2 bg-surface px-2.5 py-2 text-[10px]"
                  style={{ borderColor: quality !== null ? GRAMMAR.qualityEdge(quality) : '#3a3f4a', ...chipClip }}
                >
                  <div className="font-bold text-text-primary">{c.name}</div>
                  <div className="text-text-muted">
                    {quality !== null
                      ? `${quality}% quality · ${getConsumableQualityBand(quality)}`
                      : typeof c.outputMaterial === 'string'
                        ? `${String(c.outputMaterial)} ×${String(c.outputQuantity ?? 0)}`
                        : typeof c.rarity === 'string'
                          ? `${String(c.rarity)} frame${c.tempered ? ' · tempered' : ''}`
                          : 'done'}
                    {typeof c.xp === 'number' ? ` · +${c.xp} XP` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeJobs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted uppercase">Bench Jobs</div>
          {activeJobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              playerLevel={player.level}
              masteries={masteries}
              activeActionKind={server?.activeActionKind ?? null}
              onCancel={(id) => void workshop.cancel(id)}
            />
          ))}
        </div>
      )}

      <BenchAndToolsCard
        benchesOwned={benchesOwned}
        playerLevel={player.level}
        credits={player.credits}
        materials={player.materials}
        tools={server?.tools ?? { owned: {}, fitted: {}, charges: {} }}
        onUnlock={() => void workshop.unlockBench()}
        onFit={(bench, toolId) => void workshop.fitTool(bench, toolId)}
      />

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
                <button
                  key={type}
                  type="button"
                  onClick={() => setUsageMaterialId(type)}
                  className="flex w-full items-center justify-between text-left"
                  aria-label={`${type}: show recipes that use it`}
                >
                  <span className={`truncate ${colorClass}`}>{icon} {type}</span>
                  <span className="font-bold ml-1 text-text-primary">{count}</span>
                </button>
              );
            })}
          </div>
        </MobileCard>
      )}

      {!hasMaterials && (
        <MobileCard className="space-y-2 border-amber/30 bg-amber/5">
          <div className="text-[10px] text-text-secondary">
            <span className="font-bold text-amber">No materials yet!</span> Salvage gear from the Gear tab to get crafting materials and essences.
          </div>
          <motion.button whileTap={{ scale: 0.96 }} onClick={() => onNavigate?.('inventory')} className="w-full py-2 rounded-lg bg-amber/10 border border-amber/30 text-amber text-xs font-bold active:bg-amber/20 transition-colors">
            Go to Gear
          </motion.button>
        </MobileCard>
      )}

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
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value)}
          className="shrink-0 text-[9px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
        >
          <option value="level">Level ↑</option>
          <option value="time">Time ↑</option>
          <option value="name">Name A-Z</option>
        </select>
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
          filteredRecipes.map((recipe) => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              playerLevel={player.level}
              credits={player.credits}
              materials={player.materials}
              essences={player.essences}
              consumables={player.consumables}
              benchesOwned={benchesOwned}
              masteries={masteries}
              jobsOnBench={(bench) => activeJobs.filter((j) => j.bench === bench).length}
              verified={verified}
              onEnqueue={(input) => workshop.enqueue(input)}
            />
          ))
        )}
      </div>

      <MaterialUsageSheet materialId={usageMaterialId} onClose={() => setUsageMaterialId(null)} />
    </div>
  );
};

// ─── Job card (G-3 progress-cause line) ──────────────────────────────

const JobCard: React.FC<{
  job: WorkshopJobView;
  playerLevel: number;
  masteries: Record<string, { level: number; xp: number }>;
  activeActionKind: string | null;
  onCancel: (jobId: string) => void;
}> = ({ job, playerLevel, masteries, activeActionKind, onCancel }) => {
  const recipe = ALL_CRAFT_RECIPES.find((r) => r.id === job.recipeId);
  const xpPerUnit = craftUnitXp(job.unitDurationMs, playerLevel, CRAFT_XP_RATE_DEFAULT);
  const remainingUnits = job.unitsTotal - job.unitsCompleted;
  const bounds = recipe
    ? craftQualityBounds({
        consumableType: recipe.kind === 'consumable' ? recipe.consumableType : null,
        masteryLevel:
          (job.kind === 'gear' || job.kind === 'tool'
            ? masteries['crafting.gear']?.level
            : masteries.crafting_consumables?.level) ?? 1,
        bench: job.bench,
        catalyst: job.catalystMaterialId !== null,
      })
    : null;
  const eats = recipe
    ? Object.entries(recipe.inputs)
        .map(([key, per]) => `${per * remainingUnits} ${getVisualAsset('material', key).label}`)
        .join(' + ')
    : '';
  const progressPct = Math.min(
    100,
    ((job.unitsCompleted + (job.unitDurationMs > 0 ? job.accruedMs / job.unitDurationMs : 0)) / job.unitsTotal) * 100,
  );
  const stateLabel =
    job.state === 'running'
      ? 'Running'
      : job.state === 'queued'
        ? 'Queued'
        : job.state === 'paused'
          ? `Paused — ${pausedReason(activeActionKind)}`
          : job.state;
  return (
    <MobileCard className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-text-muted">
          Bench {job.bench} · {job.name}
          {job.gearRarity ? ` · ${job.gearRarity}` : ''}
          {job.catalystMaterialId ? ` · +${job.catalystMaterialId}` : ''}
        </span>
        <span className={`text-[10px] font-bold ${job.state === 'running' ? 'text-green' : job.state === 'paused' ? 'text-red' : 'text-amber'}`}>
          {stateLabel}
        </span>
      </div>
      <div className="text-[10px] text-text-secondary">
        {formatDuration(job.remainingMs)} left · pays {xpPerUnit} XP/unit
        {bounds && (job.kind === 'consumable' || job.kind === 'gear') ? ` · rolls ${Math.round(bounds.min)}–${Math.round(bounds.max)}%` : ''}
        {eats ? ` · eats ${eats}` : ''}
      </div>
      <div className="flex items-center justify-between text-[10px] text-text-muted">
        <span>{job.unitsCompleted}/{job.unitsTotal} units · {job.xpAwarded} XP banked</span>
        <span className="flex items-center gap-1"><Clock size={10} /> {formatDuration(job.unitDurationMs)}/unit</span>
      </div>
      <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
        <div className="h-full bg-amber rounded-full transition-all" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="flex justify-end">
        <motion.button
          whileTap={{ scale: 0.95 }}
          onClick={() => onCancel(job.id)}
          className="py-1.5 px-3 rounded-lg bg-red/10 border border-red/30 text-red text-[10px] font-bold active:bg-red/20 transition-colors"
        >
          Cancel Job
        </motion.button>
      </div>
      <div className="text-[9px] text-text-muted">
        Cancel refunds unstarted units in full; the unit in progress refunds half its inputs.
      </div>
    </MobileCard>
  );
};

// ─── Benches + tools ─────────────────────────────────────────────────

const BenchAndToolsCard: React.FC<{
  benchesOwned: number;
  playerLevel: number;
  credits: number;
  materials: Record<string, number>;
  tools: { owned: Record<string, boolean>; fitted: Record<string, string | null>; charges: Record<string, number> };
  onUnlock: () => void;
  onFit: (bench: number, toolId: string | null) => void;
}> = ({ benchesOwned, playerLevel, credits, materials, tools, onUnlock, onFit }) => {
  const next = CRAFT_BENCHES.find((b) => b.bench === benchesOwned + 1);
  const nextAffordable =
    next !== undefined &&
    playerLevel >= next.unlockLevel &&
    credits >= next.costCredits &&
    Object.entries(next.costInputs).every(([k, v]) => (materials[k] ?? 0) >= v);
  return (
    <MobileCard className="space-y-2">
      <div className="text-xs font-bold text-amber uppercase">Benches & Tools</div>
      {CRAFT_BENCHES.map((b) => {
        const owned = b.bench <= benchesOwned;
        const fittedTool = tools.fitted[String(b.bench)] ?? null;
        return (
          <div key={b.bench} className="border-t border-border/50 pt-1.5 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-text-primary">
                {b.bench}. {b.name}
                {owned ? '' : ' 🔒'}
              </span>
              {owned ? (
                <span className="text-[10px] text-text-muted">
                  {fittedTool ? `${CRAFT_TOOLS.find((t) => t.id === fittedTool)?.name ?? fittedTool} fitted · ${tools.charges[fittedTool] ?? 0} jobs left` : 'No tool fitted'}
                </span>
              ) : b.bench === benchesOwned + 1 ? (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={onUnlock}
                  disabled={!nextAffordable}
                  className={`py-1 px-2.5 rounded-lg text-[10px] font-bold ${nextAffordable ? 'bg-amber text-bg' : 'bg-surface-raised text-text-muted border border-border'}`}
                >
                  Unlock · {b.costCredits.toLocaleString()}cr
                  {Object.entries(b.costInputs).map(([k, v]) => ` + ${v} ${k}`).join('')}
                </motion.button>
              ) : (
                <span className="text-[10px] text-text-muted">Lv.{b.unlockLevel}</span>
              )}
            </div>
            <div className="text-[10px] text-text-muted">{b.blurb}</div>
            {owned && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {CRAFT_TOOLS.filter((t) => tools.owned[t.id]).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onFit(b.bench, fittedTool === t.id ? null : t.id)}
                    className={`px-2 py-1 text-[9px] font-bold border ${fittedTool === t.id ? 'bl-primary border-transparent' : 'border-border text-text-secondary'}`}
                    style={chipClip}
                  >
                    {fittedTool === t.id ? `Unfit ${t.name}` : `Fit ${t.name}`}
                  </button>
                ))}
                {CRAFT_TOOLS.every((t) => !tools.owned[t.id]) && (
                  <span className="text-[9px] text-text-muted">Craft a tool below to fit it here.</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </MobileCard>
  );
};

// ─── Recipe card ─────────────────────────────────────────────────────

const RecipeCard: React.FC<{
  recipe: CraftRecipe;
  playerLevel: number;
  credits: number;
  materials: Record<string, number>;
  essences: Record<string, number>;
  consumables: Record<string, number>;
  benchesOwned: number;
  masteries: Record<string, { level: number; xp: number }>;
  jobsOnBench: (bench: number) => number;
  verified: boolean;
  onEnqueue: (input: {
    bench: number;
    recipeId: string;
    units: number;
    rarity?: string | null;
    useCatalyst?: boolean;
    useRushTicket?: boolean;
  }) => Promise<boolean>;
}> = ({ recipe, playerLevel, materials, essences, consumables, benchesOwned, masteries, jobsOnBench, verified, onEnqueue }) => {
  const isGear = recipe.kind === 'gear';
  const [rarity, setRarity] = useState<string>('Common');
  const requiredBenchForRarity = isGear ? gearRarityRequiresBench(rarity as Rarity) : 1;
  const minBench = Math.max(recipe.requiresBench, requiredBenchForRarity);
  const [benchSelRaw, setBenchSel] = useState<number>(Math.max(1, minBench));
  const [units, setUnits] = useState(1);
  const [useCatalyst, setUseCatalyst] = useState(false);
  const [useRush, setUseRush] = useState(false);
  const [queuedFlash, setQueuedFlash] = useState(false);

  // Derived floor: the enqueue bench never sits below the recipe's.
  const benchSel = Math.max(benchSelRaw, minBench);

  const catalystId = catalystForRecipe(recipe);
  const def = recipe.consumableType ? CONSUMABLES[recipe.consumableType] : undefined;
  const bounds =
    recipe.kind === 'consumable' || isGear
      ? craftQualityBounds({
          consumableType: recipe.consumableType ?? null,
          masteryLevel:
            (isGear ? masteries['crafting.gear']?.level : masteries.crafting_consumables?.level) ?? 1,
          bench: Math.min(benchSel, benchesOwned),
          catalyst: useCatalyst && catalystId !== null,
        })
      : null;
  const baseDurationMs = isGear
    ? (recipe.durationByRarityMs?.[rarity as keyof typeof recipe.durationByRarityMs] ?? 0)
    : recipe.unitDurationMs;
  const xpPerUnit = craftUnitXp(baseDurationMs, playerLevel, CRAFT_XP_RATE_DEFAULT);
  const refineOut =
    recipe.kind === 'refine'
      ? refineOutputCount(recipe, masteries['crafting.refining']?.level ?? 1, REFINE_BASE_YIELD_DEFAULT)
      : null;

  const inputRows = Object.entries(recipe.inputs).map(([key, per]) => {
    const have = isMaterialInput(key) ? (materials[key] ?? 0) : (essences[key] ?? 0);
    return { key, per, need: per * units, have, enough: have >= per * units };
  });
  const catalystHave = catalystId ? (materials[catalystId] ?? 0) : 0;
  const ticketsOwned = consumables['WorkshopRushTicket'] ?? 0;
  const benchQueueFull = jobsOnBench(benchSel) >= 6;
  const levelLocked = playerLevel < recipe.requiresLevel;
  const benchLocked = benchSel > benchesOwned;
  const masteryLocked =
    recipe.requiresMastery !== undefined &&
    (masteries[recipe.requiresMastery.track]?.level ?? 1) < recipe.requiresMastery.level;
  const epicMasteryLocked = isGear && rarity === 'Epic' && (masteries['crafting.gear']?.level ?? 1) < 10;
  const materialsShort = inputRows.some((r) => !r.enough) || (useCatalyst && catalystHave < units);
  const canEnqueue =
    verified && !levelLocked && !benchLocked && !masteryLocked && !epicMasteryLocked && !materialsShort && !benchQueueFull;
  const disabledReason = !verified
    ? 'Verified account required'
    : levelLocked
      ? `Lv.${recipe.requiresLevel}`
      : benchLocked
        ? `Unlock bench ${benchSel}`
        : masteryLocked
          ? `Mastery ${recipe.requiresMastery?.level}`
          : epicMasteryLocked
            ? 'Epic needs gear mastery 10'
            : benchQueueFull
              ? 'Bench queue full'
              : materialsShort
                ? 'Missing materials'
                : '';

  return (
    <MobileCard className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {def && <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-border bg-bg text-sm font-black">{def.visual.glyph}</span>}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-bold text-text-primary">{recipe.name}</span>
              {recipe.requiresLevel > 1 && (
                <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${levelLocked ? 'bg-red/15 text-red' : 'bg-surface-raised text-text-muted'}`}>Lv.{recipe.requiresLevel}</span>
              )}
              {recipe.requiresBench > 1 && (
                <span className="text-[9px] px-1 py-0.5 rounded font-bold bg-surface-raised text-text-muted">Bench {recipe.requiresBench}+</span>
              )}
            </div>
            <div className="text-[9px] text-amber">
              {recipe.kind === 'refine'
                ? `Refines to ${recipe.outputMaterial} ×${refineOut} per unit at your mastery`
                : bounds
                  ? `Your roll ${Math.round(bounds.min)}–${Math.round(bounds.max)}% · ${getConsumableQualityBand(Math.round(bounds.max))} ceiling`
                  : ''}
            </div>
          </div>
        </div>
        <span className="text-[10px] text-text-muted flex items-center gap-1 shrink-0">
          <Clock size={10} />
          {formatDuration(baseDurationMs)}/unit · ≈{xpPerUnit} XP
        </span>
      </div>

      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
        {inputRows.map(({ key, need, have, enough }) => {
          const colorClass = MATERIAL_COLORS[key] || 'text-text-muted';
          const icon = MATERIAL_ICONS[key] || '';
          return (
            <span key={key} className={`flex items-center gap-0.5 ${enough ? '' : 'text-red-400 line-through'}`}>
              <span className={colorClass}>{icon}</span>
              <span className={enough ? 'text-text-primary' : undefined}>
                {getVisualAsset('material', key).label} {have}/{need}
              </span>
            </span>
          );
        })}
        {useCatalyst && catalystId && (
          <span className={catalystHave >= units ? 'text-text-primary' : 'text-red-400 line-through'}>
            ⚗ {catalystId} {catalystHave}/{units}
          </span>
        )}
      </div>

      {isGear && (
        <div className="flex flex-wrap gap-1.5">
          {CRAFTABLE_GEAR_RARITIES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRarity(r)}
              className={`px-2 py-1 text-[9px] font-black border ${rarity === r ? 'bl-primary border-transparent' : 'border-border text-text-secondary'}`}
              style={chipClip}
            >
              {r}
            </button>
          ))}
          <span className="text-[9px] text-text-muted self-center">Legendary can't be crafted — ever.</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        <label className="flex items-center gap-1 text-text-secondary">
          Bench
          <select
            value={benchSel}
            onChange={(e) => setBenchSel(Number(e.target.value))}
            className="text-[10px] font-bold border border-border bg-surface rounded px-1.5 py-1 text-text-primary"
          >
            {[1, 2, 3].map((b) => (
              <option key={b} value={b} disabled={b < minBench}>
                {b} · {benchDef(b).name}
                {b > benchesOwned ? ' (locked)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 text-text-secondary">
          Units
          <input
            type="number"
            min={1}
            max={500}
            value={units}
            onChange={(e) => setUnits(Math.max(1, Math.min(500, Math.floor(Number(e.target.value) || 1))))}
            className="w-14 text-[10px] font-bold border border-border bg-surface rounded px-1.5 py-1 text-text-primary"
          />
        </label>
        {catalystId && (
          <button
            type="button"
            onClick={() => setUseCatalyst(!useCatalyst)}
            disabled={benchSel < 2}
            className={`px-2 py-1 text-[9px] font-bold border ${useCatalyst ? 'bl-primary border-transparent' : 'border-border text-text-secondary'} disabled:opacity-40`}
            style={chipClip}
            title={benchSel < 2 ? 'Catalysts need the Forge (bench 2)' : `+10/+15 quality bounds, 1 ${catalystId} per unit`}
          >
            ⚗ Catalyst{catalystId ? ` (${catalystId})` : ''}
          </button>
        )}
        <button
          type="button"
          onClick={() => setUseRush(!useRush)}
          disabled={ticketsOwned < 1}
          className={`px-2 py-1 text-[9px] font-bold border ${useRush ? 'bl-primary border-transparent' : 'border-border text-text-secondary'} disabled:opacity-40`}
          style={chipClip}
          title="Escrow one Workshop Rush Ticket: the job runs faster by the ticket's quality"
        >
          🎟 Rush ticket ({ticketsOwned})
        </button>
      </div>

      <motion.button
        whileTap={canEnqueue ? { scale: 0.95 } : {}}
        onClick={() => {
          if (!canEnqueue) return;
          void onEnqueue({
            bench: benchSel,
            recipeId: recipe.id,
            units,
            rarity: isGear ? rarity : null,
            useCatalyst,
            useRushTicket: useRush,
          }).then((ok) => {
            if (ok) {
              setQueuedFlash(true);
              window.setTimeout(() => setQueuedFlash(false), 900);
            }
          });
        }}
        disabled={!canEnqueue}
        className={`w-full py-1.5 rounded-lg text-[10px] font-bold transition-all ${
          canEnqueue
            ? `bg-amber text-bg active:bg-amber/80 cursor-pointer ${queuedFlash ? 'ring-2 ring-amber/80' : ''}`
            : 'bg-surface-raised text-text-muted border border-border cursor-not-allowed'
        }`}
      >
        {canEnqueue ? (queuedFlash ? '✓ Queued!' : 'QUEUE JOB') : disabledReason}
      </motion.button>
    </MobileCard>
  );
};
