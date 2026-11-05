import React, { useCallback, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import { WorkshopScreen } from '@/screens/WorkshopScreen';
import { RepairServiceSection } from '@/components/workshop/RepairServiceSection';
import { isServiceLaneJob } from '@/components/workshop/serviceLane';
import { useActivityStore, useWorkshopStore } from '@/store';
import { ALL_CRAFT_RECIPES } from '@/content/crafting';
import { buildCraftingActivity } from '@/lib/activity/activityBuilders';
import { humanizeWorkshopError } from '@/lib/workshop/errors';

/**
 * Home's Craft workspace — the whole Workshop, consolidated onto
 * Home (owner ruling 2026-11-04: everything you DO lives on Home,
 * everything you OWN lives in Gear).
 *
 * Composition, top to bottom:
 *  1. The bench truth banner. Being in Craft is what makes the
 *     bench run, and the bench says so: while Craft holds the
 *     action slot the state reads plainly; while anything else
 *     holds it, the banner prints the paused state, the reason,
 *     and the remedy in place (Work the Bench) — never a silent
 *     zero-progress queue.
 *  2. The full Workshop screen, embedded (recipes, queue,
 *     bench-time bank, completions) — the same bench the Gear tab
 *     used to host, minus its page chrome and its animated bench
 *     scene: the one-stage law gives the activity scene to Home's
 *     main stage, and this workspace is controls + information.
 *  3. Repairs & Service — the service-lane jobs (Garage repairs,
 *     shield recalibrations), managed where the bench lives now.
 *
 * The workspace opens three ways: Craft is the current action, the
 * service lane is the current action, or the player opened the
 * bench to look (rail Craft stop / a 'workshop' door) — looking
 * never switches the action by itself.
 */

function bannerReason(activeActionKind: string | null): string {
  switch (activeActionKind) {
    case 'roaming_loot':
      return "you're roaming";
    case 'boss_prep':
    case 'boss_fight':
      return "you're in a boss fight";
    case 'endless_run':
      return "you're in the Chaos Chamber";
    case 'extraction':
      return "you're extracting";
    case 'salvaging':
      return "you're salvaging";
    case 'market_listing':
      return "you're at the market";
    case 'idle_standby':
    case 'none':
    case null:
      return 'no action is running';
    default:
      return "you're away";
  }
}

export const HomeCraftBench: React.FC<{
  onNavigate?: (screen: string) => void;
  /** Present only when the bench is open as a view over another action. */
  onLeave?: () => void;
}> = ({ onNavigate, onLeave }) => {
  const activity = useActivityStore();
  const jobs = useWorkshopStore((s) => s.server?.jobs);
  const [activityError, setActivityError] = useState<string | null>(null);

  const kind = activity.current.kind;
  const isCrafting = kind === 'crafting';
  const isService = kind === 'workshop_service';

  const benchJobs = useMemo(
    () => (jobs ?? []).filter(
      (j) => !isServiceLaneJob(j) && (j.state === 'running' || j.state === 'queued' || j.state === 'paused'),
    ),
    [jobs],
  );
  const runningJob = benchJobs.find((j) => j.state === 'running');

  // The remedy, identical to the Workshop's own start: aim Crafting
  // at the head job's recipe (or the bench itself when the queue is
  // empty) through the activity store — the Chef settles the rest.
  const startCrafting = useCallback(async () => {
    setActivityError(null);
    const head = benchJobs[0];
    const recipe = head ? ALL_CRAFT_RECIPES.find((r) => r.id === head.recipeId) : undefined;
    try {
      await activity.start(
        buildCraftingActivity(recipe ?? { id: 'workshop', name: 'Workshop', category: 'utility' }, head?.bench ?? 1),
      );
    } catch (error) {
      setActivityError(humanizeWorkshopError(error));
    }
  }, [activity, benchJobs]);

  const stateWord = isCrafting ? 'Running' : isService ? 'Service' : benchJobs.length > 0 ? 'Paused' : 'Idle';
  const stateTone = isCrafting ? 'text-green' : isService ? 'text-cyan' : benchJobs.length > 0 ? 'text-red' : 'text-amber';
  // The card's side beam carries the state (MobileCard's rarity
  // beam, driven by state instead of rarity): green running, the
  // service yellow on the service lane, red paused, amber idle.
  const stateHex = isCrafting ? '#7CFC00' : isService ? '#F7D20B' : benchJobs.length > 0 ? '#FF4B5C' : '#FF9000';
  const stateWash = isCrafting ? 'bg-green/5' : isService ? 'bg-cyan/5' : benchJobs.length > 0 ? 'bg-red/5' : '';
  // The hero figure beside the state word: the running job's
  // progress, or how many jobs wait. Numbers lead (eye-leading
  // law); the reason line below carries the words.
  const runningPct = runningJob
    ? Math.min(100, Math.floor(((runningJob.unitsCompleted * runningJob.unitDurationMs + runningJob.accruedMs) / Math.max(1, runningJob.unitsTotal * runningJob.unitDurationMs)) * 100))
    : null;

  return (
    <div className="space-y-3" data-testid="home-craft-bench">
      {onLeave && (
        <button
          type="button"
          onClick={onLeave}
          className="bl-secondary inline-flex items-center gap-1 px-3 py-2 text-[11px] font-black text-amber"
        >
          <PxIcon name="chevL" size={13} /> Back to your current action
        </button>
      )}

      <MobileCard rarityColor={stateHex} className={`space-y-2 ${stateWash}`} >
        <div className="flex items-center gap-2 text-[15px] font-black text-text-primary">
          <span className="text-amber"><PxIcon name="anvil" size={17} /></span>
          The Workshop
        </div>

        <div className="flex items-end justify-between gap-2">
          <span className={`text-[20px] font-black uppercase leading-none tracking-wide ${stateTone}`} data-testid="craft-bench-state">
            {stateWord}
          </span>
          {isCrafting && runningJob && runningPct !== null && (
            <span className="text-right leading-none">
              <span className="text-[20px] font-black text-text-primary">{runningJob.unitsCompleted}/{runningJob.unitsTotal}</span>
              <span className="block text-[11px] font-bold text-text-muted">units · {runningPct}%</span>
            </span>
          )}
          {!isCrafting && !isService && benchJobs.length > 0 && (
            <span className="text-right leading-none">
              <span className="text-[20px] font-black text-text-primary">{benchJobs.length}</span>
              <span className="block text-[11px] font-bold text-text-muted">waiting</span>
            </span>
          )}
        </div>

        <div className="text-[11px] text-text-secondary leading-relaxed" data-testid="craft-bench-banner">
          {isCrafting
            ? runningJob
              ? <>Crafting is your current action — the bench is running. Working: <span className="font-bold text-text-primary">{runningJob.name}</span>.</>
              : 'Crafting is your current action — the bench is running. Queue a recipe below and it starts at once.'
            : isService
              ? <>Workshop Service is your current action — <span className="font-bold text-text-primary">{activity.current.targetLabel ?? 'service work'}</span> is progressing in Repairs &amp; Service below. The craft bench is paused meanwhile.</>
              : benchJobs.length > 0
                ? <>Bench paused — {bannerReason(kind)}. {benchJobs.length} job{benchJobs.length === 1 ? '' : 's'} waiting; jobs progress only while Crafting holds the action slot.</>
                : 'The bench is idle. Queue a recipe below — jobs run while Crafting is your action.'}
        </div>

        {!isCrafting && (
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => void startCrafting()}
            disabled={activity.pending}
            className="bl-primary w-full py-3 text-xs font-black uppercase tracking-wide transition-colors disabled:opacity-50"
            data-testid="craft-bench-work-button"
          >
            {activity.pending ? 'Syncing…' : isService ? 'Work the Bench instead' : 'Work the Bench'}
          </motion.button>
        )}
        {activityError && <div className="text-[11px] text-red">{activityError}</div>}
      </MobileCard>

      <WorkshopScreen embedded onNavigate={onNavigate} />

      <RepairServiceSection onNavigate={onNavigate} />
    </div>
  );
};
