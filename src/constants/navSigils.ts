import type { PxIconName } from '@/lib/pixel/icons';

/**
 * Nav Sigil Registry — game-themed sigils for bottom navigation tabs.
 *
 * Replaces generic lucide-react icons (Backpack, Gauge, PlayCircle,
 * ShoppingCart, Trophy, User) with game-entity visuals.
 */
export interface NavSigilDef {
  id: string;
  icon: PxIconName;
  color: string;
  accentColor: string;
  label: string;
}

export const NAV_SIGILS: Record<string, NavSigilDef> = {
  dashboard: {
    id: 'dashboard',
    icon: 'diamond',
    color: '#FF9000',
    accentColor: '#FFEA3A',
    label: 'Board',
  },
  fight: {
    id: 'fight',
    icon: 'crosshair',
    color: '#FF4B5C',
    accentColor: '#FFEA3A',
    label: 'Action',
  },
  inventory: {
    id: 'inventory',
    icon: 'pack',
    color: '#A855F7',
    accentColor: '#FF9DF5',
    label: 'Gear',
  },
  market: {
    id: 'market',
    icon: 'tag',
    color: '#F7D20B',
    accentColor: '#FF9000',
    label: 'Market',
  },
  leaderboards: {
    id: 'leaderboards',
    icon: 'crown',
    color: '#FFEA3A',
    accentColor: '#FF9000',
    label: 'Rank',
  },
  profile: {
    id: 'profile',
    icon: 'person',
    color: '#06B6D4',
    accentColor: '#A5F3FC',
    label: 'Hunter',
  },
};

export function getNavSigil(tabId: string): NavSigilDef {
  return NAV_SIGILS[tabId] ?? {
    id: tabId,
    icon: 'diamond',
    color: '#B8B0A8',
    accentColor: '#34303A',
    label: tabId,
  };
}
