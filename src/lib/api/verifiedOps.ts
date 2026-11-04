/**
 * Verified ops (Route B, slice B4) — transport swap onto the Chef
 * write routes (B3). Every op keeps its name, arguments, result shape,
 * and post-op state sync (syncVerifiedResult + runtime snapshot save);
 * only the wire changed: Supabase RPC → POST /api/ops/* with the same
 * field names, identity from the Chef JWT (never a body player id).
 *
 * There is deliberately NO roaming-claim op here: roaming claims go
 * through the Chef (/api/claim) only. The old claimRoamingRewards op
 * existed solely as the ticker's error fallback, and its engine
 * (cc_claim_roaming_rewards) paid stale flat rates — it was removed
 * with the fallback rather than left as a wrong-rate back door.
 */
import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import {
  trackCacheOpen,
  trackCraftQueue,
  trackEquip,
  trackMarketList,
  trackSalvage,
} from '@/lib/analytics/analytics';
import { isNotFoundError } from './http';
import { syncRuntimeItemsForUser } from './runtimeStateService';
import { apiRequest } from './http';
import { syncVerifiedResult } from './verifiedStateSync';
import type { ServiceBoardQuery } from '@/lib/market/boardQuery';

export type VerifiedResult = Record<string, unknown>;

const requestId = (prefix: string): string => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
};

const op = async (path: string, body: Record<string, unknown>): Promise<VerifiedResult> => {
  const result = await apiRequest<VerifiedResult>(path, { method: 'POST', body });
  syncVerifiedResult(result);
  await saveCurrentRuntimeStores();
  return result;
};

export const verifiedOps = {
  initialBundle: () => op('/ops/initial-bundle', { nonce: requestId('initial') }),
  // Cache box lane (0037): one op opens a box; the payment names
  // how this opening is paid. The server owns the free-first rule
  // (the day's first opening resolves free whatever is requested),
  // the daily cap, and the draw. 'ad' is a client attestation — the
  // ad unit id is the claim; there is no rewarded-key claim anymore.
  makeItem: async (input?: { payment?: 'free' | 'ad' | 'key'; adUnitId?: string }) => {
    const result = await op('/ops/make-item', {
      nonce: requestId('make'),
      payment: input?.payment ?? 'key',
      ad_unit_id: input?.adUnitId ?? null,
    });
    trackCacheOpen(input?.payment ?? 'key');
    return result;
  },
  registerPushDevice: ({ token, platform, appVersion }: { token: string; platform?: string; appVersion?: string }) => op('/push/register', {
    token,
    platform: platform ?? 'android',
    app_version: appVersion ?? null,
  }),
  disablePushDevice: (token: string) => op('/push/disable', { token }),
  vendorBuy: (itemKey: string, quantity = 1) => op('/ops/vendor-buy', { nonce: requestId('vendor'), item_key: itemKey, quantity }),
  // QuickBuy (QB-1): the quote is a pure read — real numbers for
  // guests too (guest-visibility law), so it bypasses op()'s state
  // sync. The fill goes through op() like every economy write; a
  // drifted quote comes back as a 'requote' payload, not an error.
  quickbuyQuote: (goodKind: string, goodId: string, quantity: number) =>
    apiRequest<import('@/lib/market/quickBuy').QuickBuyQuote>('/ops/quickbuy-quote', {
      method: 'POST',
      body: { good_kind: goodKind, good_id: goodId, quantity },
    }),
  quickbuyFill: (input: { source: 'market' | 'vendor'; goodKind: string; goodId: string; quantity: number; quotedTotal: number }) =>
    op('/ops/quickbuy-fill', {
      nonce: requestId('quickbuy'),
      source: input.source,
      good_kind: input.goodKind,
      good_id: input.goodId,
      quantity: input.quantity,
      quoted_total: input.quotedTotal,
    }),
  vendorSellGear: (itemId: string) => op('/ops/vendor-sell', { nonce: requestId('vendor-sell'), kind: 'gear', item_id: itemId }),
  vendorSellConsumable: (batchId: string, quantity: number) => op('/ops/vendor-sell', { nonce: requestId('vendor-sell'), kind: 'consumable', batch_id: batchId, quantity }),
  vendorSellMaterial: (materialId: string, quantity: number) => op('/ops/vendor-sell', { nonce: requestId('vendor-sell'), kind: 'material', material_id: materialId, quantity }),
  claimCraftedConsumable: (input: { recipeId: string; itemKey: string; quantity: number }) => op('/ops/claim-crafted-consumable', {
    nonce: requestId('craft-consumable'),
    recipe_id: input.recipeId,
    item_key: input.itemKey,
    quantity: input.quantity,
  }),
  // Crafting-as-occupation (0024): the server job model. Intent only —
  // the server derives durations, bounds, XP and escrow from the
  // catalog + profile + skill records.
  enqueueCraftJob: async (input: { bench: number; recipeId: string; units: number; rarity?: string | null; useCatalyst?: boolean; useRushTicket?: boolean }) => {
    const result = await op('/ops/craft-enqueue', {
      nonce: requestId('craft-enqueue'),
      bench: input.bench,
      recipe_id: input.recipeId,
      units: input.units,
      rarity: input.rarity ?? null,
      use_catalyst: input.useCatalyst ?? false,
      use_rush_ticket: input.useRushTicket ?? false,
    });
    trackCraftQueue(input.recipeId);
    return result;
  },
  cancelCraftJob: (jobId: string) => op('/ops/craft-cancel', { nonce: requestId('craft-cancel'), job_id: jobId }),
  consumeConsumable: (input: { itemKey: string; quantity: number; activityType?: string; reason?: string }) => op('/ops/consume-consumable', {
    nonce: requestId('consume-consumable'),
    item_key: input.itemKey,
    quantity: input.quantity,
    activity_type: input.activityType ?? null,
    reason: input.reason ?? null,
  }),
  recycleItem: async (itemId: string) => {
    const result = await op('/ops/recycle-item', { nonce: requestId('recycle'), item_id: itemId });
    trackSalvage(1);
    return result;
  },
  // Batch salvage (0055): ONE call settles every eligible item at or
  // under the rarity ceiling ('Common' | 'Uncommon' | 'Rare' |
  // 'Epic' — Legendary is never a ceiling). Intent only: the server
  // resolves the set from the player's inventory; the result carries
  // aggregate yields (counts by rarity, total scrap/cores, bonus
  // materials) plus the consumed rows for state sync.
  recycleBatch: async (maxRarity: string) => {
    const result = await op('/ops/recycle-batch', { nonce: requestId('recycle-batch'), max_rarity: maxRarity });
    trackSalvage(Number(result.scrapped_count ?? 0));
    return result;
  },
  // Reforge (0027): reroll ONE affix. Intent only (item + affix id) —
  // the server prices from the economy levers, rolls from the shared
  // affix pools, and returns old_affix / new_affix for the reveal.
  reforgeItem: (itemId: string, affixId: string) => op('/ops/reforge-item', { nonce: requestId('reforge'), item_id: itemId, affix_id: affixId }),
  slotPull: (betTier: number) => op('/ops/slot-pull', { nonce: requestId('slot'), bet_tier: betTier }),
  itemLock: (itemId: string, locked: boolean) => op('/ops/item-lock', { nonce: requestId('lock'), item_id: itemId, locked }),
  equipItem: async (itemId: string, slotName: string) => {
    try {
      const result = await op('/ops/equip-item', { nonce: requestId('equip'), item_id: itemId, slot_name: slotName });
      trackEquip(slotName);
      return result;
    } catch (error) {
      if (isNotFoundError(error)) {
        // The displayed item is not in the server's inventory for
        // this account — a stale display copy (an item earned before
        // the 0047 identity fix landed, or one already salvaged /
        // listed / consumed since the list was drawn). Re-sync the
        // inventory from server truth before surfacing the failure,
        // so the list the player sees is the list that exists, and
        // say what actually happened instead of a bare
        // 'Item not found'.
        await syncRuntimeItemsForUser('');
        throw new Error('That item is no longer in your inventory — your gear list has been refreshed.', { cause: error });
      }
      throw error;
    }
  },
  unequipSlot: (slotName: string) => op('/ops/unequip-slot', { nonce: requestId('unequip'), slot_name: slotName }),
  // Saved Builds SB-1 (0066): apply a saved build's full slot map
  // (all 8 slots, vehicle included) in ONE server op. The result
  // carries a per-slot outcome list and `applied` (true only on a
  // clean full apply) — the caller renders the outcomes and moves
  // the active-build marker only when applied is true.
  applyBuild: (slots: Record<string, string | null>) =>
    op('/ops/apply-build', { nonce: requestId('apply-build'), slots }),
  refuelVehicle: (cells: number, itemKey?: string) => op('/ops/refuel-vehicle', { nonce: requestId('refuel'), cells, item_key: itemKey ?? null }),
  // Mechanics & repair services (0025): self-repair is a timed job;
  // the board is post → escrow → accept → work → terminal settle.
  enqueueRepairJob: (itemId: string, kitType: string, units: number) => op('/ops/repair-enqueue', { nonce: requestId('repair-enqueue'), item_id: itemId, item_key: kitType, units }),
  postRepairJob: (itemId: string, priceCredits: number, targetPoints?: number | null) => op('/ops/repair-post', { nonce: requestId('repair-post'), item_id: itemId, price_credits: priceCredits, target_points: targetPoints ?? null }),
  acceptRepairJob: (jobId: string, kitType: string) => op('/ops/repair-accept', { nonce: requestId('repair-accept'), job_id: jobId, item_key: kitType }),
  finishRepairJob: (jobId: string) => op('/ops/repair-finish', { nonce: requestId('repair-finish'), job_id: jobId }),
  cancelRepairJob: (jobId: string) => op('/ops/repair-cancel', { nonce: requestId('repair-cancel'), job_id: jobId }),
  reclaimRepairJob: (jobId: string) => op('/ops/repair-reclaim', { nonce: requestId('repair-reclaim'), job_id: jobId }),
  // Shield-tech services (0044): self-lane recalibration is a timed
  // job; the board is post → escrow → accept → work → terminal
  // settle. Accept carries NO item_key — the Calibration Core is the
  // one consumable, a server constant.
  enqueueShieldTechJob: (itemId: string, toBehavior: string) => op('/ops/shieldtech-enqueue', { nonce: requestId('shieldtech-enqueue'), item_id: itemId, to_behavior: toBehavior }),
  // Tint jobs (0053): a timed cosmetic job against an OWNED part —
  // the palette's Chromaweave + flat Scrap escrow server-side.
  enqueueTintJob: (itemId: string, paletteId: string) => op('/ops/tint-enqueue', { nonce: requestId('tint-enqueue'), item_id: itemId, palette_id: paletteId }),
  postShieldTechJob: (itemId: string, toBehavior: string, priceCredits: number) => op('/ops/shieldtech-post', { nonce: requestId('shieldtech-post'), item_id: itemId, to_behavior: toBehavior, price_credits: priceCredits }),
  acceptShieldTechJob: (jobId: string) => op('/ops/shieldtech-accept', { nonce: requestId('shieldtech-accept'), job_id: jobId }),
  finishShieldTechJob: (jobId: string) => op('/ops/shieldtech-finish', { nonce: requestId('shieldtech-finish'), job_id: jobId }),
  cancelShieldTechJob: (jobId: string) => op('/ops/shieldtech-cancel', { nonce: requestId('shieldtech-cancel'), job_id: jobId }),
  reclaimShieldTechJob: (jobId: string) => op('/ops/shieldtech-reclaim', { nonce: requestId('shieldtech-reclaim'), job_id: jobId }),
  idleClaim: () => op('/ops/idle-claim', { nonce: requestId('idle') }),
  retrain: () => op('/ops/retrain', { nonce: requestId('retrain') }),
  trainSkill: (nodeId: string) => op('/ops/train-skill', { nonce: requestId(`train:${nodeId}`), node_id: nodeId }),
  battleResult: (targetId: string, stance = 'balanced') => op('/ops/battle-result', { nonce: requestId('battle'), target_id: targetId, stance }),
  // NOTE: no market_list event here — this one op lists gear,
  // cosmetic parts, and vehicles alike (the server stamps the kind
  // from the item), so the kind-accurate event fires at the
  // MarketScreen handlers that know what is being listed.
  marketCreate: (itemId: string, priceCredits: number) => op('/ops/market-create', { nonce: requestId('list'), item_id: itemId, price_credits: priceCredits }),
  marketCreateConsumable: async (batchId: string, quantity: number, priceCredits: number) => {
    const result = await op('/ops/market-create-consumable', { nonce: requestId('list-cons'), batch_id: batchId, quantity, price_credits: priceCredits });
    trackMarketList('consumable');
    return result;
  },
  marketCreateMaterial: async (materialId: string, quantity: number, priceCredits: number) => {
    const result = await op('/ops/market-create-material', { nonce: requestId('list-mat'), material_id: materialId, quantity, price_credits: priceCredits });
    trackMarketList('material');
    return result;
  },
  marketCreateFragment: async (quantity: number, priceCredits: number) => {
    const result = await op('/ops/market-create-fragment', { nonce: requestId('list-frag'), quantity, price_credits: priceCredits });
    trackMarketList('fragment');
    return result;
  },
  marketCreateCore: async (quantity: number, priceCredits: number) => {
    const result = await op('/ops/market-create-core', { nonce: requestId('list-core'), quantity, price_credits: priceCredits });
    trackMarketList('core');
    return result;
  },
  marketCreateEssence: async (essenceId: string, quantity: number, priceCredits: number) => {
    const result = await op('/ops/market-create-essence', { nonce: requestId('list-ess'), essence_id: essenceId, quantity, price_credits: priceCredits });
    trackMarketList('essence');
    return result;
  },
  marketCancel: (listingId: string) => op('/ops/market-cancel', { nonce: requestId('cancel'), listing_id: listingId }),
  acceptListing: (listingId: string) => op('/ops/market-accept', { nonce: requestId('accept'), listing_id: listingId }),
  resetProgress: () => op('/ops/reset-progress', { nonce: requestId('reset') }),
};

/**
 * The Workshop state read (GET /api/workshop/me): the server settles
 * the caller's craft jobs, then returns benches, fitted tools, job
 * views, mastery tracks and recent completions in the one view shape
 * (buildWorkshopStateView). A read, not a verified op — it carries no
 * profile snapshot to sync.
 */
export const fetchWorkshopState = async (): Promise<VerifiedResult> =>
  apiRequest<VerifiedResult>('/workshop/me', { method: 'GET' });

/**
 * The repair board read (GET /api/repair/board): the server settles
 * the caller's repair jobs (expiring stale listings), then returns
 * open postings, my postings, my workbench, and board/mechanic stats
 * in the one view shape (buildRepairBoardView). The browse query
 * (src/lib/market/boardQuery.ts) filters/sorts/searches/paginates
 * the open postings server-side — the Buy lane's toolkit, on the
 * board. A read, not a verified op.
 */
export const fetchRepairBoard = async (query: ServiceBoardQuery = {}): Promise<VerifiedResult> =>
  apiRequest<VerifiedResult>(`/repair/board${serviceBoardQueryString(query)}`, { method: 'GET' });

/**
 * The shield-tech board read (GET /api/shieldtech/board): the server
 * settles the caller's shield-tech jobs (expiring stale listings),
 * then returns open postings, my postings, my workbench, per-rarity
 * price medians, and board/tech stats in the one view shape
 * (buildShieldTechBoardView). Takes the same browse query as the
 * repair board (src/lib/market/boardQuery.ts — search / filters /
 * sorts / pagination over the open postings). A read, not a
 * verified op.
 */
export const fetchShieldTechBoard = async (query: ServiceBoardQuery = {}): Promise<VerifiedResult> =>
  apiRequest<VerifiedResult>(`/shieldtech/board${serviceBoardQueryString(query)}`, { method: 'GET' });

/** The boards' query string, in the market listings' param style. */
function serviceBoardQueryString(query: ServiceBoardQuery): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  };
  set('search', query.search);
  set('status', query.status && query.status.length > 0 ? query.status.join(',') : undefined);
  set('rarity', query.rarity);
  set('vehicleClass', query.vehicleClass);
  set('fromBehavior', query.fromBehavior);
  set('toBehavior', query.toBehavior);
  set('conditionMin', query.conditionMin);
  set('conditionMax', query.conditionMax);
  set('pointsMin', query.pointsMin);
  set('pointsMax', query.pointsMax);
  set('priceMin', query.priceMin);
  set('priceMax', query.priceMax);
  set('canTake', query.canTake ? '1' : undefined);
  set('sort', query.sort);
  set('limit', query.limit);
  set('offset', query.offset);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** One collection_discoveries row as served by GET /api/collections/me (0026). */
export interface CollectionDiscoveryPayload {
  family: string;
  entry_key: string;
  source: string;
  discovered_at: string;
}

/** The collection log read (GET /api/collections/me): proven
 *  discoveries + the legendary core balance. A read, not a verified
 *  op — it carries no profile snapshot to sync. */
export interface CollectionsPayload {
  legendary_cores: number;
  discoveries: CollectionDiscoveryPayload[];
}

export const fetchCollections = async (): Promise<CollectionsPayload> =>
  apiRequest<CollectionsPayload>('/collections/me', { method: 'GET' });

/** One item_instances row as served inside the profile showcase (0034). */
export interface ShowcaseItemPayload {
  id: string;
  item_level: number | null;
  rarity: string | null;
  is_locked: boolean;
  runtime_state: string;
  equipped_slot: string | null;
  payload: Record<string, unknown>;
  kind?: string | null;
  condition_current?: number | null;
  condition_max?: number | null;
  created_at: string;
}

/**
 * The lifetime record read (GET /api/profile/stats, 0034; gaps
 * closed by 0051): every figure folded server-side from server
 * records (verified-action ledger, discoveries, run/mission/job
 * rows, the kill + lifetime counters) — proven facts only. The
 * showcase block is the trophy shelf's projection of the same
 * fold. A read, not a verified op.
 */
export interface ProfileLifetimePayload {
  kills: {
    roaming: number;
    by_area: Record<string, number>;
    by_weapon_type: Record<string, number>;
    /** Accrues from claims settled after 0051 — earlier kills carry no element attribution. */
    by_element: Record<string, number>;
    elites: number;
    named_elites_downed: number;
  };
  /** Lifetime deaths — the full server death record (backfilled to 0013). */
  deaths: number;
  credits: {
    earned: number;
    spent: number;
    /** When credit counting began for this player; earlier credit history was never recorded. */
    since: string | null;
  };
  bosses: {
    attempts: number;
    victories: number;
    by_boss: Record<string, number>;
    downed: number;
  };
  endless: {
    runs: number;
    best_depth: number;
    deaths: number;
    banked: number;
    abandoned: number;
  };
  legendaries: {
    salvaged: number;
    cores_minted: number;
    cores_spent: number;
    cores_balance: number;
    discoveries_by_source: Record<string, number>;
  };
  caches: { opened: number; rewarded_keys: number };
  crafting: { total_units: number; units_by_kind: Record<string, number> };
  consumables: { used_total: number; top_used: Array<{ type: string; count: number }> };
  repair: {
    board_points_restored: number;
    board_jobs_completed: number;
    board_credits_earned: number;
    self_points_restored: number;
    self_jobs: number;
  };
  dispatch: { completed: number; foot: number; courier: number; credits_earned: number };
  extraction: { passes: number; xp_awarded: number };
  market: {
    sales: number;
    sales_volume: number;
    fees_paid: number;
    purchases: number;
    purchases_volume: number;
  };
  salvage: { items: number; scrap_earned: number };
  reforges: number;
  resurrections: number;
  collections: { discovered: number; by_family: Record<string, number> };
  showcase: {
    top_weapons: ShowcaseItemPayload[];
    /**
     * The player's hand-pinned shelf items in pin order (0058) —
     * the subset of top_weapons the owner chose. Absent from an
     * older Chef's payload; surfaces treat missing as no pins.
     */
    pinned_item_ids?: string[];
    best_endless_depth: number;
    cache_rank_tokens: number;
    cache_rank_total_ranks: number;
    collections_discovered: number;
  };
}

export const fetchProfileLifetime = async (): Promise<ProfileLifetimePayload> =>
  apiRequest<ProfileLifetimePayload>('/profile/stats', { method: 'GET' });

/**
 * Replace the caller's Trophy Shelf pins (POST
 * /api/profile/showcase-pins, 0058): the full desired list in pin
 * order; an empty list clears the pins. Validation returns as data
 * ({ok:false, error}) — the shelf panel shows the reason in place.
 */
export const setShowcasePins = async (
  itemIds: string[],
): Promise<{ ok: boolean; error?: string; pinned_item_ids?: string[] }> =>
  apiRequest('/profile/showcase-pins', { method: 'POST', body: { item_ids: itemIds } });
