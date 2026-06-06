import { useEffect, useState } from 'react';
import { useIdleStore } from '../store/slices/idleSlice';

export function useIdleTicker(callback: () => void, intervalMs = 3000) {
  const { isFarming } = useIdleStore();

  useEffect(() => {
    if (!isFarming) return;
    const id = setInterval(callback, intervalMs);
    return () => clearInterval(id);
  }, [isFarming, callback, intervalMs]);
}

export function useOfflineClaim(lastClaimTime: number, ratePerMinute: number, capHours: number) {
  const [claimable, setClaimable] = useState({ credits: 0, scrap: 0, seconds: 0 });

  useEffect(() => {
    const now = Date.now();
    const elapsedMs = now - lastClaimTime;
    const capMs = capHours * 60 * 60 * 1000;
    const effectiveMs = Math.min(elapsedMs, capMs);
    const minutes = effectiveMs / 60000;
    setClaimable({
      credits: Math.floor(minutes * ratePerMinute),
      scrap: Math.floor(minutes * (ratePerMinute * 0.2)),
      seconds: Math.floor(effectiveMs / 1000),
    });
  }, [lastClaimTime, ratePerMinute, capHours]);

  return claimable;
}
