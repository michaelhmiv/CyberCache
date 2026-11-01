import React, { useMemo, useState } from 'react';

import { ResourceBar } from '@/components/layout/ResourceBar';
import { compactResourceValue } from '@/lib/ui/formatValue';
import { SyncedLoadoutScreen } from './SyncedLoadoutScreen';
import { GearHub } from '@/components/gear/GearHub';
import { ConsumablesScreen } from './ConsumablesScreen';
import { WorkshopScreen } from './WorkshopScreen';
import { useInventoryStore, useLoadoutStore, useMarketStore, usePlayerStore, useWorkshopStore } from '@/store';
import { buildLoadoutRows, countEquippedLoadoutSlots } from '@/lib/loadout/loadoutReadModel';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

type InventoryTab = 'gear' | 'loadout' | 'consumables' | 'workshop';

interface InventoryScreenProps {
  onNavigate: (screen: string) => void;
  /**
   * Tab intent from navigation (flow audit F2): loadout doors
   * (Dashboard "Loadout Bench", the Fight tab's Manage door,
   * onNavigate('loadout')) carry { tab: 'loadout' } so the gear home
   * opens ON the Loadout tab — the one equip surface — instead of
   * depositing the player on the Gear list. Absent intent (the Gear
   * bottom tab) defaults to the Gear tab as before.
   */
  tabIntent?: { tab: InventoryTab; seq: number; anchor?: 'garage' } | null;
}

const TAB_SIGILS: Record<InventoryTab, { glyph: string; color: string }> = {
  gear: { glyph: '▣', color: '#A855F7' },
  loadout: { glyph: '⚔', color: '#3B82F6' },
  consumables: { glyph: '✚', color: '#7CFC00' },
  workshop: { glyph: '⚙', color: '#FF9000' },
};

const SummaryTile: React.FC<{ label: string; value: string | number; sub?: string }> = ({ label, value, sub }) => (
  <div className="bl-card min-w-0 p-2">
    <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">{label}</div>
    <div className="whitespace-nowrap text-lg font-black leading-tight text-text-primary">{value}</div>
    {sub && <div className="truncate text-[9px] text-text-muted">{sub}</div>}
  </div>
);

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ onNavigate, tabIntent = null }) => {
  const [activeTab, setActiveTab] = useState<InventoryTab>(() => tabIntent?.tab ?? 'gear');
  // A fresh intent (new seq) re-applies even if the home is already
  // mounted — e.g. a second loadout door tapped in the same session.
  // Render-phase adjustment (React's pattern for prop-driven state)
  // rather than an effect: the intent lands in the same commit as
  // the navigation that carried it.
  const [appliedIntentSeq, setAppliedIntentSeq] = useState<number | null>(tabIntent?.seq ?? null);
  if (tabIntent && tabIntent.seq !== appliedIntentSeq) {
    setAppliedIntentSeq(tabIntent.seq);
    setActiveTab(tabIntent.tab);
  }
  // Gear-home equip door: GearHub's Equip action lands here; the Loadout
  // tab opens the Slot Picker (the one equip surface) on the slot.
  const [pendingPickerSlot, setPendingPickerSlot] = useState<LoadoutSlot | null>(null);
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const player = usePlayerStore();
  const workshop = useWorkshopStore();

  const loadoutRows = useMemo(() => buildLoadoutRows(loadout.slots, inventory.items), [loadout.slots, inventory.items]);
  const equippedCount = countEquippedLoadoutSlots(loadoutRows);
  const lockedCount = inventory.items.filter((item) => item.isLocked).length;
  const queueCount = (workshop.server?.jobs ?? []).filter(
    (j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused',
  ).length;

  return (
    <div className="bl-page space-y-4 pb-20">
      <ResourceBar className="px-4 pt-3" />
      <div className="space-y-3 px-4 pb-0">

        <div className="grid grid-cols-4 gap-2">
          <SummaryTile label="Items" value={inventory.items.length} sub={`${lockedCount} locked`} />
          <SummaryTile label="Loadout" value={`${equippedCount}/7`} sub="resolved slots" />
          <SummaryTile label="Cash" value={compactResourceValue(player.credits)} sub={`${compactResourceValue(player.scrap)} scrap`} />
          <SummaryTile label="Jobs" value={queueCount} sub="workshop" />
        </div>

        <button
          onClick={() => onNavigate('chest')}
          className="bl-card flex w-full items-center justify-between p-3 text-left active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center gap-3 text-left">
            <div className="bl-icon-plate flex h-10 w-10 items-center justify-center font-black text-amber" style={{ fontSize: '19px' }}>
              ▤
            </div>
            <div>
              <div className="text-sm font-black text-text-primary">Open Data Cache</div>
              <div className="text-[10px] text-text-muted">{player.cacheKeys} keys · {player.cacheKeyFragments}/5 fragments · {player.legendaryCores} cores</div>
            </div>
          </div>
          <div className="bl-primary px-3 py-1 text-xs font-black">Open</div>
        </button>

        <div className="bl-tab-strip grid grid-cols-4 gap-1.5 p-1.5">
          {(Object.keys(TAB_SIGILS) as InventoryTab[]).map((tabId) => {
            const sigil = TAB_SIGILS[tabId];
            const active = activeTab === tabId;
            return (
              <button
                key={tabId}
                onClick={() => {
                  // Manual tab switches clear any pending equip deep link
                  // so it can't reopen the picker on a later visit.
                  setPendingPickerSlot(null);
                  setActiveTab(tabId);
                }}
                className={`flex flex-col items-center gap-1 py-2 text-[10px] font-black transition-colors ${active ? 'bl-primary' : 'bl-secondary text-text-muted'}`}
              >
                <span className="font-black leading-none" style={{ fontSize: '15px', color: active ? undefined : sigil.color }}>{sigil.glyph}</span>
                {tabId === 'gear' ? 'Gear' : tabId === 'loadout' ? 'Loadout' : tabId === 'consumables' ? 'Items' : 'Workshop'}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {activeTab === 'gear' && (
          <GearHub
            onNavigate={onNavigate}
            onEquipRequest={(_item, slot) => {
              setActiveTab('loadout');
              setPendingPickerSlot(slot);
            }}
          />
        )}
        {activeTab === 'loadout' && (
          <SyncedLoadoutScreen
            requestedPickerSlot={pendingPickerSlot}
            focusGarageSeq={tabIntent?.anchor === 'garage' ? tabIntent.seq : null}
            onRequestService={() => {
              useMarketStore.getState().setActiveTab('repair');
              onNavigate('market');
            }}
          />
        )}
        {activeTab === 'consumables' && <ConsumablesScreen onNavigate={onNavigate} />}
        {activeTab === 'workshop' && <WorkshopScreen onNavigate={onNavigate} />}
      </div>
    </div>
  );
};
