/**
 * Nav Sigil Registry — game-themed sigils for bottom navigation tabs.
 *
 * Replaces generic lucide-react icons (Backpack, Gauge, PlayCircle,
 * ShoppingCart, Trophy, User) with game-entity visuals.
 */
export interface NavSigilDef {
  id: string;
  glyph: string;
  color: string;
  accentColor: string;
  label: string;
}

export const NAV_SIGILS: Record<string, NavSigilDef> = {
  dashboard: {
    id: 'dashboard',
    glyph: '◇',
    color: '#FF9000',
    accentColor: '#FFEA3A',
    label: 'Board',
  },
  fight: {
    id: 'fight',
    glyph: '⚔',
    color: '#FF4B5C',
    accentColor: '#FFEA3A',
    label: 'Action',
  },
  inventory: {
    id: 'inventory',
    glyph: '▣',
    color: '#A855F7',
    accentColor: '#FF9DF5',
    label: 'Gear',
  },
  market: {
    id: 'market',
    glyph: '$',
    color: '#F7D20B',
    accentColor: '#FF9000',
    label: 'Market',
  },
  leaderboards: {
    id: 'leaderboards',
    glyph: '♔',
    color: '#FFEA3A',
    accentColor: '#FF9000',
    label: 'Rank',
  },
  profile: {
    id: 'profile',
    glyph: '☻',
    color: '#06B6D4',
    accentColor: '#A5F3FC',
    label: 'Hunter',
  },
};

export function getNavSigil(tabId: string): NavSigilDef {
  return NAV_SIGILS[tabId] ?? {
    id: tabId,
    glyph: '?',
    color: '#B8B0A8',
    accentColor: '#34303A',
    label: tabId,
  };
}
