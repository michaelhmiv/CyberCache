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
 *   - Gear: the game's pixel plate engine — representative items run
 *     through each kind's grammar derivation in src/lib/pixel/
 *     (shieldGrammar / ordnanceGrammar / classModGrammar /
 *     relicGrammar) and composed by gearCardCompositor.ts, rasterized
 *     by images.ts' rasterizeGearRender. W5 originally exported the
 *     procedural SVG illustrations; gear marriage slice 5 retired
 *     that island and re-pointed these plates at the compositor, the
 *     same generator approach as the weapon plates above.
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
 *   - Gear: one Rare, affix-free instance per family, built so the
 *     grammar's own derivation lands on that family (the shield's
 *     rolled behavior, the ordnance's effect, the class mod's tree,
 *     the relic's name) — the generator ASSERTS the derived variant,
 *     so a derivation change fails the build instead of mislabeling
 *     a plate. Relic plates all rest on the plain world plinth; the
 *     source-chosen treatments are listed in the prose instead.
 *
 * Disclosed rasterization deltas (the plates are exports, with the
 * limits of a headless export): gear plates are the compositor's
 * card-density render at 2x nearest — the same pixels the game
 * paints, without the card wrapper's CSS chrome. Material plates
 * are the compositor's own texels at plate scale (24-grid x4),
 * alpha preserved.
 */
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
import { SHIELD_BEHAVIORS, type ShieldBehaviorId } from '../../src/lib/combat/shieldBehaviors';
import { SKILL_NODES } from '../../src/constants/skillTrees';
import { composeGear, type GearComposeInput, type GearGrammar } from '../../src/lib/pixel/gearCardCompositor';
import { SHIELD_FAMILY_ROWS, shieldGrammar } from '../../src/lib/pixel/shieldGrammar';
import {
  ORDNANCE_EFFECT_FORMS,
  ORDNANCE_FORM_ROWS,
  ordnanceGrammar,
  type OrdnanceFormId,
} from '../../src/lib/pixel/ordnanceGrammar';
import { CLASS_MOD_TREE_ORDER, classModGrammar } from '../../src/lib/pixel/classModGrammar';
import { RELIC_FORM_ROWS, relicGrammar } from '../../src/lib/pixel/relicGrammar';
import type { ShowcaseItemPayload } from '../../src/lib/api/verifiedOps';
import { showcaseWeaponInput } from '../../src/lib/pixel/showcaseWeaponInput';
import { encodePng, type RgbaImage } from '../../src/lib/pixel/pngCodec';
import { DropSource, Element, Rarity } from '../../src/types/game';
import type { ClassMod, Ordnance, Relic, Shield } from '../../src/types/items';
import { hashString } from '../../src/lib/utils/rng';
import { PLATE_DISPLAY_WIDTH, rasterizeGearRender, rasterizeWeaponCard } from './images';
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
/* Gear plates (the pixel plate engine, via the kind grammars)         */
/* ------------------------------------------------------------------ */

/**
 * One representative item in, one plate PNG out: the kind's grammar
 * derives the compose input from the item record (the same
 * derivation the game runs), the compositor paints the card
 * density, and the rows rasterize at 2x — the game's own pixels,
 * exported. Every builder ASSERTS the derived variant is the
 * family the plate claims to show.
 */
function gearPlatePng(input: GearComposeInput, grammar: GearGrammar): Uint8Array {
  return encodePng(rasterizeGearRender(composeGear(input, grammar, 'card')));
}

/** Plate colorways: one element per behavior, so the body paint varies across the row. */
const SHIELD_PLATE_ELEMENTS: Record<ShieldBehaviorId, Element> = {
  standard: Element.Kinetic,
  nova: Element.Fire,
  absorb: Element.Cryo,
  amp: Element.Shock,
  turtle: Element.Corrosive,
};

function shieldPlateItem(behavior: ShieldBehaviorId): Shield {
  return {
    id: `wiki-shield-${behavior}`,
    name: `${SHIELD_BEHAVIORS[behavior].name} Shield`,
    level: 1,
    rarity: Rarity.Rare,
    hp: 100,
    rechargeRate: 10,
    mitigation: 0,
    element: SHIELD_PLATE_ELEMENTS[behavior],
    behavior,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: hashString(`wiki-gear-shield-${behavior}`),
  };
}

/** One real effect string per form — the effect text is what rolls the form. */
const ORDNANCE_PLATE_EFFECTS: Record<OrdnanceFormId, string> = {
  spike: 'Fragmentation: +15% area damage',
  disc: 'EMP Payload: +25% shield break',
  dart: 'Seeker: Homes on weakpoints (+15% crit)',
  canister: 'Cluster: Splits into 3 bomblets',
};

const ORDNANCE_PLATE_ELEMENTS: Record<OrdnanceFormId, Element> = {
  spike: Element.Fire,
  disc: Element.Shock,
  dart: Element.Void,
  canister: Element.Corrosive,
};

function ordnancePlateItem(form: OrdnanceFormId): Ordnance {
  return {
    id: `wiki-ordnance-${form}`,
    name: `${ORDNANCE_FORM_ROWS[form].label} Ordnance`,
    level: 1,
    rarity: Rarity.Rare,
    damage: 50,
    shieldDamage: 25,
    armorDamage: 25,
    element: ORDNANCE_PLATE_ELEMENTS[form],
    effect: ORDNANCE_PLATE_EFFECTS[form],
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: hashString(`wiki-gear-ordnance-${form}`),
  };
}

/** A mod wears its first two small nodes as boosts, so the socket marks paint. */
function classModPlateItem(tree: (typeof CLASS_MOD_TREE_ORDER)[number]): ClassMod {
  const nodeBoosts: Record<string, number> = {};
  for (const node of SKILL_NODES) {
    if (node.tree !== tree || node.type !== 'small') continue;
    nodeBoosts[node.id] = 1;
    if (Object.keys(nodeBoosts).length >= 2) break;
  }
  return {
    id: `wiki-classmod-${kebab(tree)}`,
    name: `${tree} Class Mod`,
    level: 1,
    rarity: Rarity.Rare,
    treeBonus: tree,
    nodeBoosts,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}

/** World drops uniformly, so every relic plate rests on the plain world plinth. */
function relicPlateItem(row: (typeof RELIC_FORM_ROWS)[number]): Relic {
  return {
    id: `wiki-relic-${row.formId}`,
    name: row.name,
    level: 1,
    rarity: Rarity.Rare,
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
  };
}

export function gearPlates(): GenAsset[] {
  const plates: GenAsset[] = [];
  for (const behavior of Object.keys(SHIELD_FAMILY_ROWS) as ShieldBehaviorId[]) {
    const item = shieldPlateItem(behavior);
    const input = shieldGrammar.inputFromItem!(item);
    if (input.variant !== behavior) {
      throw new Error(`images-w5: shield plate item derived variant ${input.variant}, not ${behavior}`);
    }
    plates.push({ path: `${GEAR_PLATE_DIR}/shield-${behavior}.png`, bytes: gearPlatePng(input, shieldGrammar) });
  }
  for (const form of Object.keys(ORDNANCE_FORM_ROWS) as OrdnanceFormId[]) {
    const item = ordnancePlateItem(form);
    const input = ordnanceGrammar.inputFromItem!(item);
    if (input.variant !== form) {
      throw new Error(`images-w5: ordnance plate item (${item.effect}) derived variant ${input.variant}, not ${form}`);
    }
    plates.push({ path: `${GEAR_PLATE_DIR}/ordnance-${form}.png`, bytes: gearPlatePng(input, ordnanceGrammar) });
  }
  for (const tree of CLASS_MOD_TREE_ORDER) {
    const item = classModPlateItem(tree);
    const input = classModGrammar.inputFromItem!(item);
    if (input.variant !== tree) {
      throw new Error(`images-w5: class mod plate item derived variant ${input.variant}, not ${tree}`);
    }
    plates.push({ path: `${GEAR_PLATE_DIR}/class-mod-${kebab(tree)}.png`, bytes: gearPlatePng(input, classModGrammar) });
  }
  for (const row of RELIC_FORM_ROWS) {
    const item = relicPlateItem(row);
    const input = relicGrammar.inputFromItem!(item);
    if (input.variant !== `${row.formId}/world`) {
      throw new Error(`images-w5: relic plate item (${row.name}) derived variant ${input.variant}, not ${row.formId}/world`);
    }
    plates.push({ path: `${GEAR_PLATE_DIR}/relic-${row.formId}.png`, bytes: gearPlatePng(input, relicGrammar) });
  }
  return sortAssets(plates);
}

function gearImgTag(kind: string, family: string, label: string): string {
  return `<img src="${GEAR_PLATE_DIR}/${kind}-${kebab(family)}.png" alt="${label}" width="${PLATE_DISPLAY_WIDTH}">`;
}

function gearBody(): string {
  const shieldRows = (Object.keys(SHIELD_FAMILY_ROWS) as ShieldBehaviorId[]).map((behavior) => [
    gearImgTag('shield', behavior, `${SHIELD_BEHAVIORS[behavior].name} shield`),
    `**${SHIELD_BEHAVIORS[behavior].name}**`,
    SHIELD_FAMILY_ROWS[behavior].form,
    SHIELD_BEHAVIORS[behavior].blurb,
  ]);
  const ordnanceRows = (Object.keys(ORDNANCE_FORM_ROWS) as OrdnanceFormId[]).map((form) => {
    const effects = Object.entries(ORDNANCE_EFFECT_FORMS)
      .filter(([, f]) => f === form)
      .map(([name]) => name)
      .join(', ');
    return [
      gearImgTag('ordnance', form, ORDNANCE_FORM_ROWS[form].label),
      `**${ORDNANCE_FORM_ROWS[form].label}**`,
      effects,
    ];
  });
  const classModRows = CLASS_MOD_TREE_ORDER.map((tree) => [
    gearImgTag('class-mod', tree, `${tree} class mod`),
    `**${tree}**`,
  ]);
  const relicRows = RELIC_FORM_ROWS.map((row) => [
    `<img src="${GEAR_PLATE_DIR}/relic-${row.formId}.png" alt="${row.name}" width="${PLATE_DISPLAY_WIDTH}">`,
    `**${row.name}**`,
  ]);
  return [
    '### Shields',
    '',
    'A shield\'s form IS its rolled behavior — the plate draws the device the behavior describes (see [[Shield-Tech]] for how behaviors roll). The body wears the shield\'s element colorway and the frame its rarity, so two shields with the same behavior share a silhouette and differ in color and trim. Plates are Rare shields with no affixes, composed by the game\'s own shield grammar.',
    '',
    table(['Plate', 'Behavior', 'Form', 'What it does'], shieldRows),
    '',
    '### Ordnance',
    '',
    'Form follows the ordnance\'s rolled effect — the effect decides which device the item is. Plates are Rare ordnance with no affixes, composed by the game\'s own ordnance grammar.',
    '',
    table(['Plate', 'Form', 'Effects that wear it'], ordnanceRows),
    '',
    '### Class mods',
    '',
    'Every tree gets its own plate: the device draws the tree\'s socket field, with the mod\'s boosted nodes lit in their sockets. Plates are Rare mods with their first two small nodes boosted, composed by the game\'s own class-mod grammar.',
    '',
    table(['Plate', 'Tree'], classModRows),
    '',
    '### Relics',
    '',
    'A relic\'s form follows its name — every named relic is its own device. The plinth under it is chosen by where the relic came from: a boss drop stands on a heavy totem foot, a cache-forged relic sits in a forge cradle, an event relic on a display stand, and a world drop on a plain field plinth. The plates all rest on the world plinth so the forms compare cleanly. Plates are Rare relics with no affixes, composed by the game\'s own relic grammar.',
    '',
    table(['Plate', 'Relic'], relicRows),
  ].join('\n');
}

export const gearPlatesBlock: GenBlock = {
  id: 'gear-plates',
  owners: [
    'src/lib/pixel/gearCardCompositor.ts',
    'src/lib/pixel/shieldGrammar.ts',
    'src/lib/pixel/ordnanceGrammar.ts',
    'src/lib/pixel/classModGrammar.ts',
    'src/lib/pixel/relicGrammar.ts',
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
