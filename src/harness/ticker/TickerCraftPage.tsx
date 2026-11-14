import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CraftingBenchScene } from '@/components/pixelArt/ActionScenes';
import { DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import { TickerLedger, tapePush, type LedgerEntry } from './TickerLedger';

/**
 * TICKER LEDGER — CRAFT (iter-04 harness, dev only).
 *
 * The real CraftingBenchScene running the craftbars harness's own
 * Patch Kit script (real recipe id recipe_patch_kit, production
 * seat path). Where the bars mock drew a pace bar, the ledger posts
 * the work as entries: each settled beat is a line, the pace ramps
 * post as their own amber entries (2/MIN → 5/MIN → 9/MIN) and the
 * entries land faster as the pace does, and completion is the
 * closing entry + balance line over the scene's shipped result
 * flash and drop rise.
 *
 *   ?freeze=slow|ramped|complete   hold a beat (stills)
 *   ?auto=1                         play once
 *   window.__startCraft()           play from the top
 */

const seatJob = (): WorkshopJobView =>
  ({
    id: 'ticker-craft-job',
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

type Row = Omit<LedgerEntry, 'id'>;
const OPEN_ROWS: Row[] = [
  { t: 'T+0:00', kind: 'open', label: 'JOB — PATCH KIT · BENCH 1', balance: 'JOB 12%' },
  { t: 'T+0:00', kind: 'pace', label: 'PACE', amount: '2/MIN', balance: 'SINGLE' },
];
const PHASE2_ROWS: Row[] = [{ t: 'T+0:05', kind: 'pace', label: 'PACE', amount: '5/MIN', balance: 'PAIRED' }];
const PHASE3_ROWS: Row[] = [{ t: 'T+0:08', kind: 'pace', label: 'PACE', amount: '9/MIN', balance: 'CONT.' }];
const COMPLETE_ROWS: Row[] = [
  { t: 'T+0:11', kind: 'yield', label: 'YIELD — PATCH KIT', amount: '+1', balance: 'JOB 100%' },
  { t: 'T+0:11', kind: 'close', label: 'JOB SETTLED — PATCH KIT', amount: '+1', balance: 'DONE' },
];

export const TickerCraftPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const [progress, setProgress] = useState(0.12);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<'success' | null>(null);
  const [riseKey, setRiseKey] = useState(0);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [foot, setFoot] = useState<[string, string]>(['PACE 2/MIN', 'JOB 12%']);
  const timers = useRef<number[]>([]);

  const push = (rows: Row[], f?: [string, string]) => {
    tapePush(setEntries, rows);
    if (f) setFoot(f);
  };
  const beat = (t: string, label: string, pct: number, pace: string) =>
    push([{ t, kind: 'step', label, balance: `JOB ${Math.round(pct * 100)}%` }], [pace, `JOB ${Math.round(pct * 100)}%`]);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const freeze = params.get('freeze');

    if (freeze) {
      // Settled states, no timers: post the tape up to the beat.
      setEntries([]);
      push(OPEN_ROWS, ['PACE 2/MIN', 'JOB 12%']);
      push([{ t: 'T+0:02', kind: 'step', label: 'BEAT SETTLED', balance: 'JOB 30%' }]);
      if (freeze === 'ramped' || freeze === 'complete') {
        push(PHASE2_ROWS, ['PACE 5/MIN', 'JOB 55%']);
        push([{ t: 'T+0:06', kind: 'step', label: 'BEAT SETTLED', balance: 'JOB 55%' }]);
        push(PHASE3_ROWS, ['PACE 9/MIN', 'JOB 80%']);
        push([{ t: 'T+0:10', kind: 'step', label: 'BEAT SETTLED', balance: 'JOB 97%' }]);
        setProgress(0.97);
        setFoot(['PACE 9/MIN', 'JOB 97%']);
      }
      if (freeze === 'complete') {
        push(COMPLETE_ROWS, ['PACE 9/MIN', 'JOB 100%']);
        setProgress(1);
        setResult('success');
        setRiseKey(1);
        setFoot(['PACE 9/MIN', 'JOB 100%']);
      }
      if (freeze === 'slow') {
        setProgress(0.3);
        setFoot(['PACE 2/MIN', 'JOB 30%']);
      }
      return undefined;
    }

    const run = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setProgress(0.12);
      setWorking(false);
      setResult(null);
      setRiseKey(0);
      setEntries([]);
      push(OPEN_ROWS, ['PACE 2/MIN', 'JOB 12%']);

      // Phase 1 — slow: single beats, long rests (PACE 2/MIN)
      at(600, () => setWorking(true));
      at(1700, () => setWorking(false));
      at(3000, () => setWorking(true));
      at(4100, () => {
        setWorking(false);
        setProgress(0.3);
        beat('T+0:04', 'BEAT SETTLED', 0.3, 'PACE 2/MIN');
      });
      // Phase 2 — paired beats (PACE 5/MIN)
      at(4600, () => push(PHASE2_ROWS, ['PACE 5/MIN', 'JOB 30%']));
      at(4800, () => setWorking(true));
      at(5900, () => setWorking(false));
      at(6400, () => setWorking(true));
      at(7500, () => {
        setWorking(false);
        setProgress(0.55);
        beat('T+0:07', 'BEAT SETTLED', 0.55, 'PACE 5/MIN');
      });
      // Phase 3 — continuous (PACE 9/MIN)
      at(7900, () => push(PHASE3_ROWS, ['PACE 9/MIN', 'JOB 55%']));
      at(8100, () => setWorking(true));
      at(9500, () => {
        setProgress(0.8);
        beat('T+0:09', 'BEAT SETTLED', 0.8, 'PACE 9/MIN');
      });
      at(10900, () => {
        setProgress(0.97);
        beat('T+0:11', 'BEAT SETTLED', 0.97, 'PACE 9/MIN');
      });
      // Completion: closing entry + balance line over flash + rise
      at(11400, () => {
        setWorking(false);
        setProgress(1);
        setResult('success');
        setRiseKey((k) => k + 1);
        push(COMPLETE_ROWS, ['PACE 9/MIN', 'JOB 100%']);
      });
    };
    const w = window as unknown as Record<string, unknown>;
    w.__startCraft = run;
    if (params.get('auto') === '1') at(600, run);
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div style={{ position: 'relative' }}>
        <CraftingBenchScene
          progress={progress}
          causeLabel="Tempering · Patch Kit"
          buysLabel="→ Patch Kit ×1"
          working={working}
          result={result}
          seatJob={seatJob()}
        />
        {riseKey > 0 && (
          <div
            key={riseKey}
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
      <TickerLedger title="CRAFT — LEDGER" footLeft={foot[0]} footRight={foot[1]} entries={entries} height={264} />
    </div>
  );
};
