/**
 * Wiki W5 — the illustrated Reference: weapon frames + element reads,
 * gear-slot plates, consumable icons, and material marks, extending the
 * W4 pipeline (images.ts) to every remaining gear & goods family.
 *
 * Sources of truth (nothing here invents art):
 *   - Weapon frames / element reads: the game's card compositor
 *     (src/lib/pixel/weaponCardCompositor.ts via showcaseWeaponInput,
 *     exactly as W4) over representative instances built from
 *     src/constants/{weaponTypes,manufacturers,elements}.ts.
 *   - Gear: the game's CURRENT illustrations — the React SVG components
 *     in src/components/gearArt/ fed representative items whose visual
 *     specs are asserted through the game's own builders
 *     (src/lib/gearArt/build*VisualSpec.ts + the silhouette registries
 *     in src/constants/*Silhouettes.ts). The components render to static
 *     markup via react-dom/server and the markup is rasterized by
 *     svgRaster.ts. These plates document the renderers as they ship
 *     today — SVG island included — they are not redesigns.
 *   - Consumables: src/lib/pixel/icons.ts (PX_ICONS rect lists +
 *     PX_ICON_TONE_FILLS), painted exactly as PxIcon.tsx paints them
 *     (list order, source-over, currentColor = the consumable's accent
 *     from getConsumableVisual in src/constants/visualAssets.ts), over
 *     the defs in src/constants/consumables.ts.
 *   - Materials / essences: the game's STUFF compositor
 *     (src/lib/pixel/materialArt.ts) — the formed object each good
 *     renders as in game, composed from the registry colorways in
 *     MATERIAL_VISUALS / ESSENCE_VISUALS. (The letter-mark tile
 *     these plates used to digitize retired with census C-2.)
 *
 * Representative-instance rules (fixed, so plates are stable):
 *   - Frames: one Rare, Kinetic, rollQuality-75 instance per type x
 *     manufacturer, no affixes, pixelSeed = hash of the plate id. The
 *     audit's table said "Legendary finish"; the W5 brief overrides to
 *     mid-rarity representatives — a Rare frame is the gun players
 *     actually hold, and the legendary finish already has its own page.
 *   - Element reads: per type, ONE representative frame (the diagonal
 *     maker pairing type[i] <-> manufacturer[i] in source order, one
 *     fixed seed for the whole row) re-rolled with each element. Only
 *     the element changes across a row; Kinetic is the honest unlit
 *     base the other five light up from.
 *   - Gear: one Rare, affix-free instance per silhouette family, built
 *     so the game's own picker lands on that family (element/seed,
 *     source tag, tree keyword, effect hash) — the generator ASSERTS
 *     the built spec's family, so a picker change fails the build
 *     instead of mislabeling a plate.
 *
 * Disclosed rasterization deltas (the plates are exports, with the
 * limits of a headless export): gear plates render with showBadges off
 * (the element/rarity badge text is data the tables already carry) and
 * without the procedural surface/bevel filters (feTurbulence + specular
 * lighting) or the card wrapper's CSS glow — geometry, gradients, and
 * colors are the components' own. Material plates are the compositor's
 * own texels at plate scale (24-grid x4), alpha preserved.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ELEMENTS } from '../../src/constants/elements';
import { MANUFACTURERS } from '../../src/constants/manufacturers';
import { WEAPON_TYPES } from '../../src/constants/weaponTypes';
import { CONSUMABLES } from '../../src/constants/consumables';
import {
  ESSENCE_VISUALS,
  MATERIAL_VISUALS,
  getConsumableVisual,
  type VisualAsset,
} from '../../src/constants/visualAssets';
import { PX_ICONS, PX_ICON_TONE_FILLS } from '../../src/lib/pixel/icons';
import { composeMaterial, materialArtRow } from '../../src/lib/pixel/materialArt';
import { SHIELD_BEHAVIORS } from '../../src/lib/combat/shieldBehaviors';
import { SHIELD_SILHOUETTES } from '../../src/constants/shieldSilhouettes';
import { RELIC_SILHOUETTES } from '../../src/constants/relicSilhouettes';
import { CLASS_MOD_SILHOUETTES } from '../../src/constants/classModSilhouettes';
import { ORDNANCE_SILHOUETTES } from '../../src/constants/ordnanceSilhouettes';
import { buildShieldVisualSpec } from '../../src/lib/gearArt/buildShieldVisualSpec';
import { buildRelicVisualSpec } from '../../src/lib/gearArt/buildRelicVisualSpec';
import { buildClassModVisualSpec } from '../../src/lib/gearArt/buildClassModVisualSpec';
import { buildOrdnanceVisualSpec } from '../../src/lib/gearArt/buildOrdnanceVisualSpec';
import { ShieldIllustration } from '../../src/components/gearArt/ShieldIllustration';
import { RelicIllustration } from '../../src/components/gearArt/RelicIllustration';
import { ClassModIllustration } from '../../src/components/gearArt/ClassModIllustration';
import { OrdnanceIllustration } from '../../src/components/gearArt/OrdnanceIllustration';
import type { ShowcaseItemPayload } from '../../src/lib/api/verifiedOps';
import { showcaseWeaponInput } from '../../src/lib/pixel/showcaseWeaponInput';
import { encodePng, type RgbaImage } from '../../src/lib/pixel/pngCodec';
import { DropSource, Element, Rarity } from '../../src/types/game';
import type { ClassMod, Ordnance, Relic, Shield } from '../../src/types/items';
import { hashString } from '../../src/lib/utils/rng';
import { PLATE_DISPLAY_WIDTH, rasterizeWeaponCard } from './images';
import { rasterizeSvg } from './svgRaster';
import { type GenAsset, type GenBlock, table } from './lib';

export const FRAME_PLATE_DIR = 'images/weapons/frames';
export const ELEMENT_PLATE_DIR = 'images/weapons/elements';
export const GEAR_PLATE_DIR = 'images/gear';
export const CONSUMABLE_PLATE_DIR = 'images/consumables';
export const MATERIAL_PLATE_DIR = 'images/materials';
const ICON_DISPLAY_WIDTH = 48;

/** 'MedKit' -> 'med-kit', 'SMG' -> 'smg', 'hexPlate' -> 'hex-plate'. */
export function kebab(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function sortAssets(assets: GenAsset[]): GenAsset[] {
  return assets.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/* ------------------------------------------------------------------ */
/* Weapon frames + element reads (the card compositor, as W4)          */
/* ------------------------------------------------------------------ */

const WEAPON_TYPE_LIST = Object.values(WEAPON_TYPES);
const MANUFACTURER_LIST = Object.values(MANUFACTURERS);
const ELEMENT_LIST = Object.values(ELEMENTS);

function weaponPlate(
  dir: string,
  fileStem: string,
  payload: ShowcaseItemPayload['payload'],
): GenAsset {
  const item: ShowcaseItemPayload = {
    id: `wiki-plate-${fileStem}`,
    item_level: null,
    rarity: 'Rare',
    is_locked: false,
    runtime_state: 'inventory',
    equipped_slot: null,
    kind: 'weapon',
    condition_current: null,
    condition_max: null,
    created_at: '2026-01-01T00:00:00.000Z',
    payload,
  };
  return {
    path: `${dir}/${fileStem}.png`,
    bytes: encodePng(rasterizeWeaponCard(showcaseWeaponInput(item))),
  };
}

function frameFileStem(typeId: string, makerId: string): string {
  return `${kebab(typeId)}-${kebab(makerId)}`;
}

export function weaponFramePlates(): GenAsset[] {
  const plates: GenAsset[] = [];
  for (const type of WEAPON_TYPE_LIST) {
    for (const maker of MANUFACTURER_LIST) {
      const stem = frameFileStem(type.id, maker.id);
      plates.push(
        weaponPlate(FRAME_PLATE_DIR, stem, {
          name: `${type.name} — ${maker.name}`,
          weaponType: type.id,
          manufacturer: maker.id,
          element: Element.Kinetic,
          pixelSeed: hashString(`wiki-frame-${stem}`),
          rollQuality: 75,
          affixes: [],
        }),
      );
    }
  }
  return sortAssets(plates);
}

function elementFileStem(typeId: string, elementId: string): string {
  return `${kebab(typeId)}-${kebab(elementId)}`;
}

export function weaponElementPlates(): GenAsset[] {
  const plates: GenAsset[] = [];
  WEAPON_TYPE_LIST.forEach((type, i) => {
    const maker = MANUFACTURER_LIST[i % MANUFACTURER_LIST.length];
    const seed = hashString(`wiki-elements-${kebab(type.id)}`);
    for (const element of ELEMENT_LIST) {
      const stem = elementFileStem(type.id, element.id);
      plates.push(
        weaponPlate(ELEMENT_PLATE_DIR, stem, {
          name: `${type.name} — ${element.name}`,
          weaponType: type.id,
          manufacturer: maker.id,
          element: element.id,
          pixelSeed: seed,
          rollQuality: 75,
          affixes: [],
        }),
      );
    }
  });
  return sortAssets(plates);
}

function frameImgTag(typeName: string, makerName: string, typeId: string, makerId: string): string {
  return `<img src="${FRAME_PLATE_DIR}/${frameFileStem(typeId, makerId)}.png" alt="${typeName} — ${makerName}" width="${PLATE_DISPLAY_WIDTH}">`;
}

function weaponFramesBody(): string {
  const rows = WEAPON_TYPE_LIST.map((type) => [
    `**${type.name}**`,
    ...MANUFACTURER_LIST.map((maker) => frameImgTag(type.name, maker.name, type.id, maker.id)),
  ]);
  return [
    '### Weapon frames, pictured',
    '',
    'One representative Rare, Kinetic instance per type × manufacturer — frame and maker grammar are the variables; element and affixes are held neutral, and the seeds are fixed, so these are the same guns on every render. How the finished gun reads with an element lit is the next table.',
    '',
    table(['Type', ...MANUFACTURER_LIST.map((m) => m.name)], rows),
  ].join('\n');
}

export const weaponFramesBlock: GenBlock = {
  id: 'weapon-frames',
  owners: [
    'src/constants/weaponTypes.ts',
    'src/constants/manufacturers.ts',
    'src/lib/pixel/weaponCardCompositor.ts',
    'src/lib/pixel/showcaseWeaponInput.ts',
  ],
  render: weaponFramesBody,
  assets: weaponFramePlates,
};

function weaponElementsBody(): string {
  const rows = WEAPON_TYPE_LIST.map((type, i) => {
    const maker = MANUFACTURER_LIST[i % MANUFACTURER_LIST.length];
    return [
      `**${type.name}** (${maker.name})`,
      ...ELEMENT_LIST.map(
        (element) =>
          `<img src="${ELEMENT_PLATE_DIR}/${elementFileStem(type.id, element.id)}.png" alt="${type.name} — ${element.name}" width="${PLATE_DISPLAY_WIDTH}">`,
      ),
    ];
  });
  return [
    '### Element reads, pictured',
    '',
    'The same representative frame per type — same maker, same seed, Rare — re-rolled with each element. Only the element changes across a row: Kinetic is the honest unlit base, the other five light the frame\'s current in their own colorway.',
    '',
    table(['Type', ...ELEMENT_LIST.map((e) => e.name)], rows),
  ].join('\n');
}

export const weaponElementsBlock: GenBlock = {
  id: 'weapon-elements',
  owners: [
    'src/constants/elements.ts',
    'src/constants/weaponTypes.ts',
    'src/constants/manufacturers.ts',
    'src/lib/pixel/weaponCardCompositor.ts',
    'src/lib/pixel/showcaseWeaponInput.ts',
  ],
  render: weaponElementsBody,
  assets: weaponElementPlates,
};

/* ------------------------------------------------------------------ */
/* Gear plates (the current SVG illustrations, exported)               */
/* ------------------------------------------------------------------ */

function illustrationPng(markup: string): Uint8Array {
  const svg = /<svg[\s\S]*?<\/svg>/.exec(markup);
  if (!svg) throw new Error('images-w5: illustration component rendered no <svg>');
  return encodePng(rasterizeSvg(svg[0]));
}

/** (family, element, pixelSeed) picks the game's picker genuinely lands on. */
const SHIELD_PICKS: { family: keyof typeof SHIELD_SILHOUETTES; element: Element; seed: number; rolledFor: string }[] = [
  { family: 'rounded', element: Element.Fire, seed: 0, rolledFor: 'Fire or Corrosive on an even seed; Void on an odd seed' },
  { family: 'buckler', element: Element.Shock, seed: 1, rolledFor: 'Fire or Shock on an odd seed' },
  { family: 'bulwark', element: Element.Cryo, seed: 1, rolledFor: 'Corrosive or Cryo on an odd seed' },
  { family: 'hexPlate', element: Element.Kinetic, seed: 0, rolledFor: 'Shock or Kinetic on an even seed' },
  { family: 'splitPanel', element: Element.Void, seed: 0, rolledFor: 'Kinetic or Void on an odd seed; Cryo on an even seed' },
];

function shieldItem(pick: (typeof SHIELD_PICKS)[number]): Shield {
  return {
    id: `wiki-shield-${pick.family}`,
    name: SHIELD_SILHOUETTES[pick.family].label,
    level: 1,
    rarity: Rarity.Rare,
    hp: 100,
    rechargeRate: 10,
    mitigation: 0,
    element: pick.element,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: pick.seed,
  };
}

const RELIC_PICKS: { family: keyof typeof RELIC_SILHOUETTES; sourceTag: DropSource; dropsFrom: string }[] = [
  { family: 'shard', sourceTag: DropSource.WorldDrop, dropsFrom: 'World drops, on an even seed' },
  { family: 'prism', sourceTag: DropSource.Event, dropsFrom: 'Event drops; world drops on an odd seed' },
  { family: 'totem', sourceTag: DropSource.BossDrop, dropsFrom: 'Boss drops' },
  { family: 'chip', sourceTag: DropSource.CacheForged, dropsFrom: 'Cache-forged items' },
];

/** World-drop relics pick shard vs prism by seed parity; find a fixed name whose hash lands on shard. */
function shardRelicItem(): Relic {
  const candidates = ['Shard Relic', 'Found Relic', 'Trail Relic', 'Dust Relic', 'Old Relic', 'Field Relic', 'World Relic', 'Roamer Relic', 'Cache Relic', 'Dropped Relic'];
  for (const name of candidates) {
    const item: Relic = {
      id: `wiki-relic-${kebab(name)}`,
      name,
      level: 1,
      rarity: Rarity.Rare,
      affixes: [],
      sourceTag: DropSource.WorldDrop,
      isLocked: false,
    };
    if (buildRelicVisualSpec(item).silhouette.id === 'shard') return item;
  }
  throw new Error('images-w5: no candidate name lands a world-drop relic on the shard form');
}

function relicItem(pick: (typeof RELIC_PICKS)[number]): Relic {
  if (pick.family === 'shard') return shardRelicItem();
  return {
    id: `wiki-relic-${pick.family}`,
    name: RELIC_SILHOUETTES[pick.family].label,
    level: 1,
    rarity: Rarity.Rare,
    affixes: [],
    sourceTag: pick.sourceTag,
    isLocked: false,
  };
}

const CLASSMOD_PICKS: { family: keyof typeof CLASS_MOD_SILHOUETTES; treeBonus: string; trees: string }[] = [
  { family: 'core', treeBonus: 'Gunslinger', trees: 'Gunslinger trees' },
  { family: 'drive', treeBonus: 'Demolition', trees: 'Demolition trees' },
  { family: 'chip', treeBonus: 'Scavenger', trees: 'Scavenger trees — and any tree the keyword picker doesn\'t match, Fixer included' },
];

function classModItem(pick: (typeof CLASSMOD_PICKS)[number]): ClassMod {
  return {
    id: `wiki-classmod-${pick.family}`,
    name: CLASS_MOD_SILHOUETTES[pick.family].label,
    level: 1,
    rarity: Rarity.Rare,
    treeBonus: pick.treeBonus,
    nodeBoosts: { nodeA: 1, nodeB: 1 },
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}

/**
 * Ordnance form is a hash of the effect text and the item seed, so one
 * representative effect string serves all four plates; the seed is
 * solved per family through the game's own builder.
 */
const ORDNANCE_EFFECT = 'Fragmentation: +15% area damage';
const ORDNANCE_PICKS: { family: keyof typeof ORDNANCE_SILHOUETTES; element: Element }[] = [
  { family: 'spike', element: Element.Fire },
  { family: 'cylinder', element: Element.Kinetic },
  { family: 'disc', element: Element.Shock },
  { family: 'canister', element: Element.Corrosive },
];

function ordnanceItem(pick: (typeof ORDNANCE_PICKS)[number]): Ordnance {
  for (let seed = 0; seed < 64; seed++) {
    const item: Ordnance = {
      id: `wiki-ordnance-${pick.family}`,
      name: ORDNANCE_SILHOUETTES[pick.family].label,
      level: 1,
      rarity: Rarity.Rare,
      damage: 50,
      shieldDamage: 25,
      armorDamage: 25,
      element: pick.element,
      effect: ORDNANCE_EFFECT,
      affixes: [],
      sourceTag: DropSource.WorldDrop,
      isLocked: false,
      pixelSeed: seed,
    };
    if (buildOrdnanceVisualSpec(item).silhouette.id === pick.family) return item;
  }
  throw new Error(`images-w5: no seed in 0..63 lands an ordnance on the ${pick.family} form`);
}

export function gearPlates(): GenAsset[] {
  const plates: GenAsset[] = [];
  for (const pick of SHIELD_PICKS) {
    const item = shieldItem(pick);
    const spec = buildShieldVisualSpec(item);
    if (spec.silhouette.id !== pick.family) {
      throw new Error(`images-w5: shield pick (${pick.element}, seed ${pick.seed}) landed on ${spec.silhouette.id}, not ${pick.family}`);
    }
    plates.push({
      path: `${GEAR_PLATE_DIR}/shield-${kebab(pick.family)}.png`,
      bytes: illustrationPng(
        renderToStaticMarkup(
          createElement(ShieldIllustration, { shield: item, size: 'showcase', showBadges: false, animate: false }),
        ),
      ),
    });
  }
  for (const pick of RELIC_PICKS) {
    const item = relicItem(pick);
    const spec = buildRelicVisualSpec(item);
    if (spec.silhouette.id !== pick.family) {
      throw new Error(`images-w5: relic pick (${pick.sourceTag}) landed on ${spec.silhouette.id}, not ${pick.family}`);
    }
    plates.push({
      path: `${GEAR_PLATE_DIR}/relic-${kebab(pick.family)}.png`,
      bytes: illustrationPng(
        renderToStaticMarkup(
          createElement(RelicIllustration, { relic: item, size: 'showcase', showBadges: false, animate: false }),
        ),
      ),
    });
  }
  for (const pick of CLASSMOD_PICKS) {
    const item = classModItem(pick);
    const spec = buildClassModVisualSpec(item);
    if (spec.silhouette.id !== pick.family) {
      throw new Error(`images-w5: class mod pick (${pick.treeBonus}) landed on ${spec.silhouette.id}, not ${pick.family}`);
    }
    plates.push({
      path: `${GEAR_PLATE_DIR}/class-mod-${kebab(pick.family)}.png`,
      bytes: illustrationPng(
        renderToStaticMarkup(
          createElement(ClassModIllustration, { mod: item, size: 'showcase', showBadges: false, animate: false }),
        ),
      ),
    });
  }
  for (const pick of ORDNANCE_PICKS) {
    const item = ordnanceItem(pick);
    plates.push({
      path: `${GEAR_PLATE_DIR}/ordnance-${kebab(pick.family)}.png`,
      bytes: illustrationPng(
        renderToStaticMarkup(
          createElement(OrdnanceIllustration, { ordnance: item, size: 'showcase', showBadges: false, animate: false }),
        ),
      ),
    });
  }
  return sortAssets(plates);
}

function gearImgTag(kind: string, family: string, label: string): string {
  return `<img src="${GEAR_PLATE_DIR}/${kind}-${kebab(family)}.png" alt="${label}" width="${PLATE_DISPLAY_WIDTH}">`;
}

function gearBody(): string {
  const shieldRows = SHIELD_PICKS.map((pick) => [
    gearImgTag('shield', pick.family, SHIELD_SILHOUETTES[pick.family].label),
    `**${SHIELD_SILHOUETTES[pick.family].label}**`,
    pick.rolledFor,
  ]);
  const behaviorRows = Object.values(SHIELD_BEHAVIORS).map((b) => [`**${b.name}**`, b.blurb]);
  const ordnanceRows = ORDNANCE_PICKS.map((pick) => [
    gearImgTag('ordnance', pick.family, ORDNANCE_SILHOUETTES[pick.family].label),
    `**${ORDNANCE_SILHOUETTES[pick.family].label}**`,
  ]);
  const classModRows = CLASSMOD_PICKS.map((pick) => [
    gearImgTag('class-mod', pick.family, CLASS_MOD_SILHOUETTES[pick.family].label),
    `**${CLASS_MOD_SILHOUETTES[pick.family].label}**`,
    pick.trees,
  ]);
  const relicRows = RELIC_PICKS.map((pick) => [
    gearImgTag('relic', pick.family, RELIC_SILHOUETTES[pick.family].label),
    `**${RELIC_SILHOUETTES[pick.family].label}**`,
    pick.dropsFrom,
  ]);
  return [
    '### Shields',
    '',
    'A shield\'s form is picked by its element and its seed — the illustration draws the device. Behavior is a separate stats axis (rolled by rarity when the shield drops; see [[Shield-Tech]]), and the current illustration does not draw it: any behavior can wear any form. Plates are Rare shields with no affixes, rendered by the game\'s own ShieldIllustration.',
    '',
    table(['Plate', 'Form', 'Rolled for'], shieldRows),
    '',
    '**Shield behaviors** — what the stats axis rolls:',
    '',
    table(['Behavior', 'What it does'], behaviorRows),
    '',
    '### Ordnance',
    '',
    'Form is a hash of the item\'s effect text and its seed — any ordnance can wear any form.',
    '',
    table(['Plate', 'Form'], ordnanceRows),
    '',
    '### Class mods',
    '',
    'Form follows the boosted tree\'s keyword.',
    '',
    table(['Plate', 'Form', 'Trees'], classModRows),
    '',
    '### Relics',
    '',
    'Form follows where the relic came from.',
    '',
    table(['Plate', 'Form', 'Drops from'], relicRows),
  ].join('\n');
}

export const gearPlatesBlock: GenBlock = {
  id: 'gear-plates',
  owners: [
    'src/components/gearArt/ShieldIllustration.tsx',
    'src/components/gearArt/RelicIllustration.tsx',
    'src/components/gearArt/ClassModIllustration.tsx',
    'src/components/gearArt/OrdnanceIllustration.tsx',
    'src/constants/shieldSilhouettes.ts',
    'src/constants/relicSilhouettes.ts',
    'src/constants/classModSilhouettes.ts',
    'src/constants/ordnanceSilhouettes.ts',
    'src/lib/combat/shieldBehaviors.ts',
  ],
  render: gearBody,
  assets: gearPlates,
};

/* ------------------------------------------------------------------ */
/* Consumable icons (PX_ICONS, painted as PxIcon paints them)          */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`images-w5: bad hex color "${hex}"`);
  return [parseInt(m[1].slice(0, 2), 16) / 255, parseInt(m[1].slice(2, 4), 16) / 255, parseInt(m[1].slice(4, 6), 16) / 255];
}

/**
 * Paint one consumable's PX_ICONS rect list the way PxIcon.tsx does:
 * rects in list order, untinted rects in currentColor (here the
 * consumable's accent), toned rects in their tone fill at their tone
 * opacity, source-over onto transparency — composited on the 16x16
 * grid in premultiplied floats, then expanded 8x nearest (the game's
 * crispEdges) and quantized once.
 */
function consumableIconPng(id: string): Uint8Array {
  const visual = getConsumableVisual(id);
  if (!visual.icon) throw new Error(`images-w5: consumable "${id}" has no PxIcon in its visual`);
  const rects = PX_ICONS[visual.icon];
  if (!rects) throw new Error(`images-w5: PxIcon "${visual.icon}" missing from PX_ICONS`);
  const accent = hexToRgb(visual.color);
  const GRID = 16;
  const CELL = 8;
  const buf = new Float32Array(GRID * GRID * 4);
  for (const rect of rects) {
    const [rx, ry, rw, rh, tone] = rect;
    const toneFill = tone ? PX_ICON_TONE_FILLS[tone] : undefined;
    const [fr, fg, fb] = toneFill ? hexToRgb(toneFill.fill) : accent;
    const a = toneFill ? toneFill.opacity : 1;
    for (let y = ry; y < ry + rh; y++) {
      for (let x = rx; x < rx + rw; x++) {
        if (x < 0 || y < 0 || x >= GRID || y >= GRID) continue;
        const o = (y * GRID + x) * 4;
        const keep = 1 - a;
        buf[o] = fr * a + buf[o] * keep;
        buf[o + 1] = fg * a + buf[o + 1] * keep;
        buf[o + 2] = fb * a + buf[o + 2] * keep;
        buf[o + 3] = a + buf[o + 3] * keep;
      }
    }
  }
  const size = GRID * CELL;
  const data = new Uint8Array(size * size * 4);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const o = (gy * GRID + gx) * 4;
      const pa = buf[o + 3];
      const r = pa > 0 ? Math.round((buf[o] / pa) * 255) : 0;
      const g = pa > 0 ? Math.round((buf[o + 1] / pa) * 255) : 0;
      const b = pa > 0 ? Math.round((buf[o + 2] / pa) * 255) : 0;
      const alpha = Math.round(pa * 255);
      for (let dy = 0; dy < CELL; dy++) {
        for (let dx = 0; dx < CELL; dx++) {
          const p = ((gy * CELL + dy) * size + (gx * CELL + dx)) * 4;
          data[p] = r;
          data[p + 1] = g;
          data[p + 2] = b;
          data[p + 3] = alpha;
        }
      }
    }
  }
  const img: RgbaImage = { width: size, height: size, data };
  return encodePng(img);
}

export function consumablePlates(): GenAsset[] {
  return sortAssets(
    Object.keys(CONSUMABLES).map((id) => ({
      path: `${CONSUMABLE_PLATE_DIR}/${kebab(id)}.png`,
      bytes: consumableIconPng(id),
    })),
  );
}

export function consumablePlateImgTag(id: string, name: string): string {
  return `<img src="${CONSUMABLE_PLATE_DIR}/${kebab(id)}.png" alt="${name}" width="${ICON_DISPLAY_WIDTH}">`;
}

/* ------------------------------------------------------------------ */
/* Material / essence objects (the STUFF compositor render)            */
/* ------------------------------------------------------------------ */

/**
 * The material's STUFF object at plate size: the game's own
 * compositor (src/lib/pixel/materialArt.ts) on its 24-texel grid,
 * scaled x4 — the texel = 4 law — with alpha preserved (the ground
 * shadow is a translucent shade). Deterministic by construction:
 * the compositor seeds from the material id.
 */
function materialObjectPng(visual: VisualAsset): Uint8Array {
  const render = composeMaterial(visual.id, 'object');
  const SCALE = 4;
  const width = render.width * SCALE;
  const height = render.height * SCALE;
  const data = new Uint8Array(width * height * 4);
  const rgbaByShade = new Map<string, [number, number, number, number] | null>();
  for (const [shade, color] of Object.entries(render.colors)) {
    const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color ?? '');
    rgbaByShade.set(
      shade,
      hex
        ? [
            parseInt(hex[1].slice(0, 2), 16),
            parseInt(hex[1].slice(2, 4), 16),
            parseInt(hex[1].slice(4, 6), 16),
            hex[2] ? parseInt(hex[2], 16) : 255,
          ]
        : null,
    );
  }
  for (let y = 0; y < render.height; y++) {
    const row = render.rows[y];
    for (let x = 0; x < render.width; x++) {
      const rgba = rgbaByShade.get(row[x]);
      if (!rgba) continue;
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          const o = ((y * SCALE + dy) * width + (x * SCALE + dx)) * 4;
          data[o] = rgba[0];
          data[o + 1] = rgba[1];
          data[o + 2] = rgba[2];
          data[o + 3] = rgba[3];
        }
      }
    }
  }
  return encodePng({ width, height, data });
}

export function materialPlates(): GenAsset[] {
  const all = [...Object.values(MATERIAL_VISUALS), ...Object.values(ESSENCE_VISUALS)] as VisualAsset[];
  return sortAssets(
    all.map((visual) => ({
      path: `${MATERIAL_PLATE_DIR}/${kebab(visual.id)}.png`,
      bytes: materialObjectPng(visual),
    })),
  );
}

function materialImgTag(visual: VisualAsset): string {
  return `<img src="${MATERIAL_PLATE_DIR}/${kebab(visual.id)}.png" alt="${visual.label}" width="${ICON_DISPLAY_WIDTH}">`;
}

function materialsBody(): string {
  const bandLabel = (v: VisualAsset) => {
    const band = materialArtRow(v.id).band;
    return band.charAt(0).toUpperCase() + band.slice(1);
  };
  const materialRows = (Object.values(MATERIAL_VISUALS) as VisualAsset[]).map((v) => [
    materialImgTag(v),
    `**${v.label}**`,
    bandLabel(v),
    v.description,
  ]);
  const essenceRows = (Object.values(ESSENCE_VISUALS) as VisualAsset[]).map((v) => [
    materialImgTag(v),
    `**${v.label}**`,
    bandLabel(v),
    v.description,
  ]);
  return [
    'Every material and essence, drawn as the object it renders as in game — form and colorway are how it reads in the Workshop, the market, and your inventory. The Band column is the processing finish the art itself wears: raw goods are worn and jumbled, refined goods are the same stuff aligned, composites carry their lamination seam.',
    '',
    table(['Plate', 'Material', 'Band', 'What it is'], materialRows),
    '',
    table(['Plate', 'Essence', 'Band', 'What it is'], essenceRows),
  ].join('\n');
}

export const materialsBlock: GenBlock = {
  id: 'materials',
  owners: ['src/constants/visualAssets.ts'],
  render: materialsBody,
  assets: materialPlates,
};
