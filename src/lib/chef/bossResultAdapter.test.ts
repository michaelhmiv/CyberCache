import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsumableType } from '@/types/game';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import { applyBossConsumableDisplayEvents } from './bossResultAdapter';

describe('applyBossConsumableDisplayEvents', () => {
  beforeEach(() => {
    useActiveBuffsStore.getState().clear();
    useTickFeedStore.getState().clear();
  });

  it('expands consumedConsumables into active/recent display rows and consumable tick events', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      applyBossConsumableDisplayEvents({
        attemptId: 'attempt-1',
        consumedConsumables: {
          [ConsumableType.AmmoPack]: 1,
          [ConsumableType.MagnetizedPayload]: 1,
        },
      });

      const buffs = useActiveBuffsStore.getState().buffs;
      expect(buffs).toHaveLength(2);
      expect(buffs.find((b) => b.consumableId === ConsumableType.AmmoPack)).toMatchObject({
        displayState: 'active',
        durationMs: 600_000,
        expiresAt: 601_000,
      });
      expect(buffs.find((b) => b.consumableId === ConsumableType.MagnetizedPayload)).toMatchObject({
        displayState: 'recent',
        durationMs: 0,
        visualTtlMs: 2500,
        expiresAt: 3_500,
      });
      expect(useTickFeedStore.getState().events).toHaveLength(2);
      expect(useTickFeedStore.getState().events.every((event) => event.tone === 'consumable')).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('creates one display row per consumed count', () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    try {
      applyBossConsumableDisplayEvents({
        attemptId: 'attempt-2',
        consumedConsumables: { [ConsumableType.MedKit]: 2 },
      });
      expect(useActiveBuffsStore.getState().buffs).toHaveLength(2);
      expect(new Set(useActiveBuffsStore.getState().buffs.map((b) => b.id)).size).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
