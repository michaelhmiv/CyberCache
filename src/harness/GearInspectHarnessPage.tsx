/**
 * Gear inspect harness page (store-screenshots round,
 * dash/store-shots — dev only) — the REAL GearInspectSheet open
 * over the REAL Gear tab (InventoryScreen) at phone width, for
 * the App Store screenshot set: the sheet mounted with the exact
 * props its production host (GearHub) passes — contextLabel
 * "Inventory Inspect", allowReforge, and the shipped four-button
 * action grid (Equip / Market / Lock / Salvage, handlers inert).
 * Ported from the inspect round's harness (dash/inspect-render)
 * minus that round's render-variant seam, which did not ship.
 *
 * The seed is the inspect round's deterministic set: a legendary
 * Ironwood Sniper (Ricochet Gospel Prime, carrying its pinned
 * legendary effect) in inventory, a Rare Sniper equipped as the
 * trade baseline, filler gear behind it, and the market store
 * stocked with the comparable listings the sheet's intel tape
 * reads. Auth resolves through the harness stub
 * (vite.shots.config.ts); Chef reads are answered offline by
 * gearMain's fetch backstop. Nothing here is imported by the
 * app bundle; gear-harness.html is served by the Vite dev
 * server only.
 */
import React from 'react';
import { ArrowLeftRight, Lock, Trash2 } from 'lucide-react';
import { InventoryScreen } from '@/screens/InventoryScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { GearInspectSheet } from '@/components/gear/GearInspectSheet';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  useMarketStore,
  usePlayerStore,
  useSkillStore,
} from '@/store';
import { EQUIPPED, FILLER, LEGENDARY, STORE_LISTINGS } from './inspectSeed';

function seedStores() {
  usePlayerStore.setState({
    id: 'p1',
    level: 24,
    xp: 41200,
    credits: 128400,
    scrap: 56200,
    cacheKeys: 5,
    materials: {},
    essences: {},
    consumables: {},
    profileLoaded: true,
  } as never);
  useInventoryStore.setState({
    items: [LEGENDARY, EQUIPPED, ...FILLER],
  } as never);
  useLoadoutStore.setState({
    slots: {
      primary: EQUIPPED.id,
      secondary: null,
      heavy: null,
      ordnance: null,
      shield: null,
      classMod: null,
      relic: null,
      vehicle: null,
    },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  } as never);
  useSkillStore.setState({
    spent: {},
    activeHunterId: 'vesper',
  } as never);
  useBossStore.setState({ currentBossId: null } as never);
  useMarketStore.setState({
    listings: STORE_LISTINGS,
    history: [
      { id: 'hist-1', type: 'buy', itemId: 'hist-item-1', itemName: 'Ricochet Gospel', itemRarity: 'Legendary', price: 51200, fee: 2560, otherPartyId: 'seller-hist-1', timestamp: Date.now() - 86_400_000 },
      { id: 'hist-2', type: 'sell', itemId: 'hist-item-2', itemName: 'Glass Sun', itemRarity: 'Legendary', price: 66400, fee: 3320, otherPartyId: 'seller-hist-2', timestamp: Date.now() - 172_800_000 },
      { id: 'hist-3', type: 'buy', itemId: 'hist-item-3', itemName: 'Debt Collector', itemRarity: 'Legendary', price: 44900, fee: 2245, otherPartyId: 'seller-hist-3', timestamp: Date.now() - 259_200_000 },
    ],
  } as never);
}

seedStores();

/** The shipped GearHub action grid, reproduced (handlers inert). */
const gearActions = (
  <div className="grid grid-cols-4 gap-2">
    <button type="button" className="flex flex-col items-center gap-1 border border-amber/40 bg-amber/10 py-2 text-[11px] font-black text-amber">
      <PxIcon name="crosshair" size={13} />Equip
    </button>
    <button type="button" className="flex flex-col items-center gap-1 border border-green/40 bg-green/10 py-2 text-[11px] font-black text-green">
      <ArrowLeftRight size={15} />Market
    </button>
    <button type="button" className="flex flex-col items-center gap-1 border border-border bg-surface py-2 text-[11px] font-black text-text-secondary">
      <Lock size={15} />Lock
    </button>
    <button type="button" className="flex flex-col items-center gap-1 border border-red/40 bg-red/10 py-2 text-[11px] font-black text-red">
      <Trash2 size={15} />Salvage
    </button>
  </div>
);

export const GearInspectHarnessPage: React.FC = () => (
  <div
    style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0B10' }}
    data-testid="gear-inspect-harness-root"
  >
    <ScreenWrapper hidden={false}>
      <InventoryScreen onNavigate={() => {}} />
    </ScreenWrapper>
    <BottomNav activeTab="gear" onChange={() => {}} />
    <GearInspectSheet
      item={LEGENDARY}
      open
      onClose={() => {}}
      contextLabel="Inventory Inspect"
      allowReforge
      actions={gearActions}
    />
  </div>
);
