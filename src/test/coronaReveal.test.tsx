// The Corona grammar pins (2026-11-11, DESIGN.md §8): inside the
// cache loot moment the beam's light is physical — the glow field and
// ground bloom are radial-gradient falloffs (no banded ellipse discs),
// the ray layer is the fine Corona field, and the beam is slimmer
// than the tier width the caller passes. The header law pins beside
// it: with a header band declared, the painter runs a destination-out
// notch pass over the beam column across the band (erasing ~70% of
// the light there, i.e. keeping ~30%); without a band, no erase pass
// runs at all. Outside the moment none of this exists — the stepped
// painters stand (lightKitScoping.test.tsx holds that side).
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LootBeam } from '../components/pixelArt/PixelFx';
import { MOVEMENT } from '../lib/pixel/movement';

const CSS_W = 412;
const CSS_H = 932;

interface Call {
  name: string;
  args: unknown[];
  alpha: number;
  composite: string;
  fillStyle: unknown;
}

class RecordingContext {
  canvas: HTMLCanvasElement;
  calls: Call[] = [];
  fillStyle: unknown = null;
  strokeStyle: unknown = null;
  globalAlpha = 1;
  globalCompositeOperation = 'source-over';
  lineWidth = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  private record(name: string, args: unknown[]) {
    this.calls.push({ name, args, alpha: this.globalAlpha, composite: this.globalCompositeOperation, fillStyle: this.fillStyle });
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
  save(...args: unknown[]) { this.record('save', args); }
  restore(...args: unknown[]) { this.record('restore', args); }
  translate(...args: unknown[]) { this.record('translate', args); }
  scale(...args: unknown[]) { this.record('scale', args); }
  createRadialGradient(...args: unknown[]) {
    this.record('createRadialGradient', args);
    return { addColorStop: () => {} };
  }
  createLinearGradient(...args: unknown[]) {
    this.record('createLinearGradient', args);
    return { addColorStop: () => {} };
  }

  count(name: string): number {
    return this.calls.filter((c) => c.name === name).length;
  }
}

const contexts = new Map<HTMLCanvasElement, RecordingContext>();
let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;

beforeEach(() => {
  contexts.clear();
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
  vi.stubGlobal('requestAnimationFrame', () => 1);
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

describe('Corona grammar — in-moment light is physical', () => {
  it('paints the glow field and ground bloom as radial gradients, not ellipse discs', () => {
    render(
      <div data-testid="cache-loot-moment">
        <LootBeam {...beamProps} reduced />
      </div>,
    );
    const rec = ctxOf('fx-loot-beam');
    // Corona (3 layers) + bloom (2 layers) build radial gradients.
    expect(rec.count('createRadialGradient')).toBeGreaterThanOrEqual(5);
    // No banded ellipse discs remain in the smooth frame: the only
    // ellipse calls a smooth frame may contain are none — the discs
    // were the glow/flare construction and both are gradient bodies
    // now (arcs under a scaled transform).
    expect(rec.count('ellipse')).toBe(0);
  });

  it('flies the fine Corona ray field — far more tapered quads than the nine-shaft fan', () => {
    render(
      <div data-testid="cache-loot-moment">
        <LootBeam {...beamProps} reduced />
      </div>,
    );
    const rec = ctxOf('fx-loot-beam');
    // Each Corona ray is two lineTo-built quad segments; 50 rays at
    // the settled (reduced/static) frame — the shipped fan drew 9
    // shafts × 3 segments = 27 quads. The Corona field must exceed
    // that decisively.
    let quadFills = 0;
    let sawLineTo = false;
    for (const c of rec.calls) {
      if (c.name === 'beginPath') sawLineTo = false;
      else if (c.name === 'lineTo') sawLineTo = true;
      else if (c.name === 'fill') {
        if (sawLineTo) quadFills += 1;
        sawLineTo = false;
      }
    }
    expect(quadFills).toBeGreaterThan(54);
  });

  it('draws a slimmer beam than the tier width it is handed', () => {
    render(
      <div data-testid="cache-loot-moment">
        <LootBeam {...beamProps} reduced />
      </div>,
    );
    const rec = ctxOf('fx-loot-beam');
    // The widest beam fill is the outer band + its widest feather
    // pass. The shipped construction painted 68 + feather spill ≈ 92
    // CSS px wide in total; the Corona column's core is 0.7 × 68 and
    // even its faintest spill stays decisively inside the old total.
    // (The bloom footprint is wider by design, but it is gradient
    // arcs, not fillRects — the widest fillRect is the beam's.)
    const widths = rec.calls.filter((c) => c.name === 'fillRect').map((c) => Number(c.args[2]));
    expect(Math.max(...widths)).toBeLessThan(85);
    expect(Math.max(...widths)).toBeGreaterThan(beamProps.widthPx);
  });
});

describe('header law — the beam notch', () => {
  it('runs a destination-out notch pass across the header band when a band is declared', () => {
    render(
      <div data-testid="cache-loot-moment">
        <LootBeam {...beamProps} reduced headerBandPx={{ top: 24, bottom: 72 }} />
      </div>,
    );
    const rec = ctxOf('fx-loot-beam');
    const notch = rec.calls.filter((c) => c.name === 'fillRect' && c.composite === 'destination-out');
    expect(notch.length).toBe(1);
    const [, y, , h] = notch[0].args as number[];
    // The erase spans the band, feathered past both edges.
    expect(y).toBeLessThanOrEqual(24);
    expect(y + h).toBeGreaterThanOrEqual(72);
    // …and it is a gradient erase (feathered), not a hard cut.
    expect(rec.count('createLinearGradient')).toBeGreaterThanOrEqual(1);
  });

  it('runs no notch pass when the host declares no header band', () => {
    render(
      <div data-testid="cache-loot-moment">
        <LootBeam {...beamProps} reduced />
      </div>,
    );
    const rec = ctxOf('fx-loot-beam');
    expect(rec.calls.some((c) => c.composite === 'destination-out')).toBe(false);
  });
});
