/**
 * Vista ambient sampler + painter — Full Visual Program V1.
 *
 * Instances expand from the scene's data rows (vistaScenes.ts) and
 * are sampled against a (wallMs, panMs) clock: wall time drives each
 * element's own motion; pan time moves ONLY the bands — band-anchored
 * elements ride the pan through the pan offsets (Layered-Motion
 * Law: ambient elements move independently of the band pan and of
 * each other; nothing is baked into a band).
 *
 * One painter draws into a 2D canvas in stage design space
 * (960x640); both stage renderers use it — the DOM stage paints one
 * canvas per paint layer, the Pixi roam stage paints the same
 * canvases into canvas textures — so DOM/Pixi ambient parity is
 * structural, not re-implemented.
 */
import { PIXEL_TEXEL, getPixelSprite } from './manifest';
import {
  VISTA_LAYER_SLOTS,
  VISTA_STAGE_H,
  VISTA_STAGE_W,
  vistaBandDisplayScale,
  vistaBandDisplayW,
  type VistaAmbientElement,
  type VistaLayerId,
  type VistaPaintLayer,
  type VistaSceneSpec,
} from './vistaScenes';

export interface VistaClock {
  wallMs: number;
  panMs: number;
}

export interface VistaAmbientInstance {
  el: VistaAmbientElement;
  index: number;
  /** Phase offset 0..1 of the element's own cycle. */
  phase: number;
  /** Deterministic 0..1 hash of (scene, element, index). */
  seed: number;
  spriteId: string;
  /** Anchor in the element's anchorSpace: x = center, y = bottom
   *  (for 'sweep', y = center). */
  cx: number;
  bottom: number;
}

/** Deterministic hash -> 0..1 (no Math.random anywhere: sampling is
 *  a pure function of the clock, so tests and renderers agree). */
export function vistaHash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function expandVistaAmbient(scene: VistaSceneSpec): VistaAmbientInstance[] {
  const out: VistaAmbientInstance[] = [];
  for (const el of scene.ambient) {
    const anchors = el.anchors ?? [{ x: el.x, y: el.y }];
    if (el.field) {
      const { count, xFrac, yFrac } = el.field;
      for (let i = 0; i < count; i += 1) {
        const sx = vistaHash(`${scene.id}:${el.id}:x:${i}`);
        const sy = vistaHash(`${scene.id}:${el.id}:y:${i}`);
        out.push({
          el,
          index: i,
          phase: count > 1 ? i / count : 0,
          seed: vistaHash(`${scene.id}:${el.id}:${i}`),
          spriteId: el.variants && el.variants.length > 0 && i % 2 === 1 ? el.variants[0] : el.spriteId,
          cx: VISTA_STAGE_W * (xFrac[0] + sx * (xFrac[1] - xFrac[0])),
          bottom: VISTA_STAGE_H * (yFrac[0] + sy * (yFrac[1] - yFrac[0])),
        });
      }
      continue;
    }
    const n = Math.max(anchors.length, el.phases?.length ?? 1);
    for (let i = 0; i < n; i += 1) {
      const a = anchors[i % anchors.length];
      out.push({
        el,
        index: i,
        phase: el.phases?.[i % (el.phases.length || 1)] ?? (n > 1 ? i / n : 0),
        seed: vistaHash(`${scene.id}:${el.id}:${i}`),
        spriteId: el.spriteId,
        cx: a.x,
        bottom: a.y,
      });
    }
  }
  return out;
}

export interface VistaSample {
  visible: boolean;
  /** Center x and bottom y in stage design px (center-bottom pivot). */
  cx: number;
  bottom: number;
  /** Left-center pivot point (sweep elements only). */
  ax: number;
  ay: number;
  /** Multipliers on the sprite's base design size (el.scale folded
   *  into the base size by the painter; these are motion factors). */
  sx: number;
  sy: number;
  rotationDeg: number;
  opacity: number;
}

const TAU = Math.PI * 2;

function tri(x: number): number {
  const f = x - Math.floor(x);
  return f < 0.5 ? f * 2 : 2 - f * 2;
}
function sine(x: number): number {
  return 0.5 + 0.5 * Math.sin(TAU * x);
}
function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Base design size (stage px) of an instance's sprite: manifest
 *  file px x texel x the row's authored scale. */
export function vistaSpriteDesignSize(spriteId: string, scale: number): { w: number; h: number } {
  const s = getPixelSprite(spriteId);
  if (!s) return { w: 0, h: 0 };
  return { w: s.width * PIXEL_TEXEL * scale, h: s.height * PIXEL_TEXEL * scale };
}

/** Stage-space anchor for an instance before its own motion: stage
 *  rows pass through; band rows convert through the layer's display
 *  scale and the current pan offset (unwrapped — the painter draws
 *  the wrapped copies). */
export function vistaInstanceStageAnchor(
  inst: VistaAmbientInstance,
  panOffsets: Record<VistaLayerId, number>,
): { cx: number; bottom: number } {
  const { el } = inst;
  if (el.anchorSpace === 'stage') return { cx: inst.cx, bottom: inst.bottom };
  const layer = el.layer as VistaLayerId;
  const s = vistaBandDisplayScale(layer);
  const slotTop = VISTA_STAGE_H * VISTA_LAYER_SLOTS[layer].topFrac;
  return {
    cx: inst.cx * s - panOffsets[layer],
    bottom: slotTop + inst.bottom * s,
  };
}

export function sampleVistaAmbient(
  inst: VistaAmbientInstance,
  clock: VistaClock,
  panOffsets: Record<VistaLayerId, number>,
): VistaSample {
  const { el } = inst;
  const m = el.motion;
  const t = clock.wallMs / 1000;
  const anchor = vistaInstanceStageAnchor(inst, panOffsets);
  const { w, h } = vistaSpriteDesignSize(inst.spriteId, el.scale);
  const out: VistaSample = {
    visible: true,
    cx: anchor.cx,
    bottom: anchor.bottom,
    ax: anchor.cx,
    ay: anchor.bottom,
    sx: el.flipX ? -1 : 1,
    sy: 1,
    rotationDeg: 0,
    opacity: el.opacity,
  };
  const seedPhase = inst.seed;

  switch (m.kind) {
    case 'drift': {
      const speed = m.speedPxS;
      if (m.wanderRangePx) {
        // Pingpong traverse (scan sweep): out and back across the range.
        const sweepT = (speed * t) / m.wanderRangePx + inst.phase;
        out.cx = anchor.cx + (tri(sweepT) - 0.5) * m.wanderRangePx * (m.dirX >= 0 ? 1 : -1);
      } else if (m.dirX !== 0) {
        const span = VISTA_STAGE_W + 2 * m.wrapMarginPx + w;
        const raw = anchor.cx + w / 2 + m.wrapMarginPx + m.dirX * speed * (t + inst.phase * 13);
        out.cx = mod(raw, span) - m.wrapMarginPx - w / 2;
      } else if (m.dirY !== 0) {
        const span = VISTA_STAGE_H + 2 * m.wrapMarginPx + h;
        const raw = anchor.bottom + m.wrapMarginPx + m.dirY * speed * (t + inst.phase * 13);
        out.bottom = mod(raw, span) - m.wrapMarginPx;
      }
      if (m.verticalDriftPx && m.verticalPeriodS) {
        out.bottom += Math.sin(TAU * (t / m.verticalPeriodS) + seedPhase * TAU) * m.verticalDriftPx;
      }
      if (m.spinPeriodS) out.rotationDeg = 360 * mod(t / m.spinPeriodS + seedPhase, 1);
      break;
    }
    case 'rise': {
      const jitter = el.field ? 0.7 + 0.6 * seedPhase : 1;
      const speed = m.speedPxS * jitter;
      const travel = m.risePx ?? 200;
      const cycleS = travel / Math.max(speed, 0.001);
      const frac = mod(t / cycleS + inst.phase, 1);
      out.bottom = anchor.bottom - frac * travel;
      if (m.swayPx && m.swayPeriodS) {
        out.cx += Math.sin(TAU * (t / m.swayPeriodS) + seedPhase * TAU) * m.swayPx;
      }
      if (m.envelope !== undefined) {
        const fadeIn = 0.15;
        const fadeOut = 0.35;
        const env = frac < fadeIn ? frac / fadeIn : frac > 1 - fadeOut ? (1 - frac) / fadeOut : 1;
        out.opacity = el.opacity * m.envelope * Math.max(0, env);
      } else if (frac > 0.8) {
        out.opacity = el.opacity * ((1 - frac) / 0.2);
      }
      break;
    }
    case 'wander': {
      out.cx = anchor.cx + (tri(t / m.periodS + inst.phase) - 0.5) * m.rangePx * 2;
      if (m.verticalDriftPx && m.verticalPeriodS) {
        out.bottom += Math.sin(TAU * (t / m.verticalPeriodS) + seedPhase * TAU) * m.verticalDriftPx;
      }
      if (m.scalePulse) {
        const f = lerp(m.scalePulse.min, m.scalePulse.max, sine(t / m.scalePulse.periodS + seedPhase));
        out.sx *= f;
        out.sy *= f;
      }
      if (m.skewDeg) {
        const p = m.scalePulse?.periodS ?? m.periodS;
        out.rotationDeg = Math.sin(TAU * (t / p) + seedPhase * TAU) * m.skewDeg;
      }
      if (m.opacityRange) {
        const p = m.opacityPeriodS ?? m.periodS;
        out.opacity = el.opacity * lerp(m.opacityRange[0], m.opacityRange[1], sine(t / p + seedPhase));
      }
      break;
    }
    case 'pulse': {
      const f = sine(t / m.periodS + inst.phase);
      if (m.scaleRange) {
        const s = lerp(m.scaleRange[0], m.scaleRange[1], f);
        out.sx *= s;
        out.sy *= s;
      }
      if (m.scaleYRange) out.sy *= lerp(m.scaleYRange[0], m.scaleYRange[1], f);
      if (m.opacityRange) out.opacity = el.opacity * lerp(m.opacityRange[0], m.opacityRange[1], f);
      if (m.yPx) out.bottom += Math.sin(TAU * (t / m.periodS) + inst.phase * TAU) * m.yPx;
      // risePx on a pulse row is the authored grow-upward beat; the
      // bottom-anchored scaleY already lifts the top edge, so it is
      // not double-applied to the anchor.
      break;
    }
    case 'blink': {
      const cycle = Math.floor(t / m.periodS + inst.phase);
      const frac = mod(t / m.periodS + inst.phase, 1);
      out.visible = frac < m.duty;
      if (m.jitterPx) {
        out.cx += (vistaHash(`${el.id}:jitter:${cycle}`) - 0.5) * 2 * m.jitterPx;
        out.bottom += (vistaHash(`${el.id}:jittery:${cycle}`) - 0.5) * m.jitterPx * 0.4;
      }
      break;
    }
    case 'traverse': {
      const interval = lerp(m.intervalMs[0], m.intervalMs[1], seedPhase);
      const cycle = m.durationMs + interval;
      const local = mod(clock.wallMs + inst.phase * cycle, cycle);
      if (local > m.durationMs) {
        out.visible = false;
        break;
      }
      const u = local / m.durationMs;
      out.cx = lerp(m.fromX, m.toX, u);
      if (m.fadeEnds) out.opacity = el.opacity * Math.pow(Math.sin(Math.PI * u), 0.7);
      break;
    }
    case 'field-drift': {
      const frac = mod(clock.wallMs / m.durationMs + inst.phase, 1);
      out.cx = anchor.cx + frac * m.dxPx;
      out.bottom = anchor.bottom + frac * m.dyPx;
      if (m.swayPx) {
        out.cx += Math.sin(TAU * (clock.wallMs / m.durationMs) + seedPhase * TAU) * m.swayPx;
      }
      if (m.opacityRange) {
        out.opacity = el.opacity * lerp(m.opacityRange[0], m.opacityRange[1], Math.sin(Math.PI * frac));
      } else if (m.fadeEnds) {
        out.opacity = el.opacity * Math.sin(Math.PI * frac);
      }
      break;
    }
    case 'fall': {
      const interval = lerp(m.intervalMs[0], m.intervalMs[1], seedPhase);
      const cycle = m.durationMs + interval;
      const local = mod(clock.wallMs + inst.phase * cycle, cycle);
      if (local > m.durationMs) {
        out.visible = false;
        break;
      }
      const u = local / m.durationMs;
      out.bottom = anchor.bottom + Math.pow(u, 1.3) * m.dyPx;
      out.cx = anchor.cx + Math.sin(u * TAU) * m.swayPx * u;
      if (u > 0.75) out.opacity = el.opacity * (1 - (u - 0.75) / 0.25);
      break;
    }
    case 'fountain': {
      const interval = lerp(m.intervalMs[0], m.intervalMs[1], seedPhase);
      const cycle = m.burstMs + interval;
      const local = mod(clock.wallMs + inst.phase * cycle, cycle);
      if (local > m.burstMs) {
        out.visible = false;
        break;
      }
      const u = local / m.burstMs;
      out.bottom = anchor.bottom - Math.sin(Math.PI * u) * 52;
      out.sy *= 1 + 0.5 * Math.sin(Math.PI * u);
      out.opacity = el.opacity * Math.pow(Math.sin(Math.PI * u), 0.5);
      break;
    }
    case 'drip': {
      const interval = lerp(m.intervalMs[0], m.intervalMs[1], seedPhase);
      const cycle = m.durationMs + interval;
      const local = mod(clock.wallMs + inst.phase * cycle, cycle);
      if (local > m.durationMs) {
        out.visible = false;
        break;
      }
      const u = local / m.durationMs;
      out.bottom = anchor.bottom + u * u * m.dyPx;
      out.sy *= 1 + 0.8 * u;
      out.opacity = el.opacity * (1 - 0.3 * u);
      break;
    }
    case 'sweep': {
      const f = tri(clock.wallMs / m.durationMs + inst.phase);
      out.rotationDeg = lerp(m.angleDeg[0], m.angleDeg[1], f);
      out.ax = anchor.cx;
      out.ay = el.anchorSpace === 'band'
        ? VISTA_STAGE_H * VISTA_LAYER_SLOTS[el.layer as VistaLayerId].topFrac + inst.bottom * vistaBandDisplayScale(el.layer as VistaLayerId)
        : anchor.bottom;
      break;
    }
    case 'flicker': {
      const v = Math.max(0, Math.min(1,
        0.5 + 0.28 * Math.sin(TAU * (t / m.periodS) + seedPhase * TAU)
        + 0.22 * Math.sin(TAU * (t / (m.periodS * 0.35)) + 1.7 + seedPhase * TAU)));
      out.sy *= lerp(m.scaleYRange[0], m.scaleYRange[1], v);
      out.opacity = el.opacity * lerp(m.opacityRange[0], m.opacityRange[1], v);
      out.rotationDeg = Math.sin(TAU * (t / (m.periodS * 1.43)) + seedPhase * TAU) * m.skewDeg;
      break;
    }
    default:
      break;
  }
  return out;
}

export type VistaImageSource = {
  width: number;
  height: number;
  source: CanvasImageSource;
};

/**
 * Paint one paint-layer's instances into a 2D context already
 * transformed so 1 unit = 1 stage design px. Band-anchored samples
 * are drawn at their wrapped copies too, so an element crossing the
 * pan seam stays continuous.
 */
export function paintVistaAmbientLayer(args: {
  ctx: CanvasRenderingContext2D;
  instances: VistaAmbientInstance[];
  layer: VistaPaintLayer;
  images: ReadonlyMap<string, VistaImageSource>;
  clock: VistaClock;
  panOffsets: Record<VistaLayerId, number>;
}): void {
  const { ctx, instances, layer, images, clock, panOffsets } = args;
  for (const inst of instances) {
    if (inst.el.layer !== layer) continue;
    const img = images.get(inst.spriteId);
    if (!img || img.width <= 0) continue;
    const sample = sampleVistaAmbient(inst, clock, panOffsets);
    if (!sample.visible || sample.opacity <= 0.003) continue;
    const { w, h } = vistaSpriteDesignSize(inst.spriteId, inst.el.scale);
    if (w <= 0 || h <= 0) continue;
    const draw = (cx: number) => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, sample.opacity));
      if (inst.el.pivot === 'left-center') {
        ctx.translate(cx, sample.ay);
        ctx.rotate((sample.rotationDeg * Math.PI) / 180);
        ctx.scale(sample.sx, sample.sy);
        ctx.drawImage(img.source, 0, -h / 2, w, h);
      } else if (inst.el.motion.kind === 'drift' && inst.el.motion.spinPeriodS) {
        ctx.translate(cx, sample.bottom - h / 2);
        ctx.rotate((sample.rotationDeg * Math.PI) / 180);
        ctx.scale(sample.sx, sample.sy);
        ctx.drawImage(img.source, -w / 2, -h / 2, w, h);
      } else {
        ctx.translate(cx, sample.bottom);
        ctx.rotate((sample.rotationDeg * Math.PI) / 180);
        ctx.scale(sample.sx, sample.sy);
        ctx.drawImage(img.source, -w / 2, -h, w, h);
      }
      ctx.restore();
    };
    draw(sample.cx);
    if (inst.el.anchorSpace === 'band') {
      const dispW = vistaBandDisplayW(inst.el.layer as VistaLayerId);
      if (sample.cx > VISTA_STAGE_W - w) draw(sample.cx - dispW);
      if (sample.cx < w) draw(sample.cx + dispW);
    }
  }
}

/** Paint every paint layer of a scene (DOM stage: one canvas per
 *  layer; this helper serves tests and single-canvas callers). */
export function paintVistaAmbient(args: {
  ctx: CanvasRenderingContext2D;
  scene: VistaSceneSpec;
  instances: VistaAmbientInstance[];
  images: ReadonlyMap<string, VistaImageSource>;
  clock: VistaClock;
  panOffsets: Record<VistaLayerId, number>;
}): void {
  for (const layer of ['far', 'mid', 'near', 'stage'] as VistaPaintLayer[]) {
    paintVistaAmbientLayer({ ...args, layer });
  }
}
