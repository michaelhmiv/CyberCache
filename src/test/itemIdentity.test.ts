/**
 * Item identity — the "Item not found on EVERY equip" device defect
 * (2026-11-01), and its migration pins.
 *
 * Mechanism (reproduced end-to-end over HTTP against the real server
 * + Postgres before this fix): the Chef generates an item payload
 * carrying the generator's id; the claim / settle-offline /
 * verify-boss routes hand that payload to the client, which upserts
 * it into the inventory as-is; but cc_store_chef_items stored the row
 * under a fresh gen_random_uuid(). The two id spaces never met, so
 * every id-addressed op on a session-earned item — equip first among
 * them — raised 'Item not found'. Only a cold /api/runtime/items
 * re-sync (row ids) masked it.
 *
 * Fix (migration 0047 + the twin below): the stored row takes the
 * payload's id when it is a well-formed uuid no row holds yet. These
 * tests pin the twin's half of the contract and the composed
 * behavior the device needs: the id a Chef delivery hands the client
 * is the id the write ops accept.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DropSource, Rarity } from '@/types/game';
import { generateWeapon } from '../server/lib/generators/weaponGenerator';
import { InMemoryChefGameplayStore } from '../server/gameplay/memory';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type ProfileRowData, type WriteItemData } from '../server/writes/store';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

// Deterministic RNG for the shared generator (same LCG family the
// boss suites use; the exact roll is irrelevant, the id is the point).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function profileRow(overrides: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: null, display_name: null, player_level: 5, player_xp: 0, credits: 0,
    scrap: 0, cache_tokens: 0, cache_token_parts: 0, materials: {}, essences: {},
    consumables: {}, skill_spends: {}, boss_state: {}, last_idle_claim_at: '2026-10-29T10:00:00.000Z',
    last_claimed_tick: 0, created_at: '2026-06-14T00:00:00.000Z', updated_at: '2026-10-28T00:00:00.000Z',
    account_type: 'verified', email: null, email_verified_at: '2026-06-14T00:00:00.000Z',
    verification_grace_expires_at: null, verification_reminder_last_seen_at: null,
    last_roaming_settled_at: null, last_settlement_nonce: null, offline_cap_hours: 2,
    username_updated_at: null, username_change_count: 0,
    ...overrides,
  } as ProfileRowData;
}

describe('item identity (0047) — Chef-delivered items are addressable by the delivered id', () => {
  it('storeChefItems stores the row under the payload id; the write store equips by that id', async () => {
    const gameplay = new InMemoryChefGameplayStore();
    gameplay.seedProfile({ id: A, player_level: 5, credits: 0, consumables: {} });
    const weapon = generateWeapon(
      { source: DropSource.WorldDrop, level: 5, forcedRarity: Rarity.Rare },
      lcg(4242),
    );
    await gameplay.storeChefItems(A, [weapon as unknown as Record<string, unknown>]);

    const stored = [...gameplay.items.values()].filter((i) => i.owner_user_id === A);
    expect(stored).toHaveLength(1);
    // THE pin: pre-fix the row id was a fresh randomUUID() and this
    // equality — the whole client/server identity contract — failed.
    expect(stored[0].id).toBe(weapon.id);
    expect((stored[0].payload as { id?: string }).id).toBe(weapon.id);

    // Compose with the write store over the same row (in production
    // both stores read one database): equip by the delivered id.
    const seed = emptyWriteSeed();
    seed.profiles = [profileRow({ id: A })];
    seed.items = [{
      id: stored[0].id, owner_user_id: A, kind: stored[0].kind,
      static_item_id: null, item_level: stored[0].item_level, rarity: stored[0].rarity ?? 'Common',
      quality: null, material_tier: null, condition_state: null,
      condition_current: stored[0].condition_current ?? null, condition_max: stored[0].condition_max ?? null,
      supply_mode: stored[0].supply_mode, source_id: null, creator_user_id: null,
      tradeable: stored[0].tradeable, account_bound: false, locked_until: null,
      payload: stored[0].payload, runtime_state: stored[0].runtime_state,
      is_locked: stored[0].is_locked, equipped_slot: null,
      estimated_value: stored[0].estimated_value,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    } as WriteItemData];
    const writes = new InMemoryWriteStore(seed);
    await writes.equipItem(A, 'identity-nonce-0001', weapon.id, 'primary');
    const after = writes.seed.items.find((i) => i.id === weapon.id);
    expect(after?.runtime_state).toBe('equipped');
    expect(after?.equipped_slot).toBe('primary');
  });

  it('a payload id already held by another row falls back to a fresh id instead of colliding', async () => {
    const gameplay = new InMemoryChefGameplayStore();
    gameplay.seedProfile({ id: A, player_level: 5, consumables: {} });
    gameplay.seedProfile({ id: B, player_level: 5, consumables: {} });
    const weapon = generateWeapon(
      { source: DropSource.WorldDrop, level: 5, forcedRarity: Rarity.Common },
      lcg(777),
    );
    await gameplay.storeChefItems(A, [weapon as unknown as Record<string, unknown>]);
    await gameplay.storeChefItems(B, [weapon as unknown as Record<string, unknown>]);
    const aRow = [...gameplay.items.values()].find((i) => i.owner_user_id === A);
    const bRow = [...gameplay.items.values()].find((i) => i.owner_user_id === B);
    expect(aRow?.id).toBe(weapon.id);
    expect(bRow).toBeDefined();
    expect(bRow?.id).not.toBe(weapon.id); // collision-free fallback; B's copy is row-addressed after sync
  });

  it('SQL pins: 0047 stores rows under the payload id; 0048 removes only the craft gate', () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
    const sql47 = read('db/migrations/0047_item_identity.sql');
    expect(sql47).toContain('coalesce(row_id, gen_random_uuid())');
    expect(sql47).not.toContain('gen_random_uuid(), actor, kind');

    const sql43 = read('db/migrations/0043_manufacturer_standing.sql');
    expect(sql43).toContain('can_use_player_economy'); // sanity: the gate existed in the base body
    const sql48 = read('db/migrations/0048_crafting_guest_access.sql');
    const body48 = sql48.slice(sql48.indexOf('create or replace function public.cc_enqueue_craft_job('));
    expect(body48).not.toContain('if not public.can_use_player_economy(actor)');
    expect(body46).not.toContain("raise exception 'Verified account required'");
    expect(body46).toContain('requiresStanding'); // the standing recipe gate survives — only the account gate went
  });
});
