/**
 * QuickBuy client (QB-1) — the + button's render rule and the
 * sheet's settled behaviors:
 *   - the + exists only beside a shortfall, icon-only, and mounts
 *     nothing until tapped;
 *   - the sheet defaults to the cheaper COMPLETE fill, both tab
 *     totals always visible;
 *   - the stepper opens at the shortfall and re-prices past it;
 *   - partial supply, no supply (doors), and a short balance all
 *     state themselves inside the sheet;
 *   - a guest sees the full sheet with real numbers — sign-in is
 *     asked only at the Buy button;
 *   - a drifted quote re-renders from the requote payload with
 *     "nothing was charged" said out loud.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickBuyPlus } from '../components/quickbuy/QuickBuyPlus';
import type { QuickBuyQuote } from '../lib/market/quickBuy';
import type { AccountState } from '../auth/accountState';

const quoteMock = vi.fn();
const fillMock = vi.fn();
vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    quickbuyQuote: (...args: unknown[]) => quoteMock(...args),
    quickbuyFill: (...args: unknown[]) => fillMock(...args),
  },
}));

let account: AccountState | null = null;
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ account }),
}));

const VERIFIED: AccountState = {
  userId: 'buyer', accountType: 'verified', username: 'buyer', hasUsername: true,
  email: 'b@test.local', emailVerifiedAt: '2026-06-14T00:00:00.000Z',
  verificationGraceExpiresAt: null, verificationReminderLastSeenAt: null, isAnonymous: false,
};
const GUEST: AccountState = {
  userId: 'guest', accountType: 'guest', username: null, hasUsername: false,
  email: null, emailVerifiedAt: null,
  verificationGraceExpiresAt: null, verificationReminderLastSeenAt: null, isAnonymous: true,
};

function quoteFixture(over: Partial<QuickBuyQuote> = {}): QuickBuyQuote {
  return {
    action_type: 'cc_quickbuy_quote',
    good: { kind: 'material', id: 'Scrap' },
    requested_qty: 5,
    balance: 1_000,
    market: {
      supplyQty: 10,
      fillableQty: 5,
      partial: false,
      total: 55,
      worstUnitPrice: 15,
      fills: [
        { listingId: 'l1', sellerKind: 'player', takeQty: 4, unitPrice: 10, charge: 40 },
        { listingId: 'l2', sellerKind: 'player', takeQty: 1, unitPrice: 15, charge: 15 },
      ],
      listings: [
        { id: 'l1', sellerUserId: 's1', sellerKind: 'player', quantity: 4, priceCredits: 40, qualityPercent: null, listedAt: '2026-11-04T07:00:00.000Z' },
        { id: 'l2', sellerUserId: 's2', sellerKind: 'player', quantity: 6, priceCredits: 90, qualityPercent: null, listedAt: '2026-11-04T08:00:00.000Z' },
      ],
    },
    vendor: { unitPrice: 10, basePrice: 10, itemOfTheDay: false, staple: false, total: 50 },
    ...over,
  };
}

function renderPlus(over: Partial<React.ComponentProps<typeof QuickBuyPlus>> = {}) {
  return render(
    <QuickBuyPlus
      good={{ kind: 'material', id: 'Scrap' }}
      goodName="Scrap Alloy"
      shortfall={5}
      onNavigate={vi.fn()}
      onRefineFocus={vi.fn()}
      {...over}
    />,
  );
}

beforeEach(() => {
  quoteMock.mockReset();
  fillMock.mockReset();
  account = VERIFIED;
  quoteMock.mockResolvedValue(quoteFixture());
});

describe('QuickBuyPlus — the render rule', () => {
  it('renders nothing when there is no shortfall', () => {
    const { container } = renderPlus({ shortfall: 0 });
    expect(container.firstChild).toBeNull();
  });

  it('renders one icon-only button with an accessible name and no price text', () => {
    renderPlus();
    const button = screen.getByTestId('quickbuy-plus-material-Scrap');
    expect(button.getAttribute('aria-label')).toBe('Buy more Scrap Alloy');
    expect(button.textContent).toBe('');
    // Closed card: no quote is fetched until the tap.
    expect(quoteMock).not.toHaveBeenCalled();
  });
});

describe('QuickBuySheet — pricing inside the sheet', () => {
  it('defaults to the cheaper complete fill and shows both tab totals', async () => {
    renderPlus();
    fireEvent.click(screen.getByTestId('quickbuy-plus-material-Scrap'));
    await screen.findByTestId('quickbuy-sheet');
    // Vendor (50) undercuts market (55) at qty 5 → vendor is default.
    await waitFor(() => expect(screen.getByTestId('quickbuy-tab-vendor').getAttribute('aria-pressed')).toBe('true'));
    expect(screen.getByTestId('quickbuy-tab-market').textContent).toContain('55 cr');
    expect(screen.getByTestId('quickbuy-tab-vendor').textContent).toContain('50 cr');
    expect(screen.getByTestId('quickbuy-qty').textContent).toBe('5');
  });

  it('stepping past the shortfall re-prices both tabs from the same plan', async () => {
    renderPlus();
    fireEvent.click(screen.getByTestId('quickbuy-plus-material-Scrap'));
    await screen.findByTestId('quickbuy-tab-market');
    fireEvent.click(screen.getByTestId('quickbuy-step-up'));
    expect(screen.getByTestId('quickbuy-qty').textContent).toBe('6');
    // Market: 4 @ 40 + 2 @ 15 = 70. Vendor: 6 × 10 = 60.
    expect(screen.getByTestId('quickbuy-tab-market').textContent).toContain('70 cr');
    expect(screen.getByTestId('quickbuy-tab-vendor').textContent).toContain('60 cr');
  });

  it('partial supply is stated honestly and the Buy label agrees', async () => {
    quoteMock.mockResolvedValue(quoteFixture({
      vendor: null,
      market: {
        supplyQty: 3, fillableQty: 3, partial: true, total: 30, worstUnitPrice: 10,
        fills: [{ listingId: 'l1', sellerKind: 'player', takeQty: 3, unitPrice: 10, charge: 30 }],
        listings: [
          { id: 'l1', sellerUserId: 's1', sellerKind: 'player', quantity: 3, priceCredits: 30, qualityPercent: null, listedAt: '2026-11-04T07:00:00.000Z' },
        ],
      },
    }));
    renderPlus();
    fireEvent.click(screen.getByTestId('quickbuy-plus-material-Scrap'));
    await screen.findByTestId('quickbuy-market-body');
    expect(screen.getByTestId('quickbuy-market-body').textContent).toContain('Fills 3 of your 5');
    expect(screen.getByTestId('quickbuy-buy').textContent).toContain('Buy 3 of 5');
  });

  it('no supply anywhere shows the doors, not a dead end', async () => {
    quoteMock.mockResolvedValue(quoteFixture({
      vendor: null,
      market: { supplyQty: 0, fillableQty: 0, partial: true, total: 0, worstUnitPrice: null, fills: [], listings: [] },
    }));
    renderPlus();
    fireEvent.click(screen.getByTestId('quickbuy-plus-material-Scrap'));
    const empty = await screen.findByTestId('quickbuy-no-supply');
    expect(empty.textContent).toContain('Nobody’s selling');
    expect(empty.textContent).toContain('Get it:');
    expect(screen.queryByTestId('quickbuy-buy')).toBeNull();
  });

  it('a short balance prints SHORT BY and blocks the buy', async () => {
    quoteMock.mockResolvedValue(quoteFixture({ balance: 10, vendor: null }));
    renderPlus();
    fireEvent.click(screen.getByTestId('quickbuy-plus-material-Scrap'));
    await screen.findByTestId('quickbuy-short-by');
    expect(screen.getByTestId('quickbuy-short-by').textContent).toContain('SHORT BY 45 cr');
    expect((screen.getByTestId('quickbuy-buy') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('QuickBuySheet — buying', () => {
  it('fills at the quoted ceiling and shows the receipt', async () => {
    fillMock.mockResolvedValue({
      status: 'filled', quantity: 5, total_charged: 50, profile: { credits: 950 },
    });
    renderPlus();
    fireEvent.click(screen.getByTestId('quickbuy-plus-material-Scrap'));
    await screen.findByTestId('quickbuy-tab-vendor');
    fireEvent.click(screen.getByTestId('quickbuy-buy'));
    const receipt = await screen.findByTestId('quickbuy-receipt');
    expect(receipt.textContent).toContain('Filled — 5 × Scrap Alloy');
    expect(receipt.textContent).toContain('Charged 50 cr');
    expect(receipt.textContent).toContain('balance now 950 cr');
    // The default tab was vendor at 50 — the fill carries exactly that ceiling.
    expect(fillMock).toHaveBeenCalledWith(expect.objectContaining({
      source: 'vendor', goodKind: 'material', goodId: 'Scrap', quantity: 5, quotedTotal: 50,
    }));
  });

  it('a drifted quote re-renders fresh and says nothing was charged', async () => {
    fillMock.mockResolvedValue({
      status: 'requote',
      reason: 'price_moved',
      quote: quoteFixture({ balance: 940 }),
    });
    renderPlus();
    fireEvent.click(screen.getByTestId('quickbuy-plus-material-Scrap'));
    await screen.findByTestId('quickbuy-buy');
    fireEvent.click(screen.getByTestId('quickbuy-buy'));
    const note = await screen.findByTestId('quickbuy-notice');
    expect(note.textContent).toContain('Nothing was charged');
    expect(screen.queryByTestId('quickbuy-receipt')).toBeNull();
  });

  it('guest: full numbers on show, sign-in asked only at the Buy button', async () => {
    account = GUEST;
    renderPlus();
    fireEvent.click(screen.getByTestId('quickbuy-plus-material-Scrap'));
    await screen.findByTestId('quickbuy-tab-market');
    expect(screen.getByTestId('quickbuy-tab-market').textContent).toContain('55 cr');
    const buy = screen.getByTestId('quickbuy-buy');
    expect(buy.textContent).toContain('Buying needs an account');
    fireEvent.click(buy);
    // The fill is never attempted for a guest.
    expect(fillMock).not.toHaveBeenCalled();
  });
});
