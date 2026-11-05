import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import { motion } from 'framer-motion';
import { Clock, ChevronDown, Search, X } from 'lucide-react';
import { useActivityStore, useAnnouncementsStore, useLoadoutStore, usePlayerStore, useWorkshopStore } from '@/store';
import { TintPanel } from '@/components/workshop/TintPanel';
import { MobileCard } from '@/components/layout/MobileCard';
import { ChipRail } from '@/components/common/ChipRail';
import { MaterialUsageSheet } from '@/components/common/MaterialUsageSheet';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { getVisualAsset } from '@/constants/visualAssets';
import { CONSUMABLES, getConsumableQualityBand } from '@/constants/consumables';
import {
  ALL_CRAFT_RECIPES,
  BENCH_TIME_BANK_CAP_SECONDS,
  BENCH_TIME_GRANT_SECONDS,
  CRAFT_RELICS,
  CRAFT_XP_RATE_DEFAULT,
  QUEUED_JOBS_PER_BENCH,
  RUNNING_JOBS_ON_BENCH,
  CRAFTABLE_GEAR_RARITIES,
  REFINE_BASE_YIELD_DEFAULT,
  benchDef,
  catalystForRecipe,
  craftQualityBounds,
  craftUnitXp,
  isMaterialInput,
  refineOutputCount,
  refineOutputRange,
  type CraftRecipe,
} from '@/content/crafting';
import { GRAMMAR } from '@/lib/pixel/grammar';
import { Rarity, SkillTreeType } from '@/types/game';
import {
  fireOverclockWorkshop,
  getActionSkillState,
  getResearchState,
  getStandingState,
  newActionSkillNonce,
} from '@/lib/chef/chefClient';
import {
  ACTION_SKILL_CHARGE_MAX,
  type ActionSkillStateView,
} from '@/content/actionSkills';
import { buildCraftingActivity } from '@/lib/activity/activityBuilders';
import { useFilterSort } from '@/lib/hooks/useFilterSort';
import { chipClip } from '@/lib/ui/clips';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import {
  QUALITY_BAND_KEY,
  countCraftableNow,
  deriveRecipeReadiness,
  inputLabel,
  masteryTrackLabel,
  recipeSearchText,
  type RecipeClassification,
  type RecipeReadiness,
  type WorkshopPlayerContext,
} from '@/lib/workshop/readiness';
import { GateLines, RecipeInspectSheet, SourceLine } from '@/components/workshop/RecipeDetail';
import { isServiceLaneJob } from '@/components/workshop/RepairServiceSection';
import { QuickBuyPlus } from '@/components/quickbuy/QuickBuyPlus';
import { humanizeWorkshopError } from '@/lib/workshop/errors';
import { resolvedRecipeInputs } from '@/lib/workshop/recipeCosts';
import { canUseRewardedBenchTimeAds, showRewardedBenchTimeAd } from '@/lib/ads/rewardedBenchTimeAd';

/**
 * The Workshop — crafting's one home, rebuilt on the server job model
 * (crafting-as-occupation, migration 0024) and redesigned under
 * Direction A, "Make-now first" (owner-approved 2026-11-03).
 *
 * The catalog leads, ordered by readiness — Craftable now → One gate
 * away → Locked — with the craftable count, the player's standing,
 * and the bench state printed above it, because the gates read
 * those numbers. Since the bench collapse (economy slice 9) there
 * is ONE bench — always owned, no tiers — and the old workshop
 * tools live on as named relics, equipped on the hunter. Every recipe card carries its purpose, its quality
 * definition, every gate (met or failing), per-shortfall sources
 * with doors, and the pre-queue totals. Jobs are server state: they
 * progress only while Crafting is the active action, settle from
 * server timestamps, and pay out at completion. This screen is a
 * consumer: readiness here is display derivation over live state
 * (src/lib/workshop/readiness.ts); the Chef re-checks every gate at
 * enqueue and remains the authority.
 */

const CATEGORIES: Array<{ key: CraftRecipe['category']; label: string }> = [
  { key: 'survival', label: 'Survival' },
  { key: 'offense', label: 'Offense' },
  { key: 'utility', label: 'Utility' },
  { key: 'refining', label: 'Refining' },
  { key: 'gear', label: 'Gear Frames' },
  { key: 'cosmetics', label: 'Skin Parts' },
];

const CATEGORY_ICONS: Record<CraftRecipe['category'], PxIconName> = {
  survival: 'cross',
  offense: 'gun',
  utility: 'cog',
  refining: 'recycle',
  gear: 'anvil',
  cosmetics: 'swirl',
};

const SECTIONS: Array<{ key: RecipeClassification; title: string; hint: string; tone: string }> = [
  { key: 'craftable', title: 'Craftable now', hint: 'materials in hand, every gate met', tone: 'text-green' },
  { key: 'one-gate', title: 'One gate away', hint: 'the card names the gate and the way through', tone: 'text-amber' },
  { key: 'locked', title: 'Locked', hint: 'every failing gate is printed — nothing hides', tone: 'text-red' },
];

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  return `${secs}s`;
}

/** Banked bench time in the game's compact hand: 7 h 25 m · 25 m · 0 m. */
function formatBankTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  if (hours > 0) return `${hours} h ${mins} m`;
  return `${mins} m`;
}

/** Compact per-unit / totals durations in the mock's hand: 12m, 1h30, 4h. */
function formatDurationShort(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  return `${mins}m`;
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


/**
 * OverclockBar — the Fixer signature's workshop face (0030, brief
 * §3.7): the G-3 charge track under the bench stage. One pool, shared
 * with the combat fire; the workshop fire instantly completes the
 * in-progress unit on every active bench through the normal settler
 * — it buys time, never output. Renders only for players whose
 * active signature is Overclock (a hint for Fixer-qualified players
 * who selected another tree).
 */
const OverclockBar: React.FC = () => {
  const workshop = useWorkshopStore();
  const [view, setView] = useState<ActionSkillStateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    getActionSkillState()
      .then((r) => setView(r.actionSkill))
      .catch(() => { /* no bar without the server's word */ });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (!view) return null;
  if (view.selected !== SkillTreeType.Fixer) {
    if (!view.qualified.includes(SkillTreeType.Fixer)) return null;
    return (
      <div className="text-[11px] text-text-muted" data-testid="overclock-hint">
        <span className="inline-flex items-center gap-1"><PxIcon name="hammer" size={13} /> Overclock is yours to select — make Fixer your active signature in the Skill Trees screen to charge it here.</span>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, (view.charge / ACTION_SKILL_CHARGE_MAX) * 100));
  const fire = async () => {
    if (busy || !view.charged) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await fireOverclockWorkshop({ nonce: newActionSkillNonce('workshop') });
      setNote(`Overclock fired — ${result.completions.length} unit${result.completions.length === 1 ? '' : 's'} completed instantly, at full quality and XP.`);
      await workshop.refresh();
      load();
    } catch (err) {
      setNote(humanizeWorkshopError(err));
      load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="space-y-2 rounded-lg border-2 p-3"
      style={{ borderColor: '#2EC4B666', backgroundColor: '#2EC4B60d' }}
      data-testid="overclock-bar"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PxIcon name="hammer" size={17} style={{ color: '#2EC4B6' }} />
          <div className="text-xs font-black text-text-primary">Overclock</div>
        </div>
        <div className="font-mono text-[11px] font-black text-text-primary" data-testid="overclock-charge-label">
          {Math.floor(view.charge)}/{ACTION_SKILL_CHARGE_MAX}
        </div>
      </div>
      {/* G-3 charge track in the Fixer teal */}
      <div className="relative h-3 overflow-hidden border-2 border-border bg-bg" data-testid="overclock-charge-track">
        <div
          className="absolute inset-y-0 left-0"
          style={{ width: `${pct}%`, backgroundColor: '#2EC4B6' }}
          data-testid="overclock-charge-fill"
        />
        <span className="absolute inset-y-0 flex items-center" style={{ left: `calc(${pct}% - 8px)`, color: '#2EC4B6' }}>
          <PxIcon name="hammer" size={13} />
        </span>
      </div>
      <div className="text-[11px] text-text-muted">
        Overclock — fills as your bench and bay complete work. Firing completes the in-progress unit on the bench, instantly, at full quality and XP.
      </div>
      <button
        type="button"
        data-testid="overclock-fire"
        onClick={() => void fire()}
        disabled={!view.charged || busy}
        className="bl-primary w-full py-2 text-[11px] font-black uppercase tracking-wider disabled:opacity-50"
        style={view.charged ? { backgroundColor: '#2EC4B6', color: '#050608' } : undefined}
      >
        {busy ? 'Firing…' : view.charged ? <span className="inline-flex items-center gap-1"><PxIcon name="hammer" size={13} /> Fire Overclock</span> : 'Overclock charging…'}
      </button>
      {note && <div className="text-[11px] text-text-secondary" data-testid="overclock-note">{note}</div>}
    </div>
  );
};

export const WorkshopScreen: React.FC<{
  onNavigate?: (screen: string) => void;
  /**
   * Crafting consolidation (owner ruling 2026-11-04): the bench's
   * canonical home is Home's Craft workspace, where this screen
   * renders EMBEDDED — no page chrome, no animated bench scene
   * (one-stage law: the main stage carries the scene), no Workshop
   * Activity card (the workspace's truth banner carries the paused
   * state + remedy at the top), and the Bench Jobs list covers the
   * craft lane only (service-lane jobs render in the Repairs &
   * Service section). Standalone rendering (screen tests) keeps the
   * full page.
   */
  embedded?: boolean;
}> = ({ onNavigate, embedded = false }) => {
  const player = usePlayerStore();
  const workshop = useWorkshopStore();
  // Bench-ready suppression (eye-leading pass): while the bench
  // itself is on screen, job completions already read here — the
  // announcements store must not ALSO raise the bench-ready chip.
  const setBenchInView = useAnnouncementsStore((s) => s.setBenchInView);
  useEffect(() => {
    setBenchInView(true);
    return () => setBenchInView(false);
  }, [setBenchInView]);
  const activity = useActivityStore();
  const loadout = useLoadoutStore();
  // Real-item invariant: the bench hunter carries the player's actual
  // weapon state — unequipped renders the gun-free rig.
  const hunterWeapon = loadout.getWeapon('primary') ?? loadout.getWeapon('secondary') ?? loadout.getWeapon('heavy');
  // Crafting is open to every account, guests included (Michael's
  // ruling, 2026-11-01; server gate removed in migration 0048) — the
  // Workshop carries no verified-account gate.
  // Manufacturer Standing (0043): exclusive recipes gate on the
  // maker's granted rank (server enforces in cc_enqueue_craft_job;
  // this read drives the card's lock chip so the refusal is visible
  // before the tap, never a surprise error).
  const [standingRanks, setStandingRanks] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    getStandingState()
      .then((result) => {
        if (cancelled) return;
        const ranks: Record<string, number> = {};
        for (const m of result.standing.manufacturers) ranks[m.manufacturer] = m.rank;
        setStandingRanks(ranks);
      })
      .catch(() => {
        // Chef unreachable: cards treat standing recipes as locked.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Research state (Direction A): Production Systems completion is a
  // gate on the batch recipes — read it from the Chef like every
  // other standing. A failed read leaves the set null, and null
  // reads as NOT completed: the gate stays shut, in human words.
  const [researchCompletedIds, setResearchCompletedIds] = useState<ReadonlySet<string> | null>(null);
  const [productionSystemsStatus, setProductionSystemsStatus] = useState<'complete' | 'in progress' | 'not taken' | 'unknown'>('unknown');
  useEffect(() => {
    let cancelled = false;
    getResearchState()
      .then((result) => {
        if (cancelled) return;
        const done = new Set<string>();
        for (const course of result.research.courses) {
          if (course.status === 'completed') done.add(course.id);
        }
        setResearchCompletedIds(done);
        const ps = result.research.courses.find((c) => c.id === 'production_systems');
        setProductionSystemsStatus(
          ps?.status === 'completed' ? 'complete' : ps?.status === 'enrolled' ? 'in progress' : 'not taken',
        );
      })
      .catch(() => {
        if (cancelled) return;
        setResearchCompletedIds(null);
        setProductionSystemsStatus('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [expandedMaterials, setExpandedMaterials] = useState(false);
  const [usageMaterialId, setUsageMaterialId] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [craftableOnly, setCraftableOnly] = useState(false);
  const [refineFocusId, setRefineFocusId] = useState<string | null>(null);
  const benchesRef = useRef<HTMLDivElement | null>(null);

  const server = workshop.server;
  const benchesOwned = server?.benches ?? 1;
  const jobs = useMemo(() => server?.jobs ?? [], [server]);
  const activeJobs = useMemo(
    () => jobs.filter((j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused'),
    [jobs],
  );
  // Embedded (Home Craft workspace): the Bench Jobs list and the
  // bench strip speak for the CRAFT lane — service-lane jobs have
  // their own section below the bench. Readiness/capacity math
  // keeps reading activeJobs whole (service jobs share the bench).
  const benchJobs = useMemo(
    () => (embedded ? activeJobs.filter((j) => !isServiceLaneJob(j)) : activeJobs),
    [activeJobs, embedded],
  );
  const masteries = useMemo(() => server?.masteries ?? {}, [server]);
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

  // Bench collapse (slice 9): the viewed bench is the only bench.
  const selectedBench = 1;

  const startCrafting = useCallback(async () => {
    setActivityError(null);
    const head = activeJobs[0];
    const recipe = head ? ALL_CRAFT_RECIPES.find((r) => r.id === head.recipeId) : undefined;
    try {
      await activity.start(
        buildCraftingActivity(recipe ?? { id: 'workshop', name: 'Workshop', category: 'utility' }, head?.bench ?? selectedBench),
      );
    } catch (error) {
      setActivityError(humanizeWorkshopError(error));
    }
  }, [activity, activeJobs, selectedBench]);

  // The one live context every readiness derivation reads — the
  // chip count, the section order, and the cards all derive from
  // this, so they can never disagree with each other.
  const ctx: WorkshopPlayerContext = useMemo(
    () => ({
      playerLevel: player.level,
      scrap: player.scrap,
      materials: player.materials,
      essences: player.essences,
      consumables: player.consumables,
      benchesOwned,
      masteries,
      standingRanks,
      researchCompletedIds,
      activeJobs: activeJobs.map((j) => ({ bench: j.bench, recipeId: j.recipeId })),
      // Econ 7: readiness + card costs resolve through the server's
      // per-recipe Scrap map (§4.4 of the economy brief).
      recipeScrapCosts: server?.recipeScrapCosts,
      // Econ 10: the queue gate reads the server's live envelope
      // capacity (bench time widens it), not the baseline constant.
      benchCapacity: server?.benchTime?.capacity,
    }),
    [player.level, player.scrap, player.materials, player.essences, player.consumables, benchesOwned, masteries, standingRanks, researchCompletedIds, activeJobs, server],
  );

  const genericRecipes = useMemo(() => ALL_CRAFT_RECIPES.filter((r) => !r.tintCraft), []);
  const readinessById = useMemo(() => {
    const map = new Map<string, RecipeReadiness>();
    for (const recipe of genericRecipes) map.set(recipe.id, deriveRecipeReadiness(recipe, ctx));
    return map;
  }, [genericRecipes, ctx]);
  const craftableCount = useMemo(() => countCraftableNow(genericRecipes, ctx), [genericRecipes, ctx]);

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
    // The tint craft is enqueued only by the TintPanel (it targets
    // an owned part) — never through the generic recipe list. The
    // catalog total on the All chip counts it: the TintPanel below
    // is its card, so All (87) is the whole catalog, tint included.
    items: genericRecipes,
    searchFields: [
      (r: CraftRecipe) => r.name,
      (r: CraftRecipe) => recipeSearchText(r, ctx),
    ],
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

  const visibleRecipes = useMemo(
    () => (craftableOnly ? filteredRecipes.filter((r) => readinessById.get(r.id)?.classification === 'craftable') : filteredRecipes),
    [filteredRecipes, craftableOnly, readinessById],
  );
  const grouped = useMemo(
    () =>
      SECTIONS.map((section) => ({
        ...section,
        recipes: visibleRecipes.filter((r) => readinessById.get(r.id)?.classification === section.key),
      })).filter((section) => section.recipes.length > 0),
    [visibleRecipes, readinessById],
  );

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

  const activeCategories = useMemo(() => activeFacets.category ?? new Set<string>(), [activeFacets.category]);
  const stageBench = benchDef(1);
  const runningJob = activeJobs.find((j) => j.state === 'running');
  const runningBenchJobs = activeJobs.filter((j) => j.state === 'running' && j.bench === 1);
  const benchJobCount = benchJobs.filter((j) => j.bench === 1).length;
  const stripRunningJob = benchJobs.find((j) => j.state === 'running');
  const stripRunningBenchJobs = benchJobs.filter((j) => j.state === 'running' && j.bench === 1);

  // Bench time (slice 10, brief §8): the bank and the envelope from
  // the server view; the content constants stand in until the first
  // read lands (baseline shape — the op stays the authority).
  const benchTime = server?.benchTime;
  const bankedSeconds = benchTime?.bankedSeconds ?? 0;
  const bankCapSeconds = benchTime?.capSeconds ?? BENCH_TIME_BANK_CAP_SECONDS;
  const bankGrantSeconds = benchTime?.grantSeconds ?? BENCH_TIME_GRANT_SECONDS;
  const bankFull = bankedSeconds >= bankCapSeconds;
  const benchAdsReady = canUseRewardedBenchTimeAds();
  const grantLabel = bankGrantSeconds % 3600 === 0 ? `${bankGrantSeconds / 3600} h` : formatBankTime(bankGrantSeconds);
  const [benchEarnPending, setBenchEarnPending] = useState(false);
  const [benchEarnError, setBenchEarnError] = useState<string | null>(null);
  const handleEarnBenchTime = useCallback(async () => {
    if (benchEarnPending) return;
    setBenchEarnError(null);
    setBenchEarnPending(true);
    try {
      const reward = await showRewardedBenchTimeAd(player.id);
      await workshop.bankBenchTime(reward.adUnitId);
    } catch {
      // The ad did not complete — dismissed, no fill, or ads not
      // serving right now: nothing was banked, and the panel says
      // so plainly rather than pretending an hour landed.
      setBenchEarnError('The ad did not complete, so no bench time was banked. Ads may be unavailable right now — try again later.');
    } finally {
      setBenchEarnPending(false);
    }
  }, [benchEarnPending, player.id, workshop]);

  const openBenches = useCallback(() => {
    benchesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const focusRefineRecipe = useCallback(
    (recipeId: string) => {
      // The producing recipe lives in the Refining lane: clear the
      // readiness/category/search filters so it is on the page,
      // then scroll its card into view and mark it.
      setCraftableOnly(false);
      clearFacets();
      setRefineFocusId(recipeId);
    },
    [clearFacets],
  );
  useEffect(() => {
    if (!refineFocusId) return;
    const el = document.getElementById(`workshop-recipe-${refineFocusId}`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [refineFocusId, grouped]);

  const clearCategory = useCallback(() => {
    for (const key of Array.from(activeCategories)) toggleFacet('category', key);
  }, [activeCategories, toggleFacet]);

  return (
    <div className={embedded ? 'space-y-4' : 'bl-page p-4 space-y-4 pb-20'}>
      {!embedded && (
        <>
          <div className="flex items-center justify-between">
            <div className="bl-title text-3xl leading-none text-text-primary">Workshop</div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted bg-surface-raised border-2 border-border rounded-full px-2.5 py-1">
              <span className={`w-2 h-2 rounded-full ${activeJobs.length > 0 ? 'bg-amber' : 'bg-green'}`} />
              <span className="ml-1">The bench — {activeJobs.length > 0 ? 'working' : 'ready'}</span>
            </div>
          </div>
          <div className="text-xs text-text-muted">
            Turn raw drops into kits, ammo and real gear. <span className="font-bold text-text-secondary">Crafted items roll a quality %</span> — over 100% beats the Vendor’s flat 100. Jobs advance only while Crafting is your action.
          </div>
        </>
      )}

      {/* The first controls (Direction A): what can I make, right
          now — the craftable filter, the whole catalog, and search
          over name, job, or material. */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="craftable-now-chip"
            onClick={() => setCraftableOnly(true)}
            className={`shrink-0 px-3 py-2 text-[11px] font-black border ${craftableOnly ? 'bl-primary border-transparent' : 'border-border bg-surface text-text-secondary'}`}
            style={chipClip}
          >
            Craftable now <span className="font-black">{craftableCount}</span>
          </button>
          <button
            type="button"
            data-testid="all-recipes-chip"
            onClick={() => setCraftableOnly(false)}
            className={`shrink-0 px-3 py-2 text-[11px] font-black border ${!craftableOnly ? 'bl-primary border-transparent' : 'border-border bg-surface text-text-secondary'}`}
            style={chipClip}
          >
            All {ALL_CRAFT_RECIPES.length}
          </button>
          <div className="relative min-w-[140px] flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, job or material…"
              className="w-full h-9 pl-8 pr-8 rounded-lg border border-border bg-surface-raised text-xs text-text-primary placeholder:text-text-muted"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
            Sort
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              className="text-[11px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1 text-text-primary"
            >
              <option value="level">Level ↑</option>
              <option value="time">Time ↑</option>
              <option value="name">Name A-Z</option>
            </select>
          </label>
          {(hasActiveFilters || craftableOnly) && (
            <button
              type="button"
              onClick={() => {
                clearFacets();
                setCraftableOnly(false);
              }}
              className="text-[11px] font-black text-red hover:text-red/80 shrink-0"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Standing strip: the numbers the gates read, printed where
          the player can see them before a card ever refuses. */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Your standing — the gates read these</div>
        <div className="flex flex-wrap gap-1.5">
          {(['crafting_consumables', 'crafting.refining', 'crafting.gear', 'crafting.cosmetics'] as const).map((track) => (
            <span key={track} className="inline-flex items-center gap-1 border border-border bg-surface px-2 py-1 text-[11px] text-text-secondary" style={chipClip}>
              <PxIcon name="star" size={13} className="text-amber" />
              {track === 'crafting_consumables' ? 'Mastery · Consumables' : masteryTrackLabel(track)}
              <span className="font-black text-text-primary">{masteries[track]?.level ?? 1}</span>
            </span>
          ))}
          <span className={`inline-flex items-center gap-1 border px-2 py-1 text-[11px] ${productionSystemsStatus === 'complete' ? 'border-border bg-surface text-text-secondary' : 'border-amber/50 bg-amber/10 text-text-secondary'}`} style={chipClip}>
            <PxIcon name="book" size={13} className="text-amber" />
            Research · Production Systems
            <span className="font-black text-text-primary">{productionSystemsStatus}</span>
            {productionSystemsStatus !== 'complete' && (
              <button type="button" onClick={() => onNavigate?.('research')} className="ml-1 inline-flex items-center gap-0.5 font-black text-amber">
                Open <PxIcon name="chevR" size={13} />
              </button>
            )}
          </span>
        </div>
      </div>

      {/* The bench strip (slice 9 collapse): ONE bench, always
          owned — its state, and the queue envelope in words. */}
      <div className="space-y-1">
        <div className="border border-border bg-surface px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-black text-text-primary">
            <span className={`h-2 w-2 shrink-0 rounded-full ${benchJobs.length > 0 ? 'bg-amber' : 'bg-green'}`} />
            The Bench
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-text-muted">
            {benchJobs.length > 0
              ? stripRunningBenchJobs.length > 1
                ? `Working · ${stripRunningBenchJobs.length} jobs running on the bench`
                : `Working · ${stripRunningJob?.name ?? benchJobs[0]?.name ?? 'job running'}`
              : 'Idle · ready'}
          </div>
        </div>

        {/* Bench time (slice 10, brief §8): the bank, the drain
            state, and the one earn door — a rewarded ad watched in
            the app (§8.7). Every refusal here prints its remedy. */}
        <div className="border border-border bg-surface px-2 py-1.5" data-testid="bench-time-panel">
          <div className="flex items-start justify-between gap-2">
            <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-black text-text-primary">
              <PxIcon name="clock" size={17} className={benchTime?.wideActive ? 'text-amber' : 'text-text-muted'} />
              <span className="whitespace-nowrap">Bench time</span>
              <span className="whitespace-nowrap">{formatBankTime(bankedSeconds)}</span>
              <span className="whitespace-nowrap font-bold text-text-muted">/ {formatBankTime(bankCapSeconds)}</span>
              {benchTime?.wideActive && runningBenchJobs.length >= 2 && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap font-bold text-cyan">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
                  Draining
                </span>
              )}
            </span>
            {bankFull ? (
              <button
                type="button"
                disabled
                className="shrink-0 whitespace-nowrap border border-border bg-surface px-2.5 py-2 text-[11px] font-black text-text-muted disabled:opacity-60"
                style={chipClip}
              >
                Bank full
              </button>
            ) : (
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => void handleEarnBenchTime()}
                disabled={benchEarnPending || !benchAdsReady}
                className="shrink-0 whitespace-nowrap border border-amber/50 bg-amber/10 px-2.5 py-2 text-[11px] font-black text-amber transition-colors active:bg-amber/20 disabled:opacity-50"
                style={chipClip}
              >
                {benchEarnPending ? 'Showing ad…' : `Watch ad · +${grantLabel}`}
              </motion.button>
            )}
          </div>
          <div className="mt-0.5 text-[11px] leading-snug text-text-muted">
            {benchTime?.wideActive
              ? runningBenchJobs.length >= 2
                ? 'The extra lanes are working — banked time drains while 2 or more jobs run. One job alone never drains it.'
                : 'The wide bench holds while time remains. It drains only while 2 or more jobs run — one job is baseline and free.'
              : 'Bank an hour and the bench runs 3 jobs at once, 15 queued, until the bank runs dry. Running dry never stops a job mid-craft.'}
          </div>
          {bankFull && (
            <div className="mt-0.5 text-[11px] leading-snug text-text-secondary">
              Bench time bank full — {formatBankTime(bankCapSeconds)}. It drains while the extra lanes work; bank more once it drops.
            </div>
          )}
          {!bankFull && !benchAdsReady && (
            <div className="mt-0.5 text-[11px] leading-snug text-text-secondary">
              Bench time is earned by watching ads in the app.
            </div>
          )}
          {benchEarnError && <div className="mt-0.5 text-[11px] leading-snug text-red">{benchEarnError}</div>}
        </div>

        <div className="text-[11px] text-text-muted">
          {benchTime?.wideActive
            ? `${benchTime.runningLimit} jobs run at a time while bench time lasts; ${benchTime.queueLimit} more may queue. Quality comes from mastery, catalysts — and the relic you wear.`
            : 'One job runs at a time; 5 more may queue (a Fixer keystone queues more). Quality comes from mastery, catalysts — and the relic you wear.'}
        </div>
      </div>

      {/* Category rail — sticky, scrolls rather than shrinking. */}
      <div className="sticky top-0 z-20 -mx-4 bg-bg px-4 py-1.5">
        <ChipRail>
          <button
            type="button"
            onClick={clearCategory}
            className={`shrink-0 py-2 px-3 text-[11px] font-black border transition-colors ${
              activeCategories.size === 0
                ? 'bl-primary border-transparent'
                : 'bl-secondary text-text-secondary border-border bg-surface hover:bg-surface hover:text-text-primary'
            }`}
            style={chipClip}
          >
            All
          </button>
          {CATEGORIES.map(({ key, label }) => {
            const active = activeCategories.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleFacet('category', key)}
                className={`shrink-0 py-2 px-3 text-[11px] font-black border transition-colors ${
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
      </div>

      {/* The catalog, sectioned by readiness. The quality band key
          rides in flow between Craftable now and One gate away. */}
      <div className="space-y-4">
        {visibleRecipes.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-xs">
            {hasActiveFilters || craftableOnly ? 'No recipes match your search or filter.' : 'No recipes in this category.'}
          </div>
        ) : (
          grouped.map((section, sectionIndex) => (
            <React.Fragment key={section.key}>
              <div className="space-y-2" data-testid={`workshop-section-${section.key}`}>
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-[13px] font-black uppercase tracking-wide ${section.tone}`}>{section.title}</span>
                  <span className="text-[13px] font-black text-text-primary">{section.recipes.length}</span>
                  <span className="text-[11px] text-text-muted">{section.hint}</span>
                </div>
                {section.recipes.map((recipe) => (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    ctx={ctx}
                    readiness={readinessById.get(recipe.id)}
                    consumables={player.consumables}
                    onEnqueue={(input) => workshop.enqueue(input)}
                    onNavigate={onNavigate}
                    onOpenBenches={openBenches}
                    onRefineFocus={focusRefineRecipe}
                    highlighted={refineFocusId === recipe.id}
                  />
                ))}
              </div>
              {sectionIndex === 0 && grouped.length > 1 && <QualityBandKey />}
            </React.Fragment>
          ))
        )}
      </div>

      <TintPanel onNavigate={onNavigate} onRefineFocus={focusRefineRecipe} />

      <div className="text-[11px] text-text-muted">
        {ALL_CRAFT_RECIPES.length} recipes in the catalog · sorted Craftable → One gate away → Locked. Sorts: Level · Time · Name.
      </div>

      {/* The bench stage (§2.9): the bench's station, the hunter at
          work while crafting is active; paused jobs sit idle-dark
          under a Paused pennant. Standalone only — embedded in
          Home's Craft workspace the one-stage law gives the scene
          to the main stage, and the paused truth rides the
          workspace's banner + the job cards' state labels. */}
      {!embedded && (
      <div className="relative overflow-hidden rounded-lg border-2 border-border">
        <CraftingBenchScene benchSpriteId={stageBench.spriteId} unarmed={!hunterWeapon} />
        <div className="absolute left-2 top-2 flex gap-1.5">
          <span className="px-2 py-1 text-[11px] font-black border bg-bg/80 text-text-secondary border-border" style={chipClip}>
            The Bench
            {runningJob ? <span className="ml-1 inline-flex align-middle"><PxIcon name="dot" size={13} /></span> : ''}
          </span>
        </div>
        {!isCrafting && activeJobs.length > 0 && (
          <div className="absolute right-2 top-2 bg-red/85 text-white text-[11px] font-black px-2 py-1" style={chipClip}>
            <span className="inline-flex items-center gap-1"><PxIcon name="flag" size={13} /> Paused — {pausedReason(activity.current.kind)}</span>
          </div>
        )}
        {isCrafting && runningJob && (
          <div className="absolute bottom-2 left-2 bg-bg/85 text-amber text-[11px] font-bold px-2 py-1 border border-amber/40" style={chipClip}>
            Working: {runningJob.name} · {runningJob.unitsCompleted}/{runningJob.unitsTotal}
          </div>
        )}
      </div>
      )}

      {/* Overclock (0030): the Fixer signature's charge track lives
          directly under the bench stage it accelerates. */}
      <OverclockBar />

      {/* The Workshop Activity card is the standalone page's paused
          truth + remedy. Embedded, the Craft workspace's banner at
          the top carries both — this card would only re-narrate
          them (no-redundant-state law) — but a workshop error
          (a refused enqueue/cancel) still prints in place. */}
      {embedded && workshop.error && <div className="text-[11px] text-red">{workshop.error}</div>}
      {!embedded && (
      <MobileCard className="space-y-1 border-amber/30 bg-amber/5">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-amber">
          <PxIcon name="cog" size={13} /> Workshop Activity
        </div>
        <div className="text-[11px] text-text-secondary leading-relaxed">
          {isCrafting
            ? 'You are at the bench — the running job is progressing now.'
            : 'Jobs pause while you do anything else. Switch to Crafting to work the bench; roaming, boss fights and salvaging all hold the action slot instead.'}
        </div>
        {!isCrafting && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => void startCrafting()}
            disabled={activity.pending}
            className="w-full py-2 rounded-lg bg-amber text-bg text-xs font-bold active:bg-amber/80 transition-colors disabled:opacity-50"
          >
            {activity.pending ? 'Syncing…' : 'Work the Bench'}
          </motion.button>
        )}
        {activityError && <div className="text-[11px] text-red">{activityError}</div>}
        {workshop.error && <div className="text-[11px] text-red">{workshop.error}</div>}
      </MobileCard>
      )}

      {server && server.recentCompletions.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted uppercase">Fresh off the bench</div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {server.recentCompletions.slice(-4).reverse().map((c, i) => {
              const quality = typeof c.quality === 'number' ? c.quality : null;
              return (
                <div
                  key={`${c.jobId}-${i}`}
                  className="shrink-0 border-2 bg-surface px-2.5 py-2 text-[11px]"
                  style={{ borderColor: quality !== null ? GRAMMAR.qualityEdge(quality) : '#3a3f4a', ...chipClip }}
                >
                  <div className="font-bold text-text-primary">{c.name}</div>
                  <div className="text-text-muted">
                    {quality !== null
                      ? `${quality}% quality · ${getConsumableQualityBand(quality)}`
                      : typeof c.outputMaterial === 'string'
                        ? `${getVisualAsset('material', c.outputMaterial).label} ×${String(c.outputQuantity ?? 0)}`
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

      {benchJobs.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-text-muted uppercase">
            Bench Jobs
            {benchTime ? (
              <span className="ml-1.5 font-bold normal-case text-text-muted">
                {benchJobCount} of {benchTime.capacity} bench spaces
                {benchTime.wideActive ? ' · widened by bench time' : ''}
              </span>
            ) : null}
          </div>
          {benchJobs.map((job) => (
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

      <div ref={benchesRef} id="workshop-bench" className="scroll-mt-4">
        <BenchCard />
      </div>

      {hasMaterials && (
        <MobileCard className="space-y-2">
          <button onClick={() => setExpandedMaterials(!expandedMaterials)} className="w-full flex items-center justify-between text-xs font-bold text-amber uppercase">
            <span>Materials & Essences ({sortedMaterials.length})</span>
            <motion.span animate={{ rotate: expandedMaterials ? 180 : 0 }} transition={{ duration: 0.2 }}>
              <ChevronDown size={14} />
            </motion.span>
          </button>
          <div className={`grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] overflow-hidden transition-all ${expandedMaterials ? 'max-h-[500px] opacity-100' : 'max-h-16 opacity-70'}`}>
            {sortedMaterials.slice(0, expandedMaterials ? sortedMaterials.length : 4).map(([type, count]) => {
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setUsageMaterialId(type)}
                  className="flex w-full items-center justify-between text-left"
                  aria-label={`${getVisualAsset('material', type).label}: show recipes that use it`}
                >
                  <span className="inline-flex items-center gap-1 truncate text-text-secondary"><PixelMaterial id={type} density="thumb" size={13} /> {getVisualAsset('material', type).label}</span>
                  <span className="font-bold ml-1 text-text-primary">{count}</span>
                </button>
              );
            })}
          </div>
        </MobileCard>
      )}

      {!hasMaterials && (
        <MobileCard className="space-y-2 border-amber/30 bg-amber/5">
          <div className="text-[11px] text-text-secondary leading-relaxed">
            <span className="font-bold text-amber">No materials yet!</span> Roam the wastes or buy from the Market to stock up. Salvaging gear pays Scrap — and only Scrap, plus legendary cores from Legendaries; a bonus material lands only with the King of Scrap keystone, so it is a bonus, never the supply line.
          </div>
          <div className="flex gap-2">
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => onNavigate?.('home')} className="flex-1 py-2 rounded-lg bg-amber/10 border border-amber/30 text-amber text-xs font-bold active:bg-amber/20 transition-colors">
              Roam for materials
            </motion.button>
            <motion.button whileTap={{ scale: 0.96 }} onClick={() => onNavigate?.('market:buy')} className="flex-1 py-2 rounded-lg bg-amber/10 border border-amber/30 text-amber text-xs font-bold active:bg-amber/20 transition-colors">
              Open the Market
            </motion.button>
          </div>
        </MobileCard>
      )}

      <MaterialUsageSheet materialId={usageMaterialId} onClose={() => setUsageMaterialId(null)} />
    </div>
  );
};

// ─── Quality band key (in flow, between the readiness sections) ────

const QualityBandKey: React.FC = () => (
  <div data-testid="quality-band-key">
  <MobileCard className="space-y-1.5">
    <div className="text-[11px] font-black uppercase tracking-wider text-text-primary">Quality bands — what the % means</div>
    <div className="text-[11px] leading-relaxed text-text-secondary">
      A crafted item’s % is the share of its base effect you actually get — a 130% Med Kit heals 130% of base. 100% is the Vendor’s flat baseline; anything over it beats store-bought.
    </div>
    <div className="flex flex-wrap gap-1">
      {QUALITY_BAND_KEY.map(({ band, from }, i) => (
        <span key={band} className="border border-border bg-surface px-1.5 py-0.5 text-[11px] font-bold text-text-secondary" style={chipClip}>
          {band} <span className="text-text-muted">{i === 0 ? `under ${QUALITY_BAND_KEY[1].from}` : `${from}+`}</span>
        </span>
      ))}
    </div>
  </MobileCard>
  </div>
);

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
          (job.kind === 'gear'
            ? masteries['crafting.gear']?.level
            : masteries.crafting_consumables?.level) ?? 1,
        bench: job.bench,
        catalyst: job.catalystMaterialId !== null,
      })
    : null;
  // Econ 7: the held line reads the job's ESCROW SNAPSHOT when the
  // payload carries it — per-unit snapshot × remaining units — so a
  // lever move after enqueue never makes a running job display a
  // cost it didn't actually pay. Older payloads fall back to the
  // recipe's literal inputs.
  const held = recipe
    ? Object.entries(
        job.escrowInputs && job.unitsTotal > 0
          ? Object.fromEntries(
              Object.entries(job.escrowInputs).map(([key, total]) => [key, total / job.unitsTotal]),
            )
          : recipe.inputs,
      )
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
        <span className="text-[11px] font-bold text-text-muted">
          {job.name}
          {job.gearRarity ? ` · ${job.gearRarity}` : ''}
          {job.catalystMaterialId ? ` · catalyst ${getVisualAsset('material', job.catalystMaterialId).label}` : ''}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {job.extraLane && (
            <span
              className="inline-flex items-center gap-1 border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 text-[11px] font-bold text-cyan"
              style={chipClip}
            >
              <PxIcon name="clock" size={13} /> Bench time
            </span>
          )}
          <span className={`text-[11px] font-bold ${job.state === 'running' ? 'text-green' : job.state === 'paused' ? 'text-red' : 'text-amber'}`}>
            {stateLabel}
          </span>
        </span>
      </div>
      <div className="text-[11px] text-text-secondary">
        {formatDuration(job.remainingMs)} left · pays {xpPerUnit} XP/unit
        {bounds && (job.kind === 'consumable' || job.kind === 'gear') ? ` · rolls ${Math.round(bounds.min)}–${Math.round(bounds.max)}%` : ''}
        {held ? ` · inputs held ${held} (paid when queued)` : ''}
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-muted">
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
          className="py-1.5 px-3 rounded-lg bg-red/10 border border-red/30 text-red text-[11px] font-bold active:bg-red/20 transition-colors"
        >
          Cancel Job
        </motion.button>
      </div>
      <div className="text-[11px] text-text-muted">
        Cancel refunds unstarted units in full; the unit in progress refunds half its inputs.
      </div>
    </MobileCard>
  );
};

// ─── The bench (slice 9 collapse) ────────────────────────────────────
//
// One bench, always owned — nothing to buy, nothing to fit. The
// card states the envelope and names the relic family that took
// over the workshop's permanent modifiers: the three fitted tools
// of the old shop, plus the Prime Laboratory at the top end.
// Effects live on the relics themselves (content/crafting.ts
// CRAFT_RELICS) — this card only points at them.

const BenchCard: React.FC = () => (
  <MobileCard className="space-y-2">
    <div className="text-xs font-bold text-amber uppercase">The Bench</div>
    <div className="text-[11px] leading-relaxed text-text-secondary">
      One bench, always ready — no tiers to buy, nothing to unlock. It runs{' '}
      {RUNNING_JOBS_ON_BENCH} job at a time with {QUEUED_JOBS_PER_BENCH} queued behind it (a Fixer
      keystone queues more). Banked bench time — earned by watching ads at the bench strip above —
      widens it to 3 running and 15 queued while the bank lasts, and drains only while the extra
      lanes work. The old Forge and Lab tiers are gone: quality now comes from mastery,
      catalysts — and the relic you wear.
    </div>
    <div className="space-y-1.5">
      {CRAFT_RELICS.map((relic) => (
        <div key={relic.id} className="border-t border-border/50 pt-1.5 first:border-t-0 first:pt-0">
          <div className="text-[11px] font-black text-text-primary">
            {relic.name} <span className="font-bold text-text-muted">· named relic</span>
          </div>
          <div className="text-[11px] leading-snug text-text-muted">{relic.blurb}</div>
        </div>
      ))}
    </div>
    <div className="text-[11px] text-text-muted">
      Craft relics under Gear Frames, equip them from your Loadout — their workshop effects apply
      to every job while worn, and relics never wear out.
    </div>
  </MobileCard>
);

// ─── Recipe card ─────────────────────────────────────────────────────

const RecipeCard: React.FC<{
  recipe: CraftRecipe;
  ctx: WorkshopPlayerContext;
  readiness?: RecipeReadiness;
  consumables: Record<string, number>;
  onEnqueue: (input: {
    bench: number;
    recipeId: string;
    units: number;
    rarity?: string | null;
    useCatalyst?: boolean;
    useRushTicket?: boolean;
  }) => Promise<boolean>;
  onNavigate?: (screen: string) => void;
  onOpenBenches: () => void;
  onRefineFocus: (recipeId: string) => void;
  highlighted?: boolean;
}> = ({ recipe, ctx, readiness, consumables, onEnqueue, onNavigate, onOpenBenches, onRefineFocus, highlighted }) => {
  const isGear = recipe.kind === 'gear';
  // Named relics mint at their fixed rarity — no rarity choice.
  const [rarity, setRarity] = useState<string>(recipe.fixedRarity ?? readiness?.rarity ?? 'Common');
  // Bench collapse (slice 9): the enqueue bench is the one bench.
  const benchSel = 1;
  const [units, setUnits] = useState(1);
  const [useCatalyst, setUseCatalyst] = useState(false);
  const [useRush, setUseRush] = useState(false);
  const [queuedFlash, setQueuedFlash] = useState(false);
  const [inspectOpen, setInspectOpen] = useState(false);

  const catalystId = catalystForRecipe(recipe);
  const def = recipe.consumableType ? CONSUMABLES[recipe.consumableType] : undefined;
  const evaluated = deriveRecipeReadiness(recipe, ctx, {
    units,
    rarity: isGear ? rarity : undefined,
    bench: benchSel,
    useCatalyst,
    useRushTicket: useRush,
  });
  const canEnqueue = evaluated.canEnqueue;
  const baseDurationMs = recipe.namedRelic
    ? recipe.unitDurationMs
    : isGear
      ? (recipe.durationByRarityMs?.[rarity as keyof typeof recipe.durationByRarityMs] ?? 0)
      : recipe.unitDurationMs;
  const xpPerUnit = craftUnitXp(baseDurationMs, ctx.playerLevel, CRAFT_XP_RATE_DEFAULT);
  const refineOut =
    recipe.kind === 'refine'
      ? refineOutputCount(recipe, ctx.masteries['crafting.refining']?.level ?? 1, REFINE_BASE_YIELD_DEFAULT)
      : null;
  // Stochastic rounding (economy brief §9.3): a fractional refine
  // expectation labels as its honest range, not the floored count.
  const refineRange =
    recipe.kind === 'refine'
      ? refineOutputRange(recipe, ctx.masteries['crafting.refining']?.level ?? 1, REFINE_BASE_YIELD_DEFAULT)
      : null;
  const makesPerUnit = recipe.kind === 'refine' ? refineOut : (recipe.outputQuantity ?? 1);
  const makesLabel =
    refineRange && refineRange.max > refineRange.min
      ? `Makes ×${refineRange.min}–${refineRange.max} per unit`
      : makesPerUnit && makesPerUnit > 1
        ? `Makes ×${makesPerUnit} per unit`
        : null;

  // Econ 7: the bill shown is the RESOLVED bill (Scrap leg at its
  // lever value) — the same figures the readiness derivation and
  // the server charge use.
  const inputRows = Object.entries(resolvedRecipeInputs(recipe, ctx.recipeScrapCosts)).map(([key, per]) => {
    // 'Scrap' is an ordinary material key since the 0069 merge —
    // its stock is ctx.materials['Scrap'].
    const have = isMaterialInput(key) ? (ctx.materials[key] ?? 0) : (ctx.essences[key] ?? 0);
    const need = per * units;
    return { key, per, need, have, enough: have >= need, short: Math.max(0, need - have) };
  });
  const catalystHave = catalystId ? (ctx.materials[catalystId] ?? 0) : 0;
  const ticketsOwned = consumables['WorkshopRushTicket'] ?? 0;
  const laneLabel = CATEGORIES.find((c) => c.key === recipe.category)?.label ?? recipe.category;
  // No-redundant-state law (owner, 2026-11-03): the gate block
  // carries only NON-material gates — bench, research, mastery,
  // level, standing, queue. A material shortage is stated on
  // its own input line (with its source) and is never re-narrated
  // here; the full gate list, materials included, lives in the
  // inspect sheet.
  const faceGates = evaluated.gates.filter((g) => g.family !== 'materials');
  const hasFaceBlockers = faceGates.some((g) => !g.met);

  return (
    <MobileCard
      className={`space-y-1.5 ${highlighted ? 'ring-2 ring-amber' : ''}`}
    >
      <div id={`workshop-recipe-${recipe.id}`} className="scroll-mt-16 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded border border-border bg-bg">
              <PxIcon name={def ? def.visual.icon : CATEGORY_ICONS[recipe.category]} size={17} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-text-primary">{recipe.name}</span>
                <button
                  type="button"
                  aria-label={`About ${recipe.name}`}
                  data-testid={`recipe-info-${recipe.id}`}
                  onClick={() => setInspectOpen(true)}
                  className="inline-flex shrink-0 items-center p-0.5 text-text-muted transition-colors hover:text-amber"
                >
                  <PxIcon name="info" size={17} />
                </button>
                {recipe.requiresLevel > 1 && (
                  <span className={`text-[11px] px-1 py-0.5 rounded font-bold ${ctx.playerLevel < recipe.requiresLevel ? 'bg-red/15 text-red' : 'bg-surface-raised text-text-muted'}`}>Lv.{recipe.requiresLevel}</span>
                )}
                {recipe.requiresStanding && (
                  <span className={`text-[11px] px-1 py-0.5 rounded font-bold ${(ctx.standingRanks[recipe.requiresStanding.manufacturer] ?? 0) < recipe.requiresStanding.rank ? 'bg-red/15 text-red' : 'bg-surface-raised text-text-muted'}`}>{recipe.requiresStanding.manufacturer} R{recipe.requiresStanding.rank}</span>
                )}
              </div>
              <div className="text-[11px] text-text-muted">
                {laneLabel}
                {recipe.station !== 'bench' ? ` · the ${recipe.station}` : ''}
                {recipe.outputQuantity && recipe.outputQuantity > 1 ? ' · batch' : ''}
              </div>
            </div>
          </div>
          <span className="shrink-0 text-right text-[11px] text-text-muted">
            <span className="font-black text-text-primary">{formatDurationShort(baseDurationMs)}</span> per unit
          </span>
        </div>

        {/* Detail behind inspect (owner law, 2026-11-03): the
            purpose prose and the quality line live in the inspect
            sheet behind the info button beside the name — the card
            face is identity + numbers + actions. The one page-level
            quality explainer (the band key) stays in flow. */}

        {/* (2) Materials with have/need, and a sourced door under
            every shortfall. */}
        <div className="space-y-1">
          {inputRows.map(({ key, need, have, enough, short }) => {
            return (
              <React.Fragment key={key}>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="inline-flex items-center gap-1">
                    <PixelMaterial id={key} density="thumb" size={13} />
                    <span className="text-text-secondary">{inputLabel(key)}</span>
                  </span>
                  <span className="inline-flex items-center">
                    <span className={enough ? 'font-bold text-text-primary' : 'font-bold text-red'}>
                      {have.toLocaleString('en-US')}
                      <span className="text-text-muted"> / {need.toLocaleString('en-US')}</span>
                      {!enough ? <span> · short {short.toLocaleString('en-US')}</span> : null}
                    </span>
                    {/* QB-1: the lone + beside a shortfall goods line —
                        the card's only quick-buy trace. Scrap is a
                        profile balance, never a buyable good. */}
                    {!enough && key !== 'Scrap' && (
                      <QuickBuyPlus
                        good={{ kind: isMaterialInput(key) ? 'material' : 'essence', id: key }}
                        goodName={inputLabel(key)}
                        shortfall={short}
                        contextLabel={recipe.name}
                        onNavigate={onNavigate}
                        onRefineFocus={onRefineFocus}
                      />
                    )}
                  </span>
                </div>
                {!enough && <SourceLine inputId={key} onNavigate={onNavigate} onRefineFocus={onRefineFocus} />}
              </React.Fragment>
            );
          })}
          {useCatalyst && catalystId && (
            <React.Fragment>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1 text-text-secondary">
                  <PxIcon name="flask" size={13} /> Catalyst · {inputLabel(catalystId)}
                </span>
                <span className="inline-flex items-center">
                  <span className={catalystHave >= units ? 'font-bold text-text-primary' : 'font-bold text-red'}>
                    {catalystHave}
                    <span className="text-text-muted"> / {units}</span>
                    {catalystHave < units ? <span> · short {units - catalystHave}</span> : null}
                  </span>
                  {catalystHave < units && (
                    <QuickBuyPlus
                      good={{ kind: 'material', id: catalystId }}
                      goodName={inputLabel(catalystId)}
                      shortfall={units - catalystHave}
                      contextLabel={recipe.name}
                      onNavigate={onNavigate}
                      onRefineFocus={onRefineFocus}
                    />
                  )}
                </span>
              </div>
              {catalystHave < units && <SourceLine inputId={catalystId} onNavigate={onNavigate} onRefineFocus={onRefineFocus} />}
            </React.Fragment>
          )}
        </div>

        {/* Non-material gates print their lock lines here (they
            carry information the material lines don't); material
            blockers never re-narrate. All gates, materials
            included, print in the inspect sheet. */}
        {hasFaceBlockers && (
          <div className="border-t border-border/50 pt-1.5">
            <GateLines gates={faceGates} onNavigate={onNavigate} onOpenBenches={onOpenBenches} />
          </div>
        )}

        {isGear && recipe.namedRelic && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-2 py-1 text-[11px] font-black border bl-primary border-transparent" style={chipClip}>
              {recipe.fixedRarity} · named relic
            </span>
            <span className="text-[11px] text-text-muted self-center">Its rarity and effects are fixed — no catalyst, no temper roll.</span>
          </div>
        )}

        {isGear && !recipe.namedRelic && (
          <div className="flex flex-wrap gap-1.5">
            {CRAFTABLE_GEAR_RARITIES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRarity(r)}
                className={`px-2 py-1 text-[11px] font-black border ${rarity === r ? 'bl-primary border-transparent' : 'border-border text-text-secondary'}`}
                style={chipClip}
              >
                {r}
              </button>
            ))}
            <span className="text-[11px] text-text-muted self-center">Legendary can’t be crafted — ever.</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 text-text-secondary">
            Units
            <input
              type="number"
              min={1}
              max={recipe.maxUnits ?? 500}
              value={units}
              onChange={(e) => setUnits(Math.max(1, Math.min(recipe.maxUnits ?? 500, Math.floor(Number(e.target.value) || 1))))}
              className="w-14 text-[11px] font-bold border border-border bg-surface rounded px-1.5 py-1 text-text-primary"
            />
          </label>
          {catalystId && (
            <button
              type="button"
              onClick={() => setUseCatalyst(!useCatalyst)}
              className={`px-2 py-1 text-[11px] font-bold border ${useCatalyst ? 'bl-primary border-transparent' : 'border-border text-text-secondary'}`}
              style={chipClip}
              title={`+10/+15 quality bounds, 1 ${inputLabel(catalystId)} per unit`}
            >
              <span className="inline-flex items-center gap-1"><PxIcon name="flask" size={13} /> Catalyst ({inputLabel(catalystId)})</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setUseRush(!useRush)}
            disabled={ticketsOwned < 1}
            className={`px-2 py-1 text-[11px] font-bold border ${useRush ? 'bl-primary border-transparent' : 'border-border text-text-secondary'} disabled:opacity-40`}
            style={chipClip}
            title="Escrow one Workshop Rush Ticket: the job runs faster by the ticket's quality"
          >
            <span className="inline-flex items-center gap-1"><PxIcon name="tag" size={13} /> Rush ticket ({ticketsOwned})</span>
          </button>
        </div>

        {/* Assumption-gaps G7: the catalyst requirement, the
            catalyst's effect, the rush ticket's escrow terms, and
            the no-tickets remedy used to live ONLY in title=
            attributes — hover text that never renders on a phone,
            so at bench 1 / 0 tickets the buttons just looked dead.
            The same guidance now prints as visible text. */}
        {(catalystId !== null || ticketsOwned < 1 || useRush) && (
          <div className="space-y-0.5 text-[11px] leading-snug text-text-muted">
            {catalystId && useCatalyst && (
              <div>{`Catalyst: +10/+15 quality bounds, 1 ${inputLabel(catalystId)} per unit.`}</div>
            )}
            {ticketsOwned < 1 && <div>No rush tickets — they are crafted here (Utility recipes) and rotate through the vendor.</div>}
            {useRush && ticketsOwned >= 1 && <div>One rush ticket is escrowed for this job — it runs faster by the ticket's quality.</div>}
          </div>
        )}

        {/* Pre-queue totals for the chosen units. */}
        <div className="text-[11px] text-text-secondary">
          Total for <span className="font-black text-text-primary">{units} unit{units === 1 ? '' : 's'}</span>:{' '}
          <span className="font-black text-text-primary">{formatDurationShort(baseDurationMs * units)}</span> · ≈{xpPerUnit * units} XP · inputs held when you queue
          {makesLabel ? ` · ${makesLabel}` : ''}
        </div>
        {isGear && recipe.durationByRarityMs && (
          <div className="text-[11px] text-text-muted">
            Common {formatDurationShort(recipe.durationByRarityMs[Rarity.Common] ?? 0)} · Rare {formatDurationShort(recipe.durationByRarityMs[Rarity.Rare] ?? 0)} · Epic {formatDurationShort(recipe.durationByRarityMs[Rarity.Epic] ?? 0)} — pick the rarity when you queue
          </div>
        )}

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
          className={`w-full py-1.5 rounded-lg text-[11px] font-bold transition-all ${
            canEnqueue
              ? `bg-amber text-bg active:bg-amber/80 cursor-pointer ${queuedFlash ? 'ring-2 ring-amber/80' : ''}`
              : 'bg-surface-raised text-text-muted border border-border cursor-not-allowed'
          }`}
        >
          {queuedFlash ? <span className="inline-flex items-center gap-1"><PxIcon name="check" size={13} /> Queued!</span> : 'QUEUE JOB'}
        </motion.button>
        {inspectOpen && (
          <RecipeInspectSheet
            recipe={recipe}
            ctx={ctx}
            readiness={evaluated}
            bench={benchSel}
            useCatalyst={useCatalyst}
            onClose={() => setInspectOpen(false)}
            onNavigate={onNavigate}
            onOpenBenches={onOpenBenches}
            onRefineFocus={onRefineFocus}
          />
        )}
      </div>
    </MobileCard>
  );
};
