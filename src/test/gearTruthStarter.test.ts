/**
 * Gear-truth slice — the Starter Pistol repair.
 *
 * The bootstrap seed row (migration 0004) stores a sparse payload
 * with no combat numbers; every truth surface rejects that shape,
 * so a fresh guest played "unarmed" everywhere while the server
 * insisted a pistol was equipped. These tests pin the repair: the
 * Chef materializes the real generated weapon (deterministically,
 * from the shared generator) before any read serves it.
 */
import { describe, expect, it } from 'vitest';
import {
  buildStarterWeaponPayload,
  isSparseStarterPayload,
  STARTER_SOURCE_TAG,
  STARTER_WEAPON_NAME,
} from '@/server/lib/starterWeapon';
import { isUsableWeaponPayload } from '@/server/gameplay/serverLoadout';
import { serverItemRowToDisplayGear } from '@/lib/api/serverItemAdapter';
import { computeStandardDps } from '@/lib/stats/dpsChain';
import { InMemoryReadStore, emptyReadSeed } from '@/server/reads/store';
import { InMemoryChefGameplayStore } from '@/server/gameplay/memory';
import type { Weapon } from '@/types/items';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ROW_ID = '11111111-2222-3333-4444-555555555555';

/** The seed payload EXACTLY as cc_seed_starter_weapon writes it. */
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

describe('starter weapon payload', () => {
  it('detects the sparse seed shape — and only that shape', () => {
    expect(isSparseStarterPayload(SPARSE_SEED)).toBe(true);
    expect(isSparseStarterPayload(buildStarterWeaponPayload(ROW_ID))).toBe(false);
    // A sparse payload from any other provenance is corrupt data,
    // not the starter: it must keep failing the guards.
    expect(isSparseStarterPayload({ weaponType: 'Pistol' })).toBe(false);
    expect(isSparseStarterPayload(null)).toBe(false);
    expect(isSparseStarterPayload({ sourceTag: STARTER_SOURCE_TAG })).toBe(false);
  });

  it('builds a real weapon: every required field present and numeric', () => {
    const payload = buildStarterWeaponPayload(ROW_ID);
    expect(payload.id).toBe(ROW_ID);
    expect(payload.name).toBe(STARTER_WEAPON_NAME);
    expect(payload.sourceTag).toBe(STARTER_SOURCE_TAG);
    expect(payload.weaponType).toBe('Pistol');
    expect(payload.manufacturer).toBe('Redline');
    expect(payload.element).toBe('Kinetic');
    expect(payload.rarity).toBe('Common');
    expect(payload.level).toBe(1);
    for (const field of ['baseDamage', 'attackSpeed', 'critChance', 'critDamage', 'combatPower', 'bossPower', 'farmPower'] as const) {
      expect(typeof payload[field], field).toBe('number');
    }
    // The engines price it (no longer an empty slot)…
    expect(isUsableWeaponPayload(payload as unknown as Weapon)).toBe(true);
    // …the client adapter displays it (no longer hidden)…
    const gear = serverItemRowToDisplayGear({
      id: ROW_ID,
      payload,
      is_locked: false,
      runtime_state: 'equipped',
      equipped_slot: 'primary',
    });
    expect(gear).not.toBeNull();
    expect(gear!.name).toBe(STARTER_WEAPON_NAME);
    // …and its stamped combatPower is the DPS chain's own score,
    // the same agreement every generated weapon carries.
    const weapon = payload as unknown as Weapon;
    expect(weapon.combatPower).toBe(Math.round(computeStandardDps(weapon)));
    expect(weapon.combatPower).toBeGreaterThan(0);
  });

  it('is deterministic per row id — every store repairs to the same weapon', () => {
    expect(buildStarterWeaponPayload(ROW_ID)).toEqual(buildStarterWeaponPayload(ROW_ID));
    expect(buildStarterWeaponPayload('aaaaaaaa-0000-0000-0000-000000000000')).not.toEqual(
      buildStarterWeaponPayload(ROW_ID),
    );
  });
});

describe('starter repair at the store reads', () => {
  it('the reads twin serves the repaired starter from getMyRuntimeItems', async () => {
    const seed = emptyReadSeed();
    seed.items = [
      {
        id: ROW_ID,
        owner_user_id: A,
        kind: 'weapon',
        item_level: 1,
        rarity: 'Common',
        is_locked: false,
        runtime_state: 'equipped',
        equipped_slot: 'primary',
        payload: { ...SPARSE_SEED },
        created_at: '2026-11-04T00:00:00.000Z',
      } as never,
    ];
    const store = new InMemoryReadStore(seed);
    const rows = await store.getMyRuntimeItems(A);
    expect(rows).toHaveLength(1);
    expect(isSparseStarterPayload(rows[0].payload)).toBe(false);
    expect((rows[0].payload as Record<string, unknown>).name).toBe(STARTER_WEAPON_NAME);
    // A second read is a no-op (already whole) and returns the
    // identical payload — the repair is stable, not a re-roll.
    const again = await store.getMyRuntimeItems(A);
    expect(again[0].payload).toEqual(rows[0].payload);
  });

  it('the gameplay twin derives the starter as the equipped primary', async () => {
    const store = new InMemoryChefGameplayStore();
    store.seedProfile({ id: A, player_level: 1, credits: 0, scrap: 0 });
    store.seedItem({
      id: ROW_ID,
      owner_user_id: A,
      kind: 'weapon',
      runtime_state: 'equipped',
      equipped_slot: 'primary',
      payload: { ...SPARSE_SEED },
    });
    const entries = await store.getEquippedItems(A);
    expect(entries).toHaveLength(1);
    expect(entries[0].slot).toBe('primary');
    expect(isUsableWeaponPayload(entries[0].item)).toBe(true);
    expect(entries[0].item.name).toBe(STARTER_WEAPON_NAME);
  });
});
