import { describe, it, expect } from 'vitest';
import { MOVEMENT } from '../lib/pixel/movement';
import {
  ROAM_DROP_LIFT_PX,
  STAGE_RISE_FADE_MS,
  STAGE_RISE_TOTAL_MS,
} from '../components/pixelArt/StageRise';

// The Home stage renders at a fixed 286px height
// (LiveTurfDiorama: h-[286px]; RoamPixiStage default 420×286).
const STAGE_HEIGHT_PX = 286;
// HP_PLATE_LIFT in LiveTurfDiorama.tsx: the roaming target's
// name plate top edge rides this fraction of stage height above
// the feet ground line.
const HP_PLATE_LIFT = 0.185;
const MIN_CLEARANCE_PX = 12;
const MIN_VISIBLE_LIFE_MS = 2500;

describe('StageRise schedule', () => {
  it('keeps the chip visible for at least 2.5s', () => {
    // The task's arithmetic: rise + hold + fade is the on-stage life.
    expect(MOVEMENT.LOOT_RISE_MS + MOVEMENT.LOOT_RISE_HOLD_MS + STAGE_RISE_FADE_MS).toBe(
      STAGE_RISE_TOTAL_MS,
    );
    expect(STAGE_RISE_TOTAL_MS).toBeGreaterThanOrEqual(MIN_VISIBLE_LIFE_MS);
    // The fully-opaque window alone (before the fade begins) also
    // clears the floor.
    expect(MOVEMENT.LOOT_RISE_MS + MOVEMENT.LOOT_RISE_HOLD_MS).toBeGreaterThanOrEqual(
      MIN_VISIBLE_LIFE_MS,
    );
  });

  it('holds the chip clear of the enemy name plate at apex', () => {
    // Seated at the feet ground line, the chip bottom at apex sits
    // liftPx above it; the plate's top edge sits HP_PLATE_LIFT * H
    // above the same line. Chip-bottom → plate-top clearance:
    const clearancePx = ROAM_DROP_LIFT_PX - HP_PLATE_LIFT * STAGE_HEIGHT_PX;
    expect(clearancePx).toBeGreaterThanOrEqual(MIN_CLEARANCE_PX);
  });
});
