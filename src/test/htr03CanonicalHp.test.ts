/**
 * HTR-03 (owner ruling 2026-11-12) — ONE canonical HP pool.
 *
 * The audit found one build carrying four different HP numbers:
 * the roaming store settled 2,100, the idle ticker's survival stats
 * and the server offline gate judged 2,310 (a hidden
 * (1 + survival-composite) multiplier, no Thick Skin), Hunter Totals
 * and the boss sim used 2,290 (Thick Skin, no composite), and the
 * boss-fight HP bar showed 2,100. The ruling: the pool is the
 * roaming-settled chassis PLUS Cache Rank Thick Skin —
 * round((700 + 60·level) · (1 + thickSkin)) + shieldHp — wired into
 * every surface; the offline gate's hidden multiplier is removed
 * (it was an artifact, not a design).
 *
 * This suite pins the audit fixture across every surface:
 * level 20, shield 200 HP / 25% mitigation, Thick Skin maxed
 * (Cache Rank maxHp 10 ranks → +10%), stagger nodes maxed
 * (staggerChance 0.50 → survival composite 0.10).
 * Chassis = 700 + 60×20 = 1,900 → canonical pool = 2,090 + 200 = 2,290.
 * With no Thick Skin the pool is 2,100 on every surface.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { cacheRankBonuses } from '@/content/cacheRank';
import {
  computeCanonicalMaxHp,
  computeHunterMaxHp,
} from '@/lib/combat/damageContract';
import { loadoutSurvivalStats } from '@/lib/combat/loadoutSurvival';
import { buildInitialTimeline, computePlayerMaxHp } from '@/lib/animation/fightTimeline';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { simulateBoss } from '@/lib/simulation/bossSimulator';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { DropSource } from '@/types/game';
import { Rarity, RiskSetting } from '@/types/game';
import type { PlayerProfile } from '@/types/player';
import type { Shield, Weapon } from '@/types/items';
import { createTickRng } from '@/lib/rng/tickRng';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';

const LEVEL = 20;
const SHIELD_HP = 200;
const THICK_SKIN_SPENDS = { maxHp: 10 };
const POOL_WITH_THICK_SKIN = 2290; // round(1900 × 1.1) + 200
const POOL_PLAIN = 2100; // 1900 + 200

const fixtureShield = { hp: SHIELD_HP, mitigation: 0.25 } as unknown as Shield;

function fixturePlayer(cacheRankSpends: Record<string, number>): PlayerProfile {
  return {
    id: 'htr03-fixture', name: 'Fixture Hunter', level: LEVEL, xp: 0, credits: 0, scrap: 0,
    cacheKeys: 0, legendaryCores: 0,
    currentZoneId: 'dustwaste', highestZoneId: 'dustwaste',
    offlineCapHours: 0, lastClaimTime: 0, deathFeeInsurance: false,
    consumables: {}, materials: {}, essences: {}, workshopQueues: [], lastWorkshopTick: 0,
    cacheRankTokens: 0, cacheRankSpends,
  } as unknown as PlayerProfile;
}

function fixtureWeapon(): Weapon {
  return generateWeapon(
    { source: DropSource.WorldDrop, level: LEVEL, forcedRarity: Rarity.Rare },
    createTickRng('htr03', 'fixture', 1),
  );
}

describe('HTR-03 — the canonical pool definition', () => {
  it('computeCanonicalMaxHp: chassis scaled by Thick Skin, shield unscaled on top', () => {
    const bonus = cacheRankBonuses(THICK_SKIN_SPENDS).maxHp;
    expect(bonus).toBeCloseTo(0.1, 10);
    expect(computeCanonicalMaxHp(LEVEL, SHIELD_HP, bonus)).toBe(POOL_WITH_THICK_SKIN);
    expect(computeCanonicalMaxHp(LEVEL, SHIELD_HP, 0)).toBe(POOL_PLAIN);
    // Zero Thick Skin is exactly the chassis formula.
    expect(computeCanonicalMaxHp(LEVEL, SHIELD_HP, 0)).toBe(computeHunterMaxHp(LEVEL, SHIELD_HP));
  });
});

describe('HTR-03 — every surface states the same pool', () => {
  beforeEach(() => {
    useSurvivalStore.setState({
      currentHp: 700, maxHp: 700, shieldHp: 0, isDead: false,
      lastKilledBy: null, deathLog: [], resurrectionStartedAt: null,
      resurrectionReadyAt: null, autoEatThreshold: 0.7,
    });
    usePlayerStore.setState({ level: LEVEL, cacheRankSpends: { ...THICK_SKIN_SPENDS } });
    useSkillStore.setState({ spent: { demo_stag_1: 5, demo_stag_2: 5 }, classModBoosts: { nodeBoosts: {} } });
    useLoadoutStore.setState({
      slots: {
        primary: null, secondary: null, heavy: null, ordnance: null,
        shield: null, classMod: null, relic: null, vehicle: null,
      },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
  });

  it('mechanics snapshot (Hunter Totals pool) = 2,290', () => {
    const snapshot = buildCharacterMechanicsSnapshot({
      player: fixturePlayer(THICK_SKIN_SPENDS),
      weapons: [fixtureWeapon()],
      shield: fixtureShield,
      spentSkills: { demo_stag_1: 5, demo_stag_2: 5 },
    });
    expect(snapshot.maxHp.value).toBe(POOL_WITH_THICK_SKIN);
  });

  it('roaming survival store (hook sync) = 2,290 — Thick Skin reaches roaming', () => {
    renderHook(() => useSyncSurvivalMaxHp(LEVEL, SHIELD_HP));
    expect(useSurvivalStore.getState().maxHp).toBe(POOL_WITH_THICK_SKIN);
  });

  it('survival slice recompute with the resolved bonus = 2,290; without = 2,100', () => {
    const bonus = cacheRankBonuses(THICK_SKIN_SPENDS).maxHp;
    useSurvivalStore.getState().recomputeMaxHp(LEVEL, SHIELD_HP, bonus);
    expect(useSurvivalStore.getState().maxHp).toBe(POOL_WITH_THICK_SKIN);
    useSurvivalStore.getState().recomputeMaxHp(LEVEL, SHIELD_HP, 0);
    expect(useSurvivalStore.getState().maxHp).toBe(POOL_PLAIN);
  });

  it('idle ticker survival stats = 2,290 — the survival composite no longer inflates HP', () => {
    // Equip the fixture shield through the loadout store stub, the
    // loadoutSurvival.test.ts pattern. Stagger is maxed in the skill
    // store (composite 0.10): pre-fix this read round(2100 × 1.1) =
    // 2,310 with NO Thick Skin; the canonical pool reads 2,290.
    const shieldId = 'htr03_shield';
    useLoadoutStore.setState((state) => ({
      slots: { ...state.slots, shield: shieldId },
    }));
    useLoadoutStore.setState({
      getShield: () => ({ id: shieldId, name: 'Fixture Shield', level: LEVEL, rarity: 'Rare', hp: SHIELD_HP, mitigation: 0.25 } as never),
    });
    const stats = loadoutSurvivalStats();
    expect(stats.maxHp).toBe(POOL_WITH_THICK_SKIN);
    // The composite still does its real job: stagger → dodge.
    expect(stats.dodgeChance).toBeGreaterThan(0);
  });

  it('boss sim player pool = 2,290 (survivalScore is pool / (dps × 30) on a clean fixture)', () => {
    const boss = REGION_1_BOSSES[0]; // Dune Tyrant, dps 30
    const sim = simulateBoss({
      primary: fixtureWeapon(),
      secondary: null, heavy: null, ordnance: null,
      shield: { hp: SHIELD_HP, mitigation: 0 } as unknown as Shield,
      classMod: null, relic: null, consumables: {},
      risk: RiskSetting.Balanced,
      boss,
      playerLevel: LEVEL,
      skillBonuses: { cacheRankMaxHpBonus: cacheRankBonuses(THICK_SKIN_SPENDS).maxHp },
    });
    expect(sim.survivalScore).toBeCloseTo(POOL_WITH_THICK_SKIN / (boss.dps * 30), 10);
  });

  it('boss fight HP bar (fight timeline) = 2,290; legacy 2-arg call stays the plain pool', () => {
    const bonus = cacheRankBonuses(THICK_SKIN_SPENDS).maxHp;
    expect(computePlayerMaxHp(LEVEL, SHIELD_HP, bonus)).toBe(POOL_WITH_THICK_SKIN);
    expect(computePlayerMaxHp(LEVEL, SHIELD_HP)).toBe(POOL_PLAIN);
    const timeline = buildInitialTimeline(
      { result: { victory: true, winChance: 1, bossHpRemaining: 0 }, creditsDelta: 0, bonusLootRolls: 0, consumedConsumables: {}, loot: [], extraLoot: false },
      1000, LEVEL, SHIELD_HP, bonus,
    );
    expect(timeline.playerHpMax).toBe(POOL_WITH_THICK_SKIN);
  });

  it('no-Thick-Skin build: every surface = 2,100', () => {
    usePlayerStore.setState({ cacheRankSpends: {} });
    const snapshot = buildCharacterMechanicsSnapshot({
      player: fixturePlayer({}),
      weapons: [fixtureWeapon()],
      shield: fixtureShield,
      spentSkills: { demo_stag_1: 5, demo_stag_2: 5 },
    });
    expect(snapshot.maxHp.value).toBe(POOL_PLAIN);
    renderHook(() => useSyncSurvivalMaxHp(LEVEL, SHIELD_HP));
    expect(useSurvivalStore.getState().maxHp).toBe(POOL_PLAIN);
  });
});

describe('HTR-03 — the offline gate reads the canonical pool (source pin)', () => {
  // The gate is inline in the settle-offline route; its input is the
  // behavior. Pin the wiring at the source: canonical helper, the
  // gate's own Cache Rank resolution, and NO survival multiplier.
  const source = readFileSync(join(process.cwd(), 'src/server/routes/settleOffline.ts'), 'utf8');

  it('gate maxHp is computeCanonicalMaxHp with gateCacheRank.maxHp', () => {
    expect(source).toContain(
      'computeCanonicalMaxHp(profile.player_level || 1, gateShieldCapacity, gateCacheRank.maxHp)',
    );
  });

  it('the hidden (1 + survival) multiplier is gone from the route', () => {
    expect(source).not.toContain('skillBonuses.survival ?? 0');
    expect(source).not.toContain('computeHunterMaxHp(profile.player_level');
  });
});
