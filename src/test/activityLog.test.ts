/**
 * Activity Log read (AL-2) — through the mounted read route.
 *
 * The seeded history is one player's story told by the verified
 * ledger + the domain rows AL-1 stamps: a while-away settlement
 * (kills lumped, earnings marked away-era), a roaming claim with a
 * stamped drop standing beside it, a boss kill whose loot is
 * explained by the boss record (never double-listed), a cache
 * opening, a sale whose fee/buyer live only in the BUYER's accept
 * row, a player purchase (the bought item's old roam stamp must
 * NOT turn it into the buyer's drop), a pre-stamp veteran item
 * with no receipt, and the craft / dispatch / endless settlements.
 * Another player's JWT must see none of it.
 */
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountReadRoutes } from '../server/reads/routes';
import {
  InMemoryReadStore, emptyReadSeed,
  type MemItem, type MemListing, type ProfileRowData, type ReadSeed,
} from '../server/reads/store';
import { issueAccessToken } from '../server/auth/tokens';

const SECRET = 'test-secret-at-least-32-chars-long!!';
const A = '11111111-1111-4111-8111-111111111111'; // the hunter under test
const B = '22222222-2222-4222-8222-222222222222'; // counterparty / other player
const D = '44444444-4444-4444-8444-444444444444'; // valid id, no profile

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
    ...over,
  } as ProfileRowData;
}

function item(over: Partial<MemItem> & { id: string; owner_user_id: string }): MemItem {
  return {
    kind: 'weapon', item_level: 10, rarity: 'Rare', is_locked: false,
    runtime_state: {}, equipped_slot: null, payload: {}, created_at: '2026-10-30T00:00:00.000Z',
    ...over,
  } as MemItem;
}

function seed(): ReadSeed {
  const s = emptyReadSeed();
  s.profiles = [
    profile({ id: A, username: 'ash_hunter', display_name: 'Ash' }),
    profile({ id: B, username: 'blaze_runner', display_name: 'Blaze' }),
  ];

  s.items = [
    // Ambient roam drop beside the claim — AL-1 stamped, relation engaged.
    item({
      id: 'item-roam-drop', owner_user_id: A, item_level: 25, created_at: '2026-10-30T10:00:00.000Z',
      payload: {
        id: 'item-roam-drop', name: 'Acid Crimson Scatter', weaponType: 'shotgun', rarity: 'Rare', level: 25,
        foundVia: 'roam', foundContext: 'dustwaste_frontier',
        foundEnemy: { id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' },
        dropOdds: { gearChance: 0.26, kind: 'weapon', luck: 0.1 },
      },
    }),
    // While-away drop stamped by the offline grant.
    item({
      id: 'item-offline-drop', owner_user_id: A, kind: 'shield', item_level: 18, created_at: '2026-10-30T08:00:00.000Z',
      payload: {
        id: 'item-offline-drop', name: 'Offline Find', rarity: 'Rare', level: 18,
        foundVia: 'offline', foundContext: 'dustwaste_frontier',
        dropOdds: { gearChance: 0.22, kind: 'shield' },
      },
    }),
    // Boss loot — explained by the boss record, never double-listed.
    item({
      id: 'item-bossloot', owner_user_id: A, item_level: 30, rarity: 'Legendary', created_at: '2026-10-30T11:00:00.000Z',
      payload: {
        id: 'item-bossloot', name: 'Tyrant Fang', weaponType: 'pistol', rarity: 'Legendary', level: 30,
        foundVia: 'boss', foundContext: 'dune_tyrant',
        foundEnemy: { id: 'dune_tyrant', name: 'Dune Tyrant', relation: 'killed' },
        dropOdds: { dedicatedChance: 0.11, dedicatedHit: true, dropLuckBonus: 0.25 },
      },
    }),
    // Cache product — explained by the cache record (cc_make_item embed).
    item({
      id: 'item-cache', owner_user_id: A, item_level: 40, rarity: 'Legendary', created_at: '2026-10-30T12:00:00.000Z',
      payload: { id: 'item-cache', name: 'Surging Throwtech Longshot', weaponType: 'sniper', rarity: 'Legendary', level: 40 },
    }),
    // Player-bought — carries the ORIGINAL hunter's roam stamp, but for
    // the buyer it is a market record, never a drop.
    item({
      id: 'item-bought', owner_user_id: A, item_level: 25, rarity: 'Epic', created_at: '2026-10-29T09:00:00.000Z',
      payload: {
        id: 'item-bought', name: 'Bought Blaster', weaponType: 'pistol', rarity: 'Epic', level: 25,
        foundVia: 'roam', foundContext: 'dustwaste_frontier',
        foundEnemy: { id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' },
        dropOdds: { gearChance: 0.3, kind: 'weapon' },
      },
    }),
    // Pre-stamp veteran item — no receipt fields anywhere. Honest record.
    item({
      id: 'item-prestamp', owner_user_id: A, item_level: 12, rarity: 'Epic', created_at: '2026-10-29T08:00:00.000Z',
      payload: { id: 'item-prestamp', name: 'Old Gun', weaponType: 'pistol', rarity: 'Epic', level: 12 },
    }),
    // Crafted — explained by the craft record.
    item({
      id: 'item-crafted', owner_user_id: A, item_level: 5, created_at: '2026-10-30T09:30:00.000Z',
      payload: { id: 'item-crafted', name: 'Forged Blade', weaponType: 'sword', rarity: 'Rare', level: 5, origin: 'crafted', craftedBy: A },
    }),
    // B's own drop — isolation evidence.
    item({
      id: 'item-b', owner_user_id: B, item_level: 9, created_at: '2026-10-30T10:30:00.000Z',
      payload: {
        id: 'item-b', name: 'Blaze Prize', weaponType: 'rifle', rarity: 'Rare', level: 9,
        foundVia: 'roam', foundContext: 'dustwaste_frontier',
        foundEnemy: { id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' },
      },
    }),
  ];

  s.listings = [
    {
      id: 'listing-sold', seller_user_id: A, item_instance_id: 'item-sold',
      consumable_type: null, quantity: 1, price_credits: 7500, status: 'sold',
      listing_kind: 'gear', display_name: 'Sold Rifle', rarity: 'Rare', item_level: 18,
      listed_at: '2026-10-30T13:30:00.000Z', sold_at: '2026-10-30T14:00:00.000Z',
    } as MemListing,
    {
      id: 'listing-active', seller_user_id: A, item_instance_id: 'item-roam-drop',
      consumable_type: null, quantity: 1, price_credits: 9999, status: 'active',
      listing_kind: 'gear', display_name: 'Acid Crimson Scatter', rarity: 'Rare', item_level: 25,
      listed_at: '2026-10-30T15:00:00.000Z', sold_at: null,
    } as MemListing,
  ];

  s.activityLedger = [
    { id: 'L-settle1', user_id: A, action_type: 'cc_settle_offline_roaming', created_at: '2026-10-30T08:00:00.000Z',
      result_payload: {
        area_id: 'dustwaste_frontier', elapsed_ms: 7_200_000, cap_hours: 2, cap_reached: true,
        rewards: { credits_awarded: 300, scrap_awarded: 20, xp_awarded: 50, cache_fragments_awarded: 4, kills_recorded: 9, ticks: 2400 },
      } },
    { id: 'L-recycle1', user_id: A, action_type: 'cc_recycle_item', created_at: '2026-10-30T09:00:00.000Z',
      result_payload: { item: { id: 'item-salvaged', name: 'Worn Pistol', rarity: 'Common', level: 3 }, scrap_award: 45, cores_award: 0 } },
    { id: 'L-claim1', user_id: A, action_type: 'cc_apply_chef_rewards', created_at: '2026-10-30T10:00:00.000Z',
      result_payload: { area_id: 'dustwaste_frontier', rewards: { credits: 412, scrap: 38, xp: 96, kills_recorded: 12 } } },
    { id: 'L-boss1', user_id: A, action_type: 'cc_apply_boss_attempt', created_at: '2026-10-30T11:00:00.000Z',
      result_payload: {
        boss_id: 'dune_tyrant',
        attempt: {
          victory: true, winChance: 0.64, dedicatedChance: 0.11, dedicatedDropAwarded: true,
          dropLuckBonus: 0.25, creditsGained: 1240, creditsLost: 0, loot: ['item-bossloot'],
        },
      } },
    { id: 'L-cache1', user_id: A, action_type: 'cc_make_item', created_at: '2026-10-30T12:00:00.000Z',
      result_payload: {
        odds: { table_id: 'cache_primary_rarity', outcome: 'Legendary', roll: 9500, total_weight: 10000, odds_table_version: 3 },
        cache_quality: 0, payment: 'free',
        item: { id: 'item-cache', kind: 'weapon', rarity: 'Legendary', item_level: 40, payload: { id: 'item-cache', name: 'Surging Throwtech Longshot' } },
      } },
    { id: 'L-accept1', user_id: A, action_type: 'cc_accept_listing', created_at: '2026-10-30T13:00:00.000Z',
      result_payload: {
        listing: { id: 'listing-bought', seller_user_id: B, price_credits: 5000, item_instance_id: 'item-bought' },
        item: { id: 'item-bought', kind: 'weapon', rarity: 'Epic', item_level: 25, payload: { id: 'item-bought', name: 'Bought Blaster' } },
        market_fee: { fee_credits: 250 },
      } },
    // B bought A's listing — this row is where the seller's fee + buyer live.
    { id: 'L-accept2', user_id: B, action_type: 'cc_accept_listing', created_at: '2026-10-30T14:00:00.000Z',
      result_payload: {
        listing: { id: 'listing-sold', seller_user_id: A, price_credits: 7500, item_instance_id: 'item-sold' },
        item: { id: 'item-sold', kind: 'weapon', rarity: 'Rare', item_level: 18, payload: { id: 'item-sold', name: 'Sold Rifle' } },
        // The Chef's settlement at the base rate: fee = floor(7500 × 5%)
        // = 375, so the seller was credited 7500 − 375 = 7125.
        market_fee: { fee_credits: 375, seller_proceeds: 7125 },
      } },
    { id: 'L-vendorbuy', user_id: A, action_type: 'cc_vendor_buy', created_at: '2026-10-30T07:00:00.000Z',
      result_payload: { item_key: 'MedKit', kind: 'consumable', quantity: 2, unit_price: 250, total_price: 500 } },
    { id: 'L-resurrect', user_id: A, action_type: 'cc_resurrect', created_at: '2026-10-30T06:00:00.000Z',
      result_payload: {} },
    { id: 'L-contract', user_id: A, action_type: 'cc_claim_contract_reward', created_at: '2026-10-30T05:00:00.000Z',
      result_payload: { reward: { credits: 800 } } },
    // B's own claim — isolation evidence (999 kills must never leak to A).
    { id: 'L-claimB', user_id: B, action_type: 'cc_apply_chef_rewards', created_at: '2026-10-30T10:30:00.000Z',
      result_payload: { area_id: 'dustwaste_frontier', rewards: { credits: 5, scrap: 1, xp: 1, kills_recorded: 999 } } },
  ];

  s.activityCraftJobs = [
    { id: 'job-1', user_id: A, bench: 1, kind: 'craft', recipe_id: 'recipe_medkit', units_total: 3, units_completed: 3,
      outputs: [{ consumableType: 'MedKit', count: 3 }], xp_awarded: 120, completed_at: '2026-10-30T09:30:00.000Z' },
  ];

  // ── AL-4 trace rows ────────────────────────────────────────────
  // Each new action type, seeded with the payload shape its writer
  // produces (read from the migration chain head / in-memory twin).
  // All dated 2026-10-31 so the AL-2 assertions above keep their
  // exact history: the full-history count test fetches the FIRST
  // page (limit 100, newest first) — a veteran page still reads 19
  // newest-of-account once these older…newer rows exist beyond it.
  // (The AL-4 describe reads them directly, below.)
  // NOTE: no s.items rows for the AL-4 items — the item-ROW fold in
  // the projection would mint unexplained-DROP records for them
  // (they carry no foundVia stamp and no explaining record). Their
  // identity rides the ledger payloads' own item embeds, which is
  // how the real writers stamp them anyway.

  const bulkItemRow = (it: { id: string; name: string; rarity: string; level: number; kind?: string }) => ({
    id: it.id, owner_user_id: A, kind: it.kind ?? 'weapon', rarity: it.rarity, item_level: it.level, is_locked: false,
    runtime_state: {}, equipped_slot: null, payload: { id: it.id, name: it.name, rarity: it.rarity, level: it.level },
    created_at: '2026-10-31T00:30:00.000Z',
  });

  s.activityLedger.push(
    // Item 1 — bulk salvage: batch row + per-item rows under the
    // derived nonce '<batch key>:<item id>' (0055). The batch key
    // here is the row's own nonce (== its idempotency key in Pg).
    { id: 'L-batch1', user_id: A, action_type: 'cc_recycle_batch', nonce: 'batch-111',
      created_at: '2026-10-31T08:00:00.000Z',
      result_payload: {
        action_type: 'cc_recycle_batch', max_rarity: 'Rare', scrapped_count: 2,
        counts_by_rarity: { Common: 1, Rare: 1 }, scrap_award: 210, cores_award: 0,
        bonus_materials: { Scrap: 3 },
        items: [{ id: 'item-bulk-a' }, { id: 'item-bulk-b' }],
      } },
    { id: 'L-batch1-a', user_id: A, action_type: 'cc_recycle_item', nonce: 'batch-111:item-bulk-a',
      created_at: '2026-10-31T08:00:01.000Z',
      result_payload: { item: bulkItemRow({ id: 'item-bulk-a', name: 'Bulk Pistol', rarity: 'Common', level: 8 }), scrap_award: 40, cores_award: 0, bonus_material: null } },
    { id: 'L-batch1-b', user_id: A, action_type: 'cc_recycle_item', nonce: 'batch-111:item-bulk-b',
      created_at: '2026-10-31T08:00:02.000Z',
      result_payload: { item: bulkItemRow({ id: 'item-bulk-b', name: 'Bulk Rifle', rarity: 'Rare', level: 9 }), scrap_award: 170, cores_award: 0, bonus_material: null } },
    // Same derived-nonce shape but NO batch row in the ledger —
    // membership must NOT be inferred from the nonce alone.
    { id: 'L-rogue-recycle', user_id: A, action_type: 'cc_recycle_item', nonce: 'ghost-999:item-rogue',
      created_at: '2026-10-31T08:05:00.000Z',
      result_payload: { item: bulkItemRow({ id: 'item-rogue', name: 'Rogue Sidearm', rarity: 'Common', level: 7 }), scrap_award: 25, cores_award: 0, bonus_material: null } },
    // Item 2 — extraction settlement (two passes, one degraded deep).
    { id: 'L-extraction1', user_id: A, action_type: 'cc_apply_extraction', created_at: '2026-10-31T09:00:00.000Z',
      result_payload: {
        passes_completed: 2, xp_awarded: 480,
        finds_materials: { MycoSteelFiber: 6, Scrap: 12 }, finds_essences: { Fire: 2 },
        passes: [
          { index: 0, area_id: 'dustwaste_frontier', method: 'surface', draws: 192, gear_factor: 0.9, deep_degraded: false, xp: 240, signature_units: 0 },
          { index: 1, area_id: 'helixworks_labyrinth', method: 'deep_delve', draws: 288, gear_factor: 0.6, deep_degraded: true, xp: 240, signature_units: 3 },
        ],
      } },
    // Item 3 — reforge.
    { id: 'L-reforge1', user_id: A, action_type: 'cc_reforge_item', created_at: '2026-10-31T09:30:00.000Z',
      result_payload: {
        item: bulkItemRow({ id: 'item-bulk-b', name: 'Bulk Rifle', rarity: 'Rare', level: 9 }),
        old_affix: { id: 'affix_sturdy' }, new_affix: { id: 'affix_swift' },
        scrap_charged: 120, cores_charged: 2,
      } },
    // Item 4 — standing turn-in + rank-up.
    { id: 'L-turnin1', user_id: A, action_type: 'cc_turn_in_item', created_at: '2026-10-31T10:00:00.000Z',
      result_payload: {
        item: bulkItemRow({ id: 'item-bulk-a', name: 'Bulk Pistol', rarity: 'Common', level: 8 }),
        manufacturer: 'BlastForge', standing_awarded: 25, scrap_value: 40, new_balance: 130, rank: 2,
      } },
    { id: 'L-rankup1', user_id: A, action_type: 'cc_rank_up_manufacturer', created_at: '2026-10-31T10:05:00.000Z',
      result_payload: {
        manufacturer: 'BlastForge', new_rank: 3, tribute_credits: 500, tribute_item_id: null,
        standing_balance: 105, item: null,
      } },
    // Item 5 — service boards: a repair post (actor = poster) and a
    // shield-tech finish (actor = worker) — each row is its actor's.
    { id: 'L-repairpost1', user_id: A, action_type: 'cc_post_repair_job', created_at: '2026-10-31T11:00:00.000Z',
      result_payload: {
        item: bulkItemRow({ id: 'item-vehicle-al4', name: 'Dune Buggy', rarity: 'Rare', level: 20, kind: 'vehicle' }),
        job: {
          id: 'job-repair-1', owner_user_id: A, provider_user_id: null, profession_id: 'repair',
          status: 'open', target_item_instance_id: 'item-vehicle-al4', requested_service_id: 'vehicle_repair_condition',
          quoted_price_credits: 300, target_points: 40, points_restored: 0, outcome: null,
          paid_credits: 0, fee_credits: 0, xp_awarded: 0, kit_type: null, kits_consumed: [],
        },
      } },
    { id: 'L-shieldfinish1', user_id: A, action_type: 'cc_shieldtech_job_finish', created_at: '2026-10-31T11:30:00.000Z',
      result_payload: {
        job: {
          id: 'job-shield-1', owner_user_id: B, provider_user_id: A, profession_id: 'shield_tech',
          status: 'completed', target_item_instance_id: 'item-b', requested_service_id: 'shield_recalibration',
          quoted_price_credits: 450, target_points: 30, points_restored: 28, outcome: 'success',
          paid_credits: 450, fee_credits: 23, xp_awarded: 90, kit_type: 'ShieldCell', kits_consumed: ['ShieldCell'],
        },
      } },
    // Item 6 — streak claim (paid) + a replay row that paid nothing.
    { id: 'L-streak1', user_id: A, action_type: 'cc_login_streak_claim', created_at: '2026-10-31T12:00:00.000Z',
      result_payload: {
        already_claimed: false, claimable: false, day: '2026-10-31', streak_length: 7, cycle_day: 7,
        tier: 'week', credits_awarded: 250, fragments_awarded: 0, cache_keys_awarded: 1,
      } },
    { id: 'L-streak-replay', user_id: A, action_type: 'cc_login_streak_claim', created_at: '2026-10-31T12:01:00.000Z',
      result_payload: {
        already_claimed: true, claimable: false, day: '2026-10-31', streak_length: 7, cycle_day: 7,
        tier: 'week', credits_awarded: 0, fragments_awarded: 0, cache_keys_awarded: 0,
      } },
    // Item 7 — cache rank grant + spend.
    { id: 'L-rankgrant1', user_id: A, action_type: 'cc_cache_rank_grant', created_at: '2026-10-31T12:30:00.000Z',
      result_payload: { tokens_granted: 3, from_level: 12, to_level: 13 } },
    { id: 'L-rankspend1', user_id: A, action_type: 'cc_cache_rank_spend', created_at: '2026-10-31T12:35:00.000Z',
      result_payload: { bonus_id: 'drop_luck', rank_after: 2, cost: 2, tokens: 5 } },
    // Item 8 — consumable use.
    { id: 'L-consume1', user_id: A, action_type: 'cc_consume_consumable', created_at: '2026-10-31T13:00:00.000Z',
      result_payload: { item_key: 'MedKit', quantity: 2, consumed_batches: [{ batch_id: 'batch-x', quantity: 2 }] } },
    // Item 9 — refuel + historical patch kit (0025 retired the op).
    { id: 'L-refuel1', user_id: A, action_type: 'cc_refuel_vehicle', created_at: '2026-10-31T13:30:00.000Z',
      result_payload: { cells_loaded: 2, fuel_units_added: 80, vehicle_fuel: 120 } },
    { id: 'L-patchkit1', user_id: A, action_type: 'cc_use_patch_kit', created_at: '2026-10-31T13:35:00.000Z',
      result_payload: {
        item: bulkItemRow({ id: 'item-vehicle-al4', name: 'Dune Buggy', rarity: 'Rare', level: 20, kind: 'vehicle' }),
        restored: 15, condition_current: 85, condition_max: 100,
      } },
    // Item 10 — dispatch lifecycle: depart, settle (recall), reroll.
    { id: 'L-depart1', user_id: A, action_type: 'cc_dispatch_depart', created_at: '2026-10-31T14:00:00.000Z',
      result_payload: {
        mission: {
          id: 'mission-al4', contract_family: 'courier', offer_id: 'offer-7',
          destination_area_id: 'helixworks_labyrinth', duration_hours: 6,
          payout_credits: 900, payout_scrap: 40, payout_material_id: 'MycoSteelFiber', payout_material_units: 4,
          departed_at: '2026-10-31T14:00:00.000Z', ends_at: '2026-10-31T20:00:00.000Z',
        },
      } },
    { id: 'L-dispatchsettle1', user_id: A, action_type: 'cc_dispatch_settle', created_at: '2026-10-31T15:00:00.000Z',
      result_payload: {
        mission_id: 'mission-al4', family: 'courier', offer_id: 'offer-7', area_id: 'helixworks_labyrinth',
        duration_hours: 6, fraction: 0.5, recalled: true, breakdown: {},
        payout: { credits: 450, scrap: 20, material_id: 'MycoSteelFiber', material_units: 2 },
        wear_applied: 3, fuel_refunded_units: 12,
      } },
    { id: 'L-reroll1', user_id: A, action_type: 'cc_reroll_dispatch_board', created_at: '2026-10-31T15:30:00.000Z',
      result_payload: { credits_charged: 150, board_index: 0, rerolls_used: 1, rerolls_remaining: 2, next_reroll_price: 300, day: '2026-10-31' } },
    // Item 11 — listing created + cancelled (the listing row itself
    // carries status 'cancelled' so the domain fold stays honest).
    { id: 'L-market-create1', user_id: A, action_type: 'cc_market_create', created_at: '2026-10-31T16:00:00.000Z',
      result_payload: {
        listing: {
          id: 'listing-al4', seller_user_id: A, item_instance_id: 'item-bulk-b', price_credits: 4200,
          status: 'active', listed_at: '2026-10-31T16:00:00.000Z', sold_at: null, listing_kind: 'gear',
          quantity: 1, consumable_type: null, material_id: null, essence_id: null,
          display_name: 'Bulk Rifle', rarity: 'Rare', item_level: 9,
        },
        item: bulkItemRow({ id: 'item-bulk-b', name: 'Bulk Rifle', rarity: 'Rare', level: 9 }),
      } },
    { id: 'L-market-cancel1', user_id: A, action_type: 'cc_market_cancel', created_at: '2026-10-31T16:30:00.000Z',
      result_payload: {
        listing: {
          id: 'listing-al4', seller_user_id: A, item_instance_id: 'item-bulk-b', price_credits: 4200,
          status: 'cancelled', listed_at: '2026-10-31T16:00:00.000Z', sold_at: null, listing_kind: 'gear',
          quantity: 1, consumable_type: null, material_id: null, essence_id: null,
          display_name: 'Bulk Rifle', rarity: 'Rare', item_level: 9,
        },
        item: bulkItemRow({ id: 'item-bulk-b', name: 'Bulk Rifle', rarity: 'Rare', level: 9 }),
      } },
    // Item 12 — craft enqueue + cancel, equip / unequip / lock.
    { id: 'L-enqueue1', user_id: A, action_type: 'cc_enqueue_craft_job', created_at: '2026-10-31T17:00:00.000Z',
      result_payload: {
        job: { id: 'job-enqueue-1', recipe_id: 'recipe_medkit', kind: 'craft', units: 4, units_total: 4, bench: 1 },
        escrow_cores: 0,
      } },
    { id: 'L-canceljob1', user_id: A, action_type: 'cc_cancel_craft_job', created_at: '2026-10-31T17:30:00.000Z',
      result_payload: { job_id: 'job-enqueue-1', refunded_inputs: { Scrap: 30 }, rush_ticket_refunded: false, cores_refunded: 0 } },
    { id: 'L-equip1', user_id: A, action_type: 'cc_equip_item', created_at: '2026-10-31T18:00:00.000Z',
      result_payload: {
        item: { ...bulkItemRow({ id: 'item-bulk-b', name: 'Bulk Rifle', rarity: 'Rare', level: 9 }), equipped_slot: 'primary' },
        items: [], loadout: {},
      } },
    { id: 'L-unequip1', user_id: A, action_type: 'cc_unequip_slot', created_at: '2026-10-31T18:05:00.000Z',
      result_payload: {
        item: bulkItemRow({ id: 'item-bulk-b', name: 'Bulk Rifle', rarity: 'Rare', level: 9 }),
        slot_name: 'primary',
      } },
    { id: 'L-lock1', user_id: A, action_type: 'cc_item_lock', created_at: '2026-10-31T18:10:00.000Z',
      result_payload: {
        item: { ...bulkItemRow({ id: 'item-bulk-b', name: 'Bulk Rifle', rarity: 'Rare', level: 9 }), is_locked: true },
      } },
  );
  s.activityDispatchMissions = [
    { id: 'mission-1', user_id: A, contract_family: 'foot', payout_credits: 1000, payout_fraction: 0.8,
      departed_at: '2026-10-30T02:00:00.000Z', settled_at: '2026-10-30T04:00:00.000Z' },
  ];
  s.activityEndlessRuns = [
    { id: 'run-1', user_id: A, status: 'banked', depth_reached: 25,
      started_at: '2026-10-29T20:00:00.000Z', ended_at: '2026-10-29T21:00:00.000Z' },
    { id: 'run-active', user_id: A, status: 'active', depth_reached: 3,
      started_at: '2026-10-30T16:00:00.000Z', ended_at: '2026-10-30T16:00:00.000Z' },
  ];
  return s;
}

interface Rec {
  id: string; kind: string; at: string; label: string; away: boolean;
  areaName?: string | null;
  kills?: { count: number } | null;
  item?: { id: string; name: string } | null;
  receipt?: { foundVia: string | null; foundEnemy: { id: string; name: string; relation: string } | null; dropOdds: Record<string, unknown> | null } | null;
  boss?: { bossName: string | null; victory: boolean; dedicatedChance: number | null; dedicatedDropAwarded: boolean | null; dropLuckBonus: number | null; loot: Array<{ id: string; name: string }> } | null;
  cache?: { outcome: string | null; oddsTableVersion: number | null; payment: string | null } | null;
  craft?: { recipeName: string | null } | null;
  market?: { direction: string; feeCredits: number | null; proceedsCredits?: number | null; counterpartyName: string | null } | null;
  settlement?: { capReached: boolean | null; ticks: number | null } | null;
  salvage?: { scrapAward: number; coresAward: number; batch?: boolean; scrappedCount?: number; maxRarity?: string | null; countsByRarity?: Record<string, number>; bonusMaterials?: Record<string, number> } | null;
  extraction?: { passesCompleted: number; xpAwarded: number; passes: Array<{ areaName: string | null; method: string | null; deepDegraded: boolean | null; xp: number | null; signatureUnits: number | null }>; materials: Record<string, number>; essences: Record<string, number> } | null;
  service?: { board: string; step: string; role: string; paidCredits: number | null; pointsRestored: number | null; priceCredits: number | null } | null;
  dispatch?: { family: string; payoutCredits: number; step?: string; areaName?: string | null; rerollCredits?: number | null } | null;
  trace?: { action: string; facts: Array<{ label: string; value: string }> } | null;
}
interface Page { records: Rec[]; nextCursor: string | null }

describe('activity log read API (AL-2)', () => {
  let base = '';
  let close: () => Promise<void> = async () => undefined;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, new InMemoryReadStore(seed()), { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    close = () => new Promise<void>((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tokens[A] = issueAccessToken(SECRET, A, false);
    tokens[B] = issueAccessToken(SECRET, B, false);
    tokens[D] = issueAccessToken(SECRET, D, false);
  });
  afterAll(async () => { await close(); });

  async function get(path: string, who: string = A): Promise<{ status: number; body: Page & { error?: string } }> {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${tokens[who]}` } });
    return { status: res.status, body: await res.json() as Page & { error?: string } };
  }

  it('walks the full history by cursor — no repeats, no gaps, newest first', async () => {
    const full = await get('/api/activity-log/me?limit=100');
    expect(full.status).toBe(200);
    // 19 at AL-2 + 26 AL-4 trace records (the streak replay mints
    // none of its 27 seeded rows).
    expect(full.body.records.length).toBe(45);
    expect(full.body.nextCursor).toBeNull();

    const walked: Rec[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: { status: number; body: Page } = await get(`/api/activity-log/me?limit=3${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(page.status).toBe(200);
      walked.push(...page.body.records);
      cursor = page.body.nextCursor;
      pages += 1;
      if (pages > 20) throw new Error('pagination did not terminate');
    } while (cursor);

    expect(pages).toBe(15);
    expect(walked.map((r) => r.id)).toEqual(full.body.records.map((r) => r.id));
    expect(new Set(walked.map((r) => r.id)).size).toBe(walked.length);
    for (let i = 1; i < walked.length; i += 1) {
      const prev = walked[i - 1]; const cur = walked[i];
      expect(prev.at > cur.at || (prev.at === cur.at && prev.id > cur.id)).toBe(true);
    }
  });

  it('lumps kills per roaming stretch — one aggregate record per claim', async () => {
    const { body } = await get('/api/activity-log/me?kind=kills&limit=100');
    expect(body.records.length).toBe(2);
    const online = body.records.find((r) => r.id.endsWith('L-claim1#kills'));
    expect(online?.kills?.count).toBe(12);
    expect(online?.areaName).toBe('Dustwaste Frontier');
    expect(online?.away).toBe(false);
  });

  it('marks the while-away era — settlement, its kills/earnings, offline drops', async () => {
    const { body } = await get('/api/activity-log/me?kind=away&limit=100');
    expect(body.records.map((r) => r.id).sort()).toEqual([
      'item:item-offline-drop',
      'ledger:L-settle1',
      'ledger:L-settle1#earnings',
      'ledger:L-settle1#kills',
    ]);
    expect(body.records.every((r) => r.away)).toBe(true);
    const settlement = body.records.find((r) => r.kind === 'settlement');
    expect(settlement?.settlement?.capReached).toBe(true);
    expect(settlement?.settlement?.ticks).toBe(2400);
    const settleKills = body.records.find((r) => r.id.endsWith('#kills'));
    expect(settleKills?.kills?.count).toBe(9);
  });

  it('emits each explained item exactly once — no double-listed boss/cache/bought/crafted loot', async () => {
    const { body } = await get('/api/activity-log/me?kind=drop&limit=100');
    expect(body.records.map((r) => r.item?.id).sort()).toEqual([
      'item-offline-drop', 'item-prestamp', 'item-roam-drop',
    ]);
    const { body: all } = await get('/api/activity-log/me?limit=100');
    const itemRefs = all.records.flatMap((r) => [
      ...(r.item ? [r.item.id] : []),
      ...(r.boss?.loot.map((l) => l.id) ?? []),
      ...(r.cache ? [] : []),
    ]);
    // item-bossloot appears exactly once overall (as boss loot).
    expect(itemRefs.filter((id) => id === 'item-bossloot').length).toBe(1);
  });

  it('surfaces AL-1 receipts honestly — engaged is never a named kill, pre-stamp items carry none', async () => {
    const { body } = await get('/api/activity-log/me?kind=drop&limit=100');
    const roam = body.records.find((r) => r.item?.id === 'item-roam-drop');
    expect(roam?.receipt?.foundVia).toBe('roam');
    expect(roam?.receipt?.foundEnemy).toEqual({ id: 'rust_vulture', name: 'Rust Vulture', relation: 'engaged' });
    expect(roam?.label).toContain('while fighting Rust Vulture');
    expect(roam?.label).not.toContain('killed');
    expect((roam?.receipt?.dropOdds as { gearChance?: number } | null)?.gearChance).toBe(0.26);
    const prestamp = body.records.find((r) => r.item?.id === 'item-prestamp');
    expect(prestamp?.receipt).toBeNull();
    expect(prestamp?.label).toBe('Drop — predates item records');
  });

  it('boss and cache records carry their verdicts and odds stamps', async () => {
    const boss = (await get('/api/activity-log/me?kind=boss')).body.records;
    expect(boss.length).toBe(1);
    expect(boss[0].boss?.bossName).toBe('Dune Tyrant');
    expect(boss[0].boss?.victory).toBe(true);
    expect(boss[0].boss?.dedicatedChance).toBe(0.11);
    expect(boss[0].boss?.dedicatedDropAwarded).toBe(true);
    expect(boss[0].boss?.dropLuckBonus).toBe(0.25);
    expect(boss[0].boss?.loot).toEqual([{ id: 'item-bossloot', name: 'Tyrant Fang', kind: 'weapon', rarity: 'Legendary', level: 30 }]);

    const cache = (await get('/api/activity-log/me?kind=cache')).body.records;
    expect(cache.length).toBe(1);
    expect(cache[0].cache?.outcome).toBe('Legendary');
    expect(cache[0].cache?.oddsTableVersion).toBe(3);
    expect(cache[0].cache?.payment).toBe('free');
    expect(cache[0].item?.name).toBe('Surging Throwtech Longshot');
  });

  it('market records name counterparties and the seller fee from the buyer row', async () => {
    const { body } = await get('/api/activity-log/me?kind=market&limit=100');
    // 3 at AL-2 + the AL-4 listed/cancelled pair (which share one
    // domain listing row, folded to no extra record).
    expect(body.records.length).toBe(5);
    const sold = body.records.find((r) => r.id === 'listing:listing-sold');
    expect(sold?.label).toContain('Sold');
    expect(sold?.market?.counterpartyName).toBe('Blaze');
    expect(sold?.market?.feeCredits).toBe(375);
    // The credited amount rides along proven by the accept row:
    // 7500 price − 375 fee (the 5% base settlement) = 7125.
    expect(sold?.market?.proceedsCredits).toBe(7125);
    const bought = body.records.find((r) => r.id === 'ledger:L-accept1');
    expect(bought?.market?.counterpartyName).toBe('Blaze');
    expect(bought?.item?.name).toBe('Bought Blaster');
  });

  it('craft, dispatch, and endless settlements land as their own records', async () => {
    const craft = (await get('/api/activity-log/me?kind=craft')).body.records;
    // 1 completion at AL-2 + the AL-4 enqueue/cancel pair (newest first).
    expect(craft.length).toBe(3);
    expect(craft.find((r) => r.id === 'craft:job-1')?.craft?.recipeName).toBe('Med Kit');
    const dispatch = (await get('/api/activity-log/me?kind=dispatch')).body.records;
    // 1 settled mission at AL-2 + the AL-4 depart/settle/reroll rows.
    expect(dispatch.length).toBe(4);
    const endless = (await get('/api/activity-log/me?kind=endless')).body.records;
    expect(endless.length).toBe(1);
    expect(endless[0].label).toContain('depth 25');
  });

  it('one search box matches item names, enemy names, and area names together', async () => {
    const byItem = await get(`/api/activity-log/me?q=${encodeURIComponent('longshot')}`);
    expect(byItem.body.records.map((r) => r.kind)).toEqual(['cache']);
    const byEnemy = await get(`/api/activity-log/me?q=${encodeURIComponent('rust vulture')}`);
    expect(byEnemy.body.records.map((r) => r.item?.id)).toEqual(['item-roam-drop']);
    const byArea = await get(`/api/activity-log/me?q=${encodeURIComponent('dustwaste')}`);
    // 7 at AL-2 + the AL-4 extraction settle (its first pass ran there).
    expect(byArea.body.records.length).toBe(8);
    expect(byArea.body.records.every((r) => r.areaName === 'Dustwaste Frontier' || r.item?.id === 'item-offline-drop' || r.item?.id === 'item-roam-drop' || r.id === 'ledger:L-extraction1')).toBe(true);
    const byBoss = await get(`/api/activity-log/me?q=${encodeURIComponent('tyrant')}`);
    expect(byBoss.body.records.map((r) => r.kind)).toEqual(['boss']);
    const byCounterparty = await get(`/api/activity-log/me?q=${encodeURIComponent('blaze')}`);
    expect(byCounterparty.body.records.length).toBe(2);
  });

  it('rejects a foreign cursor and an unknown kind with 400s', async () => {
    expect((await get('/api/activity-log/me?cursor=garbage!!')).status).toBe(400);
    expect((await get('/api/activity-log/me?kind=bogus')).status).toBe(400);
  });

  it('isolates players — B sees only B, a body/query playerId is ignored, anonymous is 401', async () => {
    const bView = await get('/api/activity-log/me?limit=100', B);
    expect(bView.status).toBe(200);
    const bIds = bView.body.records.map((r) => r.id);
    expect(bIds).not.toContain('ledger:L-claim1#kills');
    expect(bView.body.records.some((r) => r.kills?.count === 12)).toBe(false);
    expect(bView.body.records.some((r) => r.kills?.count === 999)).toBe(true);
    expect(bIds.some((id) => id.includes('item-roam-drop'))).toBe(false);

    // A asking with B's id in the query still gets A's record.
    const spoof = await get(`/api/activity-log/me?playerId=${B}&limit=100`, A);
    expect(spoof.body.records.some((r) => r.kills?.count === 12)).toBe(true);
    expect(spoof.body.records.some((r) => r.kills?.count === 999)).toBe(false);

    expect((await get('/api/activity-log/me', D)).status).toBe(404);
    const anon = await fetch(`${base}/api/activity-log/me`);
    expect(anon.status).toBe(401);
  });
});

describe('activity log trace pass (AL-4)', () => {
  let base = '';
  let close: () => Promise<void> = async () => undefined;
  let tokenA = '';

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountReadRoutes(app, new InMemoryReadStore(seed()), { jwtSecret: SECRET });
    const server = app.listen(0);
    await new Promise<void>((r) => server.on('listening', r));
    close = () => new Promise<void>((r) => server.close(() => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    tokenA = issueAccessToken(SECRET, A, false);
  });
  afterAll(async () => { await close(); });

  async function get(path: string): Promise<{ status: number; body: Page }> {
    const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${tokenA}` } });
    return { status: res.status, body: await res.json() as Page };
  }

  it('bulk salvage: one summary record + per-item records batch-marked only by the exact nonce proof', async () => {
    const { body } = await get('/api/activity-log/me?kind=salvage&limit=100');
    const summary = body.records.find((r) => r.id === 'ledger:L-batch1');
    expect(summary?.label).toBe('Bulk salvage — 2 items (Rare and under)');
    expect(summary?.salvage?.scrappedCount).toBe(2);
    expect(summary?.salvage?.countsByRarity).toEqual({ Common: 1, Rare: 1 });
    expect(summary?.salvage?.scrapAward).toBe(210);
    expect(summary?.salvage?.bonusMaterials).toEqual({ Scrap: 3 });
    const a = body.records.find((r) => r.id === 'ledger:L-batch1-a');
    const b = body.records.find((r) => r.id === 'ledger:L-batch1-b');
    expect(a?.salvage?.batch).toBe(true);
    expect(b?.salvage?.batch).toBe(true);
    expect(a?.label).toBe('Salvaged Bulk Pistol');
    // A derived-nonce shape with NO batch row proves nothing.
    const rogue = body.records.find((r) => r.id === 'ledger:L-rogue-recycle');
    expect(rogue?.salvage?.batch).toBeUndefined();
  });

  it('extraction: one record per settle — passes, degraded deep reads as Surface, finds + XP, no mastery claimed', async () => {
    const { body } = await get('/api/activity-log/me?kind=extraction&limit=10');
    expect(body.records.length).toBe(1);
    const rec = body.records[0];
    expect(rec.label).toContain('Extraction — 2 passes');
    expect(rec.extraction?.passesCompleted).toBe(2);
    expect(rec.extraction?.xpAwarded).toBe(480);
    expect(rec.extraction?.materials).toEqual({ MycoSteelFiber: 6, Scrap: 12 });
    expect(rec.extraction?.essences).toEqual({ Fire: 2 });
    expect(rec.extraction?.passes[0].method).toBe('surface');
    expect(rec.extraction?.passes[0].areaName).toBe('Dustwaste Frontier');
    // The deep pass settled on degraded gear: it reads as Surface.
    expect(rec.extraction?.passes[1].deepDegraded).toBe(true);
    expect(rec.extraction?.passes[1].method).toBe('surface');
    expect(rec.extraction?.passes[1].signatureUnits).toBe(3);
  });

  it('reforge, turn-in, and rank-up read as system records with their charged/awarded facts', async () => {
    const { body } = await get('/api/activity-log/me?kind=system&limit=100');
    const reforge = body.records.find((r) => r.id === 'ledger:L-reforge1');
    expect(reforge?.label).toBe('Reforged Bulk Rifle');
    expect(reforge?.trace?.facts).toContainEqual({ label: 'Scrap charged', value: '120' });
    expect(reforge?.trace?.facts).toContainEqual({ label: 'Cores charged', value: '2' });
    const turnIn = body.records.find((r) => r.id === 'ledger:L-turnin1');
    expect(turnIn?.label).toBe('Turned in Bulk Pistol — BlastForge');
    expect(turnIn?.trace?.facts).toContainEqual({ label: 'Standing awarded', value: '+25' });
    const rankUp = body.records.find((r) => r.id === 'ledger:L-rankup1');
    expect(rankUp?.label).toBe('Ranked up — BlastForge rank 3');
    expect(rankUp?.trace?.facts).toContainEqual({ label: 'Tribute', value: '500 cr' });
  });

  it('service boards: poster and worker each read their own row', async () => {
    const { body } = await get('/api/activity-log/me?kind=service&limit=10');
    expect(body.records.length).toBe(2);
    const post = body.records.find((r) => r.id === 'ledger:L-repairpost1');
    expect(post?.service?.board).toBe('repair');
    expect(post?.service?.step).toBe('posted');
    expect(post?.service?.role).toBe('poster');
    expect(post?.label).toBe('Repair posted — Dune Buggy');
    const finish = body.records.find((r) => r.id === 'ledger:L-shieldfinish1');
    expect(finish?.service?.board).toBe('shieldtech');
    expect(finish?.service?.step).toBe('finished');
    expect(finish?.service?.role).toBe('worker');
    expect(finish?.service?.paidCredits).toBe(450);
    expect(finish?.service?.pointsRestored).toBe(28);
  });

  it('streak: the paid claim records; the already-claimed replay mints nothing', async () => {
    const { body } = await get('/api/activity-log/me?kind=system&limit=100');
    const streaks = body.records.filter((r) => r.label.startsWith('Streak claimed'));
    expect(streaks.length).toBe(1);
    expect(streaks[0].label).toBe('Streak claimed — day 7');
    expect(streaks[0].trace?.facts).toContainEqual({ label: 'Cache keys', value: '+1' });
    expect(body.records.some((r) => r.id === 'ledger:L-streak-replay')).toBe(false);
  });

  it('cache-rank grant/spend, consumable use, refuel, and the retired patch kit all leave traces', async () => {
    const { body } = await get('/api/activity-log/me?kind=system&limit=100');
    const grant = body.records.find((r) => r.id === 'ledger:L-rankgrant1');
    expect(grant?.label).toBe('Cache Rank — +3 tokens');
    const spend = body.records.find((r) => r.id === 'ledger:L-rankspend1');
    expect(spend?.label).toBe('Cache Rank — drop_luck rank 2');
    const consume = body.records.find((r) => r.id === 'ledger:L-consume1');
    expect(consume?.label).toBe('Used MedKit ×2');
    const refuel = body.records.find((r) => r.id === 'ledger:L-refuel1');
    expect(refuel?.label).toBe('Refueled — +80 fuel');
    expect(refuel?.trace?.facts).toContainEqual({ label: 'Cells loaded', value: '2' });
    const patch = body.records.find((r) => r.id === 'ledger:L-patchkit1');
    expect(patch?.label).toBe('Patch kit — Dune Buggy');
  });

  it('dispatch lifecycle: departure, recall settlement, and reroll are distinct records', async () => {
    const { body } = await get('/api/activity-log/me?kind=dispatch&limit=100');
    const depart = body.records.find((r) => r.id === 'ledger:L-depart1');
    expect(depart?.dispatch?.step).toBe('departed');
    expect(depart?.label).toBe('Dispatch departed — courier to HelixWorks Labyrinth');
    expect(depart?.dispatch?.payoutCredits).toBe(900);
    const settle = body.records.find((r) => r.id === 'ledger:L-dispatchsettle1');
    expect(settle?.dispatch?.step).toBe('recalled');
    expect(settle?.label).toBe('Dispatch recalled — courier');
    expect(settle?.dispatch?.payoutCredits).toBe(450);
    const reroll = body.records.find((r) => r.id === 'ledger:L-reroll1');
    expect(reroll?.dispatch?.step).toBe('rerolled');
    expect(reroll?.dispatch?.rerollCredits).toBe(150);
  });

  it('listing created and cancelled read as market records, distinct from trades', async () => {
    const { body } = await get('/api/activity-log/me?kind=market&limit=100');
    const created = body.records.find((r) => r.id === 'ledger:L-market-create1');
    expect(created?.market?.direction).toBe('listed');
    expect(created?.label).toBe('Listed Bulk Rifle — 4200 cr');
    const cancelled = body.records.find((r) => r.id === 'ledger:L-market-cancel1');
    expect(cancelled?.market?.direction).toBe('cancelled');
    expect(cancelled?.label).toBe('Listing cancelled — Bulk Rifle');
  });

  it('craft enqueue/cancel and loadout equip/unequip/lock leave traces', async () => {
    const craft = (await get('/api/activity-log/me?kind=craft&limit=100')).body.records;
    const queued = craft.find((r) => r.id === 'ledger:L-enqueue1');
    expect(queued?.label).toBe('Med Kit — queued');
    expect(queued?.craft?.recipeName).toBe('Med Kit');
    const cancelled = craft.find((r) => r.id === 'ledger:L-canceljob1');
    expect(cancelled?.label).toBe('Craft cancelled — inputs refunded');
    expect(cancelled?.trace?.facts).toContainEqual({ label: 'Refunded Scrap', value: '30' });

    const { body } = await get('/api/activity-log/me?kind=system&limit=100');
    expect(body.records.find((r) => r.id === 'ledger:L-equip1')?.label).toBe('Equipped Bulk Rifle');
    expect(body.records.find((r) => r.id === 'ledger:L-equip1')?.trace?.facts).toContainEqual({ label: 'Slot', value: 'primary' });
    expect(body.records.find((r) => r.id === 'ledger:L-unequip1')?.label).toBe('Unequipped Bulk Rifle');
    expect(body.records.find((r) => r.id === 'ledger:L-lock1')?.label).toBe('Locked Bulk Rifle');
  });
});
