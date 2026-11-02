import type { PxIconName } from '@/lib/pixel/icons';

/**
 * Nav Sigil Registry — game-themed sigils for bottom navigation tabs.
 *
 * The four-tab structure (DESIGN.md §2, owner-decided 2026-11-01):
 * Home · Gear · Market · Hunter. The retired six-tab ids (dashboard /
 * fight / leaderboards / profile) are gone — Board + Action merged
 * into Home, Rank folded into Hunter as the Standings door.
 */
export interface NavSigilDef {
  id: string;
  icon: PxIconName;
  color: string;
  accentColor: string;
  label: string;
}

export const NAV_SIGILS: Record<string, NavSigilDef> = {
  home: {
    id: 'home',
    icon: 'home',
    color: '#FF9000',
    accentColor: '#FFEA3A',
    label: 'Home',
  },
  gear: {
    id: 'gear',
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
  hunter: {
    id: 'hunter',
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
