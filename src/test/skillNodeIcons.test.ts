/**
 * Icon-tree wiring pin (icon-tree build, owner-approved 2026-11-18).
 *
 * The icon board renders one medallion per skill node, resolved by
 * node id through the sprite registry. A node with no registered
 * icon renders a hole in the board, so this suite pins the full
 * wiring: every node in the defs resolves a registered `skill-icon`
 * sprite (file existence/dimensions/anchors are pinned by
 * pixelManifest.test.ts's integrity suite).
 */
import { describe, expect, it } from 'vitest';
import { SKILL_NODES } from '@/constants/skillTrees';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { skillNodeSpriteId } from '@/lib/pixel/skillNodeIcons';

describe('skill node icon wiring', () => {
  it('every skill node resolves a registered skill-icon sprite', () => {
    expect(SKILL_NODES.length).toBe(88);
    const missing: string[] = [];
    for (const node of SKILL_NODES) {
      const sprite = getPixelSprite(skillNodeSpriteId(node.id));
      if (!sprite || sprite.kind !== 'skill-icon') missing.push(node.id);
    }
    expect(missing).toEqual([]);
  });

  it('the sprite id mapping is the kebab-case node id under skill-', () => {
    expect(skillNodeSpriteId('gs_dmg_1')).toBe('skill-gs-dmg-1');
    expect(skillNodeSpriteId('fix_keystone')).toBe('skill-fix-keystone');
    expect(skillNodeSpriteId('demo_cons_1')).toBe('skill-demo-cons-1');
  });
});
