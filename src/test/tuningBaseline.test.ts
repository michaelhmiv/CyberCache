/**
 * Pacing-baseline tuning pass (lifecycle evaluation §1/§3/§6A + the
 * owner's XP-curve directive, 2026-10-30) — one test home for the eight
 * tuned numbers so a future balance change has to come through here:
 *
 *  1. Roaming Legendary area weights ×0.1 (Rare/Epic untouched; the
 *     global RARITIES table untouched).
 *  2. BOSS_DEDICATED_DROP_CHANCE 0.25 → 0.10.
 *  3. Dedicated drops generate at max(boss.level, playerLevel).
 *  4. FRAGMENT_CHANCE 0.03 → 0.008 per tick.
 *  5. Offline cap earned by level (+ Scavenger keystone offlineCapBonus).
 *  6. Rematch fee escalation ×2 per victory today (UTC), capped ×8.
 *  7. Boss XP multiplier ×20 → ×50.
 *  8. XP curve stretch — applyXp mirror parity (curve values pinned in
 *     xpCurve.test.ts).
 *
 * Shipped-path tests (HTTP over the real routes + InMemory store) where
 * a route exists; engine/statistical pins where the number lives in the
 * engine.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { RARITIES } from '@/constants/rarities';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import {
  BOSS_DEDICATED_DROP_CHANCE,
  FRAGMENT_CHANCE,
  processBossAttempt,
  processRoamingClaim,
  type BossAttemptChefResult,
  type BossAttemptRequest,
} from '../server/chef';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { issueAccessToken } from '../server/auth/tokens';
import { earnedOfflineCapHours, nextOfflineCapTier, OFFLINE_CAP_TIERS } from '@/content/offlineCap';
import { bossFeeMultiplier, escalatedBossFee, utcDayStartIso } from '@/lib/bossFees';
import { xpToNextLevel } from '@/content/simulation';
import { applyXp } from '../server/writes/store';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';
const PLAYER = '44444444-4444-4444-8444-444444444444';

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

async function makeServer(store = new InMemoryChefGameplayStore()) {
  const app = express();
  app.use(express.json());
  mountChefHealthRoute(app);
  mountGameplayRoutes(app, store, { jwtSecret: SECRET });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  openServers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return { store, base: `http://127.0.0.1:${port}`, tokenA: issueAccessToken(SECRET, A, false) };
}

interface HttpResult {
  status: number;
  json: {
    verified?: boolean;
    victory?: boolean;
    entryFee?: number;
    xpAwarded?: number;
    bossVictoriesToday?: number;
    dedicatedDropAwarded?: boolean;
    settled?: boolean;
    capHours?: number;
    ticksSettled?: number;
    items?: Array<{ level: number; rarity: string; sourceTag: string; legendaryEffectId?: string }>;
    error?: string;
  };
}

async function post(base: string, path: string, body: unknown, token?: string): Promise<HttpResult> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as HttpResult['json'] };
}

function strongWeapon(): Weapon {
  return {
    id: 'server-owned-boss-gun',
    name: 'Server Owned Boss Gun',
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
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 1,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
  };
}

function seedStrongWeapon(store: InMemoryChefGameplayStore) {
  const weapon = strongWeapon();
  store.seedItem({
    id: weapon.id,
    owner_user_id: A,
    kind: 'weapon',
    runtime_state: 'equipped',
    equipped_slot: 'primary',
    payload: weapon as unknown as Record<string, unknown>,
  });
  return weapon;
}

/** Find a nonce whose Chef outcome (for the route-built request) matches the predicate. */
function findNonce(base: Omit<BossAttemptRequest, 'attemptNonce'>, predicate: (r: BossAttemptChefResult) => boolean): number {
  for (let nonce = 1; nonce <= 4000; nonce++) {
    const result = processBossAttempt({ ...base, attemptNonce: nonce });
    if (predicate(result)) return nonce;
  }
  throw new Error('no matching nonce found');
}

const bossById = (id: string) => REGION_1_BOSSES.find((b) => b.id === id)!;

// ---------------------------------------------------------------------
// Item 1 — roaming Legendary scarcity
// ---------------------------------------------------------------------
describe('tuning item 1 — roaming Legendary weights ×0.1', () => {
  it('pins every area’s full rarity-weight table (Legendary scaled, Rare/Epic untouched)', () => {
    const expected: Record<string, Record<Rarity, number>> = {
      dustwaste_frontier: { [Rarity.Common]: 60, [Rarity.Uncommon]: 25, [Rarity.Rare]: 10, [Rarity.Epic]: 4, [Rarity.Legendary]: 0.1 },
      redline_circuit: { [Rarity.Common]: 56, [Rarity.Uncommon]: 27, [Rarity.Rare]: 12, [Rarity.Epic]: 4, [Rarity.Legendary]: 0.1 },
      ironwood_bastion: { [Rarity.Common]: 50, [Rarity.Uncommon]: 29, [Rarity.Rare]: 14, [Rarity.Epic]: 5.5, [Rarity.Legendary]: 0.15 },
      blastforge_yards: { [Rarity.Common]: 52, [Rarity.Uncommon]: 28, [Rarity.Rare]: 13, [Rarity.Epic]: 5, [Rarity.Legendary]: 0.2 },
      prismatek_reactor: { [Rarity.Common]: 51, [Rarity.Uncommon]: 27, [Rarity.Rare]: 14, [Rarity.Epic]: 6, [Rarity.Legendary]: 0.2 },
      throwtech_dumpnet: { [Rarity.Common]: 53, [Rarity.Uncommon]: 27, [Rarity.Rare]: 13, [Rarity.Epic]: 5, [Rarity.Legendary]: 0.2 },
      helixworks_labyrinth: { [Rarity.Common]: 48, [Rarity.Uncommon]: 29, [Rarity.Rare]: 15, [Rarity.Epic]: 6, [Rarity.Legendary]: 0.2 },
    };
    expect(ROAMING_AREAS.map((a) => a.id).sort()).toEqual(Object.keys(expected).sort());
    for (const area of ROAMING_AREAS) {
      expect(area.dropPoolRarityWeights, area.id).toEqual(expected[area.id]);
    }
  });

  it('leaves the global RARITIES dropWeight table untouched (boss/cache scope)', () => {
    expect(RARITIES[Rarity.Common].dropWeight).toBe(60);
    expect(RARITIES[Rarity.Uncommon].dropWeight).toBe(25);
    expect(RARITIES[Rarity.Rare].dropWeight).toBe(10);
    expect(RARITIES[Rarity.Epic].dropWeight).toBe(4);
    expect(RARITIES[Rarity.Legendary].dropWeight).toBe(1);
  });
});

// ---------------------------------------------------------------------
// Items 2, 3, 7 — boss constants, dedicated level, boss XP
// ---------------------------------------------------------------------
describe('tuning items 2/3/7 — dedicated chance, dedicated level, boss XP', () => {
  it('pins the dedicated-drop chance at the Borderlands-standard 10%', () => {
    expect(BOSS_DEDICATED_DROP_CHANCE).toBe(0.1);
  });

  it('a dedicated drop for a high-level player generates at the PLAYER’s level; generic rolls keep the boss’s', () => {
    const boss = bossById('dune_tyrant'); // level 5
    const base: Omit<BossAttemptRequest, 'attemptNonce'> = {
      playerId: A,
      bossId: boss.id,
      primary: strongWeapon(),
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      playerLevel: 80,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 100000,
      entryFee: 0,
    };

    const dedicatedNonce = findNonce(base, (r) => r.result.victory && r.dedicatedDropAwarded);
    const dedicatedResult = processBossAttempt({ ...base, attemptNonce: dedicatedNonce });
    const dedicated = dedicatedResult.items.find(
      (item) => 'legendaryEffectId' in item && item.legendaryEffectId && boss.dedicatedDrops.includes(item.legendaryEffectId),
    );
    expect(dedicated).toBeDefined();
    expect(dedicated!.rarity).toBe(Rarity.Legendary);
    expect(dedicated!.level).toBe(80);

    const genericNonce = findNonce(base, (r) => r.result.victory && !r.dedicatedDropAwarded && r.items.length > 0);
    const genericResult = processBossAttempt({ ...base, attemptNonce: genericNonce });
    for (const item of genericResult.items) {
      expect(item.level).toBe(boss.level);
    }
  });

  it('boss victory XP is boss.level × 50 (was × 20)', () => {
    const boss = bossById('ashgut'); // level 22 → 1100 XP at ×50 (440 at ×20)
    const base: Omit<BossAttemptRequest, 'attemptNonce'> = {
      playerId: A,
      bossId: boss.id,
      primary: strongWeapon(),
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      playerLevel: 50,
      skillBonuses: {},
      pityCount: 0,
      playerCredits: 100000,
      entryFee: boss.entryCost,
    };
    const nonce = findNonce(base, (r) => r.result.victory);
    const result = processBossAttempt({ ...base, attemptNonce: nonce });
    expect(result.xpAwarded).toBe(22 * 50);
  });
});

// ---------------------------------------------------------------------
// Item 4 — fragment faucet
// ---------------------------------------------------------------------
describe('tuning item 4 — fragment faucet 0.03 → 0.008 per tick', () => {
  it('pins the constant', () => {
    expect(FRAGMENT_CHANCE).toBe(0.008);
  });

  it('a long seeded roam mints fragments at the new rate, far below the old', () => {
    // 200 claims × 100 ticks = 20,000 ticks, each claim independently
    // seeded by its absolute tick window. Expected fragments at the new
    // rate: 20,000 × 0.008 = 160 (σ ≈ 12.6). The band is ±~5σ and its
    // ceiling sits far under the old rate's expectation (~600).
    let fragments = 0;
    for (let i = 0; i < 200; i++) {
      const result = processRoamingClaim({
        playerId: PLAYER,
        areaId: 'dustwaste_frontier',
        ticks: 100,
        tickCount: 500_000 + i * 100,
        playerLevel: 10,
        maxTicks: Infinity,
        survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
      });
      fragments += result.rewards.cacheFragmentsAwarded;
    }
    expect(fragments).toBeGreaterThan(95);
    expect(fragments).toBeLessThan(230);
  });
});

// ---------------------------------------------------------------------
// Item 5 — offline cap, earned
// ---------------------------------------------------------------------
describe('tuning item 5 — offline cap earned by level', () => {
  it('pins the tier table and the earned-cap derivation', () => {
    expect(OFFLINE_CAP_TIERS).toEqual([
      { minLevel: 20, hours: 4 },
      { minLevel: 40, hours: 6 },
      { minLevel: 60, hours: 8 },
      { minLevel: 80, hours: 12 },
    ]);
    expect(earnedOfflineCapHours(1)).toBe(2);
    expect(earnedOfflineCapHours(19)).toBe(2);
    expect(earnedOfflineCapHours(20)).toBe(4);
    expect(earnedOfflineCapHours(39)).toBe(4);
    expect(earnedOfflineCapHours(40)).toBe(6);
    expect(earnedOfflineCapHours(60)).toBe(8);
    expect(earnedOfflineCapHours(79)).toBe(8);
    expect(earnedOfflineCapHours(80)).toBe(12);
    expect(earnedOfflineCapHours(100)).toBe(12);
    expect(nextOfflineCapTier(1)).toEqual({ minLevel: 20, hours: 4 });
    expect(nextOfflineCapTier(79)).toEqual({ minLevel: 80, hours: 12 });
    expect(nextOfflineCapTier(80)).toBeNull();
  });

  function seedOfflinePlayer(
    store: InMemoryChefGameplayStore,
    overrides: Parameters<InMemoryChefGameplayStore['seedProfile']>[0],
    awayHours: number,
  ) {
    const settleFromMs = Date.now() - (awayHours * 3600_000 + 1500);
    store.seedProfile({
      id: A,
      credits: 0,
      scrap: 0,
      last_claimed_tick: 0,
      last_roaming_settled_at: new Date(settleFromMs).toISOString(),
      ...overrides,
    });
    store.seedActiveAction({
      user_id: A,
      active_action: 'roaming_loot',
      target_id: 'dustwaste_frontier',
      started_at: new Date(settleFromMs).toISOString(),
      last_heartbeat_at: null,
      activity_payload: {},
    });
  }

  it('settlement truncates at the EARNED cap and ignores a larger stored preference', async () => {
    const { base, store, tokenA } = await makeServer();
    // Level 10 earns 2h. The stored preference says 12h — pre-tuning it
    // would have settled all 10 away-hours; now it must not.
    seedOfflinePlayer(store, { player_level: 10, offline_cap_hours: 12 }, 10);
    const res = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'tuning-cap-l10' }, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.settled).toBe(true);
    expect(res.json.capHours).toBe(2);
    expect(res.json.ticksSettled).toBe(2400); // 2h × 3600s / 3s ticks
  });

  it('a level-25 player settles at the 4h tier', async () => {
    const { base, store, tokenA } = await makeServer();
    seedOfflinePlayer(store, { player_level: 25 }, 10);
    const res = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'tuning-cap-l25' }, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.settled).toBe(true);
    expect(res.json.capHours).toBe(4);
    expect(res.json.ticksSettled).toBe(4800);
  });

  it('the Scavenger keystone’s offlineCapBonus extends the earned cap (first consumer of the key)', async () => {
    const { base, store, tokenA } = await makeServer();
    // Level 10 earns 2h; King of Scrap (scav_keystone) adds +4h → 6h.
    seedOfflinePlayer(store, { player_level: 10, skill_spends: { scav_keystone: 1 } }, 10);
    const res = await post(base, '/api/settle-offline', { playerId: A, settlementNonce: 'tuning-cap-keystone' }, tokenA);
    expect(res.status).toBe(200);
    expect(res.json.settled).toBe(true);
    expect(res.json.capHours).toBe(6);
    expect(res.json.ticksSettled).toBe(7200);
  });
});

// ---------------------------------------------------------------------
// Item 6 — rematch escalation
// ---------------------------------------------------------------------
describe('tuning item 6 — rematch fee escalation', () => {
  it('pins the multiplier curve and the UTC day boundary helper', () => {
    expect(bossFeeMultiplier(0)).toBe(1);
    expect(bossFeeMultiplier(1)).toBe(2);
    expect(bossFeeMultiplier(2)).toBe(4);
    expect(bossFeeMultiplier(3)).toBe(8);
    expect(bossFeeMultiplier(4)).toBe(8);
    expect(bossFeeMultiplier(12)).toBe(8);
    expect(escalatedBossFee(700, 2)).toBe(2800);
    expect(escalatedBossFee(0, 5)).toBe(0);
    expect(utcDayStartIso(new Date('2026-10-30T17:45:00.000Z'))).toBe('2026-10-30T00:00:00.000Z');
  });

  function seedBossPlayer(store: InMemoryChefGameplayStore) {
    store.seedProfile({
      id: A,
      player_level: 50,
      credits: 10_000_000,
      consumables: {},
      boss_state: {
        unlockedBossIds: REGION_1_BOSSES.map((b) => b.id),
        defeatedBossIds: [],
        pityCounters: {},
      },
    });
    seedStrongWeapon(store);
  }

  function victoryNonce(bossId: string, usedNonces: Set<number>): number {
    const boss = bossById(bossId);
    // Outcomes are deterministic per nonce for this fixed request, so
    // each attempt needs the next UNUSED winning nonce (a reused nonce
    // would replay the first application instead of applying).
    for (let nonce = 1; nonce <= 4000; nonce++) {
      if (usedNonces.has(nonce)) continue;
      const result = processBossAttempt({
        playerId: A,
        bossId,
        attemptNonce: nonce,
        primary: strongWeapon(),
        secondary: null,
        heavy: null,
        ordnance: null,
        shield: null,
        classMod: null,
        relic: null,
        consumables: {},
        risk: RiskSetting.Balanced,
        playerLevel: 50,
        skillBonuses: {},
        pityCount: 0,
        playerCredits: 10_000_000,
        entryFee: boss.entryCost,
      });
      if (result.result.victory) {
        usedNonces.add(nonce);
        return nonce;
      }
    }
    throw new Error('no unused winning nonce found');
  }

  async function attempt(base: string, tokenA: string, bossId: string, nonce: number): Promise<HttpResult> {
    return post(base, '/api/verify-boss', {
      playerId: A,
      bossId,
      attemptNonce: nonce,
      consumables: {},
      risk: RiskSetting.Balanced,
    }, tokenA);
  }

  it('escalates 1× → 2× → 4× → 8× → 8× over repeated victories in one day', async () => {
    const { base, store, tokenA } = await makeServer();
    seedBossPlayer(store);
    const boss = bossById('ashgut'); // entry 600, rematch 700
    const used = new Set<number>();

    const fees: Array<number | undefined> = [];
    const counts: Array<number | undefined> = [];
    for (let i = 0; i < 5; i++) {
      const res = await attempt(base, tokenA, boss.id, victoryNonce(boss.id, used));
      expect(res.status).toBe(200);
      expect(res.json.victory).toBe(true);
      fees.push(res.json.entryFee);
      counts.push(res.json.bossVictoriesToday);
    }
    // Attempt 1 pays the entry fee at ×1 (no victories yet today);
    // attempts 2–5 pay the rematch fee at ×2, ×4, ×8, ×8 (capped).
    expect(fees).toEqual([600, 1400, 2800, 5600, 5600]);
    expect(counts).toEqual([1, 2, 3, 4, 5]);
  });

  it('resets on the UTC day boundary — yesterday’s victories do not escalate today’s fee', async () => {
    let clock = new Date(Date.parse(utcDayStartIso()) - 3600_000); // yesterday 23:00 UTC
    const store = new InMemoryChefGameplayStore(() => clock);
    const { base, tokenA } = await makeServer(store);
    seedBossPlayer(store);
    const boss = bossById('ashgut');
    const used = new Set<number>();

    // A victory late yesterday (store clock): the route counts by the
    // server wall clock (real today), where this boss has no victories
    // yet — so the fee is the plain entry fee.
    const yesterday = await attempt(base, tokenA, boss.id, victoryNonce(boss.id, used));
    expect(yesterday.json.victory).toBe(true);
    expect(yesterday.json.entryFee).toBe(600);
    // Seam-level proof of the reset: aged by the store clock, the
    // victory falls outside today's window.
    expect(await store.countBossVictoriesToday(A, boss.id, utcDayStartIso())).toBe(0);

    // Today: the first victory pays the rematch base at ×1 — proof the
    // count reset (an un-reset count would charge ×2).
    clock = new Date();
    const todayFirst = await attempt(base, tokenA, boss.id, victoryNonce(boss.id, used));
    expect(todayFirst.json.victory).toBe(true);
    expect(todayFirst.json.entryFee).toBe(700);
    expect(todayFirst.json.bossVictoriesToday).toBe(1);

    // And the next one escalates from today's count alone.
    const todaySecond = await attempt(base, tokenA, boss.id, victoryNonce(boss.id, used));
    expect(todaySecond.json.victory).toBe(true);
    expect(todaySecond.json.entryFee).toBe(1400);
    expect(todaySecond.json.bossVictoriesToday).toBe(2);
  });
});

// ---------------------------------------------------------------------
// Item 8 — applyXp mirror parity with the stretched curve
// ---------------------------------------------------------------------
describe('tuning item 8 — applyXp (server mirror) follows the stretched curve', () => {
  it('crosses exactly one level at the threshold, with no remainder', () => {
    expect(applyXp(1, 0, xpToNextLevel(1))).toEqual({ player_level: 2, player_xp: 0 });
    expect(applyXp(24, 0, xpToNextLevel(24))).toEqual({ player_level: 25, player_xp: 0 });
    expect(applyXp(45, 0, xpToNextLevel(45))).toEqual({ player_level: 46, player_xp: 0 });
  });

  it('an existing level-50 player keeps their level and progresses under the new thresholds', () => {
    // cc_apply_xp is state-based: no data migration — a mid-ladder
    // award simply measures against the new curve from current state.
    const halfway = Math.floor(xpToNextLevel(50) / 2);
    expect(applyXp(50, 0, halfway)).toEqual({ player_level: 50, player_xp: halfway });
    expect(applyXp(50, halfway, xpToNextLevel(50) - halfway)).toEqual({ player_level: 51, player_xp: 0 });
  });
});
