/**
 * Kill cycle slice — the state for "the player is fighting a specific
 * monster right now." Holds the current target's id, current HP, max
 * HP, and a running kill count. Persisted via Zustand so a page
 * reload mid-fight keeps the same target (the monster is still
 * half-dead when the player comes back).
 *
 * Sourced by:
 *   - The idle ticker in PR 2, which calls `applyPlayerDamage` to
 *     drain the target's HP per tick.
 *   - The action stage renderer in PR 3, which reads `currentTargetId`
 *     and `currentTargetHp` to show the right sprite + HP bar.
 *   - The action feed (PR 4) for the "Killed: X (-Y HP)" entries.
 *
 * The slice is intentionally separate from `survivalSlice` because
 * it has a different lifecycle: the target's HP resets on every kill
 * (new target spawned), while the hunter's HP persists across kills.
 * Conflating them would make "resurrect after death" ambiguous.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MonsterDef } from '@/constants/monsters';

export interface KillCycleState {
  /** The id of the monster currently being fought, or null if no fight. */
  currentTargetId: string | null;
  /** Current HP of the target. */
  currentTargetHp: number;
  /** Max HP of the target (set on target spawn). */
  currentTargetHpMax: number;
  /** Number of monsters killed in the current area since last area change. */
  monstersKilledCount: number;
  /** Total monsters killed across all areas (lifetime stat). */
  totalKills: number;
  /** Id of the last monster killed (for "Killed by X" stat / recent feed). */
  lastKilledMonsterId: string | null;
  /** When the current target was spawned. Used to enforce min display time. */
  targetSpawnedAt: number | null;

  // Actions
  spawnTarget: (monster: MonsterDef) => void;
  applyPlayerDamage: (damage: number) => void;
  killCurrentTarget: () => string | null; // returns killed id, or null
  clearTarget: () => void;
  resetForAreaChange: () => void;
}

export const useKillCycleStore = create<KillCycleState>()(
  persist(
    (set, get) => ({
      currentTargetId: null,
      currentTargetHp: 0,
      currentTargetHpMax: 0,
      monstersKilledCount: 0,
      totalKills: 0,
      lastKilledMonsterId: null,
      targetSpawnedAt: null,

      spawnTarget: (monster) =>
        set({
          currentTargetId: monster.id,
          currentTargetHp: monster.hp,
          currentTargetHpMax: monster.hp,
          targetSpawnedAt: Date.now(),
        }),

      applyPlayerDamage: (damage) =>
        set((state) => {
          if (!state.currentTargetId) return state;
          const newHp = Math.max(0, state.currentTargetHp - damage);
          return { currentTargetHp: newHp };
        }),

      killCurrentTarget: () => {
        const state = get();
        const killedId = state.currentTargetId;
        if (!killedId) return null;
        set({
          currentTargetId: null,
          currentTargetHp: 0,
          currentTargetHpMax: 0,
          targetSpawnedAt: null,
          monstersKilledCount: state.monstersKilledCount + 1,
          totalKills: state.totalKills + 1,
          lastKilledMonsterId: killedId,
        });
        return killedId;
      },

      clearTarget: () =>
        set({
          currentTargetId: null,
          currentTargetHp: 0,
          currentTargetHpMax: 0,
          targetSpawnedAt: null,
        }),

      resetForAreaChange: () =>
        set({
          currentTargetId: null,
          currentTargetHp: 0,
          currentTargetHpMax: 0,
          monstersKilledCount: 0,
          targetSpawnedAt: null,
        }),
    }),
    {
      name: 'cybercache-kill-cycle',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        currentTargetId: state.currentTargetId,
        currentTargetHp: state.currentTargetHp,
        currentTargetHpMax: state.currentTargetHpMax,
        monstersKilledCount: state.monstersKilledCount,
        totalKills: state.totalKills,
        lastKilledMonsterId: state.lastKilledMonsterId,
        targetSpawnedAt: state.targetSpawnedAt,
      }),
    }
  )
);
