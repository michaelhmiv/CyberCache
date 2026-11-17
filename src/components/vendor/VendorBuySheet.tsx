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
import React, { useState } from 'react';
import { PickerSheet } from '@/components/common/PickerSheet';
import { QuantityPicker } from '@/components/vendor/QuantityPicker';
import { PixelConsumable } from '@/components/pixelArt/PixelConsumable';
import { usePlayerStore } from '@/store';
import type { VendorOffer } from '@/lib/vendor/catalog';

const vendorCtaCls = 'border-2 border-black bg-amber text-bg shadow-[4px_4px_0_rgba(0,0,0,0.72)]';

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

        <QuantityPicker value={qty} max={maxQty} onChange={setQty} disabled={busy} testIdPrefix="vendor-qty" />

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
