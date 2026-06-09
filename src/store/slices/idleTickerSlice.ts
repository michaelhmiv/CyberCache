import { create } from 'zustand';
import {
  useActivityStore,
  useIdleStore,
  useInventoryStore,
  usePlayerStore,
  useCombatStatsStore,
} from '@/store';
import {
  ROAMING_AREAS,
  getRoamingArea,
  rollAreaDropKind,
  rollAreaMaterialFind,
  buildAreaWeaponDropOptions,
} from '@/constants/roamingAreas';
import { verifiedOps } from '@/lib/supabase/verifiedOps';
import { syncVerifiedResult } from '@/lib/supabase/verifiedStateSync';
import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
import type { GearItem, Weapon } from '@/types/items';
import { useTickFeedStore, type TickEvent } from './tickSlice';

const TICK_MS = 3000;
const DROP_CHANCE = 0.22;
const FRAGMENT_CHANCE = 0.03;
const MATERIAL_FIND_CHANCE = 0.08;
const DEFAULT_AREA_ID = ROAMING_AREAS[0]?.id ?? 'dustwaste_frontier';

let intervalId: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let ticking = false;

export interface IdleTickerState {
  running: boolean;
  lastTickAt: number;
  start: () => void;
  stop: () => void;
  /** Force a single tick (e.g. when the user resumes the tab or comes back from offline). */
  tickNow: () => Promise<void>;
}

const awardLocal = (events: TickEvent[]) => {
  if (events.length === 0) return;

  for (const event of events) {
    if (event.tone === 'cash' && typeof event.value === 'number') {
      usePlayerStore.getState().addCredits(event.value);
    } else if (event.tone === 'loot' && event.gear) {
      useInventoryStore.getState().addItem(event.gear);
    } else if (event.tone === 'material' && event.value) {
      // Materials arrive via the server response — local-only mirror, never persisted.
    }
  }

  useTickFeedStore.getState().push(events);
};

const rollClientEvents = (areaId: string, ticks: number): TickEvent[] => {
  const area = getRoamingArea(areaId);
  const events: TickEvent[] = [];
  const now = Date.now();

  for (let i = 0; i < ticks; i += 1) {
    const at = now - (ticks - 1 - i) * TICK_MS;
    if (Math.random() < DROP_CHANCE) {
      const kind = rollAreaDropKind(area);
      const player = usePlayerStore.getState();
      const inv = useInventoryStore.getState();
      let gear: GearItem | undefined;
      if (kind === 'weapon') {
        const opts = buildAreaWeaponDropOptions(area, player.level);
        gear = inv.generateAndAdd(opts);
      } else if (kind === 'shield') {
        gear = inv.generateAndAddShield(player.level);
      } else if (kind === 'classMod') {
        gear = inv.generateAndAddClassMod(player.level);
      } else if (kind === 'relic') {
        gear = inv.generateAndAddRelic(player.level);
      } else {
        gear = inv.generateAndAddOrdnance(player.level);
      }
      if (gear) {
        events.push({
          id: '',
          at,
          tone: 'loot',
          label: gear.name,
          detail: `${gear.rarity} ${('weaponType' in gear) ? gear.weaponType : 'gear'}`,
          gear,
          areaId,
        });
      }
    } else if (Math.random() < FRAGMENT_CHANCE) {
      events.push({
        id: '',
        at,
        tone: 'fragment',
        label: '+1 cache fragment',
        detail: `${area.enemyType} patrol yielded a cache key fragment.`,
        areaId,
        value: 1,
      });
    } else if (Math.random() < MATERIAL_FIND_CHANCE) {
      const find = rollAreaMaterialFind(area);
      if (find) {
        events.push({
          id: '',
          at,
          tone: find.kind === 'material' ? 'material' : 'essence',
          label: `+1 ${find.type}`,
          detail: `Field sweep recovered ${find.type}.`,
          areaId,
          value: 1,
        });
      }
    } else {
      events.push({
        id: '',
        at,
        tone: 'kill',
        label: 'Enemy swept',
        detail: `${area.enemyType} routed. Credits, scrap, and XP recovered.`,
        areaId,
      });
    }
  }

  return events;
};

const applyServerRewards = (payload: Record<string, unknown> | undefined) => {
  if (!payload) return;
  syncVerifiedResult(payload);
  const player = usePlayerStore.getState();
  const credits = Number(payload.credits_awarded ?? 0);
  const scrap = Number(payload.scrap_awarded ?? 0);
  const xp = Number(payload.xp_awarded ?? 0);
  if (credits > 0) player.addCredits(credits);
  if (scrap > 0) player.addScrap(scrap);
  if (xp > 0) player.addXP(xp);

  const fragments = Number(payload.cache_fragments_awarded ?? 0);
  if (fragments > 0) player.addCacheKeyFragments(fragments);

  const materials = (payload.materials && typeof payload.materials === 'object') ? payload.materials as Record<string, number> : null;
  if (materials) {
    for (const [type, count] of Object.entries(materials)) {
      if (count > 0) player.addMaterial(type, count);
    }
  }

  const essences = (payload.essences && typeof payload.essences === 'object') ? payload.essences as Record<string, number> : null;
  if (essences) {
    for (const [type, count] of Object.entries(essences)) {
      if (count > 0) player.addEssence(type, count);
    }
  }
};

export const useIdleTickerStore = create<IdleTickerState>()((set, get) => ({
  running: false,
  lastTickAt: 0,
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
      const activity = useActivityStore.getState().current;
      const now = Date.now();
      const sinceLast = lastTickAt === 0 ? TICK_MS : now - lastTickAt;
      const ticks = Math.max(1, Math.min(20, Math.floor(sinceLast / TICK_MS)));
      lastTickAt = now;
      set({ lastTickAt: now });

      if (activity.kind !== 'roaming_loot') {
        return;
      }

      const areaId = activity.targetId || useIdleStore.getState().selectedRoamingAreaId || DEFAULT_AREA_ID;
      if (!areaId) return;

      // Client-side roll → immediate animation feedback. The server independently re-rolls and
      // validates in `cc_claim_roaming_rewards`, so the client preview is honest because the
      // server uses the same nonce+area+actor seed.
      const previewEvents = rollClientEvents(areaId, ticks);
      awardLocal(previewEvents);

      // Kill counter — one per tick that did not produce a gear/fragment/material drop.
      const killCount = previewEvents.filter((e) => e.tone === 'kill').length;
      if (killCount > 0) {
        useCombatStatsStore.getState().recordKill({ areaId, count: killCount });
        // Persist the updated combat stats so the dashboard's "kills/min"
        // counter has real data, not the old 0.75 fudge factor.
        const userId = usePlayerStore.getState().id;
        if (userId) {
          try {
            const { saveCombatStats } = await import('@/store/combatStatsSupabaseSync');
            await saveCombatStats(userId);
          } catch (error) {
            void error; // Best-effort; next tick will retry.
          }
        }
      }

      // Server validation. If the call fails, the client-side events are already shown — but the
      // server is the source of truth for persistent rewards, so a retry on the next tick will
      // reconcile. Persistence happens via the runtime snapshot.
      try {
        const result = await verifiedOps.claimRoamingRewards({ ticks, areaId });
        applyServerRewards(result as Record<string, unknown>);
        await saveCurrentRuntimeStores();
      } catch (error) {
        // Network or RPC failure — preview still shown, server will reconcile on next tick.
        console.warn('[idleTicker] roaming rewards RPC failed:', error);
      }
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
export const isWeaponDrop = (gear: GearItem | undefined): gear is Weapon => !!gear && 'weaponType' in gear;
