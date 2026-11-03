import React from 'react';
import { useMarketStore } from '@/store';

/**
 * Supply doors for service-board remedy lines (assumption-gaps S2).
 *
 * DESIGN.md's standing rule — every "no" carries its remedy: a
 * shortage names the missing thing AND where it comes from, with a
 * door in the same line. A board blocker that strands the reader
 * without a supply (no patch kits, no Calibration Cores) renders one
 * of these doors beside the rewritten reason: the player-market door
 * lands on the Buy stop's Consumables category pre-searched for the
 * missing supply (the market store's buy-browse intent, consumed by
 * MarketScreen); the vendor door lands on the Vendor stop. Both
 * boards share these components so the remedy shape never drifts
 * between them.
 */

const doorClass =
  'font-bold whitespace-nowrap text-text-primary underline decoration-dotted underline-offset-2 hover:text-amber';

export const MarketSupplyDoor: React.FC<{
  search: string;
  ariaLabel: string;
  children: React.ReactNode;
}> = ({ search, ariaLabel, children }) => {
  const requestBuyBrowse = useMarketStore((s) => s.requestBuyBrowse);
  const setActiveTab = useMarketStore((s) => s.setActiveTab);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={doorClass}
      onClick={() => {
        requestBuyBrowse('consumable', search);
        setActiveTab('buy');
      }}
    >
      {children}
    </button>
  );
};

export const VendorSupplyDoor: React.FC<{ ariaLabel: string; children: React.ReactNode }> = ({
  ariaLabel,
  children,
}) => {
  const setActiveTab = useMarketStore((s) => s.setActiveTab);
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={doorClass}
      onClick={() => setActiveTab('vendor')}
    >
      {children}
    </button>
  );
};
