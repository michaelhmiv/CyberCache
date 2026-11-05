/**
 * StandingsGallery model — the non-component exports for the
 * Showcase prototype (kept apart from the components file for the
 * react-refresh export rule): zone-painting ids, board switch
 * labels, and the date/ordinal helpers the captions print.
 */
import type { LeaderboardMetric, LeaderboardPeriod } from '@/lib/api/leaderboardService';

export const ZONE_PAINTING_IDS: Record<string, string> = {
  dustwaste_frontier: 'zone-dustwaste-bg',
  redline_circuit: 'zone-redline-bg',
  ironwood_bastion: 'zone-ironwood-bg',
  blastforge_yards: 'zone-blastforge-bg',
  prismatek_reactor: 'zone-prismatek-bg',
  throwtech_dumpnet: 'zone-throwtech-bg',
  helixworks_labyrinth: 'zone-helixworks-bg',
};

export const METRIC_LABELS: { value: LeaderboardMetric; label: string }[] = [
  { value: 'level', label: 'Level' },
  { value: 'xp', label: 'XP' },
  { value: 'net_worth', label: 'Net Worth' },
  { value: 'total_kills', label: 'Kills' },
  { value: 'kdr', label: 'K/D' },
  { value: 'highest_boss_tier', label: 'Boss Tier' },
  { value: 'total_mastery_xp', label: 'Mastery XP' },
  { value: 'highest_mastery_level', label: 'Mastery Lv' },
  { value: 'legendary_items', label: 'Legendaries' },
  { value: 'total_items', label: 'Items' },
];

export const PERIOD_LABELS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'all_time', label: 'All Time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

export const METRIC_LABEL_OF = (m: LeaderboardMetric): string =>
  METRIC_LABELS.find((x) => x.value === m)?.label ?? m;

export const PERIOD_LABEL_OF = (p: LeaderboardPeriod): string =>
  PERIOD_LABELS.find((x) => x.value === p)?.label ?? p;

export const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

export const weekRangeLabel = (startIso: string, endsAtIso: string): string => {
  const lastDay = new Date(Date.parse(endsAtIso) - 86_400_000).toISOString();
  return `${shortDay(startIso)} – ${shortDay(lastDay)}`;
};

export const ordinal = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
};
