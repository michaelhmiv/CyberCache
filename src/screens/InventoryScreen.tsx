import React, { useMemo, useState } from 'react';

import { ResourceBar } from '@/components/layout/ResourceBar';
import { SyncedLoadoutScreen } from './SyncedLoadoutScreen';
import { GearHub } from '@/components/gear/GearHub';
import { ConsumablesScreen } from './ConsumablesScreen';
import { WorkshopScreen } from './WorkshopScreen';
import { useInventoryStore, useLoadoutStore, usePlayerStore, useWorkshopStore } from '@/store';
import { buildLoadoutRows, countEquippedLoadoutSlots } from '@/lib/loadout/loadoutReadModel';
import type { LoadoutSlot } from '@/store/slices/loadoutSlice';

type InventoryTab = 'gear' | 'loadout' | 'consumables' | 'workshop';

interface InventoryScreenProps {
  onNavigate: (screen: string) => void;
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
    <div className="truncate text-lg font-black leading-tight text-text-primary">{value}</div>
    {sub && <div className="truncate text-[9px] text-text-muted">{sub}</div>}
  </div>
);

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<InventoryTab>('gear');
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
  const queueCount = workshop.activeQueues.length;

  return (
    <div className="bl-page space-y-4 pb-20">
      <ResourceBar className="px-4 pt-3" />
      <div className="space-y-3 px-4 pb-0">

        <div className="grid grid-cols-4 gap-2">
          <SummaryTile label="Items" value={inventory.items.length} sub={`${lockedCount} locked`} />
          <SummaryTile label="Loadout" value={`${equippedCount}/7`} sub="resolved slots" />
          <SummaryTile label="Cash" value={player.credits.toLocaleString()} sub={`${player.scrap.toLocaleString()} scrap`} />
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
              <div className="text-[10px] text-text-muted">{player.cacheKeys} keys · {player.cacheKeyFragments}/5 fragments</div>
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
          <SyncedLoadoutScreen requestedPickerSlot={pendingPickerSlot} />
        )}
        {activeTab === 'consumables' && <ConsumablesScreen onNavigate={onNavigate} />}
        {activeTab === 'workshop' && <WorkshopScreen onNavigate={onNavigate} />}
      </div>
    </div>
  );
};
