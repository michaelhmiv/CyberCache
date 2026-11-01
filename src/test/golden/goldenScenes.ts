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
import { REGION_1_BOSSES } from '@/constants/bosses';
import { MANUFACTURERS } from '@/constants/manufacturers';
import {
  STANDING_RANKS,
  buildStandingStateView,
  type StandingFacts,
  type StandingStateView,
} from '@/content/manufacturerStanding';
import {
  contractBandById,
  contractSetSeed,
  contractTargetFor,
  drawContractSet,
  resolveContractLevers,
  type ContractFamily,
} from '@/content/contracts';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { AREA_VISUALS, PIXEL_BOSS_ARENAS, endlessBandTint } from '@/content/areaPalettes';
import { CACHE_RANK_BONUS_DEFS } from '@/content/cacheRank';
import { endlessDepthBand, endlessEncounterForDepth } from '@/content/endless';
import { ELEMENT_DIALECTS, shotCadence } from '@/lib/pixel/elementFx';
import { GRAMMAR } from '@/lib/pixel/grammar';
import { decodePng, type RgbaImage } from '@/lib/pixel/pngCodec';
import { blit, drawBeam, drawHeldWeapon, drawLine, drawRig, drawWeaponRender, fillRect, hexToRgb, hunterBox, newCanvas, SCENE_H, SCENE_W } from '@/lib/pixel/sceneRenderer';
import { ENEMY_POSES, HUNTER_POSES, enemyRig, HUNTER_RIG, HUNTER_RIG_UNARMED } from '@/lib/pixel/rig';
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
  // Real-item invariant: no held weapon drawn ⟺ the gun-free rig —
  // the armed rig's segments carry a rifle baked into the shipped art.
  const rig = withWeapon ? HUNTER_RIG : HUNTER_RIG_UNARMED;
  drawRig(img, loadGoldenSprite, { rig, pose: HUNTER_POSES[pose], xPct: 22, heightPct: 57, feetX: 0.2717 }, GROUND);
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
  // Unarmed hunter (real-item invariant): the reported bug — no weapon
  // equipped must render NO weapon, roaming and in the boss arena.
  scene('roam-unarmed', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    drawHunter(img, 'idle', false);
    drawEnemy(img, 'dustwaste_frontier', 'brute', 'idle');
  }),
  scene('arena-unarmed', (img) => {
    const arena = PIXEL_BOSS_ARENAS.dune_tyrant;
    drawBackground(img, arena.backgroundId);
    drawHunter(img, 'idle', false);
    const prop = loadGoldenSprite(arena.propId);
    if (prop) blit(img, prop, SCENE_W * 0.5 - 24, GROUND * SCENE_H - 52, 48, 52);
    const bossSprite = loadGoldenSprite('boss-dune-tyrant');
    if (bossSprite) {
      const h = SCENE_H * 0.8;
      const w = h * (bossSprite.width / bossSprite.height);
      blit(img, bossSprite, SCENE_W * 0.76 - w * 0.63, GROUND * SCENE_H - h, w, h);
    }
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
  // Extraction (0033): the hunter working a Dustwaste claim — stake
  // line, sift rig, sorted crates, the work pose with the weapon
  // slung (no held weapon, no vehicle in frame by law). The work
  // track runs at pass pace; a signature find reads as a G-1 high
  // beam over the crates, never the legendary ladder.
  scene('extraction-surface', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    const stakes = loadGoldenSprite('set-extract-stakes');
    if (stakes) blit(img, stakes, SCENE_W * 0.14 - 42, GROUND * SCENE_H - 52, 84, 52);
    const rigPiece = loadGoldenSprite('set-extract-rig');
    if (rigPiece) blit(img, rigPiece, SCENE_W * 0.58 - 52, GROUND * SCENE_H - 62, 104, 62);
    const crates = loadGoldenSprite('set-extract-crates');
    if (crates) blit(img, crates, SCENE_W * 0.86 - 42, GROUND * SCENE_H - 52, 84, 52);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    drawBeam(img, SCENE_W * 0.86, GROUND * SCENE_H - 30, GRAMMAR.beamWidthPx.high, '#E8B33C');
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.45, GRAMMAR.progress.heightPx, [232, 179, 60], 255);
  }),
  // Deep Delve: the light drops indigo, the rig works bigger.
  scene('extraction-deep', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    const stakes = loadGoldenSprite('set-extract-stakes');
    if (stakes) blit(img, stakes, SCENE_W * 0.14 - 42, GROUND * SCENE_H - 52, 84, 52);
    const rigPiece = loadGoldenSprite('set-extract-rig');
    if (rigPiece) blit(img, rigPiece, SCENE_W * 0.58 - 62, GROUND * SCENE_H - 74, 124, 74);
    const crates = loadGoldenSprite('set-extract-crates');
    if (crates) blit(img, crates, SCENE_W * 0.86 - 42, GROUND * SCENE_H - 52, 84, 52);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 0, 0, SCENE_W, SCENE_H, [49, 46, 129], 90); // delve shade
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.45, GRAMMAR.progress.heightPx, [232, 179, 60], 255);
  }),
  // Paused: the site sits idle-dark under its pennant while another
  // action holds the slot.
  scene('extraction-paused', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    const stakes = loadGoldenSprite('set-extract-stakes');
    if (stakes) blit(img, stakes, SCENE_W * 0.14 - 42, GROUND * SCENE_H - 52, 84, 52);
    const rigPiece = loadGoldenSprite('set-extract-rig');
    if (rigPiece) blit(img, rigPiece, SCENE_W * 0.58 - 52, GROUND * SCENE_H - 62, 104, 62);
    const crates = loadGoldenSprite('set-extract-crates');
    if (crates) blit(img, crates, SCENE_W * 0.86 - 42, GROUND * SCENE_H - 52, 84, 52);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.idle, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 0, 0, SCENE_W, SCENE_H, [0, 0, 0], 140); // idle-dark while the slot is elsewhere
    const pennant = loadGoldenSprite('prop-hot-pennant');
    if (pennant) blit(img, pennant, SCENE_W - 44, 6, 36, 36);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.45, GRAMMAR.progress.heightPx, [154, 149, 138], 255);
  }),
  // Research (0038): the hunter studying at the terminal — the
  // education track's own scene. War-room table, terminal, and the
  // credential shelf (one plaque earned; the shelf fills from the
  // player's completion records). The G-3 track runs at ~40%: the
  // track names the course by its progress, never its minutes.
  scene('research-study', (img) => {
    drawBackground(img, AREA_BG.helixworks_labyrinth);
    const table = loadGoldenSprite('set-war-room-table');
    if (table) blit(img, table, SCENE_W * 0.16 - 42, GROUND * SCENE_H - 52, 84, 52);
    const terminal = loadGoldenSprite('set-research-terminal');
    if (terminal) blit(img, terminal, SCENE_W * 0.55 - 52, GROUND * SCENE_H - 62, 104, 62);
    const shelf = loadGoldenSprite('set-research-shelf');
    if (shelf) blit(img, shelf, SCENE_W * 0.88 - 42, GROUND * SCENE_H - 52, 84, 52);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.4, GRAMMAR.progress.heightPx, [255, 176, 32], 255);
  }),
  // Course complete: one G-6 flash in the faculty color (Fabrication
  // amber), a G-1 beam over the shelf where the credential hangs,
  // the track full — a completion reads quieter than a drop, on
  // purpose: it is a credential, not loot.
  scene('research-complete', (img) => {
    drawBackground(img, AREA_BG.helixworks_labyrinth);
    const table = loadGoldenSprite('set-war-room-table');
    if (table) blit(img, table, SCENE_W * 0.16 - 42, GROUND * SCENE_H - 52, 84, 52);
    const terminal = loadGoldenSprite('set-research-terminal');
    if (terminal) blit(img, terminal, SCENE_W * 0.55 - 52, GROUND * SCENE_H - 62, 104, 62);
    const shelf = loadGoldenSprite('set-research-shelf');
    if (shelf) blit(img, shelf, SCENE_W * 0.88 - 42, GROUND * SCENE_H - 52, 84, 52);
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.work, xPct: 30, heightPct: 57, feetX: 0.2717 }, GROUND);
    fillRect(img, 0, 0, SCENE_W, SCENE_H, [255, 176, 32], 36);
    drawBeam(img, SCENE_W * 0.88, GROUND * SCENE_H - 30, GRAMMAR.beamWidthPx.standard, '#FFB020');
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [255, 176, 32], 255);
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
  // Leviathan Rig (0032): the L75 endgame hauler parked at the scene
  // edge of a high area — heaviest silhouette in the class table,
  // cargo rack + a scuff tell so its size and wear both read.
  scene('vehicle-roam-leviathan', (img) => {
    drawBackground(img, AREA_BG.blastforge_yards);
    const vehicle = loadGoldenSprite('vehicle-leviathan-rig');
    if (vehicle) blit(img, vehicle, 2, GROUND * SCENE_H - 46, 96, 48);
    const rack = loadGoldenSprite('vehicle-affix-cargo-rack');
    if (rack) blit(img, rack, 2, GROUND * SCENE_H - 46, 96, 48);
    const scuff = loadGoldenSprite('vehicle-condition-scuff');
    if (scuff) blit(img, scuff, 2, GROUND * SCENE_H - 46, 96, 48);
    drawHunter(img, 'aim');
    drawEnemy(img, 'blastforge_yards', 'runner', 'idle');
  }),
  // Dispatch pad (0032): the contract board + route marker + a
  // courier vehicle on the pad, mid-departure. No hunter in frame —
  // dispatch is the spare crew's work, the hunter is elsewhere.
  scene('dispatch-pad', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    const pad = loadGoldenSprite('set-dispatch-pad');
    if (pad) blit(img, pad, SCENE_W * 0.5 - 70, GROUND * SCENE_H - 58, 140, 58);
    const board = loadGoldenSprite('set-dispatch-board');
    if (board) blit(img, board, SCENE_W - 62, GROUND * SCENE_H - 74, 52, 52);
    const route = loadGoldenSprite('set-dispatch-route');
    if (route) blit(img, route, 18, 14, 54, 54);
    const vehicle = loadGoldenSprite('vehicle-utility-rover');
    if (vehicle) blit(img, vehicle, SCENE_W * 0.5 - 44, GROUND * SCENE_H - 42, 88, 44);
  }),
  // Courier return, worn (0032): an Armored Crawler back from a
  // Deep Haul at ~77 condition — scuff tell on the hull, cargo
  // crates stacked at the pad edge (the cargo line made visible).
  scene('dispatch-courier-return-worn', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    const pad = loadGoldenSprite('set-dispatch-pad');
    if (pad) blit(img, pad, SCENE_W * 0.5 - 70, GROUND * SCENE_H - 58, 140, 58);
    const vehicle = loadGoldenSprite('vehicle-armored-crawler');
    if (vehicle) blit(img, vehicle, SCENE_W * 0.5 - 46, GROUND * SCENE_H - 44, 92, 46);
    const scuff = loadGoldenSprite('vehicle-condition-scuff');
    if (scuff) blit(img, scuff, SCENE_W * 0.5 - 46, GROUND * SCENE_H - 44, 92, 46);
    // Cargo piles: the delivered materials, stacked crates.
    fillRect(img, SCENE_W - 74, GROUND * SCENE_H - 22, 16, 12, [104, 82, 54], 255);
    fillRect(img, SCENE_W - 74, GROUND * SCENE_H - 23, 16, 2, [76, 58, 38], 255);
    fillRect(img, SCENE_W - 56, GROUND * SCENE_H - 22, 16, 12, [76, 58, 38], 255);
    fillRect(img, SCENE_W - 65, GROUND * SCENE_H - 33, 14, 11, [104, 82, 54], 255);
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
  // Profile showcase (0034): the trophy shelf — the server's top-3
  // weapons on one plank (real compositor renders of fixed instances;
  // the center Legendary carries the G-1 beam), and beneath it the
  // three standing facts as furniture: the endless depth track filled
  // to depth 12 in its band tint, the Cache Rank diamond, and the
  // collections progress strip. Same interior wall grammar as
  // collections-shelf / cache-rank-panel; the hunter idles at the
  // left, reading their own record.
  scene('profile-showcase', (img) => {
    drawBackground(img, AREA_BG.dustwaste_frontier);
    fillRect(img, 0, 0, SCENE_W, SCENE_H, [8, 8, 12], 96);
    fillRect(img, 0, 0, SCENE_W, SCENE_H * 0.46, hexToRgb('#f2c063'), 18);
    const groundY = GROUND * SCENE_H;
    // Shelf wall backplate + the trophy plank.
    fillRect(img, 120, 52, 316, 158, [13, 15, 21], 235);
    fillRect(img, 120, 52, 316, 2, hexToRgb('#FFD166'), 255);
    fillRect(img, 132, 118, 292, 5, [58, 42, 30], 255);
    fillRect(img, 132, 118, 292, 1, [122, 92, 58], 255);
    fillRect(img, 144, 123, 4, 10, [40, 30, 22], 255);
    fillRect(img, 408, 123, 4, 10, [40, 30, 22], 255);
    // The top-3 shelf: the #1 trophy stands center under its
    // legendary beam, flanked by the runners-up (a Legendary and an
    // Epic — beams signal rarity, so only the Legendary gets one).
    const shelf: PixelWeaponInput[] = [
      { id: 'showcase-3', weaponType: WeaponType.Pistol, manufacturer: Manufacturer.HelixWorks, rarity: Rarity.Legendary, element: Element.Cryo, pixelSeed: 4711, rollQuality: 90 },
      { id: 'showcase-1', weaponType: WeaponType.Sniper, manufacturer: Manufacturer.Prismatek, rarity: Rarity.Legendary, element: Element.Void, pixelSeed: 90210, rollQuality: 95 },
      { id: 'showcase-2', weaponType: WeaponType.SMG, manufacturer: Manufacturer.Redline, rarity: Rarity.Epic, element: Element.Shock, pixelSeed: 6006, rollQuality: 81 },
    ];
    drawBeam(img, 278, 118, GRAMMAR.beamWidthPx.legendary, '#FFD166');
    shelf.forEach((weapon, i) => {
      drawWeaponRender(img, weapon, 140 + i * 96, 118 - 34, 84, 32);
    });
    // Fact row: depth track (15 pips, filled to 12 in the depth-12
    // band tint), the Cache Rank diamond, and a gold rule.
    const band = endlessDepthBand(12);
    const tint = endlessBandTint(band);
    for (let pip = 0; pip < 15; pip += 1) {
      const x = 140 + pip * 12;
      if (pip < 12) fillRect(img, x, 146, 8, 10, hexToRgb(tint.color), 255);
      else fillRect(img, x, 146, 8, 10, [34, 38, 48], 255);
    }
    for (const [half, color] of [[10, '#8a6a24'], [7, '#f2c063'], [3, '#ffe1a1']] as const) {
      fillRect(img, 356 - half, 168 - half, half * 2, half * 2, hexToRgb(color), 255);
    }
    fillRect(img, 140, 190, 180, 2, hexToRgb('#FFD166'), 160);
    // The hunter, admiring the shelf; war-room table fronting.
    drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG, pose: HUNTER_POSES.idle, xPct: 10, heightPct: 46, feetX: 0.2717 }, GROUND);
    const table = loadGoldenSprite('set-war-room-table');
    if (table) blit(img, table, SCENE_W * 0.47 - 55, groundY - 30, 110, 30);
    // Collections progress strip (46 of 81 ≈ 0.57) in trophy gold.
    fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
    fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * 0.57, GRAMMAR.progress.heightPx, hexToRgb('#FFD166'), 255);
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
  // Contracts board (0042): the war-room board. Both scenes draw a
  // REAL board — the set is drawn by the content module's own
  // generator from its pinned seed (daily: the 2026-11-02 B2 board,
  // global per band; weekly: the same week's golden-player set), so
  // a taxonomy or draw change repaints here. Cards are rows in the
  // board grammar: family chip at the left, the G-3 progress track
  // filled to the pinned progress fraction; a completed card is lit
  // with a light spill in the STANDARD beam color (never the
  // legendary beam — the weekly key takes the standard beam too,
  // brief §2.8). The war-room table (G-5) fronts the stage; the
  // hunter idles at it.
  ...(['daily', 'weekly'] as const).map((kind) => {
    const band = contractBandById('B2');
    const levers = resolveContractLevers();
    const draws = drawContractSet({
      seed: contractSetSeed(kind, '2026-11-02', 'B2', 'golden-player'),
      kind,
      band,
      count: kind === 'daily' ? 3 : 5,
      bosses: REGION_1_BOSSES.map((b) => ({ id: b.id, level: b.level })),
    });
    const fractions = kind === 'daily' ? [1, 0.75, 0.34] : [1, 0.8, 0.45, 0.2, 0];
    const familyColors: Record<ContractFamily, string> = {
      combat: '#E2483D', boss: '#9B6BD3', craft: '#E8B33D',
      service: '#4FB0A5', market: '#7FB069', meta: '#8A94A6',
    };
    return scene(kind === 'daily' ? 'contracts-board' : 'contracts-board-weekly', (img) => {
      drawBackground(img, AREA_BG.dustwaste_frontier);
      fillRect(img, 0, 0, SCENE_W, SCENE_H, [8, 8, 12], 110);
      // Board backplate + brass header rule + set-bonus line.
      const boardX = 108;
      const boardW = SCENE_W - boardX - 10;
      const boardH = kind === 'daily' ? 168 : 208;
      fillRect(img, boardX, 24, boardW, boardH, [13, 15, 21], 245);
      fillRect(img, boardX, 24, boardW, 2, hexToRgb('#E8B33D'), 255);
      fillRect(img, boardX, 24 + boardH - 2, boardW, 2, [58, 42, 30], 255);
      // Set-bonus marker: daily = fragment pips; weekly = the key
      // diamond on the STANDARD beam (drawn with the claimable card).
      if (kind === 'daily') {
        for (let pip = 0; pip < 2; pip += 1) {
          fillRect(img, boardX + boardW - 34 + pip * 12, 32, 8, 8, hexToRgb('#E8B33D'), 255);
        }
      } else {
        for (const [half, color] of [[7, '#8a6a24'], [5, '#E8B33D'], [2, '#ffe1a1']] as const) {
          fillRect(img, boardX + boardW - 16 - half, 40 - half, half * 2, half * 2, hexToRgb(color), 255);
        }
      }
      draws.forEach((draw, row) => {
        const target = contractTargetFor(draw.template, kind, band, levers);
        const fraction = fractions[row] ?? 0;
        const complete = fraction >= 1;
        const y = 48 + row * (kind === 'daily' ? 40 : 32);
        const cardH = kind === 'daily' ? 34 : 26;
        // One card geometry (G-2 language): lit when claimable —
        // brass outline + a light spill in the standard-beam color
        // above the card (the full G-1 beam is the loot moment's,
        // not a board card's; the claim flash itself is G-6).
        fillRect(img, boardX + 8, y, boardW - 16, cardH, complete ? [30, 26, 14] : [20, 22, 30], 255);
        fillRect(img, boardX + 8, y, 3, cardH, hexToRgb(familyColors[draw.template.family]), 255);
        if (complete) {
          fillRect(img, boardX + 8, y, boardW - 16, 2, hexToRgb('#E8B33D'), 255);
          fillRect(img, boardX + 8, y + cardH - 2, boardW - 16, 2, hexToRgb('#E8B33D'), 255);
          fillRect(img, boardX + 26 - GRAMMAR.beamWidthPx.standard / 2, y - 6, GRAMMAR.beamWidthPx.standard, 6, hexToRgb('#E8B33D'), 120);
        }
        // G-3 progress track: filled to the pinned progress/target.
        const trackX = boardX + 20;
        const trackW = boardW - 36;
        const trackY = y + cardH - GRAMMAR.progress.heightPx - 5;
        fillRect(img, trackX, trackY, trackW, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
        const filledW = Math.round(trackW * Math.min(1, (Math.floor(target * fraction)) / target));
        if (filledW > 0) {
          fillRect(img, trackX, trackY, filledW, GRAMMAR.progress.heightPx, hexToRgb(complete ? '#E8B33D' : '#9c7c2e'), 255);
        }
        // Boss-param cards carry their bounty plate chip.
        if (draw.params.bossId) {
          fillRect(img, boardX + boardW - 24, y + 5, 10, 10, hexToRgb('#9B6BD3'), 255);
        }
      });
      // War-room table (G-5) fronts the stage; hunter at the board.
      const table = loadGoldenSprite('set-war-room-table');
      if (table) blit(img, table, SCENE_W * 0.5 - 90, GROUND * SCENE_H - 46, 180, 46);
      drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG_UNARMED, pose: HUNTER_POSES.idle, xPct: 10, heightPct: 46, feetX: 0.2717 }, GROUND);
    });
  }),
  // Manufacturer Standing (0043): the Rep Desk. Both scenes compose
  // from a REAL standing view (buildStandingStateView over fabricated
  // facts) — plaque pips, colors, and the progress strip all derive
  // from the ladder state, so a content change repaints here. The
  // vendor stall fronts the stage; the hunter waits at the counter,
  // unarmed (the desk is a counter, not a fight).
  ...(['mid', 'maxed'] as const).map((kind) => {
    const rows =
      kind === 'mid'
        ? [
            { manufacturer: 'Redline', standing: 6320, rank: 3 },
            { manufacturer: 'Ironwood', standing: 2600, rank: 2 },
            { manufacturer: 'BlastForge', standing: 700, rank: 1 },
            { manufacturer: 'Prismatek', standing: 120, rank: 0 },
            { manufacturer: 'ThrowTech', standing: 2100, rank: 2 },
            { manufacturer: 'HelixWorks', standing: 0, rank: 0 },
          ]
        : [
            { manufacturer: 'Redline', standing: 26100, rank: 5 },
            { manufacturer: 'Ironwood', standing: 25400, rank: 5 },
            { manufacturer: 'BlastForge', standing: 28900, rank: 5 },
            { manufacturer: 'Prismatek', standing: 25050, rank: 5 },
            { manufacturer: 'ThrowTech', standing: 31200, rank: 5 },
            { manufacturer: 'HelixWorks', standing: 26750, rank: 5 },
          ];
    const facts: StandingFacts = {
      accountType: 'verified',
      canUsePlayerEconomy: true,
      credits: 900000,
      playerLevel: 25,
      rows,
      weeklyPurchases: [],
    };
    const view: StandingStateView = buildStandingStateView(facts);
    const focus = view.manufacturers[0]; // Redline — the desk's house ladder in both scenes.
    return scene(kind === 'mid' ? 'rep-desk' : 'rep-desk-maxed', (img) => {
      drawBackground(img, AREA_BG.dustwaste_frontier);
      // Interior wash (the collections-shelf move) so the desk reads
      // as the vendor's counter room, not the open frontier.
      fillRect(img, 0, 0, SCENE_W, SCENE_H, [8, 8, 12], 96);
      const groundY = GROUND * SCENE_H;
      // The vendor stall + sign, right of stage.
      const stall = loadGoldenSprite('set-vendor-stall');
      if (stall) blit(img, stall, SCENE_W * 0.58, groundY - 62, 128, 80);
      const sign = loadGoldenSprite('set-vendor-sign');
      if (sign) blit(img, sign, SCENE_W * 0.58 + 22, groundY - 62 - 46, 84, 52);
      // Six rep plaques across the counter front: maker color tab on
      // top, five rank pips under it — filled pips are the granted
      // rank from the view, hollow pips the road ahead.
      view.manufacturers.forEach((m, i) => {
        const def = MANUFACTURERS[m.manufacturer as keyof typeof MANUFACTURERS];
        // The row starts right of the hunter (xPct 10 at heightPct 46
        // occupies roughly the first 64px) so no plaque hides behind
        // the rig.
        const x = 68 + i * 51;
        const y = 168;
        fillRect(img, x, y, 47, 44, [15, 17, 23], 235);
        fillRect(img, x, y, 47, 3, hexToRgb(def.color), 255);
        for (let pip = 0; pip < 5; pip += 1) {
          const filled = pip < m.rank;
          fillRect(
            img,
            x + 3 + pip * 8,
            y + 28,
            6,
            7,
            filled ? hexToRgb(def.color) : [44, 48, 58],
            255,
          );
        }
        // Standing fill: balance progress through the current rank
        // band, in the maker's color.
        const bandBase = STANDING_RANKS[m.rank].threshold;
        const bandTop = m.nextRank ? m.nextRank.threshold : bandBase;
        const frac = m.nextRank ? Math.min(1, Math.max(0, (m.standing - bandBase) / (bandTop - bandBase))) : 1;
        fillRect(img, x + 3, y + 12, 41, 3, [0, 0, 0], 200);
        if (frac > 0) fillRect(img, x + 3, y + 12, Math.round(41 * frac), 3, hexToRgb(def.color), 255);
      });
      if (kind === 'mid') {
        // A turned-in Redline piece on the counter, dissolving into
        // maker-colored scrap-spark (the turn-in visual: distinct
        // from salvage's crusher — motes rise, nothing is crushed).
        const turnedIn: PixelWeaponInput = {
          id: 'rep-turn-in',
          weaponType: WeaponType.SMG,
          manufacturer: Manufacturer.Redline,
          rarity: Rarity.Rare,
          element: Element.Kinetic,
          pixelSeed: 90210,
          rollQuality: 61,
        };
        drawWeaponRender(img, turnedIn, SCENE_W * 0.58 + 26, groundY - 96, 76, 28);
        const spark = hexToRgb(MANUFACTURERS.Redline.color);
        const motes: Array<[number, number, number]> = [
          [0, -6, 200], [14, -14, 255], [30, -10, 160], [46, -20, 255], [58, -8, 180],
          [8, -26, 140], [24, -32, 220], [40, -28, 150], [52, -38, 200], [66, -18, 120],
        ];
        for (const [dx, dy, a] of motes) {
          fillRect(img, SCENE_W * 0.58 + 30 + dx, groundY - 92 + dy, 2, 2, spark, a);
        }
      } else {
        // Signature Order (rank 5): the weekly order on the counter
        // under a maker-color beam, beneath the gold maxed banner.
        fillRect(img, 0, 10, SCENE_W, 16, [30, 26, 14], 255);
        fillRect(img, 0, 10, SCENE_W, 2, hexToRgb('#E8B33D'), 255);
        fillRect(img, 0, 24, SCENE_W, 2, hexToRgb('#E8B33D'), 255);
        const orderWeapon: PixelWeaponInput = {
          id: 'rep-signature-order',
          weaponType: WeaponType.SMG,
          manufacturer: Manufacturer.Redline,
          rarity: Rarity.Epic,
          element: Element.Shock,
          pixelSeed: 4242,
          rollQuality: 88,
        };
        const orderX = SCENE_W * 0.58 + 16;
        drawBeam(img, orderX + 48, groundY - 66, GRAMMAR.beamWidthPx.standard, MANUFACTURERS.Redline.color);
        drawWeaponRender(img, orderWeapon, orderX, groundY - 100, 96, 34);
      }
      // The hunter at the counter, unarmed, reading the desk.
      drawRig(img, loadGoldenSprite, { rig: HUNTER_RIG_UNARMED, pose: HUNTER_POSES.idle, xPct: 10, heightPct: 46, feetX: 0.2717 }, GROUND);
      // Floor strip: mid-rank reads progress to the focus ladder's
      // next rank in its color; maxed reads full gold.
      fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, [0, 0, 0], 200);
      if (kind === 'maxed') {
        fillRect(img, 12, SCENE_H - 18, SCENE_W - 24, GRAMMAR.progress.heightPx, hexToRgb('#E8B33D'), 255);
      } else if (focus.nextRank) {
        const bandBase = STANDING_RANKS[focus.rank].threshold;
        const frac = Math.min(1, Math.max(0, (focus.standing - bandBase) / (focus.nextRank.threshold - bandBase)));
        fillRect(img, 12, SCENE_H - 18, (SCENE_W - 24) * frac, GRAMMAR.progress.heightPx, hexToRgb(MANUFACTURERS.Redline.color), 255);
      }
    });
  }),
];
