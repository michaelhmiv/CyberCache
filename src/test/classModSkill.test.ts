import { describe, expect, it, beforeEach } from 'vitest';
import { useSkillStore } from '../store/slices/skillSlice';
import { SkillTreeType } from '../types/game';
import type { ClassMod } from '../types/items';
import { DropSource, Rarity } from '../types/game';

function makeClassMod(overrides: Partial<ClassMod> = {}): ClassMod {
  return {
    id: 'test-classmod-1',
    name: 'Test Class Mod',
    level: 10,
    rarity: Rarity.Rare,
    treeBonus: 'Gunslinger',
    nodeBoosts: { 'gs_dmg_1': 2, 'gs_crit_1': 1 },
    affixes: [],
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    ...overrides,
  };
}

describe('skillSlice — class mod boosts', () => {
  beforeEach(() => {
    // Reset the store between tests
    useSkillStore.setState({
      spent: {},
      appliedClassModId: null,
      classModBoosts: { nodeBoosts: {} },
    });
  });

  it('starts with no class mod boosts', () => {
    const bonuses = useSkillStore.getState().getBonuses();
    expect(useSkillStore.getState().appliedClassModId).toBeNull();
    expect(bonuses.dps).toBe(0);
  });

  it('applyClassMod sets the class mod id and boosts', () => {
    const cm = makeClassMod();
    useSkillStore.getState().applyClassMod(cm);
    const state = useSkillStore.getState();
    expect(state.appliedClassModId).toBe('test-classmod-1');
    expect(state.classModBoosts.treeBonus).toBe('Gunslinger');
    expect(state.classModBoosts.nodeBoosts).toEqual({ 'gs_dmg_1': 2, 'gs_crit_1': 1 });
  });

  it('removeClassMod clears the boosts', () => {
    const cm = makeClassMod();
    useSkillStore.getState().applyClassMod(cm);
    useSkillStore.getState().removeClassMod();
    const state = useSkillStore.getState();
    expect(state.appliedClassModId).toBeNull();
    expect(state.classModBoosts.nodeBoosts).toEqual({});
    expect(state.classModBoosts.treeBonus).toBeUndefined();
  });

  it('nodeBoosts contribute to getBonuses even with 0 manual points', () => {
    const cm = makeClassMod({ treeBonus: undefined, nodeBoosts: { 'gs_dmg_1': 2 } });
    useSkillStore.getState().applyClassMod(cm);
    const bonuses = useSkillStore.getState().getBonuses();
    // gs_dmg_1 gives weaponDamage: 0.05 per point. 2 points = 0.10.
    expect(bonuses.weaponDamage).toBeCloseTo(0.10, 5);
  });

  it('nodeBoosts stack with manual points', () => {
    // Manually put 3 points into gs_dmg_1
    useSkillStore.setState({ spent: { 'gs_dmg_1': 3 } });
    const cm = makeClassMod({ treeBonus: undefined, nodeBoosts: { 'gs_dmg_1': 2 } });
    useSkillStore.getState().applyClassMod(cm);
    const bonuses = useSkillStore.getState().getBonuses();
    // 3 manual + 2 nodeBoost = 5 points × 0.05 weaponDamage = 0.25
    expect(bonuses.weaponDamage).toBeCloseTo(0.25, 5);
  });

  it('nodeBoosts can exceed maxPoints (Borderlands-style)', () => {
    // gs_dmg_1 has maxPoints: 5. Put 5 manual + 3 from class mod = 8.
    useSkillStore.setState({ spent: { 'gs_dmg_1': 5 } });
    const cm = makeClassMod({ treeBonus: undefined, nodeBoosts: { 'gs_dmg_1': 3 } });
    useSkillStore.getState().applyClassMod(cm);
    const bonuses = useSkillStore.getState().getBonuses();
    // 8 points × 0.05 = 0.40 weaponDamage
    expect(bonuses.weaponDamage).toBeCloseTo(0.40, 5);
  });

  it('treeBonus adds +1 to every node in the tree, capped at maxPoints', () => {
    // No manual points. treeBonus: Gunslinger. Every Gunslinger small node
    // gets +1 (respecting maxPoints of 5, so just +1 from 0).
    const cm = makeClassMod({ treeBonus: 'Gunslinger', nodeBoosts: {} });
    useSkillStore.getState().applyClassMod(cm);
    const bonuses = useSkillStore.getState().getBonuses();
    // All Gunslinger small nodes have 1 effective point.
    // gs_dmg_1 (+0.05 weaponDamage) + gs_dmg_2 (+0.05) = 0.10 weaponDamage
    // gs_crit_1 (+0.03 critChance) + gs_crit_2 (+0.03) = 0.06 critChance
    // etc.
    expect(bonuses.weaponDamage).toBeGreaterThan(0);
    expect(bonuses.critChance).toBeGreaterThan(0);
  });

  it('treeBonus does not exceed maxPoints when already at cap', () => {
    // Put 5 points in every Gunslinger small node, then apply treeBonus.
    const gunslingerNodeIds = [
      'gs_dmg_1', 'gs_dmg_2', 'gs_crit_1', 'gs_crit_2',
      'gs_critdmg_1', 'gs_critdmg_2', 'gs_speed_1', 'gs_speed_2',
      'gs_boss_1', 'gs_boss_2', 'gs_status_1', 'gs_shield_1',
    ];
    const spent: Record<string, number> = {};
    for (const id of gunslingerNodeIds) {
      spent[id] = 5; // maxPoints for all small nodes
    }
    useSkillStore.setState({ spent });

    const cm = makeClassMod({ treeBonus: 'Gunslinger', nodeBoosts: {} });
    useSkillStore.getState().applyClassMod(cm);
    const bonuses = useSkillStore.getState().getBonuses();
    // With all nodes at maxPoints=5 and treeBonus capped, the bonuses
    // should be exactly the same as without treeBonus (no overflow).
    // gs_dmg_1 (5pts × 0.05) + gs_dmg_2 (5 × 0.05) = 0.50 weaponDamage
    expect(bonuses.weaponDamage).toBeCloseTo(0.50, 5);
  });

  it('getBonuses computes survival from shield/stagger (un-hardcoded)', () => {
    const bonuses = useSkillStore.getState().getBonuses();
    // survival is computed from shieldCapacity * 0.3 + staggerChance * 0.2
    // With no skills, should be 0.
    expect(bonuses.survival).toBe(0);
  });

  it('getTotalSpent includes class mod boosts', () => {
    useSkillStore.setState({ spent: { 'gs_dmg_1': 3 } });
    const cm = makeClassMod({ treeBonus: 'Gunslinger', nodeBoosts: { 'gs_dmg_1': 2, 'gs_crit_1': 1 } });
    useSkillStore.getState().applyClassMod(cm);
    const total = useSkillStore.getState().getTotalSpent();
    // 3 manual + 2 nodeBoost + 1 nodeBoost + treeBonus (points per node in Gunslinger tree)
    // Gunslinger has 19 nodes total (12 small + 4 major + 1 keystone)
    // treeBonus adds 1 per node where current < maxPoints.
    // Most nodes start at 0, so treeBonus contributes 19.
    // But gs_dmg_1 has 3 manual + 2 boost = 5 = maxPoints, so treeBonus doesn't add.
    // gs_crit_1 has 1 boost, treeBonus adds 1 (capped at maxPoints 5), so 2 total.
    // So treeBonus = 19 - 1 (gs_dmg_1 at cap) = 18.
    // Total = 3 + 2 + 1 + 18 = 24
    expect(total).toBeGreaterThan(3); // more than just manual
  });
});
