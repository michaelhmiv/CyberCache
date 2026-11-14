import type { RoamingConsumableState } from '../../lib/consumables/roamingConsumableEngine';

/**
 * Roaming consumable state resolution (migration 0096).
 *
 * Coverage consumables (ammo family and kin) are charged when their
 * coverage window expires, so the engine's slot state must survive
 * between claims. It used to live only in the claim round-trip — the
 * client carried it in page memory — and every app restart reset
 * every open window for free: packs were never charged in real play
 * patterns while the coverage bonus applied throughout (staging
 * probe, 2026-11-13: 240 ticks claimed without a carried state
 * consumed 0 packs; the same span with a continuous state consumed
 * exactly 1, at the 200-tick boundary).
 *
 * The Chef now persists the state it returns on the profile
 * (profiles.roaming_consumable_state) and both engine callers — the
 * foreground claim route and offline settlement — resume from the
 * stored copy. The request body's blob is adopted exactly once, when
 * no stored state exists yet (the first claim after 0096 ships, so a
 * live client's in-flight windows survive the deploy); once a stored
 * state exists, the body never overrides it.
 *
 * Staleness: a claim's returned state ends with tickIndex = the last
 * tick it simulated, and that claim leaves the profile watermark at
 * tickIndex + 1. If the watermark has since moved further — ticks
 * were settled without this state (a settlement whose own state save
 * failed, another device) — the stored windows belong to a span that
 * was already settled and charged on its own terms. Resuming them
 * would charge the boundary window twice, so a state whose tickIndex
 * no longer meets the watermark is discarded and the engine activates
 * fresh from the watermark instead.
 */
export function resolveRoamingConsumableState(
  stored: unknown,
  bodyState: unknown,
  lastClaimedTick: number,
): RoamingConsumableState | undefined {
  if (stored !== null && stored !== undefined) {
    return isCurrentStoredState(stored, lastClaimedTick)
      ? (stored as RoamingConsumableState)
      : undefined;
  }
  return isStateShape(bodyState) ? (bodyState as RoamingConsumableState) : undefined;
}

function isStateShape(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { slots?: unknown; tickIndex?: unknown };
  return (
    Array.isArray(candidate.slots) &&
    typeof candidate.tickIndex === 'number' &&
    Number.isFinite(candidate.tickIndex)
  );
}

function isCurrentStoredState(stored: unknown, lastClaimedTick: number): boolean {
  if (!isStateShape(stored)) return false;
  const { tickIndex } = stored as { tickIndex: number };
  return tickIndex >= lastClaimedTick - 1;
}
