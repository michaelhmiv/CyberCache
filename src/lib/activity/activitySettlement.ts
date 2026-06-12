/**
 * Activity Settlement — Thin Server Adapter
 *
 * This module delegates ALL offline reward computation to the Chef server
 * via POST /api/settle-offline. It does NOT compute elapsed time, mint
 * rewards, or generate items client-side. The browser is a display layer
 * only — the server is the authoritative economy engine.
 *
 * Contract:
 *   - Client generates a settlement nonce (UUID) for idempotency.
 *   - Server computes elapsed time using DB timestamps (not Date.now()).
 *   - Server processes all eligible ticks (capped by offline_cap_hours).
 *   - Server returns authoritative profile + items + settlement summary.
 *   - Client applies returned state and dispatches recap for UI display.
 *
 * Forbidden patterns (formerly present, now removed):
 *   - Client-side Date.now() for elapsed time computation
 *   - Client-side reward minting (credits, XP, scrap, materials, items)
 *   - localStorage lock for settlement deduplication (replaced by server nonce)
 *   - ActivitySettlementResult with client-computed values
 */

import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import { syncRuntimeProfile } from '@/lib/supabase/verifiedStateSync';
import type { OfflineSettlementResult, OfflineSettlementNoOp } from '@/lib/chef/chefClient';

/**
 * Result shape for downstream consumers (OfflineRecap component).
 * Derived from the server response — the client never computes these values.
 */
export type SettlementRecap = OfflineSettlementResult;

/**
 * Request server-authoritative offline settlement.
 *
 * Returns a settlement recap for UI display, or null if:
 *   - No active roaming action
 *   - No elapsed time to settle
 *   - Settlement already processed (idempotent nonce)
 *   - Server unreachable
 *
 * The caller (AuthProvider) should dispatch the result to
 * OfflineRecapSlice for durable UI display.
 */
export async function settleActiveActivityRewards(
  options: { userId?: string | null; saveSnapshot?: boolean } = {},
): Promise<SettlementRecap | null> {
  const userId = options.userId;
  if (!userId) return null;

  // Generate a fresh settlement nonce for this login session.
  // If the server has already processed this nonce (double-call, refresh),
  // it returns idempotent no-op without double-awarding.
  const settlementNonce = globalThis.crypto?.randomUUID?.() ??
    `${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    const { settleOffline } = await import('@/lib/chef/chefClient');
    const result = await settleOffline({ playerId: userId, settlementNonce });

    if (!result.settled) {
      // No-op: not roaming, no elapsed time, or idempotent duplicate
      if (result.reason === 'idempotent') {
        console.log('[activitySettlement] settlement already processed (idempotent)');
      }
      return null;
    }

    // Apply server-authoritative profile to client stores.
    syncRuntimeProfile(result.profile as Parameters<typeof syncRuntimeProfile>[0]);

    // Add server-generated items to inventory.
    if (result.items.length > 0) {
      const { useInventoryStore } = await import('@/store/slices/inventorySlice');
      const inv = useInventoryStore.getState();
      if (inv.receiveServerItems) {
        inv.receiveServerItems(result.items);
      } else {
        result.items.forEach((item) => inv.upsertItem(item));
      }
    }

    // Save display snapshot AFTER authoritative state is applied.
    if (options.saveSnapshot !== false) {
      await saveCurrentRuntimeStores(userId);
    }

    // Write settlement result directly to OfflineRecapStore.
    // This is the PRIMARY delivery path — the OfflineRecap component
    // reads from this store. No listener race condition possible.
    const { useOfflineRecapStore } = await import('@/store/slices/offlineRecapSlice');
    useOfflineRecapStore.getState().setSettlement(result);

    // Dispatch recap event as secondary notification (debugging, telemetry).
    // The CustomEvent is NOT the primary delivery path — the store write above is.
    // Keep this event for backward-compatible listeners and dev diagnostics.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('cybercache:activity-settled', { detail: result }),
      );
    }

    return result;
  } catch (error) {
    console.warn(
      '[activitySettlement] Server settlement failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Mark that the foreground ticker just processed a reward tick.
 * Updates the client-side lastClaimTime so the next offline settlement
 * can use the foreground claim's timestamp as a floor.
 *
 * Note: This is a display convenience only. The server's
 * last_roaming_settled_at is the authoritative settlement timestamp.
 */
export function markActiveActionRewardTick(): void {
  // No-op — the server's last_roaming_settled_at is the canonical timestamp.
  // Client-side lastClaimTime is a display optimization for the auth flow,
  // not an authority for reward computation.
}
