import React, { useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { BuildAnalyzerBand, bandRestFrame, BAND_REST, type BandFrame } from './BuildAnalyzerBand';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { GearItem, TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

/**
 * Build Analyzer roam mock (THROWAWAY rendering prototype,
 * 2026-11-13 — harness only). The REAL LiveTurfDiorama at phone
 * width, driven through the same stores the production claim path
 * feeds, with the Build Analyzer band seated under the stage.
 *
 * Fixture fight (scripted presentation — no combat math):
 *   Enemy: Wraith Scavenger (dustwaste_raider), 300 HP.
 *   Hunter: L5, Epic Fire sniper carbine (the roam harness weapon).
 *   Build: DMG · CRIT 25% · SPD · FIRE · Molten Core · Echo
 *   Chamber · SHLD 64.
 *   Tick 1 (t+1.0s): plain hit, 96 total — DMG 58 / FIRE 22 /
 *     SPD 16. Enemy 300 → 204.
 *   Tick 2 (t+4.0s): Molten Core procs, 104 total — DMG 52 /
 *     FIRE 18 / SPD 14 / MOLTEN 20. Enemy 204 → 100. At t+4.7s
 *     the wraith's parting swipe lands on the shield: SHLD
 *     64 → 36, then recharges toward 52.
 *   Tick 3 (t+7.0s): CRIT + both procs, 156 total — the kill.
 *     DMG 44 ×2.0 = 88 / FIRE 24 / SPD 12 / MOLTEN 14 / ECHO 18.
 *     Every bar slams; the wraith dissolves. At t+8.6s the kill
 *     pays out: a gear-drop event (the shipped LootMoment) seeds
 *     in the same beat the kill cycle clears, the way a real
 *     claim advances — and the timeline ENDS on the drop hold.
 *     No material beat follows to revive the corpse's beat state,
 *     no feed clear, no loop, no next encounter.
 *
 * Drive: window.__startBars() runs the timeline; ?auto=1 runs it
 * once after mount. ?scene=drop mounts the drop-hold composition
 * directly: the stage in endless mode (the one stage mode whose
 * enemy slot is never populated — the roaming stage always seats
 * an actor: the target at rest on a loot beat, or the brute
 * fallback on a null target), the kill cycle holding the wraith
 * at 0 HP so the LootMoment anchors at the corpse spot, the band
 * settled post-fight, and window.__seedDrop() seeding the drop
 * event on the capture script's start line (the moment unmounts
 * when its celebration completes, so the seed must share the
 * screenshot's clock).
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

const ENEMY_MAX = 300;
void DropSource;

/**
 * The kill's payout: an Epic Fire sniper, in the flat rolled-field
 * shape shipped gear-drop events carry (gearDropFromEvent reads
 * the flat fields — a baseStats-only object throws in
 * weaponStatFigures and unmounts the stage).
 */
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

let beatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  const event = {
    id: `bars-beat-${beatSeq}`,
    at: Date.now(),
    detail: 'bars-harness',
    ...partial,
  } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

export const BarsHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const dropScene = params.get('scene') === 'drop';
  // The drop-hold composition opens on the band's settled
  // post-fight state: rest levels, shield at its recharged 52.
  const [frame, setFrame] = useState<BandFrame>(() =>
    dropScene
      ? { ...bandRestFrame(), levels: { ...BAND_REST, shield: 52 } }
      : bandRestFrame(),
  );
  const timers = useRef<number[]>([]);

  useEffect(() => {
    useKillCycleStore.setState({
      currentTargetId: 'dustwaste_raider',
      currentTargetHp: ENEMY_MAX,
      currentTargetHpMax: ENEMY_MAX,
    });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    // Keep the loadout's vehicle slot empty: no parked vehicle in
    // this fixture.
    useLoadoutStore.getState().setSlot('vehicle', null);

    if (dropScene) {
      // Drop-hold composition: the kill has landed — the kill
      // cycle holds the wraith at 0 HP (its sprite anchors the
      // LootMoment at the corpse spot) and the drop event waits
      // for the capture script's start line. No timeline runs.
      useKillCycleStore.setState({ currentTargetHp: 0 });
      const w = window as unknown as Record<string, unknown>;
      w.__seedDrop = () =>
        seedBeatEvent({ tone: 'loot', label: 'Dustwaste Longshot', value: 1, gear: DROP_GEAR });
      return;
    }

    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    const setBand = (patch: Partial<BandFrame>) => setFrame((f) => ({ ...f, ...patch }));
    const setLevels = (levels: Partial<BandFrame['levels']>) =>
      setFrame((f) => ({ ...f, levels: { ...f.levels, ...levels } }));

    const run = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      // reset the fight
      useKillCycleStore.setState({
        currentTargetId: 'dustwaste_raider',
        currentTargetHp: ENEMY_MAX,
        currentTargetHpMax: ENEMY_MAX,
      });
      useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
      useTickFeedStore.setState({ events: [] });
      setFrame(bandRestFrame());

      // ── Tick 1 — plain hit, 96 ─────────────────────────────
      at(1000, () => {
        seedBeatEvent({ tone: 'loot', label: '-96', value: 96 });
        useKillCycleStore.setState({ currentTargetHp: 204 });
        setBand({
          phase: 'surge',
          levels: { ...BAND_REST, dmg: 60, spd: 17, fire: 23 },
          values: { dmg: '58', fire: '22', spd: '16' },
        });
      });
      at(2100, () => setBand({ phase: 'drain', levels: { ...BAND_REST }, values: {} }));

      // ── Tick 2 — Molten Core procs, 104 ────────────────────
      at(4000, () => {
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        useKillCycleStore.setState({ currentTargetHp: 100 });
        setBand({
          phase: 'surge',
          flashMolten: true,
          levels: { ...BAND_REST, dmg: 50, spd: 13, fire: 17, molten: 100 },
          values: { dmg: '52', fire: '18', spd: '14', molten: '20' },
        });
      });
      at(4500, () => setLevels({ molten: 19 }));
      at(4600, () => setBand({ flashMolten: false }));
      // the wraith's parting swipe lands on the shield
      at(4700, () => {
        seedBeatEvent({ tone: 'damage', label: '-6', value: 6 });
        setBand({ shieldPhase: 'drain' });
        setLevels({ shield: 36 });
      });
      at(5100, () => setBand({ phase: 'drain', levels: { ...BAND_REST, shield: 36 }, values: {}, shieldPhase: 'recharge' }));
      at(5400, () => setLevels({ shield: 52 }));

      // ── Tick 3 — CRIT + both procs, 156, the kill ──────────
      at(7000, () => {
        seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
        useKillCycleStore.setState({ currentTargetHp: 0 });
        setBand({
          phase: 'slam',
          critFlare: true,
          flashMolten: true,
          flashEcho: true,
          shieldPhase: 'hold',
          levels: { dmg: 100, crit: 112, spd: 100, fire: 100, molten: 100, echo: 100, shield: 52 },
          values: { dmg: '88', crit: '×2.0', fire: '24', spd: '12', molten: '14', echo: '18' },
        });
      });
      at(7350, () => setLevels({ crit: 100 }));
      at(7700, () => setBand({ critFlare: false, flashMolten: false, flashEcho: false }));
      at(8300, () => {
        setBand({ phase: 'drain', levels: { ...BAND_REST, shield: 52 }, values: {} });
      });

      // ── The drop — the kill pays out ───────────────────────
      // A production-shaped gear-drop event (tone 'loot' + gear:
      // the shipped LootMoment) in the same beat the kill cycle
      // clears, the way a real claim advances. Nothing follows:
      // no material beat to revive the corpse's beat state, no
      // feed clear, no next encounter — the timeline ends here,
      // holding the drop.
      at(8600, () => {
        seedBeatEvent({ tone: 'loot', label: 'Dustwaste Longshot', value: 1, gear: DROP_GEAR });
        useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
      });
    };

    const w = window as unknown as Record<string, unknown>;
    w.__startBars = run;
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      at(600, run);
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <LiveTurfDiorama
        area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
        weapon={FIXTURE_WEAPON}
        playerLevel={5}
        equippedCount={4}
        activityKind={dropScene ? 'endless_run' : 'roaming_loot'}
      />
      <BuildAnalyzerBand frame={frame} />
    </div>
  );
};
