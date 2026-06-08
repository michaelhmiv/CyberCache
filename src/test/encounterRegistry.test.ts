import { describe, expect, it } from 'vitest';
import { auditEncounterContentRefs, getEncounterContentRefs, requireEncounterById } from '../content/encounterRegistry';

describe('encounter registry bridge', () => {
  it('maps the existing region encounters into content references', () => {
    const refs = getEncounterContentRefs();
    expect(refs).toHaveLength(7);
    expect(refs[0]).toMatchObject({ id: 'dune_tyrant', tier: 1, migrationStatus: 'legacy_bridge' });
    expect(refs.every((ref) => ref.lootTableId.startsWith('encounter_'))).toBe(true);
  });

  it('keeps dedicated drops inside each encounter drop pool before native migration', () => {
    expect(auditEncounterContentRefs()).toEqual([]);
  });

  it('requires encounters by stable id', () => {
    expect(requireEncounterById('dune_tyrant').name).toBe('Dune Tyrant');
  });
});
