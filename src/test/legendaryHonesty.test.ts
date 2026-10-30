/**
 * Legendary Honesty — the four effects that were dead behind unread
 * return fields (second_opinion, salvage_rights, market_crash, jackpot)
 * now fire in the authoritative paths, and the sim-proxy tier is
 * labelled rather than implied.
 *
 * Before/after for each effect:
 *  - second_opinion: applyLegendaryEffects set extraLootChance = 0.5,
 *    a field no caller read; boss loot was unchanged. Now the Chef boss
 *    path rolls the guaranteed loot twice, keeps the stronger weapon
 *    and credits the twin's scrap through cc_apply_chef_boss_attempt.
 *  - salvage_rights: set scrapMult = 1.5, read nowhere; roaming scrap
 *    ignored the equipped weapon. Now processRoamingClaim multiplies
 *    claim scrap by 1.5 while the weapon is primary.
 *  - market_crash: set scrapMult = 4.0 (same dead field) and the market
 *    fee it referenced does not exist. Now cc_recycle_item (0008) and
 *    its TS mirrors award 4x scrap on recycle; the fee clause was
 *    removed from the effect description.
 *  - jackpot: the case body was a comment. Now every 150th kill-cycle
 *    kill with the weapon as primary awards a Cache Key fragment in
 *    the Chef roaming claim.
 */
import { describe, expect, it, vi } from 'vitest';

// Raise the scrap rate for this file only (every other area field is
// the real one) so the multiplier stack can be asserted with exact
// numbers. (At the real rates of 3-5/min the per-tick fraction is
// 0.15-0.25; fractional accumulation itself is covered end-to-end by
// scrapFractional.test.ts.)
vi.mock('../constants/roamingAreas', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../constants/roamingAreas')>();
  return {
    ...orig,
    getRoamingArea: (id: string) => ({ ...orig.getRoamingArea(id), idleScrapPerMinute: 60 }),
  };
});

import { processBossAttempt, processRoamingClaim, type BossAttemptRequest, type ClaimRequest } from '../server/chef';
import {
  applyLegendaryEffects,
  getSalvageRightsScrapMult,
  hasJackpot,
  hasSecondOpinion,
} from '../lib/legendaryEffects';
import { calculateSalvageYield } from '../constants/salvageRules';
import { REGION_1_BOSSES } from '../constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import type { ChefBossAttemptInput } from '../server/gameplay/store';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, salvageScrap, type WriteItemData } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'honesty-fixture-weapon',
    name: 'Honesty Fixture',
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

const PLAYER = '11111111-1111-4111-8111-111111111111';

function claimRequest(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    playerId: PLAYER,
    areaId: 'dustwaste_frontier',
    ticks: 5,
    tickCount: 100,
    playerLevel: 10,
    survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
    ...overrides,
  };
}

function bossRequest(overrides: Partial<BossAttemptRequest> = {}): BossAttemptRequest {
  return {
    playerId: PLAYER,
    bossId: REGION_1_BOSSES[0].id,
    attemptNonce: 1,
    primary: makeWeapon(),
    secondary: null,
    heavy: null,
    ordnance: null,
    shield: null,
    classMod: null,
    relic: null,
    consumables: {},
    risk: RiskSetting.Balanced,
    playerLevel: 50,
    playerCredits: 10000,
    pityCount: 0,
    skillBonuses: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// applyLegendaryEffects — dead fields gone, wired outputs unchanged
// ---------------------------------------------------------------------------

describe('applyLegendaryEffects — honest return shape', () => {
  it('no longer returns the dead scrapMult / extraLootChance / consumableRefundChance fields', () => {
    for (const id of ['second_opinion', 'salvage_rights', 'market_crash', 'jackpot', 'insurance_fraud_weapon']) {
      const result = applyLegendaryEffects(makeWeapon({ legendaryEffectId: id }));
      expect(result).not.toHaveProperty('scrapMult');
      expect(result).not.toHaveProperty('extraLootChance');
      expect(result).not.toHaveProperty('consumableRefundChance');
      // None of the four formerly-dead effects (or insurance fraud,
      // which lives in its helper) produce sim multipliers.
      expect(result).toEqual({
        damageMult: 1,
        survivalMult: 1,
        shieldBreakMult: 1,
        armorBreakMult: 1,
        creditMult: 1,
      });
    }
  });

  it('wired and proxy outputs are unchanged (regression)', () => {
    expect(applyLegendaryEffects(makeWeapon({ legendaryEffectId: 'glass_sun', element: Element.Fire }))).toMatchObject({
      damageMult: 1.5,
      survivalMult: 0.7,
    });
    expect(applyLegendaryEffects(makeWeapon({ legendaryEffectId: 'overclocked' })).damageMult).toBe(1.15);
    expect(applyLegendaryEffects(makeWeapon({ legendaryEffectId: 'kickback' })).damageMult).toBeCloseTo(1 + 2 / 7, 10);
    expect(applyLegendaryEffects(makeWeapon({ legendaryEffectId: 'bad_decision' })).creditMult).toBe(1.25);
    expect(applyLegendaryEffects(makeWeapon({ legendaryEffectId: 'vampiric_ledger' })).creditMult).toBe(1.05);
    expect(applyLegendaryEffects(makeWeapon({ legendaryEffectId: 'void_bargain', element: Element.Void }))).toMatchObject({
      damageMult: 1.4,
      survivalMult: 0.85,
    });
    expect(applyLegendaryEffects(makeWeapon({ legendaryEffectId: 'the_accountant' }), 0, 250).damageMult).toBeCloseTo(1.06, 10);
    expect(applyLegendaryEffects(makeWeapon({ legendaryEffectId: 'warranty_void' }), 5).damageMult).toBeCloseTo(1.1, 10);
  });

  it('helpers identify the Chef-implemented effects', () => {
    expect(getSalvageRightsScrapMult(makeWeapon({ legendaryEffectId: 'salvage_rights' }))).toBe(1.5);
    expect(getSalvageRightsScrapMult(makeWeapon({ legendaryEffectId: 'jackpot' }))).toBe(1);
    expect(getSalvageRightsScrapMult(null)).toBe(1);
    expect(hasSecondOpinion(makeWeapon({ legendaryEffectId: 'second_opinion' }))).toBe(true);
    expect(hasSecondOpinion(makeWeapon())).toBe(false);
    expect(hasJackpot(makeWeapon({ legendaryEffectId: 'jackpot' }))).toBe(true);
    expect(hasJackpot(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Salvage Rights — Chef roaming claim scrap
// ---------------------------------------------------------------------------

describe('Salvage Rights — processRoamingClaim', () => {
  it('multiplies claim scrap by exactly 1.5 while the weapon is primary', () => {
    // Mocked area rate: 60/min = 3 scrap/tick, no other scrap
    // modifiers in play. Baseline: 3 x 5 ticks = 15, nothing banked.
    // With Salvage Rights: 4.5/tick x 5 = 22.5 — 22 paid, 0.5 banked
    // (fractional accumulation, migration 0009; the old per-tick
    // Math.round(4.5) = 5 would have paid 25 and invented the rest).
    const baseline = processRoamingClaim(claimRequest({ equippedGear: [makeWeapon()] }));
    const withEffect = processRoamingClaim(
      claimRequest({ equippedGear: [makeWeapon({ legendaryEffectId: 'salvage_rights' })] }),
    );
    expect(baseline.rewards.scrapAwarded).toBe(15);
    expect(baseline.rewards.scrapRemainder).toBe(0);
    expect(withEffect.rewards.scrapAwarded).toBe(22);
    expect(withEffect.rewards.scrapRemainder).toBe(0.5);
    // Only scrap moved — credits/XP come from untouched stacks.
    expect(withEffect.rewards.creditsAwarded).toBe(baseline.rewards.creditsAwarded);
    expect(withEffect.rewards.xpAwarded).toBe(baseline.rewards.xpAwarded);
  });

  it('does not fire when the Salvage Rights weapon is not the one equipped', () => {
    const noWeapon = processRoamingClaim(claimRequest({ equippedGear: [] }));
    expect(noWeapon.rewards.scrapAwarded).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Jackpot — Chef roaming claim kill cycle
// ---------------------------------------------------------------------------

describe('Jackpot — processRoamingClaim', () => {
  const killCycleAt149 = {
    currentTargetId: null,
    currentTargetHp: 0,
    currentTargetHpMax: 0,
    monstersKilledCount: 0,
    totalKills: 149,
    lastKilledMonsterId: null,
  };

  it('awards exactly one extra Cache Key fragment on the 150th kill', () => {
    // The fixture weapon one-shots tier-1 monsters: 20 ticks advance
    // the kill cycle well past 150 in both runs, crossing the 150th
    // kill exactly once. Loot-roll fragment drops are seeded per tick
    // and identical across the pair, so the difference isolates Jackpot.
    const baseline = processRoamingClaim(
      claimRequest({ ticks: 20, tickCount: 5000, equippedGear: [makeWeapon()], killCycle: killCycleAt149 }),
    );
    const withJackpot = processRoamingClaim(
      claimRequest({
        ticks: 20,
        tickCount: 5000,
        equippedGear: [makeWeapon({ legendaryEffectId: 'jackpot' })],
        killCycle: killCycleAt149,
      }),
    );
    expect(baseline.killCycle.totalKills).toBeGreaterThan(150);
    expect(withJackpot.killCycle.totalKills).toBe(baseline.killCycle.totalKills);
    expect(withJackpot.rewards.cacheFragmentsAwarded - baseline.rewards.cacheFragmentsAwarded).toBe(1);
    const jackpotEvent = (withJackpot.feedEvents as Array<{ detail?: string }>).find((e) =>
      (e.detail ?? '').includes('Jackpot'),
    );
    expect(jackpotEvent).toBeDefined();
  });

  it('does not fire before the 150th kill', () => {
    const result = processRoamingClaim(
      claimRequest({
        ticks: 5,
        tickCount: 6000,
        equippedGear: [makeWeapon({ legendaryEffectId: 'jackpot' })],
        killCycle: { ...killCycleAt149, totalKills: 100 },
      }),
    );
    const jackpotEvent = (result.feedEvents as Array<{ detail?: string }>).find((e) =>
      (e.detail ?? '').includes('Jackpot'),
    );
    expect(jackpotEvent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Second Opinion — Chef boss path
// ---------------------------------------------------------------------------

describe('Second Opinion — processBossAttempt', () => {
  function findNonce(weapon: Weapon, wantVictory: boolean, bossId = REGION_1_BOSSES[0].id): number {
    for (let nonce = 1; nonce <= 500; nonce++) {
      const r = processBossAttempt(bossRequest({ primary: weapon, attemptNonce: nonce, bossId }));
      if (r.result.victory === wantVictory) return nonce;
    }
    throw new Error('no suitable nonce found');
  }

  it('on victory: keeps the stronger twin, auto-scraps the other for real scrap', () => {
    const boss = REGION_1_BOSSES[0];
    const plain = makeWeapon();
    const nonce = findNonce(plain, true, boss.id);
    const baseline = processBossAttempt(bossRequest({ primary: plain, attemptNonce: nonce, bossId: boss.id }));
    expect(baseline.result.victory).toBe(true);
    expect(baseline.scrapAwarded).toBe(0);
    expect(baseline.secondOpinionScrap).toBeNull();

    const withEffect = processBossAttempt(
      bossRequest({
        primary: makeWeapon({ legendaryEffectId: 'second_opinion' }),
        attemptNonce: nonce,
        bossId: boss.id,
      }),
    );
    expect(withEffect.result.victory).toBe(true);
    // Same number of stored loot items — the twin was converted, not added.
    expect(withEffect.loot.length).toBe(baseline.loot.length);
    expect(withEffect.secondOpinionScrap).not.toBeNull();
    expect(withEffect.scrapAwarded).toBeGreaterThan(0);
    // The scrap credit is the standard salvage rate for the discarded
    // twin (boss loot rolls at boss level).
    expect(withEffect.scrapAwarded).toBe(
      salvageScrap(withEffect.secondOpinionScrap!.rarity, boss.level),
    );
    expect(withEffect.secondOpinionScrap!.scrapAwarded).toBe(withEffect.scrapAwarded);
    // The kept guaranteed roll is at least as strong as the scrapped twin.
    const kept = withEffect.loot[0] as Weapon;
    expect(kept.combatPower).toBeGreaterThanOrEqual(withEffect.secondOpinionScrap!.combatPower);
  });

  it('on defeat: no loot, no scrap, no Second Opinion output', () => {
    const lastBoss = REGION_1_BOSSES[REGION_1_BOSSES.length - 1];
    const weak = makeWeapon({
      legendaryEffectId: 'second_opinion',
      level: 1,
      baseDamage: 5,
      attackSpeed: 1,
      critChance: 0,
      bossDamageMod: 0,
      shieldDamageMod: 0,
      armorDamageMod: 0,
    });
    const nonce = findNonce(weak, false, lastBoss.id);
    const result = processBossAttempt(
      bossRequest({ primary: weak, attemptNonce: nonce, bossId: lastBoss.id, playerLevel: 1 }),
    );
    expect(result.result.victory).toBe(false);
    expect(result.scrapAwarded).toBe(0);
    expect(result.secondOpinionScrap).toBeNull();
    expect(result.loot).toHaveLength(0);
  });

  it('the boss applier store applies the scrap delta exactly once per nonce', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: PLAYER, scrap: 10 });
    const attempt: ChefBossAttemptInput = {
      bossId: REGION_1_BOSSES[0].id,
      attemptNonce: 777,
      victory: true,
      creditsDelta: 0,
      xp: 0,
      consumables: {},
      attempt: {},
      unlockedBossId: null,
      scrap: 88,
    };
    const first = await store.applyChefBossAttempt(PLAYER, attempt);
    expect((first as { scrap_awarded?: number }).scrap_awarded).toBe(88);
    expect(store.profiles.get(PLAYER)!.scrap).toBe(98);
    await store.applyChefBossAttempt(PLAYER, attempt);
    expect(store.profiles.get(PLAYER)!.scrap).toBe(98);
  });
});

// ---------------------------------------------------------------------------
// Market Crash — recycle award in both TS mirrors + the inspect preview
// ---------------------------------------------------------------------------

describe('Market Crash — 4x recycle scrap', () => {
  it('gameplay store mirror: 4x for a Market Crash weapon, 1x otherwise', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: PLAYER, scrap: 0 });
    store.seedItem({
      id: 'crash-item',
      owner_user_id: PLAYER,
      rarity: 'Legendary',
      item_level: 10,
      payload: { legendaryEffectId: 'market_crash' },
    });
    store.seedItem({
      id: 'plain-item',
      owner_user_id: PLAYER,
      rarity: 'Legendary',
      item_level: 10,
      payload: {},
    });
    const base = salvageScrap('Legendary', 10); // round((10 + 10*5) * 8) = 480
    expect(base).toBe(480);
    const crash = await store.recycleItem(PLAYER, 'nonce-crash-0001', 'crash-item');
    expect((crash as { scrap_award?: number }).scrap_award).toBe(base * 4);
    const plain = await store.recycleItem(PLAYER, 'nonce-plain-0001', 'plain-item');
    expect((plain as { scrap_award?: number }).scrap_award).toBe(base);
    expect(store.profiles.get(PLAYER)!.scrap).toBe(base * 5);
  });

  it('write store mirror: 4x for a Market Crash weapon', async () => {
    const seed = emptyWriteSeed();
    const profile: ProfileRowData = {
      id: PLAYER,
      username: 'honesty',
      display_name: null,
      player_level: 5,
      player_xp: 0,
      credits: 0,
      scrap: 0,
      cache_tokens: 0,
      cache_token_parts: 0,
      materials: {},
      essences: {},
      consumables: {},
      skill_spends: {},
      boss_state: {},
      last_idle_claim_at: '2026-10-29T10:00:00.000Z',
      last_claimed_tick: 0,
      created_at: '2026-06-14T00:00:00.000Z',
      updated_at: '2026-10-28T00:00:00.000Z',
      account_type: 'verified',
      email: null,
      email_verified_at: '2026-06-14T00:00:00.000Z',
      verification_grace_expires_at: null,
      verification_reminder_last_seen_at: null,
      last_roaming_settled_at: null,
      last_settlement_nonce: null,
      offline_cap_hours: 2,
      username_updated_at: null,
      username_change_count: 0,
    };
    const item: WriteItemData = {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      owner_user_id: PLAYER,
      kind: 'weapon',
      static_item_id: null,
      item_level: 10,
      rarity: 'Legendary',
      quality: null,
      material_tier: null,
      condition_state: null,
      condition_current: 40,
      condition_max: 50,
      supply_mode: 'verified_action',
      source_id: null,
      creator_user_id: null,
      tradeable: true,
      account_bound: false,
      locked_until: null,
      payload: { weaponType: 'Pistol', legendaryEffectId: 'market_crash' },
      runtime_state: 'available',
      is_locked: false,
      equipped_slot: null,
      estimated_value: 500,
      created_at: '2026-10-01T00:00:00.000Z',
      updated_at: '2026-10-01T00:00:00.000Z',
    };
    seed.profiles = [profile];
    seed.items = [item];
    const store = new InMemoryWriteStore(seed);
    const result = await store.recycleItem(PLAYER, 'nonce-crash-0002', item.id);
    expect((result as { scrap_award?: number }).scrap_award).toBe(salvageScrap('Legendary', 10) * 4);
  });

  it('inspect preview (calculateSalvageYield) shows the same 4x on scrap', () => {
    const plain = calculateSalvageYield(makeWeapon());
    const crash = calculateSalvageYield(makeWeapon({ legendaryEffectId: 'market_crash' }));
    expect(crash.scrapAlloy).toBe(plain.scrapAlloy * 4);
    expect(crash.scrapValue).toBe(crash.scrapAlloy);
    // Materials/essences are not part of the effect.
    expect(crash.ballisticParts).toBe(plain.ballisticParts);
    expect(crash.techFragments).toBe(plain.techFragments);
  });
});
