import React, { useState } from 'react';
import { VehicleStatusLine } from './VehicleStatusLine';
import { GaragePanel } from './GaragePanel';

/**
 * The Loadout's vehicle section (owner ruling 2026-11-02, DESIGN.md
 * §11 F1 as amended): the vehicle slot's status line is the section
 * header — equipped vehicle, yield, fuel, condition always visible —
 * and one tap on its Open Garage toggle expands the FULL Garage in
 * place underneath: tank panel, per-vehicle cards, patch-kit repair.
 * The Garage is not a rail stop anymore; this section is its home,
 * exactly as the approved mock (m07-loadout lineage) framed it.
 *
 * `expandSignal` is the deep-link door: Garage doors elsewhere
 * (the Home stage's banner) navigate here carrying a fresh seq,
 * and a new seq opens the section expanded on arrival — the same
 * render-phase adjustment pattern the gear home uses for its tab
 * intents.
 */
export const VehicleGarageSection: React.FC<{
  expandSignal?: number | null;
  onRequestService?: () => void;
  /** App navigation, threaded to the Garage's remedy doors. */
  onNavigate?: (screen: string) => void;
}> = ({ expandSignal = null, onRequestService, onNavigate }) => {
  const [expanded, setExpanded] = useState(false);
  const [appliedSignal, setAppliedSignal] = useState<number | null>(null);
  if (expandSignal !== null && expandSignal !== appliedSignal) {
    setAppliedSignal(expandSignal);
    setExpanded(true);
  }

  return (
    <div className="space-y-3">
      <VehicleStatusLine expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} />
      {expanded && <GaragePanel onRequestService={onRequestService} onNavigate={onNavigate} />}
    </div>
  );
};
