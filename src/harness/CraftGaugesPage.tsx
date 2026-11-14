import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { GaugeCluster, type GaugeSpec } from './GaugeCluster';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';

/**
 * Gauge Cluster — crafting (THROWAWAY rendering prototype,
 * 2026-11-13, harness only). The REAL CraftingBenchScene with a
 * gauge cluster seated under it. The hero dial is a PACE
 * TACHOMETER (0–10 /MIN): its needle climbs the fixture's real pace
 * ramp — Phase 1 PACE 2/MIN → Phase 2 PACE 5/MIN → Phase 3
 * PACE 9/MIN — with tick marks AT the three tier values (2, 5, 9);
 * the 9 tick is red because Phase 3 is the ramp's top tier, the
 * bench's fastest shipped state in this fixture. The companion
 * dial is JOB progress (the scene's own progress fraction).
 * No output-count dial: the count is 0 for the whole job and jumps
 * to +1 Patch Kit at completion — the shipped rise at the work
 * point already carries that beat; a dial parked at zero for 11 s
 * would be decoration. (Omission stated in the iteration README.)
 *
 * Fixture + timing identical to the craftbars harness: Patch Kit
 * (real recipe), phases at t+4.6 s / t+7.9 s, completion t+11.4 s.
 *
 * Drive: window.__startCraftGauges(); ?auto=1 runs it after mount;
 * window.__setBeat('slow'|'ramped'|'complete') jumps for stills.
 */

const seatJob = (): WorkshopJobView =>
  ({
    id: 'gauges-craft-job',
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

interface CraftState {
  progress: number;
  pacePerMin: number;
  working: boolean;
  result: 'success' | null;
  riseKey: number;
  hot: string | null;
}

const SLOW: CraftState = { progress: 0.12, pacePerMin: 2, working: false, result: null, riseKey: 0, hot: null };
const RAMPED: CraftState = { progress: 0.55, pacePerMin: 5, working: true, result: null, riseKey: 0, hot: 'pace' };
const COMPLETE: CraftState = { progress: 1, pacePerMin: 9, working: false, result: 'success', riseKey: 1, hot: 'job' };

const toGauges = (s: CraftState): GaugeSpec[] => [
  {
    key: 'pace', label: 'PACE / MIN', hero: true,
    frac: s.pacePerMin / 10, display: String(s.pacePerMin), color: '#F5B83D',
    hot: s.hot === 'pace',
    ticks: [{ at: 0.2 }, { at: 0.5 }, { at: 0.9, red: true }],
    k: 90, d: 9,
  },
  {
    key: 'job', label: 'JOB · PATCH KIT',
    frac: s.progress, display: `${Math.round(s.progress * 100)}%`, color: '#8FE388',
    hot: s.hot === 'job',
    ticks: [{ at: 0.25 }, { at: 0.5 }, { at: 0.75 }],
    k: 70, d: 13,
  },
];

export const CraftGaugesPage: React.FC = () => {
  const [state, setState] = useState<CraftState>(SLOW);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    const patch = (p: Partial<CraftState>) => setState((s) => ({ ...s, ...p }));

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
      at(4600, () => patch({ pacePerMin: 5, hot: 'pace' }));
      at(4800, () => patch({ working: true }));
      at(5900, () => patch({ working: false }));
      at(6400, () => patch({ working: true }));
      at(7500, () => patch({ working: false, progress: 0.55, hot: null }));
      // Phase 3 — continuous, urgent (PACE 9/MIN)
      at(7900, () => patch({ pacePerMin: 9, hot: 'pace' }));
      at(8100, () => patch({ working: true }));
      at(9500, () => patch({ progress: 0.8 }));
      at(10900, () => patch({ progress: 0.97 }));
      // Completion: scene flash + shipped rise at the work point
      at(11400, () => patch({ working: false, progress: 1, result: 'success', hot: 'job', riseKey: Date.now() }));
    };

    const w = window as unknown as Record<string, unknown>;
    w.__startCraftGauges = run;
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
      <GaugeCluster gauges={toGauges(state)} testId="craft-gauge-cluster" />
    </div>
  );
};
