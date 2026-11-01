import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HUNTER_POSES, HUNTER_RIG, HUNTER_RIG_UNARMED, hunterRigWithHead } from '@/lib/pixel/rig';
import { drawRig, hunterBox, newCanvas, type RgbaImage } from '@/lib/pixel/sceneRenderer';
import { decodePng } from '@/lib/pixel/pngCodec';
import sprites from '@/assets/pixel/manifest.json';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { CraftingBenchScene, RepairBayScene } from '@/components/pixelArt/ActionScenes';
import { buildInitialTimeline, type FightOutcome, type FightTimeline } from '@/lib/animation/fightTimeline';
import { getRoamingArea, DEFAULT_ROAMING_AREA_ID } from '@/constants/roamingAreas';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { PhaseAnalysis } from '@/types/boss';
import type { Weapon } from '@/types/items';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

/**
 * Unarmed render (real-item invariant): the shipped hunter art holds a
 * rifle, and the segmented rig inherited it — an unequipped hunter
 * rendered a phantom weapon in every scene. The fix is a gun-free rig
 * variant (HUNTER_RIG_UNARMED) selected whenever no weapon is equipped,
 * plus the slot audit: every slot-driven render must show the slot's
 * actual contents — absent when the slot is empty.
 */

const spriteCache = new Map<string, RgbaImage | undefined>();
function loadSprite(id: string): RgbaImage | undefined {
  if (!spriteCache.has(id)) {
    const entry = (sprites as { sprites: Record<string, { src: string }> }).sprites[id];
    let img: RgbaImage | undefined;
    if (entry) {
      try {
        img = decodePng(new Uint8Array(readFileSync(join(process.cwd(), 'src/assets/pixel', entry.src))));
      } catch {
        img = undefined;
      }
    }
    spriteCache.set(id, img);
  }
  return spriteCache.get(id);
}

const GROUND = 0.86;

function renderRig(rig: typeof HUNTER_RIG): RgbaImage {
  const img = newCanvas();
  drawRig(img, loadSprite, { rig, pose: HUNTER_POSES.idle, xPct: 22, heightPct: 57, feetX: 0.2717 }, GROUND);
  return img;
}

/** Count opaque pixels of a rendered rig inside a HUNTER-FRAME rect. */
function frameZoneCount(img: RgbaImage, fx0: number, fy0: number, fx1: number, fy1: number): number {
  const box = hunterBox(img, 22, 57, GROUND);
  const sx = (fx: number) => Math.round(box.x + (fx / 260) * box.w);
  const sy = (fy: number) => Math.round(box.y + (fy / 320) * box.h);
  let count = 0;
  for (let y = sy(fy0); y < sy(fy1); y++) {
    for (let x = sx(fx0); x < sx(fx1); x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height && img.data[(y * img.width + x) * 4 + 3] > 12) count++;
    }
  }
  return count;
}

describe('unarmed rig variant — structure', () => {
  it('swaps exactly the four weapon-bearing segments; the other six are shared with the armed rig', () => {
    const armed = new Map(HUNTER_RIG.segments.map((s) => [s.id, s.spriteId]));
    const unarmed = new Map(HUNTER_RIG_UNARMED.segments.map((s) => [s.id, s.spriteId]));
    expect([...unarmed.keys()].sort()).toEqual([...armed.keys()].sort());
    for (const id of ['back', 'thighB', 'shinB', 'thighF', 'shinF', 'head']) {
      expect(unarmed.get(id), id).toBe(armed.get(id));
    }
    for (const id of ['torso', 'armUpper', 'armFore', 'armOff']) {
      expect(unarmed.get(id), id).toBe(`${armed.get(id)}-unarmed`);
    }
    expect(HUNTER_RIG_UNARMED.frameWidth).toBe(HUNTER_RIG.frameWidth);
    expect(HUNTER_RIG_UNARMED.frameHeight).toBe(HUNTER_RIG.frameHeight);
  });

  it('hunterRigWithHead defaults to the armed rig and honors head variants on both rigs', () => {
    const seg = (rig: typeof HUNTER_RIG, id: string) => rig.segments.find((s) => s.id === id)?.spriteId;
    expect(seg(hunterRigWithHead('visor'), 'torso')).toBe('rig-hunter-torso');
    expect(seg(hunterRigWithHead('visor', true), 'torso')).toBe('rig-hunter-torso-unarmed');
    expect(seg(hunterRigWithHead('hood', true), 'head')).toBe('hunter-head-hood');
    expect(seg(hunterRigWithHead('hood', true), 'armFore')).toBe('rig-hunter-arm-fore-unarmed');
    expect(seg(hunterRigWithHead('hood'), 'armFore')).toBe('rig-hunter-arm-fore');
  });

  it('every unarmed segment sprite is registered in the manifest', () => {
    const registered = (sprites as { sprites: Record<string, unknown> }).sprites;
    for (const seg of HUNTER_RIG_UNARMED.segments) {
      expect(registered[seg.spriteId], seg.spriteId).toBeTruthy();
    }
  });
});

describe('unarmed rig variant — rendered pixels', () => {
  // The rifle zone of the hunter frame: right of the torso, at grip
  // height — only the baked rifle (and the held-weapon layer, never
  // drawn here) can paint it.
  const RIFLE_ZONE: [number, number, number, number] = [150, 88, 236, 152];
  // Below the torso hem, right of the front thigh: only the hanging
  // glove of the unarmed rig paints here.
  const GLOVE_ZONE: [number, number, number, number] = [121, 199, 134, 218];

  it('the armed rig still carries the baked rifle (control: the zone really is the gun)', () => {
    expect(frameZoneCount(renderRig(HUNTER_RIG), ...RIFLE_ZONE)).toBeGreaterThan(300);
  });

  it('the unarmed rig renders NOTHING in the rifle zone', () => {
    expect(frameZoneCount(renderRig(HUNTER_RIG_UNARMED), ...RIFLE_ZONE)).toBe(0);
  });

  it('the unarmed rig shows the hanging glove where the armed rig has nothing', () => {
    expect(frameZoneCount(renderRig(HUNTER_RIG), ...GLOVE_ZONE)).toBe(0);
    expect(frameZoneCount(renderRig(HUNTER_RIG_UNARMED), ...GLOVE_ZONE)).toBeGreaterThan(10);
  });
});

const TEST_WEAPON: Weapon = {
  id: 'unarmed-test-weapon',
  name: 'Invariant Test Carbine',
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
} as Weapon;

describe('LiveTurfDiorama — unarmed hunter + slot audit', () => {
  it('roaming with NO weapon: gun-free rig, no held weapon, and every empty slot renders absent', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} activityKind="roaming_loot" reducedMotion />);
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('hunter-unarmed');
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
    // Slot audit (fresh stores: nothing equipped anywhere).
    expect(screen.queryByTestId('pixel-gear-shield')).toBeNull();
    expect(screen.queryByTestId('pixel-gear-relic')).toBeNull();
    expect(screen.queryByTestId('pixel-gear-pauldron')).toBeNull();
    expect(screen.queryByTestId('pixel-belt-prop')).toBeNull();
    expect(screen.queryByTestId('pixel-vehicle')).toBeNull();
  });

  it('roaming WITH a weapon: armed rig + compositor weapon (equipped path unchanged)', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={TEST_WEAPON} activityKind="roaming_loot" reducedMotion />);
    expect(screen.getByTestId('pixel-hunter').getAttribute('data-rig')).toBe('hunter');
    expect(screen.getByTestId('pixel-held-weapon')).toBeTruthy();
  });

  it('idle with NO weapon: gun-free rig instead of the baked-gun whole sprite', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} activityKind="idle_standby" reducedMotion />);
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('hunter-unarmed');
    expect(hunter.getAttribute('data-sprite')).toBeNull();
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
  });

  it('idle WITH a weapon: the whole-sprite path is untouched', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={TEST_WEAPON} activityKind="idle_standby" reducedMotion />);
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-sprite')).toBe('hunter');
    expect(screen.getByTestId('pixel-held-weapon')).toBeTruthy();
  });
});

const PHASES: PhaseAnalysis[] = ['Ignition', 'Shield Wall', 'Overdrive', 'Core Breach'].map((phaseName, i) => ({
  phaseId: `phase-${i + 1}`,
  phaseName,
  score: 0.8,
  status: 'safe' as const,
  currentAnswers: ['weapon'],
  missingCounters: [],
  relevantConsumables: [],
  explanation: 'Test phase',
}));

const TIMELINE: FightTimeline = (() => {
  const outcome: FightOutcome = {
    result: { victory: true, winChance: 0.75, bossHpRemaining: 0 },
    creditsDelta: 1500,
    bonusLootRolls: 1,
    consumedConsumables: {},
    loot: [],
    extraLoot: false,
  };
  const base = buildInitialTimeline(outcome, 1000, 5, 0);
  return { ...base, currentPhaseIndex: 0, bossHp: 750, playerHp: 260 };
})();

describe('BossFightStage — unarmed hunter', () => {
  it('no weapon: gun-free rig in the arena, no weapon layer', () => {
    render(<BossFightStage timeline={TIMELINE} phases={PHASES} />);
    const hunter = screen.getByTestId('boss-stage-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('hunter-unarmed');
    expect(screen.queryByTestId('boss-stage-weapon')).toBeNull();
  });

  it('with a weapon: whole sprite + compositor weapon (equipped path unchanged)', () => {
    render(<BossFightStage timeline={TIMELINE} phases={PHASES} weapon={TEST_WEAPON} />);
    const hunter = screen.getByTestId('boss-stage-hunter');
    expect(hunter.getAttribute('data-sprite')).toBe('hunter');
    expect(screen.getByTestId('boss-stage-weapon')).toBeTruthy();
  });
});

describe('ActionScenes — bench + repair bay audit', () => {
  it('crafting bench: unarmed hunter renders the gun-free rig; default stays armed', () => {
    const { unmount } = render(<CraftingBenchScene progress={0.5} causeLabel="Tempering" unarmed />);
    expect(screen.getByTestId('crafting-bench-hunter').getAttribute('data-rig')).toBe('hunter-unarmed');
    unmount();
    render(<CraftingBenchScene progress={0.5} causeLabel="Tempering" />);
    expect(screen.getByTestId('crafting-bench-hunter').getAttribute('data-rig')).toBe('hunter');
  });

  it('repair bay: NO vehicle renders when none is assigned (no stand-in buggy)', () => {
    render(<RepairBayScene progress={0} causeLabel="Repair bay" />);
    expect(screen.queryByTestId('repair-bay-vehicle')).toBeNull();
    expect(screen.getByTestId('repair-bay-hunter').getAttribute('data-rig')).toBe('hunter');
  });

  it('repair bay: the assigned vehicle renders, and an unarmed hunter uses the gun-free rig', () => {
    render(<RepairBayScene progress={0.4} causeLabel="Dune Buggy" vehicleSpriteId="vehicle-dune-buggy" unarmed />);
    expect(screen.getByTestId('repair-bay-vehicle')).toBeTruthy();
    expect(screen.getByTestId('repair-bay-hunter').getAttribute('data-rig')).toBe('hunter-unarmed');
  });
});
