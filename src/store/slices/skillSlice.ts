import { create } from 'zustand';
import { SKILL_NODES } from '../../constants/skillTrees';
import { skillSpendCost } from '@/lib/skills/skillBonuses';
import {
  computeHunterSkillBonuses,
  defaultHunterForSelection,
  isHunterId,
  spendsForHunter,
  type HunterId,
} from '@/lib/hunters/hunters';
import type { ClassMod } from '../../types/items';

export interface SkillState {
  spent: Record<string, number>;
  /** The active Cache Hunter (reshape slice (a)); server truth is
   *  profiles.active_hunter_id, hydrated via verifiedStateSync. */
  activeHunterId: HunterId;
  setActiveHunter: (hunterId: string) => void;
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
  /** The active hunter's own pool (reshape slice (a): pools are per-hunter). */
  getActivePool: () => Record<string, number>;
  /** Budget consumed by the ACTIVE hunter's pool only. */
  getActiveSpentBudget: () => number;
  /** Apply a class mod's boosts. Called by loadoutSlice on equip. */
  applyClassMod: (classMod: ClassMod) => void;
  /** Remove all class mod boosts. Called by loadoutSlice on unequip. */
  removeClassMod: () => void;
}


export const useSkillStore = create<SkillState>()((set, get) => ({
  spent: {},
  activeHunterId: defaultHunterForSelection(null),
  appliedClassModId: null,
  classModBoosts: { nodeBoosts: {} },

  setActiveHunter: (hunterId) => {
    if (isHunterId(hunterId)) set({ activeHunterId: hunterId });
  },

  spendPoint: (nodeId) => {
    const node = SKILL_NODES.find((n) => n.id === nodeId);
    if (!node) return;
    set((s) => ({
      spent: { ...s.spent, [nodeId]: (s.spent[nodeId] || 0) + 1 },
    }));
  },

  respecCost: () => {
    // Respec is PER-HUNTER (reshape slice (a), brief §2.2): it prices
    // the ACTIVE hunter's pool only — 100 cr × that hunter's budget
    // points (a major counts its 3-point cost, a keystone 5; audit
    // HTR-01) — and the server's cc_retrain charges exactly this for
    // the active hunter (migration 0097).
    return get().getActiveSpentBudget() * 100;
  },

  respec: (creditsAvailable) => {
    const cost = get().respecCost();
    if (creditsAvailable >= cost) {
      // Zero ONLY the active hunter's subset; the other hunters'
      // pools read identically before and after (check A3).
      const { spent, activeHunterId } = get();
      const pool = spendsForHunter(spent, activeHunterId);
      const next = { ...spent };
      for (const nodeId of Object.keys(pool)) delete next[nodeId];
      set({ spent: next });
      return true;
    }
    return false;
  },

  getBonuses: () => {
    const { spent, classModBoosts, activeHunterId } = get();
    // The hunter derivation (lib/hunters/hunters) reads the ACTIVE
    // hunter's spend subset + hunter-scoped class-mod boosts + the
    // hunter's base perk — the same derivation the server runs from
    // server-side records (skillBonusesFromRecords).
    return computeHunterSkillBonuses(spent, classModBoosts, activeHunterId);
  },

  getActivePool: () => spendsForHunter(get().spent, get().activeHunterId),

  getActiveSpentBudget: () => skillSpendCost(get().getActivePool()),

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
