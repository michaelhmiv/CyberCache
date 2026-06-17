import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConsumableType } from '@/types/game';
import { useActiveBuffsStore } from './activeBuffsSlice';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';

const buff = (overrides: Partial<ActiveBuff> = {}): ActiveBuff => ({
  id: 'buff-1',
  consumableId: ConsumableType.MedKit,
  family: 'survival',
  source: 'auto-eat',
  sourceId: 'test',
  startedAt: 1_000,
  expiresAt: 11_000,
  durationMs: 10_000,
  displayState: 'active',
  ...overrides,
});

describe('useActiveBuffsStore', () => {
  beforeEach(() => {
    useActiveBuffsStore.getState().clear();
  });

  it('adds, upserts, removes, and clears buffs', () => {
    useActiveBuffsStore.getState().add(buff());
    expect(useActiveBuffsStore.getState().buffs).toHaveLength(1);

    useActiveBuffsStore.getState().upsert(buff({ value: 250 }));
    expect(useActiveBuffsStore.getState().buffs).toHaveLength(1);
    expect(useActiveBuffsStore.getState().buffs[0].value).toBe(250);

    useActiveBuffsStore.getState().remove('buff-1');
    expect(useActiveBuffsStore.getState().buffs).toHaveLength(0);

    useActiveBuffsStore.getState().add(buff());
    useActiveBuffsStore.getState().clear();
    expect(useActiveBuffsStore.getState().buffs).toHaveLength(0);
  });

  it('filters visible, active, armed, and recent rows by expiry', () => {
    useActiveBuffsStore.getState().add(buff({ id: 'active', displayState: 'active', expiresAt: 20_000 }));
    useActiveBuffsStore.getState().add(buff({ id: 'armed', displayState: 'armed', expiresAt: 20_000 }));
    useActiveBuffsStore.getState().add(buff({ id: 'recent', displayState: 'recent', expiresAt: 20_000, durationMs: 0, visualTtlMs: 2500 }));
    useActiveBuffsStore.getState().add(buff({ id: 'expired', displayState: 'active', expiresAt: 9_999 }));

    expect(useActiveBuffsStore.getState().getVisible(10_000).map((b) => b.id)).toEqual(['active', 'armed', 'recent']);
    expect(useActiveBuffsStore.getState().getActive(10_000).map((b) => b.id)).toEqual(['active']);
    expect(useActiveBuffsStore.getState().getArmed(10_000).map((b) => b.id)).toEqual(['armed']);
    expect(useActiveBuffsStore.getState().getRecent(10_000).map((b) => b.id)).toEqual(['recent']);
  });

  it('prunes expired rows without requiring the ledger to be mounted', () => {
    useActiveBuffsStore.getState().add(buff({ id: 'keep', expiresAt: 20_000 }));
    useActiveBuffsStore.getState().add(buff({ id: 'drop', expiresAt: 9_999 }));
    useActiveBuffsStore.getState().pruneExpired(10_000);
    expect(useActiveBuffsStore.getState().buffs.map((b) => b.id)).toEqual(['keep']);
  });

  it('can start a global cleanup interval and stop it', () => {
    vi.useFakeTimers();
    try {
      useActiveBuffsStore.getState().add(buff({ id: 'drop', expiresAt: Date.now() + 500 }));
      const stop = useActiveBuffsStore.getState().startCleanup(1000);
      vi.advanceTimersByTime(1100);
      expect(useActiveBuffsStore.getState().buffs).toHaveLength(0);
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
