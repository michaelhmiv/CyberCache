import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsumableType } from '@/types/game';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { useTickFeedStore } from '@/store/slices/tickSlice';
import { applyActivityConsumableDisplayEvents, filterConsumablesForActivity } from './activityConsumableAdapter';

describe('activityConsumableAdapter', () => {
  beforeEach(() => {
    useActiveBuffsStore.getState().clear();
    useTickFeedStore.getState().clear();
  });

  it('filters consumed consumables by activity scope', () => {
    expect(filterConsumablesForActivity({
      [ConsumableType.WorkshopRushTicket]: 1,
      [ConsumableType.MagnetizedPayload]: 1,
    }, 'crafting')).toEqual({ [ConsumableType.WorkshopRushTicket]: 1 });
  });

  it('adds activity-result rows and consumable feed events', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000);
    try {
      const rows = applyActivityConsumableDisplayEvents({
        activityId: 'craft-1',
        activityScope: 'crafting',
        consumedConsumables: { [ConsumableType.WorkshopRushTicket]: 1 },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        consumableId: ConsumableType.WorkshopRushTicket,
        source: 'activity-result',
        displayState: 'recent',
      });
      expect(useActiveBuffsStore.getState().buffs).toHaveLength(1);
      expect(useTickFeedStore.getState().events[0].tone).toBe('consumable');
    } finally {
      vi.restoreAllMocks();
    }
  });
});
