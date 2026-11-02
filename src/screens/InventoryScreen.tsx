import React, { useState } from 'react';
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
 * DESIGN.md §3 and the coverage audit (#21 Grid + salvage, #28
 * reforge on the inspect sheet's action row) — these rows are the
 * Workshop stop's signposts to them, so the bench family reads as
 * one place without moving a canonical door.
 */
const BenchServiceDoors: React.FC<{ onGoGrid: () => void }> = ({ onGoGrid }) => (
  <div className="mx-4 mt-3 border border-border bg-surface/80 p-3">
    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-text-muted">Also at the bench</div>
    <div className="mt-2 space-y-1.5">
      <button
        type="button"
        onClick={onGoGrid}
        className="flex w-full items-center gap-2 text-left text-[11px] font-bold text-text-secondary transition-colors hover:text-amber"
      >
        <PxIcon name="hammer" size={13} className="shrink-0 text-amber" />
        <span className="flex-1">Reforge an affix — pick the item in the Grid; the bench is on its inspect sheet.</span>
        <PxIcon name="chevR" size={13} className="ml-auto shrink-0" />
      </button>
      <button
        type="button"
        onClick={onGoGrid}
        className="flex w-full items-center gap-2 text-left text-[11px] font-bold text-text-secondary transition-colors hover:text-amber"
      >
        <PxIcon name="scrap" size={13} className="shrink-0 text-amber" />
        <span className="flex-1">Salvage &amp; recycle — in the Grid, one item or a whole selection at once.</span>
        <PxIcon name="chevR" size={13} className="ml-auto shrink-0" />
      </button>
    </div>
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
  // Gear-home equip door: GearHub's Equip action lands here; the
  // Loadout stop opens the Slot Picker (the one equip surface) on
  // the slot.
  const [pendingPickerSlot, setPendingPickerSlot] = useState<LoadoutSlot | null>(null);
  const workshop = useWorkshopStore();
  const reduceMotion = useReducedMotion();

  const queueCount = (workshop.server?.jobs ?? []).filter(
    (j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused',
  ).length;

  const goToStop = (stop: GearStop) => {
    // Manual stop switches clear any pending equip deep link so it
    // can't reopen the picker on a later visit.
    setPendingPickerSlot(null);
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
            <SyncedLoadoutScreen
              requestedPickerSlot={pendingPickerSlot}
              vehicleExpandSignal={vehicleExpandSeq}
              onRequestService={requestService}
            />
          )}
          {activeStop === 'grid' && (
            <GearHub
              onNavigate={onNavigate}
              onEquipRequest={(_item, slot) => {
                setActiveStop('loadout');
                setPendingPickerSlot(slot);
              }}
            />
          )}
          {activeStop === 'items' && <ConsumablesScreen onNavigate={onNavigate} />}
          {activeStop === 'workshop' && (
            <div>
              <BenchServiceDoors onGoGrid={() => goToStop('grid')} />
              <WorkshopScreen onNavigate={onNavigate} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
