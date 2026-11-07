/**
 * Extraction pass appearance — the rise planner (Motion M4a).
 *
 * A settled extraction pass arrives itemized by the Chef (per
 * material / essence type, with counts) and the stage presents
 * it as material rises off the sift rig — the grammar the game
 * already speaks for finds (the roaming loot rise, the bench's
 * completion rise), NOT LootMoment: that ceremony is
 * gear/rarity-typed and cannot consume material counts, and a
 * per-draw replay is impossible (the server folds ~32 draws into
 * per-type counts and discards the order). Per-type appearance
 * is the honest maximum, priced from the existing rise timing —
 * the loot ladder (gear ceremony pricing) appears nowhere here.
 *
 * Pure functions of the settled pass: no clocks, no DOM, no
 * store. The diorama sequences the beats; this module only
 * decides what one pass's beat shows and how long it holds.
 */
import { MOVEMENT } from './movement';
import type { ChefExtractionPass } from '@/lib/chef/chefClient';

/** One find rising: a material or essence id and the exact count
 *  the pass settled — the same figures the panel's card prints,
 *  from the same payload (the two can never disagree). */
export interface ExtractionRise {
  id: string;
  kind: 'material' | 'essence';
  qty: number;
}

/** The stage celebrates a pass's largest finds — a pass folds
 *  ~32 draws into a handful of types, and six rises fan across
 *  the rig readably. The panel's "Just landed" card remains the
 *  complete written record of every type. */
export const EXTRACTION_MAX_RISES = 6;

/** Stagger between one pass's rises, ms — presentation spacing
 *  inside the beat, on the rise's own duration. */
export const EXTRACTION_RISE_STAGGER_MS = 120;

/** A pass's finds as rises: materials and essences merged,
 *  zero-count entries dropped (a type the pass named but did not
 *  yield is not a find), ordered largest first — count ties break
 *  by id so the fan is deterministic — and capped at
 *  EXTRACTION_MAX_RISES. Signature units need no separate rise:
 *  they are units of the signature material already counted in
 *  the pass's materials (the substitution happens inside the
 *  draw), so they rise with that material's count. */
export function extractionRisesForPass(pass: ChefExtractionPass): ExtractionRise[] {
  const rises: ExtractionRise[] = [
    ...Object.entries(pass.materials).map(([id, qty]) => ({ id, kind: 'material' as const, qty })),
    ...Object.entries(pass.essences).map(([id, qty]) => ({ id, kind: 'essence' as const, qty })),
  ];
  return rises
    .filter((r) => r.qty > 0)
    .sort((a, b) => b.qty - a.qty || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, EXTRACTION_MAX_RISES);
}

/** How long one pass's beat holds the stage: the last rise's
 *  full LOOT_RISE_MS after its stagger delay. A pass with no
 *  finds earns no beat at all (duration 0 — the stage does not
 *  celebrate an empty pass; the panel prints "nothing this
 *  pass"). */
export function extractionBeatDurationMs(riseCount: number): number {
  if (riseCount <= 0) return 0;
  return MOVEMENT.LOOT_RISE_MS + (riseCount - 1) * EXTRACTION_RISE_STAGGER_MS;
}
