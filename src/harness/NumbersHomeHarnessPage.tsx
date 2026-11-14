import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreen } from '@/screens/HomeScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import {
  FloatLayerHome,
  HOME_FLOAT_COLORS,
  makeHomeFloats,
  type HomeFloatSpec,
} from './FloatNumbersHome';
import {
  useActivityStore,
  useIdleStore,
  useInventoryStore,
  useKillCycleStore,
  useLoadoutStore,
  usePlayerStore,
  useTickFeedStore,
  useWorkshopStore,
} from '@/store';
import { useSurvivalStore as useSurvivalSlice } from '@/store/slices/survivalSlice';
import { IDLE_ACTIVITY } from '@/types/activity';
import { DEFAULT_ROAMING_AREA_ID } from '@/constants/roamingAreas';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { GearItem as GearItemT, Shield as ShieldT } from '@/types/items';

/**
 * Numbers-forward display on the REAL Home screen (THROWAWAY
 * rendering prototype, 2026-11-14 — harness only). The owner's
 * correction of the strip take: work off the EXISTING Home grid —
 * the shipped layout does not change, not a panel moved, added,
 * or removed. This page mounts the production HomeScreen (+ the
 * App shell's BottomNav) with seeded stores, and the ONLY added
 * layer is the floating numbers (FloatNumbersHome.tsx), whose
 * floats are born at seats that already exist:
 *
 *   tick total / crit total → the enemy HP plate on the stage
 *   DMG satellite           → HeroRundown "Dmg/tick" cell
 *   SPD satellite           → HeroRundown "DPS" cell (attack
 *                             speed is a DPS input; no SPD cell
 *                             exists in the shipped grid)
 *   SHLD absorb / regen     → HeroRundown "Shield" cell
 *   BLOCKED (mitigation)    → HeroRundown "Mit" cell
 *   FIRE / MOLTEN / ECHO    → the impact point on the enemy
 *                             (no grid seats exist for element
 *                             or procs — stated honestly)
 *
 * A seat cell flashes its stat's color at the float's birth.
 * The shipped DamageNumber presentation this layer replaces is
 * hidden by a page-scoped style so the replacement reads clean
 * (disclosed harness technique; the stage still performs its
 * flash/sparks/poses/HP-ghost from the same beat events).
 *
 * Harness stubs (disclosed): activity.heartbeat and
 * workshop.refresh are replaced with no-ops via store setState
 * (there is no backend on the capture runner); auth is stubbed
 * by the tree's vite config (the dash/numbers pattern).
 *
 * Fixture fight (scripted presentation — no combat math):
 *   Enemy: Wraith Scavenger (dustwaste_raider), 300 HP.
 *   Hunter: L5, Epic Fire sniper (flat rolled: baseDamage 30,
 *   attackSpeed 1.05, critChance 0.25, critDamage 1.0 — the real
 *   grid prints DPS ≈ 32 · Dmg/tick ≈ 96 · Crit 25% · Crit ×2.0),
 *   Rare shield (hp 100, mitigation 0.30 → Shield 100 · Mit 30%).
 *   Canonical HP pool at L5 = 1,000 + 100 shield = 1,100; the
 *   hunter stands at 792 (72%). Shield pool 100, at 64.
 *   Tick 1 (t+1.0s): plain hit, 96 — DMG 58 / FIRE 22 / SPD 16.
 *     Enemy 300 → 204.
 *   Tick 2 (t+4.0s): Molten Core procs, 104 — DMG 52 / FIRE 18 /
 *     SPD 14, MOLTEN +20. Enemy 204 → 100.
 *   Swipe (t+4.7s): the wraith's parting hit, 40 raw — 12 BLOCKED
 *     by mitigation, 28 absorbed by the shield. SHLD 64 → 36.
 *   Regen tick (t+7.0s): damage-free — shield recharge +52
 *     ((10 + 1.5×L5)/s × 3s tick ≈ 52). SHLD 36 → 88.
 *   Tick 3 (t+10.0s): CRIT + both procs, 156 — the kill.
 *     DMG 44 ×2.0 = 88 / FIRE 24 / SPD 12, MOLTEN +14, ECHO +18.
 *     At t+11.6s the kill pays out (shipped LootMoment, Epic
 *     "Dustwaste Longshot") and the timeline ends on the hold.
 *
 * Drive: window.__startNumbersHome() runs the fight timeline.
 * ?scene=kill mounts the kill-drop composition directly (kill
 * cycle holding the wraith at 0 HP; window.__seedKillDrop()
 * seeds the drop event + the crit cluster on the capture
 * script's start line — the LootMoment unmounts when its
 * celebration completes, so the seed shares the shot's clock).
 */

/** The hunter's equipped weapon — a flat rolled item, the shape
 *  the server actually deals (the summary prices these fields). */
const FIXTURE_WEAPON = {
  id: 'nh-weapon',
  name: 'Emberline Carbine',
  level: 5,
  rarity: Rarity.Epic,
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  element: Element.Fire,
  rollQuality: 78,
  baseDamage: 30,
  attackSpeed: 1.05,
  critChance: 0.25,
  critDamage: 1.0,
  statusChance: 0.2,
  statusDamage: 18,
  bossDamageMod: 1,
  waveDamageMod: 1,
  shieldDamageMod: 1,
  armorDamageMod: 1,
  offlineEarningsMod: 1,
  rareDropChanceMod: 1,
  scrapYieldMod: 1,
  parts: [],
  affixes: [],
  isLocked: false,
  pixelSeed: 42,
  combatPower: 300,
  bossPower: 280,
  farmPower: 260,
  economyScore: 38,
} as unknown as GearItemT;

/** The hunter's shield: 100 capacity, 30% mitigation — the
 *  fixture's 12-of-40 blocked is this cell's own rate. */
const FIXTURE_SHIELD: ShieldT = {
  id: 'nh-shield',
  name: 'Bulwark Plate',
  level: 5,
  rarity: Rarity.Rare,
  hp: 100,
  rechargeRate: 10,
  mitigation: 0.3,
  element: Element.Kinetic,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 9,
} as ShieldT;

/** The kill's payout — flat rolled-field shape (see bars harness). */
const DROP_GEAR = {
  id: 'drop-hold-item',
  name: 'Dustwaste Longshot',
  level: 5,
  rarity: Rarity.Epic,
  weaponType: WeaponType.Sniper,
  manufacturer: Manufacturer.Ironwood,
  element: Element.Fire,
  rollQuality: 82,
  baseDamage: 148,
  attackSpeed: 1.12,
  critChance: 0.18,
  critDamage: 2.0,
  statusChance: 0.2,
  statusDamage: 24,
  bossDamageMod: 1,
  waveDamageMod: 1,
  shieldDamageMod: 1,
  armorDamageMod: 1,
  offlineEarningsMod: 1,
  rareDropChanceMod: 1,
  scrapYieldMod: 1,
  parts: [],
  affixes: [],
  isLocked: false,
  pixelSeed: 7,
  combatPower: 320,
  bossPower: 300,
  farmPower: 280,
  economyScore: 40,
} as unknown as GearItemT;

const ENEMY_MAX = 300;
/** Canonical L5 pool: (700 + 60×5) + 100 shield capacity. */
const HUNTER_MAX_HP = 1100;
const HUNTER_HP = 792; // 72% of the pool

let beatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  const event = {
    id: `nh-beat-${beatSeq}`,
    at: Date.now(),
    detail: 'Wraith Scavenger',
    areaId: DEFAULT_ROAMING_AREA_ID,
    ...partial,
  } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

/** A mundane standing tick — what a real mid-roam screen holds
 *  between beats (the stage rests on it; the feed shows it). */
const REST_EVENT = {
  id: 'nh-rest-tick',
  at: Date.now(),
  tone: 'cash',
  label: '+14',
  detail: 'Dustwaste Frontier',
  value: 14,
  areaId: DEFAULT_ROAMING_AREA_ID,
} as TickEvent;

/** Seed every store the Home tree reads, BEFORE it mounts. */
const seedStores = (killScene: boolean) => {
  usePlayerStore.setState({
    id: 'numbers-home-harness',
    level: 5,
    xp: 2600,
    credits: 18450,
    scrap: 2310,
    cacheKeys: 3,
    consumables: { MedKit: 4, ShieldCell: 3, AmmoPack: 2 },
    cacheRankSpends: {},
  } as never);
  useInventoryStore.setState({ items: [FIXTURE_WEAPON, FIXTURE_SHIELD] } as never);
  const loadout = useLoadoutStore.getState();
  loadout.setSlot('primary', FIXTURE_WEAPON.id);
  loadout.setSlot('shield', FIXTURE_SHIELD.id);
  loadout.setSlot('vehicle', null);
  loadout.setConsumableSlot('PreFight', 'MedKit');
  loadout.setConsumableSlot('MidFight', 'ShieldCell');
  useSurvivalSlice.setState({
    currentHp: HUNTER_HP,
    maxHp: HUNTER_MAX_HP,
    shieldHp: killScene ? 88 : 64,
    isDead: false,
  });
  useActivityStore.setState({
    current: {
      ...IDLE_ACTIVITY,
      kind: 'roaming_loot',
      targetType: 'roaming_area',
      targetId: DEFAULT_ROAMING_AREA_ID,
      targetLabel: 'Dustwaste Frontier',
      startedAt: new Date().toISOString(),
    },
    pending: false,
    hydrated: true,
    // Harness stub: no backend on the runner — the heartbeat
    // resolves the standing activity instead of calling the API.
    heartbeat: async () => useActivityStore.getState().current,
  } as never);
  useIdleStore.setState({ selectedRoamingAreaId: DEFAULT_ROAMING_AREA_ID } as never);
  useKillCycleStore.setState({
    currentTargetId: 'dustwaste_raider',
    currentTargetHp: killScene ? 0 : ENEMY_MAX,
    currentTargetHpMax: ENEMY_MAX,
  });
  useTickFeedStore.setState({ events: killScene ? [] : [REST_EVENT] });
  // Harness stub: the workshop mirror refresh is a server call;
  // the bench is not on this screen's workspace (roaming is).
  useWorkshopStore.setState({ refresh: async () => undefined } as never);
};

/** The shipped DamageNumber this layer replaces — hidden page-wide. */
const SHIPPED_NUMBER_OFF =
  '[data-testid="fx-damage-number"],[data-testid="fx-damage-number-crit"]{display:none!important}';

export const NumbersHomeHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const killScene = params.get('scene') === 'kill';
  const probe = params.get('probe') === '1';
  const [floats, setFloats] = useState<HomeFloatSpec[]>([]);
  const floatsRef = useRef<HomeFloatSpec[]>([]);
  floatsRef.current = floats;
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const timers = useRef<number[]>([]);

  // Diagnostic surface for capture plans (state vs DOM truth).
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__nhDebug = () => ({
      floatsInState: floatsRef.current.length,
      wrapPresent: !!wrapRef.current,
      wrapRect: wrapRef.current
        ? (({ top, left, width, height }) => ({ top, left, width, height }))(wrapRef.current.getBoundingClientRect())
        : null,
    });
  }, []);

  // Seed during the first render — before HomeScreen mounts
  // (the RoamHarnessPage vehicle-seeding pattern).
  useState(() => {
    seedStores(killScene);
  });

  const expireFloat = useCallback((id: number) => {
    setFloats((cur) => cur.filter((f) => f.id !== id));
  }, []);
  const spawn = useCallback((specs: Array<Omit<HomeFloatSpec, 'id'>>) => {
    if (specs.length > 0) setFloats((cur) => [...cur, ...makeHomeFloats(specs)]);
  }, []);

  /* ── Anchor resolution: birth points from the LIVE grid ── */
  const pointOf = useCallback((el: Element | null, fx: number, fy: number) => {
    const wrap = wrapRef.current;
    if (!el || !wrap) return null;
    const r = el.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    return { x: r.left - w.left + r.width * fx, y: r.top - w.top + r.height * fy };
  }, []);
  const byTestId = useCallback(
    (testId: string, fx: number, fy: number) =>
      pointOf(document.querySelector(`[data-testid="${testId}"]`), fx, fy),
    [pointOf],
  );
  /** A rundown cell's top-center — the float is born at the cell. */
  const cellBirth = useCallback((testId: string) => byTestId(testId, 0.5, 0), [byTestId]);
  /** The enemy plate's top-center — totals are born at the plate. */
  const enemyPlateBirth = useCallback(() => byTestId('primary-diorama-target-hp', 0.5, 0), [byTestId]);
  /** The impact point: above the enemy plate, at the figure's torso. */
  const impactBirth = useCallback(() => byTestId('primary-diorama-target-hp', 0.5, -0.9), [byTestId]);
  const hunterCenterX = useCallback(() => {
    const p = byTestId('diorama-hunter-hp', 0.5, 0.5);
    return p ? p.x : null;
  }, [byTestId]);
  const enemyCenterX = useCallback(() => {
    const p = byTestId('primary-diorama-target-hp', 0.5, 0.5);
    return p ? p.x : null;
  }, [byTestId]);

  /** Flash a seat cell in its stat's color at its float's birth. */
  const flashCell = useCallback((testId: string, color: string) => {
    const el = document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
    if (!el) return;
    const prevShadow = el.style.boxShadow;
    const prevBg = el.style.backgroundColor;
    el.style.transition = 'box-shadow 160ms ease-out, background-color 160ms ease-out';
    el.style.boxShadow = `inset 0 0 0 2px ${color}, inset 0 0 24px ${color}59`;
    el.style.backgroundColor = `${color}1f`;
    const t = window.setTimeout(() => {
      el.style.boxShadow = prevShadow;
      el.style.backgroundColor = prevBg;
    }, 750);
    timers.current.push(t);
  }, []);

  useEffect(() => {
    const later = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };

    /** The kill tick's float cluster — shared by both scenes.
     *  The crit total is born at the enemy plate (HP's seat) in
     *  crit green; DMG/SPD rise from their rundown cells toward
     *  the enemy; FIRE/MOLTEN/ECHO are born at the impact point
     *  (no grid seats exist for them). */
    const critCluster = () => {
      const plate = enemyPlateBirth();
      const dmg = cellBirth('hero-stat-dmgTick');
      const spd = cellBirth('hero-stat-dps');
      const impact = impactBirth();
      const ex = enemyCenterX();
      const driftFrom = (pt: { x: number; y: number } | null) =>
        pt && ex ? Math.max(0, Math.min(90, (ex - pt.x) * 0.35)) : 0;
      const specs: Array<Omit<HomeFloatSpec, 'id'>> = [];
      if (plate) specs.push({ x: plate.x, y: plate.y - 4, kind: 'critTotal', text: '-156', tag: 'CRIT', color: HOME_FLOAT_COLORS.crit });
      if (dmg) specs.push({ x: dmg.x, y: dmg.y, kind: 'satellite', text: '-88', tag: 'DMG', color: HOME_FLOAT_COLORS.dmg, driftPx: driftFrom(dmg) });
      if (spd) specs.push({ x: spd.x, y: spd.y, kind: 'satellite', text: '-12', tag: 'SPD', color: HOME_FLOAT_COLORS.spd, driftPx: driftFrom(spd) });
      if (impact) {
        specs.push({ x: impact.x - 16, y: impact.y, kind: 'satellite', text: '-24', tag: 'FIRE', color: HOME_FLOAT_COLORS.fire, travelPx: 120 });
        specs.push({ x: impact.x + 14, y: impact.y + 6, kind: 'proc', text: '+14', tag: 'MOLTEN', color: HOME_FLOAT_COLORS.molten, delayMs: 150, travelPx: 125 });
        specs.push({ x: impact.x + 34, y: impact.y + 2, kind: 'proc', text: '+18', tag: 'ECHO', color: HOME_FLOAT_COLORS.echo, delayMs: 200, travelPx: 125 });
      }
      spawn(specs);
      flashCell('hero-stat-dmgTick', HOME_FLOAT_COLORS.dmg);
      flashCell('hero-stat-dps', HOME_FLOAT_COLORS.spd);
      flashCell('hero-stat-critChance', HOME_FLOAT_COLORS.crit);
      flashCell('hero-stat-critDamage', HOME_FLOAT_COLORS.crit);
    };

    if (killScene) {
      // Kill-drop composition: the kill has landed — the kill
      // cycle holds the wraith at 0 HP (anchoring the LootMoment
      // at the corpse spot) and the drop + crit cluster wait for
      // the capture script's start line. No timeline runs.
      const w = window as unknown as Record<string, unknown>;
      w.__seedKillDrop = () => {
        seedBeatEvent({ tone: 'loot', label: 'Dustwaste Longshot', value: 1, gear: DROP_GEAR });
        critCluster();
      };
      return () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
      };
    }

    const run = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      useKillCycleStore.setState({
        currentTargetId: 'dustwaste_raider',
        currentTargetHp: ENEMY_MAX,
        currentTargetHpMax: ENEMY_MAX,
      });
      useSurvivalSlice.setState({ currentHp: HUNTER_HP, maxHp: HUNTER_MAX_HP, shieldHp: 64 });
      useTickFeedStore.setState({ events: [REST_EVENT] });
      setFloats([]);

      const at = later;
      const driftFrom = (pt: { x: number; y: number } | null) => {
        const ex = enemyCenterX();
        return pt && ex ? Math.max(0, Math.min(90, (ex - pt.x) * 0.35)) : 0;
      };
      const driftToHunter = (pt: { x: number; y: number } | null) => {
        const hx = hunterCenterX();
        return pt && hx ? Math.max(-160, Math.min(0, (hx - pt.x) * 0.6)) : 0;
      };

      // ── Tick 1 — plain hit, 96 ─────────────────────────────
      at(1000, () => {
        seedBeatEvent({ tone: 'loot', label: '-96', value: 96 });
        useKillCycleStore.setState({ currentTargetHp: 204 });
        const plate = enemyPlateBirth();
        const dmg = cellBirth('hero-stat-dmgTick');
        const spd = cellBirth('hero-stat-dps');
        const impact = impactBirth();
        const specs: Array<Omit<HomeFloatSpec, 'id'>> = [];
        if (plate) specs.push({ x: plate.x, y: plate.y - 4, kind: 'total', text: '-96', color: HOME_FLOAT_COLORS.total });
        if (dmg) specs.push({ x: dmg.x, y: dmg.y, kind: 'satellite', text: '-58', tag: 'DMG', color: HOME_FLOAT_COLORS.dmg, driftPx: driftFrom(dmg) });
        if (spd) specs.push({ x: spd.x, y: spd.y, kind: 'satellite', text: '-16', tag: 'SPD', color: HOME_FLOAT_COLORS.spd, driftPx: driftFrom(spd) });
        if (impact) specs.push({ x: impact.x, y: impact.y, kind: 'satellite', text: '-22', tag: 'FIRE', color: HOME_FLOAT_COLORS.fire, travelPx: 120 });
        spawn(specs);
        flashCell('hero-stat-dmgTick', HOME_FLOAT_COLORS.dmg);
        flashCell('hero-stat-dps', HOME_FLOAT_COLORS.spd);
      });

      // ── Tick 2 — Molten Core procs, 104 ────────────────────
      at(4000, () => {
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        useKillCycleStore.setState({ currentTargetHp: 100 });
        const plate = enemyPlateBirth();
        const dmg = cellBirth('hero-stat-dmgTick');
        const spd = cellBirth('hero-stat-dps');
        const impact = impactBirth();
        const specs: Array<Omit<HomeFloatSpec, 'id'>> = [];
        if (plate) specs.push({ x: plate.x, y: plate.y - 4, kind: 'total', text: '-104', color: HOME_FLOAT_COLORS.total });
        if (dmg) specs.push({ x: dmg.x, y: dmg.y, kind: 'satellite', text: '-52', tag: 'DMG', color: HOME_FLOAT_COLORS.dmg, driftPx: driftFrom(dmg) });
        if (spd) specs.push({ x: spd.x, y: spd.y, kind: 'satellite', text: '-14', tag: 'SPD', color: HOME_FLOAT_COLORS.spd, driftPx: driftFrom(spd) });
        if (impact) {
          specs.push({ x: impact.x - 10, y: impact.y, kind: 'satellite', text: '-18', tag: 'FIRE', color: HOME_FLOAT_COLORS.fire, travelPx: 120 });
          specs.push({ x: impact.x + 16, y: impact.y + 6, kind: 'proc', text: '+20', tag: 'MOLTEN', color: HOME_FLOAT_COLORS.molten, delayMs: 120, travelPx: 125 });
        }
        spawn(specs);
        flashCell('hero-stat-dmgTick', HOME_FLOAT_COLORS.dmg);
        flashCell('hero-stat-dps', HOME_FLOAT_COLORS.spd);
      });

      // ── The wraith's parting swipe — 40 raw ────────────────
      at(4700, () => {
        seedBeatEvent({ tone: 'damage', label: '-40', value: 40 });
        useSurvivalSlice.setState({ shieldHp: 36 });
        const sh = cellBirth('hero-stat-shield');
        const mit = cellBirth('hero-stat-mitigation');
        const specs: Array<Omit<HomeFloatSpec, 'id'>> = [];
        if (sh) specs.push({ x: sh.x, y: sh.y, kind: 'absorb', text: '-28', tag: 'SHLD', color: HOME_FLOAT_COLORS.shield, driftPx: driftToHunter(sh) });
        if (mit) specs.push({ x: mit.x, y: mit.y, kind: 'blocked', text: '12', tag: 'BLOCKED', color: HOME_FLOAT_COLORS.blocked, delayMs: 140, driftPx: driftToHunter(mit) });
        spawn(specs);
        flashCell('hero-stat-shield', HOME_FLOAT_COLORS.shield);
        flashCell('hero-stat-mitigation', HOME_FLOAT_COLORS.blocked);
      });

      // ── Regen tick — damage-free, shield recharges +52 ─────
      at(7000, () => {
        useSurvivalSlice.setState({ shieldHp: 88 });
        const sh = cellBirth('hero-stat-shield');
        const specs: Array<Omit<HomeFloatSpec, 'id'>> = [];
        if (sh) specs.push({ x: sh.x, y: sh.y, kind: 'regen', text: '+52', tag: 'SHLD', color: HOME_FLOAT_COLORS.regen, tagColor: HOME_FLOAT_COLORS.shield, driftPx: driftToHunter(sh) });
        spawn(specs);
        flashCell('hero-stat-shield', HOME_FLOAT_COLORS.regen);
      });

      // ── Tick 3 — CRIT + both procs, 156, the kill ──────────
      at(10000, () => {
        seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
        useKillCycleStore.setState({ currentTargetHp: 0 });
        critCluster();
      });

      // ── The drop — the kill pays out ───────────────────────
      at(11600, () => {
        seedBeatEvent({ tone: 'loot', label: 'Dustwaste Longshot', value: 1, gear: DROP_GEAR });
        useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
      });
    };

    const w = window as unknown as Record<string, unknown>;
    w.__startNumbersHome = run;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      later(2500, run);
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [killScene, spawn, cellBirth, enemyPlateBirth, impactBirth, enemyCenterX, hunterCenterX, flashCell]);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#000' }}>
      <style>{SHIPPED_NUMBER_OFF}</style>
      <div
        style={{
          height: 915,
          display: 'flex',
          flexDirection: 'column',
          background: '#050608',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <div ref={wrapRef} style={{ position: 'relative' }}>
            <HomeScreen onNavigate={() => undefined} onOpenBossSelect={() => undefined} />
            <FloatLayerHome floats={floats} onExpire={expireFloat} probe={probe} />
          </div>
        </div>
        <BottomNav activeTab="home" onChange={() => undefined} />
      </div>
    </div>
  );
};
