import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';

import { ResourceBar } from '@/components/layout/ResourceBar';
import { SyncedLoadoutScreen } from './SyncedLoadoutScreen';
import { GearHub } from '@/components/gear/GearHub';
import { ConsumablesScreen } from './ConsumablesScreen';
import { useActivityStore, useMarketStore, useWorkshopStore } from '@/store';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

/** Scroll a page section into view (guarded — some environments
 *  lack scrollIntoView; the scroll is an enhancement, never a gate). */
const scrollToAnchor = (id: string) => {
  const el = document.getElementById(id);
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'start' });
  }
};

interface InventoryScreenProps {
  onNavigate: (screen: string) => void;
  /**
   * Stop intent from navigation (flow audit F2 + redesign Wave D):
   * loadout doors (Home deck "Loadout Bench", the Action stage's
   * Manage door, onNavigate('loadout')) carry { tab: 'loadout' } so
   * the gear home opens ON the Loadout page — the one equip surface.
   * Garage doors (the roaming banner's "Open Garage") carry
   * { tab: 'loadout', expandVehicle: true }: the owner overruled
   * §11 F1 on 2026-11-02 and the Garage folded into the Loadout
   * page, so the intent lands on Loadout with its vehicle section
   * already expanded.
   */
  tabIntent?: { tab: 'loadout'; seq: number; expandVehicle?: boolean } | null;
}

/**
 * The Workshop status strip at the foot of the Loadout page
 * (crafting consolidation, owner ruling 2026-11-04).
 *
 * The bench's canonical home is Home's Craft workspace now — Gear
 * is purely what the player OWNS. What remains here is a glance:
 * the bench's counts (running / queued / ready) and whether Craft
 * holds the action slot, on a ◦ secondary door (DESIGN.md §9) that
 * lands on Home with the bench open. "Ready" counts the jobs in
 * the server view's recent-completions window — craft outputs land
 * in the player's bags automatically at completion; there is no
 * claim step to queue for.
 */
const WorkshopStatusStrip: React.FC<{
  running: number;
  queued: number;
  ready: number;
  activityKind: string;
  onOpen: () => void;
}> = ({ running, queued, ready, activityKind, onOpen }) => {
  const craftActive = activityKind === 'crafting';
  const serviceActive = activityKind === 'workshop_service';
  const hasCounts = running + queued + ready > 0;
  const stateWord = craftActive
    ? 'Craft active'
    : serviceActive
      ? 'Service active'
      : running + queued > 0
        ? 'Bench paused'
        : 'Bench idle';
  const stateTone = craftActive
    ? 'border-green/50 bg-green/10 text-green'
    : serviceActive
      ? 'border-cyan/50 bg-cyan/10 text-cyan'
      : running + queued > 0
        ? 'border-red/50 bg-red/10 text-red'
        : 'border-border bg-surface text-text-muted';
  return (
    <div className="px-4">
      <button
        type="button"
        onClick={onOpen}
        data-testid="gear-workshop-strip"
        className="bl-panel flex w-full items-center gap-2.5 px-3 py-3 text-left transition-colors active:brightness-110"
      >
        <PxIcon name="anvil" size={26} className="shrink-0 text-amber" />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-black text-text-primary">Workshop</span>
          <span className="block text-[11px] font-bold text-text-muted" data-testid="gear-workshop-strip-counts">
            {hasCounts ? (
              <>
                <span className="text-[13px] font-black text-text-primary">{running}</span>{' running · '}
                <span className="text-[13px] font-black text-text-primary">{queued}</span>{' queued · '}
                <span className="text-[13px] font-black text-text-primary">{ready}</span>{' ready — the bench lives on Home'}
              </>
            ) : 'No jobs on the bench — the bench lives on Home'}
          </span>
        </span>
        <span
          className={`shrink-0 border px-1.5 py-0.5 text-[11px] font-black ${stateTone}`}
          data-testid="gear-workshop-strip-state"
        >
          {stateWord}
        </span>
        <PxIcon name="chevR" size={17} className="shrink-0 text-text-muted" />
      </button>
    </div>
  );
};

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ onNavigate, tabIntent = null }) => {
  // Garage deep-link: the seq of an intent that asked for the
  // vehicle section expanded (see VehicleGarageSection).
  const [vehicleExpandSeq, setVehicleExpandSeq] = useState<number | null>(
    () => (tabIntent?.expandVehicle ? tabIntent.seq : null),
  );
  // A fresh intent (new seq) re-applies even if the home is already
  // mounted — e.g. a second loadout door tapped in the same session.
  // Render-phase adjustment (React's pattern for prop-driven state)
  // rather than an effect: the intent lands in the same commit as
  // the navigation that carried it.
  const [appliedIntentSeq, setAppliedIntentSeq] = useState<number | null>(tabIntent?.seq ?? null);
  if (tabIntent && tabIntent.seq !== appliedIntentSeq) {
    setAppliedIntentSeq(tabIntent.seq);
    if (tabIntent.expandVehicle) setVehicleExpandSeq(tabIntent.seq);
  }
  // Gear-page equip door: the Inventory section's Equip action
  // routes here; the merged page stays mounted and the Loadout
  // panel opens the Slot Picker (the one equip surface) on the
  // slot via the seq'd picker request.
  const [pickerRequest, setPickerRequest] = useState<{ slot: LoadoutSlot; seq: number } | null>(null);
  // Narrow selectors (gear-grid perf audit, 2026-11-02): only the
  // job list, the completions window, and the current action kind
  // are read here — a whole-store subscription re-rendered the
  // entire gear home (and its 132-card grid) on any store write.
  const workshopJobs = useWorkshopStore((s) => s.server?.jobs);
  const workshopCompletions = useWorkshopStore((s) => s.server?.recentCompletions);
  const activityKind = useActivityStore((s) => s.current.kind);

  const runningCount = (workshopJobs ?? []).filter((j) => j.state === 'running').length;
  const queuedCount = (workshopJobs ?? []).filter(
    (j) => j.state === 'queued' || j.state === 'paused',
  ).length;
  const readyCount = new Set((workshopCompletions ?? []).map((c) => c.jobId)).size;

  const requestService = () => {
    useMarketStore.getState().setActiveTab('repair');
    onNavigate('market');
  };

  return (
    <div className="bl-page space-y-4 pb-20">
      <div className="px-4 pt-3">
        <ResourceBar onOpenSettings={() => onNavigate('settings')} />
      </div>

      {/* The merged Gear page (Exec C, 2026-11-03; Workshop stop
          retired by the crafting consolidation, 2026-11-04): ONE
          scroll — the Split doll zone + Garage, then § Inventory
          (the whole former Grid), then § Belt & Stacks (the whole
          former Items stop), then the Workshop status strip at the
          foot. Gear holds what the player owns; the bench itself
          lives on Home. */}
      <div className="space-y-4">
        <div id="gear-loadout-section">
          <SyncedLoadoutScreen
            pickerRequest={pickerRequest}
            onOpenWardrobe={() => onNavigate('wardrobe')}
            vehicleExpandSignal={vehicleExpandSeq}
            onRequestService={requestService}
            onNavigate={onNavigate}
          />
        </div>
        <section id="gear-inventory-section" aria-label="Inventory">
          <GearHub
            onNavigate={onNavigate}
            onEquipRequest={(_item, slot) => {
              setPickerRequest({ slot, seq: Date.now() });
              // The picker opens on the doll zone — bring the
              // page back to it so closing the sheet lands on
              // the slot the item went into.
              scrollToAnchor('gear-loadout-section');
            }}
          />
        </section>
        <section id="gear-belt-section" aria-label="Belt and stacks">
          <ConsumablesScreen onNavigate={onNavigate} />
        </section>
        <WorkshopStatusStrip
          running={runningCount}
          queued={queuedCount}
          ready={readyCount}
          activityKind={activityKind}
          onOpen={() => onNavigate('workshop')}
        />
      </div>
    </div>
  );
};
