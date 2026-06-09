import React, { useState } from 'react';
import { Backpack, Box, Hammer, Shield, ShoppingBag } from 'lucide-react';
import { SyncedLoadoutScreen } from './SyncedLoadoutScreen';
import { GearYardScreen } from './GearYardScreen';
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
  { id: 'workshop', label: 'Bench', icon: Hammer },
];

const SummaryTile: React.FC<{ label: string; value: string | number; sub?: string }> = ({ label, value, sub }) => (
  <div className="bl-card min-w-0 p-2">
    <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">{label}</div>
    <div className="truncate text-lg font-black leading-tight text-text-primary">{value}</div>
    {sub && <div className="truncate text-[9px] text-text-muted">{sub}</div>}
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
      <div className="space-y-3 p-4 pb-0">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="bl-title text-3xl leading-none text-text-primary">Gear Yard</div>
            <div className="text-xs text-text-muted mt-1">
              Backpack, loadout bench, vendor supply, and workbench access.
            </div>
          </div>
          <div className="bl-icon-plate flex h-12 w-12 shrink-0 -rotate-2 items-center justify-center text-amber">
            <Backpack size={22} />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2">
          <SummaryTile label="Items" value={inventory.items.length} sub={`${lockedCount} locked`} />
          <SummaryTile label="Rig" value={`${equippedCount}/7`} sub="slots filled" />
          <SummaryTile label="Cash" value={player.credits.toLocaleString()} sub={`${player.scrap.toLocaleString()} scrap`} />
          <SummaryTile label="Jobs" value={queueCount} sub="bench" />
        </div>

        <button
          onClick={() => onNavigate('chest')}
          className="bl-card flex w-full items-center justify-between p-3 text-left active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center gap-3 text-left">
            <div className="bl-icon-plate flex h-10 w-10 items-center justify-center text-amber">
              <Box size={19} />
            </div>
            <div>
              <div className="text-sm font-black text-text-primary">Crack Data Cache</div>
              <div className="text-[10px] text-text-muted">{player.cacheKeys} keys · {player.cacheKeyFragments}/5 fragments</div>
            </div>
          </div>
          <div className="bl-primary px-3 py-1 text-xs font-black">Open</div>
        </button>

        <div className="bl-tab-strip grid grid-cols-4 gap-1.5 p-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col items-center gap-1 py-2 text-[10px] font-black transition-colors ${
                  active ? 'bl-primary' : 'bl-secondary text-text-muted'
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
        {activeTab === 'gear' && <GearYardScreen onNavigate={onNavigate} />}
        {activeTab === 'loadout' && <SyncedLoadoutScreen />}
        {activeTab === 'supply' && <VendorScreen />}
        {activeTab === 'workshop' && <WorkshopScreen onNavigate={onNavigate} />}
      </div>
    </div>
  );
};
