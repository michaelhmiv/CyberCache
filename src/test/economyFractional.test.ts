/**
 * Fractional accumulation for credits and XP (migration 0010,
 * follow-through on the scrap fix in 0009).
 *
 * Credits had the rounding defect in the overpay direction: Dustwaste
 * pays 15 credits/min = 0.75/tick, and Math.round made it 1/tick
 * (+33% over the designed rate). XP rates above 1 (1.2, 1.65, ...)
 * rounded down and underpaid. Both now accrue unrounded and bank
 * their fractions on the profile like scrap does.
 *
 * Real constants: Dustwaste Frontier — 15 credits/min, 3 scrap/min,
 * 1.0 XP/tick.
 */
import { describe, expect, it } from 'vitest';
import { processRoamingClaim, type ClaimRequest } from '../server/chef';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';

const PLAYER = '44444444-4444-4444-8444-444444444444';

function claimRequest(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    playerId: PLAYER,
    areaId: 'dustwaste_frontier',
    ticks: 20,
    tickCount: 2000,
    playerLevel: 10,
    survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
    ...overrides,
  };
}

describe('fractional credits — processRoamingClaim at real area rates', () => {
  it('a full 20-tick Dustwaste claim pays the designed 15 credits, not the rounded-up 20', () => {
    const result = processRoamingClaim(claimRequest());
    expect(result.rewards.creditsAwarded).toBe(15);
    expect(result.rewards.creditsRemainder).toBe(0);
  });

  it('fractions carry across claims: two 10-tick claims pay exactly 15 total', () => {
    const first = processRoamingClaim(claimRequest({ ticks: 10 }));
    expect(first.rewards.creditsAwarded).toBe(7);
    expect(first.rewards.creditsRemainder).toBeCloseTo(0.5, 6);

    const second = processRoamingClaim(
      claimRequest({ ticks: 10, tickCount: 2010, creditsRemainder: first.rewards.creditsRemainder }),
    );
    expect(second.rewards.creditsAwarded).toBe(8);
    expect(second.rewards.creditsRemainder).toBe(0);
    expect(first.rewards.creditsAwarded + second.rewards.creditsAwarded).toBe(15);
  });

  it('offline-earnings multipliers apply to the unrounded rate', () => {
    // 0.75 x (1 + 1.0 skill offlineEarnings) = 1.5/tick; 10 ticks = 15.
    const result = processRoamingClaim(
      claimRequest({ ticks: 10, skillBonuses: { offlineEarnings: 1 } }),
    );
    expect(result.rewards.creditsAwarded).toBe(15);
    expect(result.rewards.creditsRemainder).toBe(0);
  });
});

describe('fractional XP — processRoamingClaim', () => {
  it('an XP multiplier no longer rounds away the fraction', () => {
    // Base 1.0 XP/tick x 1.25 (skill xpBoostMod) = 1.25/tick;
    // 10 ticks = 12.5 -> pay 12, bank 0.5. Old math: round(1.25) = 1
    // per tick after the multiplier stack — 10 total.
    const result = processRoamingClaim(
      claimRequest({ ticks: 10, skillBonuses: { xpBoostMod: 0.25 } }),
    );
    expect(result.rewards.xpAwarded).toBe(12);
    expect(result.rewards.xpRemainder).toBeCloseTo(0.5, 6);
  });

  it('banked XP crosses the line on the next claim', () => {
    const result = processRoamingClaim(
      claimRequest({ ticks: 2, xpRemainder: 0.5, skillBonuses: { xpBoostMod: 0.25 } }),
    );
    // 0.5 + 2 x 1.25 = 3.0 -> pay 3, bank 0.
    expect(result.rewards.xpAwarded).toBe(3);
    expect(result.rewards.xpRemainder).toBe(0);
  });
});

describe('fractional credits/XP — profile bank persistence (in-memory store)', () => {
  it('applyChefRewards persists both banks; reads return them; omitting leaves them untouched', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: PLAYER });

    await store.applyChefRewards(
      PLAYER,
      { credits: 7, creditsRemainder: 0.5, scrap: 1, scrapRemainder: 0.25, xp: 12, xpRemainder: 0.5, fragments: 0, materials: {}, essences: {}, kills: 0 },
      2000,
      'dustwaste_frontier',
    );
    const roaming = await store.getRoamingProfile(PLAYER);
    expect(roaming?.credits_remainder).toBe(0.5);
    expect(roaming?.xp_remainder).toBe(0.5);
    expect(roaming?.scrap_remainder).toBe(0.25);

    await store.applyChefRewards(
      PLAYER,
      { credits: 8, scrap: 2, xp: 3, fragments: 0, materials: {}, essences: {}, kills: 0 },
      2010,
      'dustwaste_frontier',
    );
    const still = await store.getRoamingProfile(PLAYER);
    expect(still?.credits_remainder).toBe(0.5);
    expect(still?.xp_remainder).toBe(0.5);

    const settlement = await store.getSettlementProfile(PLAYER);
    expect(settlement?.credits_remainder).toBe(0.5);
    expect(settlement?.xp_remainder).toBe(0.5);
  });
});
