export interface PlayerProfile {
  id: string;
  name: string;
  level: number;
  xp: number;
  credits: number;
  scrap: number;
  cacheKeys: number;
  currentZoneId: string;
  highestZoneId: string;
  offlineCapHours: number;
  lastClaimTime: number;
  deathFeeInsurance: boolean;
}
