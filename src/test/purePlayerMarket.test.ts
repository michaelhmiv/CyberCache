/**
 * Pure player market (owner ruling, 2026-11-04, superseding the
 * 2026-11-03 NPC Common-stock compromise of PR #317): "the buy and
 * sell tab should solely be user sold and bought items." Zero NPC
 * listings in the Buy/Sell lanes — all kinds, all rarities, Common
 * included. The NPC vendor's own Vendor tab is a separate lane and
 * is untouched by everything pinned here.
 *
 * Covered here (source pins for the seams the HTTP suites cannot
 * reach directly; behavior lives in marketDepth.test.ts,
 * marketFee.test.ts, chefJobs.test.ts, quickBuy.test.ts):
 *   1. The seed is gone at the source: no generator file, no job
 *      route, no legacy route, no store method.
 *   2. The browse exclusion is total in both read stores (the
 *      listingQuery fold and its Pg SQL twin) and seller identity is
 *      the seller (account or stamp), never the item's provenance.
 *   3. Price history excludes NPC "sales" in both read stores.
 *   4. Migration 0081 retires the live seeded rows (cancel active
 *      NPC-account listings), re-stamps player rows the old create
 *      mis-stamped 'npc', restates cc_accept_listing with the NPC
 *      refusal, restates cc_market_create with the 'player' stamp,
 *      and adds the NPC exclusion to both Quick-Buy SQL functions.
 *   5. The vendor-weapon create refusal (#300) is UNCHANGED in both
 *      write stores — vendor weapons still exit via buyback/recycle.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8');
const NIL = '00000000-0000-0000-0000-000000000000';

describe('pure player market — the seed is gone at the source', () => {
  it('the NPC item generator and the legacy seed route files do not exist', () => {
    expect(existsSync(resolve(__dirname, '../server/jobs/npcItems.ts'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../server/routes/marketSeedRoute.ts'))).toBe(false);
  });

  it('no route or store method can seed NPC market listings', () => {
    expect(src('../server/jobs/routes.ts')).not.toContain('seed-npc-market');
    expect(src('../server/jobs/routes.ts')).not.toContain('seedNpcMarket');
    expect(src('../server/jobs/store.ts')).not.toContain('seedNpcMarket');
    expect(src('../server/jobs/memory.ts')).not.toContain('seedNpcMarket');
    expect(src('../server/index.ts')).not.toContain('marketSeedRoute');
    expect(src('../server/index.ts')).not.toContain('/api/market/seed');
  });
});

describe('pure player market — browse + price-history seams', () => {
  const readsStore = src('../server/reads/store.ts');
  const readsMemory = src('../server/reads/store.ts'); // InMemoryReadStore shares the file
  const listingQuery = src('../lib/market/listingQuery.ts');

  it('the browse fold excludes sellerType npc outright — no rarity ceiling remains', () => {
    expect(listingQuery).toContain("if (row.sellerType === 'npc') return false;");
    expect(listingQuery).not.toContain('> RARITY_RANK.Common');
  });

  it('the Pg browse twin excludes by seller stamp or NPC account, in rows and counts alike', () => {
    expect(readsStore).toContain("coalesce(ml.seller_type, 'player') = 'npc'");
    expect(readsStore).toContain("or ml.seller_user_id = '${NPC_MARKET_USER_ID}'::uuid");
    expect(readsStore).not.toContain("in ('Uncommon', 'Rare', 'Epic', 'Legendary')");
  });

  it('browseRowFor derives seller identity from the seller, never the item provenance', () => {
    expect(readsStore).toContain('listing.seller_user_id === NPC_MARKET_USER_ID');
    expect(readsStore).not.toContain("item?.supply_mode === 'npc_market' ? 'npc' : 'player'");
  });

  it('price history excludes NPC sales in both read stores', () => {
    expect(readsStore).toContain("coalesce(ml.seller_type, 'player') <> 'npc'");
    expect(readsStore).toContain("ml.seller_user_id <> '${NPC_MARKET_USER_ID}'::uuid");
    expect(readsMemory).toContain("if (row.sellerType === 'npc') continue;");
  });
});

describe('pure player market — write seams', () => {
  const writesStore = src('../server/writes/store.ts');
  const writesMemory = src('../server/writes/memory.ts');
  const quickBuy = src('../lib/market/quickBuy.ts');

  it('a direct accept of an NPC listing is refused in the InMemory twin', () => {
    expect(writesMemory).toContain("listing.seller_type === 'npc' || listing.seller_user_id === NIL_UUID");
    expect(writesMemory).toContain('NPC listings are not part of the player market');
  });

  it('Quick-Buy never sources from an NPC listing (planner + InMemory fill)', () => {
    expect(quickBuy).toContain("row.sellerKind !== 'npc'");
    expect(writesMemory).toContain("listing.seller_type !== 'npc' &&");
  });

  it('both write stores still share the vendor-weapon refusal (unchanged)', () => {
    expect(writesStore).toContain('NPC_VENDOR_WEAPON_REFUSAL');
    expect(writesStore).toContain('isNpcVendorWeapon');
    expect(writesMemory).toContain('NPC_VENDOR_WEAPON_REFUSAL');
    expect(writesMemory).toContain('isNpcVendorWeapon(item)');
  });
});

describe('migration 0081 — retirement + restated functions', () => {
  const sql = src('../../db/migrations/0081_pure_player_market.sql');

  it('cancels the live seeded rows (NPC account, active only) and moves no credits', () => {
    expect(sql).toContain('update public.market_listings');
    expect(sql).toContain("set status = 'cancelled'");
    expect(sql).toContain(`seller_user_id = '${NIL}'::uuid`);
    expect(sql).toContain("and status = 'active'");
  });

  it('re-stamps player rows the old create mis-stamped npc (seller is a player)', () => {
    expect(sql).toContain("set seller_type = 'player'");
    expect(sql).toContain("where seller_type = 'npc'");
    expect(sql).toContain(`and seller_user_id <> '${NIL}'::uuid`);
  });

  it('cc_accept_listing refuses NPC listings after the active-status check', () => {
    const accept = sql.slice(sql.indexOf('create or replace function public.cc_accept_listing'));
    const statusCheck = accept.indexOf("raise exception 'Active listing not found'");
    const refusal = accept.indexOf('NPC listings are not part of the player market');
    expect(statusCheck).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(statusCheck);
    expect(accept).toContain("coalesce(listing.seller_type, 'player') = 'npc'");
    // The 0064 fee law rides verbatim, supply exemption included.
    expect(accept).toContain("coalesce(item.supply_mode, '') <> 'npc_market'");
    expect(accept).toContain('proceeds_bonus := least(fee_credits, floor((listing.price_credits - fee_credits)');
  });

  it('cc_market_create stamps player listings player, whatever the item provenance', () => {
    const create = sql.slice(sql.indexOf('create or replace function public.cc_market_create'));
    expect(create).toContain('seller_type describes the seller (0081; owner ruling');
    expect(create).toContain("'player')");
    expect(create).not.toContain("then 'npc' else 'player'");
  });

  it('both Quick-Buy SQL functions exclude NPC listings from sourcing', () => {
    const exclusions = sql.match(/coalesce\(l\.seller_type, 'player'\) <> 'npc'/g) ?? [];
    expect(exclusions.length).toBe(2); // cc_quickbuy_quote + cc_quickbuy_fill
    expect(sql).toContain(`l.seller_user_id <> '${NIL}'::uuid`);
  });
});
