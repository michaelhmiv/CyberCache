import { WorkshopQueue } from './workshop';

export interface PlayerProfile {
  id: string;
  name: string;
  level: number;
  xp: number;
  credits: number;
  scrap: number;
  cacheKeys: number;
  cacheKeyFragments: number;
  currentZoneId: string;
  highestZoneId: string;
  offlineCapHours: number;
  lastClaimTime: number;
  deathFeeInsurance: boolean;
  consumables: Record<string, number>;
  materials: Record<string, number>;
  essences: Record<string, number>;
  workshopQueues: WorkshopQueue[];
  lastWorkshopTick: number;
  /** Server-authoritative tick counter — used to seed the client ticker on page load. */
  lastClaimedTick: number;
}
