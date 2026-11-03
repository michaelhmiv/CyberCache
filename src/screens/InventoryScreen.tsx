import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PxIcon } from '@/components/pixelArt/PxIcon';

import { ResourceBar } from '@/components/layout/ResourceBar';
import { SyncedLoadoutScreen } from './SyncedLoadoutScreen';
import { GearHub } from '@/components/gear/GearHub';
import { GearRail, type GearStop } from '@/components/gear/GearRail';
import { ConsumablesScreen } from './ConsumablesScreen';
import { WorkshopScreen } from './WorkshopScreen';
import { useMarketStore, useWorkshopStore } from '@/store';
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
   * the gear home opens ON the Loadout stop — the one equip surface.
   * Garage doors (the roaming banner's "Open Garage") carry
   * { tab: 'loadout', expandVehicle: true }: the owner overruled
   * §11 F1 on 2026-11-02 and the Garage folded into the Loadout
   * stop, so the intent lands on Loadout with its vehicle section
   * already expanded. Absent intent (the Gear bottom tab) opens on
   * Loadout — the rail's first stop, the doll leads (DESIGN.md §2
   * order).
   */
  tabIntent?: { tab: 'loadout'; seq: number; expandVehicle?: boolean } | null;
}

/**
 * Bench-family doors on the Workshop stop. Crafting's bench lives
 * here (the crafting home is labeled 'Workshop' everywhere); reforge and salvage/recycle keep their canonical doors per
 * DESIGN.md §3 and the coverage audit (#21 inventory + salvage, #28
 * reforge on the inspect sheet's action row) — these rows are the
 * Workshop stop's signposts to them, so the bench family reads as
 * one place without moving a canonical door. Since the Exec C
 * merge (2026-11-03) the signposts land on the merged Loadout
 * page's Inventory section (INVENTORY.md W11 — the copy names the
 * section the player will actually see).
 */
const BenchServiceDoors: React.FC<{ onGoInventory: () => void }> = ({ onGoInventory }) => (
  <div className="mx-4 mt-3 border border-border bg-surface/80 p-3">
    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">Also at the bench</div>
    <div className="mt-2 space-y-1.5">
      <button
        type="button"
        onClick={onGoInventory}
        className="flex w-full items-center gap-2 text-left text-[11px] font-bold text-text-secondary transition-colors hover:text-amber"
      >
        <PxIcon name="hammer" size={13} className="shrink-0 text-amber" />
        <span className="flex-1">Reforge an affix — pick the item in Inventory on the Loadout page; the bench is on its inspect sheet.</span>
        <PxIcon name="chevR" size={13} className="ml-auto shrink-0" />
      </button>
      <button
        type="button"
        onClick={onGoInventory}
        className="flex w-full items-center gap-2 text-left text-[11px] font-bold text-text-secondary transition-colors hover:text-amber"
      >
        <PxIcon name="scrap" size={13} className="shrink-0 text-amber" />
        <span className="flex-1">Salvage &amp; recycle — in Inventory on the Loadout page, one item or a whole selection at once.</span>
        <PxIcon name="chevR" size={13} className="ml-auto shrink-0" />
      </button>
    </div>
  </div>
);

/**
 * The Workshop door at the foot of the merged Loadout page
 * (INVENTORY.md W12): the bench state prints on the door itself —
 * benches owned and jobs running — and the tap lands on the
 * Workshop stop, the bench's canonical home.
 */
const WorkshopDoorRow: React.FC<{
  benchesOwned: number;
  activeJobs: number;
  onOpen: () => void;
}> = ({ benchesOwned, activeJobs, onOpen }) => (
  <div className="px-4">
    <button
      type="button"
      onClick={onOpen}
      data-testid="gear-workshop-door"
      className="flex w-full items-center gap-2.5 border border-border bg-surface/80 px-3 py-3 text-left transition-colors hover:border-amber/50"
    >
      <PxIcon name="anvil" size={26} className="shrink-0 text-amber" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-black text-text-primary">Workshop</span>
        <span className="block text-[11px] font-bold text-text-muted">
          {benchesOwned} bench{benchesOwned === 1 ? '' : 'es'} ·{' '}
          {activeJobs > 0 ? `${activeJobs} job${activeJobs === 1 ? '' : 's'} running` : 'benches idle'}
        </span>
      </span>
      <PxIcon name="chevR" size={17} className="shrink-0 text-text-muted" />
    </button>
  </div>
);

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ onNavigate, tabIntent = null }) => {
  const [activeStop, setActiveStop] = useState<GearStop>(() => tabIntent?.tab ?? 'loadout');
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
    setActiveStop(tabIntent.tab);
    if (tabIntent.expandVehicle) setVehicleExpandSeq(tabIntent.seq);
  }
  // Gear-page equip door: the Inventory section's Equip action
  // routes here; the merged page stays mounted and the Loadout
  // panel opens the Slot Picker (the one equip surface) on the
  // slot via the seq'd picker request.
  const [pickerRequest, setPickerRequest] = useState<{ slot: LoadoutSlot; seq: number } | null>(null);
  // Anchor scrolls that must wait for a stop switch to mount their
  // target (the Workshop stop's bench signposts land on the merged
  // page's Inventory section). The AnimatePresence swap takes
  // ~180ms; the scroll fires just after the new stop mounts.
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingAnchor) return;
    const t = setTimeout(() => {
      scrollToAnchor(pendingAnchor);
      setPendingAnchor(null);
    }, 260);
    return () => clearTimeout(t);
  }, [pendingAnchor]);
  // Narrow selectors (gear-grid perf audit, 2026-11-02): only the
  // job list and bench count are read here — a whole-store
  // subscription re-rendered the entire gear home (and its 132-card
  // grid) on any workshop store write.
  const workshopJobs = useWorkshopStore((s) => s.server?.jobs);
  const workshopBenches = useWorkshopStore((s) => s.server?.benches);
  const reduceMotion = useReducedMotion();

  const queueCount = (workshopJobs ?? []).filter(
    (j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused',
  ).length;
  const activeJobCount = (workshopJobs ?? []).filter((j) => j.state === 'running').length;

  const goToStop = (stop: GearStop) => {
    setActiveStop(stop);
  };

  const requestService = () => {
    useMarketStore.getState().setActiveTab('repair');
    onNavigate('market');
  };

  return (
    <div className="bl-page space-y-4 pb-20">
      <div className="px-4 pt-3">
        <ResourceBar onOpenSettings={() => onNavigate('settings')} />
      </div>
      <div className="px-4">
        <GearRail activeStop={activeStop} onSelect={goToStop} workshopJobs={queueCount} />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeStop}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
        >
          {activeStop === 'loadout' && (
            /* The merged Gear page (Exec C, 2026-11-03): ONE scroll —
               the Split doll zone + Garage, then § Inventory (the
               whole former Grid), then § Belt & Stacks (the whole
               former Items stop), then the Workshop door row at the
               foot. The rail keeps Loadout · Workshop; the page is
               the Loadout stop. */
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
              <WorkshopDoorRow
                benchesOwned={workshopBenches ?? 1}
                activeJobs={activeJobCount}
                onOpen={() => goToStop('workshop')}
              />
            </div>
          )}
          {activeStop === 'workshop' && (
            <div>
              <BenchServiceDoors
                onGoInventory={() => {
                  goToStop('loadout');
                  setPendingAnchor('gear-inventory-section');
                }}
              />
              <WorkshopScreen onNavigate={onNavigate} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
