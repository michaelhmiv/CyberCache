/**
 * Fractional scrap accumulation (migration 0009, Michael's decision
 * 2026-10-30).
 *
 * The bug this fixes: roaming areas pay idleScrapPerMinute 3-5 and the
 * Chef computed the per-tick rate as Math.round(rate / 20) = 0, so
 * roaming never paid scrap and every scrap multiplier in the game
 * (gear / skill / activity / consumable / Salvage Rights) multiplied
 * zero. Scrap now accrues unrounded per tick; whole scrap is paid at
 * claim end and the leftover fraction banks on the profile
 * (profiles.scrap_remainder) so it carries across claims.
 *
 * These tests use the REAL area constants (no rate mock): Dustwaste
 * Frontier pays 3 scrap/min = 0.15/tick, 15 credits/min, 1.0 XP/tick.
 */
import { describe, expect, it } from 'vitest';
import { processRoamingClaim, type ClaimRequest } from '../server/chef';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

const PLAYER = '22222222-2222-4222-8222-222222222222';

function claimRequest(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    playerId: PLAYER,
    areaId: 'dustwaste_frontier',
    ticks: 20,
    tickCount: 1000,
    playerLevel: 10,
    survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
    ...overrides,
  };
}

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'scrap-fixture-weapon',
    name: 'Scrap Fixture',
    level: 50,
    rarity: Rarity.Legendary,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
    rollQuality: 100,
    baseDamage: 10000,
    attackSpeed: 10,
    critChance: 0.5,
    critDamage: 2,
    statusChance: 0,
    statusDamage: 0,
    bossDamageMod: 2,
    waveDamageMod: 0,
    shieldDamageMod: 1,
    armorDamageMod: 1,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: DropSource.BossDrop,
    isLocked: false,
    pixelSeed: 1,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

describe('fractional scrap — processRoamingClaim at real area rates', () => {
  it('a full 20-tick Dustwaste claim pays the designed 3 scrap (0.15 x 20), banking nothing', () => {
    const result = processRoamingClaim(claimRequest());
    expect(result.rewards.scrapAwarded).toBe(3);
    expect(result.rewards.scrapRemainder).toBe(0);
  });

  it('a short claim banks its fraction instead of rounding it away', () => {
    // 3 ticks x 0.15 = 0.45 — the old math paid 0 and forgot the rest.
    const result = processRoamingClaim(claimRequest({ ticks: 3 }));
    expect(result.rewards.scrapAwarded).toBe(0);
    expect(result.rewards.scrapRemainder).toBeCloseTo(0.45, 6);
  });

  it('fractions carry across claims: two 10-tick claims pay exactly 3 total', () => {
    const first = processRoamingClaim(claimRequest({ ticks: 10 }));
    expect(first.rewards.scrapAwarded).toBe(1);
    expect(first.rewards.scrapRemainder).toBeCloseTo(0.5, 6);

    const second = processRoamingClaim(
      claimRequest({ ticks: 10, tickCount: 1010, scrapRemainder: first.rewards.scrapRemainder }),
    );
    expect(second.rewards.scrapAwarded).toBe(2);
    expect(second.rewards.scrapRemainder).toBe(0);
    expect(first.rewards.scrapAwarded + second.rewards.scrapAwarded).toBe(3);
  });

  it('a banked fraction plus a partial claim crosses the whole-scrap line exactly once', () => {
    // 0.45 banked + 4 ticks x 0.15 = 1.05 -> pay 1, bank 0.05.
    const result = processRoamingClaim(claimRequest({ ticks: 4, scrapRemainder: 0.45 }));
    expect(result.rewards.scrapAwarded).toBe(1);
    expect(result.rewards.scrapRemainder).toBeCloseTo(0.05, 6);
  });

  it('multipliers apply to the unrounded rate: Salvage Rights at a real rate', () => {
    // Dustwaste 0.15/tick x 1.5 (Salvage Rights) = 0.225/tick;
    // 20 ticks = 4.5 -> pay 4, bank 0.5. Under the old math this was
    // round(0 x 1.5) = 0 forever.
    const result = processRoamingClaim(
      claimRequest({ equippedGear: [makeWeapon({ legendaryEffectId: 'salvage_rights' })] }),
    );
    expect(result.rewards.scrapAwarded).toBe(4);
    expect(result.rewards.scrapRemainder).toBeCloseTo(0.5, 6);
  });

  it('skill scrapYield also multiplies the unrounded rate', () => {
    // 0.15 x (1 + 0.5) = 0.225/tick; 10 ticks = 2.25 -> pay 2, bank 0.25.
    const result = processRoamingClaim(
      claimRequest({ ticks: 10, skillBonuses: { scrapYield: 0.5 } }),
    );
    expect(result.rewards.scrapAwarded).toBe(2);
    expect(result.rewards.scrapRemainder).toBeCloseTo(0.25, 6);
  });

  it('an out-of-range banked remainder from the request is clamped, never minted', () => {
    const result = processRoamingClaim(claimRequest({ ticks: 1, scrapRemainder: 5 }));
    // Clamped to < 1, plus 0.15 for the tick: pays at most 1.
    expect(result.rewards.scrapAwarded).toBe(1);
    expect(result.rewards.scrapRemainder).toBeLessThan(1);
    expect(result.rewards.scrapRemainder).toBeGreaterThanOrEqual(0);
  });

  it('base XP (exactly 1.0/tick) is unaffected by fractional accrual', () => {
    const result = processRoamingClaim(claimRequest());
    expect(result.rewards.xpAwarded).toBe(20);
    expect(result.rewards.xpRemainder).toBe(0);
  });
});

describe('fractional scrap — profile bank persistence (in-memory store)', () => {
  it('applyChefRewards persists the bank; reads return it; omitting it leaves it untouched', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: PLAYER });

    const before = await store.getRoamingProfile(PLAYER);
    expect(before?.scrap_remainder).toBe(0);

    await store.applyChefRewards(
      PLAYER,
      { credits: 20, scrap: 1, scrapRemainder: 0.5, xp: 20, fragments: 0, materials: {}, essences: {}, kills: 0 },
      1000,
      'dustwaste_frontier',
    );
    const after = await store.getRoamingProfile(PLAYER);
    expect(after?.scrap_remainder).toBe(0.5);

    // A claim path that does not supply a remainder must not zero the bank.
    await store.applyChefRewards(
      PLAYER,
      { credits: 0, scrap: 2, xp: 0, fragments: 0, materials: {}, essences: {}, kills: 0 },
      1010,
      'dustwaste_frontier',
    );
    const still = await store.getRoamingProfile(PLAYER);
    expect(still?.scrap_remainder).toBe(0.5);

    // The settlement profile exposes the same bank to the offline route.
    const settlement = await store.getSettlementProfile(PLAYER);
    expect(settlement?.scrap_remainder).toBe(0.5);
  });
});
