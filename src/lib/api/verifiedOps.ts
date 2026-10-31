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
import { apiRequest } from './http';
import { syncVerifiedResult } from './verifiedStateSync';

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
  makeItem: () => op('/ops/make-item', { nonce: requestId('make') }),
  claimRewardedCacheKey: (input: { adUnitId: string; rewardSource?: string }) => op('/ops/claim-rewarded-cache-key', {
    nonce: requestId('ad-cache-key'),
    ad_unit_id: input.adUnitId,
    reward_source: input.rewardSource ?? 'admob_rewarded',
  }),
  registerPushDevice: ({ token, platform, appVersion }: { token: string; platform?: string; appVersion?: string }) => op('/push/register', {
    token,
    platform: platform ?? 'android',
    app_version: appVersion ?? null,
  }),
  disablePushDevice: (token: string) => op('/push/disable', { token }),
  vendorBuy: (itemKey: string, quantity = 1) => op('/ops/vendor-buy', { nonce: requestId('vendor'), item_key: itemKey, quantity }),
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
  enqueueCraftJob: (input: { bench: number; recipeId: string; units: number; rarity?: string | null; useCatalyst?: boolean; useRushTicket?: boolean }) => op('/ops/craft-enqueue', {
    nonce: requestId('craft-enqueue'),
    bench: input.bench,
    recipe_id: input.recipeId,
    units: input.units,
    rarity: input.rarity ?? null,
    use_catalyst: input.useCatalyst ?? false,
    use_rush_ticket: input.useRushTicket ?? false,
  }),
  cancelCraftJob: (jobId: string) => op('/ops/craft-cancel', { nonce: requestId('craft-cancel'), job_id: jobId }),
  unlockCraftBench: () => op('/ops/craft-unlock-bench', { nonce: requestId('craft-bench') }),
  fitWorkshopTool: (bench: number, toolId: string | null) => op('/ops/craft-fit-tool', {
    nonce: requestId('craft-fit'),
    bench,
    tool_id: toolId,
  }),
  consumeConsumable: (input: { itemKey: string; quantity: number; activityType?: string; reason?: string }) => op('/ops/consume-consumable', {
    nonce: requestId('consume-consumable'),
    item_key: input.itemKey,
    quantity: input.quantity,
    activity_type: input.activityType ?? null,
    reason: input.reason ?? null,
  }),
  recycleItem: (itemId: string) => op('/ops/recycle-item', { nonce: requestId('recycle'), item_id: itemId }),
  // Reforge (0027): reroll ONE affix. Intent only (item + affix id) —
  // the server prices from the economy levers, rolls from the shared
  // affix pools, and returns old_affix / new_affix for the reveal.
  reforgeItem: (itemId: string, affixId: string) => op('/ops/reforge-item', { nonce: requestId('reforge'), item_id: itemId, affix_id: affixId }),
  itemLock: (itemId: string, locked: boolean) => op('/ops/item-lock', { nonce: requestId('lock'), item_id: itemId, locked }),
  equipItem: (itemId: string, slotName: string) => op('/ops/equip-item', { nonce: requestId('equip'), item_id: itemId, slot_name: slotName }),
  unequipSlot: (slotName: string) => op('/ops/unequip-slot', { nonce: requestId('unequip'), slot_name: slotName }),
  refuelVehicle: (cells: number, itemKey?: string) => op('/ops/refuel-vehicle', { nonce: requestId('refuel'), cells, item_key: itemKey ?? null }),
  // Mechanics & repair services (0025): self-repair is a timed job;
  // the board is post → escrow → accept → work → terminal settle.
  enqueueRepairJob: (itemId: string, kitType: string, units: number) => op('/ops/repair-enqueue', { nonce: requestId('repair-enqueue'), item_id: itemId, item_key: kitType, units }),
  postRepairJob: (itemId: string, priceCredits: number, targetPoints?: number | null) => op('/ops/repair-post', { nonce: requestId('repair-post'), item_id: itemId, price_credits: priceCredits, target_points: targetPoints ?? null }),
  acceptRepairJob: (jobId: string, kitType: string) => op('/ops/repair-accept', { nonce: requestId('repair-accept'), job_id: jobId, item_key: kitType }),
  finishRepairJob: (jobId: string) => op('/ops/repair-finish', { nonce: requestId('repair-finish'), job_id: jobId }),
  cancelRepairJob: (jobId: string) => op('/ops/repair-cancel', { nonce: requestId('repair-cancel'), job_id: jobId }),
  reclaimRepairJob: (jobId: string) => op('/ops/repair-reclaim', { nonce: requestId('repair-reclaim'), job_id: jobId }),
  idleClaim: () => op('/ops/idle-claim', { nonce: requestId('idle') }),
  retrain: () => op('/ops/retrain', { nonce: requestId('retrain') }),
  trainSkill: (nodeId: string) => op('/ops/train-skill', { nonce: requestId(`train:${nodeId}`), node_id: nodeId }),
  battleResult: (targetId: string, stance = 'balanced') => op('/ops/battle-result', { nonce: requestId('battle'), target_id: targetId, stance }),
  marketCreate: (itemId: string, priceCredits: number) => op('/ops/market-create', { nonce: requestId('list'), item_id: itemId, price_credits: priceCredits }),
  marketCreateConsumable: (batchId: string, quantity: number, priceCredits: number) => op('/ops/market-create-consumable', { nonce: requestId('list-cons'), batch_id: batchId, quantity, price_credits: priceCredits }),
  marketCreateMaterial: (materialId: string, quantity: number, priceCredits: number) => op('/ops/market-create-material', { nonce: requestId('list-mat'), material_id: materialId, quantity, price_credits: priceCredits }),
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
 * in the one view shape (buildRepairBoardView). A read, not a
 * verified op.
 */
export const fetchRepairBoard = async (): Promise<VerifiedResult> =>
  apiRequest<VerifiedResult>('/repair/board', { method: 'GET' });

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
