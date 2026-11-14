import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LiveTurfDiorama, DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { CraftingBenchScene, ExtractionScene } from '@/components/pixelArt/ActionScenes';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { researchCourse, researchFaculty } from '@/content/research';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_PHASES, FIXTURE_OUTCOME, FIXTURE_WEAPON as BOSS_WEAPON } from './fightFixture';
import { SignalTrace, type TraceBurst } from './SignalTrace';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';

/**
 * SIGNAL TRACE harness (iter-03, THROWAWAY prototype — harness
 * only). One page, five activities (?activity=roam|boss|craft|
 * gather|research), each mounting the REAL stage/scene with the
 * Signal Trace band seated under it. Beats are deterministic:
 * ?beat=<name> holds a frame for stills; window.__setBeat(name)
 * steps live; ?auto=1 runs the roam timeline once for the clip.
 *
 * Fixtures are the INDEX's verbatim combat/craft fixtures plus
 * real defs: Dune Tyrant (src/constants/bosses.ts — 800 HP, Sand
 * Slam every 18 s, 3 s windup), extraction pass math
 * (src/content/extraction.ts — 192 draws/h = 32 draws per 10-min
 * pass, +20 mastery XP/pass), Ballistics Theory
 * (src/content/research.ts — Xenotech T1, 6 h, 2,500 cr).
 */

// ── Shared combat fixture (INDEX, verbatim) ─────────────────────
const T1: TraceBurst = { total: 96, parts: [ { key: 'dmg', value: 58 }, { key: 'fire', value: 22 }, { key: 'spd', value: 16 } ] };
const T2: TraceBurst = { total: 104, parts: [ { key: 'dmg', value: 52 }, { key: 'fire', value: 18 }, { key: 'spd', value: 14 }, { key: 'molten', value: 20 } ] };
const T3: TraceBurst = { total: 156, crit: true, parts: [ { key: 'dmg', value: 88 }, { key: 'fire', value: 24 }, { key: 'spd', value: 12 }, { key: 'molten', value: 14 }, { key: 'echo', value: 18 } ] };

const FIXTURE_WEAPON: Weapon = {
  id: 'roam-harness-weapon',
  name: 'Harness Carbine',
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  rarity: Rarity.Epic,
  element: Element.Fire,
  level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } },
    { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } },
    { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } },
    { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ],
  pixelSeed: 42,
} as unknown as Weapon;
void DropSource;

const params = new URLSearchParams(window.location.search);
const ACTIVITY = params.get('activity') ?? 'roam';
const INITIAL_BEAT = params.get('beat') ?? 'rest';

let beatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  useTickFeedStore.setState({ events: [{ id: `signal-beat-${beatSeq}`, at: Date.now(), detail: 'signal-harness', ...partial } as TickEvent] });
};

const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>{children}</div>
);

// ── ROAM ────────────────────────────────────────────────────────
const RoamSignal: React.FC = () => {
  const [beat, setBeat] = useState(INITIAL_BEAT);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 300, currentTargetHpMax: 300 });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    useLoadoutStore.getState().setSlot('vehicle', null);
    const apply = (b: string) => {
      setBeat(b);
      if (b === 'rest') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 300, currentTargetHpMax: 300 });
        useTickFeedStore.setState({ events: [] });
      } else if (b === 'surge') {
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        useKillCycleStore.setState({ currentTargetHp: 100 });
      } else if (b === 'kill') {
        seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
        useKillCycleStore.setState({ currentTargetHp: 0 });
      } else if (b === 'drop') {
        seedBeatEvent({ tone: 'material', label: '+1 TechFragments', value: 1 });
        useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
      }
    };
    apply(INITIAL_BEAT);
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = apply;
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const run = () => {
      apply('rest');
      at(1000, () => apply('tick1'));
      at(4000, () => apply('surge'));
      at(7000, () => apply('kill'));
      at(8600, () => apply('drop'));
    };
    w.__startSignal = run;
    if (params.get('auto') === '1') at(600, run);
    return () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const trace =
    beat === 'rest' ? { bursts: [] as TraceBurst[], caption: 'WRAITH SCAVENGER · NO TICKS YET', state: '300 / 300 HP' }
    : beat === 'tick1' ? { bursts: [T1], caption: 'TICK 1 · PLAIN HIT', state: '204 / 300 HP' }
    : beat === 'surge' ? { bursts: [T1, T2], caption: 'TICK 2 · MOLTEN CORE', state: '100 / 300 HP', shieldDip: 28 }
    : { bursts: [T1, T2, T3], caption: 'TICK 3 · CRIT · MOLTEN + ECHO — KILL', state: '0 / 300 HP' };
  return (
    <Shell>
      <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={FIXTURE_WEAPON} playerLevel={5} equippedCount={4} activityKind="roaming_loot" />
      <SignalTrace
        bursts={trace.bursts}
        caption={trace.caption}
        captionColor={beat === 'kill' ? '#FF4D2E' : '#8A93A3'}
        stateLabel={trace.state}
        shieldDip={'shieldDip' in trace ? (trace as { shieldDip?: number }).shieldDip : undefined}
        footerLeft="AMP = DAMAGE · SHAPE = SOURCE"
        footerRight="CRIT 25% · ×2.0"
      />
    </Shell>
  );
};

// ── BOSS ────────────────────────────────────────────────────────
// Dune Tyrant, 800 HP (bosses.ts). The captured window opens
// mid-fight at 356 HP so the fixture's three ticks close exactly:
// 356 -96-> 260 -104-> 156 -156-> 0.
const BOSS = REGION_1_BOSSES.find((b) => b.id === 'dune_tyrant')!;
const bossTimeline = (bossHp: number, finished: boolean, log: FightTimeline['damageLog']): FightTimeline => ({
  outcome: FIXTURE_OUTCOME,
  startedAt: 0,
  finishedAt: finished ? performance.now() : null,
  currentPhaseIndex: finished ? FIXTURE_PHASES.length : 1,
  playerHp: 340,
  playerHpMax: 340,
  bossHp,
  bossHpMax: BOSS.health,
  damageLog: log,
});

const BossSignal: React.FC = () => {
  const [beat, setBeat] = useState(INITIAL_BEAT);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (b: string) => setBeat(b);
  }, []);
  const log1 = [{ id: 's1', target: 'boss' as const, value: 96, phaseName: 'Shield Wall' }];
  const log2 = [...log1, { id: 's2', target: 'boss' as const, value: 104, phaseName: 'Shield Wall' }];
  const log3 = [...log2, { id: 's3', target: 'boss' as const, value: 156, phaseName: 'Shield Wall' }];
  const tl =
    beat === 'rest' ? bossTimeline(356, false, [])
    : beat === 'telegraph' ? bossTimeline(260, false, log1)
    : bossTimeline(0, true, log3);
  const traceProps =
    beat === 'rest'
      ? { bursts: [] as TraceBurst[], caption: `${BOSS.name.toUpperCase()} · MID-FIGHT`, state: '356 / 800 HP', telegraph: { label: 'SAND SLAM', progress: 0.15, countdown: '18S CADENCE' } }
      : beat === 'telegraph'
        ? { bursts: [T1], caption: 'TICK 1 · 96 — TELEGRAPH INBOUND', state: '260 / 800 HP', telegraph: { label: 'SAND SLAM', progress: 0.8, countdown: 'WINDUP 3.0S' } }
        : { bursts: [T1, T2, T3], caption: 'CRIT 156 — TYRANT DOWN', state: '0 / 800 HP', telegraph: null };
  return (
    <Shell>
      <div data-testid="boss-stage-wrap">
        <BossFightStageDom timeline={tl} phases={FIXTURE_PHASES} bossId={BOSS.id} weapon={BOSS_WEAPON} />
      </div>
      <SignalTrace
        bursts={traceProps.bursts}
        caption={traceProps.caption}
        captionColor={beat === 'kill' ? '#FF4D2E' : '#8A93A3'}
        stateLabel={traceProps.state}
        telegraph={traceProps.telegraph}
        footerLeft="DASHED = INCOMING SIGNATURE"
        footerRight="SLAM EVERY 18S · WINDUP 3S"
      />
    </Shell>
  );
};

// ── CRAFT ───────────────────────────────────────────────────────
const seatJob = (): WorkshopJobView =>
  ({
    id: 'signal-craft-job', bench: 0, kind: 'consumable', recipeId: 'recipe_patch_kit', name: 'Patch Kit',
    state: 'running', unitsTotal: 2, unitsCompleted: 0, unitDurationMs: 60_000, accruedMs: 12_000,
    remainingMs: 48_000, xpAwarded: 0, gearRarity: null, catalystMaterialId: null, outputs: [],
    createdAtMs: 0, completedAtMs: null, repairItemId: null, repairKitType: null, repairPointsRestored: 0,
  }) as WorkshopJobView;

const beatBurst = (v: number): TraceBurst => ({ total: v, parts: [{ key: 'find', value: v }] });

const CraftSignal: React.FC = () => {
  const [beat, setBeat] = useState(INITIAL_BEAT);
  const timers = useRef<number[]>([]);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (b: string) => setBeat(b);
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const run = () => {
      setBeat('slow');
      at(4600, () => setBeat('paired'));
      at(7900, () => setBeat('ramped'));
      at(11400, () => setBeat('complete'));
    };
    w.__startSignal = run;
    if (params.get('auto') === '1') at(600, run);
    return () => { timers.current.forEach((t) => window.clearTimeout(t)); timers.current = []; };
  }, []);
  const slow = beat === 'slow';
  const complete = beat === 'complete';
  const progress = slow ? 0.3 : beat === 'paired' ? 0.55 : complete ? 1 : 0.8;
  const bursts: TraceBurst[] = slow
    ? [beatBurst(18)]
    : beat === 'paired'
      ? [beatBurst(18), beatBurst(18)]
      : [beatBurst(18), beatBurst(18), beatBurst(18), beatBurst(18), beatBurst(18), beatBurst(18)];
  return (
    <Shell>
      <div style={{ position: 'relative' }}>
        <CraftingBenchScene progress={progress} causeLabel="Tempering · Patch Kit" buysLabel="→ Patch Kit ×1" working={!complete} result={complete ? 'success' : null} seatJob={seatJob()} />
        {complete && (
          <div className="pointer-events-none absolute z-30" style={{ left: '58%', top: '67%', width: 46, height: 58, transform: 'translate(-50%, -78%)' }}>
            <motion.div initial={{ y: 6, opacity: 0, scale: 0.6 }} animate={{ y: [6, -14, -26, -30], opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }} transition={{ duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut' }} style={{ width: '100%', height: '100%' }}>
              <DropRiseIcon tone="material" label="+1 Patch Kit" />
            </motion.div>
          </div>
        )}
      </div>
      <SignalTrace
        bursts={bursts}
        caption={complete ? 'JOB COMPLETE · +1 PATCH KIT' : slow ? 'WORK BEATS · SINGLE' : beat === 'paired' ? 'WORK BEATS · PAIRED' : 'WORK BEATS · CONTINUOUS'}
        captionColor={complete ? '#F5B83D' : '#8A93A3'}
        stateLabel={complete ? 'PACE 9 / MIN · DONE' : slow ? 'PACE 2 / MIN' : beat === 'paired' ? 'PACE 5 / MIN' : 'PACE 9 / MIN'}
        footerLeft="DENSITY = PACE"
        footerRight="PATCH KIT · REAL RECIPE"
      />
    </Shell>
  );
};

// ── GATHER (extraction) ─────────────────────────────────────────
// One Surface pass at Dustwaste Frontier: 10 min, 32 draws at
// 192/h (extraction.ts), +20 mastery XP on completion.
const GatherSignal: React.FC = () => {
  const [beat, setBeat] = useState(INITIAL_BEAT);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (b: string) => setBeat(b);
  }, []);
  const flow = beat === 'flow';
  const yields = beat === 'yield';
  const blips = (n: number, v: number): TraceBurst[] => Array.from({ length: n }, () => beatBurst(v));
  return (
    <Shell>
      <ExtractionScene
        progress={yields ? 1 : flow ? 0.45 : 0.04}
        causeLabel="Sifting · Dustwaste Frontier"
        buysLabel={yields ? 'Pass complete' : flow ? 'Pass 1 · Surface' : 'Pass 1 · Surface'}
      />
      <SignalTrace
        bursts={yields ? blips(6, 22) : flow ? blips(3, 22) : []}
        caption={yields ? 'PASS COMPLETE · 32 DRAWS SETTLED' : flow ? 'FINDS LANDING · MATERIALS + ESSENCES' : 'SURFACE PASS · NO DRAWS YET'}
        captionColor={yields ? '#F5B83D' : '#8A93A3'}
        stateLabel={yields ? 'MASTERY +20 XP' : flow ? 'DRAWS 14 / 32' : 'DRAWS 0 / 32'}
        footerLeft="BLIP = FIND CLUSTER"
        footerRight="192 DRAWS/H · 10 MIN PASS"
      />
    </Shell>
  );
};

// ── RESEARCH ────────────────────────────────────────────────────
// Ballistics Theory (research.ts): Xenotech T1, 6 h, 2,500 cr,
// unlock "Weapon damage +1% everywhere damage is priced."
const ResearchSignal: React.FC = () => {
  const [beat, setBeat] = useState(INITIAL_BEAT);
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (b: string) => setBeat(b);
  }, []);
  const course = researchCourse('ballistics_theory')!;
  const faculty = researchFaculty(course.faculty);
  const done = beat === 'done';
  const flow = beat === 'flow';
  return (
    <Shell>
      <div style={{ background: '#0B0D12', border: '2px solid #232833', padding: '14px 14px 12px', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 15, fontWeight: 900, color: '#E8ECF3' }}>{course.name}</span>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: faculty.color }}>{faculty.name.toUpperCase()} · TIER 1</span>
        </div>
        <div style={{ marginTop: 6, fontSize: 12, color: '#8A93A3', fontVariantNumeric: 'tabular-nums' }}>
          {course.durationHours}H COURSE · {course.costCredits.toLocaleString()} CR · {done ? 'COMPLETE' : flow ? '3.0H / 6H STUDIED' : 'ENROLLED · 0.0H / 6H'}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: done ? '#E8ECF3' : '#5B6472' }}>{course.unlockText}</div>
      </div>
      <SignalTrace
        bursts={done ? [{ total: 1, parts: [{ key: 'echo', value: 30 }] }] : []}
        caption={done ? 'ENROLLMENT COMPLETE · UNLOCK LIVE' : flow ? 'WALL-CLOCK PROGRESS · NO FARMABLE PAYOUT' : 'ENROLLED · CLOCK RUNNING'}
        captionColor={done ? '#B18CFF' : '#8A93A3'}
        stateLabel={done ? '6H / 6H' : flow ? '3.0H / 6H' : '0.0H / 6H'}
        slowWave={done ? 1 : flow ? 0.5 : 0.02}
        footerLeft="SLOW WAVE = WALL CLOCK"
        footerRight="MASTERY +10 XP / COURSE HOUR"
      />
    </Shell>
  );
};

export const SignalHarnessPage: React.FC = () => {
  if (ACTIVITY === 'boss') return <BossSignal />;
  if (ACTIVITY === 'craft') return <CraftSignal />;
  if (ACTIVITY === 'gather') return <GatherSignal />;
  if (ACTIVITY === 'research') return <ResearchSignal />;
  return <RoamSignal />;
};
