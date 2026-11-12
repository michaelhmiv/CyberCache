/**
 * A-14 — the UI locked "Cancel Listing" for guests while the
 * server (correctly) has no economy gate on cancel: the lock
 * inventory disagreed with itself. Cancelling your own listing is
 * recovery, not transacting — the reachable case is an account
 * whose verification lapsed with a live listing, UI-blocked from
 * the one market action it legitimately needs.
 *
 * The audit's CI assertion: "Lock-inventory test: for each
 * guardTransact call site, assert the corresponding op appears in
 * the server's gated-op list (and vice versa). market-cancel fails
 * the pairing today." This file pins the pairing for the cancel
 * op from both sides — behaviorally on the server twin (a
 * lapsed-verification seller can still cancel; the same account
 * still cannot accept) and by scan on the client (cancel is no
 * longer routed through guardTransact; buy/sell still are).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { InMemoryWriteStore } from '../server/writes/memory';
import { emptyWriteSeed, type WriteSeed } from '../server/writes/store';
import type { ProfileRowData } from '../server/reads/store';

const SELLER = '11111111-1111-4111-8111-111111111111';
const BUYER = '22222222-2222-4222-8222-222222222222';
const ITEM_GEAR = '33333333-3333-4333-8333-333333333333';

let nonceCounter = 0;
const nonce = () => `a14-nonce-${++nonceCounter}-abcdefgh`;

function profile(over: Partial<ProfileRowData> & { id: string }): ProfileRowData {
  return {
    username: 'hunter', display_name: null, player_level: 25, player_xp: 0,
    credits: 0, scrap: 0, cache_tokens: 0, cache_token_parts: 0,
    materials: {}, essences: {}, consumables: {}, skill_spends: {},
    boss_state: {}, last_idle_claim_at: '2026-10-31T00:00:00.000Z', last_claimed_tick: 0,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    account_type: 'verified', email: 'hunter@example.com',
    email_verified_at: '2026-10-01T00:00:00.000Z', verification_grace_expires_at: null,
    verification_reminder_last_seen_at: null, last_roaming_settled_at: null,
    last_settlement_nonce: null, offline_cap_hours: 0, vehicle_fuel: 0,
    workshop_benches: 1, workshop_tools: {}, legendary_cores: 0,
    ...over,
  } as ProfileRowData;
}

function seed(): WriteSeed {
  const s = emptyWriteSeed();
  s.profiles = [
    profile({ id: SELLER, username: 'seller', materials: { Scrap: 1000 } }),
    profile({ id: BUYER, username: 'buyer', credits: 100_000 }),
  ];
  s.items = [{
    id: ITEM_GEAR, owner_user_id: SELLER, kind: 'weapon', static_item_id: null, item_level: 5,
    rarity: 'Rare', quality: null, material_tier: null, condition_state: null,
    condition_current: 40, condition_max: 50, supply_mode: 'verified_action', source_id: null,
    creator_user_id: null, tradeable: true, account_bound: false, locked_until: null,
    payload: { name: 'Rusty Pistol', weaponType: 'Pistol', element: 'Fire', rarity: 'Rare', level: 5, sourceTag: 'World Drop' },
    runtime_state: 'available', is_locked: false, equipped_slot: null, estimated_value: 500,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
  } as never];
  return s;
}

type Res = { listing: { id: string }; item: { runtime_state: string }; status: string };

describe('market-cancel lock pairing (audit A-14)', () => {
  it('server: a seller whose verification lapsed can still cancel their live listing', async () => {
    const store = new InMemoryWriteStore(seed(), { rng: () => 0.5 });
    const created = (await store.marketCreate(SELLER, nonce(), ITEM_GEAR, 1000)) as Res;
    // Verification lapses while the listing is live.
    const sellerRow = store.seed.profiles.find((p) => p.id === SELLER) as unknown as Record<string, unknown>;
    sellerRow.account_type = 'guest';
    sellerRow.email_verified_at = null;

    const res = (await store.marketCancel(SELLER, nonce(), created.listing.id)) as Res;
    expect(res.item.runtime_state).toBe('available');
  });

  it('server: the same lapsed account still cannot ACCEPT a listing (that gate did not move)', async () => {
    const store = new InMemoryWriteStore(seed(), { rng: () => 0.5 });
    const created = (await store.marketCreate(SELLER, nonce(), ITEM_GEAR, 1000)) as Res;
    const buyerRow = store.seed.profiles.find((p) => p.id === BUYER) as unknown as Record<string, unknown>;
    buyerRow.account_type = 'guest';
    buyerRow.email_verified_at = null;
    await expect(store.acceptListing(BUYER, nonce(), created.listing.id)).rejects.toThrowError(/verified|economy|Google/i);
  });

  it('client: the Cancel button no longer routes through guardTransact; buy/sell still do', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/screens/MarketScreen.tsx'), 'utf8');
    expect(src).not.toContain("guardTransact('cancel a listing'");
    expect(src).toContain('onClick={() => void handleCancelListing(listing)}');
    expect(src).toContain("guardTransact('buy'");
    expect(src).toContain("guardTransact('sell'");
  });
});
