import React, { useState } from 'react';
import { Backpack, Box, Hammer, Shield, ShoppingBag } from 'lucide-react';
import { SyncedLoadoutScreen } from './SyncedLoadoutScreen';
import { LootScreen } from './LootScreen';
import { VendorScreen } from './VendorScreen';
import { WorkshopScreen } from './WorkshopScreen';
import { useInventoryStore, useLoadoutStore, usePlayerStore, useWorkshopStore } from '@/store';

type InventoryTab = 'gear' | 'loadout' | 'supply' | 'workshop';

interface InventoryScreenProps {
  onNavigate: (screen: string) => void;
}

const tabs: { id: InventoryTab; label: string; icon: React.ElementType }[] = [
  { id: 'gear', label: 'Gear', icon: Backpack },
  { id: 'loadout', label: 'Loadout', icon: Shield },
  { id: 'supply', label: 'Supply', icon: ShoppingBag },
  { id: 'workshop', label: 'Workshop', icon: Hammer },
];

const SummaryTile: React.FC<{ label: string; value: string | number; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-xl border border-border bg-surface-raised p-2 min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
    <div className="text-base font-black text-text-primary leading-tight truncate">{value}</div>
    {sub && <div className="text-[10px] text-text-muted truncate">{sub}</div>}
  </div>
);

export const InventoryScreen: React.FC<InventoryScreenProps> = ({ onNavigate }) => {
  const [activeTab, setActiveTab] = useState<InventoryTab>('gear');
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const player = usePlayerStore();
  const workshop = useWorkshopStore();

  const equippedCount = Object.values(loadout.slots).filter(Boolean).length;
  const lockedCount = inventory.items.filter((item) => item.isLocked).length;
  const queueCount = workshop.activeQueues.length;

  return (
    <div className="bl-page space-y-4 pb-20">
      <div className="p-4 pb-0 space-y-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Inventory</div>
          <div className="text-xs text-text-muted mt-1">
            Own, equip, supply, craft, repair, and route items from one central hub.
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <SummaryTile label="Items" value={inventory.items.length} sub={`${lockedCount} locked`} />
          <SummaryTile label="Loadout" value={`${equippedCount}/7`} sub="slots filled" />
          <SummaryTile label="Credits" value={player.credits.toLocaleString()} sub={`${player.scrap.toLocaleString()} scrap`} />
          <SummaryTile label="Queues" value={queueCount} sub="workshop" />
        </div>

        <button
          onClick={() => onNavigate('chest')}
          className="w-full rounded-xl border-2 border-amber/40 bg-amber/10 p-3 flex items-center justify-between active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center gap-3 text-left">
            <div className="bl-well w-10 h-10 flex items-center justify-center text-amber">
              <Box size={19} />
            </div>
            <div>
              <div className="text-sm font-black text-text-primary">Data Cache</div>
              <div className="text-[10px] text-text-muted">{player.cacheKeys} keys · {player.cacheKeyFragments}/5 fragments</div>
            </div>
          </div>
          <div className="text-xs font-black text-amber">Open</div>
        </button>

        <div className="grid grid-cols-4 gap-1.5 rounded-xl border border-border bg-surface-raised p-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-lg py-2 flex flex-col items-center gap-1 text-[10px] font-black transition-colors ${
                  active ? 'bg-amber text-bg' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        {activeTab === 'gear' && <LootScreen onNavigate={onNavigate} />}
        {activeTab === 'loadout' && <SyncedLoadoutScreen />}
        {activeTab === 'supply' && <VendorScreen />}
        {activeTab === 'workshop' && <WorkshopScreen onNavigate={onNavigate} />}
      </div>
    </div>
  );
};
