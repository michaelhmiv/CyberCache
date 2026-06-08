import { supabase } from './client';

export type VerifiedResult = Record<string, unknown>;

const requestId = (prefix: string): string => {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
};

const rpc = async (fn: string, args: Record<string, unknown>): Promise<VerifiedResult> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as VerifiedResult;
};

export const verifiedOps = {
  initialBundle: () => rpc('cc_initial_bundle', { nonce: requestId('initial') }),
  makeItem: () => rpc('cc_make_item', { nonce: requestId('make') }),
  vendorBuy: (itemKey: string, quantity = 1) => rpc('cc_vendor_buy', { nonce: requestId('vendor'), item_key: itemKey, quantity }),
  recycleItem: (itemId: string) => rpc('cc_recycle_item', { nonce: requestId('recycle'), item_id: itemId }),
  itemLock: (itemId: string, locked: boolean) => rpc('cc_item_lock', { nonce: requestId('lock'), item_id: itemId, locked }),
  equipItem: (itemId: string, slotName: string) => rpc('cc_equip_item', { nonce: requestId('equip'), item_id: itemId, slot_name: slotName }),
  idleClaim: () => rpc('cc_idle_claim', { nonce: requestId('idle') }),
  marketCreate: (itemId: string, priceCredits: number) => rpc('cc_market_create', { nonce: requestId('list'), item_id: itemId, price_credits: priceCredits }),
  marketCancel: (listingId: string) => rpc('cc_market_cancel', { nonce: requestId('cancel'), listing_id: listingId }),
};
