/**
 * Wiki W6 — the illustrated world: boss plates + their arenas, the
 * roaming areas' paintings, enemy & elite plates, vehicle plates, and
 * the wave-1 skin sets rendered on the hunter rig. Extends the W4
 * pipeline (images.ts) and the W5 family modules (images-w5.ts).
 *
 * Sources of truth (nothing here invents art):
 *   - Bosses: src/constants/bosses.ts (the roster) resolved to art
 *     through the game's own maps — PIXEL_BOSS_SPRITES in
 *     src/lib/pixel/manifest.ts and PIXEL_BOSS_ARENAS in
 *     src/content/areaPalettes.ts (boss id -> arena painting + prop).
 *   - Areas: src/constants/roamingAreas.ts (the areas and their facts)
 *     resolved through PIXEL_AREA_BACKGROUNDS in manifest.ts; the
 *     named elites and enemy palettes are src/content/areaPalettes.ts
 *     (AREA_VISUALS — the same table the stage reads).
 *   - Enemies: PIXEL_ENEMY_SPRITES in manifest.ts, keyed by the
 *     archetypes in src/constants/monsters.ts. Elites wear their
 *     area's enemy palette through the game's own remapPixelData
 *     (src/lib/pixel/paletteSwap.ts) — the same swap the stage
 *     applies; Dustwaste's elite is the one bespoke sprite.
 *   - Vehicles: src/lib/vehicles/vehicles.ts (the classes); a class's
 *     sprite id is `vehicle-<class id, underscores as dashes>` — the
 *     rule GaragePanel.tsx and LiveTurfDiorama.tsx resolve by. The
 *     affix/wear overlays are the remaining vehicle-* sprites.
 *   - Skins: src/content/skins.ts (the catalog) over the render-side
 *     defs in src/lib/pixel/skinParts.ts, composed by the game's own
 *     parts compositor (src/lib/pixel/partsCompositor.ts) — the set
 *     REPLACES parts over the empty frame, exactly as in game (the
 *     render-parts-proof.ts headless pattern). Set and head renders
 *     are untinted, Standard finish, unarmed, idle pose: the catalog
 *     look, before a player's own finish roll and tint.
 *
 * Disclosed treatment limits (plates are exports, with the limits of
 * a headless export):
 *   - Boss sprites and enemy/elite sprites take the W4 codec
 *     treatment: decoded with pngCodec, box-downscaled 2:1 with
 *     premultiplied-alpha averaging, re-encoded.
 *   - The paintings (boss arenas, zone backgrounds) are JPEG art and
 *     the repo ships no JPEG decoder (pngCodec is PNG-only), so those
 *     plates are the game's own JPG bytes at their native plate size
 *     — byte-deterministic and freshness-gated like every plate.
 *   - An area plate is the area's backdrop painting. The Action stage
 *     also stacks the zone's far/mid/near parallax re-cuts over it
 *     (PixelStage.tsx); those re-cuts exist only as JPEG, so the
 *     stacked composite has no in-repo raster path and is not faked
 *     here — the painting is the audit's v1 area plate.
 *   - Two vehicle sprites (affix armor plate, condition smoke) ship
 *     in the art library but no live overlay draws them yet; their
 *     plates say so instead of inventing a trigger.
 *
 * manifest.ts is parsed from source text, not imported: the module
 * calls Vite's import.meta.glob at load time, which tsx cannot run
 * (the W4 escape hatch, docs/WIKI.md "Adding an image family").
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REGION_1_BOSSES } from '../../src/constants/bosses';
import type { BossDef } from '../../src/types/boss';
import { ROAMING_AREAS, type RoamingAreaDef } from '../../src/constants/roamingAreas';
import { AREA_VISUALS, PIXEL_BOSS_ARENAS } from '../../src/content/areaPalettes';
import { SKIN_PARTS, SKIN_SETS, type SkinPartCatalogDef } from '../../src/content/skins';
import { VEHICLE_CLASSES, type VehicleClassDef } from '../../src/lib/vehicles/vehicles';
import { decodePng, encodePng, type RgbaImage } from '../../src/lib/pixel/pngCodec';
import { remapPixelData } from '../../src/lib/pixel/paletteSwap';
import { PART_POSES, type PartSetDef } from '../../src/lib/pixel/parts';
import { composePartSet } from '../../src/lib/pixel/partsCompositor';
import { STANDARD_ISSUE } from '../../src/lib/pixel/standardIssue';
import { BULWARK_SET, DREADPLATE_SET, MANUFACTURER_HEAD_PARTS, SKIN_PART_DEFS } from '../../src/lib/pixel/skinParts';
import type { SpriteLoader } from '../../src/lib/pixel/sceneRenderer';
import { boxDownscaleHalf } from './images';
import { kebab } from './images-w5';
import { REPO_ROOT, resourceLabel, table, titleCase, type GenAsset, type GenBlock } from './lib';

export const BOSS_PLATE_DIR = 'images/bosses';
export const AREA_PLATE_DIR = 'images/areas';
export const ENEMY_PLATE_DIR = 'images/enemies';
export const VEHICLE_PLATE_DIR = 'images/vehicles';
export const SKIN_PART_PLATE_DIR = 'images/skins/parts';
export const SKIN_SET_PLATE_DIR = 'images/skins/sets';
const ARENA_DISPLAY_WIDTH = 480;
const PAINTING_DISPLAY_WIDTH = 480;
const SET_RENDER_DISPLAY_WIDTH = 200;
const HEAD_RENDER_DISPLAY_WIDTH = 160;

/* ------------------------------------------------------------------ */
/* Sprite files + the Vite-only manifest maps, parsed (W4 pattern)     */
/* ------------------------------------------------------------------ */

interface SpriteManifestFile {
  sprites: Record<string, { src: string; width: number; height: number }>;
}

let spriteManifestCache: SpriteManifestFile | null = null;

function spriteManifest(): SpriteManifestFile {
  if (!spriteManifestCache) {
    spriteManifestCache = JSON.parse(
      readFileSync(join(REPO_ROOT, 'src/assets/pixel/manifest.json'), 'utf8'),
    ) as SpriteManifestFile;
  }
  return spriteManifestCache;
}

function spriteEntry(spriteId: string): { src: string; width: number; height: number } {
  const entry = spriteManifest().sprites[spriteId];
  if (!entry) throw new Error(`images-w6: sprite "${spriteId}" missing from src/assets/pixel/manifest.json`);
  return entry;
}

function spriteFileBytes(spriteId: string): Uint8Array {
  return new Uint8Array(readFileSync(join(REPO_ROOT, 'src/assets/pixel', spriteEntry(spriteId).src)));
}

const manifestMapCache = new Map<string, Record<string, string>>();

/** A `Record<string, string>` literal exported from manifest.ts, parsed from source text. */
function manifestMap(exportName: string): Record<string, string> {
  const cached = manifestMapCache.get(exportName);
  if (cached) return cached;
  const src = readFileSync(join(REPO_ROOT, 'src/lib/pixel/manifest.ts'), 'utf8');
  const block = new RegExp(`export const ${exportName}[^=]*= \\{([\\s\\S]*?)\\};`).exec(src);
  if (!block) throw new Error(`images-w6: ${exportName} not found in src/lib/pixel/manifest.ts`);
  const map: Record<string, string> = {};
  for (const m of block[1].matchAll(/(?:'([^']+)'|([A-Za-z][\w]*)):\s*'([^']+)'/g)) {
    map[m[1] ?? m[2]] = m[3];
  }
  if (Object.keys(map).length === 0) throw new Error(`images-w6: ${exportName} parsed empty`);
  manifestMapCache.set(exportName, map);
  return map;
}

function sortAssets(assets: GenAsset[]): GenAsset[] {
  return assets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** PNG sprite art through the W4 codec treatment: decode, halve, re-encode. */
function halvedSpritePng(spriteId: string): Uint8Array {
  return encodePng(boxDownscaleHalf(decodePng(spriteFileBytes(spriteId))));
}

/** PNG sprite art re-encoded through the codec at native size. */
function nativeSpritePng(spriteId: string): Uint8Array {
  return encodePng(decodePng(spriteFileBytes(spriteId)));
}

/* ------------------------------------------------------------------ */
/* Bosses — one sprite plate + one arena plate per boss                */
/* ------------------------------------------------------------------ */

export function bossSpriteId(bossId: string): string {
  const id = manifestMap('PIXEL_BOSS_SPRITES')[bossId];
  if (!id) throw new Error(`images-w6: no pixel sprite mapped for boss "${bossId}"`);
  return id;
}

export function bossArenaSpriteId(bossId: string): string {
  const arena = PIXEL_BOSS_ARENAS[bossId];
  if (!arena) throw new Error(`images-w6: no arena mapped for boss "${bossId}"`);
  return arena.backgroundId;
}

export function bossPlateStem(bossId: string): string {
  return bossSpriteId(bossId).replace(/^boss-/, '');
}

export function bossPlates(): GenAsset[] {
  const plates: GenAsset[] = [];
  for (const boss of REGION_1_BOSSES) {
    const stem = bossPlateStem(boss.id);
    plates.push({ path: `${BOSS_PLATE_DIR}/${stem}.png`, bytes: halvedSpritePng(bossSpriteId(boss.id)) });
    plates.push({
      path: `${BOSS_PLATE_DIR}/${stem}-arena.jpg`,
      bytes: spriteFileBytes(bossArenaSpriteId(boss.id)),
    });
  }
  return sortAssets(plates);
}

export function bossSpriteImgTag(boss: BossDef): string {
  const entry = spriteEntry(bossSpriteId(boss.id));
  const width = Math.ceil(entry.width / 2);
  return `<img src="${BOSS_PLATE_DIR}/${bossPlateStem(boss.id)}.png" alt="${boss.name}" width="${width}">`;
}

export function bossArenaImgTag(boss: BossDef): string {
  return `<img src="${BOSS_PLATE_DIR}/${bossPlateStem(boss.id)}-arena.jpg" alt="${boss.name} — arena" width="${ARENA_DISPLAY_WIDTH}">`;
}

/* ------------------------------------------------------------------ */
/* Areas — the backdrop painting per area (verbatim JPG bytes)         */
/* ------------------------------------------------------------------ */

export function areaBackgroundSpriteId(areaId: string): string {
  const id = manifestMap('PIXEL_AREA_BACKGROUNDS')[areaId];
  if (!id) throw new Error(`images-w6: no pixel background mapped for area "${areaId}"`);
  return id;
}

export function areaPlatePath(areaId: string): string {
  return `${AREA_PLATE_DIR}/${kebab(areaId)}.jpg`;
}

export function areaPlates(): GenAsset[] {
  return sortAssets(
    ROAMING_AREAS.map((area) => ({
      path: areaPlatePath(area.id),
      bytes: spriteFileBytes(areaBackgroundSpriteId(area.id)),
    })),
  );
}

function areaImgTag(area: RoamingAreaDef): string {
  return `<img src="${areaPlatePath(area.id)}" alt="${area.name}" width="${PAINTING_DISPLAY_WIDTH}">`;
}

/* ------------------------------------------------------------------ */
/* Enemies & elites                                                    */
/* ------------------------------------------------------------------ */

/** Archetypes with their own art; 'boss' resolves to bespoke per-boss art and is skipped. */
const ENEMY_ARCHETYPES = ['fodder', 'runner', 'brute', 'sniper', 'elite'] as const;

export function enemySpriteId(archetype: string): string {
  const id = manifestMap('PIXEL_ENEMY_SPRITES')[archetype];
  if (!id) throw new Error(`images-w6: no pixel sprite mapped for enemy archetype "${archetype}"`);
  return id;
}

export function enemyPlates(): GenAsset[] {
  const plates: GenAsset[] = [];
  for (const archetype of ENEMY_ARCHETYPES) {
    const spriteId = enemySpriteId(archetype);
    plates.push({ path: `${ENEMY_PLATE_DIR}/${spriteId}.png`, bytes: halvedSpritePng(spriteId) });
  }
  for (const area of ROAMING_AREAS) {
    plates.push({ path: `${ENEMY_PLATE_DIR}/elite-${kebab(area.id)}.png`, bytes: elitePlatePng(area.id) });
  }
  return sortAssets(plates);
}

/**
 * One area's named elite, as the stage draws it: Dustwaste's Silt
 * Marshal is bespoke art; every other area's elite is the shared
 * elite frame re-hued by that area's enemy palette (areaPalettes.ts).
 */
function elitePlatePng(areaId: string): Uint8Array {
  const visuals = AREA_VISUALS[areaId as keyof typeof AREA_VISUALS];
  if (!visuals) throw new Error(`images-w6: no area visuals for "${areaId}"`);
  if (visuals.eliteSpriteId) return halvedSpritePng(visuals.eliteSpriteId);
  const base = decodePng(spriteFileBytes(enemySpriteId('elite')));
  const data = new Uint8ClampedArray(base.data);
  remapPixelData(data, visuals.enemyPalette);
  const remapped: RgbaImage = { width: base.width, height: base.height, data: new Uint8Array(data) };
  return encodePng(boxDownscaleHalf(remapped));
}

function enemyImgTag(archetype: string): string {
  const spriteId = enemySpriteId(archetype);
  const entry = spriteEntry(spriteId);
  return `<img src="${ENEMY_PLATE_DIR}/${spriteId}.png" alt="${titleCase(archetype)}" width="${Math.ceil(entry.width / 2)}">`;
}

function eliteImgTag(area: RoamingAreaDef): string {
  const visuals = AREA_VISUALS[area.id as keyof typeof AREA_VISUALS];
  const entry = spriteEntry(visuals.eliteSpriteId ?? enemySpriteId('elite'));
  return `<img src="${ENEMY_PLATE_DIR}/elite-${kebab(area.id)}.png" alt="${visuals.eliteName}" width="${Math.ceil(entry.width / 2)}">`;
}

function areasPicturedBody(): string {
  const lines: string[] = [
    'Every roaming area, pictured in its own backdrop painting — the art the Action stage opens on (in game the stage also stacks the zone\'s parallax re-cuts over the painting and drifts them; the painting is the plate). Facts are the area\'s own: what hunts there, what it is known for, and the elite whose name it answers to. Baseline earning rates live in the areas table in [[Reference]].',
    '',
  ];
  for (const area of ROAMING_AREAS) {
    const visuals = AREA_VISUALS[area.id as keyof typeof AREA_VISUALS];
    const materials = [...area.materialBias, ...area.essenceBias].map(resourceLabel);
    lines.push(
      `### ${area.name}`,
      '',
      areaImgTag(area),
      '',
      area.shortDescription,
      '',
      `- **Danger:** ${area.dangerRating} · **Enemies:** ${area.enemyType}`,
      `- **Signature materials:** ${materials.join(', ') || '—'} · **Signature loot:** ${area.lootBias.join(', ') || '—'}`,
      `- **Influence:** ${area.manufacturerInfluence} · **Named elite:** ${visuals.eliteName}`,
      `- ${area.selectionHint}`,
      '',
    );
  }
  const archetypeRows = ENEMY_ARCHETYPES.map((archetype) => [
    enemyImgTag(archetype),
    `**${titleCase(archetype)}**`,
  ]);
  lines.push(
    '### Who hunts here — the enemy families',
    '',
    'Five families cover every roaming encounter; an area\'s wildlife is these frames re-hued in the area\'s own palette. Bosses are not a family — each wears its own bespoke art (see [[Reference-Bosses]]).',
    '',
    table(['Plate', 'Family'], archetypeRows),
    '',
    '### The named elites',
    '',
    'One named elite haunts each area. Only the Silt Marshal has bespoke art; the rest are the elite frame re-hued by their area\'s enemy palette — the same swap the stage applies, rendered here so the wiki shows the elite you actually meet.',
    '',
    table(
      ['Plate', 'Elite', 'Area'],
      ROAMING_AREAS.map((area) => [
        eliteImgTag(area),
        `**${AREA_VISUALS[area.id as keyof typeof AREA_VISUALS].eliteName}**`,
        area.name,
      ]),
    ),
  );
  return lines.join('\n');
}

export const areasPicturedBlock: GenBlock = {
  id: 'areas-pictured',
  owners: [
    'src/constants/roamingAreas.ts',
    'src/content/areaPalettes.ts',
    'src/lib/pixel/manifest.ts',
    'src/lib/pixel/paletteSwap.ts',
    'src/constants/monsters.ts',
  ],
  render: areasPicturedBody,
  assets: () => [...areaPlates(), ...enemyPlates()],
};

/* ------------------------------------------------------------------ */
/* Vehicles — class plates + the affix/wear overlay plates             */
/* ------------------------------------------------------------------ */

/** The game's own class->sprite rule (GaragePanel.tsx / LiveTurfDiorama.tsx). */
export function vehicleSpriteIdForClass(classId: string): string {
  return `vehicle-${classId.replace(/_/g, '-')}`;
}

export const VEHICLE_OVERLAYS: { spriteId: string; label: string; drawnWhen: string }[] = [
  { spriteId: 'vehicle-affix-cargo-rack', label: 'Cargo Rack', drawnWhen: 'A Cargo Racks affix is fitted' },
  { spriteId: 'vehicle-affix-reinforced-frame', label: 'Reinforced Frame', drawnWhen: 'A Reinforced Frame affix is fitted' },
  { spriteId: 'vehicle-affix-scanner-array', label: 'Scanner Array', drawnWhen: 'A Scanner affix is fitted' },
  { spriteId: 'vehicle-affix-armor-plate', label: 'Armor Plate', drawnWhen: 'Ships in the art library — no affix overlay draws it yet' },
  { spriteId: 'vehicle-condition-scuff', label: 'Condition Scuff', drawnWhen: 'Condition drops under 35%' },
  { spriteId: 'vehicle-condition-smoke', label: 'Condition Smoke', drawnWhen: 'Ships in the art library — no wear overlay draws it yet' },
];

export function vehiclePlates(): GenAsset[] {
  const plates: GenAsset[] = [];
  for (const v of VEHICLE_CLASSES) {
    const spriteId = vehicleSpriteIdForClass(v.id);
    plates.push({ path: `${VEHICLE_PLATE_DIR}/${spriteId.replace(/^vehicle-/, '')}.png`, bytes: nativeSpritePng(spriteId) });
  }
  for (const overlay of VEHICLE_OVERLAYS) {
    plates.push({
      path: `${VEHICLE_PLATE_DIR}/${overlay.spriteId.replace(/^vehicle-/, '')}.png`,
      bytes: nativeSpritePng(overlay.spriteId),
    });
  }
  return sortAssets(plates);
}

export function vehicleClassImgTag(v: VehicleClassDef): string {
  const spriteId = vehicleSpriteIdForClass(v.id);
  const entry = spriteEntry(spriteId);
  return `<img src="${VEHICLE_PLATE_DIR}/${spriteId.replace(/^vehicle-/, '')}.png" alt="${v.displayName}" width="${entry.width}">`;
}

export function vehicleOverlayImgTag(overlay: (typeof VEHICLE_OVERLAYS)[number]): string {
  const entry = spriteEntry(overlay.spriteId);
  return `<img src="${VEHICLE_PLATE_DIR}/${overlay.spriteId.replace(/^vehicle-/, '')}.png" alt="${overlay.label}" width="${entry.width}">`;
}

export function vehicleOverlaysBody(): string {
  const rows = VEHICLE_OVERLAYS.map((overlay) => [
    vehicleOverlayImgTag(overlay),
    `**${overlay.label}**`,
    overlay.drawnWhen,
  ]);
  return [
    '### Affix & wear overlays, pictured',
    '',
    'The Garage and the Home diorama draw these over the class sprite above: an overlay for the affix a vehicle rolled, and wear marks as its condition falls. Two plates ship in the game\'s art library ahead of their overlays — the table says which.',
    '',
    table(['Plate', 'Overlay', 'Drawn when'], rows),
  ].join('\n');
}

/* ------------------------------------------------------------------ */
/* Skins — part plates + compositor set renders                        */
/* ------------------------------------------------------------------ */

const SLOT_LABELS: Record<string, string> = {
  head: 'Head',
  torso: 'Torso',
  armUpperN: 'Upper arm (near)',
  armForeN: 'Forearm (near)',
  armFar: 'Far arm',
  thighF: 'Thigh (near)',
  thighB: 'Thigh (far)',
  lowerLegF: 'Lower leg + boot (near)',
  lowerLegB: 'Lower leg + boot (far)',
  back: 'Back',
};

const skinSpriteCache = new Map<string, RgbaImage | undefined>();
const loadSkinSprite: SpriteLoader = (id) => {
  if (!skinSpriteCache.has(id)) {
    let image: RgbaImage | undefined;
    try {
      image = decodePng(spriteFileBytes(id));
    } catch {
      image = undefined;
    }
    skinSpriteCache.set(id, image);
  }
  return skinSpriteCache.get(id);
};

function cropToContent(img: RgbaImage): RgbaImage {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] === 0) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('images-w6: compositor render is fully transparent');
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcRow = ((minY + y) * img.width + minX) * 4;
    data.set(img.data.subarray(srcRow, srcRow + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/** One actor render: the set's parts replacing the frame, idle and unarmed. */
function actorRenderPng(set: PartSetDef): Uint8Array {
  const render = composePartSet(set, PART_POSES.idle, loadSkinSprite, {});
  return encodePng(cropToContent(render.image));
}

export function skinPlates(): GenAsset[] {
  const plates: GenAsset[] = [];
  for (const part of SKIN_PARTS) {
    const def = SKIN_PART_DEFS[part.id];
    if (!def) throw new Error(`images-w6: skin catalog part "${part.id}" has no render-side def in skinParts.ts`);
    plates.push({ path: `${SKIN_PART_PLATE_DIR}/${part.id}.png`, bytes: nativeSpritePng(def.spriteId) });
  }
  plates.push({ path: `${SKIN_SET_PLATE_DIR}/bulwark.png`, bytes: actorRenderPng(BULWARK_SET) });
  plates.push({ path: `${SKIN_SET_PLATE_DIR}/dreadplate.png`, bytes: actorRenderPng(DREADPLATE_SET) });
  for (const part of SKIN_PARTS.filter((p) => p.setId === 'manufacturer')) {
    const def = MANUFACTURER_HEAD_PARTS[part.id];
    if (!def) throw new Error(`images-w6: manufacturer head part "${part.id}" missing from MANUFACTURER_HEAD_PARTS`);
    const set: PartSetDef = {
      id: `wiki-head-${part.id}`,
      label: part.name,
      parts: { ...STANDARD_ISSUE.parts, head: def },
    };
    plates.push({ path: `${SKIN_SET_PLATE_DIR}/head-${part.id.replace(/^mfr-head-/, '')}.png`, bytes: actorRenderPng(set) });
  }
  return sortAssets(plates);
}

function skinPartImgTag(part: SkinPartCatalogDef): string {
  const def = SKIN_PART_DEFS[part.id];
  return `<img src="${SKIN_PART_PLATE_DIR}/${part.id}.png" alt="${part.name}" width="${def.width}">`;
}

function skinSetImgTag(setId: string, setName: string): string {
  return `<img src="${SKIN_SET_PLATE_DIR}/${setId}.png" alt="${setName} — full set" width="${SET_RENDER_DISPLAY_WIDTH}">`;
}

function skinHeadImgTag(part: SkinPartCatalogDef): string {
  return `<img src="${SKIN_SET_PLATE_DIR}/head-${part.id.replace(/^mfr-head-/, '')}.png" alt="${part.name} — worn" width="${HEAD_RENDER_DISPLAY_WIDTH}">`;
}

function skinPartsTable(parts: SkinPartCatalogDef[], worn = false): string {
  const rows = parts.map((part) =>
    worn
      ? [skinPartImgTag(part), skinHeadImgTag(part), `**${part.name}**`, part.manufacturer ?? '—']
      : [skinPartImgTag(part), `**${part.name}**`, SLOT_LABELS[part.slot] ?? part.slot],
  );
  return worn
    ? table(['Plate', 'Worn', 'Helm', 'Maker'], rows)
    : table(['Plate', 'Part', 'Slot'], rows);
}

function skinsPicturedBody(): string {
  const lines: string[] = [
    '## The wave-1 sets, pictured',
    '',
    'Every part below is pictured twice over: the part itself, and — for the two full sets — the hunter wearing the whole set, rendered by the game\'s own parts compositor with the parts replacing the standard frame. Renders are untinted at Standard finish, the catalog look; your own finish roll and tint re-light the same shapes (see *The finish roll* and *Tinting and Chromaweave* below).',
    '',
  ];
  for (const set of SKIN_SETS) {
    const parts = SKIN_PARTS.filter((p) => p.setId === set.id);
    lines.push(`### ${set.name}`, '', set.blurb, '');
    if (set.id === 'manufacturer') {
      lines.push(
        'The heads are single parts, so each is shown worn on the standard frame — the second column is the first column on a hunter.',
        '',
        skinPartsTable(parts, true),
        '',
      );
    } else {
      lines.push(skinSetImgTag(set.id, set.name), '', skinPartsTable(parts), '');
    }
  }
  return lines.join('\n').trimEnd();
}

export const skinsPicturedBlock: GenBlock = {
  id: 'skins-pictured',
  owners: [
    'src/content/skins.ts',
    'src/lib/pixel/skinParts.ts',
    'src/lib/pixel/partsCompositor.ts',
    'src/lib/pixel/standardIssue.ts',
  ],
  render: skinsPicturedBody,
  assets: skinPlates,
};
