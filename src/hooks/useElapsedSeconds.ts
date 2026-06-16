/**
 * useElapsedSeconds — local 1-second interval that increments an internal
 * counter starting at 0, ticking only while `enabled` is true.
 *
 * Lives in its own component state so a per-second increment does not force
 * any sibling / parent component to re-render.
 *
 * To reset, the parent should remount this hook (or the consuming component)
 * via React's `key` prop — e.g. `<ActionTickTimer key={`run-${runId}`} ... />`.
 */
import { useEffect, useState } from 'react';

export function useElapsedSeconds(enabled: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);

  return elapsed;
}
