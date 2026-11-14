import React, { useEffect, useRef, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { HeatChip, HeatStrip, StageHeat, satellite, type HeatSpot } from './HeatField';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useLoadoutStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

/**
 * HEAT FIELD — roam (THROWAWAY harness prototype, iter-09).
 * The REAL LiveTurfDiorama driven through the same stores the
 * production claim path feeds (the bars harness's exact timeline),
 * with an intensity field over the stage:
 *
 *   impact intensity = tick total / 156 (156 = the fixture's
 *   largest tick = FULL HEAT); one satellite hotspot per damage
 *   component, intensity = component / 156, radius by area
 *   (r = R * sqrt(intensity)). Between ticks the field cools
 *   (tau 1.1 s) toward zero — at rest there is no glow.
 *
 * Fixture (INDEX, verbatim): Wraith Scavenger (dustwaste_raider)
 * 300 HP; Hunter L5, Epic Fire sniper carbine.
 *   Tick 1: 96  (DMG 58 / FIRE 22 / SPD 16)          300 -> 204
 *   Tick 2: 104 (DMG 52 / FIRE 18 / SPD 14 / MOLTEN 20) 204 -> 100
 *           parting swipe: SHLD 64 -> 36, recharging toward 52
 *           (shield heat = 28 / 64 at the hunter)
 *   Tick 3: 156 CRIT (DMG 44 x2.0 = 88 / FIRE 24 / SPD 12 /
 *           MOLTEN 14 / ECHO 18) — the kill. Drop +1 TechFragments.
 *
 * Drive: window.__setBeat(n) jumps to a held beat (stills);
 * window.__startHeat() runs the full timeline live (clip).
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

const FULL = 156;
const ENEMY_MAX = 300;
const IMPACT = { x: 66, y: 50 }; // ROAM_ENEMY_PLACEMENT.xPct; torso height
const HUNTER = { x: 22, y: 55 };

let beatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  beatSeq += 1;
  const event = {
    id: `heat-beat-${beatSeq}`,
    at: Date.now(),
    detail: 'heat-harness',
    ...partial,
  } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

interface StripState {
  heat: number;
  chips: React.ReactNode;
}

const restChips = (
  <>
    <HeatChip label="CRIT" value="25% · ×2.0" />
    <HeatChip label="SHLD" value="64" />
    <HeatChip label="ENEMY HP" value="300 / 300" />
  </>
);

export const HeatRoamPage: React.FC = () => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [spots, setSpots] = useState<HeatSpot[]>([]);
  const [hold, setHold] = useState(true);
  const [strip, setStrip] = useState<StripState>({ heat: 0, chips: restChips });
  const timers = useRef<number[]>([]);

  useEffect(() => {
    useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: ENEMY_MAX, currentTargetHpMax: ENEMY_MAX });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    useLoadoutStore.getState().setSlot('vehicle', null);

    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms));
    const impactSet = (
      total: number,
      comps: Array<[string, number, number]>, // label, value, angle
      bornAt: number,
    ): HeatSpot[] => [
      { id: 'impact', xPct: IMPACT.x, yPct: IMPACT.y, peak: total / FULL, radius: 128, bornAt },
      ...comps.map(([label, v, ang]) =>
        satellite(`sat-${label}`, IMPACT.x, IMPACT.y, 15, ang, v / FULL, 72, bornAt),
      ),
    ];

    const applyTick1 = (bornAt: number) => {
      seedBeatEvent({ tone: 'loot', label: '-96', value: 96 });
      useKillCycleStore.setState({ currentTargetHp: 204 });
      setSpots(impactSet(96, [['DMG', 58, -55], ['FIRE', 22, 15], ['SPD', 16, 140]], bornAt));
      setStrip({
        heat: 96 / FULL,
        chips: (
          <>
            <HeatChip label="DMG" value="58" /> <HeatChip label="FIRE" value="22" />
            <HeatChip label="SPD" value="16" /> <HeatChip label="TOTAL" value="96" hot />
            <HeatChip label="ENEMY HP" value="300 → 204" />
          </>
        ),
      });
    };
    const applyTick2 = (bornAt: number) => {
      seedBeatEvent({ tone: 'loot', label: '-104', value: 104 });
      useKillCycleStore.setState({ currentTargetHp: 100 });
      setSpots(
        impactSet(104, [['DMG', 52, -70], ['FIRE', 18, -5], ['SPD', 14, 65], ['MOLTEN', 20, 150]], bornAt),
      );
      setStrip({
        heat: 104 / FULL,
        chips: (
          <>
            <HeatChip label="DMG" value="52" /> <HeatChip label="FIRE" value="18" />
            <HeatChip label="SPD" value="14" /> <HeatChip label="MOLTEN" value="20" hot />
            <HeatChip label="TOTAL" value="104" hot /> <HeatChip label="ENEMY HP" value="204 → 100" />
          </>
        ),
      });
    };
    const applySwipe = (bornAt: number) => {
      seedBeatEvent({ tone: 'damage', label: '-28', value: 28 });
      // tick 2's field has cooled for 0.7 s (tau 1.1 s): 0.667 * e^-0.64 = 0.35
      setSpots([
        { id: 'impact', xPct: IMPACT.x, yPct: IMPACT.y, peak: 0.35, radius: 128, bornAt: bornAt - 700 },
        { id: 'shield', xPct: HUNTER.x, yPct: HUNTER.y, peak: 28 / 64, radius: 92, bornAt },
      ]);
      setStrip({
        heat: 28 / 64,
        chips: (
          <>
            <HeatChip label="SHLD" value="64 → 36" hot /> <HeatChip label="RECHARGE" value="→ 52" />
            <HeatChip label="ENEMY HP" value="100 / 300" />
          </>
        ),
      });
    };
    const applyKill = (bornAt: number) => {
      seedBeatEvent({ tone: 'kill', label: '-156', value: 156 });
      useKillCycleStore.setState({ currentTargetHp: 0 });
      setSpots(
        impactSet(
          156,
          [['DMG', 88, -75], ['FIRE', 24, -15], ['SPD', 12, 45], ['MOLTEN', 14, 115], ['ECHO', 18, 170]],
          bornAt,
        ),
      );
      setStrip({
        heat: 1,
        chips: (
          <>
            <HeatChip label="DMG" value="44 ×2.0 = 88" hot /> <HeatChip label="FIRE" value="24" />
            <HeatChip label="SPD" value="12" /> <HeatChip label="MOLTEN" value="14" />
            <HeatChip label="ECHO" value="18" /> <HeatChip label="TOTAL" value="156" hot />
            <HeatChip label="ENEMY HP" value="156 → 0" />
          </>
        ),
      });
    };
    const applyDrop = () => {
      seedBeatEvent({ tone: 'material', label: '+1 TechFragments', value: 1 });
      setSpots([]);
      setStrip({
        heat: 0,
        chips: (
          <>
            <HeatChip label="DROP" value="+1 TechFragments" hot /> <HeatChip label="SHLD" value="52" />
            <HeatChip label="ENEMY HP" value="0 / 300" />
          </>
        ),
      });
    };
    const reset = () => {
      useKillCycleStore.setState({ currentTargetId: 'dustwaste_raider', currentTargetHp: ENEMY_MAX, currentTargetHpMax: ENEMY_MAX });
      useTickFeedStore.setState({ events: [] });
      setSpots([]);
      setStrip({ heat: 0, chips: restChips });
    };

    const w = window as unknown as Record<string, unknown>;
    w.__setBeat = (n: number) => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setHold(true);
      reset();
      const now = performance.now();
      if (n === 1) applyTick1(now);
      else if (n === 2) applyTick2(now);
      else if (n === 3) {
        applyTick2(now - 700);
        applySwipe(now);
      } else if (n === 4) applyKill(now);
      else if (n === 5) {
        applyKill(now - 1600);
        applyDrop();
      }
    };
    w.__startHeat = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setHold(false);
      reset();
      at(1000, () => applyTick1(performance.now()));
      at(4000, () => applyTick2(performance.now()));
      at(4700, () => applySwipe(performance.now()));
      at(7000, () => applyKill(performance.now()));
      at(8600, () => applyDrop());
      at(10600, () => {
        useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
        useTickFeedStore.setState({ events: [] });
      });
    };
    if (new URLSearchParams(window.location.search).get('auto') === '1') {
      at(600, () => (w.__startHeat as () => void)());
    }
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  return (
    <div style={{ width: 412, margin: '0 auto', background: '#050608', padding: '12px 12px 24px', boxSizing: 'border-box' }}>
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <LiveTurfDiorama
          area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
          weapon={FIXTURE_WEAPON}
          playerLevel={5}
          equippedCount={4}
          activityKind="roaming_loot"
        />
        <StageHeat wrapRef={wrapRef} spots={spots} hold={hold} tauMs={1100} />
      </div>
      <HeatStrip intensity={strip.heat} scaleLabel="FULL = 156">
        {strip.chips}
      </HeatStrip>
    </div>
  );
};
