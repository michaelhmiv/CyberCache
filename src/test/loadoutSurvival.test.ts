import { describe, it, expect, beforeEach } from 'vitest';
import { loadoutSurvivalStats } from '@/lib/combat/loadoutSurvival';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';

describe('loadoutSurvivalStats', () => {
  beforeEach(() => {
    // Reset survival slice to a clean state.
    useSurvivalStore.setState({
      currentHp: 700,
      maxHp: 700,
      shieldHp: 0,
      isDead: false,
      lastKilledBy: null,
      deathLog: [],
      resurrectionStartedAt: null,
      resurrectionReadyAt: null,
      autoEatThreshold: 0.7,
    });
    // Reset loadout to empty.
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
    // Reset player level.
    usePlayerStore.setState({ level: 1 });
  });

  it('returns maxHp = 700 + level*60 + shieldHp when no shield equipped', () => {
    usePlayerStore.setState({ level: 1 });
    const stats = loadoutSurvivalStats();
    expect(stats.maxHp).toBe(700 + 60); // 760
    expect(stats.shieldHp).toBe(0);
  });

  it('scales maxHp with player level', () => {
    usePlayerStore.setState({ level: 10 });
    const stats = loadoutSurvivalStats();
    expect(stats.maxHp).toBe(700 + 600);
  });

  it('reads shieldHp from the survival slice (current, not capacity)', () => {
    useSurvivalStore.setState({ shieldHp: 50 });
    usePlayerStore.setState({ level: 1 });
    const stats = loadoutSurvivalStats();
    expect(stats.shieldHp).toBe(50);
  });

  it('returns dodgeChance=0 and elementalResist=0 (no affixes yet)', () => {
    const stats = loadoutSurvivalStats();
    expect(stats.dodgeChance).toBe(0);
    expect(stats.elementalResist).toBe(0);
  });

  it('reads equipped shield capacity into maxHp formula', () => {
    // Equip a shield with hp: 200 directly in the loadout store.
    const shieldId = 'test_shield_001';
    useLoadoutStore.setState((state) => ({
      slots: { ...state.slots, shield: shieldId },
    }));
    // Stub the getShield method to return a fake shield.
    const realGetShield = useLoadoutStore.getState().getShield;
    useLoadoutStore.setState({
      getShield: () => ({
        id: shieldId,
        name: 'Test Shield',
        level: 1,
        rarity: 'Common' as never,
        hp: 200,
      } as never),
    });
    usePlayerStore.setState({ level: 5 });
    const stats = loadoutSurvivalStats();
    expect(stats.maxHp).toBe(700 + 300 + 200); // 1200
    // Restore for cleanup.
    useLoadoutStore.setState({ getShield: realGetShield });
  });
});
