import { create } from 'zustand';
import { SKILL_NODES } from '../../constants/skillTrees';

export interface SkillState {
  spent: Record<string, number>;
  spendPoint: (nodeId: string) => void;
  respecCost: () => number;
  respec: (creditsAvailable: number) => boolean;
  getBonuses: () => Record<string, number>;
  getTotalSpent: () => number;
}

export const useSkillStore = create<SkillState>()((set, get) => ({
  spent: {},

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
    const spent = get().spent;
    const bonuses: Record<string, number> = {};
    for (const [nodeId, points] of Object.entries(spent)) {
      const node = SKILL_NODES.find((n) => n.id === nodeId);
      if (!node || points <= 0) continue;
      for (const [effectKey, effectValue] of Object.entries(node.effects)) {
        bonuses[effectKey] = (bonuses[effectKey] || 0) + effectValue * points;
      }
    }
    bonuses.dps = (bonuses.weaponDamage || 0) + (bonuses.critChance || 0) * 0.5 + (bonuses.critDamage || 0) * 0.5;
    bonuses.survival = 0;
    bonuses.shieldBreak = (bonuses.shieldDamageMod || 0) + (bonuses.ordnanceShieldBreak || 0);
    bonuses.armorBreak = (bonuses.armorDamageMod || 0) + (bonuses.explosiveArmorBreak || 0);
    bonuses.staggerChance = bonuses.staggerChance || 0;
    return bonuses;
  },

  getTotalSpent: () => Object.values(get().spent).reduce((a, b) => a + b, 0),
}));
