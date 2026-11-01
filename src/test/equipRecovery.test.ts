/**
 * Equip failure recovery (device defect follow-through, 2026-11-01):
 * when the server refuses an equip as not-found, the item on screen
 * is a stale display copy. verifiedOps.equipItem re-syncs the
 * inventory from server truth and surfaces a truthful, actionable
 * message instead of the bare 'Item not found' — every equip door
 * (slot picker, inspect sheet, cache card, loot feed) passes through
 * this one op, so the behavior is pinned here once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  syncRuntimeItemsForUser: vi.fn(async () => {}),
}));

vi.mock('@/lib/api/http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/http')>();
  return { ...actual, apiRequest: hoisted.apiRequest };
});

vi.mock('@/lib/api/runtimeStateService', () => ({
  syncRuntimeItemsForUser: hoisted.syncRuntimeItemsForUser,
}));

import { ApiError } from '@/lib/api/http';
import { verifiedOps } from '@/lib/api/verifiedOps';

describe('verifiedOps.equipItem not-found recovery', () => {
  beforeEach(() => {
    hoisted.apiRequest.mockReset();
    hoisted.syncRuntimeItemsForUser.mockClear();
  });

  it('re-syncs the inventory and reports what actually happened', async () => {
    hoisted.apiRequest.mockRejectedValue(new ApiError(404, 'not_found', 'Item not found'));
    await expect(verifiedOps.equipItem('some-item-id', 'primary')).rejects.toThrow(
      'That item is no longer in your inventory — your gear list has been refreshed.',
    );
    expect(hoisted.syncRuntimeItemsForUser).toHaveBeenCalledTimes(1);
  });

  it('other failures propagate untouched, with no re-sync', async () => {
    hoisted.apiRequest.mockRejectedValue(new ApiError(500, 'http_error', 'Request failed (500).'));
    await expect(verifiedOps.equipItem('some-item-id', 'primary')).rejects.toThrow('Request failed (500).');
    expect(hoisted.syncRuntimeItemsForUser).not.toHaveBeenCalled();
  });

  it('a successful equip returns the result and does not re-sync', async () => {
    hoisted.apiRequest.mockResolvedValue({ action_type: 'cc_equip_item', item: { id: 'some-item-id' } });
    const result = await verifiedOps.equipItem('some-item-id', 'primary');
    expect(result.action_type).toBe('cc_equip_item');
    expect(hoisted.syncRuntimeItemsForUser).not.toHaveBeenCalled();
  });
});
