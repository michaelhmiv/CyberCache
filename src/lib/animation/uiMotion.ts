/**
 * UI motion — the DESIGN.md §10 mandate under Sample B.
 *
 * This module owns ONLY chrome motion: stop transitions, list
 * entrances, the small fades that make the four tabs feel alive
 * between loot moments. It must never carry a scene, fight, or
 * loot timing — those are Sample B, owned exclusively by
 * `src/lib/pixel/movement.ts`, and they outrank everything here.
 *
 * The values below mirror the two patterns the shipped waves
 * already established — the Gear stop transition
 * (InventoryScreen: fade + 6px rise, 180ms, exit −4px) and the
 * feed/list spring entrances (ActionFeed, WeeklyClaimables) — so
 * new surfaces stop hand-rolling near-copies of them.
 *
 * Reduced motion (owner's rule): UI motion collapses — entrances
 * render at their final state and pulses hold a static ring.
 * Sample-B beats are never retimed by this; they read their own
 * reduced-motion handling in the fight/loot components.
 */

/** Stop-content entrance (Gear's InventoryScreen pattern). */
export function stopTransitionProps(reduceMotion: boolean | null) {
  return {
    initial: reduceMotion ? (false as const) : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: reduceMotion ? undefined : { opacity: 0, y: -4 },
    transition: { duration: reduceMotion ? 0 : 0.18 },
  };
}

/**
 * List-item entrance: fade + small rise, staggered by index with
 * the delay capped so a long list never trails in. Under reduced
 * motion the item renders at rest (no initial state to animate
 * from).
 */
export function listEntranceProps(index: number, reduceMotion: boolean | null) {
  if (reduceMotion) return {};
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: Math.min(index * 0.04, 0.24), duration: 0.18 },
  };
}

/** Panel entrance for conditionally-mounted claim surfaces. */
export function panelEntranceProps(reduceMotion: boolean | null) {
  if (reduceMotion) return { initial: false as const };
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { type: 'spring' as const, damping: 24, stiffness: 260 },
  };
}
