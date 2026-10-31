/**
 * Roaming variance mechanics (visual overhaul brief §2/§3) — events,
 * elites, hot area, signature materials, consumable functions, and the
 * AFK limiter, all through shipped paths (processRoamingClaim, the
 * content modules, the in-memory stores, the migration file itself).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { processRoamingClaim, type ClaimRequest } from '../server/chef';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import { ROAMING_AREAS, buildAreaWeaponDropOptions } from '@/constants/roamingAreas';
import {
  EVENT_VALUE_BUDGET_PCT,
  ROAMING_EVENTS_BY_AREA,
  eventValuePerTick,
  peekRoamingEvent,
  pickRoamingEvent,
  plainTickValue,
} from '@/content/roamingEvents';
import { hotAreaIdForDate, isHotArea, utcDayKey } from '@/content/hotArea';
import { effectiveOfflineCapHours, earnedOfflineCapHours } from '@/content/offlineCap';
import { activateFromInventory, processTick } from '@/lib/consumables/roamingConsumableEngine';
import { generateShield } from '../server/lib/generators/shieldGenerator';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { emptyWriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';
import { ConsumableType, DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import { MaterialType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { createTickRng } from '@/lib/rng/tickRng';

const PLAYER = '55555555-5555-4555-8555-555555555555';

function claimRequest(overrides: Partial<ClaimRequest> = {}): ClaimRequest {
  return {
    playerId: PLAYER,
    areaId: 'dustwaste_frontier',
    ticks: 20,
    tickCount: 5000,
    playerLevel: 30,
    effectiveDps: 5000,
    survival: { currentHp: 100000, maxHp: 100000, shieldHp: 0, mitigation: 0 },
    ...overrides,
  };
}

describe('roaming events — distribution + EV budget (§2.1/§2.2)', () => {
  it('every area ships exactly 4 named events', () => {
    for (const area of ROAMING_AREAS) {
      expect(ROAMING_EVENTS_BY_AREA[area.id]).toHaveLength(4);
    }
  });

  it('per-area event EV stays inside the anti-leak budget', () => {
    for (const area of ROAMING_AREAS) {
      const ev = eventValuePerTick(area);
      const budget = plainTickValue(area) * EVENT_VALUE_BUDGET_PCT;
      expect(ev, `${area.id} event EV ${ev.toFixed(3)} exceeds budget ${budget.toFixed(3)}`).toBeLessThanOrEqual(budget * 1.02);
    }
  });

  it('claims fire events near the 5% base rate, all from the area table', () => {
    let totalTicks = 0;
    let totalEvents = 0;
    const areaEventIds = new Set(ROAMING_EVENTS_BY_AREA.dustwaste_frontier.map((e) => e.id));
    for (let c = 0; c < 300; c++) {
      const result = processRoamingClaim(claimRequest({ ticks: 20, tickCount: 5000 + c * 20 }));
      totalTicks += 20;
      totalEvents += result.eventsFired.length;
      for (const fired of result.eventsFired) {
        expect(areaEventIds.has(fired.eventId)).toBe(true);
      }
    }
    const rate = totalEvents / totalTicks;
    expect(rate).toBeGreaterThan(0.032);
    expect(rate).toBeLessThan(0.075);
  });

  it('eventChanceBase 0 (economy lever) silences events entirely', () => {
    for (let c = 0; c < 20; c++) {
      const result = processRoamingClaim(
        claimRequest({ ticks: 20, tickCount: 9000 + c * 20, economy: { eventChanceBase: 0 } }),
      );
      expect(result.eventsFired).toHaveLength(0);
    }
  });

  it('the combined fragment faucet (base + events) stays in its band', () => {
    let fragments = 0;
    let ticks = 0;
    for (let c = 0; c < 200; c++) {
      const result = processRoamingClaim(claimRequest({ ticks: 50, tickCount: 20000 + c * 50 }));
      fragments += result.rewards.cacheFragmentsAwarded;
      ticks += 50;
    }
    const perThousand = (fragments / ticks) * 1000;
    // Base faucet is 8/1000 ticks; events add a second, budget-capped
    // stream (cache finds + storm doubling) — total must stay < 2.5x.
    expect(perThousand).toBeGreaterThan(3);
    expect(perThousand).toBeLessThan(20);
  });

  it('pickRoamingEvent only returns the area table; peek is pure', () => {
    const rngA = createTickRng(PLAYER, 'dustwaste_frontier:event', 42);
    const picked = pickRoamingEvent('dustwaste_frontier', rngA, {});
    expect(picked && ROAMING_EVENTS_BY_AREA.dustwaste_frontier.some((e) => e.id === picked.id)).toBe(true);
    const peek1 = peekRoamingEvent('dustwaste_frontier', createTickRng(PLAYER, 'dustwaste_frontier:event', 7), 1, {});
    const peek2 = peekRoamingEvent('dustwaste_frontier', createTickRng(PLAYER, 'dustwaste_frontier:event', 7), 1, {});
    expect(peek1?.id).toBe(peek2?.id);
  });
});

describe('hot area (§3.5)', () => {
  it('is deterministic per UTC day and rotates across days', () => {
    const morning = new Date('2026-10-31T01:00:00Z');
    const night = new Date('2026-10-31T23:30:00Z');
    expect(hotAreaIdForDate(morning)).toBe(hotAreaIdForDate(night));
    expect(utcDayKey(morning)).toBe('2026-10-31');
    const seen = new Set<string>();
    for (let d = 0; d < 21; d++) {
      seen.add(hotAreaIdForDate(new Date(Date.UTC(2026, 10, 1 + d))));
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
    for (const id of seen) expect(ROAMING_AREAS.some((a) => a.id === id)).toBe(true);
  });

  it('isHotArea agrees with hotAreaIdForDate', () => {
    const date = new Date('2026-11-05T12:00:00Z');
    const hot = hotAreaIdForDate(date);
    expect(isHotArea(hot, date)).toBe(true);
    const other = ROAMING_AREAS.find((a) => a.id !== hot)!;
    expect(isHotArea(other.id, date)).toBe(false);
  });
});

describe('named elites (§2.3)', () => {
  it('elite kills occur across seeded claims and pay the fragment bonus path', () => {
    // Claims chain kill-cycle state exactly like the live client does
    // (result.killCycle feeds the next request) — the elite is every
    // 4th rotation target, so a single short claim may never reach one.
    // DPS is server-derived from equippedGear (never the request's
    // self-reported number), so the claim carries a real weapon.
    const weapon = {
      id: 'overhaul-test-gun',
      name: 'Overhaul Test Gun',
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
    } as unknown as Weapon;
    let eliteKills = 0;
    let killCycle: ClaimRequest['killCycle'];
    for (let c = 0; c < 120; c++) {
      const result = processRoamingClaim(
        claimRequest({ ticks: 50, tickCount: 40000 + c * 50, killCycle, equippedGear: [weapon] }),
      );
      eliteKills += result.eliteKills;
      killCycle = result.killCycle;
    }
    expect(eliteKills).toBeGreaterThan(0);
  });

  it('the rarity floor holds: floored generator rolls never drop below Epic', () => {
    // The chef floors a drop by zeroing the sub-floor weights (its
    // shapedRarityWeights / shapedZoneWeights); the generators honor
    // zeroed weights exactly, which is the mechanism under test here.
    const floorWeights: Partial<Record<Rarity, number>> = {
      Common: 0,
      Uncommon: 0,
      Rare: 0,
      Epic: 60,
      Legendary: 8,
    };
    const rng = createTickRng(PLAYER, 'elite-floor-test', 1);
    const area = ROAMING_AREAS[0];
    for (let i = 0; i < 200; i++) {
      const shield = generateShield(20, rng, floorWeights);
      expect([Rarity.Epic, Rarity.Legendary]).toContain(shield.rarity);
      const options = buildAreaWeaponDropOptions(area, 20, rng);
      options.zoneWeights = { Common: 0, Uncommon: 0, Rare: 0, Epic: 60, Legendary: 8 };
      const weapon = generateWeapon(options, rng);
      expect([Rarity.Epic, Rarity.Legendary]).toContain(weapon.rarity);
    }
  });
});

describe('signature materials (§2.5)', () => {
  const SIGNATURE_HOME: Record<string, string> = {
    Siltglass: 'dustwaste_frontier',
    NitrocellGel: 'redline_circuit',
    HeartwoodResin: 'ironwood_bastion',
    ForgeheartIngots: 'blastforge_yards',
    PrismShards: 'prismatek_reactor',
    MagnetiteCores: 'throwtech_dumpnet',
    MycoSteelFiber: 'helixworks_labyrinth',
  };

  it('each signature material is found ONLY in its home area (through claims)', () => {
    // Signature substitution lives in the claim engine (its own
    // ':signature' stream replaces a material find in the home area),
    // so sourcing is asserted through processRoamingClaim itself.
    for (const area of ROAMING_AREAS) {
      const found = new Set<string>();
      for (let c = 0; c < 60; c++) {
        const result = processRoamingClaim(
          claimRequest({ areaId: area.id, ticks: 50, tickCount: 60000 + c * 50 }),
        );
        for (const key of Object.keys(result.rewards.materials)) found.add(key);
      }
      for (const [material, home] of Object.entries(SIGNATURE_HOME)) {
        if (home === area.id) {
          expect(found.has(material), `${material} should be findable in ${area.id}`).toBe(true);
        } else {
          expect(found.has(material), `${material} must never drop in ${area.id}`).toBe(false);
        }
      }
    }
  });

  it('the current migration material list matches the TS MaterialType enum exactly', () => {
    // 0023's whitelist was the 12-id era; migration 0024 (crafting
    // occupation) restated cc_market_create_material with the 20-id
    // list (refined + composite materials became tradeable). The pin
    // follows the LATEST restatement.
    const sql = readFileSync(join(process.cwd(), 'db/migrations/0024_crafting_occupation.sql'), 'utf8');
    const match = sql.match(/material_id not in \(([^)]+)\)/);
    expect(match).not.toBeNull();
    const sqlMaterials = (match![1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, '')).sort();
    const tsMaterials = Object.values(MaterialType).sort();
    expect(sqlMaterials).toEqual(tsMaterials);
  });

  it('signature materials are tradable through the market write path', async () => {
    const seed = emptyWriteSeed();
    const profile: ProfileRowData = {
      id: PLAYER,
      username: 'seller',
      display_name: null,
      player_level: 10,
      player_xp: 0,
      credits: 0,
      scrap: 0,
      cache_tokens: 0,
      cache_token_parts: 0,
      materials: { Siltglass: 3 },
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
    seed.profiles = [profile];
    const store = new InMemoryWriteStore(seed);
    const result = await store.marketCreateMaterial(PLAYER, 'sig-listing-1', MaterialType.Siltglass, 2, 150);
    expect(result).toBeTruthy();
    expect(JSON.stringify(result)).toContain('listing');
  });
});

describe('consumable functions (§2.6)', () => {
  const ctx = (inventory: Record<string, number>) => ({
    tickIndex: 1,
    currentHp: 100,
    maxHp: 100,
    inventory,
    masteryLevels: {},
  });

  it('Loot Beacon accumulates its event-chance bonus through the shipped engine path', () => {
    const inventory = { [ConsumableType.LootBeacon]: 1 };
    const state = activateFromInventory(inventory, 0);
    const mods = processTick(state, ctx(inventory)).mods;
    expect(mods.eventChanceBonus).toBeCloseTo(0.03, 6);
  });

  it('Data Skimmer re-weights finds and foreshadows', () => {
    const inventory = { [ConsumableType.DataSkimmer]: 1 };
    const state = activateFromInventory(inventory, 0);
    const mods = processTick(state, ctx(inventory)).mods;
    expect(mods.eventFindWeightBonus).toBeGreaterThan(0);
    expect(mods.eventForeshadow).toBe(true);
  });

  it('Salvage Contract applies to roaming with its material-event bonus', () => {
    const inventory = { [ConsumableType.SalvageContract]: 1 };
    const state = activateFromInventory(inventory, 0);
    const mods = processTick(state, ctx(inventory)).mods;
    expect(mods.materialEventYieldBonus).toBeGreaterThan(0);
  });
});

describe('AFK cap limiter (§3.6)', () => {
  it('a limiter below the earned cap wins', () => {
    expect(effectiveOfflineCapHours({ level: 80, bonusHours: 4, userCapHours: 1 })).toBe(1);
  });

  it('a limiter above the earned cap does not raise it', () => {
    expect(effectiveOfflineCapHours({ level: 10, userCapHours: 24 })).toBe(earnedOfflineCapHours(10));
    expect(earnedOfflineCapHours(10)).toBe(2);
  });

  it('no limiter: earned + keystone stands (16h at the top)', () => {
    expect(effectiveOfflineCapHours({ level: 80, bonusHours: 4 })).toBe(16);
  });

  it('the 24h ceiling binds any future cap source', () => {
    expect(effectiveOfflineCapHours({ level: 80, bonusHours: 24, userCapHours: null, ceilingHours: 24 })).toBe(24);
    expect(effectiveOfflineCapHours({ level: 80, bonusHours: 24, userCapHours: 20, ceilingHours: 24 })).toBe(20);
  });
});

describe('event recording (0023)', () => {
  it('the in-memory gameplay store logs events and grants elite mastery', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: PLAYER });
    const result = await store.recordRoamingEvents(PLAYER, {
      events: [{ eventId: 'dustwaste_buried_cache', family: 'cache' }],
      eliteKills: 2,
      areaId: 'dustwaste_frontier',
      tickCount: 6000,
    });
    expect(result).toBeTruthy();
    expect(store.roamingEventLog).toHaveLength(1);
    expect(store.roamingEventLog[0].eliteKills).toBe(2);
    const mastery = store.masteries.find((m) => m.mastery_id === 'combat.elite_kills');
    expect(mastery?.mastery_xp).toBe(200);
  });
});
