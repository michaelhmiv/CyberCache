/**
 * QuickBuyPlus — the ONLY card-level trace of quick-buy (QB-1):
 * one small + button beside a shortfall quantity. Nothing else
 * appears on the card — no fill-all, no prices, no one-tap buy.
 * The tap opens QuickBuySheet, where the whole purchase happens.
 *
 * Render rule (the caller's, enforced here too): shortfall goods
 * lines only. Credits/profile lines (Scrap, credits, skill
 * points) never get one — callers simply don't render this for
 * them. The button is icon-only (drawn pixel glyph, never an
 * emoji) with a ≥44dp touch target around a compact chip, and it
 * mounts no auth or data hooks until the sheet actually opens —
 * a closed card stays exactly as light as it was before QB-1.
 */
import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import type { QuickBuyGoodRef } from '@/lib/market/quickBuy';
import { QuickBuySheet } from './QuickBuySheet';

export const QuickBuyPlus: React.FC<{
  good: QuickBuyGoodRef;
  goodName: string;
  shortfall: number;
  contextLabel?: string;
  onNavigate?: (screen: string) => void;
  onRefineFocus?: (recipeId: string) => void;
  /** Threaded to the sheet (QB-2): fires when a fill settles, for
   *  surfaces that must re-read a server view afterwards. */
  onFilled?: () => void;
}> = ({ good, goodName, shortfall, contextLabel, onNavigate, onRefineFocus, onFilled }) => {
  const [open, setOpen] = useState(false);
  if (shortfall <= 0) return null;
  return (
    <>
      <button
        type="button"
        data-testid={`quickbuy-plus-${good.kind}-${good.id}`}
        aria-label={`Buy more ${goodName}`}
        title={`Buy more ${goodName}`}
        onClick={() => setOpen(true)}
        className="-my-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center"
      >
        <span className="grid h-[22px] w-[22px] place-items-center rounded border border-amber/70 bg-amber/10 text-amber">
          <PxIcon name="plus" size={13} />
        </span>
      </button>
      {open && (
        <QuickBuySheet
          good={good}
          goodName={goodName}
          shortfall={shortfall}
          contextLabel={contextLabel}
          onClose={() => setOpen(false)}
          onNavigate={onNavigate}
          onRefineFocus={onRefineFocus}
          onFilled={onFilled}
        />
      )}
    </>
  );
};
