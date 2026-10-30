import { describe, it, expect, beforeEach } from 'vitest';
import { readConsumableSlots } from '@/lib/combat/consumableSlotMap';
import { CONSUMABLES } from '@/constants/consumables';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';

describe('readConsumableSlots', () => {
  beforeEach(() => {
    // Reset to a known state.
    useLoadoutStore.setState({
      slots: {
        primary: null,
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: null,
        classMod: null,
        relic: null,
      },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({ consumables: {} });
  });

  it('returns three slot views, all empty when loadout is unconfigured', () => {
    const views = readConsumableSlots();
    expect(views).toHaveLength(3);
    expect(views.map((v) => v.slot)).toEqual(['PreFight', 'MidFight', 'Emergency']);
    expect(views.every((v) => v.consumableType === null)).toBe(true);
    expect(views.every((v) => v.count === 0)).toBe(true);
  });

  it('returns the consumable type from the loadout and the count from the player store', () => {
    useLoadoutStore.setState({
      consumables: { PreFight: 'MedKit', MidFight: 'ShieldCell', Emergency: null },
    });
    usePlayerStore.setState({ consumables: { MedKit: 5, ShieldCell: 2 } });
    const views = readConsumableSlots();
    expect(views[0].consumableType).toBe('MedKit');
    expect(views[0].count).toBe(5);
    expect(views[0].label).toBe('Med Kit');
    expect(views[1].consumableType).toBe('ShieldCell');
    expect(views[1].count).toBe(2);
    expect(views[2].consumableType).toBe(null);
    expect(views[2].count).toBe(0);
  });

  it('returns 0 count when the slot has a type but the player has none', () => {
    useLoadoutStore.setState({ consumables: { PreFight: 'MedKit', MidFight: null, Emergency: null } });
    usePlayerStore.setState({ consumables: {} });
    const views = readConsumableSlots();
    expect(views[0].consumableType).toBe('MedKit');
    expect(views[0].count).toBe(0);
  });

  it('returns an icon for known consumable types', () => {
    useLoadoutStore.setState({ consumables: { PreFight: 'MedKit', MidFight: 'ShieldCell', Emergency: 'AmmoPack' } });
    const views = readConsumableSlots();
    expect(views[0].icon).toBe(CONSUMABLES.MedKit.visual.glyph);
    expect(views[1].icon).toBe(CONSUMABLES.ShieldCell.visual.glyph);
    expect(views[2].icon).toBe(CONSUMABLES.AmmoPack.visual.glyph);
  });
});
