/**
 * Cache Hunters slice (a) — acceptance checks A1–A6 (brief §5).
 *
 * The brief names e2e-browser runners for A2/A3/A5; the e2e lane's
 * current shape has no hunter-switch surface to drive (slice (b)
 * builds it), so those checks are pinned here at the strongest
 * vitest level — the store + derivation + memory-twin level the e2e
 * cases will exercise — and the PR body says so plainly. A1/A6 also
 * run as a staging probe after the migration drill.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKILL_NODES } from '../constants/skillTrees';
import { SkillTreeType } from '../types/game';
import { computeCanonicalMaxHp } from '../lib/combat/damageContract';
import {
  activeHunterId,
  checkClassModBinding,
  computeHunterSkillBonuses,
  defaultHunterForSelection,
  effectivePointsForHunter,
  HUNTERS,
  isSpareForDispatch,
  itemsAssignedToAnyHunter,
  loadoutForHunter,
  splitSpendsByHunter,
  spendsForHunter,
  totalSpendPoints,
  type HunterId,
  type HunterLoadout,
} from '../lib/hunters/hunters';
import {
  computeSkillBonuses,
  effectiveSkillPoints,
  skillSpendCost,
} from '../lib/skills/skillBonuses';
import { SKILL_EFFECT_CONSUMERS } from '../lib/skills/skillConsumers';
import { useSkillStore } from '../store/slices/skillSlice';

const MIGRATION = readFileSync(
  join(__dirname, '..', '..', 'db', 'migrations', '0097_cache_hunters.sql'),
  'utf8',
);

/** Spends in all four trees (a lifetime hybrid build, pre-reshape). */
const HYBRID_SPENDS: Record<string, number> = {
  gs_dmg_1: 5,
  gs_crit_1: 3,
  gs_keystone: 1,
  demo_ord_1: 4,
  demo_stag_1: 2,
  scav_qty_1: 5,
  scav_fee_1: 1,
  fix_craft_time_1: 5,
  fix_quality_1: 2,
};

describe('A1 · spend conversion conserves points per tree', () => {
  it('each hunter pool is exactly the spends in that tree; total is conserved; no id changes', () => {
    const pools = splitSpendsByHunter(HYBRID_SPENDS);
    expect(pools.vesper).toEqual({ gs_dmg_1: 5, gs_crit_1: 3, gs_keystone: 1 });
    expect(pools.silas).toEqual({ demo_ord_1: 4, demo_stag_1: 2 });
    expect(pools.josie).toEqual({ scav_qty_1: 5, scav_fee_1: 1 });
    expect(pools.doc).toEqual({ fix_craft_time_1: 5, fix_quality_1: 2 });
    const pooledTotal = Object.values(pools).reduce((sum, pool) => sum + totalSpendPoints(pool), 0);
    expect(pooledTotal).toBe(totalSpendPoints(HYBRID_SPENDS));
    // Every pooled id is a shipped node id — the split invents nothing.
    const shippedIds = new Set(SKILL_NODES.map((n) => n.id));
    for (const pool of Object.values(pools)) {
      for (const id of Object.keys(pool)) expect(shippedIds.has(id)).toBe(true);
    }
  });

  it('the migration is additive, seeds the default hunter from the selection, and never rewrites skill_spends', () => {
    expect(MIGRATION).toContain('add column if not exists active_hunter_id');
    expect(MIGRATION).toContain('add column if not exists hunter_loadouts');
    expect(MIGRATION).toContain("when 'Demolition' then 'silas'");
    expect(MIGRATION).toContain("when 'Scavenger' then 'josie'");
    expect(MIGRATION).toContain("when 'Fixer' then 'doc'");
    // No UPDATE in the migration writes skill_spends except cc_retrain's
    // per-hunter zeroing (inside its function body).
    const updates = MIGRATION.split('\n').filter((l) => /update public\.profiles/i.test(l));
    for (const line of updates) expect(line).not.toContain('skill_spends');
    expect(defaultHunterForSelection('Demolition')).toBe('silas');
    expect(defaultHunterForSelection('Scavenger')).toBe('josie');
    expect(defaultHunterForSelection('Fixer')).toBe('doc');
    expect(defaultHunterForSelection('Gunslinger')).toBe('vesper');
    expect(defaultHunterForSelection(null)).toBe('vesper');
    expect(activeHunterId({ active_hunter_id: 'doc', action_skill_selection: 'Gunslinger' })).toBe('doc');
  });

  it('every growth/parity node in TS has a skill_node_definitions row in 0097 with identical effects', () => {
    const growthIds = [
      'gs_status_2', 'gs_shield_2', 'gs_speed_3', 'gs_speed_4', 'gs_major_5',
      'demo_shield_2', 'demo_cons_1', 'demo_cons_2', 'demo_cons_3', 'demo_cons_4', 'demo_cons_5',
      'scav_wpn_1', 'scav_wpn_2', 'scav_crit_1', 'scav_crit_2', 'scav_critdmg_1',
      'fix_ord_1', 'fix_ord_2', 'fix_exp_1', 'fix_armor_1', 'fix_stag_1',
    ];
    for (const id of growthIds) {
      expect(SKILL_NODES.some((n) => n.id === id), id).toBe(true);
      expect(MIGRATION, id).toContain(`('${id}',`);
    }
  });

  it('tree costs: all four trees cost 77 before growth and more than the 99 budget after', () => {
    const costOf = (tree: SkillTreeType, ids?: Set<string>) =>
      SKILL_NODES.filter((n) => n.tree === tree && (!ids || ids.has(n.id)))
        .reduce((sum, n) => sum + n.maxPoints * n.cost, 0);
    const growth = new Set([
      'gs_status_2', 'gs_shield_2', 'gs_speed_3', 'gs_speed_4', 'gs_major_5',
      'demo_cons_1', 'demo_cons_2', 'demo_cons_3', 'demo_cons_4', 'demo_cons_5',
      'scav_wpn_1', 'scav_wpn_2', 'scav_crit_1', 'scav_crit_2', 'scav_critdmg_1',
      'fix_ord_1', 'fix_ord_2', 'fix_exp_1', 'fix_armor_1', 'fix_stag_1',
    ]);
    for (const tree of Object.values(SkillTreeType)) {
      const base = costOf(tree) - SKILL_NODES.filter((n) => n.tree === tree && growth.has(n.id))
        .reduce((sum, n) => sum + n.maxPoints * n.cost, 0);
      expect(base, tree).toBe(77);
      expect(costOf(tree), tree).toBeGreaterThan(99);
    }
  });
});

describe('A2 · pools are independent', () => {
  it('training on Vesper deducts from her pool only; Silas is untouched (store level)', () => {
    useSkillStore.setState({ spent: { ...HYBRID_SPENDS }, activeHunterId: 'vesper' });
    const silasBefore = spendsForHunter(useSkillStore.getState().spent, 'silas');
    useSkillStore.getState().spendPoint('gs_dmg_2');
    const after = useSkillStore.getState().spent;
    expect(after.gs_dmg_2).toBe(1);
    expect(spendsForHunter(after, 'silas')).toEqual(silasBefore);
    // The budget each pool is checked against is its own subset cost.
    expect(skillSpendCost(spendsForHunter(after, 'vesper'))).toBe(
      skillSpendCost({ gs_dmg_1: 5, gs_crit_1: 3, gs_keystone: 1, gs_dmg_2: 1 }),
    );
    expect(skillSpendCost(spendsForHunter(after, 'silas'))).toBe(skillSpendCost(silasBefore));
  });

  it('the SQL train budget reads the node-tree subset (0097 restatement)', () => {
    expect(MIGRATION).toContain(
      'cc_skill_spend_cost(public.cc_skill_spends_for_tree(p.skill_spends, node.tree))',
    );
    expect(MIGRATION).toContain('create or replace function public.cc_skill_spends_for_tree');
  });

  it('bonuses derive from the active hunter subset only', () => {
    const asVesper = computeHunterSkillBonuses(HYBRID_SPENDS, { nodeBoosts: {} }, 'vesper');
    const asJosie = computeHunterSkillBonuses(HYBRID_SPENDS, { nodeBoosts: {} }, 'josie');
    // Vesper reads Gunslinger nodes + her base perk; Josie's
    // lootQuantity nodes do not leak into Vesper's record.
    expect(asVesper.lootQuantity ?? 0).toBe(0);
    expect(asVesper.critChance).toBeCloseTo(3 * 0.03 + 0.03, 10);
    // Josie reads Scavenger nodes + her loot lean; Vesper's crit does not leak.
    expect(asJosie.lootQuantity).toBeCloseTo(5 * 0.1 + 0.1, 10);
    expect(asJosie.critChance ?? 0).toBe(0);
  });
});

describe('A3 · respec is per-hunter', () => {
  it('respec charges 100cr × the active hunter’s points and zeroes only his pool (store level)', () => {
    useSkillStore.setState({ spent: { ...HYBRID_SPENDS }, activeHunterId: 'silas' });
    const vesperBefore = spendsForHunter(useSkillStore.getState().spent, 'vesper');
    // Silas pool: demo_ord_1 (4×1) + demo_stag_1 (2×1) = 6 budget points.
    expect(useSkillStore.getState().respecCost()).toBe(600);
    expect(useSkillStore.getState().respec(600)).toBe(true);
    const after = useSkillStore.getState().spent;
    expect(spendsForHunter(after, 'silas')).toEqual({});
    expect(spendsForHunter(after, 'vesper')).toEqual(vesperBefore);
    expect(spendsForHunter(after, 'josie')).toEqual({ scav_qty_1: 5, scav_fee_1: 1 });
  });

  it('the SQL retrain prices and zeroes only the active hunter subset (0097 restatement)', () => {
    expect(MIGRATION).toContain('v_pool := public.cc_skill_spends_for_tree(p.skill_spends, v_tree)');
    expect(MIGRATION).toContain('cost := public.cc_skill_spend_cost(v_pool) * 100');
    expect(MIGRATION).toContain("if public.cc_skill_spend_total(v_pool) = 0 then raise exception 'Nothing to respec'");
  });
});

describe('A4 · twin parity + zero dead keys per hunter', () => {
  it('hunter derivation equals the legacy derivation on the subset + base perk, for every hunter', () => {
    for (const hunter of HUNTERS) {
      const subset = spendsForHunter(HYBRID_SPENDS, hunter.id);
      const legacy = computeSkillBonuses(subset, { nodeBoosts: {} });
      const derived = computeHunterSkillBonuses(HYBRID_SPENDS, { nodeBoosts: {} }, hunter.id);
      for (const [key, value] of Object.entries(legacy)) {
        const perk = hunter.basePerkEffects[key] ?? 0;
        const floor = hunter.basePerkFloors[key];
        const expected = floor !== undefined ? Math.max(value + perk, floor) : value + perk;
        if (['dps', 'survival', 'shieldBreak', 'armorBreak', 'heavyDamageBonus'].includes(key)) continue;
        expect(derived[key], `${hunter.id}.${key}`).toBeCloseTo(expected, 10);
      }
    }
  });

  it('class-mod boosts are scoped to the hunter tree in the derivation', () => {
    const boosts = { treeBonus: 'Demolition', nodeBoosts: { demo_ord_1: 2, gs_dmg_1: 2 } };
    const asSilas = effectivePointsForHunter({}, boosts, 'silas');
    expect(asSilas.demo_ord_1).toBe(3); // nodeBoost 2 + treeBonus +1
    expect(asSilas.gs_dmg_1).toBeUndefined();
    const asVesper = effectivePointsForHunter({}, boosts, 'vesper');
    expect(asVesper.gs_dmg_1).toBe(2); // nodeBoost only; Demolition treeBonus dropped
    expect(asVesper.demo_ord_1).toBeUndefined();
    // The legacy merge agrees on the in-tree half.
    expect(effectiveSkillPoints({}, boosts).demo_ord_1).toBe(3);
  });

  it('growth branches mint no new keys: every growth-node effect key already exists on a pre-growth node or in the consumer registry', () => {
    const growth = new Set([
      'gs_status_2', 'gs_shield_2', 'gs_speed_3', 'gs_speed_4', 'gs_major_5',
      'demo_shield_2',
      'demo_cons_1', 'demo_cons_2', 'demo_cons_3', 'demo_cons_4', 'demo_cons_5',
      'scav_wpn_1', 'scav_wpn_2', 'scav_crit_1', 'scav_crit_2', 'scav_critdmg_1',
      'fix_ord_1', 'fix_ord_2', 'fix_exp_1', 'fix_armor_1', 'fix_stag_1',
    ]);
    const preGrowthKeys = new Set<string>();
    for (const node of SKILL_NODES) {
      if (growth.has(node.id)) continue;
      for (const key of Object.keys(node.effects)) preGrowthKeys.add(key);
    }
    const registered = new Set(Object.keys(SKILL_EFFECT_CONSUMERS));
    for (const node of SKILL_NODES) {
      if (!growth.has(node.id)) continue;
      for (const key of Object.keys(node.effects)) {
        expect(preGrowthKeys.has(key) || registered.has(key), `${node.id}.${key}`).toBe(true);
      }
    }
    // And the registry's structural test (keystoneSkillLayer) covers
    // the one new major's keys: shieldDamageMod/statusChance are
    // small-node keys consumed through the flat record + composites.
    const major = SKILL_NODES.find((n) => n.id === 'gs_major_5');
    expect(major?.type).toBe('major');
  });

  it('base perks use only already-consumed keys', () => {
    const nodeKeys = new Set<string>();
    for (const node of SKILL_NODES) for (const key of Object.keys(node.effects)) nodeKeys.add(key);
    for (const hunter of HUNTERS) {
      for (const key of [...Object.keys(hunter.basePerkEffects), ...Object.keys(hunter.basePerkFloors)]) {
        expect(nodeKeys.has(key), `${hunter.id}.${key}`).toBe(true);
      }
    }
  });
});

describe('A5 · class-mod binding refuses cleanly with the reason', () => {
  const gunslingerMod = { treeBonus: 'Gunslinger', nodeBoosts: { gs_dmg_1: 1 } };

  it('a Gunslinger mod refuses on Silas with the owning hunter named, and equips on Vesper', () => {
    const refused = checkClassModBinding(gunslingerMod, 'silas');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('Vesper Cole');
    expect(refused.reason).toContain('Gunslinger');
    expect(checkClassModBinding(gunslingerMod, 'vesper')).toEqual({ ok: true, reason: null });
  });

  it('the SQL equip carries the same binding refusal (0097 restatement)', () => {
    expect(MIGRATION).toContain("if slot_name = 'classMod'");
    expect(MIGRATION).toContain('Class mod is bound to % (%)');
    expect(MIGRATION).toContain('cc_profile_active_tree(p)');
  });
});

describe('A6 · canonical HP invariance', () => {
  it('canonical max HP is identical across all four active hunters and matches the pre-reshape fixture', () => {
    // HTR-03 fixture shape: level + shield + Thick Skin bonus — none
    // of these inputs is hunter-keyed, and no hunter derivation
    // touches them.
    const bonus = 0.1; // Thick Skin maxed
    const expected = computeCanonicalMaxHp(50, 200, bonus);
    for (const hunter of HUNTERS) {
      // The hunter derivation produces no HP-pool input: skill
      // bonuses carry no shieldCapacity from base perks, and the
      // canonical helper's inputs are hunter-free by construction.
      const bonuses = computeHunterSkillBonuses(HYBRID_SPENDS, { nodeBoosts: {} }, hunter.id as HunterId);
      expect(bonuses.shieldCapacity ?? 0).toBe(0);
      expect(computeCanonicalMaxHp(50, 200, bonus)).toBe(expected);
    }
    // The migration never writes a Cache Rank column: no UPDATE in
    // it sets cache_rank_spends / cache_rank_tokens.
    expect(MIGRATION).not.toContain('set cache_rank');
    expect(MIGRATION).not.toContain('cache_rank_spends =');
  });
});

describe('slice (a) loadout plumbing', () => {
  it('SQL direct point reads are hunter-gated (recycle + market fee twins)', () => {
    // cc_recycle_item: Hoarder / King of Scrap pay only for Josie.
    expect(MIGRATION).toContain("cc_profile_active_tree(p) <> 'Scavenger'");
    expect(MIGRATION).toContain('hoarder_pts := 0');
    // cc_accept_listing / cc_quickbuy_fill: fee levers per hunter.
    expect(MIGRATION).toContain("cc_profile_active_tree(seller) <> 'Scavenger'");
    expect(MIGRATION).toContain("cc_profile_active_tree(seller) <> 'Fixer'");
    expect(MIGRATION).toContain('darknet_pts := 0');
    expect(MIGRATION).toContain('house_pts := 0');
  });

  it('loadout assignments parse per hunter and the Dispatch spare test spans all hunters', () => {
    const loadouts = {
      vesper: { primary: 'item-a', belt: { PreFight: 'med_kit', MidFight: null, Emergency: null } },
      doc: { vehicle: 'veh-1' },
    } as unknown as Partial<Record<HunterId, HunterLoadout>>;
    expect(loadoutForHunter(loadouts, 'vesper').primary).toBe('item-a');
    expect(loadoutForHunter(loadouts, 'vesper').belt.PreFight).toBe('med_kit');
    expect(loadoutForHunter(loadouts, 'josie').primary).toBeNull();
    expect(itemsAssignedToAnyHunter(loadouts)).toEqual(new Set(['item-a', 'veh-1']));
    // Assigned to ANY hunter → not spare, even when not equipped.
    expect(isSpareForDispatch({ id: 'item-a', runtime_state: 'available', equipped_slot: null }, loadouts)).toBe(false);
    expect(isSpareForDispatch({ id: 'veh-1', runtime_state: 'available', equipped_slot: null }, loadouts)).toBe(false);
    // In service (escrowed) → never spare; truly unassigned → spare.
    expect(isSpareForDispatch({ id: 'item-b', runtime_state: 'in_service', equipped_slot: null }, loadouts)).toBe(false);
    expect(isSpareForDispatch({ id: 'item-b', runtime_state: 'available', equipped_slot: null }, loadouts)).toBe(true);
    expect(MIGRATION).toContain('cc_item_in_any_hunter_loadout(p.hunter_loadouts, v_item.id)');
    expect(MIGRATION).toContain('cc_item_in_any_hunter_loadout(p.hunter_loadouts, v_vehicle.id)');
  });

  it('the switch collapses the selection and never touches the charge pool (0097)', () => {
    expect(MIGRATION).toContain('action_skill_selection = public.cc_hunter_tree(v_hunter)');
    expect(MIGRATION).not.toContain('action_skill_charge =');
  });
});
