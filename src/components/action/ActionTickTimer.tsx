/**
 * ActionTickTimer — self-contained display clock for the active run.
 *
 * Owns its own 1-second interval via useElapsedSeconds so the parent
 * `ActionScreenContextual` screen does not re-render every second. Renders
 * either the "Xm Ys" string (when enabled) or "paused".
 *
 * The rendered width is locked to the longest expected string (`99m 59s`)
 * so the surrounding row does not shift on digit-count changes (e.g.
 * `0m 9s` → `0m 10s`).
 *
 * Remount the component (via a `key` prop on the parent) to reset the
 * elapsed counter — e.g. when the active run changes or the player
 * stops/starts an action.
 */
import React, { useMemo } from 'react';
import { useElapsedSeconds } from '@/hooks/useElapsedSeconds';

interface ActionTickTimerProps {
  /** Seconds per tick (e.g. 3 for a 3-second idle loop). */
  tickSeconds: number;
  /** When false the timer freezes and shows "paused". */
  enabled: boolean;
  /** "active" shows the full `Xm Ys` form; "compact" shows just `Xm Ys` for the status strip. */
  variant?: 'active' | 'compact';
  className?: string;
}

export const ActionTickTimer: React.FC<ActionTickTimerProps> = ({ tickSeconds, enabled, variant = 'active', className = '' }) => {
  const live = useElapsedSeconds(enabled);
  const minutes = Math.floor((live * tickSeconds) / 60);
  const seconds = (live * tickSeconds) % 60;
  const text = enabled ? `${minutes}m ${seconds}s` : 'paused';
  // Lock the rendered width so 0m 1s → 0m 10s does not jiggle the parent row.
  const fixedWidth = useMemo(() => ({ minWidth: variant === 'active' ? '5.25rem' : '4.25rem' }), [variant]);
  return (
    <span className={className} style={fixedWidth} data-testid="action-tick-timer">
      {text}
    </span>
  );
};
