/**
 * Activity Visual Registry — visual identity for each activity kind.
 *
 * Replaces hardcoded lucide-react icon maps in ActivityModifierPanel,
 * ActionScreenContextual, and WorldPulseFeed with a central registry.
 */
import type { ActivityKind } from '@/types/activity';

export interface ActivityVisual {
  kind: ActivityKind;
  glyph: string;
  color: string;
  accentColor: string;
  label: string;
  shortLabel: string;
  description: string;
}

export const ACTIVITY_VISUALS: Record<ActivityKind, ActivityVisual> = {
  none: {
    kind: 'none',
    glyph: '○',
    color: '#B8B0A8',
    accentColor: '#34303A',
    label: 'None',
    shortLabel: '—',
    description: 'No active activity.',
  },
  idle_standby: {
    kind: 'idle_standby',
    glyph: '⏸',
    color: '#B8B0A8',
    accentColor: '#FF9000',
    label: 'Idle Standby',
    shortLabel: 'IDLE',
    description: 'Hunter is on standby. No active patrol or job.',
  },
  roaming_loot: {
    kind: 'roaming_loot',
    glyph: '📡',
    color: '#A855F7',
    accentColor: '#FF9DF5',
    label: 'Roaming Loot',
    shortLabel: 'ROAM',
    description: 'Patrolling a roaming area for kills, loot, and resources.',
  },
  boss_fight: {
    kind: 'boss_fight',
    glyph: '☠',
    color: '#FF4B5C',
    accentColor: '#FFEA3A',
    label: 'Boss Fight',
    shortLabel: 'BOSS',
    description: 'Engaged in a multi-phase boss encounter.',
  },
  crafting: {
    kind: 'crafting',
    glyph: '⚒',
    color: '#FF9000',
    accentColor: '#FFEA3A',
    label: 'Crafting',
    shortLabel: 'CRAFT',
    description: 'Building gear at the workbench.',
  },
  salvaging: {
    kind: 'salvaging',
    glyph: '♻',
    color: '#7CFC00',
    accentColor: '#B2FF59',
    label: 'Salvaging',
    shortLabel: 'SALV',
    description: 'Breaking down gear into scrap and materials.',
  },
  workshop_service: {
    kind: 'workshop_service',
    glyph: '⚙',
    color: '#3B82F6',
    accentColor: '#A5F3FC',
    label: 'Workshop Service',
    shortLabel: 'WSP',
    description: 'Processing a workshop service job.',
  },
  market_listing: {
    kind: 'market_listing',
    glyph: '$',
    color: '#F7D20B',
    accentColor: '#FF9000',
    label: 'Market Listing',
    shortLabel: 'MKT',
    description: 'Item listed on the player market.',
  },
  endless_run: {
    kind: 'endless_run',
    glyph: '∞',
    color: '#C026D3',
    accentColor: '#FF4B5C',
    label: 'Endless Run',
    shortLabel: 'ENDLESS',
    description: 'Inside the Chaos Chamber — depth is the score, escrow pays at the end.',
  },
};

export function getActivityVisual(kind: ActivityKind): ActivityVisual {
  return ACTIVITY_VISUALS[kind] ?? ACTIVITY_VISUALS.none;
}
