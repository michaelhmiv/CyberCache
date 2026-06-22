import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import { supabase } from './client';
import { syncVerifiedResult } from './verifiedStateSync';

export type VerifiedResult = Record<string, unknown>;

const requestId = (prefix: string): string => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
};

const rpc = async (fn: string, args: Record<string, unknown>): Promise<VerifiedResult> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const result = data as VerifiedResult;
  syncVerifiedResult(result);
  await saveCurrentRuntimeStores();
  return result;
};

const claimRoamingRewards = async (input: { ticks: number; areaId: string; tickCount: number }): Promise<VerifiedResult> => {
  try {
    return await rpc('cc_claim_roaming_rewards', {
      ticks: input.ticks,
      area_id: input.areaId,
      tick_count: input.tickCount,
    });
  } catch (error) {
    const reason = (error as { code?: string; message?: string })?.message ?? String(error);
    console.warn('[verifiedOps] cc_claim_roaming_rewards failed, falling back to cc_idle_claim:', reason);

    // Fall back to cc_idle_claim for ANY error — not just "RPC missing".
    // cc_claim_roaming_rewards may exist but throw type errors (e.g. bigint
    // out of range on fresh accounts) that would otherwise block all roaming
    // claims and leave the player's timer running with zero rewards.
    try {
      const fallback = await rpc('cc_idle_claim', { nonce: requestId(`idle-roam:${input.areaId}`) });
      const rewards = fallback.rewards && typeof fallback.rewards === 'object'
        ? fallback.rewards as Record<string, unknown>
        : {};

      return {
        ...fallback,
        action_type: 'cc_claim_roaming_rewards:fallback',
        xp_awarded: Number(rewards.xp ?? 0),
        credits_awarded: Number(rewards.credits ?? 0),
        scrap_awarded: Number(rewards.scrap ?? 0),
        cache_fragments_awarded: Number(rewards.fragments ?? 0),
        materials: rewards.materials && typeof rewards.materials === 'object' && !Array.isArray(rewards.materials)
          ? rewards.materials as Record<string, number>
          : {},
        essences: rewards.essences && typeof rewards.essences === 'object' && !Array.isArray(rewards.essences)
          ? rewards.essences as Record<string, number>
          : {},
      };
    } catch (fallbackError) {
      console.error('[verifiedOps] cc_idle_claim fallback also failed:', fallbackError);
      throw fallbackError;
    }
  }
};

export const verifiedOps = {
  initialBundle: () => rpc('cc_initial_bundle', { nonce: requestId('initial') }),
  makeItem: () => rpc('cc_make_item', { nonce: requestId('make') }),
  claimRewardedCacheKey: (input: { adUnitId: string; rewardSource?: string }) => rpc('cc_claim_rewarded_cache_key', {
    nonce: requestId('ad-cache-key'),
    ad_unit_id: input.adUnitId,
    reward_source: input.rewardSource ?? 'admob_rewarded',
  }),
  registerPushDevice: (input: { token: string; platform?: string; appVersion?: string }) => rpc('cc_register_push_device', {
    push_token: input.token,
    platform: input.platform ?? 'android',
    app_version: input.appVersion ?? null,
  }),
  disablePushDevice: (token: string) => rpc('cc_disable_push_device', { push_token: token }),
  vendorBuy: (itemKey: string, quantity = 1) => rpc('cc_vendor_buy', { nonce: requestId('vendor'), item_key: itemKey, quantity }),
  claimCraftedConsumable: (input: { recipeId: string; itemKey: string; quantity: number }) => rpc('cc_claim_crafted_consumable', {
    nonce: requestId('craft-consumable'),
    recipe_id: input.recipeId,
    item_key: input.itemKey,
    quantity: input.quantity,
  }),
  consumeConsumable: (input: { itemKey: string; quantity: number; activityType?: string; reason?: string }) => rpc('cc_consume_consumable', {
    nonce: requestId('consume-consumable'),
    item_key: input.itemKey,
    quantity: input.quantity,
    activity_type: input.activityType ?? null,
    reason: input.reason ?? null,
  }),
  recycleItem: (itemId: string) => rpc('cc_recycle_item', { nonce: requestId('recycle'), item_id: itemId }),
  itemLock: (itemId: string, locked: boolean) => rpc('cc_item_lock', { nonce: requestId('lock'), item_id: itemId, locked }),
  equipItem: (itemId: string, slotName: string) => rpc('cc_equip_item', { nonce: requestId('equip'), item_id: itemId, slot_name: slotName }),
  unequipSlot: (slotName: string) => rpc('cc_unequip_slot', { nonce: requestId('unequip'), slot_name: slotName }),
  idleClaim: () => rpc('cc_idle_claim', { nonce: requestId('idle') }),
  retrain: () => rpc('cc_retrain', { nonce: requestId('retrain') }),
  trainSkill: (nodeId: string) => rpc('cc_train_skill', { nonce: requestId(`train:${nodeId}`), node_id: nodeId }),
  battleResult: (targetId: string, stance = 'balanced') => rpc('cc_battle_result', { nonce: requestId('battle'), target_id: targetId, stance }),
  marketCreate: (itemId: string, priceCredits: number) => rpc('cc_market_create', { nonce: requestId('list'), item_id: itemId, price_credits: priceCredits }),
  marketCancel: (listingId: string) => rpc('cc_market_cancel', { nonce: requestId('cancel'), listing_id: listingId }),
  acceptListing: (listingId: string) => rpc('cc_accept_listing', { nonce: requestId('accept'), listing_id: listingId }),
  requestItemService: (itemId: string, serviceId = 'repair') => rpc('cc_item_service_request', { nonce: requestId('service-request'), item_id: itemId, service_id: serviceId }),
  acceptItemService: (jobId: string, priceCredits: number, durationMinutes = 60) => rpc('cc_item_service_accept', { nonce: requestId('service-accept'), job_id: jobId, price_credits: priceCredits, duration_minutes: durationMinutes }),
  finishItemService: (jobId: string) => rpc('cc_item_job_finish', { nonce: requestId('service-finish'), job_id: jobId }),
  resetProgress: () => rpc('cc_reset_progress', { nonce: requestId('reset') }),
  claimRoamingRewards,
};
