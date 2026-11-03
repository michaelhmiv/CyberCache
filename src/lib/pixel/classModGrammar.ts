import { SkillTreeType } from '@/types/game';
import type { ClassMod } from '@/types/items';
import { SKILL_NODES } from '@/constants/skillTrees';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import { hashString } from '@/lib/utils/rng';
import {
  GEAR_CARD_PLATES,
  GEAR_NEUTRAL_BASE,
  type GearCanvas,
  type GearComposeInput,
  type GearGrammar,
  type GearShade,
} from './gearCardCompositor';

/**
 * classModGrammar — the class-mod marriage (gear marriage, slice 3).
 *
 * The old SVG picked its family by tree keyword and had NO Fixer
 * family at all: every Fixer mod fell through to the Scavenger
 * chip and wore another tree's face. This grammar closes that:
 * one device row per skill tree — Gunslinger, Demolition,
 * Scavenger, and a Fixer family authored new — each a piece of
 * worn tech (never a flat icon), keyed by the record's treeBonus.
 *
 * The real-item invariant goes further than the incumbent ever
 * did (its spec received only a node COUNT): the mod's actual
 * rolled nodeBoosts render as lit pips in a node field on the
 * device face. The field is a 4×12 socket grid in SKILL_NODES
 * registry order — one row per tree, one socket per small node —
 * so a pip's POSITION is the node it boosts and its brightness
 * stack is the rolled value (+1, +2, +3). Two mods differing only
 * in their boosts render differently; the same mod renders
 * identically everywhere.
 *
 * Class mods are element-less: the colorway is the tree's own,
 * from the one SKILL_TREE_VISUALS registry, carried through the
 * core's baseColor override. Rarity is the core frame. Seed
 * variation derives from the same inputs the incumbent spec
 * hashed (id : name : rarity : treeBonus), so an instance's
 * identity is stable. Pixel density law (DESIGN.md §8) binds
 * throughout: texel = 4, authored at the 240×120 grid, five-tone
 * ramp, thumb = detail level 0 (silhouette + core + colorway;
 * the node field and affix sockets are detail and stay home).
 */

/* ------------------------------------------------------------------ */
/* Tree + node-field model                                             */
/* ------------------------------------------------------------------ */

/** Field rows, in SKILL_NODES registry order. */
export const CLASS_MOD_TREE_ORDER: SkillTreeType[] = [
  SkillTreeType.Gunslinger,
  SkillTreeType.Demolition,
  SkillTreeType.Scavenger,
  SkillTreeType.Fixer,
];

const SMALL_IDS_BY_TREE = new Map<SkillTreeType, string[]>();
for (const tree of CLASS_MOD_TREE_ORDER) SMALL_IDS_BY_TREE.set(tree, []);
for (const node of SKILL_NODES) {
  if (node.type !== 'small') continue;
  SMALL_IDS_BY_TREE.get(node.tree)?.push(node.id);
}

/** nodeId → its socket in the field (row = tree, col = registry slot). */
const NODE_PLACEMENT = new Map<string, { row: number; col: number }>();
CLASS_MOD_TREE_ORDER.forEach((tree, row) => {
  (SMALL_IDS_BY_TREE.get(tree) ?? []).forEach((id, col) => NODE_PLACEMENT.set(id, { row, col }));
});

export interface NodeBoostMark {
  nodeId: string;
  row: number;
  col: number;
  /** Rolled boost, clamped to the pip stack the field can show. */
  value: number;
}

/**
 * The record's nodeBoosts as field marks: placement is the node's
 * canonical registry slot (never a hash, never a coin flip), marks
 * sorted row-major so rendering order is stable. Node ids the
 * registry no longer knows are skipped — the same tolerance
 * skillBonuses applies when pricing them.
 */
export function nodeBoostMarks(nodeBoosts: Record<string, number> | undefined): NodeBoostMark[] {
  const marks: NodeBoostMark[] = [];
  for (const [nodeId, raw] of Object.entries(nodeBoosts ?? {})) {
    const at = NODE_PLACEMENT.get(nodeId);
    if (!at || !(raw > 0)) continue;
    marks.push({ nodeId, row: at.row, col: at.col, value: Math.min(3, Math.max(1, Math.floor(raw))) });
  }
  marks.sort((a, b) => a.row - b.row || a.col - b.col);
  return marks;
}

/**
 * treeBonus → tree. Exact enum values first, then the incumbent
 * picker's keyword tolerance for legacy strings. A value that
 * names no tree resolves to null — the neutral housing — never
 * to another tree's family (the Fixer fallthrough, generalized,
 * is the bug this slice exists to kill).
 */
export function resolveClassModTree(treeBonus: string | undefined): SkillTreeType | null {
  if (!treeBonus) return null;
  for (const tree of CLASS_MOD_TREE_ORDER) if (treeBonus === tree) return tree;
  const lower = treeBonus.toLowerCase();
  if (lower.includes('gun') || lower.includes('slinger')) return SkillTreeType.Gunslinger;
  if (lower.includes('demo') || lower.includes('blast')) return SkillTreeType.Demolition;
  if (lower.includes('scav') || lower.includes('surv')) return SkillTreeType.Scavenger;
  if (lower.includes('fix')) return SkillTreeType.Fixer;
  return null;
}

/* ------------------------------------------------------------------ */
/* Input derivation                                                    */
/* ------------------------------------------------------------------ */

export interface ClassModComposeInput extends GearComposeInput {
  tree: SkillTreeType | null;
  boosts: NodeBoostMark[];
}

export function classModInputFromItem(item: ClassMod): ClassModComposeInput {
  const tree = resolveClassModTree(item.treeBonus);
  return {
    kind: 'classMod',
    rarity: item.rarity,
    element: null,
    seed: hashString(`${item.id}:${item.name}:${item.rarity}:${item.treeBonus}`),
    pips: item.affixes?.length ?? 0,
    baseColor: tree ? getSkillTreeVisual(tree).color : GEAR_NEUTRAL_BASE,
    variant: tree ?? 'unknown',
    tree,
    boosts: nodeBoostMarks(item.nodeBoosts),
  };
}

/* ------------------------------------------------------------------ */
/* Design-space painter (232×112 mapped onto the canvas body, so     */
/* one design composes at card and thumb grids alike)                  */
/* ------------------------------------------------------------------ */

const DESIGN_W = 232;
const DESIGN_H = 112;

class DesignPainter {
  constructor(readonly canvas: GearCanvas) {}

  get detail() { return this.canvas.detailLevel > 0; }

  X(x: number) { const b = this.canvas.body; return b.x + Math.round((x * b.w) / DESIGN_W); }
  Y(y: number) { const b = this.canvas.body; return b.y + Math.round((y * b.h) / DESIGN_H); }
  private dY(py: number) { const b = this.canvas.body; return Math.round(((py - b.y) * DESIGN_H) / b.h); }

  /** Edge-mapped rect: adjacent design rects share exact edges. */
  rect(x: number, y: number, w: number, h: number, s: GearShade) {
    const x0 = this.X(x); const x1 = this.X(x + w);
    const y0 = this.Y(y); const y1 = this.Y(y + h);
    this.canvas.rect(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0), s);
  }

  disc(cx: number, cy: number, r: number, s: GearShade) {
    const pr = Math.max(1, Math.round((r * this.canvas.body.w) / DESIGN_W));
    this.canvas.disc(this.X(cx), this.Y(cy), pr, s);
  }

  ring(cx: number, cy: number, rIn: number, rOut: number, s: GearShade) {
    const scale = this.canvas.body.w / DESIGN_W;
    this.canvas.ring(this.X(cx), this.Y(cy), Math.max(0, Math.round(rIn * scale)), Math.max(1, Math.round(rOut * scale)), s);
  }

  poly(pts: [number, number][], s: GearShade | ((dx: number, dy: number) => GearShade)) {
    const mapped = pts.map(([x, y]) => [this.X(x), this.Y(y)] as [number, number]);
    if (typeof s === 'function') {
      this.canvas.poly(mapped, (_px, py) => s(0, this.dY(py)));
    } else {
      this.canvas.poly(mapped, s);
    }
  }

  /** Horizontal banding across a silhouette: pale top, base mid, deep foot. */
  bands(topUntil: number, bottomFrom: number): (dx: number, dy: number) => GearShade {
    return (_dx, dy) => (dy < topUntil ? 'p' : dy > bottomFrom ? 'd' : 'P');
  }
}

/* ------------------------------------------------------------------ */
/* Shared furniture: the node deck + the affix rail                    */
/* ------------------------------------------------------------------ */

const DECK_W = 78;
const DECK_H = 30;
const FIELD_PITCH = 6;

/**
 * The node field: a recessed deck window (silhouette layer — it
 * shapes the device face at every density) holding the 4×12
 * socket field. Sockets and lit pips are detail: at thumb the
 * deck reads as a dark window and nothing more. A marker texel
 * flags the row of the mod's own tree — the treeBonus row.
 */
function paintNodeDeck(p: DesignPainter, x: number, y: number, input: ClassModComposeInput) {
  p.rect(x, y, DECK_W, DECK_H, 'k');
  p.rect(x + 1, y + 1, DECK_W - 2, DECK_H - 2, 'D');
  if (!p.detail) return;
  const lit = new Map<string, number>();
  for (const m of input.boosts) lit.set(`${m.row}:${m.col}`, m.value);
  const fx = x + 4;
  const fy = y + 4;
  for (let row = 0; row < CLASS_MOD_TREE_ORDER.length; row++) {
    const sy = fy + row * FIELD_PITCH;
    if (input.tree && CLASS_MOD_TREE_ORDER[row] === input.tree) {
      p.rect(x + 1, sy + 1, 2, 2, 'E'); // home-row marker
    }
    for (let col = 0; col < 12; col++) {
      const sx = fx + col * FIELD_PITCH;
      const value = lit.get(`${row}:${col}`);
      if (!value) {
        p.rect(sx + 1, sy + 1, 2, 2, 'K'); // unlit socket hole
        continue;
      }
      p.rect(sx, sy, 4, 4, 'd');
      // Brightness stack in reading order: base → light → white-hot.
      const stack: GearShade[] = ['E', 'p', 'W'];
      const cells: [number, number][] = [[1, 1], [2, 1], [1, 2]];
      for (let i = 0; i < value; i++) {
        const [dx, dy] = cells[i];
        p.rect(sx + dx, sy + dy, 1, 1, stack[i]);
      }
    }
  }
}

/** Mounting bracket under the housing; affix sockets ride it. */
function paintAffixRail(p: DesignPainter, cx: number, y: number, count: number) {
  const w = Math.max(64, count * 5 + 18);
  p.rect(cx - w / 2, y, w, 9, 'd');
  p.rect(cx - w / 2, y, w, 1, 'k');
  if (!p.detail || count <= 0) return;
  let sx = cx - (count * 5 - 2) / 2;
  for (let i = 0; i < count; i++) {
    p.canvas.socket(p.X(sx), p.Y(y + 3), true);
    sx += 5;
  }
}

/** Seeded wear: a few texel chips on the housing (detail only). */
function paintWear(p: DesignPainter, spots: [number, number][]) {
  if (!p.detail) return;
  const n = 2 + p.canvas.pick(3);
  for (let i = 0; i < n; i++) {
    const [x, y] = spots[p.canvas.pick(spots.length)];
    p.canvas.chip(p.X(x), p.Y(y));
  }
}

/* ------------------------------------------------------------------ */
/* Family rows                                                         */
/* ------------------------------------------------------------------ */

/** GUNSLINGER — Combat Core: a hexagonal puck with a bullseye core. */
function paintCore(p: DesignPainter, input: ClassModComposeInput) {
  const hex: [number, number][] = [[52, 10], [180, 10], [224, 50], [180, 90], [52, 90], [8, 50]];
  p.poly(hex, p.bands(34, 66));
  // Bullseye (the tree's sigil, worn as hardware): seat, ring, heart.
  p.disc(70, 50, 17, 'k');
  p.disc(70, 50, 16, 'E');
  p.disc(70, 50, 11, 'D');
  p.disc(70, 50, 10, 'p');
  p.disc(70, 50, 5, 'W');
  p.disc(70, 50, 2, 'E');
  paintNodeDeck(p, 126, 35, input);
  // Edge contacts under the puck + bracket struts.
  for (let i = 0; i < 6; i++) p.rect(64 + i * 18, 90, 9, 6, 'T');
  p.rect(70, 96, 8, 4, 'd');
  p.rect(154, 96, 8, 4, 'd');
  paintAffixRail(p, 116, 100, input.pips ?? 0);
  if (p.detail) {
    p.canvas.rivet(p.X(56), p.Y(14));
    p.canvas.rivet(p.X(174), p.Y(14));
    p.canvas.rivet(p.X(56), p.Y(82));
    p.canvas.rivet(p.X(174), p.Y(82));
    p.canvas.vents(p.X(100), p.Y(24), 3);
    p.canvas.seam(p.X(30), p.Y(76), p.X(102), p.Y(76));
    paintWear(p, [[40, 30], [196, 28], [150, 82], [96, 16], [210, 58]]);
  }
}

/** DEMOLITION — Tactical Drive: a finned brick with a diamond window. */
function paintDrive(p: DesignPainter, input: ClassModComposeInput) {
  const canvas = p.canvas;
  // Seeded fin count — a silhouette draw, so it precedes all detail.
  const finCount = 5 + canvas.pick(2) * 2;
  for (let i = 0; i < finCount; i++) {
    const fx = Math.round(62 + (i * 108) / Math.max(1, finCount - 1)) - 3;
    p.rect(fx, 10, 6, 12, 'd');
    p.rect(fx, 10, 6, 3, 'P');
  }
  // Housing bands.
  p.rect(22, 22, 188, 62, 'P');
  p.rect(22, 22, 188, 10, 'p');
  p.rect(22, 68, 188, 16, 'd');
  // Side capacitor drums.
  p.rect(12, 36, 10, 32, 'd');
  p.rect(12, 44, 10, 6, 'P');
  p.rect(210, 36, 10, 32, 'd');
  p.rect(210, 44, 10, 6, 'P');
  // Processor window with the diamond sigil.
  p.rect(36, 30, 48, 46, 'k');
  p.rect(37, 31, 46, 44, 'D');
  p.poly([[60, 36], [76, 53], [60, 70], [44, 53]], 'E');
  p.poly([[60, 44], [68, 53], [60, 62], [52, 53]], 'p');
  p.rect(59, 52, 2, 2, 'W');
  paintNodeDeck(p, 118, 37, input);
  p.rect(60, 84, 8, 8, 'd');
  p.rect(164, 84, 8, 8, 'd');
  paintAffixRail(p, 116, 92, input.pips ?? 0);
  if (p.detail) {
    // Hazard chevrons along the foot band (texel-scale, hard-edged).
    for (let i = 0; i < 22; i++) p.rect(28 + i * 8, 80, 3, 2, i % 2 ? 'K' : 'W');
    p.canvas.rivet(p.X(26), p.Y(26));
    p.canvas.rivet(p.X(202), p.Y(26));
    p.canvas.rivet(p.X(26), p.Y(60));
    p.canvas.rivet(p.X(202), p.Y(60));
    p.canvas.vents(p.X(94), p.Y(27), 3);
    paintWear(p, [[100, 40], [200, 74], [30, 50], [140, 26]]);
  }
}

/** SCAVENGER — Skill Chip: a chamfered PCB; the die IS the field. */
function paintChip(p: DesignPainter, input: ClassModComposeInput) {
  const board: [number, number][] = [[46, 16], [186, 16], [202, 32], [202, 72], [186, 88], [46, 88], [30, 72], [30, 32]];
  const inner: [number, number][] = [[50, 20], [182, 20], [197, 35], [197, 69], [182, 84], [50, 84], [35, 69], [35, 35]];
  p.poly(board, 'd');
  p.poly(inner, p.bands(32, 72));
  // Corner capacitor blocks.
  p.rect(42, 23, 16, 11, 'd');
  p.rect(42, 23, 16, 3, 'p');
  p.rect(174, 23, 16, 11, 'd');
  p.rect(174, 23, 16, 3, 'p');
  paintNodeDeck(p, 77, 37, input);
  // Split edge-connector pins (the bracket rides between them).
  for (const px of [42, 54, 66]) p.rect(px, 88, 7, 7, 'T');
  for (const px of [159, 171, 183]) p.rect(px, 88, 7, 7, 'T');
  paintAffixRail(p, 116, 89, input.pips ?? 0);
  if (p.detail) {
    // Circuit traces out of the die (hard-edged runs, never curves).
    p.canvas.stripe(p.X(38), p.Y(36), p.X(70) - p.X(38), 'e');
    p.canvas.stripe(p.X(162), p.Y(36), p.X(194) - p.X(162), 'e');
    p.canvas.stripe(p.X(38), p.Y(74), p.X(70) - p.X(38), 'e');
    p.canvas.stripe(p.X(162), p.Y(74), p.X(194) - p.X(162), 'e');
    p.canvas.rivet(p.X(38), p.Y(78));
    p.canvas.rivet(p.X(190), p.Y(78));
    paintWear(p, [[60, 44], [180, 60], [100, 24], [150, 80]]);
  }
}

/**
 * FIXER — Relay Rig (NEW family; the incumbent art never had one).
 * A field-repair rig: twin relay masts on top, a concentric relay
 * coil for a heart, and a wrench-jaw notch bitten out of the
 * right edge with the bolt it grips still seated in the bite.
 */
function paintRelayRig(p: DesignPainter, input: ClassModComposeInput) {
  // Relay masts + crossbars + lit tips.
  p.rect(56, 10, 6, 16, 'd');
  p.rect(170, 10, 6, 16, 'd');
  p.rect(48, 6, 22, 5, 'P');
  p.rect(162, 6, 22, 5, 'P');
  p.rect(58, 2, 2, 4, 'E');
  p.rect(172, 2, 2, 4, 'E');
  // Housing, composed around the jaw bite (x188..206, y50..66 open).
  p.rect(26, 26, 162, 64, 'P');
  p.rect(188, 26, 18, 24, 'P');
  p.rect(188, 66, 18, 24, 'P');
  p.rect(26, 26, 162, 9, 'p');
  p.rect(188, 26, 18, 9, 'p');
  p.rect(26, 74, 162, 16, 'd');
  p.rect(188, 74, 18, 16, 'd');
  p.rect(187, 50, 2, 16, 'k'); // the jaw's inner face
  // The bolt the jaw grips.
  p.disc(186, 58, 6, 'T');
  p.ring(186, 58, 3, 5, 'k');
  p.disc(186, 58, 2, 'K');
  // Relay coil: concentric square windings around a hot core.
  const border = (x: number, y: number, w: number, h: number, t: number, s: GearShade) => {
    p.rect(x, y, w, t, s);
    p.rect(x, y + h - t, w, t, s);
    p.rect(x, y, t, h, s);
    p.rect(x + w - t, y, t, h, s);
  };
  border(46, 40, 36, 36, 2, 'E');
  border(54, 48, 20, 20, 2, 'd');
  p.rect(61, 55, 6, 6, 'p');
  p.rect(63, 57, 2, 2, 'W');
  paintNodeDeck(p, 100, 40, input);
  // Cable run from the coil toward the deck (one hard diagonal).
  p.canvas.thickLine(p.X(70), p.Y(78), p.X(112), p.Y(88), 0, 'k');
  p.rect(40, 90, 30, 6, 'd');
  p.rect(150, 90, 30, 6, 'd');
  p.rect(110, 96, 12, 4, 'd');
  paintAffixRail(p, 116, 100, input.pips ?? 0);
  if (p.detail) {
    p.canvas.rivet(p.X(32), p.Y(32));
    p.canvas.rivet(p.X(192), p.Y(32));
    p.canvas.rivet(p.X(32), p.Y(82));
    p.canvas.rivet(p.X(192), p.Y(82));
    p.canvas.vents(p.X(34), p.Y(64), 3);
    // One mast tip burns white-hot (seeded which).
    if (p.canvas.pick(2) === 0) p.rect(58, 1, 2, 1, 'W');
    else p.rect(172, 1, 2, 1, 'W');
    paintWear(p, [[120, 30], [60, 84], [196, 44], [36, 46]]);
  }
}

/* ------------------------------------------------------------------ */
/* The grammar                                                         */
/* ------------------------------------------------------------------ */

export const classModGrammar: GearGrammar = {
  id: 'class-mod',
  kind: 'classMod',
  plate: GEAR_CARD_PLATES.classMod, // 240×120
  paint(canvas, input) {
    const cm = input as ClassModComposeInput;
    const resolved: ClassModComposeInput = {
      ...cm,
      tree: cm.tree ?? resolveClassModTree(cm.variant),
      boosts: cm.boosts ?? [],
    };
    const p = new DesignPainter(canvas);
    switch (resolved.tree) {
      case SkillTreeType.Demolition:
        paintDrive(p, resolved);
        break;
      case SkillTreeType.Scavenger:
        paintChip(p, resolved);
        break;
      case SkillTreeType.Fixer:
        paintRelayRig(p, resolved);
        break;
      case SkillTreeType.Gunslinger:
      default:
        paintCore(p, resolved);
        break;
    }
  },
  inputFromItem: (item) => classModInputFromItem(item as ClassMod),
};
