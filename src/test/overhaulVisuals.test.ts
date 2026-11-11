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
import { countRigNodes, enemyRig } from '@/lib/pixel/rig';
import { HUNTER_HEAD_VARIANTS } from '@/lib/pixel/headParts';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';
import { countPartNodes } from '@/lib/pixel/parts';
import { remapPixelData, type PaletteSpec } from '@/lib/pixel/paletteSwap';
import { composePixelWeapon, type PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
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

  it('every archetype resolves its sprite and rig kit', () => {
    // The baked death-pose sprites (death-{archetype}-{a,b}) were
    // deleted in the 2026-11-07 hero ship slice: nothing ever rendered
    // them — stage death is played by the rig's `death` pose — and they
    // cost 244,492 B of payload. Do not re-add them here; if death
    // poses return, they are authored on the rig, not baked flats.
    for (const archetype of ['fodder', 'runner', 'brute', 'sniper', 'elite']) {
      const rig = enemyRig(archetype);
      for (const seg of rig.segments) expect(has(seg.spriteId), seg.spriteId).toBe(true);
    }
    for (const part of Object.values(STANDARD_ISSUE.parts)) {
      if (part) expect(has(part.spriteId), part.spriteId).toBe(true);
    }
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
    expect(arenaIds.size).toBe(REGION_1_BOSSES.length);
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

  it('part anchors stay inside their part frames', () => {
    for (const part of Object.values(STANDARD_ISSUE.parts)) {
      if (!part) continue;
      for (const anchor of Object.values(part.anchors)) {
        expect(anchor.x).toBeGreaterThanOrEqual(0);
        expect(anchor.x).toBeLessThanOrEqual(part.width);
        expect(anchor.y).toBeGreaterThanOrEqual(0);
        expect(anchor.y).toBeLessThanOrEqual(part.height);
      }
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
  // Note: the old "spec part variants and compositor part variants
  // agree per slot" case pinned buildWeaponVisualSpec against the
  // compositor. Gear slice 5 deleted buildWeaponVisualSpec (its
  // only live consumers were the retired gear SVG spec builders),
  // leaving the compositor's partVariant as the single source —
  // the two-source agreement the case guarded no longer exists
  // to drift.
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
      countPartNodes(STANDARD_ISSUE) + // hunter parts 10
      1 + // held weapon layer
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

  it('a full V1 vista stage stays inside the animated-node budget', () => {
    // The vista composition swaps the DOM dressing, nothing else:
    // the 3 parallax re-cut strips become 3 tileable band strips,
    // and the 2 drifting aprops + the generic ember spans are
    // superseded by 4 ambient canvases (far/mid/near/stage) whose
    // elements instance from scene data — canvas draws, not DOM
    // nodes, so the count is the canvases themselves.
    const nodes =
      countPartNodes(STANDARD_ISSUE) + // hunter parts 10
      1 + // held weapon layer
      countRigNodes(enemyRig('brute')) + // enemy rig 4
      3 + // vista band strips
      4 + // ambient canvases (far, mid, near, stage)
      1 + // weather tint
      1 + // hot pennant
      5 + // tracers (max cadence) + muzzle + sparks + status + hit flash
      5 + // vehicle + 3 affix overlays + status bars
      6; // gear overlays (shield, relic, pauldron, 3 belt)
    expect(nodes).toBeLessThanOrEqual(MOVEMENT.SEGMENT.MAX_ANIMATED_NODES);
  });

  it('the shipped sprite payload stays inside the documented ceiling', () => {
    let total = 0;
    for (const entry of Object.values(sprites)) {
      total += statSync(join(process.cwd(), 'src/assets/pixel', entry.src)).size;
    }
    // Master shipped ~6.4MB; the overhaul adds ~3.5MB of rig segments,
    // layers, arenas, props, and vehicles. Ceiling pins the total so
    // future art lands deliberately, not by drift.
    // M4 (0053) raises the ceiling DELIBERATELY for the first skin
    // wave, with per-skin accounting (manifest-registered bytes):
    // pre-M4 total 11,375,686 B; Bulwark (T3 shaped, 10 parts)
    // +139,971 B; Dreadplate (T2 repaint, 10 parts) +87,194 B;
    // wave-1 total 11,602,851 B. The new ceiling leaves ~17 KB of
    // headroom — the next skin lands with its own accounting and
    // its own deliberate raise, exactly like this one.
    // Hero pxl ship (2026-11-07): the character conversion REPLACED
    // the 39 baked character sprites (413,061 B on this tree) with
    // pxl-authored renders — 38 ship (34,483 B incl. the retained H1
    // hood cowl; the pxl hood was excluded by owner ruling) for
    // −378,578 B — and the 10 never-rendered death-pose sprites were
    // deleted (−244,492 B). Post-ship total 10,971,493 B. The ceiling
    // is NOT lowered: it stays 11,620,000 by owner ruling (held
    // deliberately, 2026-11-06), and the freed ~649 KB is headroom
    // for the bestiary conversion, which lands with its own
    // accounting exactly like this one.
    // V1 vista landing (2026-11-07): the 28 zone paintings (JPG
    // stacks, 2,753,117 B) leave the bundle; the eight authored
    // vista sets (bands + ambient + camp props, 66,305 B) replace
    // them — a −2,686,812 B delta; manifest-sum total on this tree
    // after landing: 8,260,959 B. The ceiling stays 11,620,000 by
    // the same owner ruling.
    // V4 legendaries (2026-11-08): the 26 bespoke legendary weapon
    // PNGs (1,478,328 B) leave the bundle; each legendary is now a
    // hand-authored pxl piece set in legendaryAuthoredData.ts
    // (code-side data, outside this manifest sum) rendering through
    // the weapon compositors. Manifest-sum total after V4:
    // 6,782,631 B. The ceiling stays 11,620,000 by the same owner
    // ruling — held, not lowered.
    // Top-Choice INT-3 hero (2026-11-11): the 42 adopted Wave 8
    // painterly part masters replace the pxl part sprites at 4x
    // definition (PartDef frame x texel 4), palette-256 encoded —
    // the same declared-dimensions convention the V1 vista sets
    // and the INT-1 legendaries already ship (manifest width/height
    // are FILE pixels: design frame x texel). Hero family 59,346 B
    // -> 1,175,189 B (+1,115,843 B; per-part accounting in
    // scripts/top-choice-hero-swap.py and the INT-3 PR body).
    // Dread Head has no master (two pipeline refusals; owner
    // ruling: leave) and its sprite is unchanged; the hood is
    // untouched. This branch also carries INT-7's cache family
    // (manifest 308 entries). Measured manifest total on this
    // tree: 8,927,197 B. The ceiling moves DELIBERATELY to the
    // measured total of this branch, per the Top-Choice adoption
    // accounting; final reconciliation lands when all slices merge.
    expect(total).toBeLessThan(8_927_197 + 1);
  });
});
