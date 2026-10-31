/**
 * Survival slice — the hunter's HP, death state, and last-killed-by log.
 *
 * Persisted via the runtime snapshot (see runtimeSupabaseSync.ts).
 * A page reload preserves the hunter's HP, death state, and resurrection timer.
 *
 * Death and resurrection are server-owned (Phase 0 Slice 4): the Chef
 * claim sim kills the hunter, the claim route records the death
 * server-side (profiles.death_state), and `syncFromServer` feeds that
 * record to `die()` so `lastKilledBy` / `deathLog` show the real
 * killer, area, and time. Resurrection goes through POST
 * /api/resurrect — the server validates the free timer against its
 * own clock and charges the paid path itself; `resurrect()` below is
 * only the local applier of the server's confirmed result.
 *
 * Sourced by:
 *   - The idle ticker, which calls `applyDamage` and `consumeConsumable`.
 *   - The action stage renderer, which reads `currentHp / maxHp` for the
 *     hunter HP bar.
 *   - The death overlay, which reads `lastKilledBy` and `resurrectionOptions`.
 *   - The profile, which reads the `deathLog` for the "Killed by" stat.
 */
import { create } from 'zustand';
import { computeHunterMaxHp } from '@/lib/combat/damageContract';
import { RESURRECTION_FREE_TIMER_MS } from '@/lib/combat/resurrectionCost';

export interface DeathLogEntry {
  monsterId: string;
  monsterName: string;
  areaId: string;
  at: number;
}

export interface ResurrectionChoice {
  id: 'free_timer' | 'pay_credits';
  label: string;
  description: string;
  /** Credit cost. 0 for free. */
  creditCost: number;
  /** Milliseconds before free resurrection completes. */
  timerMs?: number;
}

export const RESURRECTION_CHOICES: ResurrectionChoice[] = [
  {
    id: 'free_timer',
    label: 'Free Recovery',
    description: 'Wait it out. 5 minutes — validated by the server against the recorded death time.',
    creditCost: 0,
    timerMs: RESURRECTION_FREE_TIMER_MS,
  },
  {
    id: 'pay_credits',
    label: 'Pay Credits',
    description: 'Skip the timer for a fee charged by the server. Scales with the tier of the area you died in.',
    creditCost: 0, // computed at render time from the death record's area
  },
];

export interface SurvivalState {
  currentHp: number;
  maxHp: number;
  shieldHp: number;
  /**
   * Nova shield arm state (Phase 2c): server-authoritative, synced
   * from claim results and sent back on the next claim so a spent
   * nova stays spent until the shield recharges past the threshold.
   */
  shieldNovaArmed: boolean;
  /** Med Kit HP buffer — absorbs damage after shield, before HP. */
  medKitBuffer: number;
  /** Nano Swarm regen ticks remaining — heals N HP per tick. */
  nanoSwarmTicksRemaining: number;
  /** Adrenaline Shot DPS burst active state. */
  adrenalineActive: boolean;
  adrenalineExpiresAt: number;
  isDead: boolean;
  lastKilledBy: DeathLogEntry | null;
  deathLog: DeathLogEntry[];
  /** Free resurrection start time. When `Date.now() >= readyAt`, free recovery is available. */
  resurrectionStartedAt: number | null;
  resurrectionReadyAt: number | null;
  /** HP threshold (0-1) below which auto-eat triggers. Default 0.7. */
  autoEatThreshold: number;

  // Actions
  recomputeMaxHp: (playerLevel: number, shieldHp: number) => void;
  applyDamage: (hpDamage: number) => void;
  heal: (amount: number) => void;
  refillShield: (amount: number) => void;
  setMedKitBuffer: (amount: number) => void;
  tickNanoSwarm: (healPerTick: number) => boolean;
  startNanoSwarm: (ticks: number) => void;
  triggerAdrenaline: (durationMs: number) => void;
  isAdrenalineActive: () => boolean;
  consumeConsumable: (consumableId: string) => void;
  setAutoEatThreshold: (threshold: number) => void;
  die: (entry: DeathLogEntry) => void;
  startResurrection: (readyAt: number) => void;
  /**
   * Apply a server-confirmed resurrection locally (full HP, death
   * state cleared). The authority is POST /api/resurrect — callers
   * must only invoke this after the Chef confirms; nothing here
   * charges or validates anything.
   */
  resurrect: () => void;
  /** Replace the local death log with the server's canonical log
   *  (returned by the resurrection op). */
  syncDeathLogFromServer: (entries: DeathLogEntry[]) => void;
  /** Debug/test-only — reset to full HP. */
  resetFull: () => void;
  /** Sync authoritative survival state from the Chef server.
   *  Called when the Chef claim response includes survival data. */
  syncFromServer: (server: {
    currentHp: number;
    shieldHp: number;
    isDead?: boolean;
    killedBy?: { monsterId: string; monsterName: string; areaId: string } | null;
    diedAt?: number | null;
    shieldNovaArmed?: boolean;
  }) => void;
}

const INITIAL_MAX_HP = 700;
const INITIAL_SHIELD_HP = 0;

export const useSurvivalStore = create<SurvivalState>()((set, get) => ({
  currentHp: INITIAL_MAX_HP,
  maxHp: INITIAL_MAX_HP,
  shieldHp: INITIAL_SHIELD_HP,
  shieldNovaArmed: true,
  medKitBuffer: 0,
  nanoSwarmTicksRemaining: 0,
  adrenalineActive: false,
  adrenalineExpiresAt: 0,
  isDead: false,
  lastKilledBy: null,
  deathLog: [],
  resurrectionStartedAt: null,
  resurrectionReadyAt: null,
  autoEatThreshold: 0.7,

  recomputeMaxHp: (playerLevel, shieldHp) =>
    set((state) => {
      const newMax = computeHunterMaxHp(playerLevel, shieldHp);
      // Scale current HP proportionally so a max-HP increase doesn't free-heal.
      const ratio = state.maxHp > 0 ? state.currentHp / state.maxHp : 1;
      return {
        maxHp: newMax,
        shieldHp,
        currentHp: state.isDead ? 0 : Math.round(newMax * ratio),
      };
    }),

  applyDamage: (hpDamage) =>
    set((state) => {
      if (state.isDead) return state;
      let remaining = hpDamage;
      // Absorption order: med kit buffer → HP
      // (shield absorption is handled by the caller before calling applyDamage)
      if (state.medKitBuffer > 0 && remaining > 0) {
        const absorbed = Math.min(state.medKitBuffer, remaining);
        remaining -= absorbed;
        return { medKitBuffer: state.medKitBuffer - absorbed, currentHp: Math.max(0, state.currentHp - remaining) };
      }
      const newHp = Math.max(0, state.currentHp - remaining);
      if (newHp <= 0) {
        return { currentHp: 0, isDead: true };
      }
      return { currentHp: newHp };
    }),

  heal: (amount) =>
    set((state) => {
      if (state.isDead) return state;
      const newHp = Math.min(state.maxHp, state.currentHp + amount);
      return { currentHp: newHp };
    }),

  refillShield: (amount) =>
    set((state) => ({ shieldHp: state.shieldHp + amount })),

  setMedKitBuffer: (amount) => set({ medKitBuffer: Math.max(0, amount) }),

  tickNanoSwarm: (healPerTick) => {
    const state = get();
    if (state.nanoSwarmTicksRemaining <= 0) return false;
    state.heal(healPerTick);
    set({ nanoSwarmTicksRemaining: state.nanoSwarmTicksRemaining - 1 });
    return get().nanoSwarmTicksRemaining <= 0;
  },

  startNanoSwarm: (ticks) => set({ nanoSwarmTicksRemaining: ticks }),

  triggerAdrenaline: (durationMs) =>
    set({ adrenalineActive: true, adrenalineExpiresAt: Date.now() + durationMs }),

  isAdrenalineActive: () => {
    const state = get();
    if (!state.adrenalineActive) return false;
    if (Date.now() >= state.adrenalineExpiresAt) {
      set({ adrenalineActive: false });
      return false;
    }
    return true;
  },

  consumeConsumable: (consumableId) => {
    // Caller is responsible for decrementing the player inventory.
    if (consumableId === 'ShieldCell') {
      set((state) => ({ shieldHp: state.shieldHp + 100 }));
    }
  },

  setAutoEatThreshold: (threshold) => set({ autoEatThreshold: threshold }),

  die: (entry) =>
    set((state) => ({
      isDead: true,
      currentHp: 0,
      lastKilledBy: entry,
      deathLog: [entry, ...state.deathLog].slice(0, 20),
      // Anchored to the death's own timestamp (the server record's
      // diedAtMs on the Chef path), NOT the local clock: the free
      // timer the player watches is the same interval the server
      // validates in cc_resurrect.
      resurrectionStartedAt: entry.at,
      resurrectionReadyAt: entry.at + RESURRECTION_FREE_TIMER_MS,
    })),

  startResurrection: (readyAt) =>
    set({ resurrectionStartedAt: Date.now(), resurrectionReadyAt: readyAt }),

  resurrect: () =>
    set((state) => ({
      isDead: false,
      currentHp: state.maxHp,
      shieldHp: 0,
      medKitBuffer: 0,
      nanoSwarmTicksRemaining: 0,
      adrenalineActive: false,
      adrenalineExpiresAt: 0,
      resurrectionStartedAt: null,
      resurrectionReadyAt: null,
    })),

  syncDeathLogFromServer: (entries) =>
    set({ deathLog: entries.slice(0, 20) }),

  resetFull: () =>
    set((state) => ({
      currentHp: state.maxHp,
      shieldHp: 0,
      medKitBuffer: 0,
      nanoSwarmTicksRemaining: 0,
      adrenalineActive: false,
      adrenalineExpiresAt: 0,
      isDead: false,
      resurrectionStartedAt: null,
      resurrectionReadyAt: null,
    })),

  /** Sync authoritative survival state from the Chef server.
   *  Called when the Chef claim response includes survival data.
   *  The server is the source of truth for HP/shield and consumable state;
   *  local simulation is cosmetic only and may drift. */
  syncFromServer: (server: {
    currentHp: number;
    shieldHp: number;
    isDead?: boolean;
    killedBy?: { monsterId: string; monsterName: string; areaId: string } | null;
    diedAt?: number | null;
    medKitBuffer?: number;
    nanoSwarmTicksRemaining?: number;
    adrenalineActive?: boolean;
    shieldCellResistance?: number;
    shieldNovaArmed?: boolean;
  }) => {
    // Server-authoritative death WITH attribution: feed the server's
    // death record to die() so lastKilledBy and the death log carry
    // the real killer, area, and time (they never populated before —
    // this branch used to skip die() entirely "to avoid
    // double-logging", and nothing else ever called it). die()
    // anchors the resurrection timers to the server's diedAt.
    const before = get();
    if (!before.isDead && server.isDead === true && server.killedBy && typeof server.diedAt === 'number') {
      get().die({
        monsterId: server.killedBy.monsterId,
        monsterName: server.killedBy.monsterName,
        areaId: server.killedBy.areaId,
        at: server.diedAt,
      });
    }

    return set((state) => {
      // If server says we're dead but locally we're alive, trigger death flow
      const wasAlive = !state.isDead;
      const serverDead = server.isDead === true;
      const newHp = Math.max(0, Math.min(state.maxHp, server.currentHp));
      const newShield = Math.max(0, server.shieldHp);

      const novaArmed =
        typeof server.shieldNovaArmed === 'boolean' ? server.shieldNovaArmed : state.shieldNovaArmed;

      if (wasAlive && serverDead) {
        // Death state (log entry + timers) was either just written by
        // die() above from the server record, or — for payloads
        // without attribution — falls back to the legacy local
        // seeding below. Never overwrite timers die() already set.
        return {
          currentHp: 0,
          shieldHp: newShield,
          isDead: true,
          shieldNovaArmed: novaArmed,
          // Don't overwrite resurrection timers if already set
          resurrectionStartedAt: state.resurrectionStartedAt ?? Date.now(),
          resurrectionReadyAt: state.resurrectionReadyAt ?? Date.now() + RESURRECTION_FREE_TIMER_MS,
        };
      }

      if (state.isDead && !serverDead) {
        // Server-authoritative resurrection (e.g. after a claim that revived)
        return {
          currentHp: newHp,
          shieldHp: newShield,
          isDead: false,
          shieldNovaArmed: novaArmed,
          resurrectionStartedAt: null,
          resurrectionReadyAt: null,
        };
      }

      // Normal HP/shield sync — preserve death state
      // Include consumable survival state from Chef (display-only, synced)
      return {
        currentHp: newHp,
        shieldHp: newShield,
        isDead: serverDead,
        shieldNovaArmed: novaArmed,
        medKitBuffer: typeof server.medKitBuffer === 'number' ? server.medKitBuffer : state.medKitBuffer,
        nanoSwarmTicksRemaining: typeof server.nanoSwarmTicksRemaining === 'number' ? server.nanoSwarmTicksRemaining : state.nanoSwarmTicksRemaining,
        adrenalineActive: typeof server.adrenalineActive === 'boolean' ? server.adrenalineActive : state.adrenalineActive,
      };
    });
  },
}));
