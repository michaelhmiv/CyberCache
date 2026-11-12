/**
 * M-2 — the stack row's per-unit label must not imply a total
 * different from the charged total. ListingRow rounded the exact
 * fractional unit price to whole credits: a ×17 stack at 25cr
 * (1.4705…/ea) read "1cr ea", implying 17cr. The audit's CI
 * assertion: render ListingRow for {quantity: 17, price: 25} and
 * assert the unit label is not "1cr ea" (exact decimals, or the
 * label suppressed when the rounded figure disagrees).
 *
 * This fix takes the exact-decimals branch: whole credits when the
 * price divides evenly, two decimals otherwise. The MarketScreen
 * listing header printed the same rounded figure and shares the
 * formatter.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ListingRow } from '@/components/market/ListingRow';
import type { Listing } from '@/types/market';

const NOW = 1_700_000_000_000;

const stack = (overrides: Partial<Listing>): Listing =>
  ({
    id: 'listing-stack',
    sellerId: 'seller-9',
    sellerName: 'Rook Sandoval',
    sellerType: 'player',
    kind: 'material',
    itemId: null,
    itemSnapshot: null,
    vehicleSnapshot: null,
    category: 'material',
    displayName: 'RefinedAlloy',
    quantity: 17,
    qualityPercent: null,
    consumableType: null,
    materialId: 'RefinedAlloy',
    essenceId: null,
    partId: null,
    tintPaletteId: null,
    identityKey: null,
    weaponType: null,
    element: null,
    rarity: null,
    itemLevel: null,
    price: 25,
    unitPrice: 25 / 17,
    listedAt: NOW - 5 * 60_000,
    feePaid: 0,
    ...overrides,
  }) as Listing;

function renderRow(listing: Listing): string {
  const { container } = render(
    <ListingRow listing={listing} index={0} reduceMotion={null} now={NOW} sellerLabel="Seller · Rook Sandoval" />,
  );
  return container.textContent ?? '';
}

describe('stack unit-price label (audit M-2)', () => {
  it('a ×17 stack at 25cr labels the exact unit price, never "1cr ea"', () => {
    const text = renderRow(stack({}));
    expect(text).toContain('×17');
    expect(text).toContain('1.47cr ea');
    expect(text).not.toContain('1cr ea');
    expect(text).toContain('25cr');
  });

  it('the ×26 case from the audit screenshot reads 0.96cr ea', () => {
    const text = renderRow(stack({ quantity: 26, price: 25, unitPrice: 25 / 26 }));
    expect(text).toContain('0.96cr ea');
    expect(text).not.toContain('1cr ea');
  });

  it('an evenly dividing stack keeps the whole-credit label', () => {
    const text = renderRow(stack({ quantity: 12, price: 3000, unitPrice: 250 }));
    expect(text).toContain('250cr ea');
    expect(text).toContain('3,000cr');
  });
});
