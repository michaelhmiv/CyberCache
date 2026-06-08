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

export const verifiedOps = {
  initialBundle: () => rpc('cc_initial_bundle', { nonce: requestId('initial') }),
  makeItem: () => rpc('cc_make_item', { nonce: requestId('make') }),
  vendorBuy: (itemKey: string, quantity = 1) => rpc('cc_vendor_buy', { nonce: requestId('vendor'), item_key: itemKey, quantity }),
  recycleItem: (itemId: string) => rpc('cc_recycle_item', { nonce: requestId('recycle'), item_id: itemId }),
  itemLock: (itemId: string, locked: boolean) => rpc('cc_item_lock', { nonce: requestId('lock'), item_id: itemId, locked }),
  equipItem: (itemId: string, slotName: string) => rpc('cc_equip_item', { nonce: requestId('equip'), item_id: itemId, slot_name: slotName }),
  unequipSlot: (slotName: string) => rpc('cc_unequip_slot', { nonce: requestId('unequip'), slot_name: slotName }),
  idleClaim: () => rpc('cc_idle_claim', { nonce: requestId('idle') }),
  retrain: () => rpc('cc_retrain', { nonce: requestId('retrain') }),
  battleResult: (targetId: string, stance = 'balanced') => rpc('cc_battle_result', { nonce: requestId('battle'), target_id: targetId, stance }),
  marketCreate: (itemId: string, priceCredits: number) => rpc('cc_market_create', { nonce: requestId('list'), item_id: itemId, price_credits: priceCredits }),
  marketCancel: (listingId: string) => rpc('cc_market_cancel', { nonce: requestId('cancel'), listing_id: listingId }),
  acceptListing: (listingId: string) => rpc('cc_accept_listing', { nonce: requestId('accept'), listing_id: listingId }),
  requestItemService: (itemId: string, serviceId = 'repair') => rpc('cc_item_service_request', { nonce: requestId('service-request'), item_id: itemId, service_id: serviceId }),
  acceptItemService: (jobId: string, priceCredits: number, durationMinutes = 60) => rpc('cc_item_service_accept', { nonce: requestId('service-accept'), job_id: jobId, price_credits: priceCredits, duration_minutes: durationMinutes }),
  finishItemService: (jobId: string) => rpc('cc_item_job_finish', { nonce: requestId('service-finish'), job_id: jobId }),
  resetProgress: () => rpc('cc_reset_progress', { nonce: requestId('reset') }),
};
