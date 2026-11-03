/**
 * idleTickerSlice — Server-Authoritative Idle Ticker
 *
 * ARCHITECTURE:
 * The client is a dumb renderer. Every 3 seconds, the ticker sends a
 * claim to the Chef server. The server simulates the entire tick
 * (combat, survival, item generation, rewards) and returns authoritative
 * results. The client applies those results to the stores and pushes
 * the server's feed events to the tick feed for animation.
 *
 * The client NEVER:
 *   - Computes damage locally
 *   - Generates items locally
 *   - Awards credits/XP/scrap locally
 *   - Mutates survival/killCycle/boss stores from local simulation
 *   - Records deaths or kills from local computation
 *
 * The client ONLY:
 *   - Sends the claim to the server
 *   - Applies the server's response to stores via syncVerifiedResult
 *   - Pushes the server's feed events to the tick feed
 *   - Saves the runtime snapshot for display-only preferences
 */
import { create } from 'zustand';
import {
  useActivityStore,
  useIdleStore,
  usePlayerStore,
  useCombatStatsStore,
  useSurvivalStore,
} from '@/store';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { RESUME_SETTLEMENT_MIN_HIDDEN_MS } from '@/lib/activity/activitySettlement';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import type { GearItem } from '@/types/items';
import { useTickFeedStore, type TickEvent } from './tickSlice';
import { useActiveBuffsStore } from './activeBuffsSlice';
import { useKillCycleStore } from '@/store/slices/killCycleSlice';
import { useLoadoutStore } from './loadoutSlice';
import { useVehicleStore } from './vehicleSlice';
import { VEHICLE_CONDITION_MAX } from '@/lib/vehicles/vehicles';
import type { Vehicle } from '@/types/items';
import type { ChefClaimResult, ChefVehicleStatus } from '@/lib/chef/chefClient';

const TICK_MS = 3000;
const DEFAULT_AREA_ID = ROAMING_AREAS[0]?.id ?? 'dustwaste_frontier';
/** Pause before the single same-batch claim retry (see tickNow). */
const CLAIM_RETRY_DELAY_MS = 1000;
/** Consecutive failed claim cycles before the stall is surfaced. */
const CLAIM_STALL_THRESHOLD = 2;
/** The tick guard's rejection string (roamingHandler): proof a batch landed. */
const ALREADY_CLAIMED_ERROR = 'tick_count already claimed';

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let ticking = false;
let totalTickCount = 0;
let roamingConsumableState: unknown = undefined;

// ── Foreground resume (owner report, 2026-11-02) ─────────────────
// Returning from an app switch left the stage frozen until the
// interval happened to fire: neither loop listened for visibility.
// The ticker now tracks hidden spans itself. A span SHORTER than
// the shared settlement threshold (RESUME_SETTLEMENT_MIN_HIDDEN_MS)
// is a brief app switch: tick immediately on return and fold the
// catch-up batch's routine gains silently into the feed record. A
// span at or above it is a real absence — the resume-settlement
// hook's server settle + "While You Were Away" recap own catch-up,
// and the ticker deliberately does not race them with a claim burst
// (the plain interval cadence converges from server truth via the
// tick guard).
let visibilityListenerAttached = false;
let hiddenSinceAt: number | null = null;
/** Set for the one catch-up batch that spans a brief hidden span. */
let resumeFoldPending = false;
/** Wall time of the last claim submission attempt (recheck gate). */
let lastClaimAttemptAt = 0;
let resumeRecheckId: ReturnType<typeof setTimeout> | null = null;
/** Spacing of the deferred re-checks of a busy resume tick. */
const RESUME_RECHECK_MS = 1500;
/**
 * How many re-checks a busy resume gets (≈6s of grace): a claim
 * left in flight across the backgrounding can take seconds to
 * settle on a cold network, and the catch-up tick must still fire
 * promptly once it does — but never at the cost of doubling a
 * claim that was already attempted since the return.
 */
const RESUME_RECHECK_MAX = 4;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * True when a claim rejection is the server tick guard proving this
 * batch already landed (HTTP 409 'tick_count already claimed' — the
 * claim route's only 409). Distinguishable by design: submitClaim
 * attaches the status and the server's error string to the thrown
 * error; the message checks keep older error shapes recognizable.
 */
export const isAlreadyClaimedError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; chefError?: unknown; message?: unknown };
  if (e.chefError === ALREADY_CLAIMED_ERROR) return true;
  if (e.status === 409) return true;
  if (typeof e.message === 'string') {
    return e.message.includes(ALREADY_CLAIMED_ERROR) || /^Chef claim failed \(409\)/.test(e.message);
  }
  return false;
};

export interface IdleTickerState {
  running: boolean;
  lastTickAt: number;
  /** Monotonically increasing tick counter — used as the RNG seed and server nonce. */
  totalTickCount: number;
  /**
   * Claim cycles in a row whose batch never landed (initial attempt +
   * the same-batch retry both failed). Reset by any landed claim,
   * including one proven landed by the tick guard's 409.
   */
  consecutiveClaimFailures: number;
  /**
   * Visible sync-stall flag: set once consecutiveClaimFailures reaches
   * CLAIM_STALL_THRESHOLD so the Action screen can tell the player
   * rewards are paused instead of letting the roaming scene animate
   * over a silently broken sync. Cleared by the next landed claim.
   */
  syncStalled: boolean;
  start: () => void;
  stop: () => void;
  /** Force a single tick (e.g. when the user resumes the tab or comes back from offline). */
  tickNow: () => Promise<void>;
}

/**
 * applyServerRewards — the ONLY function that writes to authoritative
 * stores after a server response. Takes the Chef's response payload and
 * applies it via syncVerifiedResult, then syncs kill cycle, survival,
 * and active buffs from the server's authoritative state.
 */
const applyServerRewards = (payload: Record<string, unknown> | undefined) => {
  if (!payload) return;

  // syncVerifiedResult applies: profile (resources), items, loadout snapshot
  syncVerifiedResult(payload);

  // Sync authoritative kill cycle state from the Chef
  const killCycle = payload.killCycle as
    | {
        currentTargetId: string | null;
        currentTargetHp: number;
        currentTargetHpMax: number;
        monstersKilledCount: number;
        totalKills: number;
        lastKilledMonsterId: string | null;
      }
    | undefined;

  if (killCycle) {
    useKillCycleStore.getState().syncFromServer(killCycle);
  }

  // Sync authoritative survival state from the Chef. killedBy/diedAt
  // carry the server's death record when this claim killed the
  // hunter — syncFromServer feeds them to the death log.
  const survival = payload.survival as
    | {
        currentHp: number;
        shieldHp: number;
        isDead?: boolean;
        killedBy?: { monsterId: string; monsterName: string; areaId: string } | null;
        diedAt?: number | null;
        trickleArmed?: boolean;
      }
    | undefined;

  if (survival) {
    useSurvivalStore.getState().syncFromServer(survival);

    // Record death only when the Chef (server) confirms the player died.
    if (survival.isDead) {
      useCombatStatsStore.getState().recordDeath({});
      const playerId = usePlayerStore.getState().id;
      if (playerId) {
        import('@/store/combatStatsSupabaseSync')
          .then(({ saveCombatStats }) => saveCombatStats(playerId))
          .catch((e) => void e);
      }
    }
  }

  // Sync consumable state from Chef
  const survivalData = payload.survival as
    | { medKitBuffer?: number; nanoSwarmTicksRemaining?: number; adrenalineActive?: boolean; }
    | undefined;
  if (survival && survivalData) {
    useSurvivalStore.getState().syncFromServer({ ...survival, ...survivalData });
  }

  // Store roaming consumable state for next claim
  if (payload.roamingConsumableState) {
    roamingConsumableState = payload.roamingConsumableState;
  }

  // Sync active buffs from Chef (server-authoritative roaming buffs)
  const serverActiveBuffs = payload.activeBuffs as
    | Array<{ consumableId: string; slot: string; remainingMs: number; remainingBuffer?: number; remainingTicks?: number; armed?: boolean; }>
    | undefined;
  if (serverActiveBuffs) {
    useActiveBuffsStore.getState().syncRoamingFromServer(serverActiveBuffs);
  }

  // Vehicle outcome (0021): status for the roaming surface, and any
  // vehicle drops join the garage at full condition (cc_store_chef_
  // items stores fresh vehicles unworn; the next runtime sync
  // reconciles exact rows).
  const vehicleStatus = payload.vehicle as ChefVehicleStatus | undefined;
  if (vehicleStatus) {
    useVehicleStore.getState().setLastClaimStatus(vehicleStatus);
    const equipped = useVehicleStore.getState().getById(useLoadoutStore.getState().slots.vehicle);
    if (equipped) {
      useVehicleStore.getState().upsertVehicle({
        ...equipped,
        conditionCurrent: vehicleStatus.conditionCurrent,
        conditionMax: vehicleStatus.conditionMax,
      });
    }
  }
  if (Array.isArray(payload.items)) {
    for (const item of payload.items as Array<Record<string, unknown>>) {
      if (item && typeof item === 'object' && 'vehicleClassId' in item) {
        const vehicle = item as unknown as Vehicle;
        useVehicleStore.getState().upsertVehicle({
          ...vehicle,
          conditionCurrent: VEHICLE_CONDITION_MAX,
          conditionMax: VEHICLE_CONDITION_MAX,
        });
      }
    }
  }
};

export const useIdleTickerStore = create<IdleTickerState>()((set, get) => ({
  running: false,
  lastTickAt: 0,
  totalTickCount: 0,
  consecutiveClaimFailures: 0,
  syncStalled: false,
  start: () => {
    if (intervalId) return;
    intervalId = setInterval(() => {
      void get().tickNow();
    }, TICK_MS);
    set({ running: true });
  },
  stop: () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
    set({ running: false });
  },
  tickNow: async () => {
    if (ticking) return;
    ticking = true;
    // Consume the resume-fold flag even if this call turns out not
    // to claim (dead, boss fight, signed out): the fold belongs to
    // the batch that spans the return, never to a later batch. A
    // busy-skip above returns before this point, so the flag
    // survives for the deferred re-check's tick.
    const foldThisBatch = resumeFoldPending;
    resumeFoldPending = false;
    try {
      // Hard stop when the hunter is dead. The resurrection flow
      // restarts the ticker after the player recovers.
      if (useSurvivalStore.getState().isDead) {
        return;
      }

      const activity = useActivityStore.getState().current;
      const now = Date.now();
      const sinceLast = lastTickAt === 0 ? TICK_MS : now - lastTickAt;
      const ticks = Math.max(1, Math.min(20, Math.floor(sinceLast / TICK_MS)));
      lastTickAt = now;
      set({ lastTickAt: now });

      // Boss fights are resolved via cc_battle_result RPC at fight start,
      // not per-tick. The ticker does nothing during boss fight activities.
      if (activity.kind !== 'roaming_loot') {
        return;
      }

      const areaId = activity.targetId || useIdleStore.getState().selectedRoamingAreaId || DEFAULT_AREA_ID;
      if (!areaId) return;

      // Seed totalTickCount from the server-authoritative lastClaimedTick
      // on first tick after page load.
      if (totalTickCount === 0) {
        const serverTick = usePlayerStore.getState().lastClaimedTick;
        if (serverTick > 0) {
          totalTickCount = serverTick;
        }
      }
      totalTickCount += 1;

      const playerId = usePlayerStore.getState().id;
      if (!playerId) return;

      // ── Send claim to the Chef ──
      // The server simulates everything: combat, survival, item generation,
      // rewards. The claim carries intent + simulation state only — the
      // Chef derives the loadout and skill bonuses from its own records
      // (trust hardening, Phase 0 Slice 6), so no gear or skill payload
      // is sent for it to ignore.
      //
      // The request is built ONCE: if the first attempt fails, the
      // batch is retried exactly once, after a short pause, with the
      // IDENTICAL payload (same ticks, same tickCount — nothing is
      // recomputed). That is safe against double-payment because of
      // the server's tick guard: a claim whose tickCount is not after
      // last_claimed_tick is refused with 409 'tick_count already
      // claimed' before any engine work, and cc_apply_chef_rewards
      // applies atomically. So the retry can only ever pay the batch
      // once: either it passes the guard and lands (the first attempt
      // never committed), or the guard fires and proves the first
      // attempt DID commit and only its response was lost.
      const claimRequest = {
        playerId,
        areaId,
        ticks,
        tickCount: totalTickCount,
        playerLevel: usePlayerStore.getState().level,
        killCycle: {
          currentTargetId: useKillCycleStore.getState().currentTargetId,
          currentTargetHp: useKillCycleStore.getState().currentTargetHp,
          currentTargetHpMax: useKillCycleStore.getState().currentTargetHpMax,
          monstersKilledCount: useKillCycleStore.getState().monstersKilledCount,
          totalKills: useKillCycleStore.getState().totalKills,
          lastKilledMonsterId: useKillCycleStore.getState().lastKilledMonsterId,
        },
        survival: {
          currentHp: useSurvivalStore.getState().currentHp,
          shieldHp: useSurvivalStore.getState().shieldHp,
          maxHp: useSurvivalStore.getState().maxHp,
          shieldNovaArmed: useSurvivalStore.getState().shieldNovaArmed,
          trickleArmed: useSurvivalStore.getState().trickleArmed,
        },
        roamingConsumableState,
      };

      lastClaimAttemptAt = Date.now();

      let chefResult: ChefClaimResult | undefined;
      let alreadyLanded = false;
      let claimFailure: unknown = null;
      try {
        const { submitClaim } = await import('@/lib/chef/chefClient');
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            chefResult = await submitClaim(claimRequest);
            claimFailure = null;
            break;
          } catch (error) {
            if (isAlreadyClaimedError(error)) {
              // The guard's 409: this batch is already paid server-
              // side. NOT a failure and NOT a payload to apply — the
              // outcome handling below converges from server truth.
              alreadyLanded = true;
              claimFailure = null;
              break;
            }
            claimFailure = error;
            if (attempt === 0) await sleep(CLAIM_RETRY_DELAY_MS);
          }
        }
      } catch (error) {
        // The chefClient module itself failed to load — a failed cycle.
        claimFailure = error;
      }

      if (alreadyLanded) {
        // Landed-but-lost: the rewards are on the server, but the
        // response payload (profile, items, feed) never reached us,
        // so there is nothing to apply — and applying anything would
        // risk double-counting. Converge the inventory from the
        // server's item ledger instead; profile / kill-cycle /
        // survival converge on the next successful claim's payload.
        try {
          const { syncRuntimeItemsForUser } = await import('@/lib/api/runtimeStateService');
          await syncRuntimeItemsForUser(playerId);
        } catch (error) {
          void error;
        }
        set({ consecutiveClaimFailures: 0, syncStalled: false });
      } else if (claimFailure) {
        // A failed Chef claim pays NOTHING. There is deliberately no
        // fallback engine: the retired cc_claim_roaming_rewards path
        // paid stale flat rates (1 credit/tick, 0 scrap in every area,
        // no gear mods, skills, or consumables) whenever the Chef
        // hiccuped, silently settling the player off-design. The
        // failed batch is skipped and the next cycle retries against
        // the Chef — but the failure is no longer silent: consecutive
        // failed cycles trip syncStalled, which the Action screen
        // renders until a claim lands again.
        const failures = get().consecutiveClaimFailures + 1;
        set({
          consecutiveClaimFailures: failures,
          ...(failures >= CLAIM_STALL_THRESHOLD ? { syncStalled: true } : {}),
        });
        console.warn('[idleTicker] Chef claim failed; no rewards applied this cycle:', claimFailure);
      } else if (chefResult) {
        set({ consecutiveClaimFailures: 0, syncStalled: false });
        try {
        // ── Apply server-authoritative results ──
        // This is the ONLY place that writes to authoritative stores.
        applyServerRewards(chefResult as unknown as Record<string, unknown>);

        // Record server-confirmed kills
        const confirmedKills = chefResult.rewards?.killsRecorded ?? 0;
        if (confirmedKills > 0) {
          useCombatStatsStore.getState().recordKill({ areaId, count: confirmedKills });
          try {
            const { saveCombatStats } = await import('@/store/combatStatsSupabaseSync');
            await saveCombatStats(playerId);
          } catch (error) {
            void error;
          }
        }

        // ── Push server's feed events to the tick feed ──
        // These events drive the diorama animations (enemy HP drain,
        // damage numbers, loot popups, death animations). They come
        // from the server's simulation, not local computation.
        const feedStore = useTickFeedStore.getState();
        if (chefResult.feedEvents && chefResult.feedEvents.length > 0) {
          // Replace the feed with the server's events for this tick batch.
          // Keep kill/damage/death events from the previous batch so
          // animations in progress don't snap back.
          const keeperTones = new Set(['kill', 'damage', 'death', 'hit', 'heal']);
          const keepers = feedStore.events.filter((e) => keeperTones.has(e.tone));
          // Silent fold: the catch-up batch for a brief app switch
          // stamps its routine events folded — they join the record
          // and drive the stage, but the gain-toast lane skips them
          // (no pop-up burst on return). A single-tick batch is just
          // the normal flow and is never folded; gear drops keep
          // their moment at any batch size.
          const batchEvents = foldThisBatch && ticks >= 2
            ? (chefResult.feedEvents as TickEvent[]).map((event) => (event.gear ? event : { ...event, folded: true }))
            : (chefResult.feedEvents as TickEvent[]);
          const merged = [...batchEvents, ...keepers];
          if (feedStore.clear) {
            feedStore.clear();
          }
          feedStore.push(merged);
        }
        } catch (error) {
          // The claim landed; only the local application of its
          // results glitched. Not a sync failure — the stall counter
          // tracks claim transport — and the next cycle's payload
          // re-syncs the authoritative stores.
          console.warn('[idleTicker] Failed to apply Chef claim results:', error);
        }
      }

      // Persist runtime stores to Supabase (debounced sync)
      await saveCurrentRuntimeStores();
    } finally {
      ticking = false;
    }
  },
}));

/**
 * Visibility driver for the resume behavior described above. On
 * hidden it only stamps the span start (the interval keeps its own
 * behavior; a backgrounded WebView pauses timers itself). On
 * visible it classifies the span that just ended:
 *
 *  - Brief switch (< RESUME_SETTLEMENT_MIN_HIDDEN_MS): fire a tick
 *    NOW — the stage resumes mid-action instead of waiting out the
 *    interval phase — and arm the silent fold for its batch. If
 *    that tick is skipped because a pre-hide claim is still in
 *    flight (a frozen WebView can leave one hanging), bounded
 *    deferred re-checks fire the catch-up tick once the in-flight
 *    claim has settled — but only if no claim was attempted since
 *    the return, so a landed resume claim is never doubled up
 *    off-cadence.
 *  - Real absence (>= threshold): do nothing. The resume
 *    settlement hook owns this return (server settle-offline +
 *    recap); the interval cadence converges the ticker from server
 *    truth without a competing claim burst.
 */
const handleTickerVisibility = (): void => {
  if (typeof document === 'undefined') return;
  if (document.hidden) {
    if (hiddenSinceAt === null) hiddenSinceAt = Date.now();
    return;
  }
  if (hiddenSinceAt === null) return;
  const spanMs = Date.now() - hiddenSinceAt;
  hiddenSinceAt = null;
  if (spanMs >= RESUME_SETTLEMENT_MIN_HIDDEN_MS) return;
  resumeFoldPending = true;
  const visibleAt = Date.now();
  void useIdleTickerStore.getState().tickNow();
  if (resumeRecheckId) clearTimeout(resumeRecheckId);
  let rechecksLeft = RESUME_RECHECK_MAX;
  const recheck = () => {
    resumeRecheckId = null;
    if (lastClaimAttemptAt >= visibleAt) return; // the resume claim landed — done
    if (!ticking) {
      resumeFoldPending = true;
      void useIdleTickerStore.getState().tickNow();
      return;
    }
    // Still busy with the pre-hide claim: check again shortly,
    // a bounded number of times, then let the interval cadence
    // own it (the claim in flight IS a sync when it lands).
    rechecksLeft -= 1;
    if (rechecksLeft > 0) resumeRecheckId = setTimeout(recheck, RESUME_RECHECK_MS);
  };
  resumeRecheckId = setTimeout(recheck, RESUME_RECHECK_MS);
};

/** Mount the singleton ticker interval. Call from App.tsx once. */
export const mountIdleTicker = (): void => {
  if (typeof document !== 'undefined' && !visibilityListenerAttached) {
    document.addEventListener('visibilitychange', handleTickerVisibility);
    visibilityListenerAttached = true;
  }
  if (intervalId) return;
  intervalId = setInterval(() => {
    void useIdleTickerStore.getState().tickNow();
  }, TICK_MS);
  useIdleTickerStore.setState({ running: true, lastTickAt: Date.now() });
  // Come alive immediately: on a cold start the first claim lands
  // one network round-trip after mount instead of up to a full
  // tick later, so the stage shows the live action as soon as the
  // boot snapshot paints. (lastTickAt is still unset here, so this
  // tick claims exactly one tick — the boot settlement already
  // owned the away time.)
  void useIdleTickerStore.getState().tickNow();
};

/** Unmount the singleton ticker interval. Call on logout / unmount. */
export const unmountIdleTicker = (): void => {
  if (visibilityListenerAttached && typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleTickerVisibility);
    visibilityListenerAttached = false;
  }
  if (resumeRecheckId) {
    clearTimeout(resumeRecheckId);
    resumeRecheckId = null;
  }
  hiddenSinceAt = null;
  resumeFoldPending = false;
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  useIdleTickerStore.setState({ running: false, consecutiveClaimFailures: 0, syncStalled: false });
  lastTickAt = 0;
};

/** Resolve which area the ticker should be claiming for. */
export const resolveTickAreaId = (): string => {
  const activity = useActivityStore.getState().current;
  if (activity.kind === 'roaming_loot' && activity.targetId) return activity.targetId;
  return useIdleStore.getState().selectedRoamingAreaId || DEFAULT_AREA_ID;
};

/** Type guard to detect a weapon in a gear drop. */
export const isWeaponDrop = (gear: GearItem | undefined): gear is GearItem & { weaponType: string } =>
  !!gear && 'weaponType' in gear;
