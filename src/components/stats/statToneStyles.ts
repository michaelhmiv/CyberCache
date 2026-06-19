import type { StatTone } from '@/lib/stats/characterStats';

export const statToneTextClass: Record<StatTone, string> = {
  amber: 'text-amber',
  green: 'text-green',
  red: 'text-red',
  cyan: 'text-cyan',
  purple: 'text-purple',
  muted: 'text-text-muted',
};

export const statToneRailClass: Record<StatTone, string> = {
  amber: 'bg-amber',
  green: 'bg-green',
  red: 'bg-red',
  cyan: 'bg-cyan',
  purple: 'bg-purple',
  muted: 'bg-text-muted',
};

export const statToneBgClass: Record<StatTone, string> = {
  amber: 'bg-amber/10',
  green: 'bg-green/10',
  red: 'bg-red/10',
  cyan: 'bg-cyan/10',
  purple: 'bg-purple/10',
  muted: 'bg-surface',
};
