/**
 * SVG closure (owner ruling, 2026-11-07) — the converted surfaces
 * lint at ZERO findings under the repo's pxl port.
 *
 * The vector components closed by the ruling (SkillKeystoneArt,
 * Sparkline, ConsumableRing, the LiveTurfDiorama fallback diorama,
 * BenchFx's stroke sparks, ActionLoadout's star connectors, the
 * diorama's drop icons) were redrawn as authored texel grids under
 * the pxl-craft standard. This test runs the same lint the S2 gate
 * enforces (orphan / jaggy / pillow / colors / near-duplicate +
 * homegrown banding, src/test/pixelLint.ts) over the exact grid
 * data the components ship — the builders and rasterizers are
 * imported from the components themselves, never copied here.
 *
 * Sparkline is data-driven geometry, not authored art, so it is
 * not linted; its geometry lib is covered by progressionSparkline.
 */
import { describe, expect, it } from 'vitest';
import { lintBanding, lintRender, type LintFinding, type LintRender } from './pixelLint';
import { buildKeystoneGrid } from '@/lib/pixel/keystoneArt';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import { SkillTreeType } from '@/types/game';
import { buildConsumableRingGrid } from '@/lib/pixel/consumableRing';
import { buildStarConnectorGrid } from '@/lib/pixel/starConnectors';
import { DROP_RISE_GRIDS, dropRisePalette } from '@/lib/pixel/dropRiseIcons';

function findings(render: LintRender, name: string): LintFinding[] {
  return [...lintRender(render, name), ...lintBanding(render, name)];
}

function expectClean(render: LintRender, name: string) {
  const found = findings(render, name);
  expect(found, found.map((f) => f.message).join('\n')).toEqual([]);
}

const NODE_TYPES = ['small', 'major', 'keystone'] as const;

describe('SVG pixel conversions — lint', () => {
  it('keystone nodes lint clean for every tree, type, and state', () => {
    for (const tree of Object.values(SkillTreeType)) {
      const visual = getSkillTreeVisual(tree);
      for (const nodeType of NODE_TYPES) {
        for (const unlocked of [true, false]) {
          const { rows, glowRows } = buildKeystoneGrid(nodeType, unlocked);
          // The canvas paints glow under shape; lint the composite.
          const merged = rows.map((row, y) =>
            row
              .split('')
              .map((cell, x) => (cell !== '.' ? cell : glowRows[y][x]))
              .join(''),
          );
          const colors = unlocked
            ? {
                F: visual.color, E: visual.color, S: visual.color,
                A: visual.accentColor, T: visual.accentColor,
                G: visual.accentColor, g: visual.accentColor, h: visual.accentColor,
              }
            : { F: '#3a3a4e', E: '#666666', S: '#555555', A: '#888888', T: '#888888' };
          expectClean(
            { width: 30, height: 30, rows: merged, colors },
            `keystone ${tree} ${nodeType} ${unlocked ? 'unlocked' : 'locked'}`,
          );
        }
      }
    }
  });

  it('consumable ring lint clean for every load state', () => {
    const colors = {
      '0': '#7CFC00', '1': '#FF4B5C', '2': '#00E5FF',
      K: '#000000', D: '#050608', P: '#FFB300', N: '#FF9000', R: '#2A2F3A',
    };
    for (const count of [0, 1, 2, 3]) {
      for (const active of [false, true]) {
        if (count === 0 && active) continue;
        expectClean(
          { width: 28, height: 28, rows: buildConsumableRingGrid(count, active), colors },
          `consumable ring ×${count} ${active ? 'active' : 'idle'}`,
        );
      }
    }
  });

  // The bench spark burst's lint case was dropped in the #448/#447
  // merge: the bench slice's canvas FX vehicle (PR #447) superseded
  // this slice's buildSparkBurstGrid rasterizer, so the grid no
  // longer exists to lint.

  it('star connectors lint clean', () => {
    expectClean(
      { width: 100, height: 100, rows: buildStarConnectorGrid(), colors: { S: '#FF9000' } },
      'star connectors',
    );
  });

  it('drop rise icons lint clean in their shipped ramps', () => {
    const bases: Record<keyof typeof DROP_RISE_GRIDS, string> = {
      material: '#A855F7', // TechFragments violet (visualAssets)
      essence: '#8B5CF6', // VoidEssence violet (visualAssets)
      fragment: '#2196F3',
      scrap: '#FF5722',
      credits: '#FFD700',
      crate: '#A5A7B5', // dropAssetColor fallback grey
    };
    for (const kind of Object.keys(DROP_RISE_GRIDS) as Array<keyof typeof DROP_RISE_GRIDS>) {
      const palette = dropRisePalette(bases[kind]);
      const colors = Object.fromEntries(
        Object.entries(palette).map(([key, entry]) => [key, entry.color]),
      );
      expectClean(
        { width: 15, height: 15, rows: DROP_RISE_GRIDS[kind], colors },
        `drop rise ${kind}`,
      );
    }
  });
});
