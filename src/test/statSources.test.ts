import { describe, expect, it } from 'vitest';
import { sourcesToSegments } from '@/lib/stats/statSources';

describe('stat source adapters', () => {
  it('derives composition segments from source rows', () => {
    const segments = sourcesToSegments([
      { source: 'Hunter chassis', segmentLabel: 'Chassis', detail: 'Base', value: 760, display: '760', tone: 'muted', bucket: 'base' },
      { source: 'MedKit', detail: 'Buffer', value: 450, display: '450', tone: 'amber', bucket: 'consumable' },
    ], 'green');

    expect(segments).toEqual([
      { label: 'Chassis', value: 760, display: '760', tone: 'muted' },
      { label: 'MedKit', value: 450, display: '450', tone: 'amber' },
    ]);
  });

  it('can hide a detail source from composition', () => {
    const segments = sourcesToSegments([
      { source: 'Max HP', detail: 'aggregate', value: 1210, display: '1,210', hideFromComposition: true },
    ], 'green');
    expect(segments).toEqual([]);
  });
});
