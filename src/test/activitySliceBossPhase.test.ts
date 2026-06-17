import { describe, it, expect, beforeEach } from 'vitest';
import { useActivityStore } from '@/store/slices/activitySlice';
import type { ActiveActivity } from '@/types/activity';

const makeBossActivity = (phase: 'prep' | 'fight' = 'prep'): ActiveActivity => ({
  kind: 'boss_fight',
  bossPhase: phase,
  startedAt: 't',
  completesAt: null,
  targetType: 'boss',
  targetId: 'b1',
  targetLabel: 'Test Boss',
  sceneKey: 'boss_prep',
  notes: null,
  activityPayload: {},
  publicPayload: {},
  lastHeartbeatAt: null,
  publicVisible: true,
  schemaVersion: 1,
  updatedAt: null,
});

describe('activitySlice — setBossPhase', () => {
  beforeEach(() => {
    useActivityStore.setState({ current: makeBossActivity('prep'), hydrated: true, pending: false, error: null });
  });

  it('flips bossPhase from prep to fight on a boss_fight activity', () => {
    useActivityStore.getState().setBossPhase('fight');
    expect(useActivityStore.getState().current.bossPhase).toBe('fight');
    expect(useActivityStore.getState().current.kind).toBe('boss_fight');
  });

  it('flips bossPhase from fight to prep', () => {
    useActivityStore.setState({ current: makeBossActivity('fight') });
    useActivityStore.getState().setBossPhase('prep');
    expect(useActivityStore.getState().current.bossPhase).toBe('prep');
  });

  it('is a no-op on a non-boss activity', () => {
    useActivityStore.setState({
      current: {
        kind: 'crafting',
        bossPhase: 'prep',
        startedAt: null,
        completesAt: null,
        targetType: null,
        targetId: null,
        targetLabel: null,
        sceneKey: null,
        notes: null,
        activityPayload: {},
        publicPayload: {},
        lastHeartbeatAt: null,
        publicVisible: true,
        schemaVersion: 1,
        updatedAt: null,
      },
    });
    useActivityStore.getState().setBossPhase('fight');
    expect(useActivityStore.getState().current.kind).toBe('crafting');
    expect(useActivityStore.getState().current.bossPhase).toBe('prep');
  });

  it('is a no-op when the phase is already the target', () => {
    useActivityStore.setState({ current: makeBossActivity('prep') });
    const before = useActivityStore.getState().current;
    useActivityStore.getState().setBossPhase('prep');
    const after = useActivityStore.getState().current;
    expect(after).toBe(before);
  });
});
