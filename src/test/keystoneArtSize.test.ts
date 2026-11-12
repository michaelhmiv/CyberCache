/**
 * HTR-08 — keystone art rendered below its native size.
 *
 * The node art is authored as 30×30 texel grids (keystoneArt.ts),
 * but the skill board's only call site rendered SkillKeystoneArt
 * at size 20 — 0.67px per texel — so the inner accent marks and
 * the tree sigil mushed and the four trees differed only by hue.
 *
 * The audit's CI assertion: "rasterize at the shipped size; assert
 * accent pixels survive and the four tree sigils hash distinctly
 * at that size." jsdom has no canvas rasterizer, and this repo's
 * pixel gates work on the grid data itself (see
 * svgPixelConversions.test.ts) — so this test pins the same facts
 * at the data level plus the shipped size at the call site:
 *  - the call site renders at the native 30 (one texel = one px);
 *  - every node type's composed grid carries accent ('A') texels —
 *    the marks that were mushing;
 *  - the four trees' sigils are four distinct glyphs whose rect
 *    data hashes distinctly, in four distinct tree colors.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildKeystoneGrid, KEYSTONE_NODE_GRIDS } from '@/lib/pixel/keystoneArt';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import { PX_ICONS } from '@/lib/pixel/icons';
import { SkillTreeType } from '@/types/game';

const TREES = [SkillTreeType.Gunslinger, SkillTreeType.Demolition, SkillTreeType.Scavenger, SkillTreeType.Fixer];

describe('keystone art ships at native size (audit HTR-08)', () => {
  it('the skill board call site renders SkillKeystoneArt at size 30', () => {
    const src = readFileSync(join(process.cwd(), 'src/screens/SkillTreeScreen.tsx'), 'utf8');
    const blocks = src.match(/<SkillKeystoneArt[\s\S]*?\/>/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block).toContain('size={30}');
      expect(block).not.toMatch(/size=\{(?!30\})[0-9]+\}/);
    }
  });

  it('the authored grids are 30×30 and every node type carries accent texels', () => {
    for (const type of ['small', 'major', 'keystone'] as const) {
      expect(KEYSTONE_NODE_GRIDS[type]).toHaveLength(30);
      for (const row of KEYSTONE_NODE_GRIDS[type]) expect(row).toHaveLength(30);
      const { rows } = buildKeystoneGrid(type, true);
      // Accent-palette keys: 'A' (inner marks — dot/cross) and 'T'
      // (the keystone's radiating ticks); both paint in accentColor.
      const accents = rows.join('').split('').filter((c) => c === 'A' || c === 'T').length;
      expect(accents, `${type} must keep its inner accent marks`).toBeGreaterThan(0);
    }
  });

  it('the four tree sigils are distinct glyphs in distinct colors', () => {
    const sigils = TREES.map((tree) => getSkillTreeVisual(tree).sigil);
    expect(new Set(sigils).size).toBe(4);
    const hashes = sigils.map((sigil) => JSON.stringify(PX_ICONS[sigil]));
    expect(new Set(hashes).size).toBe(4);
    const colors = TREES.map((tree) => getSkillTreeVisual(tree).color);
    expect(new Set(colors).size).toBe(4);
  });
});
