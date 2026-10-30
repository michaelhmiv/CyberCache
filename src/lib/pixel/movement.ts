import type { PixelSprite } from './manifest';
import { anchorPoint } from './manifest';
import type { TickEvent } from '@/store/slices/tickSlice';

/**
 * Pixel movement system (P2) — the single home for choreography timings
 * and the pure logic that turns game state/events into presentation beats.
 *
 * The timing law is "Sample B", approved by Michael from the proof renders
 * (pixel-production-spec.md §1/§4): ~1.15 s between boss phases, hit
 * reactions inside 350–500 ms, ghost HP draining ~480 ms behind the real
 * bar. Every duration a pixel scene or fight card animates with comes from
 * MOVEMENT below — feel is tunable in exactly one place.
 *
 * Presentation only: nothing here decides gameplay outcomes. Beats are
 * derived from results the Chef / boss sim already decided (tick events,
 * fight-timeline damage logs); this module only stages them.
 */

export const MOVEMENT = {
  // ── Sample B pacing law ──────────────────────────────────────────────
  /** Time between boss-fight phase beats (Sample B: ~1.15 s). */
  PHASE_INTERVAL_MS: 1150,
  /** Hit reaction window (Sample B: 350–500 ms). */
  HIT_REACTION_MS: 420,
  /** Ghost HP drains behind the real bar over ~480 ms (Sample B). */
  GHOST_HP_DRAIN_MS: 480,

  // ── Combat FX kit durations ──────────────────────────────────────────
  MUZZLE_FLASH_MS: 110,
  TRACER_MS: 150,
  SHELL_CASING_MS: 620,
  IMPACT_SPARKS_MS: 300,
  DUST_PUFF_MS: 480,
  DUST_RING_MS: 680,
  /** Small screen shake on a normal hit. */
  SHAKE_MS: 180,
  /** Bigger screen shake on a crit. */
  CRIT_SHAKE_MS: 320,
  /** Crit flash frame (spec window: 60–180 ms). */
  CRIT_FLASH_MS: 120,
  DAMAGE_NUMBER_MS: 820,
  KILL_SHAKE_MS: 300,

  // ── Enemy agency / exchanges ─────────────────────────────────────────
  /** Eye-glow telegraph before a boss/enemy lunge. */
  TELEGRAPH_MS: 340,
  LUNGE_MS: 340,
  DODGE_MS: 400,
  /** Within a phase: when the counter-attack telegraph starts. */
  BEAT_COUNTER_AT_MS: 460,
  /** Within a phase: when the lunge + dodge/hit land. */
  BEAT_LUNGE_AT_MS: 780,

  // ── Death ────────────────────────────────────────────────────────────
  DEATH_COLLAPSE_MS: 750,
  BANNER_IN_MS: 450,

  // ── Loot moment (P3, spec §5 — loot is THE reward beat) ─────────────
  /** Per-rarity beat length of one drop's celebration step (spec §5). */
  LOOT_COMMON_MS: 900,
  LOOT_UNCOMMON_MS: 1000,
  LOOT_RARE_MS: 1100,
  LOOT_EPIC_MS: 1400,
  LOOT_LEGENDARY_MS: 2600,
  /** Beam grow-in at the start of a step. */
  LOOT_BEAM_IN_MS: 420,
  /** Drop card spring-in. */
  LOOT_CARD_IN_MS: 380,
  /** Legendary weapon rise out of the beam. */
  LOOT_RISE_MS: 950,
  /** Legendary float bob period once the weapon has risen. */
  LOOT_FLOAT_MS: 2600,
  /** God-ray disc full rotation (slow, stately). */
  LOOT_RAYS_SPIN_MS: 16000,
  /** Shockwave ring expansion across the ground. */
  LOOT_SHOCKWAVE_MS: 900,
  /** Twinkle sparkle pulse around the floating weapon. */
  LOOT_TWINKLE_MS: 1200,
  /** Hunter celebration hop when the legendary finale lands. */
  LOOT_HOP_MS: 460,
  /** World dim under the legendary treatment (spec: ~40%). */
  LOOT_DIM_OPACITY: 0.4,
  /** After a skip, the completed stack lingers this long before done. */
  LOOT_SKIP_LINGER_MS: 650,

  // ── Idle life ────────────────────────────────────────────────────────
  /** Breathing loops live in 2.3–3.2 s, offset per actor (spec §4). */
  BREATHE_MIN_MS: 2300,
  BREATHE_MAX_MS: 3200,
  /** Background drift: scale 1.04 → 1.10 over ~11 s, then back. */
  BG_DRIFT_HALF_MS: 11000,
  EMBER_COUNT: 14,
  EMBER_RISE_MS: 5200,

  // ── Entrances ────────────────────────────────────────────────────────
  WALK_IN_MS: 850,
  DROP_IN_MS: 420,

  // ── Fight card ───────────────────────────────────────────────────────
  /** Settle pause after the last phase before the result card. */
  FIGHT_SETTLE_MS: 600,

  /**
   * A decided hit worth at least this fraction of the target's max HP is
   * *presented* as a crit (bigger shake, flash frame, oversized number).
   * Classification of presentation weight only — the damage value itself
   * comes from the sim/tick that already resolved.
   */
  CRIT_DAMAGE_FRACTION: 0.18,
} as const;

/** Realistic upper bound for CyberCache boss phase counts. */
export const FIGHT_MAX_PHASES = 8;

/** Total presentation budget for a fight of `phaseCount` phases. */
export const fightBudgetMs = (phaseCount: number): number =>
  phaseCount * MOVEMENT.PHASE_INTERVAL_MS + MOVEMENT.FIGHT_SETTLE_MS;

/** Hard cap asserted by tests so pacing can't silently regress. */
export const FIGHT_TOTAL_BUDGET_MS = fightBudgetMs(FIGHT_MAX_PHASES);

/** The diorama / fight stage design grid (matches the vector viewBox). */
export const STAGE_DESIGN_ASPECT = 420 / 286;

// ── Beats ────────────────────────────────────────────────────────────────

export type CombatBeatKind =
  | 'shot' // hunter shot lands on the enemy
  | 'crit' // shot, presented heavy (see CRIT_DAMAGE_FRACTION)
  | 'kill' // enemy dies
  | 'playerHit' // enemy attack lands on the hunter
  | 'loot' // a drop appears
  | 'death'; // a boss/hunter death sequence

export interface CombatBeat {
  kind: CombatBeatKind;
  /** Damage value the beat presents, when it carries one. */
  value?: number;
}

/** Hit events in the tick feed: tone 'loot', label is a negative number. */
export const isTickHit = (event?: TickEvent): boolean =>
  !!event && event.tone === 'loot' && event.label?.startsWith('-') && (event.value ?? 0) > 0;

/**
 * Classify the latest tick event into a presentation beat for a scene.
 * `targetMaxHp` is the current target's max HP (kill-cycle store) and is
 * only used to weigh crit presentation; pass 0 when unknown (no crits).
 * Pure and deterministic — the same event always yields the same beat.
 */
export function classifyTickBeat(event: TickEvent | undefined, targetMaxHp: number): CombatBeat | null {
  if (!event || event.id === 'idle-loop-ready') return null;
  if (event.tone === 'kill') return { kind: 'kill', value: event.value };
  if (isTickHit(event)) {
    const value = event.value ?? 0;
    const crit = targetMaxHp > 0 && value / targetMaxHp >= MOVEMENT.CRIT_DAMAGE_FRACTION;
    return { kind: crit ? 'crit' : 'shot', value };
  }
  if (event.tone === 'damage') return { kind: 'playerHit', value: event.value };
  if (event.tone === 'loot' || event.tone === 'cache' || event.tone === 'level') {
    return { kind: 'loot', value: event.value };
  }
  return null;
}

// ── Boss phase beats ─────────────────────────────────────────────────────

export interface PhaseBeat {
  kind: 'shot' | 'crit' | 'telegraph' | 'lunge' | 'dodge' | 'playerHit' | 'death';
  /** Delay from the phase start, ms (framer-motion transition delay). */
  atMs: number;
  value?: number;
}

export interface PhaseBeatInput {
  /** Damage the hunter dealt to the boss this phase (already decided). */
  bossDamage: number;
  /** Damage the boss dealt to the hunter this phase (already decided). */
  playerDamage: number;
  bossMaxHp: number;
  /** The boss dies as a result of this phase. */
  bossDies: boolean;
  /** The hunter dies as a result of this phase. */
  playerDies: boolean;
}

/**
 * Derive the ordered presentation beats for one boss-fight phase from the
 * damage the sim already assigned to it. Sample B shape: the hunter's shot
 * lands first (hit reaction window), then — if the boss lives and answers —
 * a telegraphed lunge that the hunter dodges (or takes, fatally on the
 * death phase). A killing blow ends the phase with the death beat and no
 * counter. Pure and deterministic; total span stays inside
 * PHASE_INTERVAL_MS.
 */
export function derivePhaseBeats(input: PhaseBeatInput): PhaseBeat[] {
  const beats: PhaseBeat[] = [];
  if (input.bossDamage > 0) {
    const crit = input.bossMaxHp > 0 && input.bossDamage / input.bossMaxHp >= MOVEMENT.CRIT_DAMAGE_FRACTION;
    beats.push({ kind: crit ? 'crit' : 'shot', atMs: 0, value: input.bossDamage });
  }
  if (input.bossDies) {
    beats.push({ kind: 'death', atMs: MOVEMENT.HIT_REACTION_MS, value: input.bossDamage });
    return beats;
  }
  if (input.playerDamage > 0) {
    beats.push({ kind: 'telegraph', atMs: MOVEMENT.BEAT_COUNTER_AT_MS });
    beats.push({ kind: 'lunge', atMs: MOVEMENT.BEAT_LUNGE_AT_MS, value: input.playerDamage });
    beats.push({
      kind: input.playerDies ? 'playerHit' : 'dodge',
      atMs: MOVEMENT.BEAT_LUNGE_AT_MS,
      value: input.playerDamage,
    });
  }
  return beats;
}

// ── Anchor math ──────────────────────────────────────────────────────────

export interface ActorPlacement {
  /** Stage position of the actor's feet anchor, % of stage width. */
  xPct: number;
  /** Actor height, % of stage height. */
  heightPct: number;
  /** Ground line, fraction of stage height (0..1). */
  groundY: number;
}

/**
 * Stage-relative position (in %) of one of an actor's manifest anchors,
 * given how PixelActor placed it. Mirrors PixelActor's placement math
 * exactly: the feet anchor lands on (xPct, groundY); the box extends up
 * by heightPct; width follows the sprite aspect through the stage aspect.
 */
export function actorAnchorPoint(
  sprite: PixelSprite,
  anchorName: string,
  placement: ActorPlacement,
  stageAspect: number = STAGE_DESIGN_ASPECT,
): { xPct: number; yPct: number } {
  const feet = anchorPoint(sprite, 'feet', 100, 100);
  const anchor = anchorPoint(sprite, anchorName, 100, 100);
  const widthPct = (placement.heightPct * (sprite.width / sprite.height)) / stageAspect;
  return {
    xPct: placement.xPct + ((anchor.x - feet.x) / 100) * widthPct,
    yPct: placement.groundY * 100 - placement.heightPct + (anchor.y / 100) * placement.heightPct,
  };
}

/** Geometry for a tracer streak between two stage-% points. */
export function tracerGeometry(
  from: { xPct: number; yPct: number },
  to: { xPct: number; yPct: number },
  stageAspect: number = STAGE_DESIGN_ASPECT,
): { leftPct: number; topPct: number; widthPct: number; angleDeg: number } {
  const dx = to.xPct - from.xPct;
  const dyPx = ((to.yPct - from.yPct) / 100) * (100 / stageAspect); // y-% → width-% units
  const widthPct = Math.sqrt(dx * dx + dyPx * dyPx);
  const angleDeg = (Math.atan2(dyPx, dx) * 180) / Math.PI;
  return { leftPct: from.xPct, topPct: from.yPct, widthPct, angleDeg };
}

// ── Deterministic fields (particles / shake) ─────────────────────────────

/** FNV-1a string hash → uint32. Stable across runs and platforms. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG step — deterministic stream from a numeric seed. */
const nextRandom = (state: { h: number }): number => {
  state.h = (state.h + 0x6d2b79f5) | 0;
  let t = Math.imul(state.h ^ (state.h >>> 15), 1 | state.h);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export interface ParticleSpec {
  /** Left position, % of the field. */
  xPct: number;
  /** Particle size, px. */
  size: number;
  /** Animation delay, ms (staggers a looping field). */
  delayMs: number;
  /** Rise/sway duration, ms. */
  durationMs: number;
  /** Horizontal sway, px. */
  swayPx: number;
  /** Peak opacity 0..1. */
  opacity: number;
}

/**
 * A deterministic particle field (embers, sparks) from a string seed:
 * the same seed always produces the same field, so re-renders never
 * reshuffle the sky and tests can assert exact output.
 */
export function particleField(seed: string, count: number): ParticleSpec[] {
  const state = { h: hashSeed(seed) };
  return Array.from({ length: count }, () => {
    const xPct = nextRandom(state) * 100;
    const size = 2 + Math.floor(nextRandom(state) * 3);
    const delayMs = Math.floor(nextRandom(state) * MOVEMENT.EMBER_RISE_MS);
    const durationMs = Math.floor(MOVEMENT.EMBER_RISE_MS * (0.7 + nextRandom(state) * 0.6));
    const swayPx = Math.round((nextRandom(state) - 0.5) * 18);
    const opacity = 0.35 + nextRandom(state) * 0.5;
    return { xPct, size, delayMs, durationMs, swayPx, opacity };
  });
}

/**
 * Deterministic screen-shake keyframes for a beat. `intensity` is the
 * peak offset in px (small for hits, larger for crits/kills). The path
 * always starts and ends at rest so the stage settles.
 */
export function shakeKeyframes(
  seed: string,
  intensity: number,
): { x: number[]; y: number[] } {
  const state = { h: hashSeed(seed) };
  const steps = 5;
  const x: number[] = [0];
  const y: number[] = [0];
  for (let i = 0; i < steps; i++) {
    const falloff = 1 - i / steps;
    x.push(Math.round((nextRandom(state) * 2 - 1) * intensity * falloff));
    y.push(Math.round((nextRandom(state) * 2 - 1) * intensity * falloff * 0.7));
  }
  x.push(0);
  y.push(0);
  return { x, y };
}
