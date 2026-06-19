import { describe, expect, it } from 'vitest';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import type { PlayerProfile } from '@/types/player';

const player: PlayerProfile = {
  id: 'test-player',
  name: 'Test Hunter',
  level: 1,
  xp: 0,
  credits: 0,
  scrap: 0,
  cacheKeys: 0,
  cacheKeyFragments: 0,
  currentZoneId: 'zone-1',
  highestZoneId: 'zone-1',
  offlineCapHours: 8,
  lastClaimTime: 0,
  deathFeeInsurance: false,
  consumables: {},
  consumableBatches: [],
  materials: {},
  essences: {},
  workshopQueues: [],
  lastWorkshopTick: 0,
  lastClaimedTick: 0,
};

describe('character stat source consistency', () => {
  it('exposes survival-store Med Kit buffer as a Max HP source', () => {
    const summary = buildCharacterStatSummary({
      player,
      weapons: [],
      spentSkills: {},
      medKitBuffer: 450,
    });

    const health = summary.all.find((metric) => metric.key === 'health');
    expect(health).toBeDefined();
    expect(health!.display).toBe('1,210');

    expect(health!.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Med Kit',
          value: 450,
          display: '450',
          bucket: 'consumable',
        }),
      ]),
    );

    expect(health!.stacked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Med Kit',
          value: 450,
          display: '450',
        }),
      ]),
    );
  });

  it('exposes inventory-backed Med Kits as Max HP sources before server buffer hydrates', () => {
    const summary = buildCharacterStatSummary({
      player,
      weapons: [],
      spentSkills: {},
      consumableInventory: { MedKit: 12 },
    });

    const health = summary.all.find((metric) => metric.key === 'health');
    expect(health).toBeDefined();

    expect(health!.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'Med Kit ×12',
          value: 1800,
          display: '1,800',
          bucket: 'consumable',
        }),
      ]),
    );

    expect(health!.stacked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Med Kit ×12',
          value: 1800,
          display: '1,800',
        }),
      ]),
    );
  });

  it('prefers server-authoritative Med Kit buffer over full inventory potential', () => {
    const summary = buildCharacterStatSummary({
      player,
      weapons: [],
      spentSkills: {},
      consumableInventory: { MedKit: 12 },
      medKitBuffer: 1650,
    });

    const health = summary.all.find((metric) => metric.key === 'health');
    expect(health).toBeDefined();

    const medKitRows = health!.contributions.filter((source) => source.source.startsWith('Med Kit'));
    expect(medKitRows).toHaveLength(1);
    expect(medKitRows[0]).toEqual(expect.objectContaining({
      source: 'Med Kit ×12',
      value: 1650,
      display: '1,650',
      bucket: 'consumable',
    }));
  });

  it('does not create health stacked segments without matching source contributions', () => {
    const summary = buildCharacterStatSummary({
      player,
      weapons: [],
      spentSkills: {},
      medKitBuffer: 450,
    });

    const health = summary.all.find((metric) => metric.key === 'health');
    expect(health).toBeDefined();

    for (const segment of health!.stacked ?? []) {
      const matchingSource = health!.contributions.find(
        (source) => source.source === segment.label ||
          source.segmentLabel === segment.label ||
          (segment.label === 'Chassis' && source.source === 'Hunter chassis'),
      );
      expect(matchingSource, `Missing source for stacked segment ${segment.label}`).toBeDefined();
      expect(matchingSource!.value).toBe(segment.value);
    }
  });
});
