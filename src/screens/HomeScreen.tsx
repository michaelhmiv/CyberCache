import React from 'react';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { DashboardTopBar } from '@/components/dashboard/DashboardTopBar';
import { DashboardDeck } from '@/components/dashboard/DashboardDeck';
import { ActionScreenContextual } from '@/screens/ActionScreenContextual';

interface HomeScreenProps {
  onNavigate: (screen: string) => void;
  /** Opens the App-level boss picker (flow-fix F16). */
  onOpenBossSelect?: () => void;
}

/**
 * Home — the merged Board + Action tab (redesign Wave B shell,
 * Wave C composition, DESIGN.md §2/§4). The Action experience is
 * the main stage: choose a place, get the immediate rundown.
 *
 * Composition order (DESIGN.md §4, the full ladder): Strip (+ the
 * one settings gear resident §1 allows) → claim chips → Stage →
 * mode rail → lit workspace → consumable belt (steps 1–5 above
 * the fold) → the deck below in its fixed order (launchers →
 * Weekly claimables → Now → Hunter Totals). Nothing but the
 * Strip and claim chips sits above the Stage, and the Stage is
 * never below the fold in any state — the mode rail, the lit
 * workspace, and the belt all render inside the stage component
 * (ActionScreenContextual) directly under the diorama.
 */
export const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigate, onOpenBossSelect }) => {
  return (
    <div className="bl-page relative overflow-hidden p-2 pb-16">
      <div className="pointer-events-none absolute inset-0 opacity-70"><div className="absolute left-5 top-20 h-48 w-48 rounded-full bg-amber/10 blur-3xl" /><div className="absolute right-2 top-72 h-48 w-48 rounded-full bg-red/10 blur-3xl" /></div>
      <div className="relative space-y-2">
        {/* The Strip — the wallet prints exactly once on Home, with
            the settings gear as its right-edge resident (DESIGN.md
            §1's one allowed resident, inside the Strip since
            drift-fix F1; Settings' canonical home stays
            Hunter → Account). This is audit SET-01's home-screen
            Settings entry in its DESIGN form. */}
        <div className="mb-2">
          <ResourceBar onOpenSettings={() => onNavigate('settings')} />
        </div>
        {/* Claim row: level chip (the Return Sheet's door) +
            streak / contracts / weekly claim chips — first paint,
            no scroll, nothing else above the Stage (§4). */}
        <DashboardTopBar />
        {/* The Stage — diorama, mode rail, lit workspace, belt. */}
        <div className="scroll-mt-2">
          <ActionScreenContextual onOpenBossSelect={() => onOpenBossSelect?.()} onNavigate={onNavigate} />
        </div>
        {/* The deck — §4's fixed four blocks below the fold. */}
        <DashboardDeck onNavigate={onNavigate} />
      </div>
    </div>
  );
};
