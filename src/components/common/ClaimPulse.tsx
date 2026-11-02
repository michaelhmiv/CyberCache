import React from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';

/**
 * ClaimPulse — the claimable-affordance pulse (DESIGN.md §10:
 * "claimable badges draw the eye; a static claimable is a missed
 * hook"). A pulsing glow ring rendered as an overlay inside a
 * `relative` parent (a pill, a badge, a claim button).
 *
 * Modeled exactly on DashboardTopBar's PulseGlow, the pattern the
 * Home claim chips shipped with: a 1.5s easeInOut opacity pulse
 * over an inset ring + soft outer glow. Decorative only — the
 * parent's label, badge text, and aria-label carry the signal for
 * anyone who cannot see motion.
 *
 * Reduced motion collapses the pulse to the static ring (never
 * removed outright — the affordance stays visibly marked), the
 * same collapse PulseGlow performs. The config-aware hook is
 * used so a MotionConfig can force the collapse in tests the
 * same way the OS preference does in production.
 */
export const ClaimPulse: React.FC<{ color: string; testId?: string }> = ({ color, testId }) => {
  const reduceMotion = useReducedMotionConfig();
  if (reduceMotion) {
    return (
      <span
        data-testid={testId}
        data-static="true"
        aria-hidden
        className="claim-pulse pointer-events-none absolute inset-0"
        style={{ boxShadow: `inset 0 0 0 2px ${color}, 0 0 10px ${color}66` }}
      />
    );
  }
  return (
    <motion.span
      data-testid={testId}
      aria-hidden
      className="claim-pulse pointer-events-none absolute inset-0"
      style={{ boxShadow: `inset 0 0 0 2px ${color}, 0 0 12px ${color}88` }}
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
};
