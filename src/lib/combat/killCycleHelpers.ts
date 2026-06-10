/**
 * killCycleHelpers — pure helpers for the kill cycle. No state, no
 * React, no Zustand. Used by the idle ticker to decide which monster
 * the hunter fights next after a kill.
 *
 * The pickNextTarget function prevents the same monster from spawning
 * twice in a row unless the roster has only one monster (a T1 area
 * with 3 monsters should rotate; a T1 area with 1 monster must
 * re-spawn that one).
 */
import type { MonsterDef } from '@/constants/monsters';

/**
 * Pick the next target monster from the roster. The `previousId` is
 * the id of the monster that was just killed (or null if this is the
 * first spawn). The function avoids picking the same id twice in a
 * row when the roster has alternatives.
 *
 * The function does NOT use weights — it walks the roster in array
 * order, starting from the position after the previousId. This gives
 * a natural rotation that the user can predict. The per-monster
 * weights from the area definition are honored by the caller (which
 * uses `pickAreaMonster` for the *initial* spawn) — for *successive*
 * spawns, the rotation is the design.
 *
 * Edge cases:
 *   - empty roster → null
 *   - roster of 1 → always that one
 *   - previousId is null/undefined → return the first roster member
 *   - previousId is not in the roster → return the first roster member
 */
export function pickNextTarget(
  roster: MonsterDef[],
  previousId: string | null | undefined
): MonsterDef | null {
  if (roster.length === 0) return null;
  if (roster.length === 1) return roster[0] ?? null;
  if (!previousId) return roster[0] ?? null;

  const previousIndex = roster.findIndex((m) => m.id === previousId);
  if (previousIndex === -1) return roster[0] ?? null;

  // Walk forward by 1, wrapping around. Skips duplicates when
  // possible (rosters in this game have unique ids).
  const nextIndex = (previousIndex + 1) % roster.length;
  return roster[nextIndex] ?? null;
}

/**
 * Compute the XP awarded for killing a monster. The base is
 * `monster.xpReward`. Future PRs may add bonuses (e.g. fire weakness
 * exploit, elite pack bonus) — this helper is the single hook.
 */
export function xpForKill(monster: MonsterDef, bonuses: { weaknessBonus?: number } = {}): number {
  const base = monster.xpReward;
  const weaknessMult = 1 + (bonuses.weaknessBonus ?? 0);
  return Math.floor(base * weaknessMult);
}

/**
 * Decide whether a freshly-spawned target should immediately receive
 * a "fresh" visual (full HP bar pulse) or just appear. Returns true
 * for any spawn. Reserved for future logic (e.g. elite spawns could
 * get a different cue).
 */
export function shouldShowSpawnEffect(monster: MonsterDef): boolean {
  // All spawns get the effect for now. Reserved for future logic:
  // e.g. elites could get a different cue. The `monster` arg is
  // intentionally consumed (read) to satisfy the lint rule and
  // signal that future logic should use it.
  void monster;
  return true;
}
