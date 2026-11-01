/**
 * Golden scene specs (visual overhaul addendum) — fixed, seeded stage
 * compositions rendered through the reference renderer
 * (src/lib/pixel/sceneRenderer.ts) and pixel-diffed against committed
 * baselines. Every input is a literal: the weapon is a fixed instance
 * through the REAL compositor, enemy palettes run the REAL remap core,
 * rigs pose at phase-frozen angles. Change the art, the palettes, the
 * rig, or the compositor and the matching golden fails — by design.
 * Baselines are reviewed by Muse (Michael's ruling: he gates the art
 * direction at G0–G4, never individual diffs); regenerate with
 * `npm run golden:update`.
 */
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { AREA_VISUALS, PIXEL_BOSS_ARENAS, endlessBandTint } from '@/content/areaPalettes';
import { CACHE_RANK_BONUS_DEFS } from '@/content/cacheRank';
import { endlessDepthBand, endlessEncounterForDepth } from '@/content/endless';
import { ELEMENT_DIALECTS, shotCadence } from '@/lib/pixel/elementFx';
import { GRAMMAR } from '@/lib/pixel/grammar';
import { decodePng, type RgbaImage } from '@/lib/pixel/pngCodec';
import { blit, drawBeam, drawHeldWeapon, drawLine, drawRig, drawWeaponRender, fillRect, hexToRgb, hunterBox, newCanvas, SCENE_H, SCENE_W } from '@/lib/pixel/sceneRenderer';
import { ENEMY_POSES, HUNTER_POSES, enemyRig, HUNTER_RIG } from '@/lib/pixel/rig';
import type { PixelWeaponInput } from '@/lib/pixel/weaponCompositor';
import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SPRITES_DIR = join(process.cwd(), 'src/assets/pixel/sprites');
const GOLDEN_ASSETS = join(process.cwd(), 'src/test/golden/assets');

const imageCache = new Map<string, RgbaImage | undefined>();

/** Loader: PNG sprites from the shipped library; JPG-backed scene art
 *  (zone backgrounds, arenas) from the quantized PNG twins. */
export function loadGoldenSprite(spriteId: string): RgbaImage | undefined {
  if (imageCache.has(spriteId)) return imageCache.get(spriteId);
  let image: RgbaImage | undefined;
  try {
    image = decodePng(new Uint8Array(readFileSync(join(SPRITES_DIR, `${spriteId}.png`))));
  } catch {
    try {
      image = decodePng(new Uint8Array(readFileSync(join(GOLDEN_ASSETS, `${spriteId}.png`))));
    } catch {
      image = undefined;
    }
  }
  imageCache.set(spriteId, image);
  return image;
}

export const GOLDEN_WEAPON: PixelWeaponInput = {
  id: 'golden-weapon',
  name: 'Golden Test Rifle',
  weaponType: WeaponType.SMG,
  manufacturer: Manufacturer.Redline,
  element: Element.Shock,
  rarity: Rarity.Epic,
  pixelSeed: 4242,
  affixes: [
    { id: 'golden-affix-1', category: 'combat', stat: 'damage', value: 12, displayText: '+12 damage' },
    { id: 'golden-affix-2', category: 'elemental', stat: 'fireRate', value: 8, displayText: '+8 fire rate' },
  ],
  rollQuality: 88,
};

const GROUND = 0.86;
const AREA_BG: Record<string, string> = Object.fromEntries(ROAMING_AREAS.map((a) => [a.id, `zone-${a.id.split('_')[0]}-bg`]));

function drawBackground(img: RgbaImage, bgId: string): void {
  const bg = loadGoldenSprite(bgId);
  if (bg) blit(img, bg, 0, 0, SCENE_W, SCENE_H);
}

function drawHunter(img: RgbaImage, pose: keyof typeof HUNTER_POSES, withWeapon = true): void {
  drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES[pose], xPct: 22, heightPct: 57, feetX: 0.2717 }, GROUND);
  if (withWeapon) drawHeldWeapon(img, GOLDEN_WEAPON, hunterBox(img, 22, 57, GROUND));
}

function drawEnemy(img: RgbaImage, areaId: string, archetype: string, pose: keyof typeof ENEMY_POSES): void {
  const visuals = AREA_VISUALS[areaId as keyof typeof AREA_VISUALS];
  drawRig(
    img,
    loadGoldenSprite,
    { rig: enemyRig(archetype), pose: ENEMY_POSES[pose], xPct: 74, heightPct: 66, feetX: 0.5, palette: visuals.enemyPalette },
    GROUND,
  );
}

export interface GoldenScene {
  id: string;
  render: () => RgbaImage;
}

function scene(id: string, draw: (img: RgbaImage) => void): GoldenScene {
  return {
    id,
    render: () => {
      const img = newCanvas();
      draw(img);
      return img;
    },
  };
}

const ARCHETYPE_BY_AREA: Record<string, string> = {
  dustwaste_frontier: 'brute',
  redline_circuit: 'runner',
  ironwood_bastion: 'brute',
  blastforge_yards: 'fodder',
  prismatek_reactor: 'sniper',
  throwtech_dumpnet: 'fodder',
  helixworks_labyrinth: 'sniper',
};

export const GOLDEN_SCENES: GoldenScene[] = [
  // Roaming stage per area (parallax plate + palette enemy + rig).
  ...ROAMING_AREAS.map((area) =>
    scene(`roam-${area.id.split('_')[0]}`, (img) => {
      drawBackground(img, AREA_BG[area.id]);
      const visuals = AREA_VISUALS[area.id as keyof typeof AREA_VISUALS];
      fillRect(img, 0, 0, SCENE_W, SCENE_H * 0.46, hexToRgb(visuals.skyTint), 30);
      drawHunter(img, 'aim');
      drawEnemy(img, area.id, ARCHETYPE_BY_AREA[area.id], 'idle');
    }),
  ),
  // Hot-area treatment on the Dustwaste stage.
  scene('roam-hot', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    fillRect(img, 0, 0, SCENE_W, SCENE_H * 0.46, hexToRgb('#f2c063'), 60);
    const pennant = loadGoldenSprite('prop-hot-pennant');
    if (pennant) blit(img, pennant, SCENE_W - 44, 6, 36, 36);
    drawHunter(img, 'aim');
    drawEnemy(img, 'dustwaste_frontier', 'brute', 'idle');
  }),
  // The bespoke Dustwaste elite on stage.
  scene('elite-dustwaste', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    drawHunter(img, 'aim');
    const marshal = loadGoldenSprite('elite-silt-marshal');
    if (marshal) {
      const h = SCENE_H * 0.74;
      const w = h * (marshal.width / marshal.height);
      blit(img, marshal, SCENE_W * 0.74 - w * 0.48, GROUND * SCENE_H - h, w, h);
    }
    const banner = loadGoldenSprite('prop-elite-banner');
    if (banner) blit(img, banner, SCENE_W * 0.88 - 14, GROUND * SCENE_H - 62, 28, 62);
  }),
  // Boss arenas (unique per boss, Q3).
  ...Object.entries(PIXEL_BOSS_ARENAS).map(([bossId, arena]) =>
    scene(`arena-${bossId.replace(/_/g, '-')}`, (img) => {
      drawBackground(img, arena.backgroundId);
      drawHunter(img, 'aim');
      const prop = loadGoldenSprite(arena.propId);
      if (prop) blit(img, prop, SCENE_W * 0.5 - 24, GROUND * SCENE_H - 52, 48, 52);
      const bossSprite = loadGoldenSprite(`boss-${bossId.replace(/_/g, '-')}`);
      if (bossSprite) {
        const h = SCENE_H * 0.8;
        const w = h * (bossSprite.width / bossSprite.height);
        blit(img, bossSprite, SCENE_W * 0.76 - w * 0.63, GROUND * SCENE_H - h, w, h);
      }
    }),
  ),
  // Loot moments per rarity (G-1 beam + G-2 card geometry).
  ...([Rarity.Common, Rarity.Uncommon, Rarity.Rare, Rarity.Epic, Rarity.Legendary] as const).map((rarity) =>
    scene(`loot-${rarity.toLowerCase()}`, (img) => {
      drawBackground(img, AREA_BG.dustwaste_frontier);
      drawHunter(img, 'celebrate', false);
      drawEnemy(img, 'dustwaste_frontier', 'brute', 'death');
      const color = rarity === Rarity.Legendary ? '#FFD166' : rarity === Rarity.Epic ? '#B18CFF' : rarity === Rarity.Rare ? '#57B8FF' : rarity === Rarity.Uncommon ? '#7FB069' : '#C9CDD4';
      const lootX = SCENE_W * 0.74;
      drawBeam(img, lootX, GROUND * SCENE_H, GRAMMAR.beamWidthPx[rarity === Rarity.Legendary ? 'legendary' : rarity === Rarity.Epic || rarity === Rarity.Rare ? 'high' : 'standard'], color);
      // G-2 card: one geometry everywhere.
      const cardW = GRAMMAR.card.widthPx;
      fillRect(img, lootX - cardW / 2, GROUND * SCENE_H - 118, cardW, 64, [10, 12, 16], 235);
      fillRect(img, lootX - cardW / 2, GROUND * SCENE_H - 118, cardW, 4, hexToRgb(color), 255);
      drawWeaponRender(img, { ...GOLDEN_WEAPON, rarity }, lootX - 48, GROUND * SCENE_H - 104, 96, 35);
    }),
  ),
  // Element FX reel (G3): one frame per element dialect.
  ...Object.values(Element).map((element) =>
    scene(`fx-${element.toLowerCase()}`, (img) => {
      drawBackground(img, AREA_BG.dustwaste_frontier);
      const weapon = { ...GOLDEN_WEAPON, element };
      drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.recoil, xPct: 22, heightPct: 57, feetX: 0.2717 }, GROUND);
      drawHeldWeapon(img, weapon, hunterBox(img, 22, 57, GROUND));
      drawEnemy(img, 'dustwaste_frontier', 'brute', 'hit');
      const dialect = ELEMENT_DIALECTS[element];
      const cadence = shotCadence(weapon.weaponType, 1.2);
      const fromX = SCENE_W * 0.36;
      const fromY = SCENE_H * 0.44;
      const toX = SCENE_W * 0.72;
      const toY = SCENE_H * 0.42;
      for (let i = 0; i < cadence.tracerCount; i++) {
        const offset = (i - (cadence.tracerCount - 1) / 2) * cadence.spreadPct * 2.56;
        drawLine(img, fromX, fromY, toX, toY + offset, hexToRgb(dialect.tracerColor), dialect.tracerWidth);
      }
      const status = loadGoldenSprite(dialect.statusSpriteId);
      if (status) blit(img, status, toX - 18, toY - 18, 36, 36);
    }),
  ),
  // Action scenes (G4): crafting bench + repair bay.
  scene('bench', (img) => {
    drawBackground(img, AREA_BG.blastforge_yards);
    const bench = loadGoldenSprite('set-bench-forge');
    if (bench) blit(img, bench, SCENE_W * 0.58 - 52, GROUND * SCENE_H - 62, 104, 62);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.62, GRAMMAR.progress.heightPx, [245, 181, 68], 255);
  }),
  // Reforge (0027): the bench moment for an affix swap — the item on
  // the forge bench under the hunter's hands, the new affix landing
  // with the G-1 beam in the item's rarity read (Epic here), and the
  // work track full. Work grammar, not the loot ladder: no card.
  scene('reforge-bench', (img) => {
    drawBackground(img, AREA_BG.blastforge_yards);
    drawBeam(img, SCENE_W * 0.58, GROUND * SCENE_H - 40, GRAMMAR.beamWidthPx.high, '#B18CFF');
    const bench = loadGoldenSprite('set-bench-forge');
    if (bench) blit(img, bench, SCENE_W * 0.58 - 52, GROUND * SCENE_H - 62, 104, 62);
    drawWeaponRender(img, GOLDEN_WEAPON, SCENE_W * 0.58 - 44, GROUND * SCENE_H - 78, 88, 32);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [245, 181, 68], 255);
  }),
  // Action skill (0030, Fixer brief §3.7): bench-overdrive — the
  // Workshop at the Overclock fire. The in-progress unit sits on the
  // forge bench under the G-1 beam in Fixer teal; the G-3 charge
  // track at the stage floor reads FULL in the same teal (the pool
  // at the instant before it spends). Composition follows
  // reforge-bench; the teal is the Fixer's alone.
  scene('bench-overdrive', (img) => {
    drawBackground(img, AREA_BG.blastforge_yards);
    drawBeam(img, SCENE_W * 0.58, GROUND * SCENE_H - 40, GRAMMAR.beamWidthPx.high, '#2EC4B6');
    const bench = loadGoldenSprite('set-bench-forge');
    if (bench) blit(img, bench, SCENE_W * 0.58 - 52, GROUND * SCENE_H - 62, 104, 62);
    drawWeaponRender(img, GOLDEN_WEAPON, SCENE_W * 0.58 - 44, GROUND * SCENE_H - 78, 88, 32);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    // G-3 charge track: full, Fixer teal.
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [46, 196, 182], 255);
  }),
  // Action skill (0030): the boss-stage signature fire — Deadeye
  // Salvo landing. The hunter fires from the aim pose; the G-1 beam
  // in Gunslinger red stands over the struck boss-side enemy, and
  // the charge track at the floor reads EMPTY (the pool just spent).
  scene('boss-signature-fire', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    drawBeam(img, SCENE_W * 0.74, GROUND * SCENE_H, GRAMMAR.beamWidthPx.high, '#FF4B5C');
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.recoil, xPct: 22, heightPct: 57, feetX: 0.2717 }, GROUND);
    drawHeldWeapon(img, GOLDEN_WEAPON, hunterBox(img, 22, 57, GROUND));
    drawEnemy(img, 'dustwaste_frontier', 'brute', 'hit');
    // G-3 charge track: spent — the empty track is the state.
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
  }),
  scene('bay', (img) => {
    drawBackground(img, AREA_BG.throwtech_dumpnet);
    const lift = loadGoldenSprite('set-bay-lift');
    if (lift) blit(img, lift, SCENE_W * 0.62 - 56, GROUND * SCENE_H - 66, 112, 66);
    const vehicle = loadGoldenSprite('vehicle-dune-buggy');
    if (vehicle) blit(img, vehicle, SCENE_W * 0.44, GROUND * SCENE_H - 44, 108, 54);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 24, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.35, GRAMMAR.progress.heightPx, [127, 176, 105], 255);
  }),
  // Repair services (0025): the bay at rest — vehicle on the lift,
  // no work pose, empty progress track — and at delivery: full bar,
  // success flash implied by the complete track + work pose released.
  scene('bay-idle', (img) => {
    drawBackground(img, AREA_BG.throwtech_dumpnet);
    const lift = loadGoldenSprite('set-bay-lift');
    if (lift) blit(img, lift, SCENE_W * 0.62 - 56, GROUND * SCENE_H - 66, 112, 66);
    const vehicle = loadGoldenSprite('vehicle-dune-buggy');
    if (vehicle) blit(img, vehicle, SCENE_W * 0.44, GROUND * SCENE_H - 44, 108, 54);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.idle, xPct: 24, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
  }),
  scene('bay-complete', (img) => {
    drawBackground(img, AREA_BG.throwtech_dumpnet);
    const lift = loadGoldenSprite('set-bay-lift');
    if (lift) blit(img, lift, SCENE_W * 0.62 - 56, GROUND * SCENE_H - 66, 112, 66);
    const vehicle = loadGoldenSprite('vehicle-dune-buggy');
    if (vehicle) blit(img, vehicle, SCENE_W * 0.44, GROUND * SCENE_H - 44, 108, 54);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.celebrate, xPct: 24, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [127, 176, 105], 255);
  }),
  // Crafting-as-occupation (0024, brief §2.9): the bench stage per
  // bench tier + the paused state (hunter away roaming — bench stands
  // idle-dark under its pennant, progress frozen mid-bar).
  scene('bench-basic', (img) => {
    drawBackground(img, AREA_BG.blastforge_yards);
    const bench = loadGoldenSprite('set-bench-basic');
    if (bench) blit(img, bench, SCENE_W * 0.58 - 52, GROUND * SCENE_H - 62, 104, 62);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.25, GRAMMAR.progress.heightPx, [245, 181, 68], 255);
  }),
  scene('bench-lab', (img) => {
    drawBackground(img, AREA_BG.blastforge_yards);
    const bench = loadGoldenSprite('set-bench-lab');
    if (bench) blit(img, bench, SCENE_W * 0.58 - 52, GROUND * SCENE_H - 62, 104, 62);
    const furnace = loadGoldenSprite('set-refinery-furnace');
    if (furnace) blit(img, furnace, SCENE_W * 0.86 - 34, GROUND * SCENE_H - 54, 68, 54);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.8, GRAMMAR.progress.heightPx, [245, 181, 68], 255);
  }),
  scene('bench-paused', (img) => {
    drawBackground(img, AREA_BG.blastforge_yards);
    const bench = loadGoldenSprite('set-bench-forge');
    if (bench) blit(img, bench, SCENE_W * 0.58 - 52, GROUND * SCENE_H - 62, 104, 62);
    fillRect(img, 0, 0, SCENE_W, SCENE_H, [0, 0, 0], 110); // idle-dark while the hunter roams
    const pennant = loadGoldenSprite('prop-hot-pennant');
    if (pennant) blit(img, pennant, SCENE_W - 44, 6, 36, 36);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.62, GRAMMAR.progress.heightPx, [154, 149, 138], 255);
  }),
  // Vehicle at the scene edge (Q4 parked presentation).
  scene('vehicle-roam', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    const vehicle = loadGoldenSprite('vehicle-cargo-hauler');
    if (vehicle) blit(img, vehicle, 2, GROUND * SCENE_H - 40, 82, 41);
    const rack = loadGoldenSprite('vehicle-affix-cargo-rack');
    if (rack) blit(img, rack, 2, GROUND * SCENE_H - 40, 82, 41);
    drawHunter(img, 'aim');
    drawEnemy(img, 'dustwaste_frontier', 'runner', 'idle');
  }),
  // Collections (0026): the trophy shelf. Found legendaries sit in
  // full color on the top plank — the center frame under the G-1
  // legendary beam — while the unproven entries below read as dark
  // silhouettes (weapon renders + a boss plate, darkened through a
  // temp canvas so the cached sprites are never mutated). The hunter
  // stands off at idle, admiring the shelf; the war-room table fronts
  // the stage and the progress strip reads shelf completion.
  scene('collections-shelf', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    // Trophy-wall treatment: the stage darkens (the bench-paused
    // idle-dark move) so the shelf reads as an interior wall — found
    // pieces glow in color, unproven pieces read as dark silhouettes
    // on slate plaques.
    fillRect(img, 0, 0, SCENE_W, SCENE_H, [8, 8, 12], 96);
    fillRect(img, 0, 0, SCENE_W, SCENE_H * 0.46, hexToRgb('#f2c063'), 18);
    const groundY = GROUND * SCENE_H;
    // Shelf planks + brackets.
    for (const plankY of [118, 172]) {
      fillRect(img, 96, plankY, 264, 5, [58, 42, 30], 255);
      fillRect(img, 96, plankY, 264, 1, [122, 92, 58], 255);
      fillRect(img, 108, plankY + 5, 4, 10, [40, 30, 22], 255);
      fillRect(img, 344, plankY + 5, 4, 10, [40, 30, 22], 255);
    }
    // Silhouette plaques on the lower plank (behind the ghosts).
    for (const plaqueX of [104, 192, 280]) {
      fillRect(img, plaqueX, 172 - 52, 80, 50, [15, 17, 23], 235);
      fillRect(img, plaqueX, 172 - 52, 80, 2, [96, 96, 108], 255);
    }
    // Found shelf: three legendary frames in color; the center one
    // carries the loot-moment beam (the logged-legendary read).
    const found: PixelWeaponInput[] = [
      { id: 'shelf-1', weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Prismatek, rarity: Rarity.Legendary, element: Element.Void, pixelSeed: 777, rollQuality: 92 },
      { id: 'shelf-2', weaponType: WeaponType.SMG, manufacturer: Manufacturer.Redline, rarity: Rarity.Legendary, element: Element.Shock, pixelSeed: 31337, rollQuality: 88 },
      { id: 'shelf-3', weaponType: WeaponType.Shotgun, manufacturer: Manufacturer.BlastForge, rarity: Rarity.Legendary, element: Element.Fire, pixelSeed: 5150, rollQuality: 84 },
    ];
    drawBeam(img, 228, 118, GRAMMAR.beamWidthPx.legendary, '#FFD166');
    found.forEach((weapon, i) => {
      drawWeaponRender(img, weapon, 108 + i * 88, 118 - 32, 80, 30);
    });
    // Missing shelf: silhouettes only — two frames and a boss plate.
    const ghostWeapon = (weapon: PixelWeaponInput, x: number) => {
      const temp = newCanvas();
      drawWeaponRender(temp, weapon, x, 172 - 32, 80, 30);
      for (let i = 0; i < temp.data.length; i += 4) {
        if (temp.data[i + 3] > 0) {
          temp.data[i] = 44; temp.data[i + 1] = 48; temp.data[i + 2] = 58;
        }
      }
      blit(img, temp, 0, 0, SCENE_W, SCENE_H);
    };
    ghostWeapon({ id: 'shelf-g1', weaponType: WeaponType.Launcher, manufacturer: Manufacturer.ThrowTech, rarity: Rarity.Legendary, pixelSeed: 606, rollQuality: 70 }, 108);
    ghostWeapon({ id: 'shelf-g2', weaponType: WeaponType.Pistol, manufacturer: Manufacturer.HelixWorks, rarity: Rarity.Legendary, pixelSeed: 909, rollQuality: 70 }, 196);
    const boss = loadGoldenSprite('boss-dune-tyrant');
    if (boss) {
      const ghost = { width: boss.width, height: boss.height, data: new Uint8Array(boss.data) };
      for (let i = 0; i < ghost.data.length; i += 4) {
        if (ghost.data[i + 3] > 0) {
          ghost.data[i] = 52; ghost.data[i + 1] = 57; ghost.data[i + 2] = 68;
        }
      }
      const h = 48;
      const w = h * (boss.width / boss.height);
      blit(img, ghost, 322 - w / 2, 172 - h, w, h);
    }
    // The hunter + the war-room table fronting the stage.
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.idle, xPct: 11, heightPct: 46, feetX: 0.2717 }, GROUND);
    const table = loadGoldenSprite('set-war-room-table');
    if (table) blit(img, table, SCENE_W * 0.47 - 55, groundY - 30, 110, 30);
    // Shelf progress strip (amber, the bench scenes' progress read).
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.31, GRAMMAR.progress.heightPx, [255, 152, 0], 255);
  }),
  // Cache Rank (0031): the rank board on the trophy wall. The seven
  // tracks render as pip rows in their own colors (rows and colors
  // derive from CACHE_RANK_BONUS_DEFS, so a menu change repaints
  // here), filled to a fixed sample spend set; the unspent token
  // emblem — an amber diamond — hangs over the board under a thin
  // beam, and the floor strip reads progress to the next token in
  // rank amber. Same interior grammar as collections-shelf; the
  // hunter stands off at idle, reading the board.
  scene('cache-rank-panel', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    fillRect(img, 0, 0, SCENE_W, SCENE_H, [8, 8, 12], 96);
    fillRect(img, 0, 0, SCENE_W, SCENE_H * 0.46, hexToRgb('#f2c063'), 18);
    // Board backplate + header rule.
    fillRect(img, 158, 40, 284, 168, [13, 15, 21], 242);
    fillRect(img, 158, 40, 284, 2, hexToRgb('#f2c063'), 255);
    fillRect(img, 158, 206, 284, 2, [58, 42, 30], 255);
    // Token emblem: nested amber squares (the diamond read) + beam.
    drawBeam(img, 300, 40, GRAMMAR.beamWidthPx.low, '#F2C063');
    for (const [half, color] of [[13, '#8a6a24'], [10, '#f2c063'], [5, '#ffe1a1']] as const) {
      fillRect(img, 300 - half, 62 - half, half * 2, half * 2, hexToRgb(color), 255);
    }
    // Track rows: 10 pips each — filled in the track color to the
    // sample rank, the rest dark slate.
    const sampleSpends: Record<string, number> = { credits: 6, xp: 4, scrap: 3, damage: 2, maxHp: 5, cacheQuality: 1, marketProceeds: 0 };
    CACHE_RANK_BONUS_DEFS.forEach((def, row) => {
      const y = 88 + row * 16;
      fillRect(img, 170, y + 1, 6, 6, hexToRgb(def.color), 255);
      const filled = sampleSpends[def.id] ?? 0;
      for (let pip = 0; pip < def.maxRanks; pip += 1) {
        const x = 186 + pip * 24;
        if (pip < filled) fillRect(img, x, y, 18, 8, hexToRgb(def.color), 255);
        else fillRect(img, x, y, 18, 8, [34, 38, 48], 255);
      }
    });
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.idle, xPct: 8, heightPct: 44, feetX: 0.2717 }, GROUND);
    // Next-token progress strip in rank amber.
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.62, GRAMMAR.progress.heightPx, [242, 192, 99], 255);
  }),
  // Endless (0028): the Chaos Chamber's depth treatment — the band
  // wash over the arena (ENDLESS_BAND_TINTS, the same table the live
  // stage overlays) plus the depth track across the top: 25 pips,
  // five per band, filled to the current depth in their band colors.
  // Depths/areas/bosses derive from the real rotation rules
  // (endlessEncounterForDepth), so a rotation change repaints here.
  ...([1, 12, 25] as const).map((depth) => {
    const encounter = endlessEncounterForDepth(depth, 30);
    const band = endlessDepthBand(depth);
    const tint = endlessBandTint(band);
    return scene(`endless-depth-${depth}`, (img) => {
      if (encounter.kind === 'boss') {
        const arena = PIXEL_BOSS_ARENAS[encounter.id];
        drawBackground(img, arena.backgroundId);
        if (tint.alpha > 0) fillRect(img, 0, 0, SCENE_W, SCENE_H, hexToRgb(tint.color), Math.round(tint.alpha * 255));
        drawHunter(img, 'aim');
        const prop = loadGoldenSprite(arena.propId);
        if (prop) blit(img, prop, SCENE_W * 0.5 - 24, GROUND * SCENE_H - 52, 48, 52);
        const bossSprite = loadGoldenSprite(`boss-${encounter.id.replace(/_/g, '-')}`);
        if (bossSprite) {
          const h = SCENE_H * 0.8;
          const w = h * (bossSprite.width / bossSprite.height);
          blit(img, bossSprite, SCENE_W * 0.76 - w * 0.63, GROUND * SCENE_H - h, w, h);
        }
      } else {
        drawBackground(img, AREA_BG[encounter.areaId]);
        if (tint.alpha > 0) fillRect(img, 0, 0, SCENE_W, SCENE_H, hexToRgb(tint.color), Math.round(tint.alpha * 255));
        drawHunter(img, 'aim');
        drawEnemy(img, encounter.areaId, ARCHETYPE_BY_AREA[encounter.areaId], 'idle');
      }
      // Depth track: backplate + 25 pips (5 bands × 5).
      const trackW = SCENE_W - 24;
      fillRect(img, 10, 6, trackW + 4, GRAMMAR.progress.heightPx + 4, [5, 6, 8], 220);
      const cellW = trackW / 25;
      for (let i = 0; i < 25; i++) {
        const pipBand = Math.floor(i / 5);
        const filled = i < depth;
        const color = filled ? hexToRgb(endlessBandTint(pipBand).color) : ([38, 40, 48] as const);
        fillRect(img, 12 + i * cellW + 1, 8, cellW - 2, GRAMMAR.progress.heightPx, [color[0], color[1], color[2]], 255);
      }
    });
  }),
];
