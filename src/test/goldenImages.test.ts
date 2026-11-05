import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GRAMMAR } from '@/lib/pixel/grammar';
import { decodePng, diffFraction } from '@/lib/pixel/pngCodec';
import { GOLDEN_SCENES } from './golden/goldenScenes';

/**
 * Golden-image regression (overhaul addendum): every key scene renders
 * through the reference renderer from fixed seeded inputs and diffs
 * against its committed baseline. A diff FAILS the suite — art,
 * palette, rig, or compositor changes must regenerate baselines via
 * `npm run golden:update` and the regeneration is reviewed by Muse
 * (Michael gates art direction at the G-gates, never single diffs).
 */
const BASELINES = join(process.cwd(), 'src/test/golden/baselines');
const TOLERANCE = 0.02; // ≤2% of pixels may differ beyond channel tolerance

describe('golden-image regression', () => {
  it('covers the brief scene list', () => {
    const ids = GOLDEN_SCENES.map((s) => s.id);
    for (const area of ['dustwaste', 'redline', 'ironwood', 'blastforge', 'prismatek', 'throwtech', 'helixworks']) {
      expect(ids).toContain(`roam-${area}`);
      expect(ids.some((id) => id.startsWith('arena-'))).toBe(true);
    }
    expect(ids).toContain('roam-hot');
    expect(ids).toContain('elite-dustwaste');
    expect(ids).toContain('bench');
    expect(ids).toContain('bay');
    expect(ids).toContain('vehicle-roam');
    expect(ids.filter((id) => id.startsWith('loot-'))).toHaveLength(5);
    expect(ids.filter((id) => id.startsWith('fx-'))).toHaveLength(6);
    expect(ids.filter((id) => id.startsWith('arena-'))).toHaveLength(14);
    // Unarmed hunter (real-item invariant): roaming + arena scenes.
    expect(ids).toContain('roam-unarmed');
    expect(ids).toContain('arena-unarmed');
    // Endless (0028): the depth-treatment band variants.
    expect(ids.filter((id) => id.startsWith('endless-depth-'))).toHaveLength(3);
    expect(ids).toContain('endless-depth-1');
    expect(ids).toContain('endless-depth-12');
    expect(ids).toContain('endless-depth-25');
    // Cache Rank (0031): the rank-board scene.
    expect(ids).toContain('cache-rank-panel');
    // Research (0038): the study + completion scenes.
    expect(ids).toContain('research-study');
    expect(ids).toContain('research-complete');
  });

  // F8 regression guard: the cache-rank scene hangs its token emblem
  // under a beam read from GRAMMAR.beamWidthPx.low. That tier was
  // missing, the width resolved to undefined, drawBeam painted NaN
  // widths (nothing), and the golden happily pinned the beam-less
  // board. These assertions fail loudly if the tier ever goes missing
  // again or the shaft stops painting.
  it('cache-rank-panel: the emblem beam tier resolves and the shaft paints', () => {
    const width = GRAMMAR.beamWidthPx.low;
    expect(Number.isFinite(width), 'GRAMMAR.beamWidthPx.low must be a finite number').toBe(true);
    expect(width).toBeGreaterThan(0);
    const scene = GOLDEN_SCENES.find((s) => s.id === 'cache-rank-panel');
    expect(scene).toBeDefined();
    const img = scene!.render();
    const brightness = (x: number, y: number) => {
      const i = (y * img.width + x) * 4;
      return img.data[i] + img.data[i + 1] + img.data[i + 2];
    };
    // Shaft center (300, 20) — inside the beam's white core — must be
    // clearly brighter than an off-shaft pixel at the same height.
    // In the beam-less render the two were identical.
    expect(brightness(300, 20)).toBeGreaterThan(brightness(200, 20) + 40);
  });

  for (const goldenScene of GOLDEN_SCENES) {
    it(`matches baseline: ${goldenScene.id}`, () => {
      const baselinePath = join(BASELINES, `${goldenScene.id}.png`);
      expect(existsSync(baselinePath), `missing baseline for ${goldenScene.id} — run npm run golden:update`).toBe(true);
      const baseline = decodePng(new Uint8Array(readFileSync(baselinePath)));
      const rendered = goldenScene.render();
      expect(rendered.width).toBe(baseline.width);
      expect(rendered.height).toBe(baseline.height);
      const fraction = diffFraction(rendered, baseline);
      expect(fraction, `${goldenScene.id} differs from baseline in ${(fraction * 100).toFixed(2)}% of pixels`).toBeLessThanOrEqual(TOLERANCE);
    });
  }
});
