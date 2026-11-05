/**
 * Wiring package (2026-11-04) — Grenade → Ordnance Charge merge and
 * migration 0078 pins.
 *
 * The merge (owner ruling on the consumable strategy audit): the
 * vendor staple "Grenade" duplicated OrdnanceCharge — same display
 * name, same paper effect, same 400cr — but the boss sim only counts
 * OrdnanceCharge units as ordnance uses. Now the vendor sells
 * OrdnanceCharge, the Grenade def is a legacy unobtainable ID kept
 * for save compatibility, and migration 0078 converts all Grenade
 * stock 1:1 (batches, profile counter, live listings).
 *
 * Layers pinned here:
 *  - defs + the derived TS vendor catalog (staples come from defs);
 *  - the shipped buy path: buying the staple yields units the boss
 *    sim counts as ordnance uses; 'Grenade' is no longer buyable;
 *  - migration 0078 source pins: chain heads, the catalog rows, the
 *    three conversion statements, the repair-enqueue rush block, and
 *    the cancel restatement (0069 body + the one ticket change,
 *    proven by strip-and-compare). The SQL itself is exercised
 *    against real Postgres in the parent's staging-first apply.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSUMABLES } from '../constants/consumables';
import { ConsumableType } from '../types/game';
import { VENDOR_ROTATION_DEFS, VENDOR_STAPLE_DEFS, vendorOfferFor } from '../lib/vendor/catalog';
import { simulateBoss } from '../lib/simulation/bossSimulator';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '../types/game';
import type { Ordnance, Weapon } from '../types/items';
import type { BossDef } from '../types/boss';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const BUYER = '22222222-2222-4222-8222-222222222222';
let nonceN = 0;
const nonce = () => `wiring-nonce-${++nonceN}-abcdefgh`;

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'wiring', display_name: null, player_level: 30, player_xp: 0,
    credits: 100_000, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {}, boss_state: {},
    last_idle_claim_at: null, last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: null,
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    legendary_cores: 0, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function makeStore(seedFn: (s: WriteSeed) => void) {
  const s = emptyWriteSeed();
  seedFn(s);
  return new InMemoryWriteStore(s, {
    now: () => new Date('2026-11-04T12:00:00.000Z'),
    rng: () => 0.5,
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
  });
}

describe('grenade merge — defs and the derived vendor catalog', () => {
  it('the Grenade def is legacy and unobtainable (not stocked, not craftable, not player-marketable)', () => {
    const grenade = CONSUMABLES[ConsumableType.Grenade];
    expect(grenade.implementationStatus).toBe('legacy');
    expect(grenade.market.vendorStocked).toBe(false);
    expect(grenade.market.craftable).toBe(false);
    expect(grenade.market.playerMarketAllowed).toBe(false);
    // The def itself survives so old saves and saved belts resolve.
    expect(grenade.name).toBe('Ordnance Charge');
  });

  it('Ordnance Charge is the vendor staple at the same 400cr', () => {
    const oc = CONSUMABLES[ConsumableType.OrdnanceCharge];
    expect(oc.market.vendorStocked).toBe(true);
    expect(oc.market.vendorPrice).toBe(400);
  });

  it('the TS catalog derives the merge: OrdnanceCharge is a staple, Grenade is in no pool', () => {
    expect(VENDOR_STAPLE_DEFS.map((c) => c.id)).toContain(ConsumableType.OrdnanceCharge);
    expect(VENDOR_STAPLE_DEFS.map((c) => c.id)).not.toContain(ConsumableType.Grenade);
    expect(VENDOR_ROTATION_DEFS.map((c) => c.id)).not.toContain(ConsumableType.OrdnanceCharge);
    expect(VENDOR_ROTATION_DEFS.map((c) => c.id)).not.toContain(ConsumableType.Grenade);
    expect(vendorOfferFor('Grenade', '2026-11-04')).toBeNull();
    expect(vendorOfferFor('OrdnanceCharge', '2026-11-04')?.unitPrice).toBe(400);
  });
});

describe('grenade merge — the shipped buy path yields sim-counted units', () => {
  it('buying the staple credits Ordnance Charge stock; buying Grenade is refused', async () => {
    const store = makeStore((s) => {
      s.profiles = [profile({ id: BUYER, credits: 10_000 })];
    });
    const bought = await store.vendorBuy(BUYER, nonce(), 'OrdnanceCharge', 2);
    expect(bought.item_key).toBe('OrdnanceCharge');
    expect(bought.total_price).toBe(800);
    expect(store.seed.profiles[0].consumables.OrdnanceCharge).toBe(2);
    const batch = store.seed.consumableBatches.find((b) => b.consumable_type === 'OrdnanceCharge');
    expect(batch?.quantity).toBe(2);

    await expect(store.vendorBuy(BUYER, nonce(), 'Grenade', 1)).rejects.toThrow(/Not offered by the vendor today/);
  });

  it('vendor-bought Ordnance Charge units are counted by the boss sim as ordnance uses', async () => {
    const store = makeStore((s) => {
      s.profiles = [profile({ id: BUYER, credits: 10_000 })];
    });
    await store.vendorBuy(BUYER, nonce(), 'OrdnanceCharge', 2);
    const owned = store.seed.profiles[0].consumables.OrdnanceCharge ?? 0;
    expect(owned).toBe(2);

    const weapon = (over: Partial<Weapon>): Weapon => ({
      id: 'w', name: 'W', level: 50, rarity: Rarity.Epic, weaponType: WeaponType.SMG,
      manufacturer: Manufacturer.Redline, element: Element.Kinetic, rollQuality: 75,
      baseDamage: 100, attackSpeed: 5, critChance: 0.2, critDamage: 1.5, statusChance: 0.1,
      statusDamage: 1, bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 1, armorDamageMod: 1,
      offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0, parts: [], affixes: [],
      legendaryEffectId: undefined, sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 0,
      combatPower: 0, bossPower: 0, farmPower: 0, economyScore: 0, ...over,
    });
    const ordnance: Ordnance = {
      id: 'o', name: 'O', level: 50, rarity: Rarity.Epic, damage: 0, shieldDamage: 50,
      armorDamage: 50, element: Element.Kinetic, effect: '', affixes: [],
      sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 0,
    };
    const boss: BossDef = {
      id: 'b', name: 'B', tier: 1, level: 10, health: 100000, shield: 1000, armor: 0, dps: 100,
      weaknesses: [], resistances: [],
      mechanic: { id: 'enrage', name: 'Enrage', description: '', checkType: 'dps' },
      tags: [], phases: [], recommendedPower: 100, entryCost: 0, rematchCost: 0,
      dropTable: [], dedicatedDrops: [],
    };
    const base = { secondary: null, heavy: null, ordnance, shield: null, classMod: null, relic: null, risk: RiskSetting.Balanced, boss, playerLevel: 10, skillBonuses: {} };
    const bare = simulateBoss({ ...base, primary: weapon({}), consumables: {} });
    const loaded = simulateBoss({ ...base, primary: weapon({}), consumables: { OrdnanceCharge: owned } });
    // 2 bought units x 50 shield damage over a 1000 shield = +0.10.
    expect(loaded.breakScore - bare.breakScore).toBeCloseTo(0.1, 6);
  });
});

// ---------------------------------------------------------------------------
// Migration 0078 — source pins
// ---------------------------------------------------------------------------

const MIGRATIONS = join(process.cwd(), 'db/migrations');
const sql0078 = readFileSync(join(MIGRATIONS, '0078_wiring_package.sql'), 'utf8');

function definersOf(fn: string): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => readFileSync(join(MIGRATIONS, f), 'utf8').includes(`create or replace function public.${fn}(`))
    .sort();
}

function fnBody(text: string, fn: string): string {
  const start = text.indexOf(`create or replace function public.${fn}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  return text.slice(start, text.indexOf('\n$$;\n', start));
}

describe('migration 0078 — chain heads and conversion pins', () => {
  it('0078 is the chain head for cc_vendor_catalog, cc_enqueue_repair_job and cc_cancel_craft_job', () => {
    expect(definersOf('cc_vendor_catalog').at(-1)).toBe('0078_wiring_package.sql');
    expect(definersOf('cc_enqueue_repair_job').at(-1)).toBe('0078_wiring_package.sql');
    expect(definersOf('cc_cancel_craft_job').at(-1)).toBe('0078_wiring_package.sql');
  });

  it('the catalog drops the Grenade row and makes OrdnanceCharge the staple', () => {
    const catalog = fnBody(sql0078, 'cc_vendor_catalog');
    expect(catalog).not.toContain("'Grenade'");
    expect(catalog).toContain("('OrdnanceCharge', 400, 'staple')");
    expect(catalog).not.toContain("('OrdnanceCharge', 400, 'rotation')");
  });

  it('stock conversion moves all three surfaces 1:1 (batches, counter map, live listings)', () => {
    expect(sql0078).toContain("set consumable_type = 'OrdnanceCharge'");
    expect(sql0078).toContain("where consumable_type = 'Grenade'");
    // Counter map: Grenade count added onto OrdnanceCharge, key dropped.
    expect(sql0078).toContain("public.cc_jsonb_add_int(\n           consumables, 'OrdnanceCharge',");
    expect(sql0078).toContain("- 'Grenade')");
    // Listings: only live ones, identity key recomputed from the new type.
    expect(sql0078).toContain("identity_key = public.cc_market_consumable_identity('OrdnanceCharge', quality_percent)");
    expect(sql0078).toContain("and status = 'active'");
    // History is not rewritten.
    expect(sql0078).not.toContain('update public.consumable_events');
  });

  it('the repair enqueue gains the rush block (drop old signature, ticket check, FIFO burn, formula, snapshot)', () => {
    expect(sql0078).toContain('drop function if exists public.cc_enqueue_repair_job(uuid, text, uuid, text, integer);');
    const body = fnBody(sql0078, 'cc_enqueue_repair_job');
    expect(body).toContain('p_use_rush_ticket boolean default false');
    expect(body).toContain("raise exception 'No Workshop Rush Ticket available'");
    expect(body).toContain("public.cc_consume_consumable_batch(actor, 'WorkshopRushTicket', 1,");
    expect(body).toContain('least(0.45 + v_rush_cap_bonus, 0.2 * coalesce(v_rush_quality, 100) / 100)');
    expect(body).toContain('v_rush_quality, v_rush_origin,');
    expect(body).toContain("'rushReduction', v_rush_reduction");
    expect(body).toContain('* (1 - v_rush_reduction)');
    // The Fixer keystone cap derivation matches the craft twin (0029).
    expect(body).toContain("public.cc_skill_effective_points(p.skill_spends, v_mod_payload, 'fix_keystone', 'Fixer', 1)");
  });

  it('the cancel restatement is the 0069 body plus ONLY the repair-branch ticket refund', () => {
    const sql0069 = readFileSync(join(MIGRATIONS, '0069_scrap_merge.sql'), 'utf8');
    const body0069 = fnBody(sql0069, 'cc_cancel_craft_job');
    let body0078 = fnBody(sql0078, 'cc_cancel_craft_job');
    // Strip the inserted ticket block (marker comment .. its end if;).
    const marker = body0078.indexOf('-- Rush ticket (0078)');
    expect(marker).toBeGreaterThanOrEqual(0);
    const blockStart = body0078.lastIndexOf('\n', body0078.lastIndexOf('    -- Rush ticket', marker)) + 1;
    const trueLine = body0078.indexOf('v_rush_refunded := true;', marker);
    const blockEnd = body0078.indexOf('    end if;\n', trueLine) + '    end if;\n'.length;
    body0078 = body0078.slice(0, blockStart) + body0078.slice(blockEnd);
    // Revert the repair branch's flag (first occurrence in the body).
    body0078 = body0078.replace("'rush_ticket_refunded', v_rush_refunded", "'rush_ticket_refunded', false");
    expect(body0078).toBe(body0069);
  });
});
