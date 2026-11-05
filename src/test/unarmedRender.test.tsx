import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PART_POSES, type PartsPoseName } from '@/lib/pixel/parts';
import { composePartSet } from '@/lib/pixel/partsCompositor';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { headPartForVariant, hunterPartSet } from '@/lib/pixel/headParts';
import { blit, newCanvas } from '@/lib/pixel/sceneRenderer';
import type { RgbaImage } from '@/lib/pixel/pngCodec';
import { PARTS_FEET_X, SKELETON } from '@/lib/pixel/parts';
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
 * Unarmed render (real-item invariant, parts edition M2): the old
 * shipped hunter art held a rifle, and the segmented rig inherited
 * it — an unequipped hunter rendered a phantom weapon in every
 * scene. The parts system has no baked weapon anywhere: the part
 * set is gun-free by construction, an unarmed hunter renders NO
 * weapon layer, and he stands in the 'relaxed' pose — hands at his
 * sides — instead of an aim stance holding air. The armed form is
 * the same set plus the compositor's render of the ACTUAL equipped
 * weapon, seated at the grip. Plus the slot audit: every slot-driven
 * render must show the slot's actual contents — absent when the
 * slot is empty. The deep pixel-identity assertions live in
 * loadoutTruthRender.test.tsx.
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

function renderParts(pose: PartsPoseName): RgbaImage {
  const img = newCanvas();
  const render = composePartSet(STANDARD_ISSUE, PART_POSES[pose], loadSprite);
  const boxH = 0.57 * img.height;
  const scale = boxH / SKELETON.frameHeight;
  const boxW = SKELETON.frameWidth * scale;
  const boxX = 0.22 * img.width - PARTS_FEET_X * boxW;
  const boxY = GROUND * img.height - boxH;
  blit(img, render.image, boxX + render.origin.x * scale, boxY + render.origin.y * scale, render.image.width * scale, render.image.height * scale);
  return img;
}

/** Count opaque pixels of a rendered actor inside a HUNTER-FRAME rect. */
function frameZoneCount(img: RgbaImage, fx0: number, fy0: number, fx1: number, fy1: number): number {
  const boxH = 0.57 * img.height;
  const scale = boxH / SKELETON.frameHeight;
  const boxW = SKELETON.frameWidth * scale;
  const box = { x: 0.22 * img.width - PARTS_FEET_X * boxW, y: GROUND * img.height - boxH, w: boxW, h: boxH };
  const sx = (fx: number) => Math.round(box.x + (fx / SKELETON.frameWidth) * box.w);
  const sy = (fy: number) => Math.round(box.y + (fy / SKELETON.frameHeight) * box.h);
  let count = 0;
  for (let y = sy(fy0); y < sy(fy1); y++) {
    for (let x = sx(fx0); x < sx(fx1); x++) {
      if (x >= 0 && y >= 0 && x < img.width && y < img.height && img.data[(y * img.width + x) * 4 + 3] > 12) count++;
    }
  }
  return count;
}

describe('head variants — parts edition', () => {
  it('a variant swaps exactly the head part; every other part is the stock part', () => {
    const set = hunterPartSet('hood');
    expect(set.parts.head?.spriteId).toBe('hunter-head-hood');
    for (const [slot, part] of Object.entries(STANDARD_ISSUE.parts)) {
      if (slot === 'head') continue;
      expect(set.parts[slot as keyof typeof set.parts], slot).toBe(part);
    }
  });

  it('the stock visor resolves to the Standard Issue head part itself', () => {
    expect(hunterPartSet('visor')).toBe(STANDARD_ISSUE);
    expect(headPartForVariant('mfr-redline').spriteId).toBe('hunter-head-redline');
  });

  it('every part sprite is registered in the manifest (stock + all head variants)', () => {
    const registered = (sprites as { sprites: Record<string, unknown> }).sprites;
    for (const part of Object.values(STANDARD_ISSUE.parts)) {
      if (part) expect(registered[part.spriteId], part.spriteId).toBeTruthy();
    }
    for (const variant of ['visor', 'optic', 'hood', 'fin', 'mfr-redline', 'mfr-ironwood', 'mfr-blastforge', 'mfr-prismatek', 'mfr-throwtech', 'mfr-helixworks']) {
      expect(registered[headPartForVariant(variant).spriteId], variant).toBeTruthy();
    }
  });
});

describe('unarmed stance — rendered pixels', () => {
  // The rifle zone of the hunter frame: right of the torso, at grip
  // height — only a held (or baked) rifle can paint it. In the
  // relaxed stance the hands hang at the thighs, far below it.
  const RIFLE_ZONE: [number, number, number, number] = [150, 88, 236, 152];
  // Beside the front thigh, where the hanging glove of the relaxed
  // stance lands (the resolved grip joint sits at ~(139, 202)).
  const GLOVE_ZONE: [number, number, number, number] = [121, 190, 150, 222];

  it('the relaxed stance renders NOTHING in the rifle zone', () => {
    expect(frameZoneCount(renderParts('relaxed'), ...RIFLE_ZONE)).toBe(0);
  });

  it('the relaxed stance shows the hanging glove beside the thigh', () => {
    expect(frameZoneCount(renderParts('relaxed'), ...GLOVE_ZONE)).toBeGreaterThan(10);
  });

  it('the aim stance has no hanging glove (hands up at the grip, not at the sides)', () => {
    expect(frameZoneCount(renderParts('aim'), ...GLOVE_ZONE)).toBe(0);
    expect(frameZoneCount(renderParts('aim'), 130, 100, 196, 150)).toBeGreaterThan(100);
  });

  it('the relaxed grip resolves beside the thigh, not at the aim point', () => {
    const relaxed = composePartSet(STANDARD_ISSUE, PART_POSES.relaxed, loadSprite);
    const aim = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite);
    expect(relaxed.joints.grip.y).toBeGreaterThan(aim.joints.grip.y + 60);
    expect(relaxed.joints.grip.x).toBeLessThan(aim.joints.grip.x - 40);
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
} as unknown as Weapon;

describe('LiveTurfDiorama — unarmed hunter + slot audit', () => {
  it('roaming with NO weapon: part set unarmed, no held weapon, and every empty slot renders absent', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} playerLevel={5} equippedCount={0} activityKind="roaming_loot" />);
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('standard-issue');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
    // Slot audit (fresh stores: nothing equipped anywhere).
    expect(screen.queryByTestId('pixel-gear-shield')).toBeNull();
    expect(screen.queryByTestId('pixel-gear-relic')).toBeNull();
    expect(screen.queryByTestId('pixel-gear-pauldron')).toBeNull();
    expect(screen.queryByTestId('pixel-belt-prop')).toBeNull();
    expect(screen.queryByTestId('pixel-vehicle')).toBeNull();
  });

  it('roaming WITH a weapon: same part set, armed, compositor weapon (equipped path unchanged)', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={TEST_WEAPON} playerLevel={5} equippedCount={1} activityKind="roaming_loot" />);
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('standard-issue');
    expect(hunter.getAttribute('data-armed')).toBe('true');
    expect(screen.getByTestId('pixel-held-weapon')).toBeTruthy();
  });

  it('idle with NO weapon: the relaxed part set instead of any baked-gun sprite', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} playerLevel={5} equippedCount={0} activityKind="idle_standby" />);
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('standard-issue');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(hunter.getAttribute('data-sprite')).toBeNull();
    expect(screen.queryByTestId('pixel-held-weapon')).toBeNull();
  });

  it('idle WITH a weapon: part set + the equipped weapon (no whole-sprite path)', () => {
    render(<LiveTurfDiorama area={getRoamingArea(DEFAULT_ROAMING_AREA_ID)} weapon={TEST_WEAPON} playerLevel={5} equippedCount={1} activityKind="idle_standby" />);
    const hunter = screen.getByTestId('pixel-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('standard-issue');
    expect(hunter.getAttribute('data-armed')).toBe('true');
    expect(hunter.getAttribute('data-sprite')).toBeNull();
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
  it('no weapon: part set unarmed in the arena, no weapon layer', () => {
    render(<BossFightStage timeline={TIMELINE} phases={PHASES} />);
    const hunter = screen.getByTestId('boss-stage-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('standard-issue');
    expect(hunter.getAttribute('data-armed')).toBe('false');
    expect(screen.queryByTestId('boss-stage-weapon')).toBeNull();
  });

  it('with a weapon: part set armed + compositor weapon at the grip (no whole-sprite path)', () => {
    render(<BossFightStage timeline={TIMELINE} phases={PHASES} weapon={TEST_WEAPON} />);
    const hunter = screen.getByTestId('boss-stage-hunter');
    expect(hunter.getAttribute('data-rig')).toBe('standard-issue');
    expect(hunter.getAttribute('data-armed')).toBe('true');
    expect(hunter.getAttribute('data-sprite')).toBeNull();
    expect(screen.getByTestId('boss-stage-weapon')).toBeTruthy();
  });
});

describe('ActionScenes — bench + repair bay audit', () => {
  it('crafting bench: the hunter is the part set, armed flag or not (bench scenes hold no weapon)', () => {
    const { unmount } = render(<CraftingBenchScene progress={0.5} causeLabel="Tempering" unarmed />);
    expect(screen.getByTestId('crafting-bench-hunter').getAttribute('data-rig')).toBe('standard-issue');
    unmount();
    render(<CraftingBenchScene progress={0.5} causeLabel="Tempering" />);
    expect(screen.getByTestId('crafting-bench-hunter').getAttribute('data-rig')).toBe('standard-issue');
  });

  it('repair bay: NO vehicle renders when none is assigned (no stand-in buggy)', () => {
    render(<RepairBayScene progress={0} causeLabel="Repair bay" />);
    expect(screen.queryByTestId('repair-bay-vehicle')).toBeNull();
    expect(screen.getByTestId('repair-bay-hunter').getAttribute('data-rig')).toBe('standard-issue');
  });

  it('repair bay: the assigned vehicle renders; the hunter is the part set', () => {
    render(<RepairBayScene progress={0.4} causeLabel="Dune Buggy" vehicleSpriteId="vehicle-dune-buggy" unarmed />);
    expect(screen.getByTestId('repair-bay-vehicle')).toBeTruthy();
    expect(screen.getByTestId('repair-bay-hunter').getAttribute('data-rig')).toBe('standard-issue');
  });
});
