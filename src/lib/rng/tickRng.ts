/**
 * tickRng — deterministic PRNG seeded from tick identity.
 *
 * Phase 2a: replaces bare Math.random() in the ticker and all item
 * generators with a single Mulberry32 stream keyed on the tuple
 * (playerId, areaId, tickCount). The same seed produces identical
 * output on the client (TypeScript) and server (PL/pgSQL migration
 * 202606100003).
 *
 * Import hashString and createRNG from the existing rng utilities.
 * createRNG already wraps Mulberry32 — we just need to seed it from
 * the tick tuple instead of Date.now() + Math.random().
 */
import { createRNG, hashString } from '@/lib/utils/rng';

/**
 * Create a deterministic PRNG for a specific tick.
 *
 * The seed is `hashString("{playerId}:{areaId}:{tickCount}")`.
 * Every consumer that calls createTickRng with the same tuple
 * gets the same stream of pseudo-random numbers.
 */
export function createTickRng(
  playerId: string,
  areaId: string,
  tickCount: number,
): () => number {
  const seed = hashString(`${playerId}:${areaId}:${tickCount}`);
  return createRNG(seed);
}
