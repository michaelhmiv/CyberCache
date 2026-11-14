/**
 * VendorBuySheet — buy-quantity picker for one vendor offer.
 * (Owner-approved rendering, 2026-11-13: "Build the picker
 * exactly as shown.")
 *
 * Opens from a vendor row's Buy button. The vendor's stock is
 * INFINITE (src/lib/vendor/catalog.ts: "the shipped vendor model
 * has no stock counts") and cc_vendor_buy clamps quantity only at
 * >= 1 with no upper cap, so the pickable range is set purely by
 * the player's credits: MAX = floor(credits / unitPrice).
 *
 * Chrome is the shared PickerSheet (One Sheet law); the identity
 * row reuses the vendor card's anatomy (56px well, 52px sprite,
 * Owned over the right column). Quick-pick chips ride the stop
 * rail's chip grammar (active = amber fill); the confirm rides the
 * vendor CTA geometry. All figures are labels and numbers only.
 */
import React, { useMemo, useState } from 'react';
import { PickerSheet } from '@/components/common/PickerSheet';
import { PixelConsumable } from '@/components/pixelArt/PixelConsumable';
import { usePlayerStore } from '@/store';
import type { VendorOffer } from '@/lib/vendor/catalog';

const vendorCtaCls = 'border-2 border-black bg-amber text-bg shadow-[4px_4px_0_rgba(0,0,0,0.72)]';

const QUICK_PICKS = [1, 20, 50, 100, 1000];

export interface VendorBuySheetTarget {
  offer: VendorOffer;
  name: string;
  /** Consumable def family line for the identity row (materials pass their kind label). */
  kindLabel: string;
  /** True when the item renders a PixelConsumable sprite (consumables only). */
  hasSprite: boolean;
}

interface VendorBuySheetProps {
  target: VendorBuySheetTarget | null;
  busy: boolean;
  onClose: () => void;
  onBuy: (target: VendorBuySheetTarget, quantity: number) => void;
}

export const VendorBuySheet: React.FC<VendorBuySheetProps> = ({ target, busy, onClose, onBuy }) => {
  const credits = usePlayerStore((s) => s.credits);
  const owned = usePlayerStore((s) =>
    target
      ? target.offer.kind === 'consumable'
        ? (s.consumables[target.offer.itemKey] ?? 0)
        : target.offer.kind === 'material'
          ? (s.materials[target.offer.itemKey] ?? 0)
          : (s.essences[target.offer.itemKey] ?? 0)
      : 0,
  );
  const [qty, setQty] = useState(1);

  const unitPrice = target?.offer.unitPrice ?? 0;
  const maxQty = unitPrice > 0 ? Math.floor(credits / unitPrice) : 0;

  // Fresh sheet, fresh quantity: every open starts at 1 (the old
  // Buy 1 tap's amount), and a balance change mid-sheet can only
  // pull the selection DOWN to what is still affordable. Both are
  // render-phase adjustments (the React-docs pattern for
  // prop/store-driven state resets) rather than effects, which
  // the repo's hooks lint forbids for synchronous setState.
  const [prevTarget, setPrevTarget] = useState(target);
  if (target !== prevTarget) {
    setPrevTarget(target);
    setQty(1);
  }
  const [prevMaxQty, setPrevMaxQty] = useState(maxQty);
  if (maxQty !== prevMaxQty) {
    setPrevMaxQty(maxQty);
    if (maxQty >= 1 && qty > maxQty) setQty(maxQty);
  }

  const total = qty * unitPrice;
  const creditsAfter = credits - total;
  const sliderPct = useMemo(() => {
    if (maxQty <= 1) return 100;
    return ((qty - 1) / (maxQty - 1)) * 100;
  }, [qty, maxQty]);

  const chipCls = (selected: boolean, disabled: boolean) =>
    `flex min-h-[44px] items-center justify-center border px-1 text-[11px] font-black transition-colors ${
      selected
        ? 'border-amber bg-amber text-bg'
        : 'border-border bg-surface-raised text-text-secondary'
    } ${disabled ? 'opacity-40' : ''}`;

  if (!target) return null;

  return (
    <PickerSheet title={target.name} onClose={onClose}>
      <div className="space-y-4 pt-3">
        {/* Identity row: the vendor card's anatomy, one size up. */}
        <div className="flex items-start gap-2.5">
          {target.hasSprite && (
            <div className="bl-well flex h-14 w-14 shrink-0 items-center justify-center">
              <PixelConsumable type={target.offer.itemKey} size={52} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-amber">{target.kindLabel}</div>
            <div className="text-xs font-bold leading-snug text-text-primary">
              {unitPrice.toLocaleString()}cr each
              {target.offer.itemOfTheDay && <span className="text-amber"> • Item of the Day −25%</span>}
            </div>
            <div className="text-[11px] text-text-muted">Credits {credits.toLocaleString()}cr</div>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[11px] text-text-muted">Owned</div>
            <div className="text-sm font-black leading-none text-text-primary">{owned}</div>
          </div>
        </div>

        {/* Quantity readout */}
        <div className="flex items-end justify-between">
          <div className="text-[11px] font-black uppercase text-text-secondary">Quantity</div>
          <div className="text-[23px] font-black leading-none text-text-primary" data-testid="vendor-qty-value">
            {qty.toLocaleString()}
          </div>
        </div>

        {/* Quick-pick chips: 1 / 20 / 50 / 100 / 1000 / MAX. A chip
            past the player's MAX is disabled, never hidden — the
            ladder stays put and the wallet says why. */}
        <div className="grid grid-cols-6 gap-1.5" data-testid="vendor-qty-chips">
          {QUICK_PICKS.map((value) => (
            <button
              key={value}
              type="button"
              disabled={value > maxQty || busy}
              onClick={() => setQty(value)}
              className={chipCls(qty === value, value > maxQty)}
              data-testid={`vendor-qty-chip-${value}`}
            >
              {value.toLocaleString()}
            </button>
          ))}
          <button
            type="button"
            disabled={maxQty < 1 || busy}
            onClick={() => setQty(maxQty)}
            className={chipCls(qty === maxQty && maxQty > 1, maxQty < 1)}
            data-testid="vendor-qty-chip-max"
          >
            MAX
          </button>
        </div>

        {/* Slider: 1 .. MAX on a drawn track (amber fill to the
            selection), the native input riding transparent above
            it with the full 44px row as its tap target. */}
        <div>
          <div className="relative flex h-11 items-center">
            <div className="absolute left-0 right-0 h-2 bg-surface-raised" />
            <div className="absolute left-0 h-2 bg-amber" style={{ width: `${sliderPct}%` }} />
            <input
              type="range"
              min={1}
              max={Math.max(1, maxQty)}
              step={1}
              value={qty}
              disabled={maxQty <= 1 || busy}
              onChange={(e) => setQty(Number(e.target.value))}
              aria-label="Quantity"
              data-testid="vendor-qty-slider"
              className="absolute inset-0 h-11 w-full cursor-pointer appearance-none bg-transparent disabled:opacity-40 [&::-moz-range-thumb]:h-[26px] [&::-moz-range-thumb]:w-[26px] [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-black [&::-moz-range-thumb]:bg-amber [&::-moz-range-thumb]:shadow-[3px_3px_0_rgba(0,0,0,0.72)] [&::-moz-range-track]:bg-transparent [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:h-[26px] [&::-webkit-slider-thumb]:w-[26px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-black [&::-webkit-slider-thumb]:bg-amber [&::-webkit-slider-thumb]:shadow-[3px_3px_0_rgba(0,0,0,0.72)]"
            />
          </div>
          <div className="flex justify-between text-[11px] text-text-muted">
            <span>1</span>
            <span>{maxQty.toLocaleString()}</span>
          </div>
        </div>

        {/* Totals */}
        <div className="space-y-1.5 border-t border-border/50 pt-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-black uppercase text-text-secondary">Total</span>
            <span className="text-base font-black text-amber" data-testid="vendor-qty-total">
              {total.toLocaleString()}cr
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[11px] font-black uppercase text-text-secondary">Credits after</span>
            <span className="text-sm font-black text-text-primary" data-testid="vendor-qty-after">
              {creditsAfter.toLocaleString()}cr
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={busy || maxQty < 1}
          onClick={() => onBuy(target, qty)}
          className={`min-h-[44px] w-full px-3 py-2.5 text-xs font-black disabled:opacity-40 ${vendorCtaCls}`}
          data-testid="vendor-qty-confirm"
        >
          {busy ? 'Buying…' : `Buy ${qty.toLocaleString()} • ${total.toLocaleString()}cr`}
        </button>
      </div>
    </PickerSheet>
  );
};
