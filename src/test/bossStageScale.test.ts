/**
 * Stage-iteration program (B1): the per-boss stage placement table
 * keeps every boss painting inside the stage's spacing law at canvas
 * level — width ≤45% of stage width, right edge on stage, and a
 * left edge far enough from the hunter anchor (20%) that the rest
 * gap can satisfy the ≥12% silhouette rule. Silhouette-level truth
 * comes from capture rounds; this test locks the canvas math so a
 * table edit (or a new boss) can't silently re-wall the stage.
 *
 * Aspect basis (amended 2026-11-13, capture arbitration): the boss
 * stage's height is a FIXED 228px (BossFightStage root) and its
 * width is the device width, so the stage aspect is width/228 —
 * STAGE_DESIGN_ASPECT (420/286 ≈ a 335px-wide stage) describes no
 * target device and made the spacing law unsatisfiable for the
 * widest anchored painting (siltstalker: at 420/286 its canvas
 * right edge exceeds 97.5% at ANY anchor that also satisfies the
 * ≥12% rest gap). Bounds are therefore asserted at the reference
 * geometry the program captures at (390×228, full bounds) and at
 * the narrowest supported viewport (360×228, width + right-edge
 * bounds — the fixed-height stage crowds everything on narrow
 * phones by design; the table must not add overflow to it).
 */
import { describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { getPixelSprite, pixelBossSpriteForBoss } from '@/lib/pixel/manifest';
import { BOSS_STAGE_PLACEMENTS, bossStagePlacement } from '@/lib/pixel/bossStageScale';

const HUNTER_HEIGHT_PCT = 62;
const REFERENCE_ASPECT = 390 / 228;
const NARROW_ASPECT = 360 / 228;

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
      const feetX = sprite.anchors.feet?.x ?? 0.5;
      const widthAt = (aspect: number) => (heightPct * (sprite.width / sprite.height)) / aspect;
      const widthPct = widthAt(REFERENCE_ASPECT);
      const leftEdge = xPct - feetX * widthPct;
      const rightEdge = xPct + (1 - feetX) * widthPct;
      expect(widthPct, `${boss.id} canvas width ${widthPct.toFixed(1)}% > 45%`).toBeLessThanOrEqual(45.5);
      expect(leftEdge, `${boss.id} canvas left edge ${leftEdge.toFixed(1)}% crowds the hunter`).toBeGreaterThanOrEqual(46);
      expect(rightEdge, `${boss.id} canvas right edge ${rightEdge.toFixed(1)}% overflows the stage`).toBeLessThanOrEqual(97.5);
      expect(heightPct, `${boss.id} height exceeds 1.35x the hunter`).toBeLessThanOrEqual(HUNTER_HEIGHT_PCT * 1.35 + 0.5);
      // Narrowest supported viewport (360px): the canvas must not
      // widen past the ceiling or overflow the right edge there.
      const narrowWidth = widthAt(NARROW_ASPECT);
      const narrowRight = xPct + (1 - feetX) * narrowWidth;
      expect(narrowWidth, `${boss.id} canvas width at 360px ${narrowWidth.toFixed(1)}% > 45%`).toBeLessThanOrEqual(45.5);
      expect(narrowRight, `${boss.id} canvas right edge at 360px ${narrowRight.toFixed(1)}% overflows the stage`).toBeLessThanOrEqual(97.5);
    }
  });
});
