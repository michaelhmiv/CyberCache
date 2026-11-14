import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { RacePair } from './RacePair';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';

/**
 * Quota Race — crafting (THROWAWAY rendering prototype,
 * 2026-11-13, harness only). The REAL CraftingBenchScene with a
 * two-bar race seated under it.
 *
 * THE RACE: job progress (top, climbing to 100% — the completed
 * Patch Kit) vs the PACE tier (bottom, climbing 2 → 5 → 9 /MIN
 * toward the fixture ramp's 9 /MIN top tier, the quota line).
 * The job bar's SPEED visibly changes at the real phase
 * boundaries (t+4.6 s → 5/MIN, t+7.9 s → 9/MIN): in Phase 1 the
 * progress bar crawls while the pace bar sits low; by Phase 3
 * both bars sprint. The status line names who leads at each beat
 * in plain arithmetic (progress % vs pace % of quota).
 *
 * Fixture + timing identical to the craftbars harness: Patch Kit
 * (real recipe), phases at t+4.6 s / t+7.9 s, completion t+11.4 s:
 * scene result flash + shipped rise at the work point
 * (+1 Patch Kit).
 *
 * Drive: window.__startCraftRace(); ?auto=1 runs it after mount;
 * window.__setBeat('slow'|'ramped'|'complete') jumps for stills.
 */

const seatJob = (): WorkshopJobView =>
  ({
    id: 'race-craft-job',
    bench: 0,
    kind: 'consumable',
    recipeId: 'recipe_patch_kit',
    name: 'Patch Kit',
    state: 'running',
    unitsTotal: 2,
    unitsCompleted: 0,
    unitDurationMs: 60_000,
    accruedMs: 12_000,
    remainingMs: 48_000,
    xpAwarded: 0,
    gearRarity: null,
    catalystMaterialId: null,
    outputs: [],
    createdAtMs: 0,
    completedAtMs: null,
    repairItemId: null,
    repairKitType: null,
    repairPointsRestored: 0,
  }) as WorkshopJobView;

const PACE_QUOTA = 9;

interface CraftRaceState {
  progress: number;
  pacePerMin: number;
  working: boolean;
  result: 'success' | null;
  riseKey: number;
  status: string;
  hot: 'top' | 'bottom' | null;
}

const SLOW: CraftRaceState = {
  progress: 0.12, pacePerMin: 2, working: false, result: null, riseKey: 0,
  status: 'PACE LEADS THE CLOCK, JOB CRAWLS — 12% DONE AT 2 / MIN',
  hot: null,
};
const RAMPED: CraftRaceState = {
  progress: 0.55, pacePerMin: 5, working: true, result: null, riseKey: 0,
  status: 'RAMPED — JOB 55% · PACE AT 5 / MIN, CHASING THE 9 / MIN LINE',
  hot: 'bottom',
};
const COMPLETE: CraftRaceState = {
  progress: 1, pacePerMin: 9, working: false, result: 'success', riseKey: 1,
  status: 'FINISH — JOB REACHES 100% AT FULL 9 / MIN PACE · +1 PATCH KIT',
  hot: 'top',
};

export const CraftRacePage: React.FC = () => {
  const [state, setState] = useState<CraftRaceState>(SLOW);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    const patch = (p: Partial<CraftRaceState>) => setState((s) => ({ ...s, ...p }));

    const setBeat = (beat: string) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      if (beat === 'slow') setState(SLOW);
      else if (beat === 'ramped') setState(RAMPED);
      else if (beat === 'complete') setState(COMPLETE);
    };

    const run = () => {
      setBeat('slow');
      // Phase 1 — slow: single beats, long rests (PACE 2/MIN)
      at(600, () => patch({ working: true }));
      at(1700, () => patch({ working: false }));
      at(3000, () => patch({ working: true }));
      at(4100, () => patch({ working: false, progress: 0.3 }));
      // Phase 2 — paired beats (PACE 5/MIN)
      at(4600, () => patch({ pacePerMin: 5, hot: 'bottom', status: RAMPED.status }));
      at(4800, () => patch({ working: true }));
      at(5900, () => patch({ working: false }));
      at(6400, () => patch({ working: true }));
      at(7500, () => patch({ working: false, progress: 0.55, hot: null }));
      // Phase 3 — continuous, urgent (PACE 9/MIN)
      at(7900, () => patch({ pacePerMin: 9, hot: 'bottom', status: 'FULL PACE — 9 / MIN · JOB SPRINTING TO THE LINE' }));
      at(8100, () => patch({ working: true }));
      at(9500, () => patch({ progress: 0.8 }));
      at(10900, () => patch({ progress: 0.97 }));
      // Completion: scene flash + shipped rise at the work point
      at(11400, () => patch({ working: false, progress: 1, result: 'success', hot: 'top', status: COMPLETE.status, riseKey: Date.now() }));
    };

    const w = window as unknown as Record<string, unknown>;
    w.__startCraftRace = run;
    w.__setBeat = setBeat;
    if (new URLSearchParams(window.location.search).get('auto') === '1') at(600, run);
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div style={{ position: 'relative' }}>
        <CraftingBenchScene
          progress={state.progress}
          causeLabel="Tempering · Patch Kit"
          buysLabel="→ Patch Kit ×1"
          working={state.working}
          result={state.result}
          seatJob={seatJob()}
        />
        {state.riseKey > 0 && (
          <div
            key={state.riseKey}
            className="pointer-events-none absolute z-30"
            style={{ left: '58%', top: '67%', width: 46, height: 58, transform: 'translate(-50%, -78%)' }}
          >
            <motion.div
              initial={{ y: 6, opacity: 0, scale: 0.6 }}
              animate={{ y: [6, -14, -26, -30], opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }}
              transition={{ duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut' }}
              style={{ width: '100%', height: '100%' }}
            >
              <DropRiseIcon tone="material" label="+1 Patch Kit" />
            </motion.div>
          </div>
        )}
      </div>
      <RacePair
        testId="craft-race-pair"
        quotaText="QUOTA — JOB 100% · PACE 9 / MIN"
        top={{ label: 'JOB PROGRESS · PATCH KIT', valueText: `${Math.round(state.progress * 100)}%`, frac: state.progress, color: '#8FE388', hot: state.hot === 'top' }}
        bottom={{ label: 'PACE', valueText: `${state.pacePerMin} / 9 PER MIN`, frac: state.pacePerMin / PACE_QUOTA, color: '#F5B83D', hot: state.hot === 'bottom' }}
        status={state.status}
        detail="PACE TIERS ARE THE FIXTURE RAMP: 2 / MIN → 5 / MIN → 9 / MIN"
      />
    </div>
  );
};
