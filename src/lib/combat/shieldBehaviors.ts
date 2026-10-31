/**
 * shieldBehaviors — the ONE source of truth for shield behavior
 * archetypes (Phase 2c). Borderlands-style behaviors rolled onto
 * shields at generation and read identically by every engine:
 *
 *   - Roaming survival (Chef claim): resolved per-hit inside
 *     `computeMonsterDamageVsHunter` (damageContract.ts), which
 *     delegates the shield split for behavior shields to this module's
 *     constants; the Chef applies Nova bursts to the kill-cycle target
 *     and Amp to outgoing DPS through `ampDamageMultiplier`.
 *   - Boss fights: `simulateBoss` (bossSimulator.ts) is a pooled,
 *     deterministic 30-second score model with no per-hit timeline, so
 *     it folds behaviors in through `modelShieldBehaviorForBoss` —
 *     same constants, expressed in the sim's pool terms.
 *
 * Legacy shields (generated before behaviors existed) carry no
 * `behavior` field in their payload. `shieldBehaviorOf` reads them as
 * Standard — no behavior, no extra RNG draws, outcomes bit-identical
 * to the pre-behavior engines. Player items are never rewritten.
 *
 * Recharge reality check: the shipped game has NO shield recharge
 * mechanic in either authoritative sim. In roaming, shield HP only
 * rises via Shield Cell consumable restores (roamingConsumableEngine);
 * in boss fights the "refill" is the Shield Cell / Nano Swarm pool.
 * `rechargeRate` is a generated, displayed stat that no engine
 * consumes. Turtle therefore halves the generated `rechargeRate` stat
 * (the tradeoff is real wherever the stat is read) and its capacity
 * edge stands alone in the current sims — documented here rather than
 * inventing a recharge mechanic inside a behavior slice.
 */
import { Rarity } from '../../types/game';

export type ShieldBehaviorId = 'standard' | 'nova' | 'absorb' | 'amp' | 'turtle';

export const SHIELD_BEHAVIOR_IDS: readonly ShieldBehaviorId[] = [
  'standard',
  'nova',
  'absorb',
  'amp',
  'turtle',
] as const;

/**
 * Balance knobs for every behavior. Plain data constants in one place
 * (NOT economy levers — behaviors are combat balance, tuned in code).
 */
export const SHIELD_BEHAVIOR_TUNING = {
  /** Nova burst damage as a fraction of shield capacity. */
  novaPctOfCapacity: 1.5,
  /** Absorb: per-hit chance to fully negate a hit while the shield is up. */
  absorbChance: 0.15,
  /** Absorb: shield HP restored per proc, as a fraction of capacity. */
  absorbRestore: 0.05,
  /** Amp: outgoing damage bonus while shield HP is at full capacity. */
  ampPct: 0.25,
  /** Turtle: capacity multiplier applied to generated shield HP. */
  turtleCapacityMult: 1.5,
  /** Turtle: recharge-rate multiplier applied to the generated stat. */
  turtleRechargeMult: 0.5,
  /**
   * Nova re-arm threshold: after a burst fires, the shield must be
   * restored to at least this fraction of capacity before it can
   * burst again.
   */
  novaRearmThreshold: 0.5,
} as const;

export interface ShieldBehaviorDef {
  id: ShieldBehaviorId;
  /** Display name (cards, inspect, feed). */
  name: string;
  /** One-line plain-language effect, without numbers. */
  blurb: string;
}

export const SHIELD_BEHAVIORS: Record<ShieldBehaviorId, ShieldBehaviorDef> = {
  standard: {
    id: 'standard',
    name: 'Standard',
    blurb: 'No special behavior.',
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    blurb: 'When this shield breaks, it erupts in a burst of damage.',
  },
  absorb: {
    id: 'absorb',
    name: 'Absorb',
    blurb: 'Chance to fully absorb a hit and restore shield.',
  },
  amp: {
    id: 'amp',
    name: 'Amp',
    blurb: 'Bonus damage while the shield is at full charge.',
  },
  turtle: {
    id: 'turtle',
    name: 'Turtle',
    blurb: 'Oversized capacity, slow recharge.',
  },
};

/**
 * Rarity → behavior roll weights (relative). Common shields are
 * mostly Standard; Legendary shields always roll a real behavior.
 * Non-Standard weight is split evenly across the four behaviors.
 */
export const SHIELD_BEHAVIOR_WEIGHTS: Record<Rarity, Record<ShieldBehaviorId, number>> = {
  [Rarity.Common]: { standard: 90, nova: 2.5, absorb: 2.5, amp: 2.5, turtle: 2.5 },
  [Rarity.Uncommon]: { standard: 75, nova: 6.25, absorb: 6.25, amp: 6.25, turtle: 6.25 },
  [Rarity.Rare]: { standard: 55, nova: 11.25, absorb: 11.25, amp: 11.25, turtle: 11.25 },
  [Rarity.Epic]: { standard: 32, nova: 17, absorb: 17, amp: 17, turtle: 17 },
  [Rarity.Legendary]: { standard: 0, nova: 25, absorb: 25, amp: 25, turtle: 25 },
};

/**
 * The behavior a shield payload carries. Missing or unrecognized
 * values (every legacy shield) read as Standard.
 */
export function shieldBehaviorOf(
  item: { behavior?: unknown } | null | undefined,
): ShieldBehaviorId {
  const raw = item?.behavior;
  return typeof raw === 'string' && (SHIELD_BEHAVIOR_IDS as readonly string[]).includes(raw)
    ? (raw as ShieldBehaviorId)
    : 'standard';
}

/** Weighted pick from a pre-rolled 0..1 value — the one pick logic. */
export function pickShieldBehavior(rarity: Rarity, roll01: number): ShieldBehaviorId {
  const weights = SHIELD_BEHAVIOR_WEIGHTS[rarity];
  const total = SHIELD_BEHAVIOR_IDS.reduce((sum, id) => sum + weights[id], 0);
  let roll = (((roll01 % 1) + 1) % 1) * total;
  for (const id of SHIELD_BEHAVIOR_IDS) {
    roll -= weights[id];
    if (roll < 0) return id;
  }
  return 'standard';
}

/** Roll a behavior for a freshly generated shield of the given rarity. */
export function rollShieldBehavior(rarity: Rarity, rng: () => number): ShieldBehaviorId {
  return pickShieldBehavior(rarity, rng());
}

/**
 * Generation-time stat transform for a rolled behavior. Turtle is the
 * only behavior that changes base stats: capacity ×1.5, recharge rate
 * ×0.5 (see the recharge note in the module header). Every other
 * behavior leaves the generated stats untouched.
 */
export function applyShieldBehaviorGenerationStats(
  behavior: ShieldBehaviorId,
  stats: { hp: number; rechargeRate: number },
): { hp: number; rechargeRate: number } {
  if (behavior !== 'turtle') return { hp: stats.hp, rechargeRate: stats.rechargeRate };
  return {
    hp: Math.round(stats.hp * SHIELD_BEHAVIOR_TUNING.turtleCapacityMult),
    rechargeRate: parseFloat(
      (stats.rechargeRate * SHIELD_BEHAVIOR_TUNING.turtleRechargeMult).toFixed(1),
    ),
  };
}

/**
 * Inverse of applyShieldBehaviorGenerationStats, for reforge
 * (migration 0027): a baked shield's stored stats carry the Turtle
 * transform, so swapping an affix must un-transform, swap in the
 * untransformed space, and re-apply. HP inverts exactly (the ×1.5
 * rounding error is < 0.5 pre-image). Recharge rate inverts onto the
 * generator's own 0.1 grid — the ×0.5 rounding can leave the true
 * pre-image ambiguous by one 0.1 step in rare half-step cases;
 * rechargeRate is consumed by no engine (see the module header), and
 * the affix's own contribution is applied and removed exactly
 * relative to the recovered base either way.
 */
export function invertShieldBehaviorGenerationStats(
  behavior: ShieldBehaviorId,
  stats: { hp: number; rechargeRate: number },
): { hp: number; rechargeRate: number } {
  if (behavior !== 'turtle') return { hp: stats.hp, rechargeRate: stats.rechargeRate };
  return {
    hp: Math.round(stats.hp / SHIELD_BEHAVIOR_TUNING.turtleCapacityMult),
    rechargeRate: parseFloat(
      (stats.rechargeRate / SHIELD_BEHAVIOR_TUNING.turtleRechargeMult).toFixed(1),
    ),
  };
}

/** Nova burst damage for a shield of the given capacity. */
export function novaDamageForCapacity(capacity: number): number {
  return Math.max(0, Math.round(capacity * SHIELD_BEHAVIOR_TUNING.novaPctOfCapacity));
}

/** Shield HP an Absorb proc restores (never past capacity). */
export function absorbRestoreFor(capacity: number, currentShieldHp: number): number {
  if (capacity <= 0) return 0;
  const restore = Math.round(capacity * SHIELD_BEHAVIOR_TUNING.absorbRestore);
  return Math.max(0, Math.min(restore, capacity - currentShieldHp));
}

/**
 * Outgoing damage multiplier from the Amp behavior: the bonus applies
 * only while shield HP is at full capacity. Used by the roaming claim
 * (per tick, at the moment the hunter deals damage).
 */
export function ampDamageMultiplier(
  behavior: ShieldBehaviorId,
  shieldHp: number,
  capacity: number,
): number {
  if (behavior !== 'amp' || capacity <= 0) return 1;
  return shieldHp >= capacity ? 1 + SHIELD_BEHAVIOR_TUNING.ampPct : 1;
}

/**
 * Plain-language effect line with the real numbers for THIS shield —
 * what the inspect sheet shows (Michael's no-invisible-mechanics law:
 * every factor that plays into combat is visible on the item).
 */
export function describeShieldBehavior(
  behavior: ShieldBehaviorId,
  shield: { hp: number; rechargeRate: number },
): string {
  const t = SHIELD_BEHAVIOR_TUNING;
  switch (behavior) {
    case 'nova':
      return `When this shield breaks, it erupts for ${novaDamageForCapacity(shield.hp)} damage (${Math.round(t.novaPctOfCapacity * 100)}% of capacity). Re-arms once the shield is restored above ${Math.round(t.novaRearmThreshold * 100)}%.`;
    case 'absorb':
      return `Each hit taken while the shield is up has a ${Math.round(t.absorbChance * 100)}% chance to be fully absorbed, restoring ${Math.round(t.absorbRestore * 100)}% of capacity.`;
    case 'amp':
      return `While the shield is at full charge, your damage is increased by ${Math.round(t.ampPct * 100)}%.`;
    case 'turtle':
      return `Capacity is increased by ${Math.round((t.turtleCapacityMult - 1) * 100)}%, but recharge rate is halved.`;
    case 'standard':
    default:
      return 'No special behavior.';
  }
}

// ---------------------------------------------------------------------------
// Boss-sim model (pooled, deterministic — see bossSimulator.ts)
// ---------------------------------------------------------------------------

export interface BossShieldBehaviorModel {
  /** Flat damage dealt to the boss by Nova bursts over the fight. */
  novaDamage: number;
  /** How many times Nova fires over the fight (0, 1, or 2). */
  novaFirings: number;
  /**
   * Incoming damage negated by Absorb over the fight, in
   * POST-mitigation units (the units shield HP absorbs). The boss sim
   * converts when it folds this into its survival pool.
   */
  absorbNegated: number;
  /** Multiplier on the hunter's DPS from Amp (fight-averaged). */
  ampDpsMultiplier: number;
  /** Fraction of the fight the shield pool stays unbroken (0-1). */
  shieldUptimeFraction: number;
}

/**
 * Fold a shield behavior into the boss sim's pooled terms. The sim
 * models a fixed 30-second fight: the boss deals `totalIncomingDamage`
 * (pre-mitigation), the hunter's shield pool is `capacity` plus a
 * consumable `refillPool` (Shield Cells + Nano Swarms — the only
 * shield restoration that exists in a boss fight).
 *
 * Modeling choices (expected-value, like everything else in the sim):
 *   - Nova fires when cumulative post-mitigation damage depletes the
 *     capacity pool; it fires a second time only if the refill pool is
 *     at least the re-arm threshold of capacity AND the damage also
 *     depletes the refill — mirroring the roaming re-arm rule.
 *   - Absorb negates `absorbChance` of the damage that would land on
 *     the shield pools. Its per-proc shield restore is a per-hit
 *     effect and is not modeled here (conservative).
 *   - Amp's "at full" rule has no per-hit timeline in a pooled sim;
 *     uptime is the fraction of the fight the shield pool remains
 *     unbroken, and the DPS multiplier is the fight average.
 */
export function modelShieldBehaviorForBoss(args: {
  behavior: ShieldBehaviorId;
  capacity: number;
  refillPool: number;
  totalIncomingDamage: number;
  mitigation: number;
}): BossShieldBehaviorModel {
  const none: BossShieldBehaviorModel = {
    novaDamage: 0,
    novaFirings: 0,
    absorbNegated: 0,
    ampDpsMultiplier: 1,
    shieldUptimeFraction: 0,
  };
  const { behavior, capacity, refillPool, totalIncomingDamage } = args;
  if (behavior === 'standard' || capacity <= 0) return none;

  const mitigation = Math.min(0.8, Math.max(0, args.mitigation));
  const postMitDamage = Math.max(0, totalIncomingDamage) * (1 - mitigation);
  const pools = capacity + Math.max(0, refillPool);
  const uptime =
    postMitDamage <= 0 ? 1 : Math.min(1, Math.max(0, pools / postMitDamage));

  let novaFirings = 0;
  if (behavior === 'nova') {
    if (postMitDamage >= capacity) novaFirings = 1;
    if (
      novaFirings === 1 &&
      refillPool >= SHIELD_BEHAVIOR_TUNING.novaRearmThreshold * capacity &&
      postMitDamage >= pools
    ) {
      novaFirings = 2;
    }
  }

  return {
    novaDamage: novaFirings * novaDamageForCapacity(capacity),
    novaFirings,
    absorbNegated:
      behavior === 'absorb'
        ? SHIELD_BEHAVIOR_TUNING.absorbChance * Math.min(postMitDamage, pools)
        : 0,
    ampDpsMultiplier:
      behavior === 'amp' ? 1 + SHIELD_BEHAVIOR_TUNING.ampPct * uptime : 1,
    shieldUptimeFraction: uptime,
  };
}
