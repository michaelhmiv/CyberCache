import React, { useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { RacePair } from './RacePair';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

/**
 * Quota Race — roam (THROWAWAY rendering prototype, 2026-11-13,
 * harness only). The REAL LiveTurfDiorama with a two-bar race
 * seated under the stage. INDEX combat fixture, verbatim:
 *   Wraith Scavenger 300 HP · Hunter L5 · Epic Fire sniper carbine
 *   Tick 1: 96  = DMG 58 · FIRE 22 · SPD 16        (300 → 204)
 *   Tick 2: 104 = DMG 52 · FIRE 18 · SPD 14 · MOLTEN 20 (204 → 100)
 *           parting swipe: SHLD 64 → 36, recharging toward 52
 *   Tick 3: 156 = DMG 44 ×2.0 = 88 · FIRE 24 · SPD 12 · MOLTEN 14 ·
 *           ECHO 18 — the kill. Drop +1 TechFragments.
 *   Crit 25%, ×2.0.
 *
 * THE RACE: your cumulative damage dealt (0 → 96 → 200 → 300)
 * climbs toward the 300 quota while the enemy's HP remaining
 * drains down the same track (300 → 204 → 100 → 0). The two bars
 * are exact mirrors — every point of damage dealt is a point of
 * HP gone — so the race visual is the convergence itself: the
 * bars meet at the kill. Both labeled with real values per beat.
 * The shield swipe is carried in the detail line (it is not one
 * of the two racers; see README omissions).
 *
 * Drive: window.__startRace() runs the timeline; window
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

let beatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  const event = {
    id: `race-beat-${beatSeq}`,
    at: Date.now(),
    detail: 'race-harness',
    ...partial,
  } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

interface RaceState {
  dealt: number;
  hp: number;
  status: string;
  detail: string;
  hot: 'top' | 'bottom' | null;
}

const REST: RaceState = {
  dealt: 0, hp: 300,
  status: 'AT THE LINE — NO DAMAGE YET',
  detail: 'BUILD: CRIT 25% · CRIT ×2.0 · EPIC FIRE SNIPER CARBINE',
  hot: null,
};
const SURGE: RaceState = {
  dealt: 200, hp: 100,
  status: 'CONVERGING — 200 DEALT · 100 TO GO',
  detail: 'T2 104 = DMG 52 · FIRE 18 · SPD 14 · MOLTEN 20 (MOLTEN CORE) · SHLD 64 → 36 → 52',
  hot: 'top',
};
const KILL: RaceState = {
  dealt: 300, hp: 0,
  status: 'FINISH — BARS MEET AT THE KILL · +1 TECH FRAGMENTS',
  detail: 'T3 CRIT 156 = DMG 44 ×2.0 = 88 · FIRE 24 · SPD 12 · MOLTEN 14 · ECHO 18 (ECHO CHAMBER)',
  hot: 'top',
};

export const RoamRacePage: React.FC = () => {
  const [race, setRace] = useState<RaceState>(REST);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: ENEMY_MAX, currentTargetHpMax: ENEMY_MAX });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    useLoadoutStore.getState().setSlot('vehicle', null);

    const at = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };

    const setBeat = (beat: string) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      if (beat === 'rest') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: ENEMY_MAX, currentTargetHpMax: ENEMY_MAX });
        useTickFeedStore.setState({ events: [] });
        setRace(REST);
      } else if (beat === 'surge') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 100, currentTargetHpMax: ENEMY_MAX });
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        setRace(SURGE);
      } else if (beat === 'kill') {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: 0, currentTargetHpMax: ENEMY_MAX });
        seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
        setRace(KILL);
      }
    };

    const run = () => {
      setBeat('rest');
      at(1000, () => {
        seedBeatEvent({ tone: 'loot', label: '-96', value: 96 });
        useKillCycleStore.setState({ currentTargetHp: 204 });
        setRace({
          dealt: 96, hp: 204,
          status: 'RACING — 96 DEALT · 204 TO GO',
          detail: 'T1 96 = DMG 58 · FIRE 22 · SPD 16',
          hot: 'top',
        });
      });
      at(3200, () => {
        seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
        useKillCycleStore.setState({ currentTargetHp: 100 });
        setRace(SURGE);
      });
      at(5400, () => {
        seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
        useKillCycleStore.setState({ currentTargetHp: 0 });
        setRace(KILL);
      });
      at(7000, () => seedBeatEvent({ tone: 'material', label: '+1 TechFragments', value: 1 }));
      at(9200, () => {
        useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
        useTickFeedStore.setState({ events: [] });
        setRace(REST);
      });
    };

    const w = window as unknown as Record<string, unknown>;
    w.__startRace = run;
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
      <RacePair
        testId="roam-race-pair"
        quotaText="QUOTA 300 — THE KILL"
        top={{ label: 'YOUR DAMAGE DEALT', valueText: `${race.dealt} / 300`, frac: race.dealt / ENEMY_MAX, color: '#FFD23C', hot: race.hot === 'top' }}
        bottom={{ label: 'ENEMY HP REMAINING', valueText: `${race.hp} / 300`, frac: race.hp / ENEMY_MAX, color: '#F87171', hot: race.hot === 'bottom' }}
        status={race.status}
        detail={race.detail}
      />
    </div>
  );
};
