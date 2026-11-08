import { Container, Sprite, Texture, Assets } from 'pixi.js';
import { PRIMARY_ANCHOR, PART_SLOTS } from '@/lib/pixel/parts';
import { MOVEMENT } from '@/lib/pixel/movement';
import { EASE, easeOutBack } from '@/lib/pixel/pixiChoreography';
import type { PartSetLayout } from '@/lib/pixel/partsCompositor';
import { requirePixelSprite } from '@/lib/pixel/manifest';
import { paletteSpriteUrl, type PaletteSpec } from '@/lib/pixel/paletteSwap';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import {
  composeWeaponCardCached,
  paintWeaponCard,
} from '@/lib/pixel/weaponCardCompositor';
import type { PartSlot } from '@/lib/pixel/parts';
import type { Weapon } from '@/types/items';

/**
 * Shared Pixi stage core — the texture helpers, procedural FX
 * textures, and parts-actor node machinery the Pixi stages share.
 * Extracted verbatim from the boss pilot (BossPixiStage, PR #429)
 * when the roam stage joined it (Motion Reboot M2, 2026-11-07):
 * ONE implementation of the pilot's rendering contract — resolution
 * pinned at 1.0 with nearest-neighbour sampling throughout, so the
 * texel grid stays hard-edged exactly as the DOM stage's pixelated
 * <img>s render it.
 */

/** Stage resolution pin: 1.0, nearest-sampled — see BossPixiStage's
 *  STAGE_RESOLUTION note (the half-res experiment smeared). */
export const STAGE_RESOLUTION = 1;

export const DEG = Math.PI / 180;

/** Part paint order, from the parts system's own slot table. */
export const PART_PAINT_ORDER = new Map(PART_SLOTS.map((s) => [s.slot, s.paintOrder]));

export interface PartNode {
  slot: string;
  container: Container;
  sprite: Sprite;
  anchorStage: { x: number; y: number };
  primaryLocal: { x: number; y: number };
  width: number;
  height: number;
  rotationDeg: number;
  tween?: { from: number; to: number; startMs: number; durationMs: number; overshoot: boolean };
  /** Roam position blend (M2): anchor/local lerp, same durations. */
  posTween?: {
    fromAnchor: { x: number; y: number };
    toAnchor: { x: number; y: number };
    fromLocal: { x: number; y: number };
    toLocal: { x: number; y: number };
    startMs: number;
    durationMs: number;
  };
}


export function nearest(tex: Texture): Texture {
  // Nearest on every filter path + no mipmaps: the sprites are
  // minified into the half-resolution stage, and v8's default
  // linear/mipmap minification is what would soften the texel grid.
  tex.source.scaleMode = 'nearest';
  tex.source.magFilter = 'nearest';
  tex.source.minFilter = 'nearest';
  tex.source.mipmapFilter = 'nearest';
  tex.source.autoGenerateMipmaps = false;
  return tex;
}

export async function loadTexture(src: string): Promise<Texture> {
  if (src.startsWith('data:')) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return nearest(Texture.from(img));
  }
  return nearest(await Assets.load<Texture>(src));
}

export function canvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, w, h);
  return nearest(Texture.from(canvas));
}

/** The muzzle star, drawn from the DOM kit's STAR_CLIP polygon. */
export function starTexture(): Texture {
  const pts: [number, number][] = [
    [50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35],
  ];
  return canvasTexture((ctx, w, h) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo((x / 100) * w, (y / 100) * h);
      else ctx.lineTo((x / 100) * w, (y / 100) * h);
    });
    ctx.closePath();
    ctx.fillStyle = '#FFE9A8';
    ctx.fill();
  }, 68, 68);
}

export function radialTexture(): Texture {
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,75,92,0.4)');
    g.addColorStop(0.7, 'rgba(255,75,92,0)');
    g.addColorStop(1, 'rgba(255,75,92,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 110, 110);
}

export function ellipseTexture(color: string): Texture {
  return canvasTexture((ctx, w, h) => {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, 128, 41);
}

export function ringTexture(): Texture {
  return canvasTexture((ctx, w, h) => {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#D8B988';
    ctx.lineWidth = 4;
    ctx.stroke();
  }, 30, 12);
}

export function circleTexture(color: string): Texture {
  return canvasTexture((ctx, w, h) => {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, 32, 32);
}

export function tracerTexture(): Texture {
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,215,106,0)');
    g.addColorStop(0.55, '#FFD76A');
    g.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 64, 3);
}

export function solidTexture(color: string): Texture {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }, 4, 4);
}

/** The held weapon's texture: the card compositor's HELD-mode render
 *  painted to a canvas (One Grammar, 2026-11-06) — the same pixels
 *  PixelWeapon shows at 'held' density on the DOM stage. Bespoke
 *  legendaries compose through the same held path since V4. */
export async function weaponTextureForWeapon(weapon: Weapon | undefined): Promise<Texture | null> {
  if (!weapon) return null;
  const input = pixelWeaponInputFromWeapon(weapon);
  const render = composeWeaponCardCached(input, undefined, { held: true });
  const canvas = document.createElement('canvas');
  canvas.width = render.width;
  canvas.height = render.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintWeaponCard(ctx, render, 1);
  return nearest(Texture.from(canvas));
}

export function partSlotTweenDurationMs(slot: string): number {
  if (slot === 'armUpperN' || slot === 'armForeN' || slot === 'armFar') return MOVEMENT.SEGMENT.ARM_RAISE_MS;
  if (slot === 'head') return MOVEMENT.SEGMENT.HEAD_TRACK_MS;
  return MOVEMENT.SEGMENT.STEP_BOB_MS;
}

/** Build the per-part scene nodes for a laid-out part set: one
 *  container per placed part (paint order), the sprite offset by
 *  its primary anchor — the pilot's scene-build shape. Texture
 *  sources resolve palettes exactly as the DOM actor resolves them
 *  (per-slot palette wins). */
export async function createPartNodes(args: {
  layout: PartSetLayout;
  partPalettes?: Partial<Record<PartSlot, { paletteId: string; spec: PaletteSpec }>> | null;
}): Promise<PartNode[]> {
  const placements = Object.values(args.layout.placements)
    .filter((p): p is NonNullable<typeof p> => !!p)
    .sort((a, b) => (PART_PAINT_ORDER.get(a.part.slot) ?? 0) - (PART_PAINT_ORDER.get(b.part.slot) ?? 0));
  const nodes: PartNode[] = [];
  for (const placement of placements) {
    const sprite = requirePixelSprite(placement.part.spriteId);
    const slotPalette = args.partPalettes?.[placement.part.slot];
    const src = slotPalette
      ? paletteSpriteUrl(placement.part.spriteId, sprite.url, slotPalette.paletteId, slotPalette.spec)
      : sprite.url;
    const tex = await loadTexture(src);
    const container = new Container();
    container.zIndex = PART_PAINT_ORDER.get(placement.part.slot) ?? 0;
    const spriteNode = new Sprite(tex);
    container.addChild(spriteNode);
    nodes.push({
      slot: placement.part.slot,
      container,
      sprite: spriteNode,
      anchorStage: placement.anchorStage,
      primaryLocal: placement.part.anchors[PRIMARY_ANCHOR[placement.part.slot]],
      width: placement.part.width,
      height: placement.part.height,
      rotationDeg: placement.rotationDeg,
    });
  }
  return nodes;
}

/** Apply a layout's pose to the part nodes: ROTATIONS tween on the
 *  SEGMENT slot durations (easeOutBack overshoot on the arm chain
 *  when the recoil pose lands) — the pilot's execution. Positions
 *  snap from the new layout, exactly as the DOM actor's do, UNLESS
 *  `blendPositions` is set (the roam stage, Motion Reboot M2: the
 *  brief's pose blending includes position — anchor stage points
 *  and primary locals lerp over the same per-slot durations). */
export function applyPartPose(
  nodes: PartNode[],
  layout: PartSetLayout,
  now: number,
  opts: { poseName: string; blendPositions?: boolean },
): void {
  for (const node of nodes) {
    const placement = layout.placements[node.slot as keyof typeof layout.placements];
    if (!placement) continue;
    const durationMs = partSlotTweenDurationMs(node.slot);
    if (opts.blendPositions) {
      node.posTween = {
        fromAnchor: { ...node.anchorStage },
        toAnchor: { ...placement.anchorStage },
        fromLocal: { ...node.primaryLocal },
        toLocal: { ...placement.part.anchors[PRIMARY_ANCHOR[node.slot as PartSlot]] },
        startMs: now,
        durationMs,
      };
    }
    node.anchorStage = placement.anchorStage;
    node.primaryLocal = placement.part.anchors[PRIMARY_ANCHOR[node.slot as PartSlot]];
    node.width = placement.part.width;
    node.height = placement.part.height;
    const isArm = node.slot === 'armUpperN' || node.slot === 'armForeN' || node.slot === 'armFar';
    node.tween = {
      from: node.rotationDeg,
      to: placement.rotationDeg,
      startMs: now,
      durationMs,
      overshoot: opts.poseName === 'recoil' && isArm,
    };
  }
}

/** Sample the part nodes' tweens at `now` and write their container
 *  transforms at frame scale `s` (frame px → stage px). */
export function tickPartNodes(nodes: PartNode[], now: number, s: number): void {
  for (const node of nodes) {
    if (node.tween) {
      const p = Math.max(0, Math.min(1, (now - node.tween.startMs) / node.tween.durationMs));
      const eased = node.tween.overshoot ? easeOutBack(p) : EASE.easeOut(p);
      node.rotationDeg = node.tween.from + (node.tween.to - node.tween.from) * eased;
      if (p >= 1) node.tween = undefined;
    }
    let anchor = node.anchorStage;
    let local = node.primaryLocal;
    if (node.posTween) {
      const tw = node.posTween;
      const p = Math.max(0, Math.min(1, (now - tw.startMs) / tw.durationMs));
      const e = EASE.easeOut(p);
      anchor = {
        x: tw.fromAnchor.x + (tw.toAnchor.x - tw.fromAnchor.x) * e,
        y: tw.fromAnchor.y + (tw.toAnchor.y - tw.fromAnchor.y) * e,
      };
      local = {
        x: tw.fromLocal.x + (tw.toLocal.x - tw.fromLocal.x) * e,
        y: tw.fromLocal.y + (tw.toLocal.y - tw.fromLocal.y) * e,
      };
      if (p >= 1) node.posTween = undefined;
    }
    node.container.position.set(anchor.x * s, anchor.y * s);
    node.container.rotation = node.rotationDeg * DEG;
    node.sprite.position.set(-local.x * s, -local.y * s);
    node.sprite.width = node.width * s;
    node.sprite.height = node.height * s;
  }
}
