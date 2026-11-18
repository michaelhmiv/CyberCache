/**
 * Craft-info rundown variants (craft-info render round, dev /
 * review only — never shipped from this branch).
 *
 * The problem (owner, 2026-11-17): while Crafting holds the Home
 * slot, the black zone under the stage still prints the COMBAT
 * rundown — DPS "No weapon equipped", HP, Shield, Mit, Shield
 * Break — none of which answers the crafting questions: what is
 * on the bench, how far along is it, what is next. That truth
 * lives only in the Workshop panel below the fold.
 *
 * These three variants re-aim the SAME block (the hero rundown's
 * bordered well, its 11px label / 15px hero grammar, the JobCard
 * progress bar and state colors) at the bench, in three
 * prioritizations. Switched by ?craftinfo=1|2|3 and gated on
 * Crafting holding the slot; absent the param, ActionScreen
 * Contextual renders the shipped HeroRundown untouched.
 *
 * Every datum comes from stores the client already holds:
 *   - bench jobs: the workshop mirror (useWorkshopStore.server
 *     .jobs — the same rows HomeCraftBench and the Bench Jobs
 *     list read), filtered exactly as HomeCraftBench filters;
 *   - vitals: buildHeroRundown itself, fed by the same hooks
 *     HeroRundown uses, so HP/Shield print digit-for-digit what
 *     the shipped rundown prints;
 *   - item pictures: the recipe catalog resolution the bench
 *     seat itself uses (benchSeatPlanForJob's path) —
 *     PixelConsumable / PixelMaterial, never a fabricated icon.
 * Durations print through copies of WorkshopScreen's own
 * formatDuration / formatDurationShort (file-local there; a
 * production port imports or extracts the originals).
 */
import React, { useMemo } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelConsumable } from '@/components/pixelArt/PixelConsumable';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import { isServiceLaneJob } from '@/components/workshop/serviceLane';
import { statToneRailClass, statToneTextClass } from '@/components/stats/statToneStyles';
import {
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
  useWorkshopStore,
} from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { buildHeroRundown, type HeroRundownModel } from '@/lib/stats/heroRundown';
import { getCraftRecipe } from '@/content/crafting';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';

/** The variant switch — capture-only, like the diorama's
 *  craftzoom reader before it. Absent/invalid = shipped. */
export const craftInfoVariant = (): number => {
  if (typeof window === 'undefined') return 0;
  const v = Number(new URLSearchParams(window.location.search).get('craftinfo'));
  return v === 1 || v === 2 || v === 3 ? v : 0;
};

/** WorkshopScreen's formatDuration, verbatim in behavior:
 *  243,960,000 ms -> "67h 36m"; 600,000 -> "10m 00s". */
function fmtDur(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  return `${secs}s`;
}

/** WorkshopScreen's formatDurationShort: 600,000 -> "10m";
 *  54,000,000 -> "15h"; 18,000,000 -> "5h". */
function fmtShort(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins >= 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  }
  return `${mins}m`;
}

const stateWord = (job: WorkshopJobView): { word: string; cls: string } =>
  job.state === 'running'
    ? { word: 'Running', cls: 'text-green' }
    : job.state === 'paused'
      ? { word: 'Paused', cls: 'text-red' }
      : { word: 'Queued', cls: 'text-amber' };

/** The job's picture, resolved the way the bench seat resolves
 *  it: recipe -> consumable painting / material painting. */
const JobThumb: React.FC<{ job: WorkshopJobView; size: number }> = ({ job, size }) => {
  const recipe = getCraftRecipe(job.recipeId);
  if (recipe?.consumableType) return <PixelConsumable type={recipe.consumableType} size={size} />;
  if (recipe?.outputMaterial) return <PixelMaterial id={recipe.outputMaterial} size={size} />;
  return (
    <span
      className="flex items-center justify-center border border-border bg-bg text-amber"
      style={{ width: size, height: size }}
    >
      <PxIcon name="anvil" size={Math.round(size * 0.62)} />
    </span>
  );
};

interface BenchModel {
  jobs: WorkshopJobView[];
  head: WorkshopJobView | null;
  queue: WorkshopJobView[];
  /** Head job overall progress 0..1 (HomeCraftBench's formula). */
  headPct: number;
  /** The unit currently on the bench, its own progress 0..1. */
  unitPct: number;
  totalUnits: number;
  totalRemainingMs: number;
  queueRemainingMs: number;
}

function useBenchModel(): BenchModel {
  const jobs = useWorkshopStore((s) => s.server?.jobs);
  return useMemo(() => {
    const benchJobs = (jobs ?? []).filter(
      (j) => !isServiceLaneJob(j) && (j.state === 'running' || j.state === 'queued' || j.state === 'paused'),
    );
    const head = benchJobs.find((j) => j.state === 'running') ?? benchJobs[0] ?? null;
    const queue = head ? benchJobs.filter((j) => j.id !== head.id) : [];
    const headPct = head
      ? Math.min(
          1,
          (head.unitsCompleted * head.unitDurationMs + head.accruedMs) /
            Math.max(1, head.unitsTotal * head.unitDurationMs),
        )
      : 0;
    const unitPct = head ? Math.min(1, head.accruedMs / Math.max(1, head.unitDurationMs)) : 0;
    const totalUnits = benchJobs.reduce((n, j) => n + (j.unitsTotal - j.unitsCompleted), 0);
    const totalRemainingMs = benchJobs.reduce((n, j) => n + j.remainingMs, 0);
    const queueRemainingMs = queue.reduce((n, j) => n + j.remainingMs, 0);
    return { jobs: benchJobs, head, queue, headPct, unitPct, totalUnits, totalRemainingMs, queueRemainingMs };
  }, [jobs]);
}

/** The vitals model — the shipped rundown's own builder, so the
 *  numbers and tones are the shipped numbers and tones. */
function useVitalsModel(): HeroRundownModel {
  const survival = useSurvivalStore();
  const playerLevel = usePlayerStore((s) => s.level);
  const shieldHp = useLoadoutStore((s) => s.getShield()?.hp ?? 0);
  const { summary, snapshot, weapons, primary, skillBonuses } = useCharacterStatSummary(null);
  useSyncSurvivalMaxHp(playerLevel, shieldHp);
  return useMemo(
    () =>
      buildHeroRundown({
        summary,
        snapshot,
        weapons,
        primary,
        skillBonuses,
        survival: {
          currentHp: survival.currentHp,
          maxHp: survival.maxHp,
          shieldHp: survival.shieldHp,
          isDead: survival.isDead,
        },
        bossContext: false,
      }),
    [summary, snapshot, weapons, primary, skillBonuses, survival],
  );
}

/** One slim vitals line (V1/V3): HP with its bar + Shield,
 *  nothing else — DPS/Mit/Shield Break leave the first screen
 *  in Craft mode. HP never vanishes: the owner crafts at
 *  194/1,780 and the next mode decision depends on it. */
const VitalsLine: React.FC<{ model: HeroRundownModel }> = ({ model }) => (
  <div className="flex items-stretch border-t border-border/60" data-testid="craft-info-vitals">
    <div className="min-h-[44px] min-w-0 flex-[1.5] px-2 py-1.5">
      <span className="flex items-baseline justify-between gap-1">
        <span className="text-[11px] font-black uppercase text-text-muted">HP</span>
        <span className={`whitespace-nowrap text-[15px] font-black leading-tight ${statToneTextClass[model.hp.tone]}`}>
          {model.hp.display}
        </span>
      </span>
      <span className="mt-1 block h-1 w-full bg-bg" aria-hidden>
        <span className={`block h-full ${statToneRailClass[model.hp.tone]}`} style={{ width: `${Math.round(model.hp.fraction * 100)}%` }} />
      </span>
    </div>
    <div className="flex min-h-[44px] min-w-0 flex-[0.75] items-center justify-between border-l border-border/60 px-2 py-1.5">
      <span className="text-[11px] font-black uppercase text-text-muted">Shield</span>
      <span className={`whitespace-nowrap text-[15px] font-black leading-tight ${statToneTextClass[model.shield.tone]}`}>
        {model.shield.display}
      </span>
    </div>
  </div>
);

/** The vitals row (V2): the shipped survival row's two cells
 *  that matter at the bench, at their shipped size. */
const VitalsRow: React.FC<{ model: HeroRundownModel }> = ({ model }) => (
  <div className="flex border-t border-border/60" data-testid="craft-info-vitals">
    <div className="min-h-[56px] min-w-0 flex-[1.5] px-1.5 py-1.5">
      <span className="block text-[11px] font-black uppercase text-text-muted">HP</span>
      <span className={`mt-0.5 block whitespace-nowrap text-[15px] font-black leading-tight ${statToneTextClass[model.hp.tone]}`}>
        {model.hp.display}
        {model.hp.delta && (
          <span className={`ml-1 align-super text-[11px] font-black ${model.hp.delta.tone === 'green' ? 'text-green' : 'text-red'}`}>
            {model.hp.delta.display}
          </span>
        )}
      </span>
      <span className="mt-1 block h-1 w-full bg-bg" aria-hidden>
        <span className={`block h-full ${statToneRailClass[model.hp.tone]}`} style={{ width: `${Math.round(model.hp.fraction * 100)}%` }} />
      </span>
    </div>
    <div className="min-h-[56px] min-w-0 flex-[0.75] border-l border-border/60 px-1.5 py-1.5">
      <span className="block text-[11px] font-black uppercase text-text-muted">Shield</span>
      <span className={`mt-0.5 block whitespace-nowrap text-[15px] font-black leading-tight ${statToneTextClass[model.shield.tone]}`}>
        {model.shield.display}
      </span>
    </div>
  </div>
);

const Bar: React.FC<{ pct: number }> = ({ pct }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
    <div className="h-full rounded-full bg-amber transition-[width] duration-500" style={{ width: `${Math.round(pct * 100)}%` }} />
  </div>
);

const FactCell: React.FC<{ label: string; value: string; flex?: string }> = ({ label, value, flex = 'flex-1' }) => (
  <div className={`flex min-h-[44px] min-w-0 ${flex} items-center justify-between gap-1 border-l border-border/60 px-2 py-1.5 first:border-l-0`}>
    <span className="truncate text-[11px] font-black uppercase text-text-muted">{label}</span>
    <span className="whitespace-nowrap text-[15px] font-black leading-tight text-text-primary">{value}</span>
  </div>
);

const ROOT_CLS =
  'relative border-2 border-t-0 border-border bg-surface/95 shadow-[0_10px_22px_rgba(0,0,0,0.45)]';

/** V1 — Bench rundown: the shipped block's skeleton, re-aimed.
 *  Working row, fact cells, queue row, vitals line. */
const Variant1: React.FC<{ bench: BenchModel; vitals: HeroRundownModel }> = ({ bench, vitals }) => {
  const { head, queue } = bench;
  if (!head) return null;
  const st = stateWord(head);
  return (
    <div data-testid="craft-info-rundown" className={ROOT_CLS}>
      <div className="flex min-h-[44px] items-center gap-2 px-2 py-2">
        <JobThumb job={head} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-black uppercase text-text-muted">Working</span>
            <span className={`text-[11px] font-black uppercase ${st.cls}`}>{st.word}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-black text-text-primary">{head.name}</span>
            <span className="whitespace-nowrap text-[15px] font-black leading-tight text-text-primary">
              {head.unitsCompleted}/{head.unitsTotal}
              <span className="ml-1 text-[11px] font-black uppercase text-text-muted">units</span>
            </span>
          </div>
        </div>
      </div>
      <div className="px-2 pb-2">
        <Bar pct={bench.headPct} />
      </div>
      <div className="flex border-t border-border/60">
        <FactCell label="Per unit" value={fmtShort(head.unitDurationMs)} />
        <FactCell label="This unit" value={`${Math.round(bench.unitPct * 100)}%`} />
        <FactCell label="Left" value={fmtDur(head.remainingMs)} />
      </div>
      {queue.length > 0 && (
        <div className="flex min-h-[44px] items-center gap-2 border-t border-border/60 px-2 py-1.5">
          <span className="shrink-0 text-[11px] font-black uppercase text-text-muted">Next</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text-secondary">
            {queue.map((j) => `${j.name} ×${j.unitsTotal - j.unitsCompleted}`).join(' · ')}
          </span>
          <span className="shrink-0 whitespace-nowrap text-[11px] font-black uppercase text-text-muted">
            {queue.length} queued · {fmtShort(bench.queueRemainingMs)}
          </span>
        </div>
      )}
      <VitalsLine model={vitals} />
    </div>
  );
};

/** V2 — Bench card + vitals: one card that is the bench's
 *  whole story, then the survival row at shipped size. */
const Variant2: React.FC<{ bench: BenchModel; vitals: HeroRundownModel }> = ({ bench, vitals }) => {
  const { head, queue } = bench;
  if (!head) return null;
  const st = stateWord(head);
  const paused = head.state === 'paused';
  return (
    <div data-testid="craft-info-rundown" className={ROOT_CLS}>
      <div className="flex min-h-[44px] items-center gap-3 px-2 py-2.5">
        <JobThumb job={head} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[15px] font-black leading-tight text-text-primary">{head.name}</span>
            <span className={`shrink-0 text-[11px] font-black uppercase ${st.cls}`}>{st.word}</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] font-bold text-text-muted">
            {head.unitsCompleted} of {head.unitsTotal} units · unit {head.unitsCompleted + 1} at {Math.round(bench.unitPct * 100)}%
            {queue.length > 0 ? ` · ${queue.length} more job${queue.length === 1 ? '' : 's'} queued` : ''}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="text-[23px] font-black leading-none text-text-primary">{Math.round(bench.headPct * 100)}%</span>
          <span className="block text-[11px] font-black uppercase text-text-muted">done</span>
        </div>
      </div>
      <div className="px-2 pb-2">
        <Bar pct={bench.headPct} />
      </div>
      {paused && (
        <div className="border-t border-border/60 px-2 py-1.5 text-[11px] font-black uppercase text-red">
          Paused — progress held, queue intact
        </div>
      )}
      <div className="flex border-t border-border/60">
        <FactCell label="Left" value={fmtDur(head.remainingMs)} flex="flex-[1.3]" />
        <FactCell label="Per unit" value={fmtShort(head.unitDurationMs)} />
        <FactCell label="Units queued" value={String(bench.totalUnits)} />
      </div>
      <VitalsRow model={vitals} />
    </div>
  );
};

/** V3 — Queue-forward: the zone becomes the queue itself —
 *  current job as hero row, next jobs as compact rows, bench
 *  totals as the footer, vitals as the slim line. */
const Variant3: React.FC<{ bench: BenchModel; vitals: HeroRundownModel }> = ({ bench, vitals }) => {
  const { head, queue } = bench;
  if (!head) return null;
  const st = stateWord(head);
  return (
    <div data-testid="craft-info-rundown" className={ROOT_CLS}>
      <div className="flex min-h-[44px] items-center gap-2 px-2 py-2">
        <JobThumb job={head} size={30} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[13px] font-black text-text-primary">{head.name}</span>
            <span className={`shrink-0 text-[11px] font-black uppercase ${st.cls}`}>{st.word}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-bold text-text-muted">
              {head.unitsCompleted}/{head.unitsTotal} units · {fmtShort(head.unitDurationMs)}/unit
            </span>
            <span className="whitespace-nowrap text-[13px] font-black text-text-primary">{fmtDur(head.remainingMs)} left</span>
          </div>
        </div>
      </div>
      <div className="px-2 pb-2">
        <Bar pct={bench.headPct} />
      </div>
      {queue.slice(0, 2).map((job, i) => (
        <div key={job.id} className="flex min-h-[44px] items-center gap-2 border-t border-border/60 px-2 py-1.5">
          <JobThumb job={job} size={22} />
          <span className="shrink-0 text-[11px] font-black uppercase text-text-muted">Next {i + 1}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text-secondary">
            {job.name} <span className="text-text-muted">×{job.unitsTotal - job.unitsCompleted}</span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-[11px] font-bold text-text-muted">{fmtShort(job.remainingMs)}</span>
        </div>
      ))}
      <div className="flex min-h-[44px] items-center justify-between gap-2 border-t border-border/60 px-2 py-1.5">
        <span className="text-[11px] font-black uppercase text-text-muted">
          {bench.jobs.length} jobs · {bench.totalUnits} units on the bench
        </span>
        <span className="whitespace-nowrap text-[11px] font-black uppercase text-text-muted">
          All done ≈ {fmtDur(bench.totalRemainingMs)}
        </span>
      </div>
      <VitalsLine model={vitals} />
    </div>
  );
};

export const CraftInfoRundown: React.FC<{ variant: number }> = ({ variant }) => {
  // The swap only exists while Crafting holds the slot; the
  // caller (ActionScreenContextual) gates on the activity kind.
  const bench = useBenchModel();
  const vitals = useVitalsModel();
  if (!bench.head) return null;
  if (variant === 2) return <Variant2 bench={bench} vitals={vitals} />;
  if (variant === 3) return <Variant3 bench={bench} vitals={vitals} />;
  return <Variant1 bench={bench} vitals={vitals} />;
};
