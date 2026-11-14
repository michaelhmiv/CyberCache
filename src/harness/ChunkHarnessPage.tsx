import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { LiveTurfDiorama, DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { CraftingBenchScene, ExtractionScene } from '@/components/pixelArt/ActionScenes';
import { DispatchPanel } from '@/components/dispatch/DispatchPanel';
import { Lamp, Module, Readout } from '@/components/profile/ResearchConsoleKit';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { getMaterialVisual } from '@/constants/visualAssets';
import { DISPATCH_LEVER_DEFAULTS, footPayoutLines } from '@/content/dispatch';
import { researchCourse, researchFaculty } from '@/content/research';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_OUTCOME, FIXTURE_PHASES, FIXTURE_WEAPON } from './fightFixture';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import {
  BlockFill,
  ChunkChip,
  SegCells,
  SRC,
  TICKS,
  headStyle,
  numStyle,
  panelStyle,
  TrayRow,
} from './ChunkPanel';

/**
 * CHUNK & SEGMENT harness (iter-05, THROWAWAY rendering prototype —
 * dev only, served at /chunk-harness.html). One page, five
 * activities via ?activity=roam|boss|craft|gather|research|dispatch.
 * Beats are frame-stepped by the capture rig through
 * window.__setBeat(name); the roam page also runs the fixture's
 * timed timeline via window.__startChunk() (?auto=1) for the clip.
 *
 * Every surface is the real shipped component (LiveTurfDiorama,
 * BossFightStageDom, CraftingBenchScene, ExtractionScene,
 * ResearchConsoleKit, DispatchPanel); the ChunkPanel primitives
 * seated under each stage are the concept's display language.
 * Presentation only — no combat math is run; the decided fixture
 * (INDEX) is staged through the same stores the shipped harnesses
 * use.
 */

const params = new URLSearchParams(window.location.search);
const activity = params.get('activity') ?? 'roam';

/* ─── Dispatch Chef stub ────────────────────────────────────────
 * DispatchPanel renders only the Chef's state view. For this
 * throwaway harness the fetch for /dispatch/* is answered with a
 * state whose payout lines come from the SHIPPED formula
 * (footPayoutLines over the real Dustwaste Frontier def at
 * strength 1.0 — the formula's own reference strength), so every
 * number on screen is the game's arithmetic, not a guess. If the
 * panel declines to mount on the stub, the chunk panel below it
 * still carries the cell (logged in the iteration log). */
const DISPATCH_SEED = 'i05-foot-1';
const dispatchArea = getRoamingArea(DEFAULT_ROAMING_AREA_ID);
const dispatchLines = footPayoutLines(dispatchArea, 8, 1.0, DISPATCH_LEVER_DEFAULTS, DISPATCH_SEED);

if (activity === 'dispatch' && typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  if (!w.__chunkDispatchStub) {
    w.__chunkDispatchStub = true;
    const now = Date.now();
    const state = {
      verified: true,
      dispatch: {
        slots: DISPATCH_LEVER_DEFAULTS.dispatchQueueSlots,
        slotsUsed: 1,
        playerLevel: 5,
        vehicleFuel: 0,
        credits: 50000,
        boardIndex: 0,
        boardDay: new Date(now).toISOString().slice(0, 10),
        rerollsUsed: 0,
        rerollsRemaining: DISPATCH_LEVER_DEFAULTS.dispatchRerollDailyCap,
        rerollPrice: DISPATCH_LEVER_DEFAULTS.dispatchRerollBaseCredits,
        departedOfferIds: ['d0-r0-0'],
        offers: [],
        missions: [
          {
            id: 'm-i05-1',
            contract_family: 'foot',
            offer_id: 'd0-r0-0',
            destination_area_id: dispatchArea.id,
            duration_hours: 8,
            status: 'active',
            loadout_item_ids: [],
            payout_credits: dispatchLines.credits,
            payout_scrap: dispatchLines.scrap,
            payout_material_id: dispatchLines.materialId,
            payout_material_units: dispatchLines.materialUnits,
            vehicle_item_id: null,
            vehicle_class_id: null,
            fuel_charged_units: 0,
            fuel_refunded_units: 0,
            wear_projected: null,
            wear_applied: null,
            breakdown_fraction: null,
            payout_fraction: null,
            departed_at: new Date(now - 3 * 3600_000).toISOString(),
            ends_at: new Date(now + 5 * 3600_000).toISOString(),
            settled_at: null,
          },
        ],
        candidates: [],
      },
    };
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/dispatch/')) {
        return Promise.resolve(
          new Response(JSON.stringify(state), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        );
      }
      return orig(input, init);
    };
  }
}

/* ─── Shared combat panel ─────────────────────────────────────── */

const CombatChunks: React.FC<{
  name: string;
  hp: number;
  maxHp: number;
  unit: number;
  ticksShown: number;
  shieldValue: number;
  shieldGhostTo?: number;
  telegraph?: boolean;
  drop?: boolean;
}> = ({ name, hp, maxHp, unit, ticksShown, shieldValue, shieldGhostTo, telegraph, drop }) => (
  <div data-testid="chunk-panel" style={panelStyle}>
    <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
      <span style={{ ...headStyle, color: '#E8EAF0', fontSize: 12 }}>{name}</span>
      <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 900, color: '#E8EAF0', ...numStyle }}>
        {hp} / {maxHp}
      </span>
    </div>
    <SegCells total={maxHp} unit={unit} remaining={hp} color={SRC.enemy} />
    {ticksShown > 0 && (
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {TICKS.slice(0, ticksShown).map((chunks, i) => (
          <TrayRow key={i} tag={`T${i + 1}`} chunks={chunks} maxHp={maxHp} trackW={364} />
        ))}
      </div>
    )}
    <div
      style={{
        marginTop: 12,
        ...(telegraph
          ? { border: `2px dashed ${SRC.enemy}`, padding: '6px 8px' }
          : { border: '2px solid transparent', padding: '6px 8px' }),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...headStyle, color: SRC.shld, width: 34 }}>SHLD</span>
        <SegCells total={64} unit={4} remaining={shieldValue} color={SRC.shld} height={12} ghostTo={shieldGhostTo} />
        <span style={{ fontSize: 11, fontWeight: 900, color: SRC.shld, ...numStyle }}>{shieldValue} / 64</span>
      </div>
      {shieldGhostTo !== undefined && (
        <div style={{ marginTop: 4, fontSize: 11, fontWeight: 800, color: SRC.shld, letterSpacing: '0.06em' }}>
          RECHARGE → {shieldGhostTo}
        </div>
      )}
      {telegraph && (
        <div style={{ marginTop: 4, display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 11, fontWeight: 900, color: SRC.enemy, letterSpacing: '0.06em' }}>SAND SLAM</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: SRC.faint, letterSpacing: '0.06em' }}>
            WINDUP 3S · EVERY 18S
          </span>
        </div>
      )}
    </div>
    {drop && (
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={headStyle}>DROP</span>
        <ChunkChip label="+1 TECHFRAGMENTS" color={SRC.loot} solid />
      </div>
    )}
  </div>
);

/* ─── Roam ────────────────────────────────────────────────────── */

const ROAM_WEAPON: Weapon = {
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

let roamBeatSeq = 0;
const seedRoamEvent = (partial: Partial<TickEvent>) => {
  roamBeatSeq += 1;
  const event = { id: `chunk-beat-${roamBeatSeq}`, at: Date.now(), detail: 'chunk-harness', ...partial } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

const ROAM_HP = [300, 204, 100, 0];

const RoamActivity: React.FC = () => {
  const [beat, setBeat] = useState(0);
  const [shield, setShield] = useState(64);
  const [ghost, setGhost] = useState(false);
  const [drop, setDrop] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 300, currentTargetHpMax: 300 });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    useLoadoutStore.getState().setSlot('vehicle', null);

    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const applyBeat = (n: number) => {
      setBeat(n);
      useKillCycleStore.setState({ currentTargetHp: ROAM_HP[n] });
      if (n === 0) {
        setShield(64); setGhost(false); setDrop(false);
        useTickFeedStore.setState({ events: [] });
      } else if (n === 1) {
        seedRoamEvent({ tone: 'loot', label: '-96', value: 96 });
      } else if (n === 2) {
        seedRoamEvent({ tone: 'loot', label: '-104', value: 104 });
        setShield(36); setGhost(true);
      } else if (n === 3) {
        seedRoamEvent({ tone: 'kill', label: '-156', value: 156 });
        setShield(52); setGhost(false); setDrop(true);
      }
    };
    const run = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      applyBeat(0);
      at(1000, () => applyBeat(1));
      at(4000, () => { applyBeat(2); setShield(64); setGhost(false); });
      at(4700, () => { setShield(36); setGhost(true); seedRoamEvent({ tone: 'damage', label: '-28', value: 28 }); });
      at(5400, () => { setShield(52); setGhost(false); });
      at(7000, () => { applyBeat(3); setDrop(false); });
      at(8600, () => { setDrop(true); seedRoamEvent({ tone: 'material', label: '+1 TechFragments', value: 1 }); });
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
    w.__startChunk = run;
    if (params.get('auto') === '1') at(600, run);
    return () => timers.current.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <LiveTurfDiorama
        area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
        weapon={ROAM_WEAPON}
        playerLevel={5}
        equippedCount={4}
        activityKind="roaming_loot"
      />
      <CombatChunks
        name="WRAITH SCAVENGER"
        hp={ROAM_HP[beat]}
        maxHp={300}
        unit={20}
        ticksShown={beat}
        shieldValue={shield}
        shieldGhostTo={ghost ? 52 : undefined}
        drop={drop}
      />
    </div>
  );
};

/* ─── Boss ────────────────────────────────────────────────────── */

const bossSnap = (hp: number, phaseIdx: number, values: number[]): FightTimeline => ({
  outcome: FIXTURE_OUTCOME,
  startedAt: 0,
  finishedAt: null,
  currentPhaseIndex: phaseIdx,
  playerHp: 340,
  playerHpMax: 340,
  bossHp: hp,
  bossHpMax: 800,
  damageLog: values.map((v, i) => ({ id: `cb-${i}`, target: 'boss' as const, value: v, phaseName: FIXTURE_PHASES[i].phaseName })),
});

const BOSS_BEATS: Record<string, { snap: FightTimeline; ticks: number; telegraph: boolean }> = {
  rest: { snap: bossSnap(800, 0, []), ticks: 0, telegraph: false },
  tick1: { snap: bossSnap(704, 0, [96]), ticks: 1, telegraph: false },
  telegraph: { snap: bossSnap(704, 1, [96]), ticks: 1, telegraph: true },
  break: { snap: bossSnap(444, 2, [96, 104, 156]), ticks: 3, telegraph: false },
};

const BossActivity: React.FC = () => {
  const [beat, setBeat] = useState('rest');
  const state = BOSS_BEATS[beat];
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => { if (name in BOSS_BEATS) setBeat(name); };
  }, []);
  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div data-testid="chunk-boss-stage">
        <BossFightStageDom timeline={state.snap} phases={FIXTURE_PHASES} bossId="dune_tyrant" weapon={FIXTURE_WEAPON} />
      </div>
      <CombatChunks
        name="DUNE TYRANT"
        hp={state.snap.bossHp}
        maxHp={800}
        unit={40}
        ticksShown={state.ticks}
        shieldValue={64}
        telegraph={state.telegraph}
      />
    </div>
  );
};

/* ─── Craft ───────────────────────────────────────────────────── */

const craftSeatJob = (): WorkshopJobView =>
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

const CRAFT_BEATS: Record<string, { progress: number; pace: number; working: boolean; result: 'success' | null }> = {
  slow: { progress: 0.3, pace: 2, working: false, result: null },
  ramped: { progress: 0.8, pace: 9, working: true, result: null },
  complete: { progress: 1, pace: 9, working: false, result: 'success' },
};

const CraftActivity: React.FC = () => {
  const [beat, setBeat] = useState('slow');
  const [riseKey, setRiseKey] = useState(0);
  const state = CRAFT_BEATS[beat];
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => {
      if (name in CRAFT_BEATS) {
        setBeat(name);
        if (name === 'complete') setRiseKey((k) => k + 1);
      }
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
          seatJob={craftSeatJob()}
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
      <div data-testid="chunk-panel" style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={headStyle}>JOB · PATCH KIT</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 900, color: '#E8EAF0', ...numStyle }}>
            {Math.round(state.progress * 100)}%
          </span>
        </div>
        <BlockFill blocks={10} frac={state.progress} color="#F5B83D" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <span style={{ ...headStyle, width: 34 }}>PACE</span>
          <BlockFill blocks={9} frac={state.pace / 9} color="#F5B83D" height={10} />
          <span style={{ fontSize: 11, fontWeight: 900, color: '#F5B83D', ...numStyle }}>{state.pace} / MIN</span>
        </div>
        {state.result === 'success' && (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={headStyle}>YIELD</span>
            <ChunkChip label="+1 PATCH KIT" color={SRC.loot} solid />
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
 *  weight 2 each (roamingAreas.ts), with Siltglass substituting at
 *  the shipped 15% signature chance in its home area: this decided
 *  pass lands 16 Scrap / 11 Ballistic Parts / 5 Siltglass
 *  (5/32 ≈ 15%). Counts on screen are computed from this array, so
 *  the summary can never disagree with the container. */
const FIND_IDS = { S: 'Scrap', B: 'BallisticParts', G: 'Siltglass' } as const;
const FINDS: (keyof typeof FIND_IDS)[] = [
  'S', 'B', 'S', 'S', 'B', 'G', 'S', 'B',
  'S', 'B', 'S', 'S', 'G', 'B', 'S', 'B',
  'S', 'S', 'B', 'G', 'S', 'B', 'S', 'S',
  'B', 'G', 'S', 'B', 'S', 'S', 'B', 'G',
];

const GATHER_BEATS: Record<string, { filled: number; progress: number; working: boolean; result: 'success' | null }> = {
  start: { filled: 0, progress: 0.02, working: true, result: null },
  flow: { filled: 14, progress: 0.44, working: true, result: null },
  yield: { filled: 32, progress: 1, working: false, result: 'success' },
};

const GatherActivity: React.FC = () => {
  const [beat, setBeat] = useState('start');
  const state = GATHER_BEATS[beat];
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => { if (name in GATHER_BEATS) setBeat(name); };
  }, []);
  const landed = FINDS.slice(0, state.filled);
  const counts = (['S', 'B', 'G'] as const)
    .map((k) => ({ k, n: landed.filter((f) => f === k).length }))
    .filter((c) => c.n > 0);
  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <ExtractionScene
        progress={state.progress}
        causeLabel="Sifting · Surface"
        buysLabel="Pass · 10 Min"
        working={state.working}
        result={state.result}
      />
      <div data-testid="chunk-panel" style={panelStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={headStyle}>PASS · DUSTWASTE FRONTIER · SURFACE</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 900, color: '#E8EAF0', ...numStyle }}>
            {state.filled} / {FINDS.length}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 2 }}>
          {FINDS.map((f, i) => (
            <div
              key={i}
              style={{
                height: 18,
                background: i < state.filled ? getMaterialVisual(FIND_IDS[f]).color : SRC.empty,
                transition: 'background 300ms ease',
              }}
            />
          ))}
        </div>
        <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={headStyle}>CRATE</span>
          {counts.length === 0 && <span style={{ fontSize: 11, fontWeight: 800, color: SRC.dim }}>EMPTY</span>}
          {counts.map((c) => (
            <span key={c.k} style={{ fontSize: 11, fontWeight: 900, color: getMaterialVisual(FIND_IDS[c.k]).color, ...numStyle }}>
              {getMaterialVisual(FIND_IDS[c.k]).label.toUpperCase()} ×{c.n}
            </span>
          ))}
          {state.result === 'success' && (
            <ChunkChip label="+20 MASTERY · GATHERING/EXTRACTION" color={SRC.molten} solid />
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── Research ────────────────────────────────────────────────── */

const RESEARCH_BEATS: Record<string, { filled: number; state: string }> = {
  start: { filled: 0, state: 'ENROLLED · FEE PAID' },
  flow: { filled: 4, state: 'IN SESSION' },
  done: { filled: 6, state: 'COMPLETE' },
};

const ResearchActivity: React.FC = () => {
  const [beat, setBeat] = useState('start');
  const state = RESEARCH_BEATS[beat];
  const course = researchCourse('shop_fundamentals');
  const faculty = researchFaculty('fabrication');
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => { if (name in RESEARCH_BEATS) setBeat(name); };
  }, []);
  if (!course || !faculty) return null;
  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <Module
        testId="chunk-research"
        header={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lamp color={faculty.color} lit />
            <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', color: '#E8E4D8' }}>
              RESEARCH · {faculty.name.toUpperCase()}
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, color: SRC.dim }}>T1 · {faculty.home.toUpperCase()}</span>
          </div>
        }
      >
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Readout label="Course" value={course.name} />
          <Readout label="Fee" value={`${course.costCredits.toLocaleString()} CR`} />
          <Readout label="Elapsed" value={`${state.filled}H / ${course.durationHours}H`} />
        </div>
        <div style={{ marginTop: 12 }}>
          <BlockFill
            blocks={course.durationHours}
            frac={state.filled / course.durationHours}
            color={faculty.color}
            height={18}
            blockLabels={Array.from({ length: course.durationHours }, (_, i) => `${i + 1}H`)}
          />
        </div>
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={headStyle}>{state.state}</span>
          {beat === 'done' && <ChunkChip label="UNLOCK · CRAFT QUALITY SHIFT +2" color={faculty.color} solid />}
        </div>
      </Module>
    </div>
  );
};

/* ─── Dispatch ────────────────────────────────────────────────── */

const DISPATCH_BEATS: Record<string, { filled: number }> = {
  start: { filled: 0 },
  flow: { filled: 3 },
  done: { filled: 8 },
};

const DispatchActivity: React.FC = () => {
  const [beat, setBeat] = useState('start');
  const state = DISPATCH_BEATS[beat];
  const done = beat === 'done';
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => { if (name in DISPATCH_BEATS) setBeat(name); };
  }, []);
  const matLabel = dispatchLines.materialId ? getMaterialVisual(dispatchLines.materialId).label : null;
  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <DispatchPanel />
      <div data-testid="chunk-panel" style={{ ...panelStyle, borderTop: '2px solid #232833', marginTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 6 }}>
          <span style={headStyle}>FOOT CONTRACT · DUSTWASTE FRONTIER</span>
          <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 900, color: '#E8EAF0', ...numStyle }}>
            {state.filled} / 8H
          </span>
        </div>
        <BlockFill
          blocks={8}
          frac={state.filled / 8}
          color={SRC.spd}
          height={18}
          blockLabels={['1H', '2H', '3H', '4H', '5H', '6H', '7H', '8H']}
        />
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={headStyle}>{done ? 'SETTLED IN FULL' : 'PAYOUT · AT SETTLEMENT'}</span>
          <ChunkChip label={`${dispatchLines.credits.toLocaleString()} CR`} color={SRC.loot} solid={done} />
          <ChunkChip label={`${dispatchLines.scrap} SCRAP`} color={SRC.faint} solid={done} />
          {matLabel && (
            <ChunkChip label={`${matLabel.toUpperCase()} ×${dispatchLines.materialUnits}`} color={SRC.molten} solid={done} />
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── Page switch ─────────────────────────────────────────────── */

export const ChunkHarnessPage: React.FC = () => {
  switch (activity) {
    case 'boss':
      return <BossActivity />;
    case 'craft':
      return <CraftActivity />;
    case 'gather':
      return <GatherActivity />;
    case 'research':
      return <ResearchActivity />;
    case 'dispatch':
      return <DispatchActivity />;
    default:
      return <RoamActivity />;
  }
};
