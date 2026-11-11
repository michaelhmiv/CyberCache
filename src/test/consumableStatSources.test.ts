import { describe, expect, it } from 'vitest';
import { buildConsumableStatSources } from '@/lib/stats/consumableStatSources';

describe('buildConsumableStatSources', () => {
  it('derives Med Kit HP buffer from inventory count', () => {
    // T2/P4: the potential is %-of-pool — 12 kits × 20% of a 750 pool.
    const sources = buildConsumableStatSources({ consumableInventory: { MedKit: 12 }, survivalPool: 750 });

    expect(sources.health).toHaveLength(1);
    expect(sources.health[0]).toEqual(expect.objectContaining({
      source: 'Med Kit ×12',
      bucket: 'consumable',
    }));
    expect(sources.health[0].value).toBeCloseTo(1800, 6);
    expect(sources.health[0].display).toBe('1,800');
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
