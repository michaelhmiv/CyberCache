import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LiveTurfDiorama, DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { GhostHpBar } from '@/components/pixelArt/PixelFx';
import { CraftingBenchScene, ExtractionScene } from '@/components/pixelArt/ActionScenes';
import { Lamp, Module, Readout } from '@/components/profile/ResearchConsoleKit';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { getMaterialVisual } from '@/constants/visualAssets';
import {
  EXTRACTION_LEVER_DEFAULTS,
  EXTRACTION_MASTERY_XP_PER_PASS,
  EXTRACTION_PASS_MS,
} from '@/content/extraction';
import { researchCourse, researchFaculty, RESEARCH_MASTERY_XP_PER_HOUR } from '@/content/research';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_OUTCOME, FIXTURE_PHASES, FIXTURE_WEAPON } from './fightFixture';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import {
  HeroCounter,
  Odometer,
  RateWheel,
  SplitRow,
  SRC,
  clock,
  headStyle,
  numStyle,
  pad,
  panelStyle,
  type SplitPart,
} from './OdometerKit';

/**
 * ODOMETER SPLITS harness (iter-08, THROWAWAY rendering prototype —
 * dev only, served at /odometer-harness.html). One page, five
 * activities via ?act=roam|boss|craft|gather|research; beats are
 * jumped via window.__setBeat(name) for stills; the roam page also
 * runs the fixture timeline via window.__startOdo() (?auto=1) for
 * the clip.
 *
 * Every surface is the real shipped component (LiveTurfDiorama,
 * BossFightStage, CraftingBenchScene, ExtractionScene,
 * ResearchConsoleKit); the OdometerKit primitives seated under each
 * stage are the concept's display language. Presentation only — no
 * combat math is run; the INDEX fixture is staged through the same
 * stores the shipped harnesses use.
 *
 * Fixture arithmetic (INDEX, verbatim — components sum to totals):
 *   Tick 1: 96  = DMG 58 · FIRE 22 · SPD 16            (300 → 204)
 *   Tick 2: 104 = DMG 52 · FIRE 18 · SPD 14 · MOLTEN 20 (204 → 100)
 *           parting swipe: SHLD 64 → 36, recharging toward 52
 *   Tick 3: 156 = DMG 44 ×2.0 = 88 · FIRE 24 · SPD 12 · MOLTEN 14 ·
 *           ECHO 18 — the kill (100 → 0). Drop +1 TechFragments.
 *   Split deltas (real subtraction): 104 − 96 = +8 · 156 − 104 = +52
 *   Cumulative damage dealt: 96 → 200 → 356 (= 300 HP + 56 overkill,
 *   shown truthfully as dealt, never capped at 300).
 */

const params = new URLSearchParams(window.location.search);
const activity = params.get('activity') ?? params.get('act') ?? 'roam';
const initialBeat = params.get('beat') ?? undefined;

const WEAPON: Weapon = {
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

/* ─── Combat fixture (shared roam/boss split anatomy) ─────────── */

const T1: SplitPart[] = [
  { label: 'DMG', value: 58, color: SRC.dmg },
  { label: 'FIRE', value: 22, color: SRC.fire },
  { label: 'SPD', value: 16, color: SRC.spd },
];
const T2: SplitPart[] = [
  { label: 'DMG', value: 52, color: SRC.dmg },
  { label: 'FIRE', value: 18, color: SRC.fire },
  { label: 'SPD', value: 14, color: SRC.spd },
  { label: 'MOLTEN', value: 20, color: SRC.molten },
];
const T3: SplitPart[] = [
  { label: 'DMG 44 ×2.0', value: 88, color: SRC.dmg },
  { label: 'FIRE', value: 24, color: SRC.fire },
  { label: 'SPD', value: 12, color: SRC.spd },
  { label: 'MOLTEN', value: 14, color: SRC.molten },
  { label: 'ECHO', value: 18, color: SRC.echo },
];
const TICKS: SplitPart[][] = [T1, T2, T3];
const TICK_TOTALS = TICKS.map((t) => t.reduce((s, p) => s + p.value, 0)); // 96 · 104 · 156
const TICK_DELTAS: (number | null)[] = TICK_TOTALS.map((t, i) => (i === 0 ? null : t - TICK_TOTALS[i - 1])); // — · +8 · +52
const CUM_DEALT = TICK_TOTALS.map((_, i) => TICK_TOTALS.slice(0, i + 1).reduce((a, b) => a + b, 0)); // 96 · 200 · 356

const Splits: React.FC<{ shown: number; notes?: (string | undefined)[] }> = ({ shown, notes }) => (
  <div>
    {TICKS.slice(0, shown).map((parts, i) => (
      <SplitRow
        key={i}
        tag={`T${i + 1}`}
        parts={parts}
        total={TICK_TOTALS[i]}
        delta={TICK_DELTAS[i]}
        note={notes?.[i]}
      />
    ))}
  </div>
);

/* ─── Roam ────────────────────────────────────────────────────── */

let roamSeq = 0;
const seedRoamEvent = (partial: Partial<TickEvent>) => {
  roamSeq += 1;
  const event = { id: `odo-beat-${roamSeq}`, at: Date.now(), detail: 'odometer-harness', ...partial } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

const ROAM_HP = [300, 204, 100, 0];

const RoamActivity: React.FC = () => {
  const [beat, setBeatState] = useState(0); // 0 rest · 1 tick1 · 2 tick2 · 3 kill
  const [shield, setShield] = useState(64);
  const [recharging, setRecharging] = useState(false);
  const [drop, setDrop] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 300, currentTargetHpMax: 300 });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    useLoadoutStore.getState().setSlot('vehicle', null);

    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const applyBeat = (n: number) => {
      setBeatState(n);
      useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: ROAM_HP[n], currentTargetHpMax: 300 });
      if (n === 0) {
        setShield(64); setRecharging(false); setDrop(false);
        useTickFeedStore.setState({ events: [] });
      } else if (n === 1) {
        setShield(64); setRecharging(false); setDrop(false);
        seedRoamEvent({ tone: 'loot', label: '-96', value: 96 });
      } else if (n === 2) {
        seedRoamEvent({ tone: 'loot', label: '-104', value: 104 });
        setShield(36); setRecharging(true); setDrop(false);
      } else if (n === 3) {
        seedRoamEvent({ tone: 'kill', label: '-156', value: 156 });
        setShield(52); setRecharging(false); setDrop(true);
      }
    };
    const run = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      applyBeat(0);
      at(1000, () => applyBeat(1));
      at(4000, () => applyBeat(2));
      at(5400, () => { setShield(52); setRecharging(false); });
      at(7000, () => applyBeat(3));
      at(8600, () => seedRoamEvent({ tone: 'material', label: '+1 TechFragments', value: 1 }));
      at(10600, () => {
        useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
        useTickFeedStore.setState({ events: [] });
      });
    };
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => {
      const map: Record<string, number> = { rest: 0, tick1: 1, surge: 2, kill: 3 };
      if (name in map) applyBeat(map[name]);
    };
    w.__startOdo = run;
    if (initialBeat && initialBeat in { rest: 1, tick1: 1, surge: 1, kill: 1 }) {
      const map: Record<string, number> = { rest: 0, tick1: 1, surge: 2, kill: 3 };
      applyBeat(map[initialBeat]);
    }
    if (params.get('auto') === '1') at(600, run);
    return () => timers.current.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cum = beat === 0 ? 0 : CUM_DEALT[beat - 1];
  return (
    <div>
      <LiveTurfDiorama
        area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
        weapon={WEAPON}
        playerLevel={5}
        equippedCount={4}
        activityKind="roaming_loot"
      />
      <div data-testid="odometer-panel" style={panelStyle}>
        <HeroCounter label="DAMAGE DEALT" text={pad(cum, 3)} hot={beat > 0} testId="odo-dealt" />
        <div style={{ marginTop: 8 }}>
          <HeroCounter label="WRAITH SCAVENGER · HP" text={pad(ROAM_HP[beat], 3)} color={SRC.enemy} size={19} testId="odo-hp" />
        </div>
        <div style={{ marginTop: 10 }}>
          {beat === 0 && (
            <div style={{ padding: '6px 0', borderTop: '1px solid #1A1E27', fontSize: 11, fontWeight: 800, color: SRC.dim, letterSpacing: '0.06em' }}>
              NO SPLITS YET · CRIT 25% · ×2.0
            </div>
          )}
          <Splits shown={beat} notes={[undefined, 'MOLTEN CORE', 'CRIT · MOLTEN CORE · ECHO CHAMBER']} />
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...headStyle, color: SRC.shld }}>SHLD</span>
          <Odometer text={pad(shield, 2)} size={17} color={SRC.shld} testId="odo-shld" />
          <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint, ...numStyle }}>/ 64</span>
          {recharging && (
            <span style={{ fontSize: 11, fontWeight: 800, color: SRC.shld, letterSpacing: '0.06em' }}>RECHARGE → 52</span>
          )}
          {drop && (
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 900, color: SRC.loot, letterSpacing: '0.04em' }}>
              DROP +1 TECHFRAGMENTS
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── Boss ────────────────────────────────────────────────────── */

const bossTimeline = (bossHp: number, phaseIndex: number, values: number[], finished = false): FightTimeline => ({
  outcome: FIXTURE_OUTCOME,
  startedAt: 0,
  finishedAt: finished ? performance.now() : null,
  currentPhaseIndex: phaseIndex,
  playerHp: 340,
  playerHpMax: 340,
  bossHp,
  bossHpMax: 800,
  damageLog: values.map((v, i) => ({ id: `odo-b-${i}`, target: 'boss' as const, value: v, phaseName: FIXTURE_PHASES[0].phaseName })),
});

interface BossBeat {
  tl: FightTimeline;
  hpText: number;
  splits: number;
  windup: string | null;
  late: boolean;
}
const BOSS_BEATS: Record<string, BossBeat> = {
  rest: { tl: bossTimeline(800, 0, []), hpText: 800, splits: 0, windup: null, late: false },
  telegraph: { tl: bossTimeline(704, 0, [96]), hpText: 704, splits: 1, windup: '2.6', late: false },
  kill: { tl: bossTimeline(0, FIXTURE_PHASES.length, [96, 156], true), hpText: 0, splits: 3, windup: null, late: true },
};

const BossActivity: React.FC = () => {
  const [beat, setBeat] = useState(initialBeat && initialBeat in BOSS_BEATS ? initialBeat : 'rest');
  const state = BOSS_BEATS[beat];
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => {
      if (name in BOSS_BEATS) setBeat(name);
    };
  }, []);
  const bossPct = (state.tl.bossHp / state.tl.bossHpMax) * 100;
  const playerPct = (state.tl.playerHp / state.tl.playerHpMax) * 100;
  return (
    <div>
      <div data-testid="odometer-boss-stage">
        <BossFightStage timeline={state.tl} phases={FIXTURE_PHASES} bossId="dune_tyrant" weapon={FIXTURE_WEAPON} />
        <div className="mt-2 space-y-1">
          <GhostHpBar pct={bossPct} color="#F87171" testId="odo-boss-bar" />
          <GhostHpBar pct={playerPct} color="#4ADE80" testId="odo-player-bar" />
        </div>
      </div>
      <div data-testid="odometer-panel" style={panelStyle}>
        <HeroCounter label="DUNE TYRANT · HP" text={pad(state.hpText, 3)} color={SRC.enemy} hot={beat !== 'rest'} testId="odo-boss-hp" />
        <div style={{ marginTop: 4, fontSize: 11, fontWeight: 800, color: SRC.faint, letterSpacing: '0.06em', ...numStyle }}>
          {state.late ? 'LATE · BOSS AT 156 / 800 BEFORE THE KILL TICK' : 'MAX 800 · SAND SLAM EVERY 18S · WINDUP 3S'}
        </div>
        <div style={{ marginTop: 8 }}>
          {state.splits === 0 && (
            <div style={{ padding: '6px 0', borderTop: '1px solid #1A1E27', fontSize: 11, fontWeight: 800, color: SRC.dim, letterSpacing: '0.06em' }}>
              NO SPLITS YET
            </div>
          )}
          {/* Boss splits: T1 + T2 staged in the attempt's shape; the
              kill split is fixture tick 3 verbatim (see README for the
              seeded-late framing). Slice keeps tick order T1·T2·TK. */}
          {state.splits >= 1 && <Splits shown={state.splits === 1 ? 1 : 3} notes={[undefined, 'MOLTEN CORE', 'CRIT · MOLTEN CORE · ECHO CHAMBER']} />}
        </div>
        {state.windup && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: SRC.pace, letterSpacing: '0.06em' }}>SAND SLAM · WINDUP</span>
            <Odometer text={state.windup} size={17} color={SRC.pace} testId="odo-windup" />
            <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint, ...numStyle }}>/ 3.0 S</span>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Craft ───────────────────────────────────────────────────── */

const craftSeatJob = (): WorkshopJobView =>
  ({
    id: 'odo-craft-job',
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

interface CraftBeat {
  progress: number;
  pace: number;
  angle: number;
  phases: number;
  working: boolean;
  result: 'success' | null;
}
const CRAFT_BEATS: Record<string, CraftBeat> = {
  slow: { progress: 0.3, pace: 2, angle: 24, phases: 1, working: false, result: null },
  ramped: { progress: 0.55, pace: 5, angle: 132, phases: 2, working: true, result: null },
  complete: { progress: 1, pace: 9, angle: 288, phases: 3, working: false, result: 'success' },
};
const CRAFT_PACES = [2, 5, 9];

const CraftActivity: React.FC = () => {
  const [beat, setBeat] = useState(initialBeat && initialBeat in CRAFT_BEATS ? initialBeat : 'slow');
  const [spinning, setSpinning] = useState(false);
  const [riseKey, setRiseKey] = useState(0);
  const timers = useRef<number[]>([]);
  const state = CRAFT_BEATS[beat];

  useEffect(() => {
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const jump = (name: string) => {
      if (name in CRAFT_BEATS) {
        setBeat(name);
        setSpinning(false);
        if (name === 'complete') setRiseKey((k) => k + 1);
      }
    };
    const run = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setBeat('slow');
      setSpinning(true);
      at(4600, () => setBeat('ramped'));
      at(7900, () => setBeat('complete'));
      at(8000, () => setSpinning(false));
    };
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = jump;
    w.__startOdo = run;
    if (params.get('auto') === '1') at(600, run);
    return () => timers.current.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <CraftingBenchScene
          progress={state.progress}
          causeLabel="Tempering · Patch Kit"
          buysLabel="→ Patch Kit ×1"
          working={state.working}
          result={state.result}
          seatJob={craftSeatJob()}
        />
        {riseKey > 0 && state.result === 'success' && (
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
      <div data-testid="odometer-panel" style={panelStyle}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <RateWheel pace={state.pace} spin={spinning} angle={state.angle} />
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={headStyle}>PACE</span>
              <Odometer text={String(state.pace)} size={30} color={SRC.pace} testId="odo-pace" />
              <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint }}>/ MIN</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
              <span style={headStyle}>JOB · PATCH KIT</span>
              <Odometer text={pad(Math.round(state.progress * 100), 3)} size={17} testId="odo-job" />
              <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint }}>%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
              <span style={headStyle}>PATCH KITS</span>
              <Odometer text={String(state.result === 'success' ? 1 : 0)} size={17} color={SRC.loot} testId="odo-units" />
            </div>
          </div>
        </div>
        <div style={{ marginTop: 6 }}>
          {CRAFT_PACES.slice(0, state.phases).map((p, i) => (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '5px 0', borderTop: '1px solid #1A1E27' }}
            >
              <span style={{ ...headStyle, width: 22, color: SRC.dim }}>{`P${i + 1}`}</span>
              <span style={{ fontSize: 11, fontWeight: 900, color: SRC.pace }}>PACE {p} / MIN</span>
              <span style={{ marginLeft: 'auto' }}>
                {i === 0 ? (
                  <span style={{ fontSize: 11, fontWeight: 800, color: SRC.dim, letterSpacing: '0.06em' }}>BASE</span>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 900, color: SRC.loot, ...numStyle }}>
                    Δ +{p - CRAFT_PACES[i - 1]}
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
        {state.result === 'success' && (
          <div style={{ marginTop: 8, fontSize: 11, fontWeight: 900, color: SRC.loot, letterSpacing: '0.04em' }}>
            YIELD +1 PATCH KIT
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Gather / extraction ─────────────────────────────────────── */

/** One decided Surface pass at Dustwaste Frontier (content/
 *  extraction.ts: 10-min pass, 192 draws/hr = 32 draws). The find
 *  pool is the area's shipped pool — Scrap + BallisticParts at
 *  materialBias (roamingAreas.ts) with Siltglass substituting at the
 *  shipped signature chance in its home area: this decided pass
 *  lands 16 Scrap / 11 Ballistic Parts / 5 Siltglass (5/32 ≈ the
 *  signature rate). Counts on screen are computed from this array,
 *  so the material odometers can never disagree with the draw
 *  odometer. (Same decided pass as iter-05, for cross-iteration
 *  comparability.) */
const FIND_IDS = { S: 'Scrap', B: 'BallisticParts', G: 'Siltglass' } as const;
const FINDS: (keyof typeof FIND_IDS)[] = [
  'S', 'B', 'S', 'S', 'B', 'G', 'S', 'B',
  'S', 'B', 'S', 'S', 'G', 'B', 'S', 'B',
  'S', 'S', 'B', 'G', 'S', 'B', 'S', 'S',
  'B', 'G', 'S', 'B', 'S', 'S', 'B', 'G',
];
const DRAWS_PER_PASS = Math.round((EXTRACTION_LEVER_DEFAULTS.extractFindsPerHour * EXTRACTION_PASS_MS) / 3_600_000); // 32
const PASS_SECONDS = EXTRACTION_PASS_MS / 1000; // 600

const GATHER_BEATS: Record<string, { filled: number; progress: number; working: boolean; result: 'success' | null }> = {
  start: { filled: 0, progress: 0.02, working: true, result: null },
  flow: { filled: 14, progress: 0.44, working: true, result: null },
  yield: { filled: 32, progress: 1, working: false, result: 'success' },
};

const GatherActivity: React.FC = () => {
  const [beat, setBeat] = useState(initialBeat && initialBeat in GATHER_BEATS ? initialBeat : 'start');
  const state = GATHER_BEATS[beat];
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => {
      if (name in GATHER_BEATS) setBeat(name);
    };
  }, []);
  const landed = FINDS.slice(0, state.filled);
  const counts = (['S', 'B', 'G'] as const).map((k) => ({
    k,
    id: FIND_IDS[k],
    n: landed.filter((f) => f === k).length,
  }));
  const elapsed = Math.round(state.progress * PASS_SECONDS); // 0 · 264 · 600
  return (
    <div>
      <ExtractionScene
        progress={state.progress}
        causeLabel="Sifting · Surface"
        buysLabel="Pass · 10 Min"
        working={state.working}
        result={state.result}
      />
      <div data-testid="odometer-panel" style={panelStyle}>
        <HeroCounter label="DRAWS · SURFACE PASS" text={pad(state.filled, 2)} hot={state.filled > 0} testId="odo-draws" />
        <div style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint, letterSpacing: '0.06em', ...numStyle }}>
            DUSTWASTE FRONTIER · {EXTRACTION_LEVER_DEFAULTS.extractFindsPerHour} DRAWS/H · {DRAWS_PER_PASS} / PASS
          </span>
          <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint }}>/ {DRAWS_PER_PASS}</span>
        </div>
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={headStyle}>PASS CLOCK</span>
          <Odometer text={clock(elapsed)} size={19} testId="odo-clock" />
          <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint, ...numStyle }}>/ {clock(PASS_SECONDS)}</span>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {counts.map((c) => (
            <div key={c.k} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ ...headStyle, width: 118, color: getMaterialVisual(c.id).color }}>
                {getMaterialVisual(c.id).label.toUpperCase()}
              </span>
              <Odometer text={pad(c.n, 2)} size={16} color={getMaterialVisual(c.id).color} />
            </div>
          ))}
        </div>
        {state.result === 'success' && (
          <div style={{ marginTop: 10, fontSize: 11, fontWeight: 900, color: SRC.loot, letterSpacing: '0.04em', ...numStyle }}>
            PASS SETTLED · +{EXTRACTION_MASTERY_XP_PER_PASS} MASTERY · GATHERING/EXTRACTION
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── Research ────────────────────────────────────────────────── */

const RESEARCH_BEATS: Record<string, { hours: number }> = {
  start: { hours: 0 },
  flow: { hours: 3 },
  done: { hours: 6 },
};

const ResearchActivity: React.FC = () => {
  const [beat, setBeat] = useState(initialBeat && initialBeat in RESEARCH_BEATS ? initialBeat : 'start');
  const state = RESEARCH_BEATS[beat];
  const course = researchCourse('shop_fundamentals');
  const faculty = researchFaculty('fabrication');
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => {
      if (name in RESEARCH_BEATS) setBeat(name);
    };
  }, []);
  if (!course || !faculty) return null;
  const xpAccrued = state.hours * RESEARCH_MASTERY_XP_PER_HOUR; // 0 · 30 · 60
  const done = state.hours >= course.durationHours;
  return (
    <div>
      <Module
        testId="odometer-research"
        header={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lamp color={faculty.color} lit />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: '#E8E4D8' }}>
              RESEARCH · {faculty.name.toUpperCase()}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: SRC.faint }}>
              T1 · {faculty.home.toUpperCase()}
            </span>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Readout label="Course" value={course.name} />
          <Readout label="Fee" value={`${course.costCredits.toLocaleString()} CR`} />
          <Readout label="Duration" value={`${course.durationHours} H`} />
        </div>
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...headStyle, width: 118 }}>ELAPSED</span>
            <Odometer text={state.hours.toFixed(1)} size={19} testId="odo-elapsed" />
            <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint }}>H</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...headStyle, width: 118 }}>REMAINING</span>
            <Odometer text={(course.durationHours - state.hours).toFixed(1)} size={19} color={SRC.spd} testId="odo-remain" />
            <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint }}>H</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ ...headStyle, width: 118 }}>MASTERY XP · AT COMPLETION</span>
            <Odometer text={pad(xpAccrued, 2)} size={19} color={SRC.pace} testId="odo-xp" />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          {Array.from({ length: state.hours }, (_, i) => (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '5px 0', borderTop: '1px solid #1A1E27' }}
            >
              <span style={{ ...headStyle, width: 22, color: SRC.dim }}>{`H${i + 1}`}</span>
              <span style={{ fontSize: 11, fontWeight: 900, color: SRC.pace, ...numStyle }}>
                MASTERY XP +{RESEARCH_MASTERY_XP_PER_HOUR}
              </span>
              <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
                {i === 0 ? (
                  <span style={{ fontSize: 11, fontWeight: 800, color: SRC.dim, letterSpacing: '0.06em' }}>BASE</span>
                ) : (
                  <span style={{ fontSize: 12, fontWeight: 900, color: SRC.loot, ...numStyle }}>
                    Δ +{RESEARCH_MASTERY_XP_PER_HOUR}
                  </span>
                )}
                <Odometer text={String((i + 1) * RESEARCH_MASTERY_XP_PER_HOUR)} size={15} />
              </span>
            </div>
          ))}
          {state.hours === 0 && (
            <div style={{ padding: '6px 0', borderTop: '1px solid #1A1E27', fontSize: 11, fontWeight: 800, color: SRC.dim, letterSpacing: '0.06em' }}>
              ENROLLED · FEE PAID · NO HOUR SPLITS YET
            </div>
          )}
        </div>
        {done && (
          <div style={{ marginTop: 10, fontSize: 11, fontWeight: 900, color: SRC.loot, letterSpacing: '0.04em' }}>
            COMPLETE · UNLOCK · CRAFT QUALITY SHIFT +2
          </div>
        )}
      </Module>
    </div>
  );
};

/* ─── Page switch ─────────────────────────────────────────────── */

export const OdometerHarnessPage: React.FC = () => (
  <div
    style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box', minHeight: '100vh' }}
    data-testid="odometer-root"
  >
    {activity === 'boss' && <BossActivity />}
    {activity === 'craft' && <CraftActivity />}
    {activity === 'gather' && <GatherActivity />}
    {activity === 'research' && <ResearchActivity />}
    {(activity === 'roam' || !['boss', 'craft', 'gather', 'research'].includes(activity)) && <RoamActivity />}
  </div>
);
