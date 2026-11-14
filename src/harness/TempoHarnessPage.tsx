import React, { useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama, DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { CraftingBenchScene, ExtractionScene } from '@/components/pixelArt/ActionScenes';
import { BossFightStageDom } from '@/components/pixelArt/BossFightStage';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useSurvivalStore, useTickFeedStore } from '@/store';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import { FIXTURE_PHASES, FIXTURE_WEAPON, FIXTURE_OUTCOME } from './fightFixture';
import { motion } from 'framer-motion';

/**
 * TEMPO PULSE — dashboard iteration 10 (throwaway harness only).
 *
 * Every real event emits a ring from its true point of action. Ring
 * radius encodes the event's value on ONE stated scale:
 *   RADIUS_PX = 26 + VALUE x 0.72   (damage / find values)
 * The pulse RATE is the event rate: in craft the pulses literally
 * quicken 2 -> 5 -> 9 per minute across the ramp (clip runs at a
 * labeled x60 time compression, ratios exact). A crit fires a DOUBLE
 * pulse — two rings, one event, labeled as the crit marker. A boss
 * telegraph is the one inbound pulse: a dashed ring converging on
 * the boss during Sand Slam's real 3 s windup.
 *
 * Data is the INDEX fixture verbatim + real defs (README cites):
 *   roam ticks 96 (58+22+16) / 104 (52+18+14+20) / crit 156
 *   (44x2.0=88 +24+12+14+18); enemy 300 -> 204 -> 100 -> 0.
 *   Boss Dune Tyrant 800 HP (bosses.ts): staged segment opens at
 *   356 so the same ticks close it: 356 -> 260 -> 156 -> 0.
 *
 * Drive: ?activity=roam|boss|craft|gather|research ?beat=<name>
 *        window.__setBeat(name) switches beats live (capture rig).
 *        ?auto=1 (craft) plays the pace ramp for the clip.
 */

const R = (v: number) => Math.round(26 + v * 0.72);

const ENEMY = { x: 0.72, y: 0.52 };
const HUNTER = { x: 0.27, y: 0.6 };
const BENCH = { x: 0.58, y: 0.62 };
const RIG = { x: 0.58, y: 0.58 };
const DESK = { x: 0.5, y: 0.46 };
const BOSSP = { x: 0.68, y: 0.5 };

const COL = {
  tick: '#E8EAF0', crit: '#FFD23D', molten: '#FF4D2E', echo: '#B78CFF',
  shield: '#4ADE80', pace: '#F5B83D', find: '#3EC6B8', sig: '#5EA8FF',
  tele: '#FF3B5C', done: '#4ADE80', study: '#5EA8FF',
};

type Ring = { at: { x: number; y: number }; r: number; color: string; w?: number; dashed?: boolean; opacity?: number; label?: string };
type PulseRow = { label: string; value: string; ring: string; color: string };

const Rings: React.FC<{ rings: Ring[] }> = ({ rings }) => (
  <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 30 }} data-testid="tempo-rings">
    {rings.map((g, i) => (
      <React.Fragment key={i}>
        <div style={{
          position: 'absolute', left: `${g.at.x * 100}%`, top: `${g.at.y * 100}%`,
          width: g.r * 2, height: g.r * 2, transform: 'translate(-50%, -50%)',
          borderRadius: '50%', boxSizing: 'border-box',
          border: `${g.w ?? 3}px ${g.dashed ? 'dashed' : 'solid'} ${g.color}`,
          opacity: g.opacity ?? 0.95,
        }} />
        <div style={{
          position: 'absolute', left: `${g.at.x * 100}%`, top: `${g.at.y * 100}%`,
          width: 9, height: 9, transform: 'translate(-50%, -50%) rotate(45deg)', background: g.color,
        }} />
        {g.label ? (
          <div style={{
            position: 'absolute', left: `${g.at.x * 100}%`, top: `${g.at.y * 100}%`,
            transform: `translate(-50%, calc(-50% - ${g.r + 14}px))`,
            fontSize: 13, fontWeight: 900, color: g.color, textShadow: '0 2px 0 #000',
            whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          }}>{g.label}</div>
        ) : null}
      </React.Fragment>
    ))}
  </div>
);

const Panel: React.FC<{ title: string; right: string; rows: PulseRow[]; foot: string }> = ({ title, right, rows, foot }) => (
  <div style={{ background: '#07080B', border: '2px solid #232833', borderTop: 'none', padding: '10px 12px 12px', boxSizing: 'border-box' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.07em', color: '#E8EAF0' }}>{title}</span>
      <span style={{ fontSize: 12, fontWeight: 900, color: '#F5B83D', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{right}</span>
    </div>
    {rows.length === 0 ? (
      <div style={{ fontSize: 12, fontWeight: 800, color: '#5B6370' }}>NO PULSE — NO EVENT</div>
    ) : rows.map((r, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12, fontWeight: 800 }}>
        <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
        <span style={{ color: '#C7CDD8', flex: 1 }}>{r.label}</span>
        <span style={{ color: '#F5F7FA', fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
        <span style={{ color: '#8A93A3', fontVariantNumeric: 'tabular-nums', minWidth: 86, textAlign: 'right' }}>{r.ring}</span>
      </div>
    ))}
    <div style={{ marginTop: 8, paddingTop: 7, borderTop: '1px solid #232833', fontSize: 11, fontWeight: 700, color: '#8A93A3', letterSpacing: '0.03em' }}>{foot}</div>
  </div>
);

const HARNESS_WEAPON: Weapon = {
  id: 'roam-harness-weapon', name: 'Harness Carbine', weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood, rarity: Rarity.Epic, element: Element.Fire, level: 5,
  baseStats: { baseDamage: 50, critChance: 12, fireRate: 1.1, handling: 60, magazineSize: 8, reloadTime: 1.8 },
  parts: [
    { slot: 'Barrel', modifier: { baseDamage: 1.08 } }, { slot: 'Grip', modifier: { handling: 1.04 } },
    { slot: 'Core', modifier: { baseDamage: 1.02 } }, { slot: 'Magazine', modifier: { magazineSize: 1.1 } },
    { slot: 'Sight', modifier: { critChance: 1.06 } }, { slot: 'Chamber', modifier: { fireRate: 0.98 } },
  ], pixelSeed: 42,
} as unknown as Weapon;
void DropSource;

const seatJob = (): WorkshopJobView => ({
  id: 'tempo-craft-job', bench: 0, kind: 'consumable', recipeId: 'recipe_patch_kit', name: 'Patch Kit', state: 'running',
  unitsTotal: 2, unitsCompleted: 0, unitDurationMs: 60_000, accruedMs: 12_000, remainingMs: 48_000, xpAwarded: 0,
  gearRarity: null, catalystMaterialId: null, outputs: [], createdAtMs: 0, completedAtMs: null, repairItemId: null, repairKitType: null, repairPointsRestored: 0,
}) as WorkshopJobView;

const bossTimeline = (bossHp: number, finished: boolean): FightTimeline => ({
  outcome: FIXTURE_OUTCOME, startedAt: 0, finishedAt: finished ? 1 : null,
  currentPhaseIndex: 0, playerHp: 340, playerHpMax: 340, bossHp, bossHpMax: 800, damageLog: [],
});

/* ------------------------------ ROAM ------------------------------ */
const ROAM: Record<string, { hp: number; right: string; rings: Ring[]; rows: PulseRow[] }> = {
  rest: { hp: 300, right: '300 / 300 HP', rings: [], rows: [] },
  surge: {
    hp: 100, right: '204 → 100 · TICK 104',
    rings: [
      { at: ENEMY, r: R(104), color: COL.tick, label: '-104' },
      { at: ENEMY, r: R(20), color: COL.molten, w: 3 },
      { at: HUNTER, r: R(28), color: COL.shield, w: 3, label: 'SHLD 64 → 36' },
    ],
    rows: [
      { label: 'TICK 2 · DMG 52 · FIRE 18 · SPD 14', value: '84', ring: '', color: COL.tick },
      { label: 'MOLTEN CORE PROC', value: '20', ring: `RING ${R(20)} PX`, color: COL.molten },
      { label: 'TICK 2 TOTAL — PULSE AT IMPACT', value: '104', ring: `RING ${R(104)} PX`, color: COL.tick },
      { label: 'ENEMY SWIPE — PULSE AT HUNTER · RECHARGING → 52', value: 'SHLD −28', ring: `RING ${R(28)} PX`, color: COL.shield },
      { label: 'HISTORY · TICK 1 — 96 (58 · 22 · 16) · 300 → 204', value: '96', ring: 'TEXT ONLY', color: '#5B6370' },
    ],
  },
  kill: {
    hp: 0, right: '100 → 0 · CRIT 156 · +1 TECHFRAGMENTS',
    rings: [
      { at: ENEMY, r: R(156), color: COL.crit, w: 4, label: 'CRIT −156' },
      { at: ENEMY, r: R(156) - 17, color: COL.tick, w: 3 },
      { at: ENEMY, r: R(18), color: COL.echo, w: 3 },
    ],
    rows: [
      { label: 'CRIT · DMG 44 ×2.0 — DOUBLE PULSE, ONE EVENT', value: '88', ring: `RINGS ${R(156)} + ${R(156) - 17} PX`, color: COL.crit },
      { label: 'FIRE 24 · SPD 12 · MOLTEN CORE 14', value: '50', ring: '', color: COL.molten },
      { label: 'ECHO CHAMBER PROC', value: '18', ring: `RING ${R(18)} PX`, color: COL.echo },
      { label: 'TICK 3 TOTAL — KILL', value: '156', ring: `RING ${R(156)} PX`, color: COL.tick },
      { label: 'DROP AT IMPACT POINT · +1 TECHFRAGMENTS', value: '+1', ring: 'SHIPPED RISE', color: COL.find },
    ],
  },
};

/* ------------------------------ BOSS ------------------------------ */
const BOSS: Record<string, { hp: number; fin: boolean; right: string; rings: Ring[]; rows: PulseRow[] }> = {
  rest: { hp: 356, fin: false, right: '356 / 800 HP', rings: [], rows: [] },
  telegraph: {
    hp: 356, fin: false, right: '356 / 800 · SAND SLAM INBOUND',
    rings: [
      { at: BOSSP, r: 168, color: COL.tele, w: 4, dashed: true, label: 'SAND SLAM · WINDUP 3S' },
      { at: BOSSP, r: 118, color: COL.tele, w: 3, dashed: true, opacity: 0.55 },
    ],
    rows: [
      { label: 'SAND SLAM — INBOUND PULSE CONVERGING ON BOSS', value: 'WINDUP 3S', ring: 'RING 168 PX', color: COL.tele },
      { label: 'CADENCE — SPECIAL EVERY 18S (DEF)', value: '18S', ring: '', color: COL.tele },
      { label: 'NO DAMAGE PULSE — THE HIT HAS NOT LANDED', value: '—', ring: 'NO RING', color: '#5B6370' },
    ],
  },
  kill: {
    hp: 0, fin: true, right: '156 → 0 · CRIT 156',
    rings: [
      { at: BOSSP, r: R(156), color: COL.crit, w: 4, label: 'CRIT −156' },
      { at: BOSSP, r: R(156) - 17, color: COL.tick, w: 3 },
      { at: BOSSP, r: R(18), color: COL.echo, w: 3 },
    ],
    rows: [
      { label: 'CRIT · DMG 44 ×2.0 — DOUBLE PULSE, ONE EVENT', value: '88', ring: `RINGS ${R(156)} + ${R(156) - 17} PX`, color: COL.crit },
      { label: 'FIRE 24 · SPD 12 · MOLTEN CORE 14 · ECHO 18', value: '68', ring: '', color: COL.molten },
      { label: 'TICK 3 TOTAL — KILL', value: '156', ring: `RING ${R(156)} PX`, color: COL.tick },
      { label: 'SEGMENT · T1 96 → 260 · T2 104 → 156 · T3 156 → 0', value: '356', ring: 'TEXT ONLY', color: '#5B6370' },
    ],
  },
};

/* ------------------------------ CRAFT ------------------------------ */
const CRAFT: Record<string, { progress: number; working: boolean; done: boolean; pace: string; rings: Ring[]; rows: PulseRow[] }> = {
  slow: {
    progress: 0.3, working: true, done: false, pace: 'PACE 2 / MIN',
    rings: [
      { at: BENCH, r: 46, color: COL.pace, label: 'WORK BEAT' },
      { at: BENCH, r: 96, color: COL.pace, opacity: 0.3 },
    ],
    rows: [
      { label: 'WORK BEAT — ONE UNIT OF WORK PER PULSE', value: '2 / MIN', ring: 'RING 46 PX', color: COL.pace },
      { label: 'PREVIOUS BEAT — RING SPACING IS THE TEMPO', value: '30S APART', ring: 'RING 96 PX FADED', color: '#5B6370' },
    ],
  },
  ramped: {
    progress: 0.62, working: true, done: false, pace: 'PACE 5 / MIN',
    rings: [
      { at: BENCH, r: 46, color: COL.pace, label: 'WORK BEAT' },
      { at: BENCH, r: 72, color: COL.pace, opacity: 0.6 },
      { at: BENCH, r: 98, color: COL.pace, opacity: 0.38 },
      { at: BENCH, r: 124, color: COL.pace, opacity: 0.2 },
    ],
    rows: [
      { label: 'WORK BEATS — SAME 46 PX UNIT, TIGHTER SPACING', value: '5 / MIN', ring: 'RING 46 PX', color: COL.pace },
      { label: 'RAMP SO FAR · 2 / MIN → 5 / MIN → 9 / MIN', value: 'PHASE 2 OF 3', ring: '', color: COL.pace },
    ],
  },
  complete: {
    progress: 1, working: false, done: true, pace: 'PACE 9 / MIN · COMPLETE',
    rings: [
      { at: BENCH, r: 46, color: COL.done, w: 4, label: '+1 PATCH KIT' },
      { at: BENCH, r: 70, color: COL.pace, opacity: 0.5 },
      { at: BENCH, r: 94, color: COL.pace, opacity: 0.32 },
      { at: BENCH, r: 118, color: COL.pace, opacity: 0.18 },
    ],
    rows: [
      { label: 'FINAL BEATS AT FULL TEMPO', value: '9 / MIN', ring: 'RING 46 PX', color: COL.pace },
      { label: 'JOB COMPLETE — RESULT PULSE AT WORK POINT', value: '+1 PATCH KIT', ring: `RING 46 PX`, color: COL.done },
    ],
  },
};

/* ------------------------------ GATHER ------------------------------ */
const GATHER: Record<string, { progress: number; working: boolean; done: boolean; right: string; rings: Ring[]; rows: PulseRow[] }> = {
  start: { progress: 0.05, working: true, done: false, right: 'PASS 0:00 / 10:00', rings: [], rows: [] },
  flow: {
    progress: 0.45, working: true, done: false, right: 'FIND PULSES AT THE RIG',
    rings: [
      { at: RIG, r: R(14), color: COL.find, label: 'FIND' },
      { at: RIG, r: R(30), color: COL.find, opacity: 0.45 },
    ],
    rows: [
      { label: 'FIND — BALLISTIC PARTS (AREA BIAS, DUSTWASTE FRONTIER)', value: 'FIND', ring: `RING ${R(14)} PX`, color: COL.find },
      { label: 'DRAW RATE — SURFACE PASS (DEF)', value: '192 / HR', ring: '', color: COL.find },
      { label: 'DRAWS THIS PASS AT FULL RATE', value: '32', ring: '', color: COL.find },
    ],
  },
  yield: {
    progress: 1, working: false, done: true, right: 'PASS COMPLETE · +20 MASTERY XP',
    rings: [
      { at: RIG, r: R(40), color: COL.sig, w: 4, label: '+ SILTGLASS' },
      { at: RIG, r: R(80), color: COL.done, opacity: 0.6 },
    ],
    rows: [
      { label: 'SIGNATURE FIND — SILTGLASS (HOME AREA: DUSTWASTE FRONTIER)', value: 'SIGNATURE', ring: `RING ${R(40)} PX`, color: COL.sig },
      { label: 'PASS COMPLETE — 10 MIN · 32 DRAWS', value: 'COMPLETE', ring: `RING ${R(80)} PX`, color: COL.done },
      { label: 'MASTERY — GATHERING.EXTRACTION (DEF)', value: '+20 XP', ring: '', color: COL.done },
    ],
  },
};

/* ------------------------------ RESEARCH ------------------------------ */
const RESEARCH: Record<string, { frac: number; right: string; rings: Ring[]; rows: PulseRow[] }> = {
  start: {
    frac: 0.02, right: 'ENROLLED · 0H / 6H',
    rings: [{ at: DESK, r: 34, color: COL.study, label: 'ENROLL' }],
    rows: [
      { label: 'ENROLL — FEE PULSE AT THE DESK', value: '−2,500 CR', ring: 'RING 34 PX', color: COL.study },
      { label: 'COURSE — SHOP FUNDAMENTALS · FABRICATION T1 · 6 H', value: '6 H', ring: '', color: COL.study },
    ],
  },
  flow: {
    frac: 0.5, right: '3H / 6H',
    rings: [
      { at: DESK, r: 40, color: COL.study, label: 'HOUR 3' },
      { at: DESK, r: 74, color: COL.study, opacity: 0.55 },
      { at: DESK, r: 108, color: COL.study, opacity: 0.3 },
    ],
    rows: [
      { label: 'STUDY — ONE EQUAL PULSE PER HOUR (1H = 1 PULSE)', value: '3 / 6 H', ring: 'RING 40 PX', color: COL.study },
      { label: 'HOURS 1–2 — TRAILING RINGS, SAME SIZE', value: '2 H', ring: 'RINGS 74 · 108 PX FADED', color: '#5B6370' },
    ],
  },
  done: {
    frac: 1, right: 'COMPLETE · 6H / 6H',
    rings: [
      { at: DESK, r: 52, color: COL.done, w: 4, label: 'COMPLETE' },
      { at: DESK, r: 92, color: COL.study, opacity: 0.4 },
    ],
    rows: [
      { label: 'COMPLETION PULSE AT THE DESK', value: '6 / 6 H', ring: 'RING 52 PX', color: COL.done },
      { label: 'EFFECT FIRES — CRAFT QUALITY SHIFT', value: '+2', ring: '', color: COL.done },
    ],
  },
};

const ORDER: Record<string, string[]> = {
  roam: ['rest', 'surge', 'kill'], boss: ['rest', 'telegraph', 'kill'],
  craft: ['slow', 'ramped', 'complete'], gather: ['start', 'flow', 'yield'],
  research: ['start', 'flow', 'done'],
};
const FOOT: Record<string, string> = {
  roam: 'PULSE SCALE — RING RADIUS = 26 + VALUE × 0.72 PX · CRIT 25% · ×2.0 · CRIT = DOUBLE RING, ONE EVENT',
  boss: 'PULSE SCALE — RING RADIUS = 26 + VALUE × 0.72 PX · TELEGRAPH = ONLY INBOUND RING · SAND SLAM 18S / 3S (DEF)',
  craft: 'CRAFT PULSES — EVERY WORK BEAT IS ONE UNIT: RING FIXED AT 46 PX · ONLY THE RATE MOVES · 2 → 5 → 9 / MIN',
  gather: 'PULSE SCALE — RING RADIUS = 26 + VALUE × 0.72 PX · FINDS PULSE AT THE RIG · PASS 10 MIN (DEF)',
  research: 'RESEARCH PULSES — ONE EQUAL RING PER HOUR AT THE DESK · EFFECT FIRES ONLY AT COMPLETION (DEF)',
};

/* ------------------------------ CRAFT AUTO (clip) ------------------------------ */
const CraftAuto: React.FC = () => {
  const [phase, setPhase] = useState(0); // 0: 2/min, 1: 5/min, 2: 9/min, 3: done
  const [rings, setRings] = useState<{ id: number; born: number }[]>([]);
  const idRef = useRef(0);
  useEffect(() => {
    const t1 = window.setTimeout(() => setPhase(1), 4200);
    const t2 = window.setTimeout(() => setPhase(2), 8400);
    const t3 = window.setTimeout(() => setPhase(3), 12400);
    return () => [t1, t2, t3].forEach(clearTimeout);
  }, []);
  useEffect(() => {
    if (phase >= 3) return;
    const period = phase === 0 ? 500 : phase === 1 ? 200 : 111; // x60: 2/min->500ms, 5/min->200ms, 9/min->111ms
    const iv = window.setInterval(() => {
      setRings((prev) => [...prev.slice(-14), { id: ++idRef.current, born: performance.now() }]);
    }, period);
    return () => window.clearInterval(iv);
  }, [phase]);
  const [, setTick] = useState(0);
  useEffect(() => {
    let raf = 0; const loop = () => { setTick((t) => t + 1); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, []);
  const now = performance.now();
  const live = rings.map((r) => {
    const age = (now - r.born) / 1000;
    const rad = 8 + age * 90;
    return { at: BENCH, r: rad, color: COL.pace, opacity: Math.max(0, 0.95 - age * 0.8), w: 3 } as Ring;
  }).filter((r) => r.opacity > 0.05 && r.r < 150);
  const paceLabel = phase === 0 ? 'PACE 2 / MIN' : phase === 1 ? 'PACE 5 / MIN' : phase === 2 ? 'PACE 9 / MIN' : 'PACE 9 / MIN · COMPLETE';
  const progress = phase === 0 ? 0.3 : phase === 1 ? 0.62 : phase === 2 ? 0.92 : 1;
  return (
    <div>
      <div style={{ position: 'relative' }}>
        <CraftingBenchScene progress={progress} causeLabel="Tempering · Patch Kit" buysLabel="→ Patch Kit ×1" working={phase < 3} result={phase >= 3 ? 'success' : null} seatJob={seatJob()} />
        <Rings rings={live} />
        {phase >= 3 && (
          <div className="pointer-events-none absolute z-30" style={{ left: '58%', top: '67%', width: 46, height: 58, transform: 'translate(-50%, -78%)' }}>
            <motion.div initial={{ y: 6, opacity: 0, scale: 0.6 }} animate={{ y: [6, -14, -26, -30], opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }} transition={{ duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut' }} style={{ width: '100%', height: '100%' }}>
              <DropRiseIcon tone="material" label="+1 Patch Kit" />
            </motion.div>
          </div>
        )}
      </div>
      <Panel title="PATCH KIT · TEMPO PULSE · CLIP TIME ×60" right={paceLabel} rows={CRAFT[phase >= 3 ? 'complete' : phase === 0 ? 'slow' : 'ramped'].rows} foot={FOOT.craft} />
    </div>
  );
};

/* ------------------------------ PAGE ------------------------------ */
export const TempoHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const activity = ORDER[params.get('activity') ?? 'roam'] ? (params.get('activity') ?? 'roam') : 'roam';
  const [beat, setBeat] = useState(params.get('beat') ?? ORDER[activity][0]);
  const auto = params.get('auto') === '1';

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (name: string) => { if (ORDER[activity].includes(name)) setBeat(name); };
  }, [activity]);

  useEffect(() => {
    if (activity !== 'roam') return;
    const hp = ROAM[beat]?.hp ?? 300;
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: hp, currentTargetHpMax: 300 });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
  }, [activity, beat]);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box', minHeight: '100vh' }} data-testid="tempo-root">
      {activity === 'roam' && (
        <div>
          <div style={{ position: 'relative' }}>
            <LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={HARNESS_WEAPON} playerLevel={5} equippedCount={4} activityKind="roaming_loot" />
            <Rings rings={ROAM[beat].rings} />
            {beat === 'kill' && (
              <div className="pointer-events-none absolute z-30" style={{ left: '72%', top: '52%', width: 46, height: 58, transform: 'translate(-50%, -140%)' }}>
                <motion.div initial={{ y: 6, opacity: 0, scale: 0.6 }} animate={{ y: [6, -14, -26, -30], opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }} transition={{ duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut', repeat: Infinity, repeatDelay: 2.4 }} style={{ width: '100%', height: '100%' }}>
                  <DropRiseIcon tone="material" label="+1 TechFragments" />
                </motion.div>
              </div>
            )}
          </div>
          <Panel title={beat === 'kill' ? 'WRAITH SCAVENGER · TICK 3 — CRIT' : beat === 'surge' ? 'WRAITH SCAVENGER · TICK 2 — MOLTEN CORE' : 'WRAITH SCAVENGER · HUNTER L5 · EPIC FIRE SNIPER CARBINE'} right={ROAM[beat].right} rows={ROAM[beat].rows} foot={FOOT.roam} />
        </div>
      )}
      {activity === 'boss' && (
        <div>
          <div style={{ position: 'relative' }}>
            <BossFightStageDom timeline={bossTimeline(BOSS[beat].hp, BOSS[beat].fin)} phases={FIXTURE_PHASES} bossId="dune_tyrant" weapon={FIXTURE_WEAPON} />
            <Rings rings={BOSS[beat].rings} />
          </div>
          <Panel title={beat === 'telegraph' ? 'DUNE TYRANT · TELEGRAPH' : beat === 'kill' ? 'DUNE TYRANT · TICK 3 — CRIT' : 'DUNE TYRANT · SEGMENT OPENS MID-FIGHT'} right={BOSS[beat].right} rows={BOSS[beat].rows} foot={FOOT.boss} />
        </div>
      )}
      {activity === 'craft' && (auto ? <CraftAuto /> : (
        <div>
          <div style={{ position: 'relative' }}>
            <CraftingBenchScene progress={CRAFT[beat].progress} causeLabel="Tempering · Patch Kit" buysLabel="→ Patch Kit ×1" working={CRAFT[beat].working} result={CRAFT[beat].done ? 'success' : null} seatJob={seatJob()} />
            <Rings rings={CRAFT[beat].rings} />
            {CRAFT[beat].done && (
              <div className="pointer-events-none absolute z-30" style={{ left: '58%', top: '67%', width: 46, height: 58, transform: 'translate(-50%, -78%)' }}>
                <motion.div initial={{ y: 6, opacity: 0, scale: 0.6 }} animate={{ y: [6, -14, -26, -30], opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }} transition={{ duration: 1.6, times: [0, 0.3, 0.75, 1], ease: 'easeOut' }} style={{ width: '100%', height: '100%' }}>
                  <DropRiseIcon tone="material" label="+1 Patch Kit" />
                </motion.div>
              </div>
            )}
          </div>
          <Panel title="PATCH KIT · TEMPO PULSE" right={CRAFT[beat].pace} rows={CRAFT[beat].rows} foot={FOOT.craft} />
        </div>
      ))}
      {activity === 'gather' && (
        <div>
          <div style={{ position: 'relative' }}>
            <ExtractionScene progress={GATHER[beat].progress} causeLabel="Surface Pass · Dustwaste Frontier" buysLabel="→ Materials + Essences" working={GATHER[beat].working} result={GATHER[beat].done ? 'success' : null} />
            <Rings rings={GATHER[beat].rings} />
          </div>
          <Panel title="EXTRACTION · DUSTWASTE FRONTIER · SURFACE" right={GATHER[beat].right} rows={GATHER[beat].rows} foot={FOOT.gather} />
        </div>
      )}
      {activity === 'research' && (
        <div>
          <div style={{ position: 'relative' }}>
            <div data-testid="research-desk" style={{ border: '2px solid #232833', background: '#0B0D12', padding: '18px 16px', minHeight: 228, boxSizing: 'border-box', position: 'relative' }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#F5F7FA', letterSpacing: '0.04em' }}>Shop Fundamentals</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#8A93A3', marginTop: 4, letterSpacing: '0.06em' }}>FABRICATION · TIER 1 · 6 H · 2,500 CR</div>
              <div style={{ marginTop: 18, height: 12, background: '#1A1E27', display: 'flex' }}>
                <div style={{ width: `${RESEARCH[beat].frac * 100}%`, background: '#F5B83D', transition: 'width 400ms ease' }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#8A93A3', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                {beat === 'start' ? '0H / 6H' : beat === 'flow' ? '3H / 6H' : '6H / 6H'}
              </div>
              <div style={{ fontSize: 12, fontWeight: 800, color: beat === 'done' ? '#4ADE80' : '#5B6472', marginTop: 16 }}>
                Unlock: Craft quality shift +2 on every completed craft unit
              </div>
              <Rings rings={RESEARCH[beat].rings} />
            </div>
          </div>
          <Panel title="RESEARCH · SHOP FUNDAMENTALS" right={RESEARCH[beat].right} rows={RESEARCH[beat].rows} foot={FOOT.research} />
        </div>
      )}
    </div>
  );
};
