/**
 * Survival slice — the hunter's HP, death state, and last-killed-by log.
 *
 * Persisted via the Supabase runtime snapshot (see runtimeSupabaseSync.ts).
 * A page reload preserves the hunter's HP, death state, and resurrection timer.
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

export interface DeathLogEntry {
  monsterId: string;
  monsterName: string;
  areaId: string;
  at: number;
}

export interface ResurrectionChoice {
  id: 'free_timer' | 'pay_credits' | 'consume_revivetoken';
  label: string;
  description: string;
  /** Credit cost. 0 for free / token. */
  creditCost: number;
  /** Milliseconds before free resurrection completes. */
  timerMs?: number;
}

export const RESURRECTION_CHOICES: ResurrectionChoice[] = [
  {
    id: 'free_timer',
    label: 'Free Recovery',
    description: 'Wait it out. 5 minutes.',
    creditCost: 0,
    timerMs: 5 * 60 * 1000,
  },
  {
    id: 'pay_credits',
    label: 'Pay Credits',
    description: 'Skip the timer for a fee. Scales with area tier.',
    creditCost: 0, // computed at render time from current area
  },
  {
    id: 'consume_revivetoken',
    label: 'Use Revive Token',
    description: 'Consume a crafted revive token for instant recovery.',
    creditCost: 0,
  },
];

export interface SurvivalState {
  currentHp: number;
  maxHp: number;
  shieldHp: number;
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
  resurrect: () => void;
  /** Pay credits to skip the free timer. Caller must have already
   *  deducted credits from the player store. */
  resurrectPaid: () => void;
  /** Consume a revive token. Caller must have already decremented the
   *  player's ReviveToken count from the player store. */
  resurrectToken: () => void;
  /** Debug/test-only — reset to full HP. */
  resetFull: () => void;
  /** Sync authoritative survival state from the Chef server.
   *  Called when the Chef claim response includes survival data. */
  syncFromServer: (server: { currentHp: number; shieldHp: number; isDead?: boolean }) => void;
}

const INITIAL_MAX_HP = 700;
const INITIAL_SHIELD_HP = 0;

export const useSurvivalStore = create<SurvivalState>()((set, get) => ({
  currentHp: INITIAL_MAX_HP,
  maxHp: INITIAL_MAX_HP,
  shieldHp: INITIAL_SHIELD_HP,
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
      resurrectionStartedAt: Date.now(),
      resurrectionReadyAt: Date.now() + 5 * 60 * 1000,
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

  resurrectPaid: () =>
    set((state) => {
      if (!state.isDead) return state;
      return {
        isDead: false,
        currentHp: state.maxHp,
        shieldHp: 0,
        medKitBuffer: 0,
        nanoSwarmTicksRemaining: 0,
        adrenalineActive: false,
        adrenalineExpiresAt: 0,
        resurrectionStartedAt: null,
        resurrectionReadyAt: null,
      };
    }),

  resurrectToken: () =>
    set((state) => {
      if (!state.isDead) return state;
      return {
        isDead: false,
        currentHp: state.maxHp,
        shieldHp: 0,
        medKitBuffer: 0,
        nanoSwarmTicksRemaining: 0,
        adrenalineActive: false,
        adrenalineExpiresAt: 0,
        resurrectionStartedAt: null,
        resurrectionReadyAt: null,
      };
    }),

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
    medKitBuffer?: number;
    nanoSwarmTicksRemaining?: number;
    adrenalineActive?: boolean;
    shieldCellResistance?: number;
  }) =>
    set((state) => {
      // If server says we're dead but locally we're alive, trigger death flow
      const wasAlive = !state.isDead;
      const serverDead = server.isDead === true;
      const newHp = Math.max(0, Math.min(state.maxHp, server.currentHp));
      const newShield = Math.max(0, server.shieldHp);

      if (wasAlive && serverDead) {
        // Server-authoritative death — trigger local death state
        // Note: death log entry should already exist on server; we don't
        // duplicate it here to avoid double-logging.
        return {
          currentHp: 0,
          shieldHp: newShield,
          isDead: true,
          // Don't overwrite resurrection timers if already set
          resurrectionStartedAt: state.resurrectionStartedAt ?? Date.now(),
          resurrectionReadyAt: state.resurrectionReadyAt ?? Date.now() + 5 * 60 * 1000,
        };
      }

      if (state.isDead && !serverDead) {
        // Server-authoritative resurrection (e.g. after a claim that revived)
        return {
          currentHp: newHp,
          shieldHp: newShield,
          isDead: false,
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
        medKitBuffer: typeof server.medKitBuffer === 'number' ? server.medKitBuffer : state.medKitBuffer,
        nanoSwarmTicksRemaining: typeof server.nanoSwarmTicksRemaining === 'number' ? server.nanoSwarmTicksRemaining : state.nanoSwarmTicksRemaining,
        adrenalineActive: typeof server.adrenalineActive === 'boolean' ? server.adrenalineActive : state.adrenalineActive,
      };
    }),
}));
