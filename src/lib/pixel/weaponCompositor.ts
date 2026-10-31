import { Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Affix, WeaponPart } from '@/types/items';
import { MANUFACTURER_WEAPON_STYLES, RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { getElementVisual } from '@/constants/visualAssets';
import {
  buildDecals,
  conditionFromRoll,
  seededRandom,
  weaponVisualSeed,
  type WeaponCondition,
  type WeaponVisualDecal,
} from '@/lib/weaponArt/decalSpec';

/**
 * Pixel parts-kit weapon compositor (P1).
 *
 * Procedural weapons are NOT bespoke sprites: the generator
 * (src/server/lib/generators/weaponGenerator.ts) rolls exactly 6 part slots —
 * Barrel, Grip, Core, Magazine, Sight, Chamber — and this compositor renders
 * any such roll as a pixel weapon. Geometry is keyed by (weapon type x part
 * slot); the specific variant inside a slot is a pure function of that part's
 * rolled modifier, so the SAME item always renders the SAME image, on every
 * surface (inventory, market, workshop, diorama). Manufacturer identity comes
 * from palette/finish (MANUFACTURER_WEAPON_STYLES), rarity from trim + glow
 * (RARITY_FRAME_STYLES) — the same identity sources the vector art used.
 *
 * Presentation only: this module reads item data and produces pixels. It
 * never mutates state and never produces gameplay outcomes.
 */

export type PixelPartSlot = WeaponPart['slot'];
export const PIXEL_PART_SLOTS: PixelPartSlot[] = ['Barrel', 'Grip', 'Core', 'Magazine', 'Sight', 'Chamber'];

export interface PixelWeaponInput {
  weaponType: WeaponType;
  manufacturer: Manufacturer;
  rarity: Rarity | string;
  element?: Element;
  /** Generator parts (slot + rolled modifier). Missing slots use the type's
   *  deterministic default variant, so previews without parts still render. */
  parts?: WeaponPart[];
  name?: string;
  /** Instance id — feeds the shared visual seed (decal placement). */
  id?: string;
  /** The generator's presentation seed, when the instance carries one. */
  pixelSeed?: number;
  /** Rolled affixes — rendered as decals on the receiver (overhaul §4.2c). */
  affixes?: Affix[];
  /** Roll quality 0..100 — rendered as the condition grade (overhaul §4.2d). */
  rollQuality?: number;
  /** Presentation only: the weapon's legendary effect id, when it carries
   *  one. The compositor ignores it — PixelWeapon uses it to resolve
   *  bespoke legendary art (a dropped legendary's rolled name is
   *  procedural; its effect is its named identity). */
  legendaryEffectId?: string;
}

/** Shade keys used in the render grid. '.' is transparent. */
export type PixelShade = '.' | 'K' | 'D' | 'P' | 'L' | 'T' | 'G' | 'E';

export interface PixelWeaponRender {
  width: number;
  height: number;
  /** height rows of width shade keys. */
  rows: string[];
  /** shade key -> hex color for this weapon's palette. */
  colors: Record<Exclude<PixelShade, '.'>, string>;
  /** Deterministic fingerprint of the full render — the cache/test key. */
  signature: string;
  /** Affix decals stamped on this render (shared derivation, decalSpec). */
  decals: WeaponVisualDecal[];
  /** Condition grade from roll quality (shared derivation, decalSpec). */
  condition: WeaponCondition;
  /** Anchors in texel coordinates (origin top-left). */
  anchors: {
    muzzle: { x: number; y: number };
    grip: { x: number; y: number };
    centerMass: { x: number; y: number };
    lootPoint: { x: number; y: number };
  };
  rarityColor: string;
}

export const PIXEL_WEAPON_WIDTH = 120;
export const PIXEL_WEAPON_HEIGHT = 44;
const SPINE_Y = 15; // barrel centerline

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeRarity(rarity: Rarity | string): Rarity {
  return (Object.values(Rarity) as string[]).includes(rarity) ? (rarity as Rarity) : Rarity.Common;
}

function normalizeType(weaponType: WeaponType): WeaponType {
  return (Object.values(WeaponType) as string[]).includes(weaponType)
    ? weaponType
    : WeaponType.Pistol;
}

function normalizeManufacturer(manufacturer: Manufacturer): Manufacturer {
  return (Object.values(Manufacturer) as string[]).includes(manufacturer)
    ? manufacturer
    : Manufacturer.Redline;
}

/**
 * The variant a part renders as, in [0, variants). Derived ONLY from the
 * item's own part data (slot + which stat it rolled + the rolled value), so
 * two items with identical parts render identically and different rolls
 * diverge. Exported for tests and tooling.
 */
export function partVariant(input: PixelWeaponInput, slot: PixelPartSlot, variants = 3): number {
  const part = input.parts?.find((p) => p.slot === slot);
  if (!part) {
    return hashString(`${input.weaponType}|${slot}|default`) % variants;
  }
  // Overhaul §4.2 fix (a): the variant derives from the part's FULL
  // modifier map (every rolled stat, sorted for order stability) —
  // the pre-overhaul code hashed only the first entry, so two parts
  // differing in any other stat rendered identically.
  const entries = (Object.entries(part.modifier ?? {}) as [string, number][])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const key = entries.map(([stat, value]) => `${stat}:${Math.round((value ?? 0) * 1000)}`).join(',');
  return hashString(`${input.weaponType}|${slot}|${key || 'none'}`) % variants;
}

interface TypeLayout {
  bodyX: number;
  bodyLen: number;
  bodyH: number;
  barrelLen: number;
  barrelThick: number;
  magLen: number;
  gripH: number;
  stockLen: number;
}

/**
 * Where the wielder's hand grips this weapon type, as fractions of the
 * 120×44 render view (overhaul §4.2: held weapons align grip-to-grip
 * with the hunter's manifest grip anchor instead of hard-coded stage
 * percentages). Derived from the type layout's body position.
 */
export function weaponGripFraction(weaponType: WeaponType): { x: number; y: number } {
  const layout = TYPE_LAYOUTS[normalizeType(weaponType)];
  return {
    x: (layout.bodyX + layout.bodyLen * 0.3) / PIXEL_WEAPON_WIDTH,
    y: (24 + layout.gripH * 0.35) / PIXEL_WEAPON_HEIGHT,
  };
}

const TYPE_LAYOUTS: Record<WeaponType, TypeLayout> = {
  [WeaponType.Pistol]: { bodyX: 36, bodyLen: 28, bodyH: 10, barrelLen: 15, barrelThick: 4, magLen: 11, gripH: 13, stockLen: 0 },
  [WeaponType.SMG]: { bodyX: 28, bodyLen: 36, bodyH: 11, barrelLen: 22, barrelThick: 5, magLen: 19, gripH: 12, stockLen: 10 },
  [WeaponType.Shotgun]: { bodyX: 26, bodyLen: 34, bodyH: 11, barrelLen: 34, barrelThick: 7, magLen: 5, gripH: 12, stockLen: 12 },
  [WeaponType.Sniper]: { bodyX: 30, bodyLen: 32, bodyH: 9, barrelLen: 46, barrelThick: 3, magLen: 8, gripH: 11, stockLen: 14 },
  [WeaponType.Launcher]: { bodyX: 28, bodyLen: 38, bodyH: 13, barrelLen: 32, barrelThick: 11, magLen: 0, gripH: 12, stockLen: 8 },
  [WeaponType.Beam]: { bodyX: 30, bodyLen: 36, bodyH: 10, barrelLen: 28, barrelThick: 4, magLen: 9, gripH: 12, stockLen: 10 },
};

type Grid = PixelShade[][];

function makeGrid(): Grid {
  return Array.from({ length: PIXEL_WEAPON_HEIGHT }, () =>
    Array.from({ length: PIXEL_WEAPON_WIDTH }, () => '.' as PixelShade),
  );
}

function rect(grid: Grid, x: number, y: number, w: number, h: number, shade: PixelShade) {
  for (let yy = Math.max(0, y); yy < Math.min(PIXEL_WEAPON_HEIGHT, y + h); yy += 1) {
    for (let xx = Math.max(0, x); xx < Math.min(PIXEL_WEAPON_WIDTH, x + w); xx += 1) {
      grid[yy][xx] = shade;
    }
  }
}

/** One-cell outline pass: empty cells touching a filled cell become outline. */
function outline(grid: Grid) {
  const additions: { x: number; y: number }[] = [];
  for (let y = 0; y < PIXEL_WEAPON_HEIGHT; y += 1) {
    for (let x = 0; x < PIXEL_WEAPON_WIDTH; x += 1) {
      if (grid[y][x] !== '.') continue;
      const touches = [
        grid[y - 1]?.[x], grid[y + 1]?.[x], grid[y]?.[x - 1], grid[y]?.[x + 1],
      ].some((c) => c && c !== '.');
      if (touches) additions.push({ x, y });
    }
  }
  for (const { x, y } of additions) grid[y][x] = 'K';
}

export function composePixelWeapon(input: PixelWeaponInput): PixelWeaponRender {
  const type = normalizeType(input.weaponType);
  const manufacturer = normalizeManufacturer(input.manufacturer);
  const rarity = normalizeRarity(input.rarity);
  const layout = TYPE_LAYOUTS[type];
  const grid = makeGrid();

  const bodyTop = SPINE_Y - Math.floor(layout.bodyH / 2);
  const bodyBottom = bodyTop + layout.bodyH;
  const bodyFront = layout.bodyX + layout.bodyLen;

  // ── Stock (rear) ──────────────────────────────────────────────────────────
  if (layout.stockLen > 0) {
    rect(grid, layout.bodyX - layout.stockLen, SPINE_Y - 3, layout.stockLen, 8, 'D');
    rect(grid, layout.bodyX - layout.stockLen, SPINE_Y - 3, layout.stockLen, 2, 'P');
  }

  // ── Grip (variant: straight / angled / trim-wrapped) ─────────────────────
  const gripVariant = partVariant(input, 'Grip');
  const gripX = layout.bodyX + 3;
  const gripW = 7;
  if (gripVariant === 1) {
    rect(grid, gripX + 1, bodyBottom - 1, gripW, Math.ceil(layout.gripH / 2), 'D');
    rect(grid, gripX - 1, bodyBottom - 1 + Math.ceil(layout.gripH / 2), gripW, Math.floor(layout.gripH / 2), 'D');
  } else {
    rect(grid, gripX, bodyBottom - 1, gripW, layout.gripH, 'D');
  }
  if (gripVariant === 2) {
    for (let i = 0; i < 3; i += 1) {
      rect(grid, gripX, bodyBottom + 2 + i * 4, gripW, 1, 'T');
    }
  }
  rect(grid, gripX, bodyBottom + layout.gripH - 1, gripW, 1, 'K');

  // ── Core (receiver body; variant: plain / plated / vented) ───────────────
  const coreVariant = partVariant(input, 'Core');
  rect(grid, layout.bodyX, bodyTop, layout.bodyLen, layout.bodyH, 'P');
  rect(grid, layout.bodyX, bodyTop, layout.bodyLen, 2, 'L'); // top light edge
  rect(grid, layout.bodyX, bodyBottom - 2, layout.bodyLen, 2, 'D'); // bottom shade
  if (coreVariant === 1) {
    rect(grid, layout.bodyX + 8, bodyTop + 2, layout.bodyLen - 16, layout.bodyH - 4, 'L');
    rect(grid, layout.bodyX + 8, bodyTop + 2, layout.bodyLen - 16, 1, 'D');
  } else if (coreVariant === 2) {
    for (let i = 0; i < 4; i += 1) {
      rect(grid, layout.bodyX + 6 + i * 6, bodyTop + 3, 3, layout.bodyH - 6, 'D');
    }
  }
  // Manufacturer motif stripe on the receiver.
  rect(grid, layout.bodyX + 3, bodyTop + layout.bodyH - 4, Math.min(12, layout.bodyLen - 6), 1, 'T');

  // ── Chamber (element window in the receiver; variant sizes the glow) ─────
  const chamberVariant = partVariant(input, 'Chamber');
  const chamberW = chamberVariant === 1 ? 12 : 9;
  const chamberX = layout.bodyX + 5;
  const chamberY = SPINE_Y - 2;
  rect(grid, chamberX - 1, chamberY - 1, chamberW + 2, 6, 'D');
  rect(grid, chamberX, chamberY, chamberW, 4, input.element && input.element !== Element.Kinetic ? 'E' : 'L');
  if (chamberVariant === 2) {
    rect(grid, chamberX + chamberW + 3, chamberY, 4, 4, input.element && input.element !== Element.Kinetic ? 'E' : 'L');
  }
  if (rarity === Rarity.Epic || rarity === Rarity.Legendary) {
    rect(grid, chamberX, chamberY, chamberW, 1, 'G');
  }

  // ── Magazine (variant: straight / extended / curved-or-drum) ─────────────
  const magVariant = partVariant(input, 'Magazine');
  const magX = layout.bodyX + Math.floor(layout.bodyLen * 0.45);
  if (type === WeaponType.Launcher) {
    // Launcher has no stick mag: the Magazine slot renders as a loader drum.
    rect(grid, magX - 2, bodyBottom - 1, 13, 9, 'D');
    rect(grid, magX, bodyBottom + 1, 9, 5, 'P');
    rect(grid, magX + 3, bodyBottom + 2, 3, 3, 'T');
  } else if (type === WeaponType.Shotgun) {
    // Tube magazine under the barrel.
    rect(grid, bodyFront - 4, SPINE_Y + 3, layout.barrelLen - 6, 3, 'D');
  } else {
    const extra = magVariant === 1 ? 4 : 0;
    if (magVariant === 2) {
      rect(grid, magX, bodyBottom - 1, 8, Math.ceil((layout.magLen + extra) / 2), 'D');
      rect(grid, magX - 2, bodyBottom - 1 + Math.ceil((layout.magLen + extra) / 2), 8, Math.floor((layout.magLen + extra) / 2), 'D');
    } else {
      rect(grid, magX, bodyBottom - 1, 8, layout.magLen + extra, 'D');
    }
    rect(grid, magX, bodyBottom - 1, 8, 2, 'P');
    if (rarity !== Rarity.Common) {
      rect(grid, magX, bodyBottom + layout.magLen + extra - 3, 8, 1, 'T');
    }
  }

  // ── Sight (variant: iron / red-dot / scope) ───────────────────────────────
  const sightVariant = partVariant(input, 'Sight');
  const railY = bodyTop - 2;
  rect(grid, layout.bodyX + 4, railY + 1, layout.bodyLen - 8, 1, 'D'); // rail
  const sightX = layout.bodyX + Math.floor(layout.bodyLen * 0.35);
  if (sightVariant === 2 || type === WeaponType.Sniper) {
    const scopeLen = type === WeaponType.Sniper ? 20 : 15;
    rect(grid, sightX, railY - 3, scopeLen, 4, 'D');
    rect(grid, sightX + scopeLen - 3, railY - 2, 2, 2, 'G');
    rect(grid, sightX + 2, railY - 1, 2, 1, 'K');
  } else if (sightVariant === 1) {
    rect(grid, sightX + 3, railY - 4, 5, 5, 'D');
    rect(grid, sightX + 5, railY - 2, 1, 1, 'G');
  } else {
    rect(grid, sightX + 1, railY - 2, 2, 3, 'D');
    rect(grid, sightX + 8, railY - 2, 2, 3, 'D');
  }

  // ── Barrel (variant: plain / braked / vented-or-shrouded) ────────────────
  const barrelVariant = partVariant(input, 'Barrel');
  const barrelTop = SPINE_Y - Math.floor(layout.barrelThick / 2);
  const barrelLen = layout.barrelLen + (barrelVariant === 1 ? 3 : 0);
  if (type === WeaponType.Beam) {
    // Beam emitter: twin prongs with an element gap.
    rect(grid, bodyFront, barrelTop, barrelLen - 4, 2, 'P');
    rect(grid, bodyFront, barrelTop + layout.barrelThick - 2, barrelLen - 4, 2, 'P');
    rect(grid, bodyFront + barrelLen - 5, barrelTop, 3, layout.barrelThick, 'E');
    rect(grid, bodyFront + 6, SPINE_Y - 1, barrelLen - 12, 2, 'E');
  } else {
    rect(grid, bodyFront, barrelTop, barrelLen, layout.barrelThick, 'P');
    rect(grid, bodyFront, barrelTop, barrelLen, 1, 'L');
    if (barrelVariant === 2) {
      if (type === WeaponType.Shotgun) {
        // Pump grip under the barrel.
        rect(grid, bodyFront + 6, barrelTop + layout.barrelThick, 12, 3, 'D');
      } else {
        for (let i = 0; i < 3; i += 1) {
          rect(grid, bodyFront + 5 + i * 7, barrelTop + 1, 3, layout.barrelThick - 2, 'D');
        }
      }
    }
    if (barrelVariant === 1) {
      // Muzzle brake: thicker, trim-ringed tip.
      rect(grid, bodyFront + barrelLen - 4, barrelTop - 1, 4, layout.barrelThick + 2, 'D');
      rect(grid, bodyFront + barrelLen - 4, barrelTop - 1, 1, layout.barrelThick + 2, 'T');
    }
    if (type === WeaponType.Launcher) {
      rect(grid, bodyFront + barrelLen - 6, barrelTop - 1, 6, layout.barrelThick + 2, 'D');
      rect(grid, bodyFront + barrelLen - 2, SPINE_Y - 2, 2, 4, 'K');
    }
  }
  const muzzleX = Math.min(PIXEL_WEAPON_WIDTH - 1, bodyFront + barrelLen - 1);

  // Rarity trim line along the receiver for higher tiers.
  if (rarity === Rarity.Rare || rarity === Rarity.Epic || rarity === Rarity.Legendary) {
    rect(grid, layout.bodyX, bodyBottom - 1, layout.bodyLen, 1, 'T');
  }

  outline(grid);

  // ── Affix decals (overhaul §4.2c) ─────────────────────────────────────────
  // The instance's affixes stamp onto the receiver, derived by the same
  // buildDecals the card path uses (decalSpec) — an affix is visible in
  // the hand, not just on the card. Decal view space (~200×80) scales
  // onto the 120×44 grid; shapes shrink to their texel silhouettes.
  const visualSeed = weaponVisualSeed({
    id: input.id,
    name: input.name,
    weaponType: type,
    manufacturer,
    element: input.element,
    rarity,
    pixelSeed: input.pixelSeed,
  });
  const decals = buildDecals(input.affixes, visualSeed, input.legendaryEffectId);
  const stampCell = (x: number, y: number, shade: PixelShade) => {
    if (x >= 0 && x < PIXEL_WEAPON_WIDTH && y >= 0 && y < PIXEL_WEAPON_HEIGHT && grid[y][x] !== '.') {
      grid[y][x] = shade;
    }
  };
  for (const decal of decals) {
    const gx = Math.round((decal.x / 200) * PIXEL_WEAPON_WIDTH);
    const gy = Math.round((decal.y / 80) * PIXEL_WEAPON_HEIGHT);
    const shade: PixelShade = decal.label === '★' ? 'G' : 'T';
    stampCell(gx, gy, shade);
    if (decal.shape === 'slash') {
      stampCell(gx + 1, gy - 1, shade);
      stampCell(gx - 1, gy + 1, shade);
    } else if (decal.shape === 'diamond') {
      stampCell(gx, gy - 1, shade);
      stampCell(gx, gy + 1, shade);
      stampCell(gx - 1, gy, shade);
      stampCell(gx + 1, gy, shade);
    } else if (decal.shape === 'triangle') {
      stampCell(gx - 1, gy + 1, shade);
      stampCell(gx + 1, gy + 1, shade);
    } else if (decal.shape === 'tag') {
      stampCell(gx + 1, gy, shade);
      stampCell(gx, gy + 1, shade);
      stampCell(gx + 1, gy + 1, shade);
    }
  }

  // ── Condition grade (overhaul §4.2d) ──────────────────────────────────────
  // Roll quality renders as wear/sheen on the pixel path, from the same
  // conditionFromRoll the card path uses. Wear erases a seeded speckle
  // of body cells; sheen lifts the top edge toward the light shade.
  const condition = conditionFromRoll(typeof input.rollQuality === 'number' ? input.rollQuality : 50);
  if (condition === 'beat-up' || condition === 'field-used') {
    const wearRate = condition === 'beat-up' ? 0.06 : 0.025;
    const wearRng = seededRandom(visualSeed ^ 0x51ab3);
    for (let y = 0; y < PIXEL_WEAPON_HEIGHT; y += 1) {
      for (let x = 0; x < PIXEL_WEAPON_WIDTH; x += 1) {
        const cell = grid[y][x];
        if ((cell === 'P' || cell === 'D') && wearRng() < wearRate) {
          grid[y][x] = '.';
        }
      }
    }
  } else if (condition === 'mint' || condition === 'godroll') {
    for (let x = 0; x < PIXEL_WEAPON_WIDTH; x += 1) {
      for (let y = 0; y < PIXEL_WEAPON_HEIGHT; y += 1) {
        if (grid[y][x] === 'P') {
          grid[y][x] = 'L';
          break;
        }
        if (grid[y][x] !== '.') break;
      }
    }
    if (condition === 'godroll') {
      const sparkleRng = seededRandom(visualSeed ^ 0x90d15);
      let placed = 0;
      for (let y = 0; y < PIXEL_WEAPON_HEIGHT && placed < 5; y += 1) {
        for (let x = 0; x < PIXEL_WEAPON_WIDTH && placed < 5; x += 1) {
          if (grid[y][x] === 'P' && sparkleRng() < 0.05) {
            grid[y][x] = 'G';
            placed += 1;
          }
        }
      }
    }
  }

  // ── Serialize + anchors ───────────────────────────────────────────────────
  const rows = grid.map((row) => row.join(''));
  let mass = 0;
  let mx = 0;
  let my = 0;
  let minX = PIXEL_WEAPON_WIDTH;
  let maxX = 0;
  let minY = PIXEL_WEAPON_HEIGHT;
  for (let y = 0; y < PIXEL_WEAPON_HEIGHT; y += 1) {
    for (let x = 0; x < PIXEL_WEAPON_WIDTH; x += 1) {
      if (grid[y][x] === '.') continue;
      mass += 1;
      mx += x;
      my += y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
    }
  }
  const style = MANUFACTURER_WEAPON_STYLES[manufacturer];
  const rarityStyle = RARITY_FRAME_STYLES[rarity];
  const elementVisual = getElementVisual(input.element ?? Element.Kinetic);
  const signature = hashString(
    `${type}|${manufacturer}|${rarity}|${input.element ?? ''}|${rows.join('/')}`,
  ).toString(16);

  return {
    width: PIXEL_WEAPON_WIDTH,
    height: PIXEL_WEAPON_HEIGHT,
    rows,
    colors: {
      K: '#0B0B0E',
      D: style.dark,
      P: style.primary,
      L: style.light,
      T: rarityStyle.color,
      G: rarityStyle.color,
      E: elementVisual.color,
    },
    signature,
    decals,
    condition,
    anchors: {
      muzzle: { x: muzzleX, y: SPINE_Y },
      grip: { x: gripX + Math.floor(gripW / 2), y: bodyBottom + layout.gripH },
      centerMass: { x: mass ? Math.round(mx / mass) : 60, y: mass ? Math.round(my / mass) : SPINE_Y },
      lootPoint: { x: Math.round((minX + maxX) / 2), y: minY },
    },
    rarityColor: rarityStyle.color,
  };
}

const renderCache = new Map<string, PixelWeaponRender>();

/**
 * Cached compose: identical part data returns the identical render object,
 * so lists and re-renders never recompose a weapon they have already drawn.
 */
export function composePixelWeaponCached(input: PixelWeaponInput): PixelWeaponRender {
  const composed = composePixelWeapon(input);
  const cached = renderCache.get(composed.signature);
  if (cached) return cached;
  renderCache.set(composed.signature, composed);
  return composed;
}

/**
 * Paint a composed render onto a canvas at an integer texel scale.
 * Static per signature — callers cache by `render.signature` and paint once.
 */
export function paintPixelWeapon(
  ctx: CanvasRenderingContext2D,
  render: PixelWeaponRender,
  scale: number,
): void {
  ctx.clearRect(0, 0, render.width * scale, render.height * scale);
  for (let y = 0; y < render.height; y += 1) {
    const row = render.rows[y];
    let runStart = -1;
    let runShade: PixelShade = '.';
    const flush = (endX: number) => {
      if (runStart < 0 || runShade === '.') return;
      ctx.fillStyle = render.colors[runShade as Exclude<PixelShade, '.'>];
      ctx.fillRect(runStart * scale, y * scale, (endX - runStart) * scale, scale);
    };
    for (let x = 0; x < render.width; x += 1) {
      const shade = row[x] as PixelShade;
      if (shade !== runShade) {
        flush(x);
        runStart = x;
        runShade = shade;
      }
    }
    flush(render.width);
  }
}
