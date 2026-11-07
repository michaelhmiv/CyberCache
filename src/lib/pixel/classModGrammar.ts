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
 * The node deck's design-space origin per tree row — declared
 * data (flexibility law), consumed by the family painters and
 * by the S3 pip-integrity pin, which reads the deck rect from
 * here instead of re-deriving the painters' layout.
 */
export const NODE_DECK_ORIGINS: Record<SkillTreeType, { x: number; y: number }> = {
  [SkillTreeType.Gunslinger]: { x: 122, y: 33 },
  [SkillTreeType.Demolition]: { x: 120, y: 36 },
  [SkillTreeType.Scavenger]: { x: 77, y: 37 },
  [SkillTreeType.Fixer]: { x: 100, y: 44 },
};
export const NODE_DECK_SIZE = { w: DECK_W, h: DECK_H };

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
  // The field's own backing plate — one ramp step up from the
  // recess, so the socket grid sits on an instrument face, not in
  // a black pit (silhouette layer: it shapes the thumb too).
  p.rect(x + 3, y + 3, DECK_W - 6, DECK_H - 6, 'd');
  // The deck is the gear engine's one true DATA surface: its
  // whole rect is protected — no wear, jitter, or grime the core
  // applies may ever land on it (S3 floor 7).
  {
    const cx0 = p.X(x);
    const cy0 = p.Y(y);
    p.canvas.protect(cx0 - 1, cy0 - 1, p.X(x + DECK_W) - cx0 + 2, p.Y(y + DECK_H) - cy0 + 2);
  }
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
      // Lit socket: deep seat on the field backing, then the 2×2
      // core fills with the rolled value — one texel at +1, two
      // at +2, the full core (escalating to white-hot) at +3.
      p.rect(sx, sy, 4, 4, 'D');
      const core: [number, number, GearShade][] = [[1, 1, 'E'], [2, 1, 'p'], [1, 2, 'p'], [2, 2, 'W']];
      const litTexels = value === 1 ? 1 : value === 2 ? 2 : 4;
      for (let i = 0; i < litTexels; i++) {
        const [dx, dy, s] = core[i];
        p.rect(sx + dx, sy + dy, 1, 1, s);
      }
    }
  }
  // The deck is a bolted-on panel: corner bolts at detail level.
  p.canvas.rivet(p.X(x + 1), p.Y(y + 1));
  p.canvas.rivet(p.X(x + DECK_W - 3), p.Y(y + 1));
  p.canvas.rivet(p.X(x + 1), p.Y(y + DECK_H - 2));
  p.canvas.rivet(p.X(x + DECK_W - 3), p.Y(y + DECK_H - 2));
}

/** Mounting bracket under the housing; affix sockets ride it. */
function paintAffixRail(p: DesignPainter, cx: number, y: number, count: number) {
  const w = Math.max(64, count * 5 + 18);
  p.rect(cx - w / 2, y, w, 9, 'd');
  p.rect(cx - w / 2, y, w, 1, 'k');
  // The rail carries the affix read — protected like the deck.
  {
    const cx0 = p.X(cx - w / 2);
    const cy0 = p.Y(y);
    p.canvas.protect(cx0 - 1, cy0 - 1, p.X(cx + w / 2) - cx0 + 2, p.Y(y + 9) - cy0 + 2);
  }
  if (!p.detail || count <= 0) return;
  let sx = cx - (count * 5 - 2) / 2;
  for (let i = 0; i < count; i++) {
    p.canvas.socket(p.X(sx), p.Y(y + 3), true);
    sx += 5;
  }
}

/**
 * Seeded wear on the casing (detail only). S3-6: the hand-placed
 * single-texel chips were audited row by row and converted to
 * seeded CLUSTER wear (the core toolkit) — same casing spots,
 * worn as patches of named cause. The spots stay casing-only by
 * construction, and clusterWear itself refuses protected cells,
 * so the node deck can never be touched from here.
 */
function paintWear(p: DesignPainter, spots: [number, number][]) {
  if (!p.detail) return;
  const n = 2 + p.canvas.pick(3);
  for (let i = 0; i < n; i++) {
    const [x, y] = spots[p.canvas.pick(spots.length)];
    p.canvas.clusterWear(p.X(x), p.Y(y), 3 + p.canvas.pick(3));
  }
}

/* ------------------------------------------------------------------ */
/* Family rows                                                         */
/* ------------------------------------------------------------------ */

/** GUNSLINGER — Combat Core: a stepped armor puck, bullseye heart. */
function paintCore(p: DesignPainter, input: ClassModComposeInput) {
  // Dark chassis: a stepped puck — blocks, not one long diagonal.
  p.rect(44, 18, 160, 64, 'D');
  p.rect(28, 30, 16, 40, 'D');
  p.rect(60, 10, 112, 8, 'D');
  p.rect(60, 82, 112, 6, 'D');
  // Armor panels over the chassis, seam-divided.
  p.rect(48, 22, 66, 56, 'P'); // bullseye panel
  p.rect(48, 22, 66, 10, 'p');
  p.rect(118, 22, 86, 6, 'P'); // header strip over the deck housing
  p.rect(32, 34, 12, 32, 'd'); // left pod — a darker side module
  p.rect(32, 34, 12, 5, 'P');
  // Casing shading breaks (S3-6): the flat 'P' masses resolve
  // into jittered patches (brokenTone touches 'P' cells only —
  // the deck and bullseye tones are physically unreachable).
  p.canvas.brokenToneRegion(p.X(48), p.Y(22), p.X(114) - p.X(48), p.Y(78) - p.Y(22));
  p.canvas.brokenToneRegion(p.X(118), p.Y(22), p.X(204) - p.X(118), p.Y(28) - p.Y(22));
  // Bullseye (the tree's sigil, worn as hardware): seat, ring, heart.
  p.disc(81, 53, 19, 'k');
  p.disc(81, 53, 17, 'E');
  p.disc(81, 53, 12, 'D');
  p.disc(81, 53, 11, 'p');
  p.disc(81, 53, 5, 'W');
  p.disc(81, 53, 2, 'E');
  paintNodeDeck(p, NODE_DECK_ORIGINS[SkillTreeType.Gunslinger].x, NODE_DECK_ORIGINS[SkillTreeType.Gunslinger].y, input);
  // Edge contacts under the puck + bracket struts.
  for (let i = 0; i < 6; i++) {
    p.rect(64 + i * 18, 88, 9, 7, 'k');
    p.rect(64 + i * 18, 93, 9, 2, 'T');
  }
  p.rect(70, 95, 8, 5, 'd');
  p.rect(154, 95, 8, 5, 'd');
  paintAffixRail(p, 116, 100, input.pips ?? 0);
  if (p.detail) {
    p.canvas.rivet(p.X(52), p.Y(26));
    p.canvas.rivet(p.X(52), p.Y(72));
    p.canvas.rivet(p.X(34), p.Y(38));
    p.canvas.rivet(p.X(196), p.Y(74));
    p.canvas.vents(p.X(126), p.Y(26), 3);
    p.canvas.seam(p.X(52), p.Y(70), p.X(110), p.Y(70));
    paintWear(p, [[58, 44], [196, 74], [150, 26], [96, 14], [36, 52]]);
  }
}

/** DEMOLITION — Tactical Drive: a finned brick with a diamond window. */
function paintDrive(p: DesignPainter, input: ClassModComposeInput) {
  const canvas = p.canvas;
  // Seeded fin count — a silhouette draw, so it precedes all detail.
  const finCount = 5 + canvas.pick(2) * 2;
  for (let i = 0; i < finCount; i++) {
    const fx = Math.round(62 + (i * 108) / Math.max(1, finCount - 1)) - 4;
    p.rect(fx, 8, 8, 14, 'k');
    p.rect(fx + 2, 10, 4, 12, 'P');
  }
  // Dark chassis, then armor panels seam-divided across its face.
  p.rect(18, 22, 196, 66, 'D');
  p.rect(26, 28, 58, 54, 'P'); // window panel
  p.rect(26, 28, 58, 8, 'p');
  p.rect(90, 28, 22, 54, 'p'); // spine panel
  p.rect(90, 28, 22, 8, 'P');
  p.rect(95, 46, 12, 16, 'K'); // spine gauge window
  p.rect(99, 52, 4, 4, 'E');
  p.rect(18, 76, 196, 12, 'k'); // foot chassis band (hazard rides it)
  // Casing shading breaks (S3-6) over the flat 'P' panels.
  p.canvas.brokenToneRegion(p.X(26), p.Y(28), p.X(84) - p.X(26), p.Y(82) - p.Y(28));
  p.canvas.brokenToneRegion(p.X(90), p.Y(28), p.X(112) - p.X(90), p.Y(36) - p.Y(28));
  // Side capacitor drums.
  p.rect(8, 36, 10, 34, 'k');
  p.rect(8, 44, 10, 7, 'P');
  p.rect(214, 36, 10, 34, 'k');
  p.rect(214, 44, 10, 7, 'P');
  // Processor window with the diamond sigil.
  p.rect(38, 34, 44, 42, 'k');
  p.rect(39, 35, 42, 40, 'K');
  p.poly([[60, 38], [75, 55], [60, 72], [45, 55]], 'E');
  p.poly([[60, 46], [67, 55], [60, 64], [53, 55]], 'p');
  p.rect(59, 54, 2, 2, 'W');
  paintNodeDeck(p, NODE_DECK_ORIGINS[SkillTreeType.Demolition].x, NODE_DECK_ORIGINS[SkillTreeType.Demolition].y, input);
  p.rect(60, 88, 8, 4, 'd');
  p.rect(164, 88, 8, 4, 'd');
  paintAffixRail(p, 116, 92, input.pips ?? 0);
  if (p.detail) {
    // Hazard chevrons along the foot band (texel-scale, hard-edged).
    for (let i = 0; i < 23; i++) p.rect(24 + i * 8, 81, 3, 2, i % 2 ? 'K' : 'W');
    p.canvas.rivet(p.X(30), p.Y(32));
    p.canvas.rivet(p.X(94), p.Y(32));
    p.canvas.rivet(p.X(30), p.Y(66));
    p.canvas.rivet(p.X(94), p.Y(66));
    p.canvas.vents(p.X(94), p.Y(42), 2);
    paintWear(p, [[104, 48], [206, 40], [30, 52], [140, 26]]);
  }
}

/** SCAVENGER — Skill Chip: a chamfered PCB; the die IS the field. */
function paintChip(p: DesignPainter, input: ClassModComposeInput) {
  const board: [number, number][] = [[46, 16], [186, 16], [202, 32], [202, 72], [186, 88], [46, 88], [30, 72], [30, 32]];
  const inner: [number, number][] = [[50, 20], [182, 20], [197, 35], [197, 69], [182, 84], [50, 84], [35, 69], [35, 35]];
  p.poly(board, 'k');
  p.poly(inner, 'D');
  // Memory blocks flanking the die — dark cans whose faces now
  // shade as broken bands (S3-6): lid mass, body, deep foot,
  // boundaries jittered per column.
  for (const bx of [40, 162]) {
    p.rect(bx, 40, 30, 26, 'k');
    p.canvas.brokenBands(
      p.X(bx + 2), p.Y(42), p.X(bx + 28) - p.X(bx + 2), p.Y(64) - p.Y(42),
      'P', 'd', 'D', 0.24, 0.82,
    );
  }
  // Corner capacitor blocks on the top edge — broken lids too.
  for (const bx of [44, 170]) {
    p.rect(bx, 24, 18, 10, 'k');
    p.canvas.brokenBands(
      p.X(bx), p.Y(24), p.X(bx + 18) - p.X(bx), p.Y(27) - p.Y(24),
      'P', 'P', 'P', 0.5, 1,
    );
  }
  paintNodeDeck(p, NODE_DECK_ORIGINS[SkillTreeType.Scavenger].x, NODE_DECK_ORIGINS[SkillTreeType.Scavenger].y, input);
  // Split edge-connector pins (the bracket rides between them).
  for (const px of [42, 54, 66]) {
    p.rect(px, 88, 7, 7, 'k');
    p.rect(px, 93, 7, 2, 'T');
  }
  for (const px of [159, 171, 183]) {
    p.rect(px, 88, 7, 7, 'k');
    p.rect(px, 93, 7, 2, 'T');
  }
  paintAffixRail(p, 116, 89, input.pips ?? 0);
  if (p.detail) {
    // Circuit traces out of the die (hard-edged runs, never curves).
    for (const ty of [36, 37]) {
      p.canvas.stripe(p.X(44), p.Y(ty), p.X(72) - p.X(44), 'e');
      p.canvas.stripe(p.X(160), p.Y(ty), p.X(188) - p.X(160), 'e');
    }
    for (const ty of [72, 73]) {
      p.canvas.stripe(p.X(44), p.Y(ty), p.X(72) - p.X(44), 'e');
      p.canvas.stripe(p.X(160), p.Y(ty), p.X(188) - p.X(160), 'e');
    }
    p.canvas.rivet(p.X(38), p.Y(76));
    p.canvas.rivet(p.X(190), p.Y(76));
    p.canvas.rivet(p.X(52), p.Y(46));
    p.canvas.rivet(p.X(170), p.Y(46));
    paintWear(p, [[58, 56], [178, 56], [100, 26], [140, 80]]);
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
  p.rect(56, 10, 6, 16, 'k');
  p.rect(170, 10, 6, 16, 'k');
  p.rect(48, 6, 22, 5, 'P');
  p.rect(162, 6, 22, 5, 'P');
  p.rect(58, 2, 2, 4, 'E');
  p.rect(172, 2, 2, 4, 'E');
  // Dark chassis, composed around the jaw bite (x188..206, y50..66 open).
  p.rect(26, 26, 162, 64, 'D');
  p.rect(188, 26, 18, 24, 'D');
  p.rect(188, 66, 18, 24, 'D');
  p.rect(26, 78, 180, 12, 'k'); // lower chassis band (panels overpaint it)
  // Armor panels: top band, the coil's panel, the jaw blocks.
  // The top band's light strip breaks per column (S3-6); the jaw
  // blocks take brokenTone over their flat 'P'.
  p.canvas.brokenBands(
    p.X(26), p.Y(26), p.X(206) - p.X(26), p.Y(38) - p.Y(26),
    'p', 'P', 'P', 0.34, 1,
  );
  p.rect(84, 26, 2, 12, 'k'); // panel seams across the top band
  p.rect(150, 26, 2, 12, 'k');
  p.rect(34, 44, 58, 40, 'k');
  p.rect(36, 46, 54, 36, 'd'); // dark panel — the coil's E winding pops on it
  p.rect(188, 38, 18, 12, 'P');
  p.rect(188, 66, 18, 12, 'P');
  p.canvas.brokenToneRegion(p.X(188), p.Y(38), p.X(206) - p.X(188), p.Y(50) - p.Y(38));
  p.canvas.brokenToneRegion(p.X(188), p.Y(66), p.X(206) - p.X(188), p.Y(78) - p.Y(66));
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
  border(43, 47, 40, 34, 3, 'E');
  border(52, 54, 22, 20, 2, 'd');
  p.rect(60, 61, 6, 6, 'p');
  p.rect(62, 63, 2, 2, 'W');
  paintNodeDeck(p, NODE_DECK_ORIGINS[SkillTreeType.Fixer].x, NODE_DECK_ORIGINS[SkillTreeType.Fixer].y, input);
  // Cable run from the coil toward the deck (one hard diagonal).
  p.canvas.thickLine(p.X(80), p.Y(84), p.X(116), p.Y(92), 1, 'K');
  p.rect(40, 90, 30, 6, 'k');
  p.rect(150, 90, 30, 6, 'k');
  p.rect(110, 96, 12, 4, 'd');
  paintAffixRail(p, 116, 100, input.pips ?? 0);
  if (p.detail) {
    p.canvas.rivet(p.X(32), p.Y(32));
    p.canvas.rivet(p.X(196), p.Y(32));
    p.canvas.rivet(p.X(32), p.Y(70));
    p.canvas.rivet(p.X(196), p.Y(70));
    p.canvas.vents(p.X(120), p.Y(82), 4);
    // One mast tip burns white-hot (seeded which).
    if (p.canvas.pick(2) === 0) p.rect(58, 1, 2, 1, 'W');
    else p.rect(172, 1, 2, 1, 'W');
    paintWear(p, [[140, 32], [60, 84], [196, 44], [104, 80]]);
  }
}

/* ------------------------------------------------------------------ */
/* The grammar                                                         */
/* ------------------------------------------------------------------ */

export const classModGrammar: GearGrammar = {
  id: 'class-mod',
  kind: 'classMod',
  plate: GEAR_CARD_PLATES.classMod, // 240×120
  wearLadder: true,
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
