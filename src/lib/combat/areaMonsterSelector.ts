/**
 * Monster selector — picks which monster from a roaming area's roster
 * is currently attacking the hunter. Pure function, no state. Used by
 * `src/store/slices/idleTickerSlice.ts` to roll the per-tick damage
 * application.
 *
 * The selector supports two modes:
 *   1. Weighted — area has a `monsterWeights` map. Each monster's weight
 *      is the relative chance of being picked on a given tick.
 *   2. Tier-derived — area has no roster configured (legacy areas, or
 *      areas added before PR 2). We derive a default roster from the
 *      area's `unlockLevel` and the global monster pool. This means
 *      every existing area works out of the box, with monsters scaling
 *      to the area's tier.
 *
 * The tier-derived default lives in `defaultMonstersForTier` and is the
 * fallback path. The intent is for every area to eventually declare its
 * own `monsterIds` explicitly so designers can tune flavor.
 */
import { MONSTERS, getMonster, type MonsterDef } from '@/constants/monsters';

export interface AreaMonsterConfig {
  /** Explicit monster ids configured for this area. */
  monsterIds?: string[];
  /** Optional per-monster weights. Missing keys are weighted 1.0. */
  monsterWeights?: Record<string, number>;
}

const TIER_PREFIX: Record<number, string> = {
  1: 'dustwaste',
  2: 'redline',
  3: 'ironwood',
  4: 'blastforge',
  5: 'prismatek',
  6: 'throwtech',
  7: 'helix',
};

/**
 * Derive the default monster list for an area by mapping `unlockLevel`
 * to a tier. Tier mapping is intentionally coarse:
 *   unlockLevel 1-3   → tier 1
 *   unlockLevel 4-7   → tier 2
 *   unlockLevel 8-11  → tier 3
 *   unlockLevel 12-15 → tier 4
 *   unlockLevel 16-19 → tier 5
 *   unlockLevel 20-23 → tier 6
 *   unlockLevel 24+   → tier 7
 * The explicit `monsterIds` field on an area is the precise knob.
 */
export function defaultMonstersForTier(unlockLevel: number): MonsterDef[] {
  // tier = Math.max(1, Math.min(7, Math.ceil((unlockLevel + 1) / 4)))
  //   unl=1 → 1,  unl=4 → 2,  unl=8 → 3,  unl=12 → 4,  unl=24 → 7
  const tier = Math.max(1, Math.min(7, Math.ceil((unlockLevel + 1) / 4)));
  const prefix = TIER_PREFIX[tier];
  return MONSTERS.filter((m) => m.id.startsWith(prefix));
}

function areaTier(unlockLevel: number): number {
  return Math.max(1, Math.min(7, Math.ceil((unlockLevel + 1) / 4)));
}

export function getAreaTier(unlockLevel: number): number {
  return areaTier(unlockLevel);
}

/**
 * Resolve the active monster roster for an area. If the area declares
 * an explicit `monsterIds` list, that wins. Otherwise, derive from
 * the area's tier via `defaultMonstersForTier`. Returns an empty array
 * if the area is so high-tier that no monsters exist yet (shouldn't
 * happen, but the type system can't prove it).
 */
export function resolveAreaMonsters(config: AreaMonsterConfig & { unlockLevel: number }): MonsterDef[] {
  if (config.monsterIds && config.monsterIds.length > 0) {
    const resolved: MonsterDef[] = [];
    for (const id of config.monsterIds) {
      const m = getMonster(id);
      if (m) resolved.push(m);
    }
    if (resolved.length > 0) return resolved;
  }
  return defaultMonstersForTier(config.unlockLevel);
}

/**
 * Pick a single monster from the roster, weighted by `monsterWeights`
 * (default weight 1.0). Deterministic when the caller passes a seeded
 * RNG; `Math.random` is the default.
 */
export function pickAreaMonster(
  config: AreaMonsterConfig & { unlockLevel: number },
  rng: () => number = Math.random
): MonsterDef | null {
  const roster = resolveAreaMonsters(config);
  if (roster.length === 0) return null;
  const weights = roster.map((m) => config.monsterWeights?.[m.id] ?? 1.0);
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (total <= 0) return roster[0] ?? null;
  const roll = rng() * total;
  let acc = 0;
  for (let i = 0; i < roster.length; i += 1) {
    acc += weights[i] ?? 0;
    if (roll < acc) return roster[i] ?? null;
  }
  return roster[roster.length - 1] ?? null;
}
