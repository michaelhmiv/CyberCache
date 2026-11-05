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
 * Hold-and-claim (migration 0083): a roaming settlement is HELD, not
 * paid — the recap shows the held totals as WAITING, the held items
 * are NOT added to inventory here, and `claimOfflineEarnings` below
 * is the payment: it applies the claim receipt (profile + kept
 * items) and turns the recap into the receipt.
 *
 * Forbidden patterns (formerly present, now removed):
 *   - Client-side Date.now() for elapsed time computation
 *   - Client-side reward minting (credits, XP, scrap, materials, items)
 *   - localStorage lock for settlement deduplication (replaced by server nonce)
 *   - ActivitySettlementResult with client-computed values
 */

import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import { syncRuntimeProfile } from '@/lib/api/verifiedStateSync';
import type { OfflineCraftSettlementResult, OfflineExtractionSettlementResult, OfflineSettlementResult } from '@/lib/chef/chefClient';

/**
 * The one hidden-duration threshold that separates a brief app
 * switch from a real absence (foreground-resume slice, 2026-11-02).
 *
 * Below it, returning to the app is a LIVE resume: the foreground
 * sync loops restart the moment the app is visible again, and the
 * away ticks' routine gains fold silently into the feed record —
 * no catch-up pop-up burst. At or above it, this module's
 * server-authoritative settlement is the catch-up lane and its
 * "While You Were Away" recap is the only summary.
 *
 * Read by both the resume settlement hook
 * (useOfflineResumeSettlement) and the idle ticker
 * (idleTickerSlice) — retune it here, nowhere else.
 */
export const RESUME_SETTLEMENT_MIN_HIDDEN_MS = 15_000;

/**
 * Result shape for downstream consumers (OfflineRecap component).
 * Derived from the server response — the client never computes these values.
 */
export type SettlementRecap = OfflineSettlementResult | OfflineCraftSettlementResult | OfflineExtractionSettlementResult;

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

    // Craft settlement (0024): the recorded action was crafting, so
    // the server advanced craft jobs instead of roaming ticks. There
    // is no roaming profile/items payload to apply — the workshop
    // mirror refreshes from the server's workshop view, and the recap
    // renders the crafting section. (Profile-level changes — XP,
    // materials, batches — land with the session's normal profile
    // hydration.)
    if ('crafting' in result) {
      const { useWorkshopStore } = await import('@/store/slices/workshopSlice');
      await useWorkshopStore.getState().refresh();
      if (options.saveSnapshot !== false) {
        await saveCurrentRuntimeStores(userId);
      }
      const { useOfflineRecapStore } = await import('@/store/slices/offlineRecapSlice');
      useOfflineRecapStore.getState().setSettlement(result);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('cybercache:activity-settled', { detail: result }),
        );
      }
      return result;
    }

    // Extraction settlement (0033): the recorded action was
    // extraction, so the server finalized passes instead of roaming
    // ticks. Finds + XP already landed server-side; the recap
    // renders the extraction section and profile hydration carries
    // the balances. Nothing is applied client-side.
    if ('extraction' in result) {
      if (options.saveSnapshot !== false) {
        await saveCurrentRuntimeStores(userId);
      }
      const { useOfflineRecapStore } = await import('@/store/slices/offlineRecapSlice');
      useOfflineRecapStore.getState().setSettlement(result);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('cybercache:activity-settled', { detail: result }),
        );
      }
      return result;
    }

    // Apply server-authoritative profile to client stores. For a
    // HELD settlement (0083) the snapshot's balances are the
    // pre-claim ones and its offline_hold key carries the waiting
    // totals — the Home OFFLINE button reads them from there.
    syncRuntimeProfile(result.profile as Parameters<typeof syncRuntimeProfile>[0]);

    // Add server-generated items to inventory (upsert, not replace —
    // receiveServerItems is a full reconcile now, so use upsertItem
    // to add only the newly persisted items). Vehicle drops (0021)
    // are not GearItem — they join the garage at full condition.
    // HELD settlements skip this entirely: the drops are payloads in
    // the server's hold, not inventory — they land at claim.
    if (!result.held && result.items.length > 0) {
      const { useInventoryStore } = await import('@/store/slices/inventorySlice');
      const { useVehicleStore } = await import('@/store/slices/vehicleSlice');
      const { VEHICLE_CONDITION_MAX } = await import('@/lib/vehicles/vehicles');
      const inv = useInventoryStore.getState();
      result.items.forEach((item) => {
        if (item && typeof item === 'object' && 'vehicleClassId' in item) {
          useVehicleStore.getState().upsertVehicle({
            ...(item as unknown as import('@/types/items').Vehicle),
            conditionCurrent: VEHICLE_CONDITION_MAX,
            conditionMax: VEHICLE_CONDITION_MAX,
          });
        } else {
          inv.upsertItem(item);
        }
      });
    }

    // Vehicle outcome (0021): same status block as a live claim.
    if (result.vehicle) {
      const { useVehicleStore } = await import('@/store/slices/vehicleSlice');
      useVehicleStore.getState().setLastClaimStatus(result.vehicle);
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
 * Claim the held offline settlement (migration 0083) — the payment
 * half of hold-and-claim, fired by the Home OFFLINE button and the
 * Return Sheet's Claim button.
 *
 * The server pays the hold exactly once and returns the receipt:
 * this applies the post-claim profile (balances moved, offline_hold
 * zeroed), upserts the KEPT items (the claim's auto-salvage pass
 * already filtered the salvaged drops out server-side), and writes
 * the receipt into the recap store so the Return Sheet flips from
 * WAITING to the receipt in place. Returns the receipt recap, or
 * null when nothing was held / the claim failed (the hold stays
 * pending either way — a failed claim never loses the earnings).
 */
export async function claimOfflineEarnings(
  options: { userId?: string | null; saveSnapshot?: boolean } = {},
): Promise<SettlementRecap | null> {
  // No userId gate: the claim's identity is the session JWT (the
  // server derives the player from it, never from a body) — the id
  // here only targets the runtime snapshot save, which falls back
  // to the sync module's active user when omitted.
  const userId = options.userId;

  try {
    const { claimOffline } = await import('@/lib/chef/chefClient');
    const claim = await claimOffline();

    if (!claim.claimed || !claim.rewards) {
      // Nothing held (or already claimed): still sync the returned
      // profile so the button's pending figure settles to truth.
      if (claim.profile) {
        syncRuntimeProfile(claim.profile as Parameters<typeof syncRuntimeProfile>[0]);
      }
      return null;
    }

    // Apply the post-claim profile — the wallet answers here (the
    // Strip's pulse-on-increase fires off these very numbers).
    syncRuntimeProfile(claim.profile as Parameters<typeof syncRuntimeProfile>[0]);

    // Upsert the kept items — same vehicle/gear split as settlement.
    const keptItems = claim.items ?? [];
    if (keptItems.length > 0) {
      const { useInventoryStore } = await import('@/store/slices/inventorySlice');
      const { useVehicleStore } = await import('@/store/slices/vehicleSlice');
      const { VEHICLE_CONDITION_MAX } = await import('@/lib/vehicles/vehicles');
      const inv = useInventoryStore.getState();
      keptItems.forEach((item) => {
        if (item && typeof item === 'object' && 'vehicleClassId' in item) {
          useVehicleStore.getState().upsertVehicle({
            ...(item as unknown as import('@/types/items').Vehicle),
            conditionCurrent: VEHICLE_CONDITION_MAX,
            conditionMax: VEHICLE_CONDITION_MAX,
          });
        } else {
          inv.upsertItem(item);
        }
      });
    }

    if (options.saveSnapshot !== false) {
      if (userId) await saveCurrentRuntimeStores(userId);
      else await saveCurrentRuntimeStores();
    }

    // The receipt, in the recap's own shape (held: false — paid).
    const receipt: OfflineSettlementResult = {
      settled: true,
      held: false,
      areaId: claim.areaId ?? '',
      areaName: claim.areaName ?? '',
      timeAway: claim.timeAway ?? '',
      elapsedMs: claim.elapsedMs ?? 0,
      cappedMs: claim.elapsedMs ?? 0,
      capReached: claim.capReached ?? false,
      capHours: claim.capHours ?? 0,
      ticksSettled: claim.ticksSettled ?? 0,
      startTick: claim.startTick ?? 0,
      endTick: claim.endTick ?? 0,
      profile: claim.profile ?? {},
      rewards: claim.rewards,
      items: keptItems,
      feedEvents: claim.feedEvents ?? [],
      idempotent: false,
      ...(claim.autoSalvage ? { autoSalvage: claim.autoSalvage } : {}),
      ...(claim.standing ? { standing: claim.standing } : {}),
    };

    const { useOfflineRecapStore } = await import('@/store/slices/offlineRecapSlice');
    useOfflineRecapStore.getState().setSettlement(receipt);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('cybercache:offline-claimed', { detail: receipt }),
      );
    }

    return receipt;
  } catch (error) {
    console.warn(
      '[activitySettlement] Offline claim failed:',
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
