import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { FloatLayer, ReadoutStrip, FLOAT_COLORS, makeFloats, type FloatSpec } from './FloatNumbers';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { GearItem, TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

/**
 * Numbers-forward roam mock (THROWAWAY rendering prototype,
 * 2026-11-13 — harness only). The REAL LiveTurfDiorama at phone
 * width, driven through the same stores the production claim path
 * feeds — with NO analyzer band. Instead (owner refinement,
 * 2026-11-13 23:15 ET): a slim readout strip under the stage
 * holds the build's stats as quiet seats, and everything the
 * tick resolves pops as a number at its seat and FLOATS UP into
 * the stage action (FloatNumbers.tsx — geometry + color law
 * live there). The shipped DamageNumber presentation this take
 * replaces is hidden by a page-scoped style below so the
 * replacement reads clean; the stage still performs its own
 * muzzle flash, tracer, impact sparks, poses and HP ghosting
 * from the same beat events.
 *
 * Fixture fight (scripted presentation — no combat math):
 *   Enemy: Wraith Scavenger (dustwaste_raider), 300 HP.
 *   Hunter: L5, Epic Fire sniper carbine. Shield pool 100, at 64.
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
 * Drive: window.__startNumbers() runs the fight timeline;
 * ?auto=1 runs it once after mount. ?scene=kill mounts the
 * kill-drop composition directly (the bars-fix drop staging):
 * the stage in endless mode (enemy slot never populated), the
 * kill cycle holding the wraith at 0 HP so the LootMoment
 * anchors at the corpse spot, the strip settled post-fight,
 * and window.__seedKillDrop() seeding the drop event + the
 * crit float cluster on the capture script's start line (the
 * moment unmounts when its celebration completes, so the seed
 * must share the screenshot's clock).
 */

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
} as unknown as GearItem;

const ENEMY_MAX = 300;
void DropSource;

let beatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  const event = {
    id: `numbers-beat-${beatSeq}`,
    at: Date.now(),
    detail: 'numbers-harness',
    ...partial,
  } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

/** Resting strip: the build's headline stats (fixture truth). */
const REST_VALUES: Record<string, string> = {
  dmg: '58',
  crit: '25%',
  spd: '16',
  fire: '22',
  molten: '—',
  echo: '—',
  shld: '64',
};

/** Post-fight strip: tick 3's contributions, shield recharged. */
const SETTLED_VALUES: Record<string, string> = {
  dmg: '88',
  crit: '×2.0',
  spd: '12',
  fire: '24',
  molten: '14',
  echo: '18',
  shld: '88',
};

/**
 * The kill tick's float cluster — shared by both scenes. The
 * crit total is born at the enemy plate (HP's seat) in crit
 * green; its anatomy is born at the strip seats and drifts
 * toward the enemy as it rises.
 */
const critCluster = (): Array<Omit<FloatSpec, 'id'>> => [
  { seat: 'enemy', kind: 'critTotal', text: '-156', tag: 'CRIT', color: FLOAT_COLORS.crit },
  { seat: 'dmg', kind: 'satellite', text: '-88', tag: 'DMG', color: FLOAT_COLORS.dmg, driftPx: 64 },
  { seat: 'fire', kind: 'satellite', text: '-24', tag: 'FIRE', color: FLOAT_COLORS.fire, driftPx: 18 },
  { seat: 'spd', kind: 'satellite', text: '-12', tag: 'SPD', color: FLOAT_COLORS.spd, driftPx: 42 },
  { seat: 'molten', kind: 'proc', text: '+14', tag: 'MOLTEN', color: FLOAT_COLORS.molten, driftPx: 6, delayMs: 150 },
  { seat: 'echo', kind: 'proc', text: '+18', tag: 'ECHO', color: FLOAT_COLORS.echo, driftPx: -14, delayMs: 200 },
];

/** The shipped DamageNumber this take replaces — hidden page-wide. */
const SHIPPED_NUMBER_OFF =
  '[data-testid="fx-damage-number"],[data-testid="fx-damage-number-crit"]{display:none!important}';

export const NumbersHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const killScene = params.get('scene') === 'kill';
  const procScene = params.get('scene') === 'proc';
  const [floats, setFloats] = useState<FloatSpec[]>([]);
  const [shield, setShield] = useState(killScene ? 88 : 64);
  const [values, setValues] = useState<Record<string, string>>(killScene ? SETTLED_VALUES : REST_VALUES);
  const [active, setActive] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<number[]>([]);

  const expireFloat = useCallback((id: number) => {
    setFloats((cur) => cur.filter((f) => f.id !== id));
  }, []);
  const spawn = useCallback((specs: Array<Omit<FloatSpec, 'id'>>) => {
    setFloats((cur) => [...cur, ...makeFloats(specs)]);
  }, []);

  useEffect(() => {
    useKillCycleStore.setState({
      currentTargetId: 'dustwaste_raider',
      currentTargetHp: ENEMY_MAX,
      currentTargetHpMax: ENEMY_MAX,
    });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    useLoadoutStore.getState().setSlot('vehicle', null);

    const later = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    /** Announce a beat on the strip: values land, seats light, then quiet. */
    const pulse = (seats: string[], patch: Record<string, string>, clearAfterMs = 1500) => {
      setValues((v) => ({ ...v, ...patch }));
      setActive((cur) => new Set([...cur, ...seats]));
      later(clearAfterMs, () =>
        setActive((cur) => {
          const next = new Set(cur);
          seats.forEach((s) => next.delete(s));
          return next;
        }),
      );
    };

    if (procScene) {
      // Proc-beat loop (capture staging, README-disclosed): the
      // tick-2 beat re-fires on a 2.8s cycle — fire, hold, reset
      // the wraith to 204, fire again — so a capture burst lands
      // inside the float window regardless of the pipeline's
      // variable frame-delivery lag. The stills are genuine
      // frames of the same beat the fight scene plays once.
      useKillCycleStore.setState({ currentTargetHp: 204 });
      const fireProc = () => {
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        useKillCycleStore.setState({ currentTargetHp: 100 });
        pulse(['dmg', 'fire', 'spd', 'molten'], { dmg: '52', fire: '18', spd: '14', molten: '20' });
        spawn([
          { seat: 'enemy', kind: 'total', text: '-104', color: FLOAT_COLORS.total },
          { seat: 'dmg', kind: 'satellite', text: '-52', tag: 'DMG', color: FLOAT_COLORS.dmg, driftPx: 64 },
          { seat: 'fire', kind: 'satellite', text: '-18', tag: 'FIRE', color: FLOAT_COLORS.fire, driftPx: 18 },
          { seat: 'spd', kind: 'satellite', text: '-14', tag: 'SPD', color: FLOAT_COLORS.spd, driftPx: 42 },
          { seat: 'molten', kind: 'proc', text: '+20', tag: 'MOLTEN', color: FLOAT_COLORS.molten, driftPx: 6, dy: -26 },
        ]);
      };
      let fired = false;
      const iv = window.setInterval(() => {
        if (!fired) {
          fireProc();
          fired = true;
        } else {
          useKillCycleStore.setState({ currentTargetHp: 204 });
          fired = false;
        }
      }, 1400);
      timers.current.push(iv);
      return () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
      };
    }

    if (killScene) {
      // Kill-drop composition: the kill has landed — the kill
      // cycle holds the wraith at 0 HP (anchoring the LootMoment
      // at the corpse spot) and the drop + crit cluster wait for
      // the capture script's start line. No timeline runs.
      useKillCycleStore.setState({ currentTargetHp: 0 });
      const w = window as unknown as Record<string, unknown>;
      w.__seedKillDrop = () => {
        seedBeatEvent({ tone: 'loot', label: 'Dustwaste Longshot', value: 1, gear: DROP_GEAR });
        spawn(critCluster());
        pulse(['dmg', 'crit', 'spd', 'fire', 'molten', 'echo'], {});
      };
      return () => {
        timers.current.forEach((t) => window.clearTimeout(t));
        timers.current = [];
      };
    }

    const at = later;

    const run = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      useKillCycleStore.setState({
        currentTargetId: 'dustwaste_raider',
        currentTargetHp: ENEMY_MAX,
        currentTargetHpMax: ENEMY_MAX,
      });
      useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
      useTickFeedStore.setState({ events: [] });
      setFloats([]);
      setShield(64);
      setValues(REST_VALUES);
      setActive(new Set());

      // ── Tick 1 — plain hit, 96 ─────────────────────────────
      at(1000, () => {
        seedBeatEvent({ tone: 'loot', label: '-96', value: 96 });
        useKillCycleStore.setState({ currentTargetHp: 204 });
        pulse(['dmg', 'fire', 'spd'], { dmg: '58', fire: '22', spd: '16' });
        spawn([
          { seat: 'enemy', kind: 'total', text: '-96', color: FLOAT_COLORS.total },
          { seat: 'dmg', kind: 'satellite', text: '-58', tag: 'DMG', color: FLOAT_COLORS.dmg, driftPx: 64 },
          { seat: 'fire', kind: 'satellite', text: '-22', tag: 'FIRE', color: FLOAT_COLORS.fire, driftPx: 18 },
          { seat: 'spd', kind: 'satellite', text: '-16', tag: 'SPD', color: FLOAT_COLORS.spd, driftPx: 42 },
        ]);
      });

      // ── Tick 2 — Molten Core procs, 104 ────────────────────
      at(4000, () => {
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        useKillCycleStore.setState({ currentTargetHp: 100 });
        pulse(['dmg', 'fire', 'spd', 'molten'], { dmg: '52', fire: '18', spd: '14', molten: '20' });
        spawn([
          { seat: 'enemy', kind: 'total', text: '-104', color: FLOAT_COLORS.total },
          { seat: 'dmg', kind: 'satellite', text: '-52', tag: 'DMG', color: FLOAT_COLORS.dmg, driftPx: 64 },
          { seat: 'fire', kind: 'satellite', text: '-18', tag: 'FIRE', color: FLOAT_COLORS.fire, driftPx: 18 },
          { seat: 'spd', kind: 'satellite', text: '-14', tag: 'SPD', color: FLOAT_COLORS.spd, driftPx: 42 },
          { seat: 'molten', kind: 'proc', text: '+20', tag: 'MOLTEN', color: FLOAT_COLORS.molten, driftPx: 6, dy: -26 },
        ]);
      });

      // ── The wraith's parting swipe — 40 raw ────────────────
      at(4700, () => {
        seedBeatEvent({ tone: 'damage', label: '-40', value: 40 });
        setShield(36);
        pulse(['shld'], { shld: '36' });
        spawn([
          { seat: 'hunter', kind: 'absorb', text: '-28', tag: 'SHLD', color: FLOAT_COLORS.shield, dx: -6 },
          { seat: 'hunter', kind: 'blocked', text: '12', tag: 'BLOCKED', color: FLOAT_COLORS.blocked, dx: 44, dy: 6, delayMs: 140 },
        ]);
      });

      // ── Regen tick — damage-free, shield recharges +52 ─────
      at(7000, () => {
        setShield(88);
        pulse(['shld'], { shld: '88' });
        spawn([
          { seat: 'hunter', kind: 'regen', text: '+52', tag: 'SHLD', color: FLOAT_COLORS.regen, tagColor: FLOAT_COLORS.shield },
        ]);
      });

      // ── Tick 3 — CRIT + both procs, 156, the kill ──────────
      at(10000, () => {
        seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
        useKillCycleStore.setState({ currentTargetHp: 0 });
        pulse(['dmg', 'crit', 'spd', 'fire', 'molten', 'echo'], SETTLED_VALUES);
        spawn(critCluster());
      });

      // ── The drop — the kill pays out ───────────────────────
      at(11600, () => {
        seedBeatEvent({ tone: 'loot', label: 'Dustwaste Longshot', value: 1, gear: DROP_GEAR });
        useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
      });
    };

    const w = window as unknown as Record<string, unknown>;
    w.__startNumbers = run;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      at(600, run);
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, [killScene, procScene, spawn]);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <style>{SHIPPED_NUMBER_OFF}</style>
      <div style={{ position: 'relative' }}>
        <LiveTurfDiorama
          area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
          weapon={FIXTURE_WEAPON}
          playerLevel={5}
          equippedCount={4}
          activityKind={killScene ? 'endless_run' : 'roaming_loot'}
        />
        <ReadoutStrip values={values} active={active} shield={shield} />
        <FloatLayer floats={floats} onExpire={expireFloat} />
      </div>
    </div>
  );
};
