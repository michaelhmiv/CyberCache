import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
    expect(ids.filter((id) => id.startsWith('arena-'))).toHaveLength(7);
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
