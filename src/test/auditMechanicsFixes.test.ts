/**
 * Regression tests for the verified mechanics fixes extracted from the
 * PR #646 audit (extraction PR 2 of 3 — mechanics). Ported from #646's
 * neonAuditHardening suite, keeping only the tests whose behavior this
 * PR actually ships:
 * - holdOfflineItems jsonb serialization (gameplay/store)
 * - Med Kit buffer reconciliation on restock (roamingConsumableEngine)
 * - finite consumableInventory decrement across multi-tick claims (chef)
 * - unarmed dpsScore = 0, ordnance 'armor' matchup, pre-consumable
 *   baseSurvivalScore (bossSimulator)
 * - benched hunters' gear excluded from batch salvage (writes/memory)
 */
import { describe, expect, it } from 'vitest';
import { PgChefGameplayStore } from '../server/gameplay/store';
import {
  reconcileRoamingStateWithInventory,
  type RoamingConsumableState,
} from '../lib/consumables/roamingConsumableEngine';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { REGION_1_BOSSES } from '../constants/bosses';
import { ConsumableType, DropSource, Element, Rarity, RiskSetting } from '../types/game';
import type { Ordnance, Weapon } from '../types/items';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed } from '../server/writes/store';
import { processRoamingClaim } from '../server/chef';

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

describe('Audit fixes — PgChefGameplayStore.holdOfflineItems serialization', () => {
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

describe('Audit fixes — Roaming Consumables & Multi-Tick Enforcement', () => {
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

describe('Audit fixes — Boss Simulation', () => {
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

describe('Audit fixes — Economy & Crafting', () => {
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
