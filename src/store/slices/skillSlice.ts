import { create } from 'zustand';
import { SKILL_NODES } from '../../constants/skillTrees';
import { computeSkillBonuses, skillSpendCost } from '@/lib/skills/skillBonuses';
import type { ClassMod } from '../../types/items';
import { SkillTreeType } from '../../types/game';

export interface SkillState {
  spent: Record<string, number>;
  /** ID of the currently equipped class mod, or null. */
  appliedClassModId: string | null;
  /** Boosts from the equipped class mod (treeBonus + nodeBoosts). */
  classModBoosts: { treeBonus?: string; nodeBoosts: Record<string, number> };
  spendPoint: (nodeId: string) => void;
  respecCost: () => number;
  respec: (creditsAvailable: number) => boolean;
  getBonuses: () => Record<string, number>;
  getTotalSpent: () => number;
  /** Budget points consumed by real spends (weighted: major 3, keystone 5). */
  getSpentBudget: () => number;
  /** Apply a class mod's boosts. Called by loadoutSlice on equip. */
  applyClassMod: (classMod: ClassMod) => void;
  /** Remove all class mod boosts. Called by loadoutSlice on unequip. */
  removeClassMod: () => void;
}

/** Map tree name to SkillTreeType for treeBonus resolution. */
const TREE_NAME_MAP: Record<string, SkillTreeType> = {
  Gunslinger: SkillTreeType.Gunslinger,
  Demolition: SkillTreeType.Demolition,
  Scavenger: SkillTreeType.Scavenger,
  Fixer: SkillTreeType.Fixer,
};

export const useSkillStore = create<SkillState>()((set, get) => ({
  spent: {},
  appliedClassModId: null,
  classModBoosts: { nodeBoosts: {} },

  spendPoint: (nodeId) => {
    const node = SKILL_NODES.find((n) => n.id === nodeId);
    if (!node) return;
    set((s) => ({
      spent: { ...s.spent, [nodeId]: (s.spent[nodeId] || 0) + 1 },
    }));
  },

  respecCost: () => {
    // Respec prices BUDGET points (audit HTR-01): a major refunds as the
    // 3 points it cost, a keystone as 5 — the server's cc_retrain charges
    // cc_skill_spend_cost × 100, and this quote must equal that charge.
    return get().getSpentBudget() * 100;
  },

  respec: (creditsAvailable) => {
    const cost = get().respecCost();
    if (creditsAvailable >= cost) {
      set({ spent: {} });
      return true;
    }
    return false;
  },

  getBonuses: () => {
    const { spent, classModBoosts } = get();
    // The computation itself lives in lib/skills/skillBonuses so the
    // server derives identical bonuses from server-side records.
    return computeSkillBonuses(spent, classModBoosts);
  },

  getTotalSpent: () => {
    const { spent, classModBoosts } = get();
    const manual = Object.values(spent).reduce((a, b) => a + b, 0);
    // treeBonus adds 1 per node in the tree
    let treeBonusPoints = 0;
    if (classModBoosts.treeBonus) {
      const treeType = TREE_NAME_MAP[classModBoosts.treeBonus];
      if (treeType) {
        treeBonusPoints = SKILL_NODES.filter((n) => n.tree === treeType).length;
      }
    }
    const nodeBoostPoints = Object.values(classModBoosts.nodeBoosts).reduce((a, b) => a + b, 0);
    return manual + treeBonusPoints + nodeBoostPoints;
  },

  getSpentBudget: () => {
    // The level−1 budget is spent in LISTED costs (audit HTR-01): smalls
    // cost 1, majors 3, keystones 5. Availability, the spend gate, and
    // the respec quote all read this weighted total of REAL spends —
    // never the raw count, and never class-mod boosts.
    return skillSpendCost(get().spent);
  },

  applyClassMod: (classMod) => {
    set({
      appliedClassModId: classMod.id,
      classModBoosts: {
        treeBonus: classMod.treeBonus,
        nodeBoosts: { ...classMod.nodeBoosts },
      },
    });
  },

  removeClassMod: () => {
    set({
      appliedClassModId: null,
      classModBoosts: { nodeBoosts: {} },
    });
  },
}));
