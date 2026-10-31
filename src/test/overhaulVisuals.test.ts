/**
 * Visual overhaul structure (§4/§5) — manifest completeness for every
 * area/enemy/boss/prop/segment the new systems reference, palette
 * determinism, compositor instance fidelity (the §4.2 audit fixes),
 * the animated-node budget, and the art payload budget.
 */
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifestData from '@/assets/pixel/manifest.json';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_EVENTS_BY_AREA } from '@/content/roamingEvents';
import { AREA_VISUALS, PIXEL_BOSS_ARENAS } from '@/content/areaPalettes';
import { ACTION_SETS, GRAMMAR } from '@/lib/pixel/grammar';
import { ELEMENT_DIALECTS } from '@/lib/pixel/elementFx';
import { MOVEMENT } from '@/lib/pixel/movement';
import { HUNTER_HEAD_VARIANTS, HUNTER_RIG, countRigNodes, enemyRig } from '@/lib/pixel/rig';
import { remapPixelData, type PaletteSpec } from '@/lib/pixel/paletteSwap';
import { composePixelWeapon, partVariant, type PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { buildWeaponVisualSpec } from '@/lib/weaponArt/buildWeaponVisualSpec';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';

const sprites = (manifestData as { sprites: Record<string, { src: string }> }).sprites;
const has = (id: string) => id in sprites;

const AREA_SLUG: Record<string, string> = {
  dustwaste_frontier: 'dustwaste',
  redline_circuit: 'redline',
  ironwood_bastion: 'ironwood',
  blastforge_yards: 'blastforge',
  prismatek_reactor: 'prismatek',
  throwtech_dumpnet: 'throwtech',
  helixworks_labyrinth: 'helixworks',
};

describe('manifest completeness (§4)', () => {
  it('every area resolves its background + parallax re-cuts', () => {
    for (const area of ROAMING_AREAS) {
      const slug = AREA_SLUG[area.id];
      expect(has(`zone-${slug}-bg`), `${slug} bg`).toBe(true);
      expect(has(`zone-${slug}-far`), `${slug} far`).toBe(true);
      expect(has(`zone-${slug}-mid`), `${slug} mid`).toBe(true);
      expect(has(`zone-${slug}-near`), `${slug} near`).toBe(true);
    }
  });

  it('every archetype resolves its sprite, rig kit, and death poses', () => {
    for (const archetype of ['fodder', 'runner', 'brute', 'sniper', 'elite']) {
      const rig = enemyRig(archetype);
      for (const seg of rig.segments) expect(has(seg.spriteId), seg.spriteId).toBe(true);
      expect(has(`death-${archetype}-a`)).toBe(true);
      expect(has(`death-${archetype}-b`)).toBe(true);
    }
    for (const seg of HUNTER_RIG.segments) expect(has(seg.spriteId), seg.spriteId).toBe(true);
    for (const variant of HUNTER_HEAD_VARIANTS) expect(has(variant.spriteId), variant.spriteId).toBe(true);
  });

  it('every boss resolves its sprite, unique arena, and arena prop', () => {
    for (const boss of REGION_1_BOSSES) {
      const arena = PIXEL_BOSS_ARENAS[boss.id];
      expect(arena, `arena for ${boss.id}`).toBeTruthy();
      expect(has(arena.backgroundId), arena.backgroundId).toBe(true);
      expect(has(arena.propId), arena.propId).toBe(true);
      expect(has(`boss-${boss.id.replace(/_/g, '-')}`)).toBe(true);
    }
    const arenaIds = new Set(Object.values(PIXEL_BOSS_ARENAS).map((a) => a.backgroundId));
    expect(arenaIds.size).toBe(7);
  });

  it('every event prop, area visual, dialect status, and action set resolves', () => {
    for (const events of Object.values(ROAMING_EVENTS_BY_AREA)) {
      for (const def of events) expect(has(def.propId), def.propId).toBe(true);
    }
    for (const visuals of Object.values(AREA_VISUALS)) {
      for (const propId of visuals.animatedProps) expect(has(propId), propId).toBe(true);
      expect(has(visuals.signaturePartId), visuals.signaturePartId).toBe(true);
      if (visuals.eliteSpriteId) expect(has(visuals.eliteSpriteId)).toBe(true);
    }
    for (const dialect of Object.values(ELEMENT_DIALECTS)) {
      expect(has(dialect.statusSpriteId), dialect.statusSpriteId).toBe(true);
    }
    for (const set of Object.values(ACTION_SETS)) {
      for (const spriteId of set) expect(has(spriteId), spriteId).toBe(true);
    }
    for (const id of [
      'prop-elite-banner', 'prop-hot-pennant', 'gear-shield-emitter', 'gear-relic-sigil',
      'gear-pauldron-gunslinger', 'gear-pauldron-demolition', 'gear-pauldron-scavenger',
      'vehicle-scrap-bike', 'vehicle-dune-buggy', 'vehicle-utility-rover', 'vehicle-cargo-hauler',
      'vehicle-armored-crawler', 'vehicle-relay-skimmer', 'vehicle-affix-cargo-rack',
      'vehicle-affix-scanner-array', 'vehicle-affix-reinforced-frame', 'vehicle-condition-scuff',
    ]) {
      expect(has(id), id).toBe(true);
    }
  });

  it('rig frames stay inside their source frames', () => {
    for (const seg of HUNTER_RIG.segments) {
      expect(seg.frameX + seg.width).toBeLessThanOrEqual(HUNTER_RIG.frameWidth);
      expect(seg.frameY + seg.height).toBeLessThanOrEqual(HUNTER_RIG.frameHeight);
    }
  });
});

describe('palette swaps (§4.4)', () => {
  const palette: PaletteSpec = { hueShiftDeg: 62, saturationScale: 1.1, accent: [127, 176, 105], accentBlend: 0.3 };

  it('are deterministic and alpha-preserving; grays stay gray', () => {
    const px = new Uint8ClampedArray([
      200, 60, 40, 255, // saturated red
      128, 128, 128, 255, // gray
      10, 20, 30, 0, // transparent
    ]);
    const a = new Uint8ClampedArray(px);
    const b = new Uint8ClampedArray(px);
    remapPixelData(a, palette);
    remapPixelData(b, palette);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a[7]).toBe(255);
    expect(a[11]).toBe(0);
    // gray pixel unchanged
    expect([a[4], a[5], a[6]]).toEqual([128, 128, 128]);
    // red actually moved
    expect([a[0], a[1], a[2]]).not.toEqual([200, 60, 40]);
  });
});

describe('compositor instance fidelity (§4.2)', () => {
  const parts = [
    { slot: 'Barrel' as const, modifier: { baseDamage: 12, statusChance: 5 } },
    { slot: 'Grip' as const, modifier: { attackSpeed: 8 } },
  ];
  const input: PixelWeaponInput = {
    id: 'fidelity-1',
    name: 'Fidelity Test SMG',
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
    rarity: Rarity.Epic,
    pixelSeed: 777,
    parts,
    affixes: [
      { id: 'a1', category: 'combat', stat: 'damage', value: 12, displayText: '+12' },
      { id: 'a2', category: 'elemental', stat: 'statusChance', value: 5, displayText: '+5' },
    ],
    rollQuality: 88,
  };

  it('spec part variants and compositor part variants agree per slot', () => {
    const spec = buildWeaponVisualSpec({
      weaponType: WeaponType.SMG,
      manufacturer: Manufacturer.Redline,
      rarity: Rarity.Epic,
      element: Element.Fire,
      parts,
      name: 'Fidelity Test SMG',
    } as never);
    // The spec builds its compositor input from exactly these fields.
    const specInput: PixelWeaponInput = {
      weaponType: WeaponType.SMG,
      manufacturer: Manufacturer.Redline,
      rarity: Rarity.Epic,
      element: Element.Fire,
      parts,
      name: 'Fidelity Test SMG',
    };
    for (const slot of ['Barrel', 'Grip', 'Core', 'Magazine', 'Sight', 'Chamber'] as const) {
      expect(spec.partVariants[slot]).toBe(partVariant(specInput, slot, 4));
    }
  });

  it('the full modifier map steers the variants (not just the first entry)', () => {
    const base = composePixelWeapon(input).signature;
    const tweaked = composePixelWeapon({
      ...input,
      parts: [
        { slot: 'Barrel' as const, modifier: { baseDamage: 12, statusChance: 9 } },
        { slot: 'Grip' as const, modifier: { attackSpeed: 8 } },
      ],
    }).signature;
    expect(tweaked).not.toBe(base);
  });

  it('condition treatment changes the render: beat-up ≠ godroll', () => {
    const beatUp = composePixelWeapon({ ...input, rollQuality: 5 });
    const godroll = composePixelWeapon({ ...input, rollQuality: 99 });
    expect(beatUp.condition).toBe('beat-up');
    expect(godroll.condition).toBe('godroll');
    expect(beatUp.signature).not.toBe(godroll.signature);
  });

  it('decals ride the pixel render for affixed instances', () => {
    const render = composePixelWeapon(input);
    expect(render.decals.length).toBeGreaterThan(0);
    const bare = composePixelWeapon({ ...input, affixes: [] });
    expect(bare.decals).toHaveLength(0);
  });
});

describe('performance + payload budgets (§4.9)', () => {
  it('a full stage scene stays inside the animated-node budget', () => {
    const nodes =
      countRigNodes(HUNTER_RIG) + // hunter rig 10
      countRigNodes(enemyRig('brute')) + // enemy rig 4
      3 + // parallax layers
      2 + // animated props
      1 + // weather tint
      1 + // hot pennant
      5 + // tracers (max cadence) + muzzle + sparks + status + hit flash
      5 + // vehicle + 3 affix overlays + status bars
      6; // gear overlays (shield, relic, pauldron, 3 belt)
    expect(nodes).toBeLessThanOrEqual(MOVEMENT.SEGMENT.MAX_ANIMATED_NODES);
    expect(GRAMMAR.card.widthPx).toBeGreaterThan(0);
  });

  it('the shipped sprite payload stays inside the documented ceiling', () => {
    let total = 0;
    for (const entry of Object.values(sprites)) {
      total += statSync(join(process.cwd(), 'src/assets/pixel', entry.src)).size;
    }
    // Master shipped ~6.4MB; the overhaul adds ~3.5MB of rig segments,
    // layers, arenas, props, and vehicles. Ceiling pins the total so
    // future art lands deliberately, not by drift.
    expect(total).toBeLessThan(11 * 1024 * 1024);
  });
});
