/**
 * Area danger assessment — the intel behind the entry warning that
 * replaced the roaming-area level locks (owner ruling 2026-11-02:
 * "I don't want to block anything" — any hunter may roam any area;
 * a hopeless matchup earns a plain-language warning, never a wall).
 *
 * The math is a duel, computed from the SAME numbers combat uses —
 * no invented stats:
 *   - the hunter's damage per tick comes from
 *     `computePlayerDamageVsMonster` (damageContract) at the mean
 *     variance roll (rng 0.5 → variance exactly 1.0);
 *   - the monster's expected damage per tick comes from
 *     `computeMonsterDamageVsHunter` at a forced hit with mean
 *     variance, weighted by the real hit chance
 *     (accuracy − dodge, clamped to [0, 1]);
 *   - the hunter's pool is maxHp + shield capacity — the same total
 *     soak the claim sim carries (maxHp already includes the shield
 *     capacity via computeHunterMaxHp, and the shield absorbs as a
 *     separate pool on top; see loadoutSurvivalStats).
 *
 * Tiers:
 *   - 'lethal'  — against the area's baseline fodder, the hunter dies
 *     in no more ticks than the kill takes: you will die before you
 *     kill even one. ("You will die immediately" tier.)
 *   - 'caution' — the fodder duel is survivable, but a brute or elite
 *     duel is lethal by the same test, or the fodder kill time is
 *     extreme (> EXTREME_KILL_TICKS ticks). ("Dangerous for your
 *     current strength.")
 *   - 'none'    — no warning. A hunter at appropriate strength sees
 *     nothing.
 *
 * HARD LAW (boss-intel law, game-wide): this module NEVER produces a
 * win-chance or readiness percentage. It reports two honest duels —
 * their damage vs your pool, your damage vs their HP — and nothing
 * else. The warning is advisory presentation on the client and a
 * settlement gate input on the server; it never blocks a roam.
 *
 * Shield-behavior procs (Absorb/Nova) and shield-element resistance
 * are excluded from the duel: both only ever help the hunter, so the
 * assessment errs on the cautious side.
 */
import type { MonsterDef } from '../../constants/monsters';
import type { RoamingAreaDef } from '../../constants/roamingAreas';
import { resolveAreaMonsters } from './areaMonsterSelector';
import {
  computeMonsterDamageVsHunter,
  computePlayerDamageVsMonster,
} from './damageContract';
import { loadoutEffectiveDps, loadoutSurvivalStats } from './loadoutSurvival';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';

export type AreaDangerTier = 'none' | 'caution' | 'lethal';

/** The hunter numbers the duel reads — all effective, post-chain values. */
export interface AreaDangerStats {
  /** Effective DPS through the full modifier chain (0 = unarmed). */
  effectiveDps: number;
  /** Max HP (already includes shield capacity — see header). */
  maxHp: number;
  /** Equipped shield capacity (0 without a shield). */
  shieldCapacity: number;
  /** 0-1 damage mitigation from the equipped shield. */
  mitigation: number;
  /** 0-1 dodge chance. */
  dodgeChance: number;
}

/** One hunter-vs-monster duel, in ticks — the warning's honest numbers. */
export interface AreaDuel {
  monsterId: string;
  monsterName: string;
  archetype: MonsterDef['archetype'];
  /** The monster's HP — what the hunter's damage is measured against. */
  monsterHp: number;
  /** Hunter damage per tick against this monster (mean variance). */
  playerDamagePerTick: number;
  /** Ticks for the hunter to kill it (Infinity when damage is 0). */
  ticksToKill: number;
  /** Expected pool loss per tick from this monster (hit-chance weighted). */
  monsterDamagePerTick: number;
  /** The hunter's total pool (maxHp + shield capacity). */
  hunterPool: number;
  /** Ticks for this monster to kill the hunter (Infinity when it can't). */
  ticksToDie: number;
}

export interface AreaDangerAssessment {
  tier: AreaDangerTier;
  /** The duel against the roster's baseline fodder — always present. */
  baseline: AreaDuel;
  /**
   * When the caution tier is driven by a brute or elite the hunter
   * cannot out-duel, that duel — so the warning can name the threat.
   */
  threat?: AreaDuel & { kind: 'brute' | 'elite' };
  /** True when the caution tier is driven by an extreme fodder kill time. */
  extremeKillTime: boolean;
}

/**
 * A fodder kill slower than this many ticks (3s each — over a minute
 * per kill) is "extreme": the hunter survives, but hunting here
 * crawls. Part of the caution tier by the owner's brief.
 */
export const EXTREME_KILL_TICKS = 20;

/**
 * A lethal pairing only counts as OVERMATCHED — the settlement
 * gate's trigger — when death is also IMMEDIATE: the baseline fodder
 * kills the hunter within this many ticks (20 ticks = 1 minute, the
 * owner's own words for the warning: "you're about to enter an area
 * where you're basically immediately going to die"). The duel alone
 * calls an unarmed hunter "lethal" even in the starter area (they
 * can never kill, but the fodder needs ~200+ ticks to kill THEM) —
 * the warning may say so, but zeroing that player's settlement would
 * punish a legitimate state. The death-loop faucet this gate exists
 * to close is the near-instant death in a top area, and only that.
 */
export const IMMEDIATE_DEATH_TICKS = 20;

function duelMonster(stats: AreaDangerStats, monster: MonsterDef): AreaDuel {
  const playerDamagePerTick = computePlayerDamageVsMonster(
    { effectiveDps: stats.effectiveDps },
    monster,
    () => 0.5,
  );
  const ticksToKill =
    playerDamagePerTick > 0 ? Math.ceil(monster.hp / playerDamagePerTick) : Infinity;

  // Expected incoming damage: the contract's hit at mean variance,
  // weighted by the real hit chance. The scripted rng forces the hit
  // (first draw 0 always connects unless dodge ≥ accuracy, in which
  // case hitChance below is 0 anyway) at variance 1.0 (second draw).
  const accuracy = monster.accuracy ?? 0.85;
  const hitChance = Math.min(1, Math.max(0, accuracy - stats.dodgeChance));
  let draw = 0;
  const hit = computeMonsterDamageVsHunter(
    monster,
    {
      maxHp: stats.maxHp,
      shieldHp: stats.shieldCapacity,
      mitigation: stats.mitigation,
      dodgeChance: stats.dodgeChance,
    },
    () => (draw++ === 0 ? 0 : 0.5),
  );
  const rawPerHit = hit.shieldAbsorbed + hit.hpDamage;
  const monsterDamagePerTick = hitChance * rawPerHit;

  const hunterPool = stats.maxHp + stats.shieldCapacity;
  const ticksToDie =
    monsterDamagePerTick > 0 ? Math.ceil(hunterPool / monsterDamagePerTick) : Infinity;

  return {
    monsterId: monster.id,
    monsterName: monster.name,
    archetype: monster.archetype,
    monsterHp: monster.hp,
    playerDamagePerTick,
    ticksToKill,
    monsterDamagePerTick,
    hunterPool,
    ticksToDie,
  };
}

function isLethalDuel(duel: AreaDuel): boolean {
  return duel.ticksToDie <= duel.ticksToKill;
}

function heaviest(
  roster: MonsterDef[],
  weights: Record<string, number> | undefined,
  pick: (m: MonsterDef) => boolean,
): MonsterDef | null {
  let best: MonsterDef | null = null;
  let bestWeight = -Infinity;
  for (const m of roster) {
    if (!pick(m)) continue;
    const w = weights?.[m.id] ?? 1.0;
    if (w > bestWeight) {
      best = m;
      bestWeight = w;
    }
  }
  return best;
}

/**
 * Assess one area against one hunter stat line. Pure: the same
 * inputs always produce the same assessment, on client or server.
 * Returns null only when the area resolves to an empty roster
 * (cannot happen for shipped areas; callers treat null as 'none').
 */
export function assessAreaDanger(
  area: RoamingAreaDef,
  stats: AreaDangerStats,
): AreaDangerAssessment | null {
  const roster = resolveAreaMonsters(area);
  if (roster.length === 0) return null;
  const weights = area.monsterWeights;

  const baseline =
    heaviest(roster, weights, (m) => m.archetype === 'fodder') ??
    heaviest(roster, weights, (m) => m.archetype !== 'elite') ??
    heaviest(roster, weights, () => true);
  if (!baseline) return null;

  const baselineDuel = duelMonster(stats, baseline);
  if (isLethalDuel(baselineDuel)) {
    return { tier: 'lethal', baseline: baselineDuel, extremeKillTime: false };
  }

  // Caution drivers, in naming order: a lethal brute, a lethal elite,
  // then an extreme fodder kill time.
  const brute = heaviest(roster, weights, (m) => m.archetype === 'brute');
  if (brute) {
    const bruteDuel = duelMonster(stats, brute);
    if (isLethalDuel(bruteDuel)) {
      return {
        tier: 'caution',
        baseline: baselineDuel,
        threat: { ...bruteDuel, kind: 'brute' },
        extremeKillTime: false,
      };
    }
  }
  const elite = heaviest(roster, weights, (m) => m.archetype === 'elite');
  if (elite) {
    const eliteDuel = duelMonster(stats, elite);
    if (isLethalDuel(eliteDuel)) {
      return {
        tier: 'caution',
        baseline: baselineDuel,
        threat: { ...eliteDuel, kind: 'elite' },
        extremeKillTime: false,
      };
    }
  }
  if (baselineDuel.ticksToKill > EXTREME_KILL_TICKS) {
    return { tier: 'caution', baseline: baselineDuel, extremeKillTime: true };
  }
  return { tier: 'none', baseline: baselineDuel, extremeKillTime: false };
}

/**
 * The current hunter's danger stats from the live stores, at full
 * fighting strength (full HP, shield at capacity): the warning is
 * about the build vs the area, not about momentary wounds. Client
 * only — server callers derive stats from server records and call
 * assessAreaDanger directly.
 */
export function currentHunterDangerStats(): AreaDangerStats {
  const survival = loadoutSurvivalStats();
  const shieldCapacity = useLoadoutStore.getState().getShield()?.hp ?? 0;
  return {
    effectiveDps: loadoutEffectiveDps(),
    maxHp: survival.maxHp,
    shieldCapacity,
    mitigation: survival.mitigation ?? 0,
    dodgeChance: survival.dodgeChance ?? 0,
  };
}
