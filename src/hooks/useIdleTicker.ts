import { useEffect, useState } from 'react';
import { useIdleStore } from '../store/slices/idleSlice';
import { processOfflineCrafting } from '../lib/craftingEngine';

export function useIdleTicker(callback: () => void, intervalMs = 3000) {
  const { isFarming } = useIdleStore();

  useEffect(() => {
    if (!isFarming) return;
    const id = setInterval(callback, intervalMs);
    return () => clearInterval(id);
  }, [isFarming, callback, intervalMs]);
}

export function useOfflineClaim(
  lastClaimTime: number,
  ratePerMinute: number,
  capHours: number,
  workshopQueues: any[] = [],
  lastWorkshopTick: number = Date.now(),
  skillBonuses?: { offlineEarnings?: number; scrapYield?: number },
) {
  const [claimable, setClaimable] = useState({
    credits: 0,
    scrap: 0,
    seconds: 0,
    workshopItems: {} as Record<string, number>,
  });

  useEffect(() => {
    const now = Date.now();
    const elapsedMs = now - lastClaimTime;
    const capMs = capHours * 60 * 60 * 1000;
    const effectiveMs = Math.min(elapsedMs, capMs);
    const minutes = effectiveMs / 60000;

    // Apply Scavenger offlineEarnings bonus
    const earningsMult = 1 + (skillBonuses?.offlineEarnings || 0);
    const scrapRate = ratePerMinute * 0.2 * (1 + (skillBonuses?.scrapYield || 0));

    // Process workshop offline crafting
    const { completedItems } = processOfflineCrafting(workshopQueues, lastWorkshopTick, now);

    setClaimable({
      credits: Math.floor(minutes * ratePerMinute * earningsMult),
      scrap: Math.floor(minutes * scrapRate),
      seconds: Math.floor(effectiveMs / 1000),
      workshopItems: completedItems,
    });
  }, [lastClaimTime, ratePerMinute, capHours, workshopQueues, lastWorkshopTick, skillBonuses]);

  return claimable;
}
