import { create } from 'zustand';
import { SKILL_NODES } from '../../constants/skillTrees';
import { computeSkillBonuses } from '@/lib/skills/skillBonuses';
import type { ClassMod } from '../../types/items';

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
  /** Apply a class mod's boosts. Called by loadoutSlice on equip. */
  applyClassMod: (classMod: ClassMod) => void;
  /** Remove all class mod boosts. Called by loadoutSlice on unequip. */
  removeClassMod: () => void;
}


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
    const total = Object.values(get().spent).reduce((a, b) => a + b, 0);
    return total * 100;
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
    // Spend accounting reads REAL spends only (audit HTR-02): this total
    // feeds Spent / Available / Respec and the spend gate, and it must match
    // the server's ledger (cc_skill_spend_total sums profiles.skill_spends).
    // Class-mod boosts are effective points for bonuses — they live in
    // computeSkillBonuses / effectiveSkillPoints and never enter here,
    // or a worn mod would phantom-spend the player's budget and lock
    // them out of spending real points.
    return Object.values(get().spent).reduce((a, b) => a + b, 0);
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
