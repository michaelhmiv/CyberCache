import React, { useRef } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
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
 * Home — the merged Board + Action tab (redesign Wave B, DESIGN.md
 * §2/§4). The Action experience is the main stage: choose a place,
 * get the immediate rundown. The Board's content rides the same
 * screen — the claim row (level / streak / contracts) under the
 * Strip, and the deck (Action Board launchers, Hunter Totals,
 * consumables, area panels) below the workspace.
 *
 * Composition order (DESIGN.md §4, shell level): Strip (+ the one
 * settings gear resident §1 allows) → claim chips → Stage → the lit
 * mode's workspace → deck. Deep composition polish is Wave C's
 * slice; this shell keeps every door the two old tabs exposed at
 * the coverage audit's tap counts.
 */
export const HomeScreen: React.FC<HomeScreenProps> = ({ onNavigate, onOpenBossSelect }) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const showStage = () => {
    stageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="bl-page relative overflow-hidden p-2 pb-16">
      <div className="pointer-events-none absolute inset-0 opacity-70"><div className="absolute left-5 top-20 h-48 w-48 rounded-full bg-amber/10 blur-3xl" /><div className="absolute right-2 top-72 h-48 w-48 rounded-full bg-red/10 blur-3xl" /></div>
      <div className="relative space-y-2">
        {/* The Strip — the wallet prints exactly once on Home, with
            the settings gear at its right edge (DESIGN.md §1's one
            allowed resident; Settings' canonical home stays
            Hunter → Account). This is audit SET-01's home-screen
            Settings entry in its DESIGN form. */}
        <div className="mb-2 flex items-stretch gap-2">
          <ResourceBar className="min-w-0 flex-1" />
          <button
            type="button"
            aria-label="Settings"
            onClick={() => onNavigate('settings')}
            className="flex w-[44px] shrink-0 items-center justify-center border-2 border-border bg-surface text-text-muted transition-transform active:scale-[0.96]"
          >
            <PxIcon name="cog" size={17} />
          </button>
        </div>
        {/* Claim row (2026-11-01 top-bar redesign): level progress
            button + streak/contracts icon pop-ups — first paint, no
            scroll. The offline recap lives in its level pop-up. */}
        <DashboardTopBar />
        {/* The Stage — the Action workspace is Home's main stage. */}
        <div ref={stageRef} className="scroll-mt-2">
          <ActionScreenContextual onOpenBossSelect={() => onOpenBossSelect?.()} onNavigate={onNavigate} />
        </div>
        {/* The deck — everything the Board held below its stage. */}
        <DashboardDeck onNavigate={onNavigate} onShowStage={showStage} />
      </div>
    </div>
  );
};
