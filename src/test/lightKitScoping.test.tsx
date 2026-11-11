// The light kit's two pins (2026-11-10): the smooth treatment is
// SCOPED to the cache loot moment, and the Sample B timing law it
// rides on is bit-for-bit the shipped schedule.
//
// Scoping is measured at the canvas: inside a [data-testid=
// "cache-loot-moment"] ancestor the beam and god-ray canvases back at
// FULL CSS resolution and paint through the smooth painters; the
// shockwave ring — mounted inside the same moment — keeps the
// quarter-resolution texel backing, and a beam canvas with no moment
// in its ancestry keeps it too. The painter choice is observed in the
// recorded 2d calls: the smooth fan draws filled quads (beginPath
// strokes of the tapered shafts) and the gold-spark layer paints the
// kit's gold tones, while the stepped fan draws texel fillRects only
// and knows no sparks.
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { GodRays, LootBeam, ShockwaveRing } from '../components/pixelArt/PixelFx';
import { MOVEMENT } from '../lib/pixel/movement';

const CSS_W = 412;
const CSS_H = 932;
const CELLS_W = Math.ceil(CSS_W / 4); // 103
const CELLS_H = Math.ceil(CSS_H / 4); // 233

interface Call {
  name: string;
  args: unknown[];
}

class RecordingContext {
  canvas: HTMLCanvasElement;
  calls: Call[] = [];
  fillStyle: unknown = null;
  strokeStyle: unknown = null;
  globalAlpha = 1;
  lineWidth = 1;
  private stylesAtCall: { name: string; fillStyle: unknown }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  private record(name: string, args: unknown[]) {
    this.calls.push({ name, args });
    this.stylesAtCall.push({ name, fillStyle: this.fillStyle });
  }

  clearRect(...args: unknown[]) { this.record('clearRect', args); }
  fillRect(...args: unknown[]) { this.record('fillRect', args); }
  beginPath(...args: unknown[]) { this.record('beginPath', args); }
  closePath(...args: unknown[]) { this.record('closePath', args); }
  moveTo(...args: unknown[]) { this.record('moveTo', args); }
  lineTo(...args: unknown[]) { this.record('lineTo', args); }
  arc(...args: unknown[]) { this.record('arc', args); }
  ellipse(...args: unknown[]) { this.record('ellipse', args); }
  fill(...args: unknown[]) { this.record('fill', args); }
  stroke(...args: unknown[]) { this.record('stroke', args); }

  count(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }

  fillStylesUsed(): unknown[] {
    return this.stylesAtCall.filter((s) => s.name === 'fillRect' || s.name === 'fill').map((s) => s.fillStyle);
  }

  /** Fills whose path was built from lineTo segments — the smooth
   *  fan's tapered quads (and the god-ray wedges). Ellipse fills
   *  (paintEllipse) use no lineTo; the stepped painters draw none. */
  quadFillCount(): number {
    let quadFills = 0;
    let sawLineTo = false;
    for (const c of this.calls) {
      if (c.name === 'beginPath') sawLineTo = false;
      else if (c.name === 'lineTo') sawLineTo = true;
      else if (c.name === 'fill') {
        if (sawLineTo) quadFills += 1;
        sawLineTo = false;
      }
    }
    return quadFills;
  }
}

const contexts = new Map<HTMLCanvasElement, RecordingContext>();
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let rafCallbacks: FrameRequestCallback[] = [];

function drainRaf() {
  const cbs = rafCallbacks;
  rafCallbacks = [];
  for (const cb of cbs) cb(16);
}

beforeEach(() => {
  contexts.clear();
  rafCallbacks = [];
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    let rec = contexts.get(this);
    if (!rec) {
      rec = new RecordingContext(this);
      contexts.set(this, rec);
    }
    return rec as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return CSS_W; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return CSS_H; } });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  vi.unstubAllGlobals();
});

function ctxOf(testid: string): RecordingContext {
  const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${testid}"]`);
  expect(canvas, `canvas ${testid}`).toBeTruthy();
  const rec = contexts.get(canvas!);
  expect(rec, `recording context for ${testid}`).toBeTruthy();
  return rec!;
}

function canvasOf(testid: string): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>(`[data-testid="${testid}"]`);
  expect(canvas).toBeTruthy();
  return canvas!;
}

const beamProps = {
  color: '#FFC740',
  xPct: 50,
  groundYPct: 74,
  glowYPct: 40,
  widthPx: 68,
  flareScale: 1.6,
  radiant: true,
  durationMs: MOVEMENT.LOOT_LEGENDARY_MS,
} as const;

describe('light kit scoping — backing resolution', () => {
  it('backs the loot-moment beam and god rays at full CSS resolution', () => {
    render(
      <div data-testid="cache-loot-moment">
        <LootBeam {...beamProps} reduced />
        <GodRays xPct={50} yPct={40} reduced />
      </div>,
    );
    expect(canvasOf('fx-loot-beam').width).toBe(CSS_W);
    expect(canvasOf('fx-loot-beam').height).toBe(CSS_H);
    expect(canvasOf('fx-god-rays').width).toBe(CSS_W);
    expect(canvasOf('fx-god-rays').height).toBe(CSS_H);
  });

  it('keeps the shockwave ring on the texel grid INSIDE the moment', () => {
    render(
      <div data-testid="cache-loot-moment">
        <ShockwaveRing xPct={50} groundYPct={74} color="#FFC740" />
      </div>,
    );
    expect(canvasOf('fx-shockwave-ring').width).toBe(CELLS_W);
    expect(canvasOf('fx-shockwave-ring').height).toBe(CELLS_H);
  });

  it('keeps the beam and god rays on the texel grid OUTSIDE the moment', () => {
    render(
      <div>
        <LootBeam {...beamProps} reduced />
        <GodRays xPct={50} yPct={40} reduced />
      </div>,
    );
    expect(canvasOf('fx-loot-beam').width).toBe(CELLS_W);
    expect(canvasOf('fx-loot-beam').height).toBe(CELLS_H);
    expect(canvasOf('fx-god-rays').width).toBe(CELLS_W);
    expect(canvasOf('fx-god-rays').height).toBe(CELLS_H);
  });

  it('the production cache id scopes; a lookalike id does not', () => {
    render(
      <div data-testid="cache-loot-moment-2">
        <LootBeam {...beamProps} reduced />
      </div>,
    );
    expect(canvasOf('fx-loot-beam').width).toBe(CELLS_W);
  });
});

describe('light kit scoping — painter choice', () => {
  it('in-moment beam paints smooth: tapered-shaft quads and gold sparks', () => {
    render(
      <div data-testid="cache-loot-moment">
        <LootBeam {...beamProps} reduced />
      </div>,
    );
    const rec = ctxOf('fx-loot-beam');
    // The smooth fan fills its tapered-shaft quads (lineTo-built
    // paths); no stepped painter draws a lineTo path at all.
    expect(rec.quadFillCount()).toBeGreaterThan(0);
    // The gold-spark layer paints the kit's gold tones.
    const golds = ['#FFEA3A', '#FFC65C', '#FFF3A0'];
    expect(rec.fillStylesUsed().some((s) => golds.includes(s as string))).toBe(true);
  });

  it('out-of-moment beam paints stepped: texel rects only, no sparks, no quads', () => {
    render(
      <div>
        <LootBeam {...beamProps} reduced />
      </div>,
    );
    const rec = ctxOf('fx-loot-beam');
    expect(rec.count('fillRect')).toBeGreaterThan(0);
    // The smooth fan's signature is the lineTo-built quad fill; the
    // stepped painter draws no lineTo path (its glow is ellipse
    // fills, its fan is texel rects).
    expect(rec.count('lineTo')).toBe(0);
    expect(rec.quadFillCount()).toBe(0);
    const golds = ['#FFEA3A', '#FFC65C', '#FFF3A0'];
    expect(rec.fillStylesUsed().some((s) => golds.includes(s as string))).toBe(false);
  });

  it('in-moment god rays use the smooth three-stop falloff; out-of-moment keeps two bands', () => {
    const { unmount } = render(
      <div data-testid="cache-loot-moment">
        <GodRays xPct={50} yPct={40} reduced />
      </div>,
    );
    // 9 wedges × 3 falloff stops.
    expect(ctxOf('fx-god-rays').count('arc')).toBe(27);
    unmount();
    render(
      <div>
        <GodRays xPct={50} yPct={40} reduced />
      </div>,
    );
    // 9 wedges × the shipped 2 stepped bands.
    expect(ctxOf('fx-god-rays').count('arc')).toBe(18);
  });

  it('presents the beam and god rays smoothly; the ring keeps pixelated', () => {
    render(
      <div data-testid="cache-loot-moment">
        <LootBeam {...beamProps} reduced />
        <GodRays xPct={50} yPct={40} reduced />
        <ShockwaveRing xPct={50} groundYPct={74} color="#FFC740" />
      </div>,
    );
    expect(canvasOf('fx-loot-beam').style.imageRendering).toBe('auto');
    expect(canvasOf('fx-god-rays').style.imageRendering).toBe('auto');
    expect(canvasOf('fx-shockwave-ring').style.imageRendering).toBe('pixelated');
    drainRaf();
  });
});

describe('Sample B timing law — the schedule the light kit rides', () => {
  it('pins every loot-moment timing constant bit-for-bit', () => {
    expect(MOVEMENT.LOOT_COMMON_MS).toBe(900);
    expect(MOVEMENT.LOOT_UNCOMMON_MS).toBe(1000);
    expect(MOVEMENT.LOOT_RARE_MS).toBe(1100);
    expect(MOVEMENT.LOOT_EPIC_MS).toBe(1400);
    expect(MOVEMENT.LOOT_LEGENDARY_MS).toBe(2600);
    expect(MOVEMENT.LOOT_CARD_IN_MS).toBe(380);
    expect(MOVEMENT.LOOT_BEAM_IN_MS).toBe(420);
    expect(MOVEMENT.LOOT_RISE_MS).toBe(950);
    expect(MOVEMENT.LOOT_FLOAT_MS).toBe(2600);
    expect(MOVEMENT.LOOT_RAYS_SPIN_MS).toBe(16000);
    expect(MOVEMENT.LOOT_SHOCKWAVE_MS).toBe(900);
    expect(MOVEMENT.LOOT_TWINKLE_MS).toBe(1200);
    expect(MOVEMENT.LOOT_HOP_MS).toBe(460);
    expect(MOVEMENT.LOOT_DIM_OPACITY).toBe(0.4);
    expect(MOVEMENT.LOOT_SKIP_LINGER_MS).toBe(650);
    // The ember cadence the spark layer rides.
    expect(MOVEMENT.EMBER_RISE_MS).toBe(5200);
  });
});
