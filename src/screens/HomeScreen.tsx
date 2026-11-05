import React from 'react';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { DashboardTopBar } from '@/components/dashboard/DashboardTopBar';
import { DashboardDeck } from '@/components/dashboard/DashboardDeck';
import { ActionScreenContextual } from '@/screens/ActionScreenContextual';

interface HomeScreenProps {
  onNavigate: (screen: string) => void;
  /** Opens the App-level boss picker (flow-fix F16). */
  onOpenBossSelect?: () => void;
  /**
   * Craft-bench intent (crafting consolidation, 2026-11-04):
   * App's 'workshop' alias lands here with a seq-stamped intent;
   * the stage component opens the bench workspace on arrival.
   */
  craftBenchIntent?: { seq: number } | null;
}

/**
 * Home — the merged Board + Action tab (redesign Wave B shell,
 * Wave C composition, DESIGN.md §2/§4). The Action experience is
 * the main stage: choose a place, get the immediate rundown.
 *
 * Composition order (DESIGN.md §4, the full ladder): Strip (+ the
 * one settings gear resident §1 allows) → claim chips → mode
 * rail → Stage → consumable belt → lit workspace (steps 1–5 above
 * the fold) → the deck below in its fixed order (launchers →
 * Weekly claimables → Now → Hunter Totals). The rail leads the
 * Stage and the belt sits in the rail's vacated slot under the
 * stage block since the owner's device ruling of 2026-11-04;
 * nothing but the Strip, claim chips, and the rail sits above
 * the Stage, and the Stage is never below the fold in any
 * state — the mode rail, the belt, and the lit workspace all
 * render inside the stage component (ActionScreenContextual).
 */
export const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigate, onOpenBossSelect, craftBenchIntent = null }) => {
  return (
    <div className="bl-page relative overflow-hidden p-2 pb-16">
      <div className="pointer-events-none absolute inset-0 opacity-70"><div className="absolute left-5 top-20 h-48 w-48 rounded-full bg-amber/10 blur-3xl" /><div className="absolute right-2 top-72 h-48 w-48 rounded-full bg-red/10 blur-3xl" /></div>
      <div className="relative space-y-2">
        {/* The Strip — the wallet prints exactly once on Home, with
            the settings gear as its right-edge resident (DESIGN.md
            §1's one allowed resident, inside the Strip since
            drift-fix F1; Settings' canonical home stays
            Hunter → Account). This is audit SET-01's home-screen
            Settings entry in its DESIGN form. HOME VARIANT
            (2026-11-05): no cache segment (the claim row's CACHE
            button carries the key count), the LV segment is the
            level pop-up's door, and a real XP row (fraction + bar)
            replaces the hairline. The level door travels as an
            event — DashboardTopBar owns the sheets. */}
        <div className="mb-2">
          <ResourceBar
            variant="home"
            onOpenSettings={() => onNavigate('settings')}
            onLevelPress={() => window.dispatchEvent(new CustomEvent('cybercache:open-level-sheet'))}
          />
        </div>
        {/* Claim row: CACHE + OFFLINE buttons (the level pill
            retired 2026-11-05 — its readout duplicated the Strip)
            + streak / contracts / weekly claim chips — first
            paint, no scroll, nothing else above the Stage (§4). */}
        <DashboardTopBar onNavigate={onNavigate} />
        {/* The Stage block — mode rail, diorama, belt, lit workspace. */}
        <div className="scroll-mt-2">
          <ActionScreenContextual onOpenBossSelect={() => onOpenBossSelect?.()} onNavigate={onNavigate} craftBenchIntent={craftBenchIntent} />
        </div>
        {/* The deck — §4's fixed four blocks below the fold. */}
        <DashboardDeck onNavigate={onNavigate} />
      </div>
    </div>
  );
};
