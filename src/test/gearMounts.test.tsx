import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { blit, newCanvas } from '@/lib/pixel/sceneRenderer';
import type { RgbaImage } from '@/lib/pixel/pngCodec';
import {
  PART_POSES,
  PART_SLOTS,
  PARTS_FEET_X,
  SKELETON,
  WEAPON_PAINT_ORDER,
  lintPartSet,
  type PartSetDef,
} from '@/lib/pixel/parts';
import { composePartSet, layoutPartSet, type PartsRender } from '@/lib/pixel/partsCompositor';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import {
  GEAR_PAINT_ORDER,
  beltGearItems,
  mountedGearForLoadout,
  resolveGearMount,
  shieldElementTint,
  type MountedGearItem,
} from '@/lib/pixel/gearMounts';
import { decodePng } from '@/lib/pixel/pngCodec';
import { PixelPartsActor } from '@/components/pixelArt/PixelPartsActor';
import sprites from '@/assets/pixel/manifest.json';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, Relic, Shield } from '@/types/items';

/**
 * Parts System M3 — gear mounts + the completed FX anchor chain.
 *
 * Loadout-truth, extended from weapons to gear: the mounted reads
 * derive from the ACTUAL equipped instances and hang on the part
 * set's declared mounts. These proofs work on rendered pixels
 * through the raster compositor (the golden scenes' path) and on
 * the live DOM actor:
 *
 *  - a geared render is EXACTLY its declared layers (parts + gear +
 *    weapon) in paint order — no third image, no leftover chip;
 *  - each gear layer sits ON its mount point and follows the
 *    mounting part through poses;
 *  - changing the instance changes the render (behavior, element,
 *    rarity, tree, consumable), and unequipping removes it;
 *  - an item whose mount is absent renders nothing (swallow rule);
 *  - the mass joint the stages' player-hit FX read is resolved
 *    from the posed layout, not a hard-coded skeleton point.
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

function diffCount(a: RgbaImage, b: RgbaImage): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2] || a.data[i + 3] !== b.data[i + 3]) n++;
  }
  return n;
}

/** Opaque-pixel centroid + count of a layer, in BUFFER coordinates
 *  (stage point + |origin|). */
function layerCentroid(layer: RgbaImage): { x: number; y: number; count: number } {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < layer.height; y++) {
    for (let x = 0; x < layer.width; x++) {
      if (layer.data[(y * layer.width + x) * 4 + 3] > 12) {
        sx += x;
        sy += y;
        n++;
      }
    }
  }
  return { x: n ? sx / n : 0, y: n ? sy / n : 0, count: n };
}

function layerHasColor(layer: RgbaImage, r: number, g: number, b: number): boolean {
  for (let i = 0; i < layer.data.length; i += 4) {
    if (layer.data[i] === r && layer.data[i + 1] === g && layer.data[i + 2] === b && layer.data[i + 3] === 255) return true;
  }
  return false;
}

/* -- Fixtures: real item instances ------------------------------- */

const novaFireShield = {
  id: 'm3-shield-nova-fire',
  name: 'Nova Aegis',
  level: 10,
  rarity: Rarity.Rare,
  hp: 300,
  rechargeRate: 10,
  mitigation: 0.1,
  element: Element.Fire,
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 3,
  behavior: 'nova',
} as unknown as Shield;

const novaShockShield: Shield = { ...novaFireShield, id: 'm3-shield-nova-shock', element: Element.Shock };
const turtleFireShield: Shield = { ...novaFireShield, id: 'm3-shield-turtle-fire', behavior: 'turtle' };

const legendaryRelic = {
  id: 'm3-relic-legendary',
  name: 'Sigil of the Cache',
  level: 10,
  rarity: Rarity.Legendary,
  affixes: [],
  sourceTag: DropSource.BossDrop,
  isLocked: false,
} as unknown as Relic;

const commonRelic: Relic = { ...legendaryRelic, id: 'm3-relic-common', rarity: Rarity.Common };

const demolitionMod = {
  id: 'm3-mod-demolition',
  name: 'Demolitionist Rig',
  level: 10,
  rarity: Rarity.Epic,
  treeBonus: 'demolition',
  nodeBoosts: {},
  affixes: [],
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
} as unknown as ClassMod;

const scavengerMod: ClassMod = { ...demolitionMod, id: 'm3-mod-scavenger', treeBonus: 'scavenger' };

const FULL_GEAR: MountedGearItem[] = mountedGearForLoadout({
  shield: novaFireShield,
  relic: legendaryRelic,
  classMod: demolitionMod,
  consumables: ['med_kit', null, 'shield_cell'],
});

const PISTOL: PixelWeaponInput = {
  id: 'm3-pistol',
  name: 'Common Kinetic Pistol',
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Ironwood,
  element: Element.Kinetic,
  rarity: Rarity.Common,
  pixelSeed: 1234,
  affixes: [],
  rollQuality: 50,
};

const GROUND = 0.86;
const DIORAMA = { xPct: 22, heightPct: 57 };

function frameBox(img: RgbaImage, place: { xPct: number; heightPct: number }): { x: number; y: number; w: number; h: number; scale: number } {
  const h = (place.heightPct / 100) * img.height;
  const scale = h / SKELETON.frameHeight;
  const w = SKELETON.frameWidth * scale;
  return { x: (place.xPct / 100) * img.width - PARTS_FEET_X * w, y: GROUND * img.height - h, w, h, scale };
}

/** Re-stage a composed render layer by layer, in paint order — the
 *  M2 loadout-truth reconstruction, extended with the gear tier. */
function renderLayered(render: PartsRender, gearOrder: MountedGearItem[]): RgbaImage {
  const img = newCanvas();
  const box = frameBox(img, DIORAMA);
  const ordered = PART_SLOTS.filter(({ slot }) => render.layers.has(slot))
    .map(({ slot, paintOrder }) => ({ key: slot as string, order: paintOrder, seq: 0 }))
    .concat(
      gearOrder
        .filter((g) => render.layers.has(g.layerKey))
        .map((g, i) => ({ key: g.layerKey, order: GEAR_PAINT_ORDER, seq: i + 1 })),
    )
    .concat(render.layers.has('weapon') ? [{ key: 'weapon', order: WEAPON_PAINT_ORDER, seq: 99 }] : [])
    .sort((a, b) => a.order - b.order || a.seq - b.seq);
  for (const { key } of ordered) {
    const layer = render.layers.get(key)!;
    blit(img, layer, box.x + render.origin.x * box.scale, box.y + render.origin.y * box.scale, layer.width * box.scale, layer.height * box.scale);
  }
  return img;
}

function placeRender(render: PartsRender): RgbaImage {
  const img = newCanvas();
  const box = frameBox(img, DIORAMA);
  blit(img, render.image, box.x + render.origin.x * box.scale, box.y + render.origin.y * box.scale, render.image.width * box.scale, render.image.height * box.scale);
  return img;
}

describe('M3 gear mounts — the mount data law', () => {
  it('Standard Issue declares every gear mount and lints clean', () => {
    expect(STANDARD_ISSUE.parts.torso?.mounts?.beltMount).toBeDefined();
    expect(STANDARD_ISSUE.parts.torso?.mounts?.chestMount).toBeDefined();
    expect(STANDARD_ISSUE.parts.torso?.mounts?.shoulderMount).toBeDefined();
    expect(STANDARD_ISSUE.parts.armFar?.mounts?.shieldMount).toBeDefined();
    expect(lintPartSet(STANDARD_ISSUE).errors).toEqual([]);
  });

  it('a torso without the belt mount fails the lint (swallow rule at the data layer)', () => {
    const torso = STANDARD_ISSUE.parts.torso!;
    const broken: PartSetDef = {
      ...STANDARD_ISSUE,
      parts: {
        ...STANDARD_ISSUE.parts,
        torso: { ...torso, mounts: { shoulderMount: torso.mounts!.shoulderMount, chestMount: torso.mounts!.chestMount } },
      },
    };
    const { errors } = lintPartSet(broken);
    expect(errors.some((e) => e.includes('beltMount'))).toBe(true);
  });

  it('a far arm without the shield mount fails the lint', () => {
    const armFar = STANDARD_ISSUE.parts.armFar!;
    const broken: PartSetDef = {
      ...STANDARD_ISSUE,
      parts: { ...STANDARD_ISSUE.parts, armFar: { ...armFar, mounts: undefined } },
    };
    const { errors } = lintPartSet(broken);
    expect(errors.some((e) => e.includes('shieldMount'))).toBe(true);
  });
});

describe('M3 gear mounts — raster proofs (composePartSet)', () => {
  it('the geared, armed render is EXACTLY its declared layers in paint order', () => {
    // RE-PINNED 2026-11-11 (far-arm suppression): this inventory
    // proof used to compose the aim pose, but aim now suppresses
    // the far arm (and swallows its shield) by owner ruling, so
    // the EXACT full layer inventory — every part slot + every
    // gear layer + the weapon — is asserted on idle, where every
    // declared layer is drawn. Same expected set, unchanged.
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, {
      weapon: { kind: 'compositor', input: PISTOL },
      gear: FULL_GEAR,
    });
    const layerKeys = [...render.layers.keys()].sort();
    expect(layerKeys).toEqual(
      [
        ...PART_SLOTS.filter((s) => STANDARD_ISSUE.parts[s.slot]).map((s) => s.slot as string),
        'weapon',
        'gear:shield',
        'gear:relic',
        'gear:pauldron',
        'gear:belt-0',
        'gear:belt-2',
      ].sort(),
    );
    expect(diffCount(placeRender(render), renderLayered(render, FULL_GEAR))).toBe(0);
  });

  it('no gear supplied → no gear layers, and gear: [] renders pixel-identical to gearless', () => {
    const gearless = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: PISTOL },
    });
    const emptyGear = composePartSet(STANDARD_ISSUE, PART_POSES.aim, loadSprite, {
      weapon: { kind: 'compositor', input: PISTOL },
      gear: [],
    });
    expect([...gearless.layers.keys()].some((k) => k.startsWith('gear:'))).toBe(false);
    expect(diffCount(gearless.image, emptyGear.image)).toBe(0);
  });

  it('each gear layer sits ON its declared mount point', () => {
    const render = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, { gear: FULL_GEAR });
    const layout = layoutPartSet(STANDARD_ISSUE, PART_POSES.idle);
    for (const item of FULL_GEAR) {
      const mount = resolveGearMount(layout, item)!;
      const centroid = layerCentroid(render.layers.get(item.layerKey)!);
      expect(centroid.count, item.layerKey).toBeGreaterThan(50);
      if (item.kind === 'belt') {
        // Belt props hang from the band: anchor is the sprite's top
        // edge, so assert horizontally on-mount and vertically the
        // layer's top rows start at the mount's stage line.
        expect(Math.abs(centroid.x - (mount.stage.x - render.origin.x)), item.layerKey).toBeLessThan(10);
        let topRow = Infinity;
        const layer = render.layers.get(item.layerKey)!;
        for (let y = 0; y < layer.height; y++) {
          for (let x = 0; x < layer.width; x++) {
            if (layer.data[(y * layer.width + x) * 4 + 3] > 12) {
              topRow = Math.min(topRow, y);
              break;
            }
          }
        }
        expect(Math.abs(topRow - (mount.stage.y - render.origin.y)), item.layerKey).toBeLessThan(9);
      } else {
        expect(Math.abs(centroid.x - (mount.stage.x - render.origin.x)), item.layerKey).toBeLessThan(13);
        expect(Math.abs(centroid.y - (mount.stage.y - render.origin.y)), item.layerKey).toBeLessThan(13);
      }
    }
  });

  it('gear follows the mounting part through poses (the arm carries the shield)', () => {
    // RE-PINNED 2026-11-11 (far-arm suppression): this leg used to
    // run aim vs hit, but the far arm is pose-suppressed in aim now
    // (owner ruling: the strict side view never draws it in combat
    // poses), so the shield mount no longer resolves in aim — the
    // swallow rule follows the part, pinned explicitly in the next
    // test. The follow-through leg runs idle vs hit instead: the
    // nearest pose pair where the arm IS drawn, same assertions
    // (mount travel > 5 stage px — measured 8.8 — and layer
    // centroids tracking the mount within 7).
    const idleRender = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, { gear: FULL_GEAR });
    const hitRender = composePartSet(STANDARD_ISSUE, PART_POSES.hit, loadSprite, { gear: FULL_GEAR });
    const idleLayout = layoutPartSet(STANDARD_ISSUE, PART_POSES.idle);
    const hitLayout = layoutPartSet(STANDARD_ISSUE, PART_POSES.hit);
    const shieldItem = FULL_GEAR.find((g) => g.kind === 'shield')!;
    const idleMount = resolveGearMount(idleLayout, shieldItem)!.stage;
    const hitMount = resolveGearMount(hitLayout, shieldItem)!.stage;
    const mountDelta = { x: hitMount.x - idleMount.x, y: hitMount.y - idleMount.y };
    expect(Math.hypot(mountDelta.x, mountDelta.y)).toBeGreaterThan(5);
    const idleC = layerCentroid(idleRender.layers.get('gear:shield')!);
    const hitC = layerCentroid(hitRender.layers.get('gear:shield')!);
    expect(Math.abs(hitC.x - idleC.x - mountDelta.x)).toBeLessThan(7);
    expect(Math.abs(hitC.y - idleC.y - mountDelta.y)).toBeLessThan(7);
    // The pauldron rides the torso the same way.
    const pauldronItem = FULL_GEAR.find((g) => g.kind === 'pauldron')!;
    const pIdle = resolveGearMount(idleLayout, pauldronItem)!.stage;
    const pHit = resolveGearMount(hitLayout, pauldronItem)!.stage;
    const pIdleC = layerCentroid(idleRender.layers.get('gear:pauldron')!);
    const pHitC = layerCentroid(hitRender.layers.get('gear:pauldron')!);
    expect(Math.abs(pHitC.x - pIdleC.x - (pHit.x - pIdle.x))).toBeLessThan(7);
    expect(Math.abs(pHitC.y - pIdleC.y - (pHit.y - pIdle.y))).toBeLessThan(7);
  });

  it('pose suppression: the far arm and its shield do not render in aim or recoil', () => {
    // Owner ruling 2026-11-11: strict side view — the far arm is
    // not drawn in combat poses (two rotation tunings still left
    // it reading as a stray arm in the armpit gap). The shield
    // rides that arm, so it is swallowed with it; the part still
    // RESOLVES geometrically (placement, mount anchor, supportHand
    // joint all present) so no geometry gate or extent moves.
    const shieldItem = FULL_GEAR.find((g) => g.kind === 'shield')!;
    for (const poseName of ['aim', 'recoil'] as const) {
      const render = composePartSet(STANDARD_ISSUE, PART_POSES[poseName], loadSprite, { gear: FULL_GEAR });
      expect(render.layers.has('armFar'), poseName).toBe(false);
      expect(render.layers.has('gear:shield'), poseName).toBe(false);
      const layout = layoutPartSet(STANDARD_ISSUE, PART_POSES[poseName]);
      expect(layout.placements.armFar?.hidden, poseName).toBe(true);
      expect(resolveGearMount(layout, shieldItem), poseName).toBeUndefined();
      expect(layout.anchorStages.has('armFar:mount:shieldMount'), poseName).toBe(true);
    }
    // Non-combat poses still draw the arm and carry the shield.
    const idle = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, { gear: FULL_GEAR });
    expect(idle.layers.has('armFar')).toBe(true);
    expect(idle.layers.has('gear:shield')).toBe(true);
  });

  it('swallow rule: an item whose mount is absent renders nothing', () => {
    const armFar = STANDARD_ISSUE.parts.armFar!;
    const noShieldMount: PartSetDef = {
      ...STANDARD_ISSUE,
      parts: { ...STANDARD_ISSUE.parts, armFar: { ...armFar, mounts: undefined } },
    };
    const render = composePartSet(noShieldMount, PART_POSES.idle, loadSprite, { gear: FULL_GEAR });
    expect(render.layers.has('gear:shield')).toBe(false);
    expect(render.layers.has('gear:relic')).toBe(true);
    expect(render.layers.has('gear:pauldron')).toBe(true);
  });
});

describe('M3 gear mounts — loadout truth (the instance is the render)', () => {
  const shieldLayer = (shield: Shield) =>
    composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, {
      gear: mountedGearForLoadout({ shield, consumables: [] }),
    }).layers.get('gear:shield')!;

  it('shield keying: the behavior glyph is the instance’s own behavior', () => {
    expect(diffCount(shieldLayer(novaFireShield), shieldLayer(turtleFireShield))).toBeGreaterThan(400);
    const items = mountedGearForLoadout({ shield: novaFireShield, consumables: [] });
    expect(items[0].spriteId).toBe('glyph-behavior-nova');
    expect(mountedGearForLoadout({ shield: turtleFireShield, consumables: [] })[0].spriteId).toBe('glyph-behavior-turtle');
  });

  it('shield keying: the element tint is the instance’s own element', () => {
    expect(diffCount(shieldLayer(novaFireShield), shieldLayer(novaShockShield))).toBeGreaterThan(400);
    expect(shieldElementTint(Element.Fire)).not.toEqual(shieldElementTint(Element.Shock));
    // A legacy shield with no behavior field reads Standard.
    const legacy = { ...novaFireShield, id: 'm3-shield-legacy', behavior: undefined } as unknown as Shield;
    expect(mountedGearForLoadout({ shield: legacy, consumables: [] })[0].spriteId).toBe('glyph-behavior-standard');
  });

  it('relic keying: the frame is the instance’s own rarity', () => {
    const legendary = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, {
      gear: mountedGearForLoadout({ relic: legendaryRelic, consumables: [] }),
    }).layers.get('gear:relic')!;
    const common = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, {
      gear: mountedGearForLoadout({ relic: commonRelic, consumables: [] }),
    }).layers.get('gear:relic')!;
    expect(layerHasColor(legendary, 0xff, 0xea, 0x3a)).toBe(true);
    expect(layerHasColor(legendary, 0xa5, 0xa7, 0xb5)).toBe(false);
    expect(layerHasColor(common, 0xa5, 0xa7, 0xb5)).toBe(true);
    expect(diffCount(legendary, common)).toBeGreaterThan(100);
  });

  it('pauldron keying: the tree sprite is the class mod’s own tree', () => {
    const demo = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, {
      gear: mountedGearForLoadout({ classMod: demolitionMod, consumables: [] }),
    }).layers.get('gear:pauldron')!;
    const scav = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, {
      gear: mountedGearForLoadout({ classMod: scavengerMod, consumables: [] }),
    }).layers.get('gear:pauldron')!;
    expect(diffCount(demo, scav)).toBeGreaterThan(100);
    expect(mountedGearForLoadout({ classMod: demolitionMod, consumables: [] })[0].spriteId).toBe('gear-pauldron-demolition');
  });

  it('belt keying: slotted consumables are the props; empty slots mount nothing', () => {
    expect(beltGearItems([null, null, null])).toEqual([]);
    const one = beltGearItems(['med_kit', null, null]);
    expect(one).toHaveLength(1);
    expect(one[0].spriteId).toBe('belt-vial');
    expect(one[0].fanOffsetX).toBe(0);
    const two = beltGearItems(['med_kit', null, 'shield_cell']);
    expect(two.map((g) => g.spriteId)).toEqual(['belt-vial', 'belt-cell']);
    expect(two.map((g) => g.fanOffsetX)).toEqual([-12, 12]);
    const layerA = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, { gear: one }).layers.get('gear:belt-0')!;
    const layerB = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, {
      gear: beltGearItems(['shield_cell', null, null]),
    }).layers.get('gear:belt-0')!;
    expect(diffCount(layerA, layerB)).toBeGreaterThan(50);
  });

  it('unequipping everything removes every gear layer from the composite', () => {
    const geared = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, { gear: FULL_GEAR });
    const bare = composePartSet(STANDARD_ISSUE, PART_POSES.idle, loadSprite, {
      gear: mountedGearForLoadout({ consumables: [null, null, null] }),
    });
    expect(mountedGearForLoadout({ consumables: [null, null, null] })).toEqual([]);
    expect([...bare.layers.keys()].some((k) => k.startsWith('gear:'))).toBe(false);
    expect(diffCount(geared.image, bare.image)).toBeGreaterThan(1000);
  });
});

describe('M3 FX anchor chain — the mass joint', () => {
  it('mass is the midpoint of the posed torso span, from the layout itself', () => {
    for (const poseName of ['idle', 'aim', 'hit', 'celebrate'] as const) {
      const layout = layoutPartSet(STANDARD_ISSUE, PART_POSES[poseName]);
      const neck = layout.anchorStages.get('torso:neckSeat')!;
      const pelvis = layout.anchorStages.get('torso:pelvisSeat')!;
      expect(layout.joints.mass.x).toBeCloseTo((neck.x + pelvis.x) / 2, 6);
      expect(layout.joints.mass.y).toBeCloseTo((neck.y + pelvis.y) / 2, 6);
      const render = composePartSet(STANDARD_ISSUE, PART_POSES[poseName], loadSprite);
      expect(render.joints.mass).toEqual(layout.joints.mass);
    }
  });

  it('mass follows the pose — it is not the fixed skeleton chest point', () => {
    const idle = layoutPartSet(STANDARD_ISSUE, PART_POSES.idle);
    const hit = layoutPartSet(STANDARD_ISSUE, PART_POSES.hit);
    expect(Math.hypot(hit.joints.mass.x - idle.joints.mass.x, hit.joints.mass.y - idle.joints.mass.y)).toBeGreaterThan(1);
    const chestDistance = Math.hypot(hit.joints.mass.x - SKELETON.chest.x, hit.joints.mass.y - SKELETON.chest.y);
    expect(chestDistance).toBeGreaterThan(3);
  });
});

describe('M3 gear mounts — the DOM actor', () => {
  const actorProps = {
    set: STANDARD_ISSUE,
    xPct: 22,
    heightPct: 57,
    groundY: GROUND,
    pose: 'idle' as const,
    testId: 'pixel-hunter',
  };

  it('mounts every equipped item on its declared mount, keyed from the instances', () => {
    render(<PixelPartsActor {...actorProps} gear={FULL_GEAR} />);
    const shield = screen.getByTestId('pixel-gear-shield');
    expect(shield.getAttribute('data-gear-mount')).toBe('armFar:mount:shieldMount');
    expect(shield.getAttribute('data-gear-sprite')).toBe('glyph-behavior-nova');
    expect(screen.getByTestId('pixel-gear-relic').getAttribute('data-gear-mount')).toBe('torso:mount:chestMount');
    expect(screen.getByTestId('pixel-gear-pauldron').getAttribute('data-gear-mount')).toBe('torso:mount:shoulderMount');
    expect(screen.getByTestId('pixel-gear-pauldron').getAttribute('data-gear-sprite')).toBe('gear-pauldron-demolition');
    const belt = screen.getAllByTestId('pixel-belt-prop');
    expect(belt).toHaveLength(2);
    expect(belt.every((b) => b.getAttribute('data-gear-mount') === 'torso:mount:beltMount')).toBe(true);
    // Position truth: the shield's box is centered on the arm's
    // shield mount in the idle layout — (119, 144) in frame px.
    const layout = layoutPartSet(STANDARD_ISSUE, PART_POSES.idle);
    const mount = resolveGearMount(layout, FULL_GEAR[0])!;
    expect(mount.stage).toEqual({ x: 119, y: 144 });
    const expectedLeft = ((mount.stage.x - 0.5 * FULL_GEAR[0].width) / SKELETON.frameWidth) * 100;
    const expectedTop = ((mount.stage.y - 0.5 * FULL_GEAR[0].width) / SKELETON.frameHeight) * 100;
    expect(parseFloat(shield.style.left)).toBeCloseTo(expectedLeft, 1);
    expect(parseFloat(shield.style.top)).toBeCloseTo(expectedTop, 1);
  });

  it('no gear prop → no mounted gear in the DOM', () => {
    render(<PixelPartsActor {...actorProps} />);
    expect(screen.queryByTestId('pixel-gear-shield')).toBeNull();
    expect(screen.queryByTestId('pixel-gear-relic')).toBeNull();
    expect(screen.queryByTestId('pixel-gear-pauldron')).toBeNull();
    expect(screen.queryByTestId('pixel-belt-prop')).toBeNull();
  });

  it('swapping the equipped shield changes the mounted sprite', () => {
    const { rerender } = render(<PixelPartsActor {...actorProps} gear={FULL_GEAR} />);
    expect(screen.getByTestId('pixel-gear-shield').getAttribute('data-gear-sprite')).toBe('glyph-behavior-nova');
    rerender(
      <PixelPartsActor
        {...actorProps}
        gear={mountedGearForLoadout({ shield: turtleFireShield, relic: legendaryRelic, classMod: demolitionMod, consumables: ['med_kit', null, 'shield_cell'] })}
      />,
    );
    expect(screen.getByTestId('pixel-gear-shield').getAttribute('data-gear-sprite')).toBe('glyph-behavior-turtle');
  });
});
