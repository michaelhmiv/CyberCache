/**
 * Audit fix A — "Truth in numbers" (2026-11-01 UX audit backlog 1–3).
 *
 * Pins the six evidence items at their owning layers:
 *  - CONS-02: a boss victory whose resolution did not fully apply
 *    must not persist as a victory — the loot now rides the applier
 *    (migration 0040, one transaction), and the lifetime fold counts
 *    a victory only when the boss discovery proves it landed.
 *  - CONS-04: one collection counting rule — vehicles excluded, the
 *    sparse bootstrap starter weapon excluded — across the public
 *    stats fold and the trophy shelf.
 *  - COPY-01: the verify-boss response itemizes the ACTUAL ledger
 *    deltas (gross reward, server-classified fee kind, level span).
 *  - CONS-03 / DISP-03 units live here too (activity builder labels;
 *    celebration figures == card figures).
 *
 * Route tests drive the shipped handler over HTTP against the
 * in-memory store (the repo's harness pattern), with outcomes
 * precomputed through the Chef engine itself — never a coin flip.
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { processBossAttempt, type BossAttemptChefResult, type BossAttemptRequest } from '../server/chef';
import { mountChefHealthRoute, mountGameplayRoutes } from '../server/gameplay/routes';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import {
  InMemoryReadStore, emptyReadSeed,
  type MemItem, type ProfileRowData, type ReadSeed,
} from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';
import { utcDayStartIso } from '@/lib/bossFees';
import { buildBossFightActivity } from '@/lib/activity/activityBuilders';
import { migrateActivityForBossCollapse } from '@/lib/activity/activityMigration';
import { isBossPhase } from '@/types/activity';
import { lootStatLine, weaponStatFigures } from '@/lib/pixel/lootMoment';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111';

// ---------------------------------------------------------------------------
// HTTP harness (same pattern as bossLoopShippedPath.test.ts)
// ---------------------------------------------------------------------------

interface Harness {
  store: InMemoryChefGameplayStore;
  base: string;
  tokenA: string;
}

const openServers: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (openServers.length) await openServers.pop()?.();
});

async function makeServer(store = new InMemoryChefGameplayStore()): Promise<Harness> {
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

interface VerifyBossHttpResult {
  verified?: boolean;
  victory?: boolean;
  entryFee?: number;
  creditsDelta?: number;
  creditsReward?: number;
  feeKind?: 'entry' | 'rematch' | null;
  levelBefore?: number;
  levelAfter?: number;
  idempotentReplay?: boolean;
  error?: string;
  items?: Array<{ id: string; sourceTag: string }>;
}

async function post(base: string, path: string, body: unknown, token?: string): Promise<{ status: number; json: VerifyBossHttpResult }> {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as VerifyBossHttpResult };
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

function findNonce(base: Omit<BossAttemptRequest, 'attemptNonce'>, predicate: (r: BossAttemptChefResult) => boolean): { nonce: number; expected: BossAttemptChefResult } {
  for (let nonce = 1; nonce <= 2000; nonce++) {
    const result = processBossAttempt({ ...base, attemptNonce: nonce });
    if (predicate(result)) return { nonce, expected: result };
  }
  throw new Error('no matching nonce found');
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

const duneRequest = (over: Partial<BossAttemptRequest> = {}): Omit<BossAttemptRequest, 'attemptNonce'> => ({
  playerId: A,
  bossId: 'dune_tyrant',
  primary: strongWeapon(),
  secondary: null,
  heavy: null,
  ordnance: null,
  shield: null,
  classMod: null,
  relic: null,
  consumables: {},
  risk: RiskSetting.Balanced,
  playerLevel: 20,
  skillBonuses: {},
  pityCount: 0,
  playerCredits: 10000,
  entryFee: 0,
  ...over,
});

// ---------------------------------------------------------------------------
// COPY-01 — the response itemizes the actual ledger deltas
// ---------------------------------------------------------------------------

describe('COPY-01 — verify-boss response itemization', () => {
  it('free first entry: feeKind is null, the reward line is the whole delta, no fee is invented', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({
      id: A,
      player_level: 20,
      credits: 10000,
      boss_state: { unlockedBossIds: ['dune_tyrant'], defeatedBossIds: [], pityCounters: {} },
    });
    seedStrongWeapon(store);
    const { nonce, expected } = findNonce(duneRequest(), (r) => r.result.victory);

    const res = await post(base, '/api/verify-boss', {
      playerId: A, bossId: 'dune_tyrant', attemptNonce: nonce, consumables: {}, risk: RiskSetting.Balanced,
    }, tokenA);

    expect(res.status).toBe(200);
    expect(res.json.victory).toBe(true);
    // Dune Tyrant's first entry is FREE (entryCost 0): the walk's panel
    // captioned exactly this case as a "400cr rematch fee".
    expect(res.json.entryFee).toBe(0);
    expect(res.json.feeKind).toBeNull();
    expect(res.json.creditsDelta).toBe(expected.creditsDelta);
    expect(res.json.creditsReward).toBe(expected.creditsDelta);
    expect(res.json.levelBefore).toBe(20);
    expect(res.json.levelAfter).toBeGreaterThanOrEqual(20);
    // The balance moved by exactly the reported net — nothing unexplained.
    expect(store.profiles.get(A)!.credits).toBe(10000 + expected.creditsDelta);
  });

  it('rematch: feeKind classifies from server records and the reward excludes the fee', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({
      id: A,
      player_level: 20,
      credits: 10000,
      boss_state: { unlockedBossIds: ['dune_tyrant'], defeatedBossIds: ['dune_tyrant'], pityCounters: {} },
    });
    seedStrongWeapon(store);
    // Rematch base fee 100, no victories yet today → charged exactly 100.
    const { nonce, expected } = findNonce(duneRequest({ entryFee: 100 }), (r) => r.result.victory);

    const res = await post(base, '/api/verify-boss', {
      playerId: A, bossId: 'dune_tyrant', attemptNonce: nonce, consumables: {}, risk: RiskSetting.Balanced,
    }, tokenA);

    expect(res.status).toBe(200);
    expect(res.json.entryFee).toBe(100);
    expect(res.json.feeKind).toBe('rematch');
    expect(res.json.creditsDelta).toBe(expected.creditsDelta);
    expect(res.json.creditsReward).toBe(expected.creditsDelta + 100);
    expect(store.profiles.get(A)!.credits).toBe(10000 + expected.creditsDelta);
  });
});

// ---------------------------------------------------------------------------
// CONS-02 — atomic recording: a loot-store failure leaves NO attempt behind
// ---------------------------------------------------------------------------

describe('CONS-02 — attempt + rewards + loot commit or roll back together', () => {
  it('attempt-recorded-but-rewards-not-applied can no longer happen: sabotaged loot storage 500s with zero persistence', async () => {
    const { base, store, tokenA } = await makeServer();
    store.seedProfile({
      id: A,
      player_level: 20,
      credits: 10000,
      boss_state: { unlockedBossIds: ['dune_tyrant'], defeatedBossIds: [], pityCounters: {} },
    });
    seedStrongWeapon(store);
    const { nonce, expected } = findNonce(duneRequest(), (r) => r.result.victory && r.items.length > 0);
    const body = {
      playerId: A, bossId: 'dune_tyrant', attemptNonce: nonce, consumables: {}, risk: RiskSetting.Balanced,
    };

    // Simulate the 0039 incident: the item store raises mid-resolution.
    // Post-0040 the store call happens INSIDE applyChefBossAttempt, so
    // the failure must take the whole attempt down with it.
    const original = store.storeChefItems.bind(store);
    store.storeChefItems = async () => {
      throw new Error('simulated cc_store_chef_items failure');
    };
    const failed = await post(base, '/api/verify-boss', body, tokenA);
    expect(failed.status).toBe(500);

    // Nothing persisted: no credits moved, no defeat recorded, no
    // victory in the ledger the folds read, no loot rows.
    const profile = store.profiles.get(A)!;
    expect(profile.credits).toBe(10000);
    expect((profile.boss_state as { defeatedBossIds: string[] }).defeatedBossIds).toEqual([]);
    expect(await store.countBossVictoriesToday(A, 'dune_tyrant', utcDayStartIso())).toBe(0);
    expect(store.items.size).toBe(1); // only the seeded equipped weapon

    // The same nonce is NOT consumed by the failed attempt: with the
    // store healthy it applies cleanly, exactly once.
    store.storeChefItems = original;
    const ok = await post(base, '/api/verify-boss', body, tokenA);
    expect(ok.status).toBe(200);
    expect(ok.json.victory).toBe(true);
    expect(store.profiles.get(A)!.credits).toBe(10000 + expected.creditsDelta);
    expect(store.items.size).toBe(1 + expected.items.length);
    expect(await store.countBossVictoriesToday(A, 'dune_tyrant', utcDayStartIso())).toBe(1);
  });

  it('migration 0040 stores the loot inside the applier, before the ledger insert', () => {
    const sql = readFileSync(join(__dirname, '../..', 'db', 'migrations', '0040_audit_truth_in_numbers.sql'), 'utf8');
    // The 12-arg signature is dropped before the 13-arg create (the
    // overload guard's lesson), and the new parameter defaults empty.
    expect(sql).toContain('drop function if exists public.cc_apply_chef_boss_attempt(uuid, text, bigint, boolean, bigint, bigint, jsonb, jsonb, text, bigint, bigint, text);');
    expect(sql).toContain("_items jsonb default '[]'::jsonb");
    const storeIdx = sql.indexOf('perform public.cc_store_chef_items(_player_id, coalesce(_items');
    const ledgerIdx = sql.indexOf('insert into public.verified_action_ledger');
    expect(storeIdx).toBeGreaterThan(-1);
    expect(ledgerIdx).toBeGreaterThan(storeIdx);
    // The view carries the CONS-04 counting rule.
    expect(sql).toContain("ii.kind <> 'vehicle'");
    expect(sql).toContain("ii.payload -> 'baseDamage' is not null");
  });
});

// ---------------------------------------------------------------------------
// CONS-02 — the lifetime fold's victory gate
// ---------------------------------------------------------------------------

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 60, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 3, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function foldSeed(
  ledger: ReadSeed['ledger'],
  discoveries: ReadSeed['discoveries'],
): ReadSeed {
  const seed = emptyReadSeed();
  seed.profiles = [profile({ id: A })];
  seed.ledger = ledger;
  seed.discoveries = discoveries;
  return seed;
}

const victoryRow = (bossId: string, createdAt: string) => ({
  user_id: A,
  action_type: 'cc_apply_boss_attempt',
  result_payload: { boss_id: bossId, attempt: { victory: true } },
  created_at: createdAt,
});
const bossDiscoveryRow = (bossId: string, discoveredAt: string) => ({
  user_id: A, family: 'boss', entry_key: bossId, source: 'boss_victory', discovered_at: discoveredAt,
});

describe('CONS-02 — lifetime fold counts only proven victories', () => {
  it('replicates the walk: two victory rows whose resolutions never landed fold to 0 victories, 0 downed', async () => {
    const store = new InMemoryReadStore(foldSeed(
      [victoryRow('dune_tyrant', '2026-11-01T10:00:00.000Z'), victoryRow('dune_tyrant', '2026-11-01T10:05:00.000Z')],
      [],
    ));
    const stats = await store.getProfileStats(A);
    expect(stats!.bosses).toEqual({ attempts: 2, victories: 0, by_boss: {}, downed: 0 });
  });

  it('a victory proven by its discovery counts, and agrees with downed', async () => {
    const store = new InMemoryReadStore(foldSeed(
      [victoryRow('dune_tyrant', '2026-11-01T10:00:00.000Z')],
      [bossDiscoveryRow('dune_tyrant', '2026-11-01T10:00:20.000Z')],
    ));
    const stats = await store.getProfileStats(A);
    expect(stats!.bosses).toEqual({ attempts: 1, victories: 1, by_boss: { dune_tyrant: 1 }, downed: 1 });
  });

  it('a phantom followed by a real downing of the same boss stays uncounted', async () => {
    const store = new InMemoryReadStore(foldSeed(
      [
        victoryRow('dune_tyrant', '2026-11-01T10:00:00.000Z'), // phantom (500'd later step)
        victoryRow('dune_tyrant', '2026-11-01T12:00:00.000Z'), // the real down
      ],
      [bossDiscoveryRow('dune_tyrant', '2026-11-01T12:00:20.000Z')],
    ));
    const stats = await store.getProfileStats(A);
    expect(stats!.bosses).toEqual({ attempts: 2, victories: 1, by_boss: { dune_tyrant: 1 }, downed: 1 });
  });

  it('rematch victories after the downing count (the discovery predates them)', async () => {
    const store = new InMemoryReadStore(foldSeed(
      [
        victoryRow('dune_tyrant', '2026-11-01T10:00:00.000Z'),
        victoryRow('dune_tyrant', '2026-11-02T10:00:00.000Z'),
      ],
      [bossDiscoveryRow('dune_tyrant', '2026-11-01T10:00:20.000Z')],
    ));
    const stats = await store.getProfileStats(A);
    expect(stats!.bosses).toEqual({ attempts: 2, victories: 2, by_boss: { dune_tyrant: 2 }, downed: 1 });
  });
});

// ---------------------------------------------------------------------------
// CONS-04 — one counting rule for the collection
// ---------------------------------------------------------------------------

describe('CONS-04 — collection counts exclude the phantom and the vehicle', () => {
  it('public stats + trophy shelf agree with the inventory surfaces', async () => {
    const seed = emptyReadSeed();
    seed.profiles = [profile({ id: A })];
    const numbers = {
      baseDamage: 120, attackSpeed: 1.4, critChance: 0.12,
      critDamage: 1.6, combatPower: 90, bossPower: 45, farmPower: 40,
    };
    const item = (over: Partial<MemItem> & { id: string }): MemItem => ({
      owner_user_id: A, kind: 'weapon', item_level: 1, rarity: 'Common', is_locked: false,
      runtime_state: 'available', equipped_slot: null, payload: {},
      created_at: '2026-10-01T00:00:00.000Z', ...over,
    } as MemItem);
    seed.items = [
      // The bootstrap starter row, exactly as cc_seed_starter_weapon
      // writes it: real row, sparse payload, no combat number set.
      item({
        id: 'starter-pistol', rarity: 'Legendary', item_level: 99,
        payload: {
          name: 'Starter Pistol', weaponType: 'Pistol', element: 'Kinetic',
          manufacturer: 'Redline', rarity: 'Common', level: 1,
          combatPower: 5, bossPower: 3, dps: 5, sourceTag: 'Starter Kit',
        },
      }),
      item({ id: 'w-1', rarity: 'Legendary', item_level: 40, payload: { weaponType: 'Sniper', ...numbers } }),
      item({ id: 'w-2', rarity: 'Epic', item_level: 30, payload: { weaponType: 'Rifle', ...numbers } }),
      item({ id: 'w-3', rarity: 'Rare', item_level: 20, payload: { weaponType: 'Shotgun', ...numbers } }),
      item({ id: 'shield-1', kind: 'shield', rarity: 'Rare', item_level: 15, payload: { hp: 300 } }),
      // A Legendary vehicle is a vehicle — reported on its own
      // surfaces, never as a collection item.
      item({ id: 'vehicle-1', kind: 'vehicle', rarity: 'Legendary', item_level: 50, payload: { name: 'Dune Skiff' } }),
    ];
    const store = new InMemoryReadStore(seed);

    const pub = await store.getPublicProfile(A);
    expect(pub).not.toBeNull();
    expect(pub!.total_items).toBe(4); // 3 weapons + 1 shield
    expect(pub!.weapons_owned).toBe(3);
    expect(pub!.legendary_items).toBe(1); // only w-1
    expect(pub!.highest_item_level).toBe(40); // not the pistol's 99 or the vehicle's 50

    const stats = await store.getProfileStats(A);
    expect(stats!.showcase.top_weapons.map((w) => w.id)).toEqual(['w-1', 'w-2', 'w-3']);
  });
});

// ---------------------------------------------------------------------------
// CONS-03 — the resolved activity phase (units; panel behavior is pinned
// in auditTruthPanel.test.tsx)
// ---------------------------------------------------------------------------

describe('CONS-03 — resolved phase labels the settled encounter', () => {
  const boss = REGION_1_BOSSES[0];

  it('builds terminal labels for victory and defeat, and the phase survives migration', () => {
    const victory = buildBossFightActivity(boss, undefined, 'resolved', 'victory');
    expect(victory.publicPayload.activity_label).toBe(`Defeated ${boss.name}`);
    expect(victory.notes).toBe(`Defeated ${boss.name}`);
    const defeat = buildBossFightActivity(boss, undefined, 'resolved', 'defeat');
    expect(defeat.publicPayload.activity_label).toBe(`Fell to ${boss.name}`);
    expect(isBossPhase('resolved')).toBe(true);
    const migrated = migrateActivityForBossCollapse({
      kind: 'boss_fight', bossPhase: 'resolved',
    } as Parameters<typeof migrateActivityForBossCollapse>[0]);
    expect((migrated as { bossPhase?: string }).bossPhase).toBe('resolved');
  });
});

// ---------------------------------------------------------------------------
// DISP-03 — celebration figures are the card figures
// ---------------------------------------------------------------------------

describe('DISP-03 — loot celebration renders the card figures', () => {
  const walkWeapon = (attackSpeed: number, critChance: number): Weapon => ({
    ...strongWeapon(),
    id: 'walk-weapon',
    baseDamage: 500,
    attackSpeed,
    critChance,
  });

  it('matches both walk openings exactly (1.47/6.7% and 1.18/9.5%)', () => {
    expect(lootStatLine(walkWeapon(1.47, 0.067))).toBe('Dmg 500 · Spd 1.47 · Crit 6.7%');
    expect(lootStatLine(walkWeapon(1.18, 0.095))).toBe('Dmg 500 · Spd 1.18 · Crit 9.5%');
    expect(weaponStatFigures(walkWeapon(1.47, 0.067))).toEqual({ dmg: '500', spd: '1.47', crit: '6.7%' });
  });
});
