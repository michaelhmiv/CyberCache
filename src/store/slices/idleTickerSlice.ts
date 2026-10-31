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
import type { ChefVehicleStatus } from '@/lib/chef/chefClient';

const TICK_MS = 3000;
const DEFAULT_AREA_ID = ROAMING_AREAS[0]?.id ?? 'dustwaste_frontier';

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let ticking = false;
let totalTickCount = 0;
let roamingConsumableState: unknown = undefined;

export interface IdleTickerState {
  running: boolean;
  lastTickAt: number;
  /** Monotonically increasing tick counter — used as the RNG seed and server nonce. */
  totalTickCount: number;
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
      try {
        const { submitClaim } = await import('@/lib/chef/chefClient');

        const chefResult = await submitClaim({
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
          },
          roamingConsumableState,
        });

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
          const merged = [...(chefResult.feedEvents as TickEvent[]), ...keepers];
          if (feedStore.clear) {
            feedStore.clear();
          }
          feedStore.push(merged);
        }
      } catch (error) {
        // A failed Chef claim pays NOTHING. There is deliberately no
        // fallback engine: the retired cc_claim_roaming_rewards path
        // paid stale flat rates (1 credit/tick, 0 scrap in every area,
        // no gear mods, skills, or consumables) whenever the Chef
        // hiccuped, silently settling the player off-design. The
        // failed batch is skipped and the next cycle retries against
        // the Chef — the server's tick guard (tickCount must exceed
        // last_claimed_tick) keeps the numbering safe.
        console.warn('[idleTicker] Chef claim failed; no rewards applied this cycle:', error);
      }

      // Persist runtime stores to Supabase (debounced sync)
      await saveCurrentRuntimeStores();
    } finally {
      ticking = false;
    }
  },
}));

/** Mount the singleton ticker interval. Call from App.tsx once. */
export const mountIdleTicker = (): void => {
  if (intervalId) return;
  intervalId = setInterval(() => {
    void useIdleTickerStore.getState().tickNow();
  }, TICK_MS);
  useIdleTickerStore.setState({ running: true, lastTickAt: Date.now() });
};

/** Unmount the singleton ticker interval. Call on logout / unmount. */
export const unmountIdleTicker = (): void => {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  useIdleTickerStore.setState({ running: false });
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
