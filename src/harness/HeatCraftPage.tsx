import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { HeatChip, HeatStrip, type HeatSpot } from './HeatField';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';

/**
 * HEAT FIELD — crafting (THROWAWAY harness prototype, iter-09).
 * The REAL CraftingBenchScene (the craftbars harness's seat job:
 * Patch Kit, real recipe recipe_patch_kit) with the work point's
 * heat driven by the real pace:
 *
 *   heat intensity = pace / 9   (9 / MIN, the fixture ramp's top
 *   tier, = FULL HEAT). Phase 1: 2 / MIN -> 0.22. Phase 2: 5 / MIN
 *   -> 0.56. Phase 3: 9 / MIN -> 1.00. Craft heat is SUSTAINED
 *   while the bench works (it is a rate, not an impulse); when the
 *   bench rests between beats the field cools — the stills hold
 *   each phase's working value. Completion: the scene's own flash
 *   + the shipped rise (+1 Patch Kit) at the work point, heat at
 *   its peak for the flash instant.
 *
 * Drive: window.__setBeat(n) held beats (0 slow / 1 paired /
 * 2 ramped / 3 complete); window.__startCraft() full timeline.
 */

const seatJob = (): WorkshopJobView =>
  ({
    id: 'bars-craft-job',
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

const WORK = { x: 58, y: 58 }; // the bench work point (craftbars rise seat)

interface CraftState {
  progress: number;
  working: boolean;
  pace: number; // per minute
  result: 'success' | null;
  rise: boolean;
}

const BEATS: Record<number, CraftState> = {
  0: { progress: 0.3, working: true, pace: 2, result: null, rise: false },
  1: { progress: 0.55, working: true, pace: 5, result: null, rise: false },
  2: { progress: 0.8, working: true, pace: 9, result: null, rise: false },
  3: { progress: 1, working: false, pace: 9, result: 'success', rise: true },
};

export const HeatCraftPage: React.FC = () => {
  const [s, setS] = useState<CraftState>(BEATS[0]);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (n: number) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setS(BEATS[n] ?? BEATS[0]);
    };
    w.__startCraft = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setS({ progress: 0.12, working: false, pace: 2, result: null, rise: false });
      at(600, () => setS((p) => ({ ...p, working: true })));
      at(1700, () => setS((p) => ({ ...p, working: false })));
      at(3000, () => setS((p) => ({ ...p, working: true })));
      at(4100, () => setS((p) => ({ ...p, working: false, progress: 0.3 })));
      at(4600, () => setS((p) => ({ ...p, pace: 5 })));
      at(4800, () => setS((p) => ({ ...p, working: true })));
      at(5900, () => setS((p) => ({ ...p, working: false })));
      at(6400, () => setS((p) => ({ ...p, working: true })));
      at(7500, () => setS((p) => ({ ...p, working: false, progress: 0.55 })));
      at(7900, () => setS((p) => ({ ...p, pace: 9 })));
      at(8100, () => setS((p) => ({ ...p, working: true })));
      at(9500, () => setS((p) => ({ ...p, progress: 0.8 })));
      at(10900, () => setS((p) => ({ ...p, progress: 0.97 })));
      at(11400, () => setS({ progress: 1, working: false, pace: 9, result: 'success', rise: true }));
    };
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      at(600, () => (w.__startCraft as () => void)());
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  const heat = s.working || s.result ? s.pace / 9 : (s.pace / 9) * 0.35;
  const spots: HeatSpot[] =
    heat > 0.01
      ? [{ id: 'work', xPct: WORK.x, yPct: WORK.y, peak: heat, radius: 118, bornAt: 0 }]
      : [];

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div style={{ position: 'relative' }}>
        <CraftingBenchScene
          progress={s.progress}
          causeLabel="Tempering · Patch Kit"
          buysLabel="→ Patch Kit ×1"
          working={s.working}
          result={s.result}
          seatJob={seatJob()}
        />
        {/* heat over the work point — sustained while working */}
        <div className="pointer-events-none absolute inset-0" style={{ zIndex: 26 }}>
          {spots.map((sp) => (
            <div
              key={sp.id}
              style={{
                position: 'absolute',
                left: `${sp.xPct}%`,
                top: `${sp.yPct}%`,
                width: 2 * sp.radius * Math.sqrt(Math.max(sp.peak, 0.001)),
                height: 2 * sp.radius * Math.sqrt(Math.max(sp.peak, 0.001)),
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                background:
                  'radial-gradient(circle, rgba(255,196,96,0.92) 0%, rgba(255,122,26,0.55) 38%, rgba(255,90,20,0) 70%)',
                opacity: 0.22 + 0.78 * sp.peak,
              }}
            />
          ))}
        </div>
        {s.rise && (
          <div
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
      <HeatStrip intensity={s.pace / 9} scaleLabel="FULL = 9 / MIN">
        <HeatChip label="PACE" value={`${s.pace} / MIN`} hot={s.pace >= 9} />
        <HeatChip label="JOB" value="Patch Kit" />
        {s.result ? (
          <HeatChip label="DONE" value="+1 Patch Kit" hot />
        ) : (
          <HeatChip label="PROGRESS" value={`${Math.round(s.progress * 100)}%`} />
        )}
      </HeatStrip>
    </div>
  );
};
