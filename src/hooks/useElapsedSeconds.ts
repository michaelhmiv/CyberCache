/**
 * Display elapsed wall time from the server's activity start, using the
 * shared presentation clock. Mount time is the fallback for local previews.
 * Hidden panes stop subscribing; resuming reads current time immediately.
 */
import { useState } from 'react';
import { useNow } from '@/hooks/useNow';

export function useElapsedSeconds(enabled: boolean, startedAt?: string | null): number {
  const [mountedAt] = useState(Date.now);
  const now = useNow(enabled);
  const parsedStart = startedAt ? Date.parse(startedAt) : mountedAt;
  const start = Number.isFinite(parsedStart) ? parsedStart : mountedAt;
  return Math.max(0, Math.floor((now - start) / 1000));
}
