import React, { useEffect, useState } from 'react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useTickFeedStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

/**
 * Roam harness (dev-only page, served by the Vite dev server at
 * /roam-harness.html — never part of the production bundle).
 * Drives the REAL LiveTurfDiorama through a scripted, seeded roam
 * state so the DOM and Pixi renderers show the identical scene for
 * the M2 before/after captures:
 *
 *   ?renderer=dom|pixi   dom forces the fallback (the harness hides
 *                        WebGL from detectWebGL before mount);
 *                        pixi leaves detection alone.
 *   ?scene=idle|tick|loot   the seeded moment:
 *                        idle — enemy present, no beat;
 *                        tick — a shot beat lands and HOLDS (the
 *                        capture script advances frames itself);
 *                        loot — a material drop: the loot rise is
 *                        live over the stage.
 *                        travel — (M2b) the travel beat staged for
 *                        scripting: the page exposes
 *                        __advanceTarget (kill gap → next enemy:
 *                        the between-enemy advance), __stopRoam
 *                        (activity cleared mid-stride: the Stop
 *                        interrupt) and __resumeRoam.
 *   ?width=<px>          stage width (default 390, phone width).
 *
 * The event is seeded into the tick feed BEFORE the diorama mounts
 * and never advances, so both renderers stage the same beat from
 * the same event id; the fps probe surface mirrors the pilot's
 * (__fpsDeltas) plus the roam stage's own __cybercacheRoamPixiStage.
 */

const HARNESS_WEAPON: Weapon = {
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

const SHOT_EVENT: TickEvent = {
  id: 'harness-shot-1',
  at: 1,
  tone: 'loot',
  label: '-10',
  detail: 'harness',
  value: 10,
} as TickEvent;

const LOOT_EVENT: TickEvent = {
  id: 'harness-loot-1',
  at: 1,
  tone: 'material',
  label: '+1 TechFragments',
  detail: 'harness',
  value: 1,
} as TickEvent;

// Anim-replay seams (Track A, 2026-11-10): the beat classifier
// (classifyTickBeat) reads tone/label/value, so a beat of any kind
// is one seeded feed event. The replay driver needs unique ids per
// beat (the stage clock keys on event id) and a material-drop
// variant — shipped loot events carry tone 'loot' WITH a gear
// payload (the rise), while a plain material drop is a rarity
// beam with no card. Kill beats also drop the target's HP to 0,
// the way the real kill cycle lands.
let replayBeatSeq = 0;
const seedBeatEvent = (partial: Partial<TickEvent>) => {
  replayBeatSeq += 1;
  const event = {
    id: `harness-beat-${replayBeatSeq}`,
    at: Date.now(),
    detail: 'harness',
    ...partial,
  } as TickEvent;
  useTickFeedStore.setState({ events: [event] });
};

export const RoamHarnessPage: React.FC = () => {
  const [params] = useState(() => new URLSearchParams(window.location.search));
  const scene = params.get('scene') ?? 'idle';
  const width = Number(params.get('width') ?? 390) || 390;
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    const deltas: number[] = [];
    w.__fpsDeltas = deltas;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      deltas.push(now - last);
      if (deltas.length > 3600) deltas.shift();
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    useKillCycleStore.setState({
      currentTargetId: 'dustwaste_raider',
      currentTargetHp: 80,
      currentTargetHpMax: 100,
    });
    useSurvivalStore.setState({ currentHp: 72, maxHp: 100 });
    useTickFeedStore.setState({ events: [] });
    // The capture script seeds the beat AFTER the stage is ready,
    // so the beat clock and the screenshot share a start line —
    // mid-beat frames are true pairs across renderers.
    const w = window as unknown as Record<string, unknown>;
    w.__seedShot = () => useTickFeedStore.setState({ events: [SHOT_EVENT] });
    w.__seedLoot = () => useTickFeedStore.setState({ events: [LOOT_EVENT] });
    // M2b travel scripting: the between-enemy advance (the kill
    // gap, then the next target spawns — the ticker's own shape)
    // and the Stop interrupt (the activity clears mid-stride and
    // the diorama falls back to the camp idle scene).
    w.__advanceTarget = () => {
      useKillCycleStore.setState({ currentTargetId: null, currentTargetHp: 0, currentTargetHpMax: 0 });
      setTimeout(() => {
        useKillCycleStore.setState({ currentTargetId: 'dustwaste_drone', currentTargetHp: 60, currentTargetHpMax: 60 });
      }, 60);
    };
    // F6 rig-swap scripting: set the roam target directly (any
    // archetype, back-to-back) so the capture can drive target
    // changes against the mounted Pixi stage and read back which
    // enemy art the stage actually shows (__cybercacheRoamPixiStage
    // .enemyRig).
    w.__setTarget = (id: string, hp = 80, max = 100) => {
      useKillCycleStore.setState({ currentTargetId: id, currentTargetHp: hp, currentTargetHpMax: max });
    };
    w.__stopRoam = () => setStopped(true);
    w.__resumeRoam = () => setStopped(false);
    // Anim-replay beat seams: one call per beat kind, unique event
    // id each time so the stage's beat clock restarts per beat.
    //   shot/crit — tone 'loot' with a negative label is the hit
    //     shape (isTickHit); crit weighs value vs target max HP.
    //   playerHit — tone 'damage' (the enemy answers).
    //   kill — tone 'kill' + the target's HP lands at 0.
    //   drop — tone 'material' (a rarity beam, no gear card).
    w.__seedBeat = (kind: string, value = 10) => {
      if (kind === 'shot') seedBeatEvent({ tone: 'loot', label: `-${value}`, value });
      else if (kind === 'crit') seedBeatEvent({ tone: 'loot', label: `-${value}`, value });
      else if (kind === 'playerHit') seedBeatEvent({ tone: 'damage', label: `-${value}`, value });
      else if (kind === 'kill') {
        seedBeatEvent({ tone: 'kill', label: 'kill', value });
        useKillCycleStore.setState({ currentTargetHp: 0 });
      } else if (kind === 'drop') seedBeatEvent({ tone: 'material', label: '+1 TechFragments', value: 1 });
    };
  }, [scene]);

  return (
    <div style={{ width, margin: '24px auto', background: '#050608', padding: 12 }}>
      <LiveTurfDiorama
        area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)}
        weapon={HARNESS_WEAPON}
        playerLevel={5}
        equippedCount={4}
        activityKind={stopped ? undefined : 'roaming_loot'}
      />
    </div>
  );
};
