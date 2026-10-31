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
  consumeConsumable: (input: { itemKey: string; quantity: number; activityType?: string; reason?: string }) => op('/ops/consume-consumable', {
    nonce: requestId('consume-consumable'),
    item_key: input.itemKey,
    quantity: input.quantity,
    activity_type: input.activityType ?? null,
    reason: input.reason ?? null,
  }),
  recycleItem: (itemId: string) => op('/ops/recycle-item', { nonce: requestId('recycle'), item_id: itemId }),
  itemLock: (itemId: string, locked: boolean) => op('/ops/item-lock', { nonce: requestId('lock'), item_id: itemId, locked }),
  equipItem: (itemId: string, slotName: string) => op('/ops/equip-item', { nonce: requestId('equip'), item_id: itemId, slot_name: slotName }),
  unequipSlot: (slotName: string) => op('/ops/unequip-slot', { nonce: requestId('unequip'), slot_name: slotName }),
  refuelVehicle: (cells: number) => op('/ops/refuel-vehicle', { nonce: requestId('refuel'), cells }),
  usePatchKit: (itemId: string) => op('/ops/use-patch-kit', { nonce: requestId('patch'), item_id: itemId }),
  idleClaim: () => op('/ops/idle-claim', { nonce: requestId('idle') }),
  retrain: () => op('/ops/retrain', { nonce: requestId('retrain') }),
  trainSkill: (nodeId: string) => op('/ops/train-skill', { nonce: requestId(`train:${nodeId}`), node_id: nodeId }),
  battleResult: (targetId: string, stance = 'balanced') => op('/ops/battle-result', { nonce: requestId('battle'), target_id: targetId, stance }),
  marketCreate: (itemId: string, priceCredits: number) => op('/ops/market-create', { nonce: requestId('list'), item_id: itemId, price_credits: priceCredits }),
  marketCreateConsumable: (batchId: string, quantity: number, priceCredits: number) => op('/ops/market-create-consumable', { nonce: requestId('list-cons'), batch_id: batchId, quantity, price_credits: priceCredits }),
  marketCreateMaterial: (materialId: string, quantity: number, priceCredits: number) => op('/ops/market-create-material', { nonce: requestId('list-mat'), material_id: materialId, quantity, price_credits: priceCredits }),
  marketCancel: (listingId: string) => op('/ops/market-cancel', { nonce: requestId('cancel'), listing_id: listingId }),
  acceptListing: (listingId: string) => op('/ops/market-accept', { nonce: requestId('accept'), listing_id: listingId }),
  requestItemService: (itemId: string, serviceId = 'repair') => op('/ops/service-request', { nonce: requestId('service-request'), item_id: itemId, service_id: serviceId }),
  acceptItemService: (jobId: string, priceCredits: number, durationMinutes = 60) => op('/ops/service-accept', { nonce: requestId('service-accept'), job_id: jobId, price_credits: priceCredits, duration_minutes: durationMinutes }),
  finishItemService: (jobId: string) => op('/ops/service-finish', { nonce: requestId('service-finish'), job_id: jobId }),
  resetProgress: () => op('/ops/reset-progress', { nonce: requestId('reset') }),
};
