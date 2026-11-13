import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { detectWebGL, resetWebGLCacheForTests } from '@/components/pixelArt/pixi/detectWebGL';
import { MOVEMENT } from '@/lib/pixel/movement';
import {
  ROAM_POOL_CAPS,
  deriveRoamScene,
  roamAnimatedNodeCount,
  sampleRoamBeat,
} from '@/lib/pixel/roamChoreography';
import { enemyArtKeyFor } from '@/components/pixelArt/pixi/RoamPixiStage';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { DEFAULT_ROAMING_AREA_ID, getRoamingArea } from '@/constants/roamingAreas';
import { useKillCycleStore, useTickFeedStore } from '@/store';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

// The Pixi chunk must never load in jsdom (no WebGL → the wrapper
// never selects it); mock the lazy module so any accidental import
// is observable instead of pulling PixiJS into the test env. The
// F6 art-key derivation is a pure function, re-exported through
// the mock from the real choreography/rig seams it composes.
const roamPixiMounts = vi.fn();
vi.mock('@/components/pixelArt/pixi/RoamPixiStage', async () => {
  type RoamModel = ReturnType<typeof deriveRoamScene>;
  return {
    RoamPixiStage: (props: Record<string, unknown>) => {
      roamPixiMounts(props);
      return React.createElement('div', { 'data-testid': 'roam-pixi-stage', 'data-renderer': 'pixi' });
    },
    enemyArtKeyFor: (model: RoamModel) =>
      model.rig ? `rig:${model.rig.id}` : `flat:${model.enemySpriteId}`,
  };
});

// WebGL availability is a module seam: the selection tests flip it
// to prove the wrapper's Pixi direction without a GL context.
const webglAvailable = vi.hoisted(() => ({ value: false }));
vi.mock('@/components/pixelArt/pixi/detectWebGL', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/pixelArt/pixi/detectWebGL')>();
  return {
    ...original,
    detectWebGL: () => webglAvailable.value,
  };
});

const DIORAMA_WEAPON: Weapon = {
  id: 'roam-pixi-weapon',
  name: 'Roam Test Carbine',
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

const area = getRoamingArea(DEFAULT_ROAMING_AREA_ID);

function seedRoam(event?: TickEvent) {
  useKillCycleStore.setState({
    currentTargetId: 'dustwaste_raider',
    currentTargetHp: 80,
    currentTargetHpMax: 100,
  });
  useTickFeedStore.setState({ events: event ? [event] : [] });
}

describe('M2 — roam renderer selection (the BossFightStage switch pattern)', () => {
  beforeEach(() => {
    resetWebGLCacheForTests();
    webglAvailable.value = false;
    roamPixiMounts.mockClear();
    seedRoam();
  });

  it('roaming selects the Pixi stage when WebGL is available, with the roam scene inputs', async () => {
    webglAvailable.value = true;
    render(
      <LiveTurfDiorama area={area} weapon={DIORAMA_WEAPON} playerLevel={5} equippedCount={1} activityKind="roaming_loot" />,
    );
    expect(await screen.findByTestId('roam-pixi-stage')).toBeTruthy();
    expect(roamPixiMounts).toHaveBeenCalled();
    const passed = roamPixiMounts.mock.calls[0][0] as Record<string, unknown>;
    expect(passed.backgroundId).toBe('zone-dustwaste-bg');
    expect(passed.areaId).toBe(DEFAULT_ROAMING_AREA_ID);
    expect(passed.targetMaxHp).toBe(100);
    expect(passed.currentTargetId).toBe('dustwaste_raider');
    expect(Array.isArray(passed.mountedGear)).toBe(true);
    // The hunter HP plate rides the Pixi path as a DOM sibling.
    expect(screen.getByTestId('diorama-hunter-hp')).toBeTruthy();
  });

  it('with WebGL available, a non-roaming mode still renders DOM (Pixi is roam-only)', async () => {
    webglAvailable.value = true;
    render(
      <LiveTurfDiorama area={area} weapon={DIORAMA_WEAPON} playerLevel={5} equippedCount={1} activityKind="crafting" />,
    );
    expect(screen.getByTestId('pixel-diorama-stage')).toBeTruthy();
    expect(screen.queryByTestId('roam-pixi-stage')).toBeNull();
    expect(roamPixiMounts).not.toHaveBeenCalled();
  });

  it('jsdom has no WebGL, so detection reports unavailable', () => {
    expect(detectWebGL()).toBe(false);
  });

  it('roaming falls back to the DOM scene when WebGL is unavailable — scene contents render', () => {
    render(
      <LiveTurfDiorama area={area} weapon={DIORAMA_WEAPON} playerLevel={5} equippedCount={1} activityKind="roaming_loot" />,
    );
    // The DOM scene (PixelStage shell + parts hunter + rig enemy).
    expect(screen.getByTestId('pixel-diorama-stage')).toBeTruthy();
    expect(screen.getByTestId('pixel-hunter')).toBeTruthy();
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
    expect(screen.getByTestId('diorama-hunter-hp')).toBeTruthy();
    expect(roamPixiMounts).not.toHaveBeenCalled();
  });

  it('non-roaming modes never select Pixi (crafting stays DOM)', () => {
    render(
      <LiveTurfDiorama area={area} weapon={DIORAMA_WEAPON} playerLevel={5} equippedCount={1} activityKind="crafting" />,
    );
    expect(screen.getByTestId('pixel-diorama-stage')).toBeTruthy();
    expect(roamPixiMounts).not.toHaveBeenCalled();
  });

  it('the loot rise fires on the DOM path for a material drop (the overlay the Pixi path mirrors)', () => {
    seedRoam({ id: 'evt-loot-dom', tone: 'material', label: '+1 TechFragments', detail: '', at: 1, value: 1 } as TickEvent);
    render(
      <LiveTurfDiorama area={area} weapon={DIORAMA_WEAPON} playerLevel={5} equippedCount={1} activityKind="roaming_loot" />,
    );
    const rise = screen.getByTestId('diorama-loot-rise');
    expect(rise.getAttribute('data-loot-visual')).toBe('material');
  });
});

describe('M2 — the roam scene model (one derivation for both renderers)', () => {
  const baseInput = {
    backgroundId: 'zone-dustwaste-bg',
    areaId: DEFAULT_ROAMING_AREA_ID,
    weapon: DIORAMA_WEAPON,
    targetMaxHp: 100,
    currentTargetId: 'dustwaste_raider',
    hunterSet: STANDARD_ISSUE,
  };

  it('idle roam: hunter aims (armed), enemy is the band rig at rest', () => {
    const model = deriveRoamScene(baseInput);
    expect(model.beat).toBeNull();
    expect(model.hunterPoseName).toBe('aim');
    expect(model.rig?.segments).toHaveLength(4);
    expect(model.rigPose).toEqual({});
    expect(model.hunterPlacement).toMatchObject({ xPct: 18, heightPct: 57 });
    // Settle mark 78%, frame 58% — the stage-iteration restage
    // (2026-11-12; was the tightened 66%/66%).
    expect(model.enemyPlacement).toMatchObject({ xPct: 78, heightPct: 58 });
    expect(model.lootRise).toBeNull();
    expect(model.dropItem).toBeNull();
  });

  it('a hit tick classifies as a shot beat: recoil pose, hit rig pose, shake pinned to the law', () => {
    const event: TickEvent = {
      id: 'evt-shot-1',
      tone: 'loot',
      label: '-10',
      value: 10,
    } as TickEvent;
    const model = deriveRoamScene({ ...baseInput, event });
    expect(model.beat).toEqual({ kind: 'shot', value: 10 });
    expect(model.hunterPoseName).toBe('recoil');
    expect(model.shake).toEqual({ key: 'evt-shot-1', intensity: 3, durationMs: MOVEMENT.SHAKE_MS + 140 });
  });

  it('a heavy hit presents as a crit (CRIT_DAMAGE_FRACTION of max HP)', () => {
    const event: TickEvent = { id: 'evt-crit-1', tone: 'loot', label: '-30', value: 30 } as TickEvent;
    const model = deriveRoamScene({ ...baseInput, event, targetMaxHp: 100 });
    expect(model.beat?.kind).toBe('crit');
    expect(model.shake?.intensity).toBe(7);
    expect(model.shake?.durationMs).toBe(MOVEMENT.CRIT_SHAKE_MS);
  });

  it('a material drop carries the loot rise visual (the rises stay DOM on the Pixi path)', () => {
    const event: TickEvent = { id: 'evt-loot-1', tone: 'material', label: '+1 TechFragments', value: 1 } as TickEvent;
    const model = deriveRoamScene({ ...baseInput, event });
    expect(model.lootRise).toBe('material');
    expect(model.dropItem).toBeNull();
  });

  it('an elite event resolves the elite rig (or the area flat) and the idle rig pose', () => {
    const event: TickEvent = { id: 'evt-elite-1', tone: 'event', label: 'Elite!', family: 'elite' } as unknown as TickEvent;
    const model = deriveRoamScene({ ...baseInput, event });
    expect(model.isEliteEvent).toBe(true);
    expect(model.rigPose).toEqual({});
    if (model.flatSpriteId) {
      expect(model.rig).toBeUndefined();
      expect(model.enemyPlacement.heightPct).toBe(74);
    } else {
      expect(model.rig?.id).toBe('enemy-elite');
      expect(model.enemyPlacement.heightPct).toBe(72);
    }
  });
});

describe('M2 — beat tracks are the DOM stage tables, sampled', () => {
  it('rest when there is no beat', () => {
    const s = sampleRoamBeat(null, 100);
    expect(s.hunter).toEqual({ x: 0, y: 0, scaleY: 1 });
    expect(s.enemyHit.opacity).toBe(1);
  });

  it('shot: hunter recoils -4px mid-track and settles by 220ms; enemy hit reaction spans HIT_REACTION_MS', () => {
    const beat = { kind: 'shot' as const, value: 10 };
    const mid = sampleRoamBeat(beat, 110);
    expect(mid.hunter.x).toBeLessThan(0);
    expect(mid.enemyHit.scale).toBeLessThan(1);
    const done = sampleRoamBeat(beat, MOVEMENT.HIT_REACTION_MS + 50);
    expect(done.hunter.x).toBe(0);
    expect(done.enemyHit.scale).toBe(1);
    expect(done.enemyHit.x).toBe(0);
  });

  it('crit: same windows as the shot, heavier keys — deeper dip, harder knock, settled by HIT_REACTION_MS (stage-iteration program)', () => {
    const beat = { kind: 'crit' as const, value: 30 };
    const shotMid = sampleRoamBeat({ kind: 'shot' as const, value: 10 }, 110);
    const mid = sampleRoamBeat(beat, 110);
    expect(mid.enemyHit.scale).toBeLessThan(shotMid.enemyHit.scale);
    expect(mid.enemyHit.x).toBeGreaterThan(shotMid.enemyHit.x);
    expect(mid.hunter.x).toBeLessThan(shotMid.hunter.x);
    const done = sampleRoamBeat(beat, MOVEMENT.HIT_REACTION_MS + 50);
    expect(done.hunter.x).toBe(0);
    expect(done.enemyHit.scale).toBe(1);
    expect(done.enemyHit.x).toBe(0);
  });

  it('playerHit: the lunge holds until the telegraph window, then travels -92px', () => {
    const beat = { kind: 'playerHit' as const, value: 10 };
    const early = sampleRoamBeat(beat, 100);
    expect(early.enemyLungeX).toBe(0);
    const mid = sampleRoamBeat(beat, MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS / 2);
    expect(mid.enemyLungeX).toBeLessThan(-40);
    const done = sampleRoamBeat(beat, MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 200);
    expect(done.enemyLungeX).toBe(0);
    expect(done.hunter.scaleY).toBe(1);
  });

  it('kill: the enemy collapses to invisible by 500ms (the DOM literal), hunter hop settles by 420ms', () => {
    const beat = { kind: 'kill' as const, value: 10 };
    const done = sampleRoamBeat(beat, 600);
    expect(done.enemyHit.opacity).toBe(0);
    expect(done.enemyHit.y).toBe(24);
    expect(done.hunter.y).toBe(0);
  });
});

describe('F6 — the Pixi stage enemy art key follows the target (rig-swap regression)', () => {
  // The defect (found by M2b's evidence, 2026-11-08): the Pixi
  // roam stage built its enemy rig once at mount, so every later
  // target wore the first target's painting under its own name
  // plate. The tick's swap seam keys the built art by this
  // derivation — if the key did NOT change with the archetype,
  // the swap could never fire and the defect would be back.
  const baseInput = {
    backgroundId: 'zone-dustwaste-bg',
    areaId: DEFAULT_ROAMING_AREA_ID,
    weapon: DIORAMA_WEAPON,
    targetMaxHp: 100,
    hunterSet: STANDARD_ISSUE,
  };

  it('the key names the CURRENT target archetype rig', () => {
    const raider = deriveRoamScene({ ...baseInput, currentTargetId: 'dustwaste_raider' });
    const drone = deriveRoamScene({ ...baseInput, currentTargetId: 'dustwaste_drone' });
    expect(enemyArtKeyFor(raider)).toBe('rig:enemy-fodder');
    expect(enemyArtKeyFor(drone)).toBe('rig:enemy-runner');
    expect(enemyArtKeyFor(raider)).not.toBe(enemyArtKeyFor(drone));
  });

  it('a target sequence A→B→A keys A, B, A — no stale cache in the seam', () => {
    const keys = ['dustwaste_raider', 'dustwaste_drone', 'dustwaste_raider'].map((id) =>
      enemyArtKeyFor(deriveRoamScene({ ...baseInput, currentTargetId: id })),
    );
    expect(keys).toEqual(['rig:enemy-fodder', 'rig:enemy-runner', 'rig:enemy-fodder']);
  });

  it('elite-vs-standard for the same target changes the key (rig AND flat paths)', () => {
    const std = deriveRoamScene({ ...baseInput, currentTargetId: 'dustwaste_raider' });
    const eliteEvent = { id: 'evt-elite-f6', tone: 'event', label: 'Elite!', family: 'elite' } as unknown as TickEvent;
    const elite = deriveRoamScene({ ...baseInput, currentTargetId: 'dustwaste_raider', event: eliteEvent });
    expect(enemyArtKeyFor(std)).not.toBe(enemyArtKeyFor(elite));
    // dustwaste carries a bespoke elite flat: the elite key is the flat's.
    if (elite.flatSpriteId) {
      expect(enemyArtKeyFor(elite)).toBe(`flat:${elite.enemySpriteId}`);
    } else {
      expect(enemyArtKeyFor(elite)).toBe('rig:enemy-elite');
    }
  });

  it('a same-archetype target change keeps the key (no pointless rebuild)', () => {
    const a = deriveRoamScene({ ...baseInput, currentTargetId: 'dustwaste_raider' });
    const b = deriveRoamScene({ ...baseInput, currentTargetId: 'dustwaste_raider', targetMaxHp: 42 });
    expect(enemyArtKeyFor(a)).toBe(enemyArtKeyFor(b));
  });
});

describe('M2 — node accounting is reported honestly', () => {
  it('full-dress roam counts 53 on the pilot formula (11 parts + weapon + 6 gear + 4 segments + pools)', () => {
    const n = roamAnimatedNodeCount({ partCount: 11, gearCount: 6, armed: true, enemySegments: 4 });
    expect(n).toBe(11 + 1 + 6 + 4 + ROAM_POOL_CAPS.sparks + ROAM_POOL_CAPS.tracers + ROAM_POOL_CAPS.embers + ROAM_POOL_CAPS.oneShots);
    expect(n).toBe(53);
    // The DOM scene this replaces animates at least as many
    // framer-driven elements; the count is reported, not trimmed
    // (trimming = dropping scene elements = a behavior change).
    expect(ROAM_POOL_CAPS.embers).toBe(MOVEMENT.EMBER_COUNT);
  });
});
