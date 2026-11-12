/**
 * ActionTickTimer — self-contained display clock for the active run.
 *
 * Subscribes to the shared clock via useElapsedSeconds so the parent
 * `ActionScreenContextual` screen does not re-render every second. Renders
 * either the "Xm Ys" string (when enabled) or "paused".
 *
 * The rendered width is locked to the longest expected string (`99m 59s`)
 * so the surrounding row does not shift on digit-count changes (e.g.
 * `0m 9s` → `0m 10s`).
 *
 * The server's activity start anchors elapsed time across tab switches.
 */
import React, { useMemo } from 'react';
import { useElapsedSeconds } from '@/hooks/useElapsedSeconds';

interface ActionTickTimerProps {
  /** Server activity start. Preserves elapsed time across pane hides/reloads. */
  startedAt?: string | null;
  /** When false the timer freezes and shows "paused". */
  enabled: boolean;
  /** "active" shows the full `Xm Ys` form; "compact" shows just `Xm Ys` for the status strip. */
  variant?: 'active' | 'compact';
  className?: string;
}

export const ActionTickTimer: React.FC<ActionTickTimerProps> = ({ startedAt, enabled, variant = 'active', className = '' }) => {
  const live = useElapsedSeconds(enabled, startedAt);
  const minutes = Math.floor(live / 60);
  const seconds = live % 60;
  const text = enabled ? `${minutes}m ${seconds}s` : 'paused';
  // Lock the rendered width so 0m 1s → 0m 10s does not jiggle the parent row.
  const fixedWidth = useMemo(() => ({ minWidth: variant === 'active' ? '5.25rem' : '4.25rem' }), [variant]);
  return (
    <span className={className} style={fixedWidth} data-testid="action-tick-timer">
      {text}
    </span>
  );
};
