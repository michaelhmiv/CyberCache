/**
 * Stage-iteration program (B1): the per-boss stage placement table
 * keeps every boss painting inside the stage's spacing law at canvas
 * level — width ≤45% of stage width, right edge on stage, and a
 * left edge far enough from the hunter anchor (20%) that the rest
 * gap can satisfy the ≥12% silhouette rule. Silhouette-level truth
 * comes from capture rounds; this test locks the canvas math so a
 * table edit (or a new boss) can't silently re-wall the stage.
 */
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { getPixelSprite, pixelBossSpriteForBoss } from '@/lib/pixel/manifest';
import { STAGE_DESIGN_ASPECT } from '@/lib/pixel/movement';
import { BOSS_STAGE_PLACEMENTS, bossStagePlacement } from '@/lib/pixel/bossStageScale';

const HUNTER_HEIGHT_PCT = 62;

describe('boss stage placement table', () => {
  it('has an explicit entry for every authored boss', () => {
    for (const boss of REGION_1_BOSSES) {
      expect(BOSS_STAGE_PLACEMENTS[boss.id], `missing placement for ${boss.id}`).toBeDefined();
    }
  });

  it('falls back to the legacy placement for unknown bosses', () => {
    expect(bossStagePlacement(undefined)).toEqual({ xPct: 76, heightPct: 80 });
    expect(bossStagePlacement('not-a-boss')).toEqual({ xPct: 76, heightPct: 80 });
  });

  it('keeps every boss canvas inside the spacing bounds', () => {
    for (const boss of REGION_1_BOSSES) {
      const sprite = getPixelSprite(pixelBossSpriteForBoss(boss.id) ?? '');
      expect(sprite, `no sprite for ${boss.id}`).toBeDefined();
      if (!sprite) continue;
      const { xPct, heightPct } = bossStagePlacement(boss.id);
      const widthPct = (heightPct * (sprite.width / sprite.height)) / STAGE_DESIGN_ASPECT;
      const feetX = sprite.anchors.feet?.x ?? 0.5;
      const leftEdge = xPct - feetX * widthPct;
      const rightEdge = xPct + (1 - feetX) * widthPct;
      expect(widthPct, `${boss.id} canvas width ${widthPct.toFixed(1)}% > 45%`).toBeLessThanOrEqual(45.5);
      expect(leftEdge, `${boss.id} canvas left edge ${leftEdge.toFixed(1)}% crowds the hunter`).toBeGreaterThanOrEqual(46);
      expect(rightEdge, `${boss.id} canvas right edge ${rightEdge.toFixed(1)}% overflows the stage`).toBeLessThanOrEqual(97.5);
      expect(heightPct, `${boss.id} height exceeds 1.35x the hunter`).toBeLessThanOrEqual(HUNTER_HEIGHT_PCT * 1.35 + 0.5);
    }
  });
});
