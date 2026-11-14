import React, { useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { GaugeCluster, type GaugeSpec } from './GaugeCluster';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

/**
 * Gauge Cluster — roam (THROWAWAY rendering prototype, 2026-11-13,
 * harness only). The REAL LiveTurfDiorama with an analog needle
 * cluster seated under the stage. Same scripted fixture as the
 * bars harness (INDEX combat fixture, verbatim):
 *   Wraith Scavenger 300 HP · Hunter L5 · Epic Fire sniper carbine
 *   Tick 1: 96  = DMG 58 · FIRE 22 · SPD 16        (300 → 204)
 *   Tick 2: 104 = DMG 52 · FIRE 18 · SPD 14 · MOLTEN 20 (204 → 100)
 *           parting swipe: SHLD 64 → 36, recharging toward 52
 *   Tick 3: 156 = DMG 44 ×2.0 = 88 · FIRE 24 · SPD 12 · MOLTEN 14 ·
 *           ECHO 18 — the kill. Drop +1 TechFragments.
 *
 * The four dials (selectivity, stated in the iteration README):
 *   DMG / TICK — the tick total on a 0–156 scale (the fixture's own
 *     largest tick is the scale's full stop; no invented ceiling).
 *   CRIT SHARE — crit damage as a share of the tick. Rest position
 *     is the build's real crit chance, 25% — the red tick sits at
 *     that same 25%: the line the needle must cross for a tick to
 *     be crit-led. Tick 3: 88/156 = 56%.
 *   FIRE SHARE — elemental (FIRE) share of the tick: 23% / 17% / 15%.
 *   SHLD — shield charge on its own 0–64 scale (fixture max 64):
 *     64 → 36 on the swipe, recharging toward 52.
 * SPD / MOLTEN / ECHO get no dials — see README omissions.
 *
 * Drive: window.__startGauges() runs the timeline; window
 * .__setBeat('rest'|'surge'|'kill') jumps to a settled beat for
 * stills; ?auto=1 runs the timeline once after mount.
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

let beatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  const event = {
    id: `gauges-beat-${beatSeq}`,
    at: Date.now(),
    detail: 'gauges-harness',
    ...partial,
  } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

interface ClusterState {
  dmg: number; // frac of 156
  dmgText: string;
  crit: number; // frac
  critText: string;
  fire: number;
  fireText: string;
  shield: number; // value on 0..64 scale
  hot: string | null;
}

const REST: ClusterState = { dmg: 0, dmgText: '0', crit: 0.25, critText: '25%', fire: 0, fireText: '0%', shield: 64, hot: null };
const TICK1: ClusterState = { dmg: 96 / 156, dmgText: '96', crit: 0, critText: '0%', fire: 22 / 96, fireText: '23%', shield: 64, hot: 'dmg' };
const TICK2: ClusterState = { dmg: 104 / 156, dmgText: '104', crit: 0, critText: '0%', fire: 18 / 104, fireText: '17%', shield: 64, hot: 'dmg' };
const KILL: ClusterState = { dmg: 1, dmgText: '156', crit: 88 / 156, critText: '56%', fire: 24 / 156, fireText: '15%', shield: 52, hot: 'crit' };

const toGauges = (s: ClusterState): GaugeSpec[] => [
  { key: 'dmg', label: 'DMG / TICK', frac: s.dmg, display: s.dmgText, color: '#FFD23C', hot: s.hot === 'dmg', ticks: [{ at: 0.25 }, { at: 0.5 }, { at: 0.75 }] },
  {
    key: 'crit', label: 'CRIT SHARE', frac: s.crit, display: s.critText, color: '#FF4D2E', hot: s.hot === 'crit',
    ticks: [{ at: 0.25, red: true }, { at: 0.5 }, { at: 0.75 }],
  },
  { key: 'fire', label: 'FIRE SHARE', frac: s.fire, display: s.fireText, color: '#FF7A1A', hot: s.hot === 'fire', ticks: [{ at: 0.25 }, { at: 0.5 }, { at: 0.75 }] },
  { key: 'shield', label: 'SHLD', frac: s.shield / 64, display: String(s.shield), color: '#6EC1FF', hot: s.hot === 'shield', ticks: [{ at: 0.5 }], k: 60, d: 12 },
];

export const RoamGaugesPage: React.FC = () => {
  const [cluster, setCluster] = useState<ClusterState>(REST);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: ENEMY_MAX, currentTargetHpMax: ENEMY_MAX });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    useLoadoutStore.getState().setSlot('vehicle', null);

    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    const patch = (p: Partial<ClusterState>) => setCluster((c) => ({ ...c, ...p }));

    const setBeat = (beat: string) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      if (beat === 'rest') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: ENEMY_MAX, currentTargetHpMax: ENEMY_MAX });
        useTickFeedStore.setState({ events: [] });
        setCluster(REST);
      } else if (beat === 'surge') {
        // Tick 2 settled + the parting swipe already on the shield.
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 100, currentTargetHpMax: ENEMY_MAX });
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        setCluster({ ...TICK2, shield: 36, hot: 'shield' });
      } else if (beat === 'kill') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 0, currentTargetHpMax: ENEMY_MAX });
        seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
        setCluster(KILL);
      }
    };

    const run = () => {
      setBeat('rest');
      at(1000, () => {
        seedBeatEvent({ tone: 'loot', label: '-96', value: 96 });
        useKillCycleStore.setState({ currentTargetHp: 204 });
        setCluster(TICK1);
      });
      at(2300, () => patch({ dmg: 0, dmgText: '0', crit: 0.25, critText: '25%', fire: 0, fireText: '0%', hot: null }));
      at(4000, () => {
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        useKillCycleStore.setState({ currentTargetHp: 100 });
        setCluster(TICK2);
      });
      at(4700, () => {
        seedBeatEvent({ tone: 'damage', label: '-6', value: 6 });
        patch({ shield: 36, hot: 'shield' });
      });
      at(5400, () => patch({ shield: 52, hot: null }));
      at(5600, () => patch({ dmg: 0, dmgText: '0', crit: 0.25, critText: '25%', fire: 0, fireText: '0%' }));
      at(7000, () => {
        seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
        useKillCycleStore.setState({ currentTargetHp: 0 });
        setCluster(KILL);
      });
      at(8600, () => seedBeatEvent({ tone: 'material', label: '+1 TechFragments', value: 1 }));
      at(10600, () => {
        useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
        useTickFeedStore.setState({ events: [] });
        patch({ dmg: 0, dmgText: '0', crit: 0.25, critText: '25%', fire: 0, fireText: '0%', hot: null });
      });
    };

    const w = window as unknown as Record<string, unknown>;
    w.__startGauges = run;
    w.__setBeat = setBeat;
    if (new URLSearchParams(window.location.search).get('auto') === '1') at(600, run);
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
        activityKind="roaming_loot"
      />
      <GaugeCluster gauges={toGauges(cluster)} testId="roam-gauge-cluster" />
    </div>
  );
};
