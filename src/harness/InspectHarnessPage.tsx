/**
 * Inspect-sheet harness page (first-screen fix R3 render round,
 * dev only) — the REAL GearInspectSheet open over the REAL screen
 * it was opened from, at phone width, for the owner's full-screen
 * review: Gear context over the Gear tab (InventoryScreen), Market
 * context over the Market tab (MarketScreen), each inside the
 * real ScreenWrapper scroller with the real BottomNav under it.
 *
 * The sheet is mounted with the exact props its production hosts
 * pass:
 *  - Gear (GearHub): contextLabel "Inventory Inspect",
 *    allowReforge, and the shipped four-button action grid
 *    (Equip / Market / Lock / Salvage — markup reproduced from
 *    GearHub; the handlers are inert here).
 *  - Market (MarketScreen): contextLabel "Market Inspect". The
 *    shipped host passes NO actions — the sticky bar is empty and
 *    the listing's price appears nowhere. Behind `layout`, the
 *    harness passes the proposed bar instead: the listing's
 *    price as the hero + Buy Now in the shipped row-button
 *    grammar (the same button ListingRow carries).
 *
 * Driven by URL params:
 *   context  gear | market
 *   layout   trade | split — read into the sheet's render-only
 *            `inspectLayout` seam ('trade-first' | 'poster-split').
 *            Absent the param the sheet is the shipped picture,
 *            element for element (the premise frame).
 *
 * Seeding follows the repo's own tests (gearTradeTape's store
 * seed; the home harness's settle pattern): a legendary Ironwood
 * Sniper in inventory, a Rare SMG equipped as The Trade's
 * baseline, the market store stocked with the comparable
 * listings, and Chef reads answered offline by inspectMain's
 * fetch backstop (the Market browse page is the seed module's
 * page, so the dimmed rows behind the sheet and the intel tape
 * agree). Auth resolves through the harness stub
 * (vite.inspect.config.ts). Nothing here is imported by the app
 * bundle; inspect-harness.html is served by the Vite dev server
 * only.
 */
import React from 'react';
import { ArrowLeftRight, Lock, Trash2 } from 'lucide-react';
import { InventoryScreen } from '@/screens/InventoryScreen';
import { MarketScreen } from '@/screens/MarketScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { GearInspectSheet, type InspectLayout } from '@/components/gear/GearInspectSheet';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  useMarketStore,
  usePlayerStore,
  useSkillStore,
} from '@/store';
import {
  EQUIPPED,
  FILLER,
  LEGENDARY,
  STORE_LISTINGS,
  TARGET_PRICE,
  TARGET_SELLER,
} from './inspectSeed';

const params = new URLSearchParams(window.location.search);
const context = params.get('context') === 'market' ? 'market' : 'gear';
const layoutParam = params.get('layout');
const inspectLayout: InspectLayout | undefined =
  layoutParam === 'trade' ? 'trade-first' : layoutParam === 'split' ? 'poster-split' : undefined;

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

/**
 * The proposed Market bar: the listing's own price as the hero
 * (it appears nowhere in the shipped sheet) + Buy Now, in the
 * shipped ListingRow button grammar, riding the sheet's existing
 * sticky actions slot.
 */
const marketActions = (
  <div className="flex items-center gap-3">
    <div className="min-w-0 flex-1">
      <div className="text-[11px] font-black uppercase tracking-wide text-text-muted">Listing price</div>
      <div className="mt-0.5 text-xl font-black leading-none text-amber">{TARGET_PRICE.toLocaleString()} cr</div>
      <div className="mt-1 truncate text-[11px] text-text-muted">{TARGET_SELLER}</div>
    </div>
    <button type="button" className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-amber px-4 text-[13px] font-black text-bg">
      Buy Now
    </button>
  </div>
);

export const InspectHarnessPage: React.FC = () => (
  <div
    style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0B10' }}
    data-testid="inspect-harness-root"
  >
    <ScreenWrapper hidden={false}>
      {context === 'market' ? (
        <MarketScreen onNavigate={() => {}} />
      ) : (
        <InventoryScreen onNavigate={() => {}} />
      )}
    </ScreenWrapper>
    <BottomNav activeTab={context} onChange={() => {}} />
    {context === 'market' ? (
      <GearInspectSheet
        item={LEGENDARY}
        open
        onClose={() => {}}
        contextLabel="Market Inspect"
        inspectLayout={inspectLayout}
        actions={inspectLayout ? marketActions : undefined}
      />
    ) : (
      <GearInspectSheet
        item={LEGENDARY}
        open
        onClose={() => {}}
        contextLabel="Inventory Inspect"
        allowReforge
        inspectLayout={inspectLayout}
        actions={gearActions}
      />
    )}
  </div>
);
