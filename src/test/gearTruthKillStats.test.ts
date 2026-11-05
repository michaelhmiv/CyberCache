/**
 * Gear-truth slice — kill attribution and the Profile kill maps.
 *
 * Two defects made every kill "unarmed" and Profile's Top Weapon
 * Types read "No data yet" beside a full server breakdown:
 *   1. recordKillStats looked for a weapon in equipped_slot =
 *      'weapon' — a slot that has never existed (weapons equip to
 *      primary/secondary/heavy), so the server kill record filled
 *      with 'unarmed' for every hunter, geared or not.
 *   2. The stats summary read kills_by_weapon_type from the
 *      client-mirrored combat row, whose recordKill calls never
 *      carried a weapon type — instead of the server kill record
 *      the Lifetime panel prints from.
 * The SQL twin of (1) (cc_record_kill_stats) needs a migration
 * restatement and is tracked as this slice's follow-up; the
 * in-memory twin and both stats reads are pinned here.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryChefGameplayStore } from '@/server/gameplay/memory';
import { InMemoryReadStore, emptyReadSeed } from '@/server/reads/store';
import { buildStarterWeaponPayload } from '@/server/lib/starterWeapon';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STARTER_ROW = '11111111-2222-3333-4444-555555555555';

const SPARSE_SEED = {
  id: '99999999-8888-7777-6666-555555555555',
  name: 'Starter Pistol',
  weaponType: 'Pistol',
  element: 'Kinetic',
  manufacturer: 'Redline',
  rarity: 'Common',
  level: 1,
  combatPower: 5,
  bossPower: 3,
  dps: 5,
  sourceTag: 'Starter Kit',
};

describe('recordKillStats weapon attribution (gameplay twin)', () => {
  it('a fresh guest’s kills attribute to the Starter Pistol, not unarmed', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 1, credits: 0, scrap: 0 });
    store.seedItem({
      id: STARTER_ROW,
      owner_user_id: A,
      kind: 'weapon',
      runtime_state: 'equipped',
      equipped_slot: 'primary',
      payload: { ...SPARSE_SEED },
    });
    await store.applyChefRewards(
      A,
      { credits: 0, scrap: 0, xp: 0, keys: 0, materials: {}, essences: {}, kills: 5 },
      1,
      'dustwaste_frontier',
    );
    expect(store.killStatsFor(A)).toEqual({ Pistol: 5 });
    expect(store.killElementStatsFor(A)).toEqual({ Kinetic: 5 });
  });

  it('slot order wins: a lone secondary attributes, a primary outranks it', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 5, credits: 0, scrap: 0 });
    store.seedItem({
      id: 'sec-1',
      owner_user_id: A,
      kind: 'weapon',
      runtime_state: 'equipped',
      equipped_slot: 'secondary',
      payload: { weaponType: 'SMG', element: 'Shock' },
    });
    await store.applyChefRewards(
      A,
      { credits: 0, scrap: 0, xp: 0, keys: 0, materials: {}, essences: {}, kills: 3 },
      1,
      'dustwaste_frontier',
    );
    expect(store.killStatsFor(A)).toEqual({ SMG: 3 });

    store.seedItem({
      id: 'prim-1',
      owner_user_id: A,
      kind: 'weapon',
      runtime_state: 'equipped',
      equipped_slot: 'primary',
      payload: buildStarterWeaponPayload('prim-1'),
    });
    await store.applyChefRewards(
      A,
      { credits: 0, scrap: 0, xp: 0, keys: 0, materials: {}, essences: {}, kills: 2 },
      2,
      'dustwaste_frontier',
    );
    expect(store.killStatsFor(A)).toEqual({ SMG: 3, Pistol: 2 });
  });

  it('a truly weaponless hunter still records unarmed', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 1, credits: 0, scrap: 0 });
    await store.applyChefRewards(
      A,
      { credits: 0, scrap: 0, xp: 0, keys: 0, materials: {}, essences: {}, kills: 4 },
      1,
      'dustwaste_frontier',
    );
    expect(store.killStatsFor(A)).toEqual({ unarmed: 4 });
  });
});

describe('stats summary kill maps (reads twin)', () => {
  it('kills_by_weapon_type comes from the server kill record, not the empty mirror map', async () => {
    const seed = emptyReadSeed();
    seed.profiles = [{
      id: A, username: 'guest', display_name: 'Guest', player_level: 1, player_xp: 0,
      credits: 0, cache_tokens: 0, cache_token_parts: 0, materials: {},
      created_at: '2026-11-04T00:00:00.000Z', updated_at: '2026-11-04T00:00:00.000Z',
    } as never];
    seed.combatStats = [{
      user_id: A, total_kills: 12, total_deaths: 0, longest_kill_streak: 12, highest_boss_tier: 0,
      active_play_seconds: 0, idle_play_seconds: 0,
      kills_by_area: { dustwaste_frontier: 12 }, kills_by_weapon_type: {}, kills_by_element: {},
    } as never];
    seed.killStats = [{ user_id: A, weapon_type: 'Pistol', kills: 12 }];
    seed.killElementStats = [{ user_id: A, element: 'Kinetic', kills: 12 }];
    const store = new InMemoryReadStore(seed);
    const stats = await store.getMyStats(A);
    expect(stats).not.toBeNull();
    expect(stats!.total_kills).toBe(12);
    expect(stats!.kills_by_weapon_type).toEqual({ Pistol: 12 });
    expect(stats!.kills_by_element).toEqual({ Kinetic: 12 });
    // The lifetime fold prints the same record — the two surfaces agree.
    const lifetime = await store.getProfileStats(A);
    expect(lifetime!.kills.by_weapon_type).toEqual({ Pistol: 12 });
  });
});
