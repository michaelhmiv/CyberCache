import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useLoadoutPresetsStore } from './loadoutPresetsSlice';
import { useInventoryStore } from './inventorySlice';
import { useLoadoutStore } from './loadoutSlice';
import * as verifiedOps from '@/lib/api/verifiedOps';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: { equipItem: vi.fn(() => Promise.resolve({})) },
}));

describe('loadoutPresets', () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [] });
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
  });

  it('skips incompatible items when loading a preset', async () => {
    useInventoryStore.setState({
      items: [
        { id: 'shield-1', hp: 100, rarity: 'Rare', level: 1 } as unknown as import('@/types/items').Shield,
      ],
    });

    const presetId = useLoadoutPresetsStore.getState().savePreset('Test');
    if (!presetId) throw new Error('preset save failed');

    useLoadoutPresetsStore.setState((s) => ({
      presets: s.presets.map((p) =>
        p.id === presetId ? { ...p, slots: { ...p.slots, primary: 'shield-1' } } : p
      ),
    }));

    await useLoadoutPresetsStore.getState().loadPreset(presetId);
    expect(verifiedOps.verifiedOps.equipItem).not.toHaveBeenCalled();
  });
});
