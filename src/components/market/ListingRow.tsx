/**
 * ListingRow — the Market's true-list row (owner addition
 * 2026-11-04: the Gear compact list treatment applies to the Market
 * Buy/Sell lists too). ONE line per listing on a 46px row, built on
 * the Gear list row's anatomy (PR #385, DESIGN.md §3): rarity spine,
 * thumb with the element corner badge, level column, rarity-colored
 * name — with three substitutions the market context argues for,
 * each stated in the slice PR:
 *
 *  1. PRICE IS THE HERO. The right-hand headline slot carries the
 *     listing price (priceRowHeadline — the gearRowHeadline
 *     variant), because on a listing the number a scanner compares
 *     across rows is what it costs. The item's own stat headline
 *     (gearRowHeadline) leads the fact line instead, so two similar
 *     guns still compare at a glance.
 *  2. A FACT LINE rides under the name. A listing is not an owned
 *     item: the counterparty and the freshness are decision facts
 *     an inventory row doesn't carry. Seller (a hunter name, §1 —
 *     never an id) and listing age print at the 11px floor, with
 *     the recent-sales median as the price anchor when real sales
 *     exist. Listings never expire in the data model (listedAt is
 *     the only timestamp), so the honest time fact is AGE — there
 *     is no ends-at to print. The sparkline drawing leaves the row
 *     face (a 48px chart cannot survive a 46px line); its data —
 *     median + 7d trend — stays as text.
 *  3. NO GEAR-ROW SEMANTICS. No equipped chip, no lock glyph, no
 *     compare block, no stat pills: the full poster, The Trade and
 *     Market Intelligence live one tap away in the inspect sheet
 *     (detail behind inspect). The lane's own actions (Buy with
 *     its G3 shortfall/lock treatments, Cancel Listing) ride the
 *     row's right edge, composed by the parent as `action`.
 *
 * Freeze discipline, same as the Gear row: weapons compose at
 * STAGE density here, never card density.
 */
import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { ElementBadge } from '@/components/gear/ElementBadge';
import { PixelConsumable } from '@/components/pixelArt/PixelConsumable';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { VehicleSprite } from '@/components/gear/GaragePanel';
import { listEntranceProps } from '@/lib/animation/uiMotion';
import { gearRowHeadline, priceRowHeadline } from '@/lib/gear/gearCardSummary';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import { skinPartCatalog, skinSetById } from '@/content/skins';
import { conditionFraction, getVehicleClass } from '@/lib/vehicles/vehicles';
import { RARITIES } from '@/constants/rarities';
import type { PriceStats } from '@/lib/market/priceStats';
import type { GearItem } from '@/types/items';
import type { Listing } from '@/types/market';
import type { VehicleDisplay } from '@/store/slices/vehicleSlice';

function rarityColor(rarity: string | null | undefined): string {
  if (!rarity) return '#9CA3AF';
  return (RARITIES as Record<string, { color: string }>)[rarity]?.color ?? '#9CA3AF';
}

function hasRarity(rarity: string | null | undefined): boolean {
  return !!rarity && rarity in RARITIES;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

/** Compact listing age — the only time fact a listing carries. */
export function listingAgeLabel(listedAt: number, now: number): string {
  const s = Math.max(0, Math.floor((now - listedAt) / 1000));
  if (s < 60) return 'now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return `${Math.floor(d / 7)}w`;
}

function itemElement(item: GearItem): string | null {
  return 'element' in item && typeof item.element === 'string' ? item.element : null;
}

// ── Thumbs (one well geometry: w-12, art at thumb scale) ────────────

function GearThumb({ item, element }: { item: GearItem; element?: string | null }) {
  return (
    <div className="relative flex w-12 shrink-0 items-center justify-center">
      <GearIllustration item={item} size={46} weaponDensity="stage" showBadges={false} />
      <ElementBadge element={element ?? itemElement(item)} />
    </div>
  );
}

function VehicleThumb({ vehicle }: { vehicle: VehicleDisplay }) {
  return (
    <div className="flex w-12 shrink-0 items-center justify-center">
      <VehicleSprite vehicle={vehicle} widthClass="w-[46px]" />
    </div>
  );
}

function CosmeticThumb({ listing }: { listing: Listing }) {
  const def = listing.partId ? skinPartCatalog(listing.partId) : undefined;
  const look = useMemo(() => {
    if (!def) return null;
    return resolveLookView({
      playerId: '',
      username: null,
      headVariant: 'visor',
      parts: {
        [def.slot]: {
          partId: def.id,
          tintPaletteId: listing.tintPaletteId ?? null,
          quality: listing.qualityPercent ?? 50,
        },
      },
    });
  }, [def, listing.tintPaletteId, listing.qualityPercent]);
  return (
    <div className="flex w-12 shrink-0 items-center justify-center">
      {look ? (
        <div className="w-10 overflow-hidden border border-border bg-bg">
          <HunterPortrait look={look} className="h-[44px]" />
        </div>
      ) : (
        <div className="grid h-[44px] w-10 place-items-center border border-border bg-bg text-[11px] text-text-muted">?</div>
      )}
    </div>
  );
}

function StackThumb({ listing }: { listing: Listing }) {
  // Same art derivation as the Sell lane's StackMiniCard: materials
  // and essences draw their STUFF object, consumables their formed
  // sprite, fragment/core kinds their §7 sheet glyph.
  const stuffId = listing.kind === 'material' ? listing.materialId
    : listing.kind === 'essence' ? listing.essenceId
    : null;
  const icon: PxIconName = listing.kind === 'fragment' ? 'frag'
    : listing.kind === 'core' ? 'core'
    : listing.kind === 'essence' ? 'gem'
    : 'pack';
  return (
    <div className="flex w-12 shrink-0 items-center justify-center">
      {stuffId ? <PixelMaterial id={stuffId} size={26} /> : listing.kind === 'consumable' && listing.consumableType ? <PixelConsumable type={listing.consumableType} size={26} /> : <PxIcon name={icon} size={26} />}
    </div>
  );
}

// ── Fact line ────────────────────────────────────────────────────────

/** Median + 7d trend as text — the sparkline's data, at line size. */
function MedianSegment({ stats, perUnit }: { stats?: PriceStats; perUnit?: boolean }) {
  if (!stats || stats.medianUnitPrice === null) return null;
  const arrow = stats.trend === 'up' ? '▲' : stats.trend === 'down' ? '▼' : stats.trend === 'flat' ? '→' : '';
  const tone = stats.trend === 'up' ? 'text-green-400' : stats.trend === 'down' ? 'text-red-400' : 'text-text-muted';
  return (
    <span>
      med {fmt(stats.medianUnitPrice)}cr{perUnit ? ' ea' : ''}
      {arrow && stats.trendPct !== null && (
        <span className={tone}> {arrow} {Math.abs(Math.round(stats.trendPct * 100))}%</span>
      )}
    </span>
  );
}

function FactLine({ segments }: { segments: React.ReactNode[] }) {
  const parts = segments.filter((s) => s !== null && s !== undefined && s !== false && s !== '');
  if (parts.length === 0) return null;
  return (
    <div className="truncate text-[11px] leading-tight text-text-muted">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden> · </span>}
          {part}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── The listing row (Buy + Mine) ─────────────────────────────────────

export interface ListingRowProps {
  listing: Listing;
  index: number;
  reduceMotion: boolean | null;
  /** Render-time clock snapshot (the parent's render pass). */
  now: number;
  /** Buy lane: the seller's hunter name (sellerDisplayName). */
  sellerName?: string;
  /** Real-sales stats for the listing's identity key, when known. */
  stats?: PriceStats;
  /** Mine lane: the net-proceeds line ("You receive … after the … fee"). */
  netLine?: string;
  /** Gear listings: tap the identity to open the inspect sheet. */
  onInspect?: () => void;
  /** Material listings: the "Used in" door (MaterialUsageSheet). */
  onShowUsage?: (materialId: string) => void;
  /** The lane's action (Buy / Cancel), composed by the parent. */
  action?: React.ReactNode;
}

export const ListingRow: React.FC<ListingRowProps> = ({
  listing, index, reduceMotion, now, sellerName, stats, netLine, onInspect, onShowUsage, action,
}) => {
  const item = listing.itemSnapshot;
  const vehicle = listing.vehicleSnapshot;
  const color = rarityColor(listing.rarity ?? item?.rarity ?? vehicle?.rarity);
  const spine = hasRarity(listing.rarity ?? item?.rarity ?? vehicle?.rarity) ? color : undefined;

  const name = item?.name ?? vehicle?.name ?? listing.displayName;
  const nameColor = item || vehicle ? color : undefined;
  const level = item?.level ?? vehicle?.level ?? listing.itemLevel;

  const age = listingAgeLabel(listing.listedAt, now);
  // The median segment exists only when real sales produced one —
  // decided here, not inside the segment, so absent data leaves no
  // stray separator in the fact line.
  const med = stats && stats.medianUnitPrice !== null ? <MedianSegment stats={stats} /> : null;
  const medPerUnit = stats && stats.medianUnitPrice !== null ? <MedianSegment stats={stats} perUnit /> : null;

  let fact: React.ReactNode[];
  if (netLine) {
    // Mine: listed state + what the sale nets, at a glance.
    fact = [`Listed ${age}`, netLine];
  } else if (item) {
    const headline = gearRowHeadline(item);
    fact = [
      headline.label ? `${headline.label} ${headline.value}` : headline.value,
      sellerName,
      med,
      age,
    ];
  } else if (vehicle) {
    const def = getVehicleClass(vehicle.vehicleClassId);
    const conditionPct = Math.round(conditionFraction(vehicle.conditionCurrent, vehicle.conditionMax) * 100);
    fact = [
      def?.displayName ?? vehicle.vehicleClassId,
      `Cond ${conditionPct}%`,
      sellerName,
      med,
      age,
    ];
  } else if (listing.kind === 'cosmetic') {
    const def = listing.partId ? skinPartCatalog(listing.partId) : undefined;
    fact = [
      def ? `${skinSetById(def.setId)?.name ?? def.setId} · ${def.slot}` : 'Skin part',
      listing.qualityPercent !== null && listing.qualityPercent !== undefined ? `Q${Math.round(listing.qualityPercent)}%` : null,
      sellerName,
      age,
    ];
  } else {
    fact = [
      listing.quantity > 1 ? `×${listing.quantity}` : null,
      listing.kind === 'consumable' ? `${Math.round(listing.qualityPercent ?? 100)}% quality` : null,
      listing.quantity > 1 && listing.unitPrice > 0 ? `${fmt(listing.unitPrice)}cr ea` : null,
      sellerName,
      medPerUnit,
      age,
    ];
  }

  const price = priceRowHeadline(listing.price);

  const identity = (
    <>
      {item ? <GearThumb item={item} element={listing.element} />
        : vehicle ? <VehicleThumb vehicle={vehicle} />
        : listing.kind === 'cosmetic' ? <CosmeticThumb listing={listing} />
        : <StackThumb listing={listing} />}
      {level !== null && level !== undefined && (
        <span className="w-10 shrink-0 text-[11px] font-black tabular-nums text-text-muted">Lv {level}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[13px] font-black leading-tight ${nameColor ? '' : 'text-text-primary'}`} style={nameColor ? { color: nameColor } : undefined}>{name}</div>
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <FactLine segments={fact} />
          </div>
          {listing.kind === 'material' && listing.materialId && onShowUsage && (
            <button
              type="button"
              onClick={() => onShowUsage(listing.materialId!)}
              className="shrink-0 text-[11px] font-black uppercase tracking-wide text-amber"
            >
              <span className="inline-flex items-center gap-0.5">Used in <PxIcon name="triR" size={13} /></span>
            </button>
          )}
        </div>
      </div>
    </>
  );

  return (
    <motion.div
      {...listEntranceProps(index, reduceMotion)}
      data-testid="market-list-row"
      data-kind={listing.kind}
      className="relative flex min-h-[46px] w-full items-center gap-2 rounded-lg border border-border bg-surface px-2 text-left"
      style={spine ? { borderLeftColor: spine, borderLeftWidth: 4 } : { borderLeftWidth: 4, borderLeftColor: 'transparent' }}
    >
      {item && onInspect ? (
        <button type="button" onClick={onInspect} className="flex min-w-0 flex-1 items-center gap-2 text-left active:scale-[0.99]">
          {identity}
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">{identity}</div>
      )}
      <span className={`shrink-0 text-[15px] font-black tabular-nums ${price.tone ?? 'text-amber'}`}>{price.value}</span>
      {action}
    </motion.div>
  );
};

// ── Sell-lane candidate identity rows ────────────────────────────────
// The Sell stop is a listing desk, not a list of listings: its form
// (price input, List button, guidance, fee line) stays exactly as it
// was under these rows. What joins the row anatomy is the candidate's
// IDENTITY line — the same spine/thumb/level/name/headline read as
// the Gear list — so the whole tab scans in one grammar. Candidates
// carry no price yet, so the headline slot keeps the item's own stat
// (gearRowHeadline proper); no equipped/lock/compare semantics ride
// along (a candidate is not a listing and not a loadout slot).

export const GearCandidateRow: React.FC<{ item: GearItem; onInspect: () => void }> = ({ item, onInspect }) => {
  const headline = gearRowHeadline(item);
  const color = rarityColor(item.rarity);
  return (
    <button type="button" onClick={onInspect} className="flex min-h-[46px] w-full items-center gap-2 text-left active:scale-[0.99]">
      <GearThumb item={item} />
      <span className="w-10 shrink-0 text-[11px] font-black tabular-nums text-text-muted">Lv {item.level}</span>
      <div className="flex min-w-16 flex-1 items-center">
        <span className="min-w-0 truncate text-[13px] font-black leading-tight" style={{ color }}>{item.name}</span>
      </div>
      <div className="flex min-w-0 max-w-[38%] shrink items-baseline gap-1">
        {headline.label && (
          <span className="shrink-0 text-[11px] font-black uppercase tracking-wide text-text-muted">{headline.label}</span>
        )}
        <span className={`min-w-0 truncate text-[13px] font-black tabular-nums ${headline.tone ?? 'text-text-primary'}`}>{headline.value}</span>
      </div>
    </button>
  );
};

export const VehicleCandidateRow: React.FC<{ vehicle: VehicleDisplay }> = ({ vehicle }) => {
  const def = getVehicleClass(vehicle.vehicleClassId);
  const color = rarityColor(vehicle.rarity);
  const conditionPct = Math.round(conditionFraction(vehicle.conditionCurrent, vehicle.conditionMax) * 100);
  return (
    <div className="flex min-h-[46px] w-full items-center gap-2 text-left">
      <VehicleThumb vehicle={vehicle} />
      <span className="w-10 shrink-0 text-[11px] font-black tabular-nums text-text-muted">Lv {vehicle.level ?? 1}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-black leading-tight" style={{ color }}>{vehicle.name}</div>
        <FactLine segments={[
          def?.displayName ?? vehicle.vehicleClassId,
          `Cond ${conditionPct}%`,
          vehicle.affixes[0]?.displayText ?? null,
        ]} />
      </div>
      {def && (
        <div className="flex shrink-0 items-baseline gap-1">
          <span className="text-[11px] font-black uppercase tracking-wide text-text-muted">Yield</span>
          <span className="text-[13px] font-black tabular-nums text-text-primary">×{def.baseYield.toFixed(2)}</span>
        </div>
      )}
    </div>
  );
};
