import { describe, expect, it } from 'vitest';
import { buildConsumableStatSources } from '@/lib/stats/consumableStatSources';

describe('buildConsumableStatSources', () => {
  it('derives Med Kit HP buffer from inventory count', () => {
    const sources = buildConsumableStatSources({ consumableInventory: { MedKit: 12 } });

    expect(sources.health).toEqual([
      expect.objectContaining({
        source: 'Med Kit ×12',
        value: 1800,
        display: '1,800',
        bucket: 'consumable',
      }),
    ]);
  });

  it('uses server buffer instead of full inventory potential when present', () => {
    const sources = buildConsumableStatSources({
      consumableInventory: { MedKit: 12 },
      medKitBuffer: 1650,
    });

    expect(sources.health).toHaveLength(1);
    expect(sources.health[0]).toEqual(expect.objectContaining({
      source: 'Med Kit ×12',
      value: 1650,
      display: '1,650',
    }));
  });

  it('does not emit zero-count consumable sources', () => {
    const sources = buildConsumableStatSources({ consumableInventory: { MedKit: 0 } });
    expect(sources.health).toEqual([]);
  });
});
