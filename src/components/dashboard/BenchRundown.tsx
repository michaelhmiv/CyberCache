import React, { useMemo } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelConsumable } from '@/components/pixelArt/PixelConsumable';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import { isServiceLaneJob } from '@/components/workshop/serviceLane';
import { statToneRailClass, statToneTextClass } from '@/components/stats/statToneStyles';
import {
  useActivityStore,
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
  useWorkshopStore,
} from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { buildHeroRundown, type HeroRundownModel } from '@/lib/stats/heroRundown';
import { formatDuration, formatDurationShort } from '@/lib/workshop/durationFormat';
import { getCraftRecipe } from '@/content/crafting';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import { HeroBuffLine } from './HeroRundown';

/**
 * The bench rundown (owner ruling 2026-11-17) — the black zone
 * under the stage, answered for the bench while Crafting holds
 * the Home slot.
 *
 * The zone used to print the combat rundown in every mode — DPS
 * "No weapon equipped", shield, mitigation — while the one thing
 * the player was doing (the bench job, its units, its queue)
 * lived only in the Workshop panel below the fold. In Craft mode
 * the zone is bench-shaped instead, in the shipped block's own
 * grammar (its bordered well, 11px labels, 15px heroes, the
 * JobCard progress bar and state colors):
 *
 *   WORKING row — the head job's own picture (the bench seat's
 *     resolution), its name, its state word, units done/total,
 *     and the bench strip's progress bar;
 *   fact cells — PER UNIT (the head job's STORED unit duration:
 *     its enqueue-time snapshot rate, so a job queued before a
 *     skill spend honestly reads its own rate), THIS UNIT (the
 *     accrued share of the unit on the bench), LEFT (the head
 *     job's remaining time);
 *   NEXT row — the queue behind the head, named with counts,
 *     plus the queue's combined remaining time;
 *   one slim vitals line — HP with its bar, and Shield. HP never
 *     leaves the first screen; DPS / Mit / Shield Break do, in
 *     this mode only. Every other mode keeps the combat rundown.
 *
 * An empty bench keeps the shape: a BENCH IDLE row in the
 * WORKING slot (the bench banner's own idle word) over the same
 * vitals line — no fact cells with nothing to measure.
 *
 * Display only: every datum comes from the client bench mirror
 * (the workshop store's server jobs, filtered exactly as
 * HomeCraftBench filters) and the shipped rundown's own vitals
 * model (buildHeroRundown), so HP and Shield print digit-for-
 * digit what the combat rundown prints. Nothing here mutates
 * anything; the Chef remains the authority.
 */

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

/** The empty bench's thumb: the same anvil tile JobThumb falls
 *  back to when a recipe carries no painting. */
const BenchThumb: React.FC<{ size: number }> = ({ size }) => (
  <span
    className="flex items-center justify-center border border-border bg-bg text-amber"
    style={{ width: size, height: size }}
  >
    <PxIcon name="anvil" size={Math.round(size * 0.62)} />
  </span>
);

interface BenchModel {
  head: WorkshopJobView | null;
  queue: WorkshopJobView[];
  /** Head job overall progress 0..1 (the bench strip's formula). */
  headPct: number;
  /** The unit currently on the bench, its own progress 0..1. */
  unitPct: number;
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
    const queueRemainingMs = queue.reduce((n, j) => n + j.remainingMs, 0);
    return { head, queue, headPct, unitPct, queueRemainingMs };
  }, [jobs]);
}

/** The vitals model — the shipped rundown's own builder and its
 *  max-HP sync (which lives in HeroRundown when it mounts), so
 *  the numbers and tones are the shipped numbers and tones. */
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

/** One slim vitals line: HP with its bar + Shield, nothing else.
 *  HP never vanishes: the owner crafts at 194/1,780 and the next
 *  mode decision depends on it. */
const VitalsLine: React.FC<{ model: HeroRundownModel }> = ({ model }) => (
  <div className="flex items-stretch border-t border-border/60" data-testid="bench-rundown-vitals">
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

const Bar: React.FC<{ pct: number }> = ({ pct }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
    <div className="h-full rounded-full bg-amber transition-[width] duration-500" style={{ width: `${Math.round(pct * 100)}%` }} />
  </div>
);

const FactCell: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex min-h-[44px] min-w-0 flex-1 items-center justify-between gap-1 border-l border-border/60 px-2 py-1.5 first:border-l-0">
    <span className="truncate text-[11px] font-black uppercase text-text-muted">{label}</span>
    <span className="whitespace-nowrap text-[15px] font-black leading-tight text-text-primary">{value}</span>
  </div>
);

export const BenchRundown: React.FC = () => {
  const kind = useActivityStore((s) => s.current.kind);
  const bench = useBenchModel();
  const vitals = useVitalsModel();
  const { head, queue } = bench;

  return (
    <div
      data-testid="bench-rundown"
      className="relative border-2 border-t-0 border-border bg-surface/95 shadow-[0_10px_22px_rgba(0,0,0,0.45)]"
    >
      {head ? (
        <>
          <div className="flex min-h-[44px] items-center gap-2 px-2 py-2" data-testid="bench-rundown-working">
            <JobThumb job={head} size={30} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-black uppercase text-text-muted">Working</span>
                <span className={`text-[11px] font-black uppercase ${stateWord(head).cls}`}>{stateWord(head).word}</span>
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
            <FactCell label="Per unit" value={formatDurationShort(head.unitDurationMs)} />
            <FactCell label="This unit" value={`${Math.round(bench.unitPct * 100)}%`} />
            <FactCell label="Left" value={formatDuration(head.remainingMs)} />
          </div>
          {queue.length > 0 && (
            <div
              className="flex min-h-[44px] items-center gap-2 border-t border-border/60 px-2 py-1.5"
              data-testid="bench-rundown-next"
            >
              <span className="shrink-0 text-[11px] font-black uppercase text-text-muted">Next</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-text-secondary">
                {queue.map((j) => `${j.name} ×${j.unitsTotal - j.unitsCompleted}`).join(' · ')}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[11px] font-black uppercase text-text-muted">
                {queue.length} queued · {formatDurationShort(bench.queueRemainingMs)}
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="flex min-h-[44px] items-center gap-2 px-2 py-2" data-testid="bench-rundown-idle">
          <BenchThumb size={30} />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-black uppercase text-text-muted">Bench</span>
              <span className="text-[11px] font-black uppercase text-amber">Idle</span>
            </div>
            <div className="truncate text-[13px] font-black text-text-secondary">No jobs queued</div>
          </div>
        </div>
      )}
      <VitalsLine model={vitals} />
      <HeroBuffLine activityKind={kind} />
    </div>
  );
};
