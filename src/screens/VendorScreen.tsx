import React, { useMemo } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { Search, X, ArrowUpDown } from 'lucide-react';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import { CONSUMABLES, VENDOR_CONSUMABLES } from '@/constants/consumables';
import { FAMILY_COLORS, FAMILY_LABELS, TRIGGER_LABELS } from '@/lib/consumables/families';
import { MobileCard } from '@/components/layout/MobileCard';
import { ChipRail } from '@/components/common/ChipRail';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { useFilterSort } from '@/lib/hooks/useFilterSort';
import { useNow } from '@/hooks/useNow';
import type { ConsumableDef } from '@/types/consumables';
import type { GearItem } from '@/types/items';
import { chipClip } from '@/lib/ui/clips';
import { gearCategoryFromPayload } from '@/lib/market/identityKey';
import {
  VENDOR_BUYBACK_RATE_DEFAULT,
  VENDOR_MATERIALS,
  computeItemEstimatedValue,
  consumableUnitVendorValue,
  vendorBuybackPayout,
  vendorDateKey,
  vendorRotationForDate,
  vendorStockForDate,
  type VendorOffer,
} from '@/lib/vendor/catalog';

/**
 * The Vendor stop (Market rail). One storefront, no mode toggle:
 * the stock view is the stop, and buyback is a named dashed ROW on
 * its first viewport (DESIGN.md §3/§11 F2 — still 3 taps, the one
 * justified depth). Manufacturer standing is NOT here: the Rep Desk
 * is its own Market rail stop.
 *
 * Every action button on this stop shares ONE rectangular geometry
 * (vendorCtaCls): active/primary state is fill and color only —
 * never the skewed-parallelogram clip, whose slanted tip broke the
 * cards' right edges and made sibling controls read as misaligned
 * (parent alignment audit, Market Vendor).
 */
const vendorCtaCls = 'border-2 border-black bg-amber text-bg shadow-[4px_4px_0_rgba(0,0,0,0.72)]';

export const VendorScreen: React.FC = () => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<'buy' | 'sell'>('buy');

  // Rotation + Item of the Day derive from the ONE vendor catalog by
  // UTC date — the same stock the server charges for today.
  const now = useNow();
  const todayKey = vendorDateKey(new Date(now));
  const stock = useMemo(() => vendorStockForDate(todayKey), [todayKey]);
  const rotation = useMemo(() => vendorRotationForDate(todayKey), [todayKey]);
  const offerByKey = useMemo(() => new Map(stock.map((o) => [o.itemKey, o])), [stock]);
  const itemOfTheDayDef = CONSUMABLES[rotation.itemOfTheDay as keyof typeof CONSUMABLES];
  const itemOfTheDayOffer = offerByKey.get(rotation.itemOfTheDay);

  const familyCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    VENDOR_CONSUMABLES.forEach((c) => {
      counts[c.family] = (counts[c.family] || 0) + 1;
    });
    return counts;
  }, []);

  const sortOptions = useMemo(
    () => [
      { key: 'price', label: 'Cheapest First', compare: (a: ConsumableDef, b: ConsumableDef) => a.basePrice - b.basePrice },
      {
        key: 'owned',
        label: 'Most Owned',
        compare: (a: ConsumableDef, b: ConsumableDef) => player.getConsumableCount(b.id) - player.getConsumableCount(a.id),
      },
      { key: 'name', label: 'Name A-Z', compare: (a: ConsumableDef, b: ConsumableDef) => a.name.localeCompare(b.name) },
    ],
    [player],
  );

  const { filtered, search, setSearch, activeFacets, toggleFacet, clearFacets, sortKey, setSortKey, hasActiveFilters } = useFilterSort({
    items: VENDOR_CONSUMABLES,
    searchFields: [(c) => c.name, (c) => c.shortDescription, (c) => c.tacticalRole],
    facets: [
      {
        key: 'family',
        label: 'Family',
        values: () => Object.keys(FAMILY_LABELS).filter((family) => (familyCounts[family] ?? 0) > 0),
        matches: (item, value) => item.family === value,
      },
    ],
    sorts: sortOptions,
    defaultSortKey: 'price',
  });

  const handleBuy = async (offer: VendorOffer, name: string) => {
    if (player.credits < offer.unitPrice) {
      setNotice('Not enough credits.');
      return;
    }
    setBusyId(`buy:${offer.itemKey}`);
    setNotice(null);
    try {
      await verifiedOps.vendorBuy(offer.itemKey, 1);
      setNotice(`${name} added to inventory.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Purchase failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleSell = async (busyKey: string, run: () => Promise<Record<string, unknown>>, label: string) => {
    setBusyId(busyKey);
    setNotice(null);
    try {
      const result = await run();
      const payout = typeof result.total_payout === 'number' ? result.total_payout : 0;
      setNotice(`Sold ${label} for ${payout.toLocaleString()}cr.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Sale failed.');
    } finally {
      setBusyId(null);
    }
  };

  const activeFamilies = activeFacets.family ?? new Set<string>();

  const equippedIds = useMemo(
    () => new Set(Object.values(loadout.slots).filter((id): id is string => Boolean(id))),
    [loadout.slots],
  );

  const sellableGear = useMemo(
    () =>
      inventory.items
        .filter((item) => !item.isLocked && !equippedIds.has(item.id))
        .map((item) => ({ item, value: gearValuePreview(item) }))
        .sort((a, b) => b.value - a.value),
    [inventory.items, equippedIds],
  );

  const sellableBatches = useMemo(
    () =>
      player.consumableBatches.filter(
        (batch) => batch.quantity > 0 && consumableUnitVendorValue(batch.consumable_type, batch.quality_percent) !== null,
      ),
    [player.consumableBatches],
  );

  const sellableMaterials = useMemo(
    () =>
      VENDOR_MATERIALS.map((entry) => ({
        entry,
        owned: entry.kind === 'material' ? (player.materials[entry.id] ?? 0) : (player.essences[entry.id] ?? 0),
      })).filter((row) => row.owned > 0),
    [player.materials, player.essences],
  );

  const consumableCard = (c: ConsumableDef, offer: VendorOffer | undefined) => {
    const owned = player.getConsumableCount(c.id);
    const price = offer?.unitPrice ?? c.basePrice;
    const buying = busyId === `buy:${c.id}`;
    return (
      // Compact storefront row (drift-fix F3, mock m40): the def's
      // own pixel icon in the well (the 3-letter family abbrev is
      // replaced by the full family label as the first chip — more
      // legible, same datum), name/role/description/chips in the
      // middle, Owned over a SMALL Buy in the right column. The
      // full-width Buy band is gone; the handler, price and
      // disabled rule are unchanged.
      <MobileCard key={c.id}>
        <div className="flex items-start gap-2.5">
          <div className="bl-well flex h-10 w-10 shrink-0 items-center justify-center">
            <PxIcon name={c.visual.icon} size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className={`text-xs font-bold leading-snug ${offer?.itemOfTheDay ? 'text-amber' : 'text-text-primary'}`}>{c.name}</span>
              {offer?.itemOfTheDay && (
                <span className="rounded border border-amber bg-amber/20 px-1.5 py-0.5 text-[11px] font-black text-amber">ITEM OF THE DAY −25%</span>
              )}
            </div>
            <div className="text-[11px] text-amber">{c.tacticalRole}</div>
            <div className="text-[11px] leading-snug text-text-muted">{c.shortDescription}</div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className={`rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] font-bold ${FAMILY_COLORS[c.family]}`}>{FAMILY_LABELS[c.family]}</span>
              <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] text-text-muted">{TRIGGER_LABELS[c.trigger]}</span>
              {c.counterTags.map((tag) => (
                <span key={tag} className="rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 text-[11px] font-bold text-amber">{tag}</span>
              ))}
            </div>
          </div>
          <div className="flex w-[92px] shrink-0 flex-col items-end gap-1.5">
            <div className="text-right">
              <div className="text-[11px] text-text-muted">Owned</div>
              <div className="text-sm font-black leading-none text-text-primary">{owned}</div>
            </div>
            <button
              onClick={() => offer && handleBuy(offer, c.name)}
              disabled={!offer || player.credits < price || Boolean(busyId)}
              className={`w-full px-2 py-2 text-[11px] font-black disabled:opacity-40 ${vendorCtaCls}`}
            >
              {buying ? 'Buying…' : `Buy 1 • ${price.toLocaleString()}cr`}
            </button>
          </div>
        </div>
      </MobileCard>
    );
  };

  const materialRow = (offer: VendorOffer) => {
    const entry = VENDOR_MATERIALS.find((m) => m.id === offer.itemKey);
    if (!entry) return null;
    const owned = entry.kind === 'material' ? (player.materials[entry.id] ?? 0) : (player.essences[entry.id] ?? 0);
    const buying = busyId === `buy:${entry.id}`;
    return (
      // Compact row, same anatomy as the consumable rows (F3):
      // name/kind/note in the middle, Owned over a small Buy.
      <MobileCard key={entry.id}>
        <div className="flex items-start gap-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold leading-snug text-text-primary">{entry.name}</div>
            <div className="text-[11px] text-amber">{entry.kind === 'material' ? 'Material' : 'Essence'}</div>
            <div className="text-[11px] text-text-muted">Rotating stock — back tomorrow, maybe.</div>
          </div>
          <div className="flex w-[92px] shrink-0 flex-col items-end gap-1.5">
            <div className="text-right">
              <div className="text-[11px] text-text-muted">Owned</div>
              <div className="text-sm font-black leading-none text-text-primary">{owned}</div>
            </div>
            <button
              onClick={() => handleBuy(offer, entry.name)}
              disabled={player.credits < offer.unitPrice || Boolean(busyId)}
              className={`w-full px-2 py-2 text-[11px] font-black disabled:opacity-40 ${vendorCtaCls}`}
            >
              {buying ? 'Buying…' : `Buy 1 • ${offer.unitPrice.toLocaleString()}cr`}
            </button>
          </div>
        </div>
      </MobileCard>
    );
  };

  return (
    <div className="space-y-3">
      {/* Compact storefront head (drift-fix F3, mock m40): the
          giant 30px headline retires — the title sits at the app's
          17px rail-headline size and the sub is the mock's one
          line. The stock starts one headline-height higher; no
          datum is lost (the old sub's Workshop pointer survives in
          the shorter line). */}
      <div>
        <div className="bl-title text-[17px] leading-none text-text-primary">Consumable Vendor</div>
        <div className="text-[11px] text-text-muted">Boss-prep staples · crafted goods live in the Workshop</div>
      </div>

      {notice && <div className="text-xs text-text-secondary">{notice}</div>}

      {mode === 'buy' && (
        <>
          {/* Buyback (DESIGN.md §3 / §11 F2): a named dashed ROW on
              this stop's first viewport — not a segment of a toggle.
              It opens the sell-to-vendor view below; depth stays the
              justified 3 taps (Market tab → Vendor stop → row). */}
          <button
            type="button"
            onClick={() => setMode('sell')}
            className="flex w-full items-center justify-between gap-3 border-2 border-dashed border-amber/60 bg-amber/5 px-3 py-2.5 text-left transition-colors hover:bg-amber/10"
          >
            <span className="min-w-0">
              <span className="block text-xs font-black text-text-primary">Sell to Vendor — Buyback</span>
              <span className="block text-[11px] text-text-muted">
                The vendor buys back gear, consumables, materials and essences at {Math.round(VENDOR_BUYBACK_RATE_DEFAULT * 100)}% of value.
              </span>
            </span>
            <PxIcon name="chevR" size={17} className="shrink-0 text-amber" />
          </button>

          {/* F3: the Item of the Day keeps its own card directly
              under the buyback row; its label row is folded into
              the card (amber name + ITEM OF THE DAY −25% chip on
              the card's face — same datum, one row higher). */}
          {itemOfTheDayDef && itemOfTheDayOffer && consumableCard(itemOfTheDayDef, itemOfTheDayOffer)}

          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <div className="text-[11px] font-black uppercase text-text-secondary">Today&apos;s Rotation</div>
              <div className="text-[11px] text-text-muted">New stock at 00:00 UTC</div>
            </div>
            {rotation.consumables.map((id) => {
              const def = CONSUMABLES[id as keyof typeof CONSUMABLES];
              return def ? consumableCard(def, offerByKey.get(id)) : null;
            })}
            {rotation.materials.map((id) => {
              const offer = offerByKey.get(id);
              return offer ? materialRow(offer) : null;
            })}
          </div>

          <div className="text-[11px] font-black uppercase text-text-secondary">Staples — always in stock</div>

          <ChipRail>
            {(Object.keys(FAMILY_LABELS) as Array<keyof typeof FAMILY_LABELS>)
              .filter((family) => (familyCounts[family] ?? 0) > 0)
              .map((family) => {
                const label = `${FAMILY_LABELS[family]} (${familyCounts[family]})`;
                const active = activeFamilies.has(family);
                return (
                  <button
                    key={family}
                    type="button"
                    onClick={() => toggleFacet('family', family)}
                    className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-black border transition-colors ${
                      active ? 'border-amber bg-amber/15' : 'border-border bg-surface opacity-70 hover:opacity-100'
                    } ${FAMILY_COLORS[family]}`}
                    style={chipClip}
                  >
                    {label}
                  </button>
                );
              })}
          </ChipRail>

          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search vendor…"
                className="w-full h-9 pl-8 pr-8 rounded-lg border border-border bg-surface-raised text-xs text-text-primary placeholder:text-text-muted"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <ArrowUpDown size={13} className="text-text-muted" />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                className="text-[11px] font-black uppercase border border-border bg-surface rounded-lg px-2 py-1.5 text-text-primary"
              >
                {sortOptions.map((opt) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
            {hasActiveFilters && (
              <button type="button" onClick={clearFacets} className="text-[11px] font-black text-red hover:text-red/80 shrink-0">
                Clear
              </button>
            )}
          </div>

          <div className="space-y-2">
            {filtered.length === 0 ? (
              <div className="py-8 text-center text-xs text-text-muted">
                {hasActiveFilters ? 'No vendor items match your search or filter.' : 'No vendor items available.'}
              </div>
            ) : filtered.map((c) => consumableCard(c, offerByKey.get(c.id)))}
          </div>
        </>
      )}

      {mode === 'sell' && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setMode('buy')}
            className="flex items-center gap-2 border border-border bg-surface px-3 py-2 text-xs font-black text-text-secondary transition-colors hover:text-text-primary"
          >
            <PxIcon name="vendor" size={17} /> Back to Vendor stock
          </button>
          <div className="text-[11px] text-text-muted">
            The vendor pays {Math.round(VENDOR_BUYBACK_RATE_DEFAULT * 100)}% of vendor value at the standard rate.
            Equipped and locked gear can&apos;t be sold. The confirmed payout is shown after each sale.
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-black uppercase text-text-secondary">Gear</div>
            {sellableGear.length === 0 ? (
              <div className="py-4 text-center text-xs text-text-muted">No sellable gear — equipped and locked items stay with you.</div>
            ) : sellableGear.map(({ item, value }) => {
              const payout = vendorBuybackPayout(value, VENDOR_BUYBACK_RATE_DEFAULT);
              const selling = busyId === `sell:gear:${item.id}`;
              return (
                <MobileCard key={item.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold leading-snug text-text-primary">{item.name}</div>
                    <div className="text-[11px] text-text-muted">{item.rarity} • Lv {item.level} • value {value.toLocaleString()}cr</div>
                  </div>
                  <button
                    onClick={() => handleSell(`sell:gear:${item.id}`, () => verifiedOps.vendorSellGear(item.id), item.name)}
                    disabled={Boolean(busyId)}
                    className={`shrink-0 px-3 py-2 text-xs font-black disabled:opacity-40 ${vendorCtaCls}`}
                  >
                    {selling ? 'Selling…' : `Sell • ~${payout.toLocaleString()}cr`}
                  </button>
                </MobileCard>
              );
            })}
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-black uppercase text-text-secondary">Consumables</div>
            {sellableBatches.length === 0 ? (
              <div className="py-4 text-center text-xs text-text-muted">No consumable stacks to sell.</div>
            ) : sellableBatches.map((batch) => {
              const unitValue = consumableUnitVendorValue(batch.consumable_type, batch.quality_percent) ?? 0;
              const name = CONSUMABLES[batch.consumable_type as keyof typeof CONSUMABLES]?.name ?? batch.consumable_type;
              const payoutOne = vendorBuybackPayout(unitValue, VENDOR_BUYBACK_RATE_DEFAULT);
              const payoutAll = vendorBuybackPayout(unitValue * batch.quantity, VENDOR_BUYBACK_RATE_DEFAULT);
              const selling = busyId?.startsWith(`sell:batch:${batch.id}`);
              return (
                <MobileCard key={batch.id} className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold leading-snug text-text-primary">{name}</div>
                      <div className="text-[11px] text-text-muted">Quality {batch.quality_percent}% • unit value {Math.round(unitValue).toLocaleString()}cr</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-text-muted">Owned</div>
                      <div className="text-sm font-black text-text-primary">{batch.quantity}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSell(`sell:batch:${batch.id}:1`, () => verifiedOps.vendorSellConsumable(batch.id, 1), `${name} ×1`)}
                      disabled={Boolean(busyId)}
                      className={`flex-1 py-2 text-xs font-black disabled:opacity-40 ${vendorCtaCls}`}
                    >
                      {selling ? 'Selling…' : `Sell 1 • ~${payoutOne.toLocaleString()}cr`}
                    </button>
                    <button
                      onClick={() => handleSell(`sell:batch:${batch.id}:all`, () => verifiedOps.vendorSellConsumable(batch.id, batch.quantity), `${name} ×${batch.quantity}`)}
                      disabled={Boolean(busyId)}
                      className={`flex-1 py-2 text-xs font-black disabled:opacity-40 ${vendorCtaCls}`}
                    >
                      {selling ? 'Selling…' : `Sell all • ~${payoutAll.toLocaleString()}cr`}
                    </button>
                  </div>
                </MobileCard>
              );
            })}
          </div>

          <div className="space-y-2">
            <div className="text-[11px] font-black uppercase text-text-secondary">Materials & Essences</div>
            {sellableMaterials.length === 0 ? (
              <div className="py-4 text-center text-xs text-text-muted">No materials or essences to sell.</div>
            ) : sellableMaterials.map(({ entry, owned }) => {
              const payoutOne = vendorBuybackPayout(entry.unitPrice, VENDOR_BUYBACK_RATE_DEFAULT);
              const payoutAll = vendorBuybackPayout(entry.unitPrice * owned, VENDOR_BUYBACK_RATE_DEFAULT);
              const selling = busyId?.startsWith(`sell:mat:${entry.id}`);
              return (
                <MobileCard key={entry.id} className="space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-bold leading-snug text-text-primary">{entry.name}</div>
                      <div className="text-[11px] text-text-muted">{entry.kind === 'material' ? 'Material' : 'Essence'} • unit value {entry.unitPrice.toLocaleString()}cr</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[11px] text-text-muted">Owned</div>
                      <div className="text-sm font-black text-text-primary">{owned}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSell(`sell:mat:${entry.id}:1`, () => verifiedOps.vendorSellMaterial(entry.id, 1), `${entry.name} ×1`)}
                      disabled={Boolean(busyId)}
                      className={`flex-1 py-2 text-xs font-black disabled:opacity-40 ${vendorCtaCls}`}
                    >
                      {selling ? 'Selling…' : `Sell 1 • ~${payoutOne.toLocaleString()}cr`}
                    </button>
                    <button
                      onClick={() => handleSell(`sell:mat:${entry.id}:all`, () => verifiedOps.vendorSellMaterial(entry.id, owned), `${entry.name} ×${owned}`)}
                      disabled={Boolean(busyId)}
                      className={`flex-1 py-2 text-xs font-black disabled:opacity-40 ${vendorCtaCls}`}
                    >
                      {selling ? 'Selling…' : `Sell all • ~${payoutAll.toLocaleString()}cr`}
                    </button>
                  </div>
                </MobileCard>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
};

function gearValuePreview(item: GearItem): number {
  const payload = item as unknown as Record<string, unknown>;
  return computeItemEstimatedValue(payload, gearCategoryFromPayload(payload), item.rarity, item.level);
}
