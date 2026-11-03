/**
 * Gate-removal step 4 (migration 0061) — Workshop bench levels:
 *
 *   - 0061 restates cc_unlock_bench from 0024 with ONLY the hunter-
 *     level gate removed: the v_level assignment (Forge 15 / Lab 30)
 *     and the 'Bench % requires level %' refusal are gone. Every
 *     surviving refusal is byte-identical and pinned below:
 *     'All benches already unlocked', 'Insufficient credits',
 *     'Insufficient material VoidDust' — in that check order
 *     (credits before materials), with the atomic charges unchanged
 *     (Forge 5,000cr; Lab 25,000cr + 10 VoidDust).
 *   - The TS bench catalog carries no level gate either:
 *     CraftBenchDef has no unlockLevel field, and the in-memory
 *     twin's unlockCraftBench never reads player_level.
 *   - Behavior against the in-memory write twin: a level-1 player
 *     climbs the whole ladder on money + materials alone (exact-
 *     price Forge, then the Lab), a level-40 player who is broke
 *     is refused on credits — the level never speaks, at any level.
 *   - Client copy: neither the Workshop screen nor the readiness
 *     derivation references a bench unlock level anymore, and the
 *     error humanizer no longer translates the dead refusal.
 *   - Cross-system survivor: Research's Fabrication bench gates
 *     (Production Systems requires bench 2) read bench OWNERSHIP —
 *     pinned in gateRemovalStep3.test.ts, untouched here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CRAFT_BENCHES, benchDef } from '@/content/crafting';
import { humanizeWorkshopError } from '@/lib/workshop/errors';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const MIGRATION_0061 = readFileSync(
  join(process.cwd(), 'db', 'migrations', '0061_bench_unlock_levels.sql'),
  'utf8',
);
const WORKSHOP_SCREEN = readFileSync(
  join(process.cwd(), 'src', 'screens', 'WorkshopScreen.tsx'),
  'utf8',
);
const READINESS = readFileSync(
  join(process.cwd(), 'src', 'lib', 'workshop', 'readiness.ts'),
  'utf8',
);

const A = '11111111-1111-4111-8111-111111111111';
const T0 = new Date('2026-11-03T12:00:00.000Z').getTime();
let nonceCounter = 0;
const nonce = () => `step4-nonce-${++nonceCounter}`;

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'crafter', display_name: null, player_level: 1, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-11-03T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'crafter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {},
    ...over,
  } as ProfileRowData;
}

function makeStore(over: Partial<ProfileRowData> = {}) {
  const seed = emptyWriteSeed();
  seed.profiles = [profile({ id: A, ...over })];
  const store = new InMemoryWriteStore(seed, { now: () => new Date(T0) });
  // The store clones the seed at construction — read state back
  // through the store's own copy (the craftingOccupation idiom).
  const prof = () => store.seed.profiles.find((p) => p.id === A)!;
  return { store, prof };
}

// ─── 0061 textual pins (gate-removal step 4) ────────────────────

describe('migration 0061 — bench unlock levels removed', () => {
  // In the executable SQL (comment lines stripped — the header
  // narrates the removal), no level gate survives anywhere.
  const executable = MIGRATION_0061.split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');

  it('restates cc_unlock_bench — and no level gate survives in it', () => {
    expect(MIGRATION_0061).toContain('function public.cc_unlock_bench');
    expect(executable).not.toContain('requires level');
    expect(executable).not.toContain('v_level');
    expect(executable).not.toContain('player_level');
  });

  it('the surviving refusals and charges are byte-identical to 0024', () => {
    expect(executable).toContain("raise exception 'All benches already unlocked'");
    expect(executable).toContain("raise exception 'Insufficient credits'");
    expect(executable).toContain("raise exception 'Insufficient material %', 'VoidDust'");
    expect(executable).toContain('v_cost := 5000');
    expect(executable).toContain('v_cost := 25000');
    expect(executable).toContain("public.cc_jsonb_add_int(materials, 'VoidDust', -10)");
    // Idempotency + locking machinery intact.
    expect(executable).toContain('pg_advisory_xact_lock');
    expect(executable).toContain('verified_action_ledger');
  });
});

// ─── TS catalog pins ────────────────────────────────────────────

describe('the TS bench catalog after step 4', () => {
  it('no bench def carries an unlock level; prices and quality stand', () => {
    for (const def of CRAFT_BENCHES) {
      expect('unlockLevel' in def, def.id).toBe(false);
    }
    expect(benchDef(1)).toMatchObject({ costCredits: 0, costInputs: {} });
    expect(benchDef(2)).toMatchObject({ costCredits: 5000, costInputs: {}, qualityFactor: 1.05 });
    expect(benchDef(3)).toMatchObject({
      costCredits: 25000, costInputs: { VoidDust: 10 }, qualityFactor: 1.1, minQualityBonus: 5,
    });
  });

  it('client copy surfaces never cite a bench unlock level', () => {
    expect(WORKSHOP_SCREEN).not.toContain('unlockLevel');
    expect(WORKSHOP_SCREEN).not.toContain('Need Lv.');
    expect(READINESS).not.toContain('unlockLevel');
  });

  it('the humanizer keeps the surviving refusal, and the dead one stays dead', () => {
    expect(humanizeWorkshopError(new Error('Insufficient credits')))
      .toBe('Not enough credits for that bench yet.');
    // The level refusal left the vocabulary with its producers; the
    // humanizer no longer dresses it up as a current fact.
    expect(humanizeWorkshopError(new Error('Bench 3 requires level 30')))
      .not.toContain('unlocks at level');
  });
});

// ─── Behavior: the in-memory write twin ─────────────────────────

describe('bench unlock after gate-removal step 4 (0061)', () => {
  it('a level-1 player climbs Forge → Lab on price + materials alone', async () => {
    const { store, prof } = makeStore({ credits: 30_000, materials: { VoidDust: 10 } });
    const forge = await store.unlockCraftBench(A, nonce()) as { benches: number };
    expect(forge.benches).toBe(2);
    expect(prof().credits).toBe(25_000);
    expect(prof().workshop_benches).toBe(2);

    const lab = await store.unlockCraftBench(A, nonce()) as { benches: number };
    expect(lab.benches).toBe(3);
    expect(prof().credits).toBe(0);
    expect(prof().materials.VoidDust).toBe(0);
    expect(prof().player_level).toBe(1); // never leveled — money was the gate

    await expect(store.unlockCraftBench(A, nonce()))
      .rejects.toThrow('All benches already unlocked');
  });

  it('the exact price buys the Forge — not a credit more', async () => {
    const { store, prof } = makeStore({ credits: 5_000 });
    const res = await store.unlockCraftBench(A, nonce()) as { benches: number };
    expect(res.benches).toBe(2);
    expect(prof().credits).toBe(0);
  });

  it('one credit short refuses on credits — at level 1 and at level 40 alike', async () => {
    const low = makeStore({ player_level: 1, credits: 4_999 });
    await expect(low.store.unlockCraftBench(A, nonce()))
      .rejects.toThrow('Insufficient credits');
    expect(low.prof().workshop_benches).toBe(1);
    expect(low.prof().credits).toBe(4_999); // refused unlocks charge zero

    const high = makeStore({ player_level: 40, credits: 4_999 });
    await expect(high.store.unlockCraftBench(A, nonce()))
      .rejects.toThrow('Insufficient credits');
  });

  it('the Lab refuses on VoidDust only after the credits check passes', async () => {
    // Broke AND dustless: credits speak first (0024's check order).
    const broke = makeStore({ workshop_benches: 2, credits: 100, materials: {} });
    await expect(broke.store.unlockCraftBench(A, nonce()))
      .rejects.toThrow('Insufficient credits');

    const dustless = makeStore({ workshop_benches: 2, credits: 25_000, materials: { VoidDust: 9 } });
    await expect(dustless.store.unlockCraftBench(A, nonce()))
      .rejects.toThrow('Insufficient material VoidDust');
    expect(dustless.prof().credits).toBe(25_000); // refused unlocks charge zero
    expect(dustless.prof().workshop_benches).toBe(2);
  });

  it('a replayed nonce returns the recorded unlock without charging twice', async () => {
    const { store, prof } = makeStore({ credits: 30_000, materials: { VoidDust: 10 } });
    const key = nonce();
    const first = await store.unlockCraftBench(A, key) as { benches: number };
    const replay = await store.unlockCraftBench(A, key) as { benches: number };
    expect(first.benches).toBe(2);
    expect(replay.benches).toBe(2);
    expect(prof().credits).toBe(25_000); // charged exactly once
    expect(prof().workshop_benches).toBe(2);
  });
});
