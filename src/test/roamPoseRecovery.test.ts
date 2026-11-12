import { describe, expect, it } from 'vitest';
import { deriveRoamScene, roamPosesAt, withRoamWalkFrame } from '@/lib/pixel/roamChoreography';
import { MOVEMENT } from '@/lib/pixel/movement';
import { STANDARD_ISSUE } from '@/lib/pixel/standardIssue';

describe('roam actor recovery', () => {
  it.each(['shot', 'crit'] as const)('%s recovers the hunter and enemy independently on the existing timings', (kind) => {
    expect(roamPosesAt({ kind }, true, 0)).toMatchObject({ hunter: 'recoil', enemy: 'hit' });
    expect(roamPosesAt({ kind }, true, MOVEMENT.SEGMENT.RECOIL_RECOVER_MS)).toMatchObject({ hunter: 'aim', enemy: 'hit' });
    expect(roamPosesAt({ kind }, true, MOVEMENT.HIT_REACTION_MS)).toMatchObject({ hunter: 'aim', enemy: 'idle' });
    // A second event of the same kind must start a new recoil.
    expect(roamPosesAt({ kind }, true, 0).hunter).toBe('recoil');
  });

  it('recovers after the enemy lunge while retaining dead enemies until the next target', () => {
    expect(roamPosesAt({ kind: 'playerHit' }, true, 0)).toMatchObject({ hunter: 'hit', enemy: 'lunge' });
    expect(roamPosesAt({ kind: 'playerHit' }, true, 1200)).toMatchObject({ hunter: 'aim', enemy: 'idle' });
    expect(roamPosesAt({ kind: 'kill' }, false, 1200)).toMatchObject({ hunter: 'relaxed', enemy: 'death' });
  });

  it('reuses hunter geometry while the enemy walks, and agrees with the full derivation', () => {
    const input = {
      backgroundId: 'zone-dustwaste-bg', areaId: 'dustwaste',
      targetMaxHp: 100, currentTargetId: 'dustwaste_raider', hunterSet: STANDARD_ISSUE,
    };
    const held = deriveRoamScene(input);
    for (const walkMs of [0, 160, 420, 800, MOVEMENT.WALK_IN_MS]) {
      const frame = withRoamWalkFrame(held, walkMs);
      expect(frame.hunterLayout).toBe(held.hunterLayout);
      expect(frame).toEqual(deriveRoamScene({ ...input, walkMs }));
    }
  });
});
