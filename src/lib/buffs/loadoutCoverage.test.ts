import { describe, expect, it } from 'vitest';
import { ConsumableType } from '@/types/game';
import { buildLoadoutArmedBuffs, getLoadoutConsumableCoverage } from './loadoutCoverage';

describe('loadout consumable coverage', () => {
  it('describes the player decision each loaded slot supports', () => {
    const rows = getLoadoutConsumableCoverage({
      PreFight: ConsumableType.AmmoPack,
      MidFight: ConsumableType.MagnetizedPayload,
      Emergency: null,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ slot: 'PreFight', consumableId: ConsumableType.AmmoPack, mechanicKind: 'ammo-coverage' });
    expect(rows[0].decisionHint).toContain('PreFight armed');
    expect(rows[1]).toMatchObject({ slot: 'MidFight', consumableId: ConsumableType.MagnetizedPayload, mechanicKind: 'phase-break' });
  });

  it('builds non-expiring armed display rows for loaded consumables', () => {
    const buffs = buildLoadoutArmedBuffs({
      PreFight: ConsumableType.MedKit,
      MidFight: null,
      Emergency: ConsumableType.ShieldCell,
    }, 1234);

    expect(buffs.map((buff) => buff.displayState)).toEqual(['armed', 'armed']);
    expect(buffs.every((buff) => buff.source === 'loadout-armed')).toBe(true);
    expect(buffs.every((buff) => buff.expiresAt === Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
