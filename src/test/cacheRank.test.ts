/**
 * Cache Rank (migration 0031) — a Badass-rank analogue: tokens come
 * from LEVELS (server-derived, exactly-once via a watermark + grant
 * ledger), spent on tiny permanent bonuses across seven tracks.
 *
 * Laws under test:
 *  - EARNING: entitlement(L) = (L-1) x perLevel + milestone bundles
 *    (10/25/50/75/100 -> +5/+10/+15/+20/+25 at defaults); L100 total
 *    = 174. Grants derive ONLY from the server's level record: every
 *    XP path (roaming claim, boss attempt, offline settlement) pays
 *    the entitlement difference exactly once; a pre-existing profile
 *    is paid retroactively ONCE (watermark starts at 0).
 *  - SPENDING: cost ladder 1,1,2,2,3,3,4,4,5,5 (30/track, 210 for
 *    the full menu > 174 earnable); cap 10/track; insufficient
 *    balance / maxed / unknown track refuse; nonce replays never
 *    double-charge. NO respec exists (deliberate non-goal).
 *  - CONSUMERS: every track is measured in its real engine — Chef
 *    claim rates (multiplied last), boss attempt XP/credits, the
 *    boss sim seam (damage + max HP), the mechanics snapshot, the
 *    cache draw (this wires the dead #216 `cacheQuality` skill
 *    effect into the same lane), craft-engine XP, and the market
 *    proceeds composition (fee destroyed first, Darknet reduction,
 *    then the Silver Tongue uplift on POST-FEE proceeds, minted;
 *    NPC listings exempt).
 *  - REGISTRY: CACHE_RANK_BONUS_CONSUMERS keys == the content def
 *    ids, and every consumer needle still appears in its engine
 *    file (TS + SQL twins) — a dead bonus fails here.
 *  - ADVERSARIAL: forged level/token/spend fields in request bodies
 *    change nothing; grants and spends resolve from server records
 *    under the JWT identity only.
 *  - LEVERS: the 12 cache-rank levers are economy-config keys with
 *    code defaults pinned to the content defaults and hard clamps.
 *
 * The SQL twin is exercised against real Postgres in the slice
 * harness (0031: trigger, RPCs, restated consumers, metrics fold);
 * its shapes are pinned textually below.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Rarity, RiskSetting } from '@/types/game';
import {
  CACHE_RANK_BONUS_DEFS,
  CACHE_RANK_BONUS_IDS,
  CACHE_RANK_LEVER_CLAMPS,
  CACHE_RANK_LEVER_DEFAULTS,
  CACHE_RANK_MILESTONE_LEVELS,
  cacheRankBonuses,
  cacheRankCostForRank,
  cacheRankEntitlement,
  cacheRankMilestoneBundle,
  cacheRankStateView,
  cacheRankTrackCost,
  cacheQualityAdjustedWeights,
  formatCacheRankPct,
  resolveCacheRankLevers,
  sanitizeCacheRankSpends,
} from '@/content/cacheRank';
import { xpToNextLevel } from '@/content/simulation';
import { CACHE_RANK_BONUS_CONSUMERS, SKILL_EFFECT_CONSUMERS } from '@/lib/skills/skillConsumers';
import { simulateBoss } from '@/lib/simulation/bossSimulator';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { computeHunterMaxHp } from '@/lib/combat/damageContract';
import { marketFeeForPrice, marketFeeForSeller } from '@/lib/market/marketFee';
import type { PlayerProfile } from '@/types/player';
import { ECONOMY_CONFIG_DEFAULTS, ECONOMY_CONFIG_KEYS, validateEconomyConfigValue } from '../server/economy/config';
import { InMemoryEconomyStore } from '../server/economy/memory';
import { processBossAttempt, processRoamingClaim, type BossAttemptRequest, type ClaimRequest } from '../server/chef';
import { createTickRng } from '@/lib/rng/tickRng';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { generateShield } from '../server/lib/generators/shieldGenerator';
import { generateClassMod } from '../server/lib/generators/classModGenerator';
import { generateOrdnance } from '../server/lib/generators/ordnanceGenerator';
import { generateRelic } from '../server/lib/generators/relicGenerator';
import { mountCacheRankRoutes, mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type ProfileRowData, type WriteSeed } from '../server/writes/store';
import { SKILL_NODES } from '@/constants/skillTrees';
import type { SkillNodeData } from '../server/writes/store';
import {
  enqueueCraftJob as enqueueCraftJobCore,
  settleCraftJobs as settleCraftJobsCore,
  type CraftAdapter,
  type CraftJobRecord,
  type CraftLeverValues,
  type CraftProfileView,
} from '../server/writes/craftEngine';
import { computeSkillBonuses } from '@/lib/skills/skillBonuses';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 1. Content: entitlement, bundles, costs, bonus resolution
// ---------------------------------------------------------------------------

describe('cache rank content math', () => {
  it('entitlement: 1/level + milestone bundles; L100 total is 174', () => {
    const L = CACHE_RANK_LEVER_DEFAULTS;
    expect(cacheRankEntitlement(1, L)).toBe(0);
    expect(cacheRankEntitlement(2, L)).toBe(1);
    expect(cacheRankEntitlement(9, L)).toBe(8);
    expect(cacheRankEntitlement(10, L)).toBe(14); // 9 + 5 bundle
    expect(cacheRankEntitlement(24, L)).toBe(28);
    expect(cacheRankEntitlement(25, L)).toBe(39); // 24 + 5 + 10
    expect(cacheRankEntitlement(50, L)).toBe(79);
    expect(cacheRankEntitlement(75, L)).toBe(124);
    expect(cacheRankEntitlement(99, L)).toBe(148);
    expect(cacheRankEntitlement(100, L)).toBe(174);
    expect([...CACHE_RANK_MILESTONE_LEVELS]).toEqual([10, 25, 50, 75, 100]);
    expect(CACHE_RANK_MILESTONE_LEVELS.map((m) => cacheRankMilestoneBundle(m, L)))
      .toEqual([5, 10, 15, 20, 25]);
    expect(cacheRankMilestoneBundle(11, L)).toBe(0);
  });

  it('costs rise per rank pair: 1,1,2,2,3,3,4,4,5,5 — 30/track, 210 menu > 174 earnable', () => {
    const L = CACHE_RANK_LEVER_DEFAULTS;
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => cacheRankCostForRank(r, L)))
      .toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
    expect(cacheRankTrackCost(10, L)).toBe(30);
    expect(cacheRankTrackCost(10, L) * CACHE_RANK_BONUS_DEFS.length).toBe(210);
    expect(cacheRankTrackCost(10, L) * CACHE_RANK_BONUS_DEFS.length)
      .toBeGreaterThan(cacheRankEntitlement(100, L));
  });

  it('the menu: seven tracks, cap 10, per-rank effects in the tiny band, all-maxed totals modest', () => {
    expect(CACHE_RANK_BONUS_IDS).toEqual(
      ['credits', 'xp', 'scrap', 'damage', 'maxHp', 'cacheQuality', 'marketProceeds']);
    for (const def of CACHE_RANK_BONUS_DEFS) {
      expect(def.maxRanks).toBe(10);
      expect(def.name.length).toBeGreaterThan(0);
    }
    const maxed = cacheRankBonuses(Object.fromEntries(CACHE_RANK_BONUS_IDS.map((id) => [id, 10])));
    expect(maxed.credits).toBeCloseTo(0.10, 10);
    expect(maxed.xp).toBeCloseTo(0.10, 10);
    expect(maxed.scrap).toBeCloseTo(0.10, 10);
    expect(maxed.damage).toBeCloseTo(0.05, 10);
    expect(maxed.maxHp).toBeCloseTo(0.10, 10);
    expect(maxed.cacheQuality).toBeCloseTo(0.20, 10);
    expect(maxed.marketProceeds).toBeCloseTo(0.05, 10);
    const one = cacheRankBonuses({ credits: 1, damage: 1, cacheQuality: 1, marketProceeds: 1 });
    expect(one.credits).toBeCloseTo(0.01, 10);
    expect(one.damage).toBeCloseTo(0.005, 10);
    expect(one.cacheQuality).toBeCloseTo(0.02, 10);
    expect(one.marketProceeds).toBeCloseTo(0.005, 10);
    expect(formatCacheRankPct(0.005)).toBe('+0.5%');
    expect(formatCacheRankPct(0.1)).toBe('+10%');
  });

  it('sanitizeCacheRankSpends clamps to caps, floors fractions, drops unknown keys and junk', () => {
    const clean = sanitizeCacheRankSpends({ credits: 99, xp: 3.9, warp: 5, scrap: -2, damage: 'x' });
    expect(clean.credits).toBe(10);
    expect(clean.xp).toBe(3);
    expect(clean.scrap).toBe(0);
    expect(clean.damage).toBe(0);
    expect(Object.keys(clean).sort()).toEqual([...CACHE_RANK_BONUS_IDS].sort());
    expect(sanitizeCacheRankSpends(null).credits).toBe(0);
    expect(sanitizeCacheRankSpends(undefined).xp).toBe(0);
  });

  it('cacheQualityAdjustedWeights scales only the non-minimum tiers', () => {
    const outcomes = [
      { outcome: 'Common', weight: 70 },
      { outcome: 'Rare', weight: 30 },
      { outcome: 'Epic', weight: 10 },
    ];
    const adjusted = cacheQualityAdjustedWeights(outcomes, 0.5);
    expect(adjusted.find((o) => o.outcome === 'Common')!.weight).toBe(70);
    expect(adjusted.find((o) => o.outcome === 'Rare')!.weight).toBeCloseTo(45, 10);
    expect(adjusted.find((o) => o.outcome === 'Epic')!.weight).toBeCloseTo(15, 10);
    expect(cacheQualityAdjustedWeights(outcomes, 0)).toEqual(outcomes);
  });

  it('state view: next-token progress + milestone claim states derive from level and watermark', () => {
    const view = cacheRankStateView({
      level: 10, playerXp: 40, tokens: 14, grantLevel: 10,
      spends: { credits: 2 },
    });
    expect(view.tokens).toBe(14);
    expect(view.nextTokenLevel).toBe(11);
    expect(view.xpIntoLevel).toBe(40);
    expect(view.xpForLevel).toBe(xpToNextLevel(10));
    expect(view.tracks.find((t) => t.id === 'credits')!.ranks).toBe(2);
    expect(view.tracks.find((t) => t.id === 'credits')!.nextCost).toBe(2);
    expect(view.milestones.find((m) => m.level === 10)!.claimed).toBe(true);
    expect(view.milestones.find((m) => m.level === 10)!.bundle).toBe(5);
    expect(view.milestones.find((m) => m.level === 25)!.claimed).toBe(false);
    expect(view.tokensEarned).toBe(cacheRankEntitlement(10, CACHE_RANK_LEVER_DEFAULTS));
  });
});

// ---------------------------------------------------------------------------
// 2. Levers: economy-config registration, defaults pinned, hard clamps
// ---------------------------------------------------------------------------

describe('cache rank levers', () => {
  const KEYS = [
    'cacheRankTokensPerLevel', 'cacheRankMilestoneBundleBase', 'cacheRankMilestoneBundleStep',
    'cacheRankCostBase', 'cacheRankCostGrowth', 'cacheRankCreditsPerRank', 'cacheRankXpPerRank',
    'cacheRankScrapPerRank', 'cacheRankDamagePerRank', 'cacheRankMaxHpPerRank',
    'cacheRankCacheQualityPerRank', 'cacheRankMarketProceedsPerRank',
  ] as const;

  it('all 12 levers are registered economy-config keys with defaults == content defaults', () => {
    for (const key of KEYS) {
      expect(ECONOMY_CONFIG_KEYS[key], key).toBeDefined();
      expect(ECONOMY_CONFIG_DEFAULTS[key], key).toBe(CACHE_RANK_LEVER_DEFAULTS[key]);
      expect(ECONOMY_CONFIG_KEYS[key].defaultOwner, key).toContain('cacheRank');
    }
  });

  it('resolveCacheRankLevers clamps out-of-range values into the hard bands', () => {
    const resolved = resolveCacheRankLevers({
      cacheRankTokensPerLevel: 99,
      cacheRankCostGrowth: -1,
      cacheRankCacheQualityPerRank: 5,
      cacheRankDamagePerRank: 0.007,
    });
    expect(resolved.cacheRankTokensPerLevel).toBe(CACHE_RANK_LEVER_CLAMPS.cacheRankTokensPerLevel.max);
    expect(resolved.cacheRankCostGrowth).toBe(CACHE_RANK_LEVER_CLAMPS.cacheRankCostGrowth.min);
    expect(resolved.cacheRankCacheQualityPerRank).toBe(CACHE_RANK_LEVER_CLAMPS.cacheRankCacheQualityPerRank.max);
    expect(resolved.cacheRankDamagePerRank).toBeCloseTo(0.007, 10);
    expect(resolved.cacheRankXpPerRank).toBe(CACHE_RANK_LEVER_DEFAULTS.cacheRankXpPerRank);
    // Integer levers floor.
    expect(resolveCacheRankLevers({ cacheRankTokensPerLevel: 2.9 }).cacheRankTokensPerLevel).toBe(2);
  });

  it('validateEconomyConfigValue enforces the registered ranges server-side', () => {
    expect(validateEconomyConfigValue('cacheRankTokensPerLevel', 2)).toBe(2);
    expect(validateEconomyConfigValue('cacheRankTokensPerLevel', 4)).toBeNull();
    expect(validateEconomyConfigValue('cacheRankCostBase', 0)).toBeNull();
    expect(validateEconomyConfigValue('cacheRankMarketProceedsPerRank', 0.01)).toBe(0.01);
    expect(validateEconomyConfigValue('cacheRankMarketProceedsPerRank', 0.5)).toBeNull();
  });

  it('a lever raise never re-pays old levels: entitlement is watermark-relative', () => {
    // Player granted through L50 at defaults (79). Raise perLevel to 3:
    // the next grant pays entitlement_new(51) - entitlement_new(50),
    // NOT a recomputed lifetime total.
    const raised = resolveCacheRankLevers({ cacheRankTokensPerLevel: 3 });
    const delta = cacheRankEntitlement(51, raised) - cacheRankEntitlement(50, raised);
    expect(delta).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 3. Registry discipline + SQL textual pins
// ---------------------------------------------------------------------------

describe('cache rank consumer registry', () => {
  const root = process.cwd();
  const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

  it('registry keys are exactly the content def ids', () => {
    expect(Object.keys(CACHE_RANK_BONUS_CONSUMERS).sort()).toEqual([...CACHE_RANK_BONUS_IDS].sort());
  });

  it('every registered consumer needle still appears in its engine file', () => {
    for (const [bonusId, consumers] of Object.entries(CACHE_RANK_BONUS_CONSUMERS)) {
      expect(consumers.length, bonusId).toBeGreaterThan(0);
      for (const consumer of consumers) {
        expect(read(consumer.file).includes(consumer.needle),
          `${bonusId}: needle "${consumer.needle}" missing from ${consumer.file}`).toBe(true);
      }
    }
  });

  it('the #216 cacheQuality skill effect now has registered consumers in both twins', () => {
    const consumers = SKILL_EFFECT_CONSUMERS.cacheQuality;
    expect(consumers).toBeDefined();
    expect(consumers.length).toBeGreaterThanOrEqual(3);
    for (const consumer of consumers) {
      expect(read(consumer.file).includes(consumer.needle),
        `cacheQuality needle "${consumer.needle}" missing from ${consumer.file}`).toBe(true);
    }
  });
});

describe('migration 0031 textual pins', () => {
  const sql = readFileSync(join(process.cwd(), 'db/migrations/0031_cache_rank.sql'), 'utf8');

  it('seeds the seven bonus definitions in parity with the TS defs', () => {
    for (const def of CACHE_RANK_BONUS_DEFS) {
      expect(sql).toContain(`('${def.id}', '${def.name}', ${def.maxRanks})`);
    }
    expect(sql).toContain('cache_rank_bonus_definitions');
  });

  it('carries the grant machinery: trigger, observation RPC, spend RPC, ledger keys', () => {
    expect(sql).toContain('trg_profiles_cache_rank_grant');
    expect(sql).toContain('before update of player_level');
    expect(sql).toContain('cc_grant_cache_rank_tokens');
    expect(sql).toContain('cc_spend_cache_rank');
    expect(sql).toContain("'cache-rank-grant:'");
    expect(sql).toContain('cc_cache_rank_grant');
    expect(sql).toContain('cc_cache_rank_spend');
  });

  it('restates the consumers and adds the token meters', () => {
    expect(sql).toContain('cc_cache_rank_bonus_fraction');
    expect(sql).toContain('cache_rank_tokens_granted');
    expect(sql).toContain('cache_rank_tokens_spent');
    expect(sql).toContain('cache_rank_proceeds_bonus');
    expect(sql).toContain('cache_quality');
  });
});

// ---------------------------------------------------------------------------
// 4. Grants: every XP path pays the entitlement difference exactly once
// ---------------------------------------------------------------------------

describe('cache rank grants — in-memory gameplay store (the trigger twin)', () => {
  const rewards = (xp: number) => ({
    credits: 0, scrap: 0, xp, fragments: 0,
    materials: {} as Json, essences: {} as Json, kills: 0,
  });

  it('retroactive: a pre-existing L50 profile is paid exactly 79 once, never again', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 50 });
    const first = await store.grantCacheRankTokens(A) as Json;
    expect(first.granted).toBe(79);
    expect(first.tokens).toBe(79);
    expect(first.grant_level).toBe(50);
    expect(store.cacheRankGrantLog).toEqual([
      { playerId: A, fromLevel: 0, toLevel: 50, tokens: 79 },
    ]);
    const second = await store.grantCacheRankTokens(A) as Json;
    expect(second.granted).toBe(0);
    expect(store.cacheRankGrantLog).toHaveLength(1);
    const facts = await store.getCacheRankFacts(A);
    expect(facts?.cache_rank_tokens).toBe(79);
  });

  it('roaming claim: crossing 9 -> 10 pays 6 (level + milestone bundle), once', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 9, player_xp: xpToNextLevel(9) - 5 });
    await store.grantCacheRankTokens(A); // watermark sync: pays 8 for levels 2..9
    expect(store.cacheRankGrantLog).toEqual([
      { playerId: A, fromLevel: 0, toLevel: 9, tokens: 8 },
    ]);
    await store.applyChefRewards(A, rewards(5));
    const profile = store.profiles.get(A)!;
    expect(profile.player_level).toBe(10);
    expect(store.cacheRankGrantLog).toEqual([
      { playerId: A, fromLevel: 0, toLevel: 9, tokens: 8 },
      { playerId: A, fromLevel: 9, toLevel: 10, tokens: 6 },
    ]);
    expect(profile.cache_rank_tokens).toBe(14);
    // Further claims without a level change grant nothing.
    await store.applyChefRewards(A, rewards(0));
    expect(store.cacheRankGrantLog).toHaveLength(2);
  });

  it('boss attempt: crossing 24 -> 25 pays 11; a nonce replay never re-grants', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({
      id: A, player_level: 24, player_xp: xpToNextLevel(24) - 5, credits: 10_000,
    });
    await store.grantCacheRankTokens(A);
    const attempt = {
      bossId: 'dune_tyrant', attemptNonce: 1, victory: true, creditsDelta: 100,
      xp: 5, consumables: {} as Json, attempt: {} as Json,
      unlockedBossId: null, scrap: 0, entryFee: 0,
    };
    await store.applyChefBossAttempt(A, attempt);
    expect(store.profiles.get(A)?.player_level).toBe(25);
    expect(store.cacheRankGrantLog.at(-1)).toEqual(
      { playerId: A, fromLevel: 24, toLevel: 25, tokens: 11 });
    expect(store.profiles.get(A)?.cache_rank_tokens).toBe(39);
    const replay = await store.applyChefBossAttempt(A, attempt) as Json;
    expect(replay.idempotent_replay).toBe(true);
    expect(store.cacheRankGrantLog.filter((g) => g.tokens === 11)).toHaveLength(1);
    expect(store.profiles.get(A)?.cache_rank_tokens).toBe(39);
  });

  it('offline settlement: the shared reward bundle grants once; replay is inert', async () => {
    const now = new Date('2026-10-31T12:00:00.000Z');
    const store = new InMemoryChefGameplayStore(() => now);
    store.seedProfile({
      id: A, player_level: 9, player_xp: 0,
      last_roaming_settled_at: '2026-10-31T11:00:00.000Z',
    });
    store.seedActiveAction({
      user_id: A, active_action: 'roaming_loot', target_id: null,
      started_at: '2026-10-31T11:00:00.000Z', last_heartbeat_at: null, activity_payload: {},
    });
    await store.grantCacheRankTokens(A);
    const settled = await store.settleOfflineRoaming(A, 'settle-nonce-0001', rewards(xpToNextLevel(9))) as Json;
    expect(settled.settled).not.toBe(false);
    expect(store.profiles.get(A)?.player_level).toBe(10);
    expect(store.cacheRankGrantLog.at(-1)).toEqual(
      { playerId: A, fromLevel: 9, toLevel: 10, tokens: 6 });
    const grantsBefore = store.cacheRankGrantLog.length;
    await store.settleOfflineRoaming(A, 'settle-nonce-0001', rewards(xpToNextLevel(9)));
    expect(store.cacheRankGrantLog).toHaveLength(grantsBefore);
    expect(store.profiles.get(A)?.cache_rank_tokens).toBe(14);
  });

  it('boundary 99 -> 100 pays 26 (level + the final bundle); L100 is the cap', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 99, player_xp: xpToNextLevel(99) - 1 });
    await store.grantCacheRankTokens(A);
    expect(store.profiles.get(A)?.cache_rank_tokens).toBe(148);
    await store.applyChefRewards(A, rewards(1));
    expect(store.profiles.get(A)?.player_level).toBe(100);
    expect(store.cacheRankGrantLog.at(-1)).toEqual(
      { playerId: A, fromLevel: 99, toLevel: 100, tokens: 26 });
    expect(store.profiles.get(A)?.cache_rank_tokens).toBe(174);
  });

  it('a levered store grants by its own levers (perLevel 3 via the injected provider)', async () => {
    const store = new InMemoryChefGameplayStore(() => new Date(), () => ({ cacheRankTokensPerLevel: 3 }));
    store.seedProfile({ id: A, player_level: 5 });
    const granted = await store.grantCacheRankTokens(A) as Json;
    expect(granted.granted).toBe(12); // (5 - 1) x 3, no milestones yet
  });
});

// ---------------------------------------------------------------------------
// 5. Spends: validation, ladder, idempotence (store level)
// ---------------------------------------------------------------------------

describe('cache rank spends — in-memory gameplay store', () => {
  async function richStore() {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 100, credits: 0 });
    await store.grantCacheRankTokens(A);
    return store;
  }
  let nonceN = 0;
  const spendNonce = () => `spend-nonce-${String(++nonceN).padStart(4, '0')}-xx`;

  it('buys ranks at ladder costs and records the spend log', async () => {
    const store = await richStore();
    const first = await store.spendCacheRankBonus(A, spendNonce(), 'credits') as Json;
    expect(first.cost).toBe(1);
    expect(first.rank_after).toBe(1);
    expect(first.tokens).toBe(173);
    const second = await store.spendCacheRankBonus(A, spendNonce(), 'credits') as Json;
    expect(second.cost).toBe(1);
    const third = await store.spendCacheRankBonus(A, spendNonce(), 'credits') as Json;
    expect(third.cost).toBe(2);
    expect(store.cacheRankSpendLog.map((s) => s.cost)).toEqual([1, 1, 2]);
    expect(store.profiles.get(A)?.cache_rank_spends).toMatchObject({ credits: 3 });
  });

  it('nonce replay returns the stored spend and charges nothing twice', async () => {
    const store = await richStore();
    const nonce = spendNonce();
    const first = await store.spendCacheRankBonus(A, nonce, 'xp') as Json;
    const replay = await store.spendCacheRankBonus(A, nonce, 'xp') as Json;
    expect(replay).toEqual(first);
    expect(store.profiles.get(A)?.cache_rank_tokens).toBe(173);
    expect(store.cacheRankSpendLog).toHaveLength(1);
  });

  it('refuses unknown tracks, maxed tracks, short nonces, and empty balances', async () => {
    const store = await richStore();
    await expect(store.spendCacheRankBonus(A, spendNonce(), 'warp'))
      .rejects.toThrow(/Unknown Cache Rank bonus/);
    await expect(store.spendCacheRankBonus(A, 'short', 'xp'))
      .rejects.toThrow(/nonce is required/);
    for (let i = 0; i < 10; i++) await store.spendCacheRankBonus(A, spendNonce(), 'damage');
    await expect(store.spendCacheRankBonus(A, spendNonce(), 'damage'))
      .rejects.toThrow(/Cache Rank bonus maxed/);

    const poor = new InMemoryChefGameplayStore();
    poor.seedProfile({ id: B, player_level: 2 });
    await poor.grantCacheRankTokens(B); // exactly 1 token
    await poor.spendCacheRankBonus(B, spendNonce(), 'xp');
    await expect(poor.spendCacheRankBonus(B, spendNonce(), 'scrap'))
      .rejects.toThrow(/Not enough Cache Rank tokens/);
  });

  it('spending applies a pending grant inline (observe-then-spend)', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 50 }); // watermark 0, balance 0
    const spent = await store.spendCacheRankBonus(A, spendNonce(), 'maxHp') as Json;
    expect(spent.cost).toBe(1);
    expect(store.profiles.get(A)?.cache_rank_tokens).toBe(78); // 79 granted - 1 spent
    expect(store.cacheRankGrantLog).toEqual([
      { playerId: A, fromLevel: 0, toLevel: 50, tokens: 79 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 6. Routes over HTTP: auth, retroactive grant, spend, forgery
// ---------------------------------------------------------------------------

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

interface RouteHarness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
  tokenB: string;
}

async function makeRouteServer(store = new InMemoryChefGameplayStore()): Promise<RouteHarness> {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  mountCacheRankRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  return {
    store,
    base: `http://127.0.0.1:${port}`,
    tokenA: issueAccessToken(SECRET, A, false),
    tokenB: issueAccessToken(SECRET, B, false),
  };
}

async function get(h: RouteHarness, path: string, token?: string) {
  const res = await fetch(`${h.base}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, json: (await res.json()) as Json };
}

async function post(h: RouteHarness, path: string, body: unknown, token?: string) {
  const res = await fetch(`${h.base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
}

describe('cache rank routes', () => {
  it('GET /api/cache-rank/me requires auth and 404s without a profile', async () => {
    const h = await makeRouteServer();
    expect((await get(h, '/api/cache-rank/me')).status).toBe(401);
    expect((await get(h, '/api/cache-rank/me', h.tokenA)).status).toBe(404);
  });

  it('GET pays the retroactive grant exactly once and reports the state view', async () => {
    const h = await makeRouteServer();
    h.store.seedProfile({ id: A, player_level: 50 });
    const first = await get(h, '/api/cache-rank/me', h.tokenA);
    expect(first.status).toBe(200);
    expect(first.json.verified).toBe(true);
    const view = first.json.cacheRank as Json;
    expect(view.tokens).toBe(79);
    expect(view.tokensEarned).toBe(79);
    expect(view.level).toBe(50);
    const second = await get(h, '/api/cache-rank/me', h.tokenA);
    expect((second.json.cacheRank as Json).tokens).toBe(79);
    expect(h.store.cacheRankGrantLog).toHaveLength(1);
  });

  it('POST /api/cache-rank/spend buys a rank; replay and forgery change nothing extra', async () => {
    const h = await makeRouteServer();
    h.store.seedProfile({ id: A, player_level: 50 });
    const body = { bonusId: 'credits', nonce: 'route-spend-0001' };
    const spent = await post(h, '/api/cache-rank/spend', body, h.tokenA);
    expect(spent.status).toBe(200);
    expect(spent.json.spent).toEqual({ bonusId: 'credits', rankAfter: 1, cost: 1 });
    expect((spent.json.cacheRank as Json).tokens).toBe(78);

    const replay = await post(h, '/api/cache-rank/spend', body, h.tokenA);
    expect(replay.status).toBe(200);
    expect((replay.json.cacheRank as Json).tokens).toBe(78);
    expect(h.store.cacheRankSpendLog).toHaveLength(1);

    // Forged progression fields in the body are never read: the spend
    // resolves from A's server record at the real ladder cost.
    const forged = await post(h, '/api/cache-rank/spend', {
      bonusId: 'xp', nonce: 'route-spend-0002',
      playerLevel: 100, level: 100, cacheRankTokens: 9999, tokens: 9999,
      cache_rank_spends: { xp: 10 }, cacheRankSpends: { xp: 10 },
    }, h.tokenA);
    expect(forged.status).toBe(200);
    expect(forged.json.spent).toEqual({ bonusId: 'xp', rankAfter: 1, cost: 1 });
    expect((forged.json.cacheRank as Json).tokens).toBe(77);
    expect(h.store.profiles.get(A)?.player_level).toBe(50);
  });

  it('spend validation over HTTP: unknown track 400s; another player\'s balance is never touched', async () => {
    const h = await makeRouteServer();
    h.store.seedProfile({ id: A, player_level: 50 });
    h.store.seedProfile({ id: B, player_level: 1 });
    const unknown = await post(h, '/api/cache-rank/spend',
      { bonusId: 'warp', nonce: 'route-spend-0003' }, h.tokenA);
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toBe('Unknown Cache Rank bonus');

    // B naming A in the body is a player mismatch (403) — the JWT
    // identity is the only spender. B spending as B hits B's own
    // empty balance instead. Either way A's record is untouched.
    const mismatch = await post(h, '/api/cache-rank/spend',
      { bonusId: 'xp', nonce: 'route-spend-0004', playerId: A }, h.tokenB);
    expect(mismatch.status).toBe(403);
    const broke = await post(h, '/api/cache-rank/spend',
      { bonusId: 'xp', nonce: 'route-spend-0005' }, h.tokenB);
    expect(broke.status).toBe(400);
    expect(broke.json.detail).toMatch(/Not enough Cache Rank tokens/);
    expect(h.store.profiles.get(A)?.cache_rank_tokens).toBe(0);
    expect(h.store.cacheRankSpendLog).toHaveLength(0);
  });

  it('a claim body\'s forged cache-rank fields do not move the server record', async () => {
    const h = await makeRouteServer();
    h.store.seedProfile({ id: A, player_level: 1, credits: 0 });
    const res = await post(h, '/api/claim', {
      playerId: A, areaId: 'dustwaste_frontier', ticks: 5, tickCount: 5,
      playerLevel: 10, idleMods: { offlineEarningsMod: 0, scrapYieldMod: 0, rareDropChanceMod: 0 },
      cacheRankTokens: 9999, cache_rank_tokens: 9999, cacheRankSpends: { credits: 10 },
    }, h.tokenA);
    expect(res.status).toBe(200);
    expect(h.store.profiles.get(A)?.cache_rank_tokens).toBe(0);
    expect(h.store.profiles.get(A)?.cache_rank_spends).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 7. Consumers measured in the real engines (Chef claim / boss, sim, snapshot)
// ---------------------------------------------------------------------------

function parLoadout(level: number, seed: number, rarity: Rarity) {
  const rng = createTickRng('cache-rank-test', 'loadout', seed);
  return {
    primary: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    secondary: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    heavy: generateWeapon({ source: DropSource.WorldDrop, level, forcedRarity: rarity }, rng),
    ordnance: generateOrdnance(level, rng, { [rarity]: 1 }),
    shield: generateShield(level, rng, { [rarity]: 1 }),
    classMod: generateClassMod(level, rng, { [rarity]: 1 }),
    relic: generateRelic(level, rng, { [rarity]: 1 }),
  };
}

describe('cache rank consumers — Chef engines', () => {
  const claimRequest = (overrides: Partial<ClaimRequest> = {}): ClaimRequest => ({
    playerId: A,
    areaId: 'dustwaste_frontier',
    ticks: 20,
    tickCount: 2000,
    playerLevel: 10,
    survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
    ...overrides,
  });

  it('roaming claim: Greed/Fast Learner/Salvage Hound scale the awarded rates', () => {
    const base = processRoamingClaim(claimRequest());
    // Dustwaste: 1.0 XP/tick flat — the cleanest exact read.
    expect(base.rewards.xpAwarded).toBe(20);
    const scaled = processRoamingClaim(claimRequest({
      cacheRankBonuses: cacheRankBonuses({ credits: 10, xp: 10, scrap: 10 }),
    }));
    expect(scaled.rewards.xpAwarded).toBe(22); // 20 x 1.10 exactly
    const baseCredits = base.rewards.creditsAwarded + base.rewards.creditsRemainder;
    const scaledCredits = scaled.rewards.creditsAwarded + scaled.rewards.creditsRemainder;
    expect(scaledCredits).toBeCloseTo(baseCredits * 1.1, 6);
    const baseScrap = base.rewards.scrapAwarded + base.rewards.scrapRemainder;
    const scaledScrap = scaled.rewards.scrapAwarded + scaled.rewards.scrapRemainder;
    expect(scaledScrap).toBeCloseTo(baseScrap * 1.1, 6);
    // Absent bonuses are bit-identical to the shipped claim.
    const absent = processRoamingClaim(claimRequest({ cacheRankBonuses: cacheRankBonuses({}) }));
    expect(absent.rewards).toEqual(base.rewards);
  });

  it('boss attempt: victory XP and credits scale; the death side does not mint', () => {
    const boss = REGION_1_BOSSES.find((b) => b.id === 'dune_tyrant') ?? REGION_1_BOSSES[0];
    const lo = parLoadout(60, 11, Rarity.Epic);
    const attempt = (nonce: number, bonuses?: BossAttemptRequest['cacheRankBonuses']): BossAttemptRequest => ({
      ...lo,
      consumables: {},
      risk: RiskSetting.Balanced,
      bossId: boss.id,
      playerId: A,
      playerLevel: 60,
      skillBonuses: {},
      attemptNonce: nonce,
      entryFee: 0,
      cacheRankBonuses: bonuses,
    });
    // Find a winning nonce deterministically (fixed seeds throughout).
    let baseWin: ReturnType<typeof processBossAttempt> | null = null;
    let winNonce = -1;
    for (let nonce = 1; nonce <= 60 && !baseWin; nonce++) {
      const result = processBossAttempt(attempt(nonce));
      if (result.result.victory) { baseWin = result; winNonce = nonce; }
    }
    expect(baseWin, 'a par L60 loadout should beat the first boss within 60 nonces').not.toBeNull();
    expect(baseWin!.xpAwarded).toBeGreaterThan(0);
    const scaled = processBossAttempt(attempt(winNonce, cacheRankBonuses({ xp: 10, credits: 10, scrap: 10 })));
    expect(scaled.result.victory).toBe(true);
    expect(Math.abs(scaled.xpAwarded - baseWin!.xpAwarded * 1.1)).toBeLessThanOrEqual(1.5);
    expect(scaled.xpAwarded).toBeGreaterThan(baseWin!.xpAwarded);
    expect(scaled.creditsDelta).toBeGreaterThan(baseWin!.creditsDelta);
  });

  it('boss sim seam: Heavy Hand scales effective DPS; Thick Skin raises survival', () => {
    const boss = REGION_1_BOSSES.find((b) => b.shield > 0 && b.armor > 0) ?? REGION_1_BOSSES[0];
    const lo = parLoadout(boss.level, 7, Rarity.Epic);
    const base = { ...lo, consumables: {}, risk: RiskSetting.Balanced, boss, playerLevel: boss.level, skillBonuses: {} };
    const plain = simulateBoss(base);
    const heavy = simulateBoss({ ...base, skillBonuses: { cacheRankDamageBonus: 0.05 } });
    expect(heavy.effectiveDPS).toBeCloseTo(plain.effectiveDPS * 1.05, 4);
    const thick = simulateBoss({ ...base, skillBonuses: { cacheRankMaxHpBonus: 0.10 } });
    expect(thick.survivalScore).toBeGreaterThan(plain.survivalScore);
    expect(thick.winChance).toBeGreaterThanOrEqual(plain.winChance);
  });

  it('mechanics snapshot: Thick Skin scales base HP only; Heavy Hand joins DPS; contributions trace', () => {
    const player = (spends: Record<string, number>): PlayerProfile => ({
      id: A, name: 'Test Hunter', level: 10, xp: 0, credits: 0, scrap: 0,
      cacheKeys: 0, cacheKeyFragments: 0, legendaryCores: 0,
      currentZoneId: 'dustwaste', highestZoneId: 'dustwaste',
      offlineCapHours: 0, lastClaimTime: 0, deathFeeInsurance: false,
      consumables: {}, materials: {}, essences: {}, workshopQueues: [], lastWorkshopTick: 0,
      cacheRankTokens: 0, cacheRankSpends: spends,
    } as PlayerProfile);
    const weapon = generateWeapon(
      { source: DropSource.WorldDrop, level: 10, forcedRarity: Rarity.Rare },
      createTickRng('cache-rank-test', 'snapshot', 3),
    );
    const baseHp = computeHunterMaxHp(10, 0);
    const plain = buildCharacterMechanicsSnapshot({ player: player({}), weapons: [weapon], spentSkills: {} });
    expect(plain.maxHp.value).toBe(baseHp);
    const ranked = buildCharacterMechanicsSnapshot({
      player: player({ maxHp: 10, damage: 10 }), weapons: [weapon], spentSkills: {},
    });
    expect(ranked.maxHp.value).toBe(Math.round(baseHp * 1.1));
    const hpContribution = ranked.maxHp.contributions.find((c) => c.stat === 'cacheRankMaxHpBonus');
    expect(hpContribution?.source).toBe('Cache Rank');
    expect(hpContribution?.value).toBe(Math.round(baseHp * 1.1) - baseHp);
    expect(ranked.simulatedBossDps.value).toBeGreaterThan(plain.simulatedBossDps.value);
    // No spends -> no contribution rows (the snapshot stays bit-clean).
    expect(plain.maxHp.contributions.some((c) => c.stat === 'cacheRankMaxHpBonus')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Market composition: fee -> reductions -> Silver Tongue on post-fee
// ---------------------------------------------------------------------------

describe('cache rank consumers — market fee composition', () => {
  it('marketFeeForPrice: the uplift is floor(post-fee proceeds x rate), minted on top', () => {
    const plain = marketFeeForPrice(10_000, 0);
    expect(plain.fee).toBe(500);
    expect(plain.sellerProceeds).toBe(9500);
    expect(plain.proceedsBonus).toBe(0);
    const ranked = marketFeeForPrice(10_000, 0, 0.05, 0.05);
    expect(ranked.fee).toBe(500); // fee unchanged by the uplift
    expect(ranked.proceedsBonus).toBe(475);
    expect(ranked.sellerProceeds).toBe(9975);
  });

  it('marketFeeForSeller: Darknet reduction applies to the fee BEFORE the uplift is priced', () => {
    const sale = marketFeeForSeller({
      price: 10_000,
      skillSpends: { scav_fee_1: 5 }, // Darknet Broker: 25% fee reduction
      foundBySeller: true,
      craftedBySeller: false,
      cacheRankProceedsBonus: 0.05,
    });
    expect(sale.feeReduction).toBeCloseTo(0.25, 10);
    expect(sale.fee).toBe(375); // 10000 x 0.05 x 0.75
    expect(sale.proceedsBonus).toBe(481); // floor(9625 x 0.05)
    expect(sale.sellerProceeds).toBe(9625 + 481);
  });
});

// ---------------------------------------------------------------------------
// 9. Writes store: cache draw, market accept, NPC exemption
// ---------------------------------------------------------------------------

function writeProfile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 30, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 2, workshop_tools: {}, legendary_cores: 0,
    ...over,
  } as ProfileRowData;
}

function skillNodeData(): SkillNodeData[] {
  return SKILL_NODES.map((n) => ({
    id: n.id, tree: n.tree, tier: n.tier, slot_index: n.index, name: n.name,
    description: n.description, node_type: n.type, max_points: n.maxPoints,
    per_point_cost: n.cost, effects: n.effects as SkillNodeData['effects'],
    requires: n.requires ?? [],
  }));
}

let writeNonceN = 0;
const writeNonce = () => `cache-rank-nonce-${String(++writeNonceN).padStart(4, '0')}-zz`;

function makeWriteStore(seedFn: (s: WriteSeed) => void, rng: () => number = () => 0.5) {
  const s = emptyWriteSeed();
  s.skillNodes = skillNodeData();
  seedFn(s);
  return new InMemoryWriteStore(s, {
    now: () => new Date('2026-10-31T12:00:00.000Z'),
    rng,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
}

describe('cache rank consumers — writes store', () => {
  const ODDS = [
    { table_id: 'cache_primary_rarity', outcome: 'Common', weight: 70, payload: {} },
    { table_id: 'cache_primary_rarity', outcome: 'Rare', weight: 30, payload: {} },
  ];

  it('makeItem: skill cacheQuality + Cache Optimizer feed the draw and shift the outcome', async () => {
    // rng 0.65: base draw (total 100, roll 66) lands Common (<= 70).
    // With quality 0.45 the Rare weight becomes 43.5 (total 113.5,
    // roll 74) and the same roll lands Rare.
    const plain = makeWriteStore((s) => {
      s.oddsOutcomes = [...ODDS];
      s.profiles = [writeProfile({ id: A, cache_tokens: 5 })];
    }, () => 0.65);
    const plainMade = await plain.makeItem(A, writeNonce(), 'key', null) as Json;
    expect(plainMade.cache_quality).toBe(0);
    expect((plainMade.item as Json).rarity).toBe('Common');

    const ranked = makeWriteStore((s) => {
      s.oddsOutcomes = [...ODDS];
      s.profiles = [writeProfile({
        id: A, cache_tokens: 5,
        skill_spends: { scav_cache_1: 5 },
        cache_rank_spends: { cacheQuality: 10 },
      } as Partial<ProfileRowData>)];
    }, () => 0.65);
    const rankedMade = await ranked.makeItem(A, writeNonce(), 'key', null) as Json;
    expect(rankedMade.cache_quality).toBeCloseTo(0.45, 10); // 0.25 skill + 0.20 rank
    expect((rankedMade.item as Json).rarity).toBe('Rare');
    expect((rankedMade.odds as Json).total_weight).toBeCloseTo(113.5, 6);
  });

  it('acceptListing: Silver Tongue composes after the fee and Darknet; seller is credited the uplift', async () => {
    const ITEM = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const store = makeWriteStore((s) => {
      s.profiles = [
        writeProfile({
          id: A, credits: 0, skill_spends: { scav_fee_1: 5 },
          cache_rank_spends: { marketProceeds: 10 },
        } as Partial<ProfileRowData>),
        writeProfile({ id: B, credits: 100_000 }),
      ];
      s.items = [{
        id: ITEM, owner_user_id: A, kind: 'weapon', static_item_id: null, item_level: 10,
        rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
        condition_current: null, condition_max: null,
        supply_mode: 'verified_action', source_id: null, creator_user_id: null, tradeable: true,
        account_bound: false, locked_until: null,
        payload: { name: 'Seller Gun', sourceTag: 'World Drop' },
        runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 5000,
        created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      } as WriteSeed['items'][number]];
    });
    const created = await store.marketCreate(A, writeNonce(), ITEM, 10_000) as Json;
    const accepted = await store.acceptListing(B, writeNonce(), (created.listing as Json).id as string) as Json;
    const fee = accepted.market_fee as Json;
    expect(fee.fee_credits).toBe(375);
    expect(fee.cache_rank_proceeds_bonus).toBe(481);
    expect(fee.seller_proceeds).toBe(9625 + 481);
    const seller = store.seed.profiles.find((p) => p.id === A)!;
    expect(seller.credits).toBe(9625 + 481);
  });

  it('acceptListing: NPC-market listings are exempt from the uplift even with a maxed track', async () => {
    const NPC = '99999999-9999-4999-8999-999999999999';
    const ITEM = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
    const LISTING = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
    const store = makeWriteStore((s) => {
      s.profiles = [
        writeProfile({ id: NPC, credits: 0, cache_rank_spends: { marketProceeds: 10 } } as Partial<ProfileRowData>),
        writeProfile({ id: B, credits: 100_000 }),
      ];
      s.items = [{
        id: ITEM, owner_user_id: NPC, kind: 'weapon', static_item_id: null, item_level: 10,
        rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
        condition_current: null, condition_max: null,
        supply_mode: 'npc_market', source_id: null, creator_user_id: null, tradeable: true,
        account_bound: false, locked_until: null,
        payload: { name: 'NPC Gun', sourceTag: 'Marketplace' },
        runtime_state: 'listed', is_locked: false, equipped_slot: null, estimated_value: 5000,
        created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
      } as WriteSeed['items'][number]];
      s.listings = [{
        id: LISTING, seller_user_id: NPC, item_instance_id: ITEM, price_credits: 1000,
        status: 'active', listed_at: '2026-10-30T11:00:00.000Z', sold_at: null,
      } as WriteSeed['listings'][number]];
    });
    const accepted = await store.acceptListing(B, writeNonce(), LISTING) as Json;
    const fee = accepted.market_fee as Json;
    expect(fee.fee_credits).toBe(0);
    expect(fee.cache_rank_proceeds_bonus).toBe(0);
    expect(fee.seller_proceeds).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// 10. Craft engine: Fast Learner scales unit XP at completion
// ---------------------------------------------------------------------------

describe('cache rank consumers — craft engine XP', () => {
  const LEVERS: CraftLeverValues = {
    craftXpRate: 0.775, craftTimeScalar: 1, craftQualityShift: 0,
    gearTemperBaseChance: 0.05, refineBaseYield: 0.8,
    repairWorkRateBase: 20, repairMasterySpeedPerLevel: 0.02,
    repairMasteryEfficiencyPerLevel: 0.02,
  };

  function engineHarness(cacheRankXpBonus?: (playerId: string) => number) {
    const profileView: CraftProfileView = {
      player_level: 25, player_xp: 0, credits: 0,
      materials: { ScrapAlloy: 100_000, ReactiveComponents: 100_000 },
      essences: {}, consumables: {},
      workshop_benches: 2, legendary_cores: 0,
      workshop_tools: { owned: {}, fitted: {}, charges: {} },
      offline_cap_hours: null,
    } as CraftProfileView;
    const jobs: CraftJobRecord[] = [];
    let now = 1_000_000;
    const adapter: CraftAdapter = {
      nowMs: () => now,
      rng: () => 0.5,
      uuid: (() => { let n = 0; return () => `engine-job-${++n}`; })(),
      profile: () => profileView,
      activeAction: () => ({ kind: 'crafting', lastHeartbeatMs: now }),
      jobs: () => jobs,
      addJob: (j) => { jobs.push(j); },
      masteryLevel: () => 1,
      skillBonus: (_id, key) => computeSkillBonuses({})[key] ?? 0,
      addMasteryXp: () => {},
      addStat: () => {},
      addBatch: () => {},
      burnOneBatchUnit: () => null,
      insertGearItem: () => 'engine-item-1',
      vehicleInfo: () => null,
      restoreVehicle: () => null,
      levers: () => LEVERS,
      cacheRankXpBonus,
    } as CraftAdapter;
    return {
      jobs,
      run: () => {
        const { job } = enqueueCraftJobCore(adapter, A, {
          bench: 1, recipeId: 'recipe_medkit', units: 1,
          consumableEfficiencyBonus: 0,
          fixerBonuses: {
            craftSpeedBonus: 0, workshopQueueBonus: 0,
            rushReductionCapBonus: 0, coreCatalystDrawBonus: 0,
          },
        } as never);
        now += job.unit_duration_ms + 1000;
        settleCraftJobsCore(adapter, A, { maxAdvanceMs: job.unit_duration_ms + 1000 });
        return job;
      },
    };
  }

  it('a +10% Fast Learner bonus scales the completed unit XP by exactly 1.1x', () => {
    const plain = engineHarness(undefined);
    const plainJob = plain.run();
    expect(plainJob.xp_awarded).toBeGreaterThan(0);
    const ranked = engineHarness(() => 0.10);
    const rankedJob = ranked.run();
    expect(rankedJob.xp_awarded).toBe(Math.round(plainJob.xp_awarded * 1.1));
  });
});

// ---------------------------------------------------------------------------
// 11. Economy meters: the in-memory twin folds grants, spends, uplift
// ---------------------------------------------------------------------------

describe('cache rank economy meters (in-memory twin)', () => {
  it('computeMetricsForDay folds token grants/spends and the minted uplift', async () => {
    const day = '2026-10-31';
    const at = (time: string) => `${day}T${time}.000Z`;
    const store = new InMemoryEconomyStore({
      ledger: [
        { action_type: 'cc_cache_rank_grant', created_at: at('08:00:00'), result_payload: { tokens_granted: 40 } },
        { action_type: 'cc_cache_rank_grant', created_at: at('09:00:00'), result_payload: { tokens_granted: 6 } },
        { action_type: 'cc_cache_rank_spend', created_at: at('10:00:00'), result_payload: { cost: 3 } },
        {
          action_type: 'cc_accept_listing', created_at: at('11:00:00'),
          result_payload: { market_fee: { fee_credits: 500, cache_rank_proceeds_bonus: 475 } },
        },
      ],
      items: [],
      config: {},
    });
    const metrics = await store.computeMetricsForDay(day);
    expect(metrics.cacheRankTokensGranted).toBe(46);
    expect(metrics.cacheRankTokensSpent).toBe(3);
    expect(metrics.creditsMintedOther).toBeGreaterThanOrEqual(475);
  });
});
