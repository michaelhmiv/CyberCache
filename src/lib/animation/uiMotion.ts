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

/**
 * Celebration-card entrance — the de-facto tier the loot-adjacent
 * cards already share (OfflineRecap's three variants and the
 * Starter Bundle Reveal both ride spring 200/24 from y:16-40).
 * Named here so the tier has one home and one reduced-motion
 * collapse (render at rest) instead of per-file copies that drift
 * on the RM gate.
 */
export function celebrationEntranceProps(reduceMotion: boolean | null) {
  if (reduceMotion) {
    return {
      initial: false as const,
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0 },
    };
  }
  return {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    transition: { type: 'spring' as const, damping: 24, stiffness: 200 },
  };
}

/**
 * XP / progress bar chase — the width spring the ResourceBar and
 * the level sheet each hand-copied as `{ spring, damping: 20 }`
 * (framer's unnamed default stiffness 100). One shared spec:
 * the stiffness is now named, the value is unchanged, and
 * reduced motion snaps the bar to its value.
 */
export function xpBarTransition(reduceMotion: boolean | null) {
  if (reduceMotion) return { duration: 0 } as const;
  return { type: 'spring' as const, stiffness: 100, damping: 20 };
}

/**
 * Bottom-sheet motion — the shipped sheet family's values (spring
 * 320/28, named in seven sheets) as one shared pair so every sheet
 * enters, exits, and collapses the same way. The backdrop rides
 * the Enter tier (0.18s easeOut fade); the panel rides the spring.
 *
 * Reduced motion: the panel renders at rest and both layers
 * degrade to a plain fade — the CollectionsPanel SpecSheet
 * pattern, promoted to the shared helper.
 */
export function sheetMotionProps(reduceMotion: boolean | null) {
  if (reduceMotion) {
    return {
      backdrop: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0 },
      },
      panel: {
        initial: false as const,
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0 },
        transition: { duration: 0 },
      },
    };
  }
  return {
    backdrop: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.18, ease: 'easeOut' as const },
    },
    panel: {
      initial: { y: '100%' },
      animate: { y: 0 },
      exit: { y: '100%' },
      transition: { type: 'spring' as const, damping: 28, stiffness: 320 },
    },
  };
}
