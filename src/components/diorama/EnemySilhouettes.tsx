/**
 * EnemySilhouettes — per-archetype SVG path sets for the diorama's EnemySvg.
 *
 * Five archetypes produce visually distinct enemy shapes. Each exports:
 *   - bodyOuter: dark outline path
 *   - bodyInner: colored fill path
 *   - eyes: array of [cx, cy, r] circle specs
 *   - baseScale: relative size multiplier
 *   - limbLeft/limbRight: optional limb paths (for armed archetypes)
 */

export type EnemyArchetype = 'fodder' | 'runner' | 'brute' | 'sniper' | 'elite';

export interface ArchetypeSilhouette {
  bodyOuter: string;
  bodyInner: string;
  eyes: Array<{ cx: number; cy: number; r: number }>;
  baseScale: number;
  limbLeft?: string;
  limbRight?: string;
  armorPlates?: string[];       // extra armored detail paths
}

// ── Fodder (drone) — small floating diamond, tiny limbs, single eye ──────────

const FODDER: ArchetypeSilhouette = {
  bodyOuter: 'M298 90L318 78L338 90L338 110L318 122L298 110Z',
  bodyInner: 'M304 92L318 83L332 92L332 107L318 116L304 107Z',
  eyes: [{ cx: 318, cy: 98, r: 3 }],
  baseScale: 0.6,
  limbLeft: 'M306 107L294 114L298 110L294 107',
  limbRight: 'M330 107L342 112L338 107L342 103',
};

// ── Runner (scavenger) — asymmetric hex body, 2 legs, 1 arm, single eye ──────

const RUNNER: ArchetypeSilhouette = {
  bodyOuter: 'M303 80L332 76L350 98L340 132L308 136L287 108Z',
  bodyInner: 'M308 86L329 83L343 99L335 125L311 128L293 108Z',
  eyes: [{ cx: 322, cy: 98, r: 6 }],
  baseScale: 1.0,
  limbLeft: 'M298 108L288 125M288 123L282 122',
  limbRight: 'M337 105L350 118',
  armorPlates: [
    'M306 92L324 88L334 98L316 102Z',  // shoulder
  ],
};

// ── Brute (raider) — wide rectangular body, thick arms, 2 eyes, chest plates ─

const BRUTE: ArchetypeSilhouette = {
  bodyOuter: 'M288 70L338 64L360 94L352 138L302 142L278 108Z',
  bodyInner: 'M296 78L333 73L352 96L345 131L305 134L286 107Z',
  eyes: [{ cx: 310, cy: 92, r: 7 }, { cx: 332, cy: 92, r: 6 }],
  baseScale: 1.2,
  limbLeft: 'M294 100L274 112L270 118',
  limbRight: 'M354 95L370 100L374 108',
  armorPlates: [
    'M296 100L340 96L336 116L300 118Z',       // chest plate
    'M300 118L304 128L328 126L320 118Z',        // lower chest
  ],
};

// ── Sniper (scout) — tall thin body, long barrel arm, scope eye ──────────────

const SNIPER: ArchetypeSilhouette = {
  bodyOuter: 'M304 68L330 64L342 84L338 128L312 134L296 106Z',
  bodyInner: 'M310 74L328 71L337 85L334 122L314 127L302 106Z',
  eyes: [{ cx: 322, cy: 88, r: 4 }],
  baseScale: 1.0,
  limbLeft: 'M308 98L288 94L278 90',            // sniper barrel (long)
  limbRight: 'M336 92L350 100L354 108',           // support arm
  armorPlates: [
    'M308 78L332 75L330 82L310 84Z',             // scope mount
  ],
};

// ── Elite (boss) — multi-part armored, crown/aura, 3 eyes, shoulder plates ───

const ELITE: ArchetypeSilhouette = {
  bodyOuter: 'M284 60L336 52L368 86L360 144L300 150L274 114Z',
  bodyInner: 'M294 72L332 66L358 90L352 136L304 141L284 112Z',
  eyes: [{ cx: 308, cy: 90, r: 8 }, { cx: 326, cy: 88, r: 9 }, { cx: 344, cy: 90, r: 7 }],
  baseScale: 1.5,
  limbLeft: 'M294 104L268 112L258 124',
  limbRight: 'M360 100L382 108L392 120',
  armorPlates: [
    'M286 72L344 64L336 100L294 104Z',            // crown / upper plate
    'M300 110L350 106L344 128L304 130Z',           // chest plate
    'M294 78L300 70L306 78Z',                       // left shoulder spike
    'M344 72L350 64L356 72Z',                       // right shoulder spike
  ],
};

// ── Registry ─────────────────────────────────────────────────────────────────

export const ARCHETYPE_SILHOUETTES: Record<EnemyArchetype, ArchetypeSilhouette> = {
  fodder: FODDER,
  runner: RUNNER,
  brute: BRUTE,
  sniper: SNIPER,
  elite: ELITE,
};
