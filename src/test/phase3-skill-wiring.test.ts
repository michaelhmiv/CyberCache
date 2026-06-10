/**
 * Phase 3 skill tree wiring tests — verify that skill bonuses flow into
 * roaming DPS, survival, Chef idle rewards, and boss sim damage.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSkillStore } from '@/store/slices/skillSlice';
import { loadoutSurvivalStats } from '@/lib/combat/loadoutSurvival';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { processRoamingClaim } from '@/server/chef';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const resetStores = () => {
  useSkillStore.setState({ spent: {} });
  usePlayerStore.setState({ level: 10, id: 'test-player', credits: 1000, xp: 0, consumables: {} });
  useSurvivalStore.setState({
    currentHp: 500, maxHp: 1500, shieldHp: 200, isDead: false,
    autoEatThreshold: 0.7,
  });
};

beforeEach(resetStores);

// ---------------------------------------------------------------------------
// Skill composite formulas
// ---------------------------------------------------------------------------

describe('getBonuses — composite formulas', () => {
  it('includes attackSpeed in dps composite', () => {
    // gs_speed_1: attackSpeed 0.08 per point (2 pts = 0.16)
    // gs_speed_2: attackSpeed 0.08 per point (1 pt  = 0.08)
    // total attackSpeed = 0.24 → dps contribution = 0.24 * 0.3 = 0.072
    useSkillStore.setState({ spent: { gs_speed_1: 2, gs_speed_2: 1 } });
    const bonuses = useSkillStore.getState().getBonuses();
    expect(bonuses.dps).toBeCloseTo(0.072, 3);
  });

  it('computes survival from shieldCapacity and staggerChance', () => {
    // demo_stag_1: staggerChance 0.05 per point (3 pts = 0.15)
    // survival = shieldCapacity*0.3 (0 from skills) + staggerChance*0.2 = 0.15*0.2 = 0.03
    useSkillStore.setState({ spent: { demo_stag_1: 3 } });
    const bonuses = useSkillStore.getState().getBonuses();
    expect(bonuses.survival).toBeCloseTo(0.03, 3);
  });

  it('computes heavyDamageBonus from ordnanceDamage and explosiveDamage', () => {
    // demo_ord_1: ordnanceDamage 0.10 per point (2 pts = 0.20)
    // demo_exp_1: explosiveDamage 0.08 per point (1 pt  = 0.08)
    // heavyDamageBonus = 0.20*0.4 + 0.08*0.6 = 0.08 + 0.048 = 0.128
    useSkillStore.setState({ spent: { demo_ord_1: 2, demo_exp_1: 1 } });
    const bonuses = useSkillStore.getState().getBonuses();
    expect(bonuses.heavyDamageBonus).toBeCloseTo(0.128, 3);
  });

  it('survival is 0 with no relevant skills', () => {
    const bonuses = useSkillStore.getState().getBonuses();
    expect(bonuses.survival).toBe(0);
  });

  it('shieldBreak composites shieldDamageMod + ordnanceShieldBreak', () => {
    // gs_shield_1: shieldDamageMod 0.05 per point (2 pts = 0.10)
    // demo_shield_1: ordnanceShieldBreak 0.10 per point (1 pt = 0.10)
    // shieldBreak = 0.10 + 0.10 = 0.20
    useSkillStore.setState({ spent: { gs_shield_1: 2, demo_shield_1: 1 } });
    const bonuses = useSkillStore.getState().getBonuses();
    expect(bonuses.shieldBreak).toBeCloseTo(0.20, 3);
  });

  it('armorBreak composites armorDamageMod + explosiveArmorBreak', () => {
    // demo_armor_1: armorDamageMod 0.10 per point (2 pts = 0.20)
    // demo_keystone: explosiveArmorBreak 1.0 (fixed)
    useSkillStore.setState({ spent: { demo_armor_1: 2, demo_keystone: 1 } });
    const bonuses = useSkillStore.getState().getBonuses();
    expect(bonuses.armorBreak).toBeCloseTo(1.2, 3); // 0.20 + 1.0
  });
});

// ---------------------------------------------------------------------------
// Gap C — Survival bonus flows into roaming max HP
// ---------------------------------------------------------------------------

describe('loadoutSurvivalStats — skill survival on max HP', () => {
  it('boost max HP by survival multiplier', () => {
    usePlayerStore.setState({ level: 10 });
    const base = loadoutSurvivalStats();
    expect(base.maxHp).toBeGreaterThan(0);

    // Add staggerChance skill → survival > 0
    useSkillStore.setState({ spent: { demo_stag_1: 3 } });
    const boosted = loadoutSurvivalStats();
    // maxHp should be baseMaxHp * 1.03 (survival = 0.03)
    expect(boosted.maxHp).toBe(Math.round(base.maxHp * 1.03));
  });

  it('dodgeChance comes from staggerChance skill (capped 40%)', () => {
    useSkillStore.setState({ spent: { demo_stag_1: 5 } }); // 0.25 staggerChance
    const stats = loadoutSurvivalStats();
    expect(stats.dodgeChance).toBe(0.125); // min(0.4, 0.25*0.5)

    // Cap at 40%
    useSkillStore.setState({ spent: { demo_stag_1: 20 } }); // 1.0 staggerChance
    const capped = loadoutSurvivalStats();
    expect(capped.dodgeChance).toBeLessThanOrEqual(0.4);
  });
});

// ---------------------------------------------------------------------------
// Gap B — Skill bonuses flow into Chef idle rewards
// ---------------------------------------------------------------------------

describe('processRoamingClaim — skill economy merge', () => {
  const fakeSupabase = {} as SupabaseClient;

  it('applies skill offlineEarnings to credits', () => {
    const result = processRoamingClaim({
      playerId: 'test',
      areaId: 'dustwaste_frontier',
      ticks: 5,
      tickCount: 1,
      playerLevel: 10,
      idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 },
      skillBonuses: { offlineEarnings: 0.5 },
    }, fakeSupabase);
    // Credits per tick = round(15/20) = 1. Mult = 1 + 0 + 0.5 = 1.5 → effective = round(1*1.5)=2
    // 5 ticks → 10 credits
    expect(result.rewards.creditsAwarded).toBe(10);
  });

  it('merges weapon idleMods with skillBonuses', () => {
    const result = processRoamingClaim({
      playerId: 'test',
      areaId: 'dustwaste_frontier',
      ticks: 5,
      tickCount: 1,
      playerLevel: 10,
      idleMods: { offlineEarningsMod: 0.5, scrapYieldMod: 0, rareDropChanceMod: 0 },
      skillBonuses: { offlineEarnings: 0.5 },
    }, fakeSupabase);
    // Mult = 1 + 0.5(weapon) + 0.5(skill) = 2.0 → effective = round(1*2)=2
    // 5 ticks → 10 credits
    expect(result.rewards.creditsAwarded).toBe(10);
  });

  it('rareDropChance merges gear + skills structurally', () => {
    const result = processRoamingClaim({
      playerId: 'test',
      areaId: 'dustwaste_frontier',
      ticks: 1,
      tickCount: 1,
      playerLevel: 10,
      idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0.1 },
      skillBonuses: { rareDropChance: 0.2 },
    }, fakeSupabase);
    // Should not throw — threshold adjustment applied
    expect(result).toBeDefined();
    expect(result.rewards.ticks).toBeGreaterThanOrEqual(1);
  });
});
