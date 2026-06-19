import { describe, expect, it, beforeEach } from 'vitest';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';

// Reset loadout state before each test.
describe('setConsumableSlot dedup guard', () => {
  beforeEach(() => {
    useLoadoutStore.setState({
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    useInventoryStore.setState({ items: [] });
  });

  it('assigns a consumable to an empty slot', () => {
    const loadout = useLoadoutStore.getState();
    loadout.setConsumableSlot('PreFight', 'MedKit');
    const result = useLoadoutStore.getState().consumables;
    expect(result.PreFight).toBe('MedKit');
    expect(result.MidFight).toBeNull();
    expect(result.Emergency).toBeNull();
  });

  it('moves a consumable from one slot to another (no duplication)', () => {
    const loadout = useLoadoutStore.getState();
    loadout.setConsumableSlot('PreFight', 'MedKit');
    loadout.setConsumableSlot('MidFight', 'MedKit');
    const result = useLoadoutStore.getState().consumables;
    // Should be in MidFight, NOT in PreFight anymore.
    expect(result.MidFight).toBe('MedKit');
    expect(result.PreFight).toBeNull();
  });

  it('clears the original slot when swapping across all three slots', () => {
    const loadout = useLoadoutStore.getState();
    loadout.setConsumableSlot('PreFight', 'MedKit');
    loadout.setConsumableSlot('MidFight', 'AmmoPack');
    loadout.setConsumableSlot('Emergency', 'MedKit');
    const result = useLoadoutStore.getState().consumables;
    // Med Kit should have moved from PreFight to Emergency.
    expect(result.Emergency).toBe('MedKit');
    expect(result.PreFight).toBeNull();
    // AmmoPack should be untouched.
    expect(result.MidFight).toBe('AmmoPack');
  });

  it('allows three different consumables in three slots', () => {
    const loadout = useLoadoutStore.getState();
    loadout.setConsumableSlot('PreFight', 'MedKit');
    loadout.setConsumableSlot('MidFight', 'AmmoPack');
    loadout.setConsumableSlot('Emergency', 'AdrenalineShot');
    const result = useLoadoutStore.getState().consumables;
    expect(result.PreFight).toBe('MedKit');
    expect(result.MidFight).toBe('AmmoPack');
    expect(result.Emergency).toBe('AdrenalineShot');
  });

  it('clears a slot without affecting others', () => {
    const loadout = useLoadoutStore.getState();
    loadout.setConsumableSlot('PreFight', 'MedKit');
    loadout.setConsumableSlot('MidFight', 'AmmoPack');
    loadout.setConsumableSlot('PreFight', null);
    const result = useLoadoutStore.getState().consumables;
    expect(result.PreFight).toBeNull();
    expect(result.MidFight).toBe('AmmoPack');
  });

  it('replacing a slot with a different consumable does not create duplicates', () => {
    const loadout = useLoadoutStore.getState();
    loadout.setConsumableSlot('PreFight', 'MedKit');
    loadout.setConsumableSlot('MidFight', 'MedKit'); // moves to MidFight
    // Now put MedKit back in PreFight — should clear MidFight.
    loadout.setConsumableSlot('PreFight', 'MedKit');
    const result = useLoadoutStore.getState().consumables;
    expect(result.PreFight).toBe('MedKit');
    expect(result.MidFight).toBeNull();
  });

  it('assigning the same consumable to the same slot it already occupies is a no-op', () => {
    const loadout = useLoadoutStore.getState();
    loadout.setConsumableSlot('PreFight', 'MedKit');
    loadout.setConsumableSlot('PreFight', 'MedKit');
    const result = useLoadoutStore.getState().consumables;
    expect(result.PreFight).toBe('MedKit');
    expect(result.MidFight).toBeNull();
    expect(result.Emergency).toBeNull();
  });

  it('prevents the same consumable from appearing in multiple slots after rapid sequential calls', () => {
    const loadout = useLoadoutStore.getState();
    // Simulate rapid UI clicks assigning MedKit to all three slots.
    loadout.setConsumableSlot('PreFight', 'MedKit');
    loadout.setConsumableSlot('MidFight', 'MedKit');
    loadout.setConsumableSlot('Emergency', 'MedKit');
    const result = useLoadoutStore.getState().consumables;
    // MedKit should only be in the last slot assigned.
    const slotsWithMedKit = Object.values(result).filter((v) => v === 'MedKit');
    expect(slotsWithMedKit.length).toBe(1);
    expect(result.Emergency).toBe('MedKit');
    expect(result.PreFight).toBeNull();
    expect(result.MidFight).toBeNull();
  });
});
