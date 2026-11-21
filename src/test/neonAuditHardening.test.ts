import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountAuthRoutes } from '../server/auth/routes';
import { InMemoryAuthStore } from '../server/auth/store';
import { verifyAccessToken } from '../server/auth/tokens';
import { PgChefGameplayStore } from '../server/gameplay/store';
import {
  reconcileRoamingStateWithInventory,
  type RoamingConsumableState,
} from '../lib/consumables/roamingConsumableEngine';
import { computeLoadoutDps } from '../lib/stats/dpsChain';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { effectiveSkillPoints } from '../lib/skills/skillBonuses';
import { generateClassMod } from '../server/lib/generators/classModGenerator';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { getSkillTreeNodes } from '../constants/skillTrees';
import { REGION_1_BOSSES } from '../constants/bosses';
import { ConsumableType, DropSource, Element, Rarity, RiskSetting, SkillTreeType } from '../types/game';
import type { Ordnance, Weapon } from '../types/items';
import {
  CRAFTED_GEAR_MAX_VENDOR_VALUE,
  CRAFTED_RELIC_MAX_VENDOR_VALUE,
  computeItemEstimatedValue,
} from '../lib/vendor/catalog';
import { ALL_CRAFT_RECIPES, CRAFT_RELICS } from '../content/crafting';
import { computeRaceStandings } from '../server/leaderboards/fold';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed } from '../server/writes/store';
import { processRoamingClaim } from '../server/chef';

const SECRET = 'neon-audit-test-secret-32-chars!!';

function emptyRoamingState(): RoamingConsumableState {
  return {
    slots: [],
    tickIndex: 0,
  };
}

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  const base = generateWeapon({ level: 20, forcedRarity: Rarity.Rare, source: DropSource.WorldDrop });
  return { ...base, ...overrides };
}

describe('Neon Audit Hardening — Auth, Account Deletion & Player Reports', () => {
  const store = new InMemoryAuthStore();
  let baseUrl = '';
  let server: ReturnType<express.Express['listen']>;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountAuthRoutes(app, store, { jwtSecret: SECRET });
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects null/primitive JSON JWT payloads without throwing TypeError', () => {
    expect(verifyAccessToken(SECRET, 'bnVsbA.bnVsbA.sig').ok).toBe(false);
    expect(verifyAccessToken(SECRET, 'W10.W10.sig').ok).toBe(false);
    expect(verifyAccessToken(SECRET, 'NDI.NDI.sig').ok).toBe(false);
  });

  it('mounts POST /api/reports with JWT auth, self-report guard, UUID check, and 24h dedup', async () => {
    const u1Res = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST' });
    const u1 = await u1Res.json() as { accessToken: string; account: { id: string } };
    const u2Res = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST' });
    const u2 = await u2Res.json() as { accessToken: string; account: { id: string } };

    const noAuth = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportedAccountId: u2.account.id, context: 'leaderboard' }),
    });
    expect(noAuth.status).toBe(401);

    const selfRes = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.accessToken}` },
      body: JSON.stringify({ reportedAccountId: u1.account.id, context: 'leaderboard' }),
    });
    expect(selfRes.status).toBe(400);

    const badId = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.accessToken}` },
      body: JSON.stringify({ reportedAccountId: 'not-a-uuid', context: 'leaderboard' }),
    });
    expect(badId.status).toBe(400);

    const okRes = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.accessToken}` },
      body: JSON.stringify({ reportedAccountId: u2.account.id, context: 'leaderboard' }),
    });
    expect(okRes.status).toBe(200);
    const okBody = await okRes.json() as { ok: boolean; deduplicated: boolean };
    expect(okBody.ok).toBe(true);
    expect(okBody.deduplicated).toBe(false);

    const dupRes = await fetch(`${baseUrl}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${u1.accessToken}` },
      body: JSON.stringify({ reportedAccountId: u2.account.id, context: 'leaderboard' }),
    });
    expect(dupRes.status).toBe(200);
    const dupBody = await dupRes.json() as { ok: boolean; deduplicated: boolean };
    expect(dupBody.ok).toBe(true);
    expect(dupBody.deduplicated).toBe(true);
  });

  it('mounts POST /api/account/delete using JWT identity and revokes sessions', async () => {
    const gRes = await fetch(`${baseUrl}/api/auth/guest`, { method: 'POST' });
    const g = await gRes.json() as { accessToken: string; refreshToken: string; account: { id: string } };

    const unauth = await fetch(`${baseUrl}/api/account/delete`, { method: 'POST' });
    expect(unauth.status).toBe(401);

    const delRes = await fetch(`${baseUrl}/api/account/delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${g.accessToken}` },
    });
    expect(delRes.status).toBe(200);
    const delBody = await delRes.json() as { ok: boolean };
    expect(delBody.ok).toBe(true);

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${g.accessToken}` },
    });
    expect(meRes.status).toBe(401);

    const refRes = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: g.refreshToken }),
    });
    expect(refRes.status).toBe(401);
  });
});

describe('Neon Audit Hardening — PgChefGameplayStore.holdOfflineItems serialization', () => {
  it('serializes items and receipts arrays with JSON.stringify for jsonb params', async () => {
    const calls: Array<{ sql: string; params: unknown[] | undefined }> = [];
    const fakePool = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [{ ok: true }] };
      },
    };
    const store = new PgChefGameplayStore(fakePool as never);
    await store.holdOfflineItems(
      '00000000-0000-0000-0000-000000000001',
      'nonce-1',
      [{ id: 'i1' }] as unknown as import('../server/gameplay/store').Json,
      [{ item_id: 'i1' }] as unknown as import('../server/gameplay/store').Json,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toContain('$3::jsonb');
    expect(calls[0].sql).toContain('$4::jsonb');
    expect(typeof calls[0].params?.[2]).toBe('string');
    expect(typeof calls[0].params?.[3]).toBe('string');
    expect(JSON.parse(calls[0].params?.[2] as string)).toEqual([{ id: 'i1' }]);
  });
});

describe('Neon Audit Hardening — Roaming Consumables & Multi-Tick Enforcement', () => {
  it('reconciles depleted Med Kit buffer when inventory is restocked', () => {
    const state: RoamingConsumableState = {
      slots: [
        {
          slot: 'Emergency',
          consumableId: ConsumableType.MedKit,
          family: 'survival',
          activatedAtTick: 1,
          expiresAtTick: 0,
          remainingBuffer: 0,
          remainingRegenTicks: 0,
          armed: false,
          remainingBurstTicks: 0,
          ordnanceNextFireTick: 0,
          bufferCountSnapshot: 0,
        },
      ],
      tickIndex: 5,
    };
    const reconciled = reconcileRoamingStateWithInventory(
      state,
      { MedKit: 3 },
      5,
      undefined,
      { maxHp: 500, shieldCapacity: 0 },
    );
    const medSlot = reconciled.slots.find((s) => s.consumableId === ConsumableType.MedKit);
    expect(medSlot).toBeDefined();
    expect(medSlot!.remainingBuffer).toBeGreaterThan(0);
    expect(medSlot!.bufferCountSnapshot).toBe(3);
  });

  it('decrements finite consumableInventory across multi-tick roaming claims', () => {
    const result = processRoamingClaim({
      playerId: 'p-1',
      areaId: 'dustwaste',
      ticks: 10,
      tickCount: 10,
      lastClaimedTick: 0,
      playerLevel: 10,
      survival: { currentHp: 500, maxHp: 500, shieldHp: 0 },
      consumableInventory: { AmmoPack: 1 },
      roamingConsumableState: emptyRoamingState(),
      masteryLevels: {},
      skillBonuses: {},
    });
    const ammoConsumed = result.consumedConsumables['AmmoPack'] ?? 0;
    expect(ammoConsumed).toBeLessThanOrEqual(1);
  });
});

describe('Neon Audit Hardening — Combat, DPS Chain & Boss Simulation', () => {
  it('caps consumable DPS stacking in computeLoadoutDps at 2.5x base', () => {
    const w = makeWeapon();
    const base = computeLoadoutDps([w]);
    const capped = computeLoadoutDps([w], [], [], {
      OverchargeStim: 10,
      AmmoPack: 10,
      IncendiaryAmmo: 10,
      ShockAmmo: 10,
      CorrosiveAmmo: 10,
      CryoAmmo: 10,
      VoidAmmo: 10,
    });
    expect(Number.isFinite(base)).toBe(true);
    expect(base).toBeGreaterThan(0);
    expect(Number.isFinite(capped)).toBe(true);
    expect(capped).toBeGreaterThan(base);
    expect(capped).toBeLessThanOrEqual(base * 2.5 + 1e-6);
  });

  it('returns dpsScore = 0 when fighting a boss with zero weapons equipped', () => {
    const boss = REGION_1_BOSSES[0];
    const sim = simulateBoss({
      boss,
      playerLevel: 50,
      primary: null,
      secondary: null,
      heavy: null,
      shield: null,
      ordnance: null,
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      skillBonuses: {},
    });
    expect(sim.dpsScore).toBe(0);
    expect(sim.winChance).toBeLessThan(0.5);
  });

  it('evaluates ordnance armor damage with armor element matchup (Corrosive >= Shock)', () => {
    const armoredBoss = REGION_1_BOSSES.find((b) => b.armor > 0) ?? REGION_1_BOSSES[0];
    const sharedWeapon = makeWeapon({ level: armoredBoss.level, element: Element.Kinetic });
    const baseOrd: Omit<Ordnance, 'element'> = {
      id: 'ord-1',
      name: 'Breach Charge',
      rarity: Rarity.Epic,
      level: 30,
      damage: 500,
      shieldDamage: 0,
      armorDamage: 1000,
      effect: 'Armor Breach',
      affixes: [],
      isLocked: false,
      sourceTag: DropSource.WorldDrop,
      pixelSeed: 1,
    };
    const corrosiveSim = simulateBoss({
      boss: armoredBoss,
      playerLevel: armoredBoss.level,
      primary: sharedWeapon,
      secondary: null,
      heavy: null,
      shield: null,
      ordnance: { ...baseOrd, element: Element.Corrosive },
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      skillBonuses: {},
    });
    const shockSim = simulateBoss({
      boss: armoredBoss,
      playerLevel: armoredBoss.level,
      primary: sharedWeapon,
      secondary: null,
      heavy: null,
      shield: null,
      ordnance: { ...baseOrd, element: Element.Shock },
      classMod: null,
      relic: null,
      consumables: {},
      risk: RiskSetting.Balanced,
      skillBonuses: {},
    });
    expect(corrosiveSim.breakScore).toBeGreaterThanOrEqual(shockSim.breakScore);
  });

  it('exposes pre-consumable baseSurvivalScore strictly below boosted survivalScore when MedKit is loaded', () => {
    const boss = REGION_1_BOSSES[0];
    const sim = simulateBoss({
      boss,
      playerLevel: boss.level,
      primary: makeWeapon({ level: boss.level }),
      secondary: null,
      heavy: null,
      shield: null,
      ordnance: null,
      classMod: null,
      relic: null,
      consumables: { MedKit: 1, ShieldCell: 1 },
      risk: RiskSetting.Balanced,
      skillBonuses: {},
    });
    expect(sim.baseSurvivalScore).toBeLessThan(sim.survivalScore);
  });
});

describe('Neon Audit Hardening — Skills & Class Mods', () => {
  it('applies treeBonus only to invested small nodes and allows nodeBoosts to exceed maxPoints', () => {
    const nodes = getSkillTreeNodes(SkillTreeType.Gunslinger);
    const small = nodes.find((n) => n.type === 'small')!;
    const major = nodes.find((n) => n.type === 'major')!;
    const keystone = nodes.find((n) => n.type === 'keystone')!;

    const effective = effectiveSkillPoints(
      { [small.id]: small.maxPoints },
      { treeBonus: SkillTreeType.Gunslinger, nodeBoosts: { [small.id]: 2 } },
    );

    expect(effective[major.id] ?? 0).toBe(0);
    expect(effective[keystone.id] ?? 0).toBe(0);
    expect(effective[small.id]).toBe(small.maxPoints + 2);
  });

  it('only generates class mod nodeBoosts belonging to the mod treeBonus tree', () => {
    for (let i = 0; i < 30; i++) {
      const mod = generateClassMod(25);
      const validIds = new Set(getSkillTreeNodes(mod.treeBonus as SkillTreeType).map((n) => n.id));
      for (const boostedNodeId of Object.keys(mod.nodeBoosts)) {
        expect(validIds.has(boostedNodeId)).toBe(true);
      }
    }
  });
});

describe('Neon Audit Hardening — Economy, Crafting & Leaderboards', () => {
  it('caps crafted relics to maxUnits=1 and clamps crafted gear/relic vendor values', () => {
    const relicIds = new Set(CRAFT_RELICS.map((r) => r.id));
    const relicRecipes = ALL_CRAFT_RECIPES.filter((r) => relicIds.has(r.id));
    expect(relicRecipes.length).toBeGreaterThanOrEqual(4);
    for (const r of relicRecipes) {
      expect(r.maxUnits).toBe(1);
    }

    const craftedRelicVal = computeItemEstimatedValue(
      { origin: 'crafted', name: 'Reclaimer Head', rarity: 'Legendary', level: 50 },
      'relic',
      'Legendary',
      50,
    );
    expect(craftedRelicVal).toBeLessThanOrEqual(CRAFTED_RELIC_MAX_VENDOR_VALUE);

    const craftedWeaponVal = computeItemEstimatedValue(
      { origin: 'crafted', name: 'Crafted Pistol', weaponType: 'Pistol', rarity: 'Epic', level: 50 },
      'weapon',
      'Epic',
      50,
    );
    expect(craftedWeaponVal).toBeLessThanOrEqual(CRAFTED_GEAR_MAX_VENDOR_VALUE);
  });

  it('rejects <50 cr wash trades and self-trades in market_sales leaderboard fold', () => {
    const start = '2026-11-16T00:00:00.000Z';
    const end = '2026-11-23T00:00:00.000Z';
    const ts = '2026-11-18T12:00:00.000Z';
    const standings = computeRaceStandings(
      {
        profiles: [
          { id: 'seller-1', username: 'SellerOne', created_at: '2026-01-01T00:00:00.000Z' },
        ],
        ledger: [
          {
            user_id: 'buyer-2',
            action_type: 'cc_accept_listing',
            created_at: ts,
            result_payload: { listing: { seller_user_id: 'seller-1', price_credits: 1 } },
          },
          {
            user_id: 'seller-1',
            action_type: 'cc_accept_listing',
            created_at: ts,
            result_payload: { listing: { seller_user_id: 'seller-1', price_credits: 500 } },
          },
          {
            user_id: 'buyer-2',
            action_type: 'cc_accept_listing',
            created_at: ts,
            result_payload: { listing: { seller_user_id: 'seller-1', price_credits: 50 } },
          },
        ],
        endlessRuns: [],
      },
      'market_sales',
      start,
      end,
    );
    expect(standings).toHaveLength(1);
    expect(standings[0].value).toBe(1);
  });

  it('protects benched hunters equipped gear during recycleBatch', async () => {
    const userId = '00000000-0000-0000-0000-000000000099';
    const seed = emptyWriteSeed();
    seed.profiles.push({
      id: userId,
      username: 'Tester',
      display_name: null,
      player_level: 20,
      player_xp: 0,
      credits: 1000,
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
      active_hunter_id: 'rook_valen',
      hunter_loadouts: { vesper_cole: { primary: 'benched-gun' }, rook_valen: {} },
    } as never);
    seed.items.push(
      {
        id: 'benched-gun',
        owner_user_id: userId,
        kind: 'weapon',
        static_item_id: null,
        item_level: 10,
        rarity: 'Common',
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
        runtime_state: 'available',
        is_locked: false,
        equipped_slot: null,
        estimated_value: 500,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
        payload: { name: 'Benched Gun', weaponType: 'Pistol', rarity: 'Common', level: 10, isLocked: false },
      },
      {
        id: 'spare-gun',
        owner_user_id: userId,
        kind: 'weapon',
        static_item_id: null,
        item_level: 10,
        rarity: 'Common',
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
        runtime_state: 'available',
        is_locked: false,
        equipped_slot: null,
        estimated_value: 500,
        created_at: '2026-10-01T00:00:00.000Z',
        updated_at: '2026-10-01T00:00:00.000Z',
        payload: { name: 'Spare Gun', weaponType: 'Pistol', rarity: 'Common', level: 10, isLocked: false },
      },
    );
    const store = new InMemoryWriteStore(seed);

    const res = await store.recycleBatch(userId, 'nonce-batch-1', 'Common') as { scrapped_count: number };
    expect(res.scrapped_count).toBe(1);
    const remainingIds = store.seed.items.filter((i) => i.owner_user_id === userId && i.runtime_state === 'available').map((i) => i.id);
    expect(remainingIds).toContain('benched-gun');
    expect(remainingIds).not.toContain('spare-gun');
  });
});
