/**
 * QuickBuySheet — the quick-buy pop-up (QB-1, SCOPE §2/§5).
 *
 * Everything happens inside this sheet: the quote prices the fill
 * on two tabs (Market · Vendor — the Vendor tab exists only when
 * the vendor stocks the good today), each tab label carries its
 * fill total for the chosen quantity, and the default tab is the
 * cheaper COMPLETE fill. The quantity stepper opens at the exact
 * shortfall and may step past it up to the supply on show.
 *
 * The quote is a HARD CEILING (the reusable rule): the fill sends
 * the quoted total with the tap, the server re-quotes atomically
 * and charges min(quote, current) — never more. Drift comes back
 * as a 'requote' payload with a fresh quote embedded; the sheet
 * re-renders from it and says plainly that nothing was charged.
 *
 * Failure states live here, never on the card: no supply anywhere
 * shows the source doors; partial supply is stated honestly
 * ("fills 3 of your 5"); a short balance prints SHORT BY X cr with
 * its remedy doors; a guest sees the FULL sheet with real numbers
 * and is asked to sign in only at the Buy button (guest-visibility
 * law).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PickerSheet } from '@/components/common/PickerSheet';
import { SourceLine } from '@/components/workshop/RecipeDetail';
import { verifiedOps } from '@/lib/api/verifiedOps';
import {
  defaultQuickBuyTab,
  planMarketSweep,
  type QuickBuyGoodRef,
  type QuickBuyQuote,
  type QuickBuySource,
} from '@/lib/market/quickBuy';
import { humanizeWorkshopError } from '@/lib/workshop/errors';
import { useEconomyTransactLock } from '@/auth/useEconomyTransactLock';

const fmt = (n: number) => n.toLocaleString('en-US');

const REQUOTE_NOTICES: Record<string, string> = {
  price_moved: 'Prices moved since that quote — here’s the fresh one. Nothing was charged.',
  supply_changed: 'Some of that sold just now — here’s what’s left. Nothing was charged.',
  vendor_unavailable: 'The vendor’s rotation rolled over — that offer is gone. Nothing was charged.',
  insufficient_credits: 'That total is more than your balance — nothing was charged.',
};

interface Receipt {
  quantity: number;
  total: number;
  balance: number | null;
}

export const QuickBuySheet: React.FC<{
  good: QuickBuyGoodRef;
  goodName: string;
  shortfall: number;
  contextLabel?: string;
  onClose: () => void;
  onNavigate?: (screen: string) => void;
  onRefineFocus?: (recipeId: string) => void;
  /** Fired once when a fill settles (QB-2): surfaces whose lines
   *  come from a server view (the service boards) re-read it so
   *  their requirements stop showing the pre-fill stock. Store-
   *  driven surfaces (Workshop, Garage) need nothing — the fill's
   *  own sync already updated their lines. */
  onFilled?: () => void;
}> = ({ good, goodName, shortfall, contextLabel, onClose, onNavigate, onRefineFocus, onFilled }) => {
  const [quote, setQuote] = useState<QuickBuyQuote | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [qty, setQty] = useState(shortfall);
  const [tab, setTab] = useState<QuickBuySource>('market');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const lock = useEconomyTransactLock();

  const applyQuote = useCallback((next: QuickBuyQuote) => {
    setQuote(next);
    setQty(next.requested_qty);
    setTab(defaultQuickBuyTab(next) ?? 'market');
  }, []);

  const fetchQuote = useCallback(
    () => verifiedOps.quickbuyQuote(good.kind, good.id, shortfall),
    [good.kind, good.id, shortfall],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    setQuote(null);
    try {
      applyQuote(await fetchQuote());
    } catch (err) {
      setLoadError(humanizeWorkshopError(err));
    }
  }, [applyQuote, fetchQuote]);

  useEffect(() => {
    let cancelled = false;
    fetchQuote()
      .then((next) => {
        if (!cancelled) applyQuote(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(humanizeWorkshopError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [applyQuote, fetchQuote]);

  const nav = useCallback(
    (screen: string) => {
      onClose();
      onNavigate?.(screen);
    },
    [onClose, onNavigate],
  );

  // The sheet re-plans locally from the quote's full row set, so
  // stepping the quantity re-prices instantly with the same planner
  // the server sweeps with.
  const plan = useMemo(
    () => (quote ? planMarketSweep(quote.market.listings, qty, '') : null),
    [quote, qty],
  );
  const vendorTotal = quote?.vendor ? quote.vendor.unitPrice * qty : null;
  const supplyQty = quote?.market.supplyQty ?? 0;
  // Stepper cap: market supply, or — while the vendor stocks it —
  // comfortably past the shortfall (vendor stock does not run out).
  const maxQty = quote
    ? Math.max(supplyQty, shortfall, quote.vendor ? shortfall + 50 : 0)
    : shortfall;
  const activeTotal = tab === 'vendor' ? vendorTotal : (plan?.total ?? null);
  const activeFillQty = tab === 'vendor' ? qty : (plan?.fillableQty ?? 0);
  const balance = quote?.balance ?? null;
  const shortBy = activeTotal !== null && balance !== null ? activeTotal - balance : 0;
  const noSupply = quote !== null && supplyQty === 0 && !quote.vendor;

  const buy = async () => {
    if (!quote || !plan || activeTotal === null || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await verifiedOps.quickbuyFill({
        source: tab,
        goodKind: good.kind,
        goodId: good.id,
        quantity: qty,
        quotedTotal: activeTotal,
      });
      if (result.status === 'filled') {
        const profile = result.profile as { credits?: number } | undefined;
        setReceipt({
          quantity: typeof result.quantity === 'number' ? result.quantity : activeFillQty,
          total: typeof result.total_charged === 'number' ? result.total_charged : activeTotal,
          balance: typeof profile?.credits === 'number' ? profile.credits : null,
        });
        onFilled?.();
      } else if (result.status === 'requote') {
        const fresh = result.quote as unknown as QuickBuyQuote;
        applyQuote(fresh);
        setNotice(
          REQUOTE_NOTICES[typeof result.reason === 'string' ? result.reason : ''] ??
            'That quote went stale — here’s the fresh one. Nothing was charged.',
        );
      } else {
        setNotice('That buy didn’t go through — check the fresh numbers above and try again.');
      }
    } catch (err) {
      setNotice(humanizeWorkshopError(err));
    } finally {
      setBusy(false);
    }
  };

  const tabButton = (source: QuickBuySource, label: string, total: number | null) => (
    <button
      key={source}
      type="button"
      data-testid={`quickbuy-tab-${source}`}
      aria-pressed={tab === source}
      onClick={() => setTab(source)}
      className={`flex-1 px-2 py-2 text-[11px] font-black border ${
        tab === source ? 'bl-primary border-transparent' : 'border-border text-text-secondary'
      }`}
    >
      {label}
      {total !== null ? <span className="block text-[13px]">{fmt(total)} cr</span> : null}
    </button>
  );

  return (
    <PickerSheet
      title={goodName}
      subtitle={contextLabel ?? `Quick buy · short ${fmt(shortfall)}`}
      onClose={onClose}
    >
      <div className="space-y-3 p-3" data-testid="quickbuy-sheet">
        {loadError && !quote ? (
          <div className="space-y-2">
            <div className="text-[11px] font-bold text-red">{loadError}</div>
            <button
              type="button"
              onClick={() => void load()}
              className="px-3 py-2 text-[11px] font-black border border-border text-text-primary"
            >
              Try again
            </button>
          </div>
        ) : !quote || !plan ? (
          <div className="py-4 text-center text-[11px] font-bold text-text-muted">Pricing the fill…</div>
        ) : receipt ? (
          <div className="space-y-2 py-2 text-center" data-testid="quickbuy-receipt">
            <div className="flex items-center justify-center gap-1.5 text-sm font-black text-green">
              <PxIcon name="check" size={17} /> Filled — {fmt(receipt.quantity)} × {goodName}
            </div>
            <div className="text-[11px] text-text-secondary">
              Charged {fmt(receipt.total)} cr
              {receipt.balance !== null ? <> · balance now {fmt(receipt.balance)} cr</> : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="mt-1 w-full bg-amber px-3 py-2.5 text-xs font-black text-bg"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {notice && (
              <div className="border border-amber/50 bg-amber/10 px-2 py-1.5 text-[11px] font-bold text-amber" data-testid="quickbuy-notice">
                {notice}
              </div>
            )}

            {/* Quantity stepper: opens at the shortfall, may step
                past it up to the supply on show. */}
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-amber">Quantity</div>
                <div className="text-[11px] text-text-muted">
                  {qty < shortfall
                    ? `${fmt(shortfall - qty)} short of what you need`
                    : qty === shortfall
                      ? 'Exactly your shortfall'
                      : `${fmt(qty - shortfall)} past your shortfall`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label="One fewer"
                  data-testid="quickbuy-step-down"
                  disabled={qty <= 1 || busy}
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="grid h-11 w-11 place-items-center border border-border text-text-primary disabled:opacity-40"
                >
                  <PxIcon name="chevD" size={17} />
                </button>
                <span className="w-10 text-center text-base font-black text-text-primary" data-testid="quickbuy-qty">
                  {fmt(qty)}
                </span>
                <button
                  type="button"
                  aria-label="One more"
                  data-testid="quickbuy-step-up"
                  disabled={qty >= maxQty || busy}
                  onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                  className="grid h-11 w-11 place-items-center border border-border text-text-primary disabled:opacity-40"
                >
                  <PxIcon name="chevU" size={17} />
                </button>
              </div>
            </div>

            {noSupply ? (
              <div className="space-y-1.5" data-testid="quickbuy-no-supply">
                <div className="text-[11px] font-bold text-text-primary">
                  Nobody’s selling {goodName} right now, and the vendor doesn’t stock it today.
                </div>
                {(good.kind === 'material' || good.kind === 'essence') && onRefineFocus ? (
                  <SourceLine
                    inputId={good.id}
                    onNavigate={nav}
                    onRefineFocus={(recipeId) => {
                      onClose();
                      onRefineFocus(recipeId);
                    }}
                  />
                ) : (
                  <div className="pl-1 text-[11px] text-text-secondary">
                    <span className="text-text-muted">Get it: </span>
                    <button type="button" className="inline-flex items-center gap-0.5 font-black text-amber" onClick={() => nav('home')}>
                      Roam for drops <PxIcon name="chevR" size={13} />
                    </button>
                    <span className="text-text-muted"> · </span>
                    <button type="button" className="inline-flex items-center gap-0.5 font-black text-amber" onClick={() => nav('market:buy')}>
                      Market <PxIcon name="chevR" size={13} />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Source tabs — each label carries its fill total. */}
                <div className="flex gap-1.5" role="group" aria-label="Fill source">
                  {tabButton('market', 'Market', plan.total)}
                  {quote.vendor ? tabButton('vendor', 'Vendor', vendorTotal) : null}
                </div>

                {tab === 'market' ? (
                  <div className="space-y-1" data-testid="quickbuy-market-body">
                    {plan.partial && (
                      <div className="text-[11px] font-bold text-amber">
                        Fills {fmt(plan.fillableQty)} of your {fmt(qty)} — that’s all that’s listed.
                      </div>
                    )}
                    {plan.fills.map((leg) => {
                      const row = quote.market.listings.find((l) => l.id === leg.listingId);
                      return (
                        <div key={leg.listingId} className="flex items-center justify-between text-[11px]">
                          <span className="text-text-secondary">
                            ×{fmt(leg.takeQty)} @ {fmt(Math.round(leg.unitPrice))} cr
                            {row?.qualityPercent != null ? <> · {Math.round(row.qualityPercent)}% quality</> : null}
                            {leg.sellerKind === 'npc' ? <span className="text-text-muted"> · vendor stock</span> : null}
                          </span>
                          <span className="font-bold text-text-primary">{fmt(leg.charge)} cr</span>
                        </div>
                      );
                    })}
                    {quote.market.listings
                      .filter((l) => !plan.fills.some((f) => f.listingId === l.id))
                      .slice(0, 3)
                      .map((l) => (
                        <div key={l.id} className="flex items-center justify-between text-[11px] opacity-45">
                          <span className="text-text-secondary">
                            ×{fmt(l.quantity)} @ {fmt(Math.round(l.priceCredits / Math.max(1, l.quantity)))} cr
                            {l.qualityPercent != null ? <> · {Math.round(l.qualityPercent)}% quality</> : null}
                          </span>
                          <span className="text-text-muted">not needed</span>
                        </div>
                      ))}
                    <div className="text-[11px] text-text-muted">
                      Market supply: {fmt(supplyQty)} listed · sellers are paid their price minus the 5% market fee.
                    </div>
                  </div>
                ) : quote.vendor ? (
                  <div className="space-y-1" data-testid="quickbuy-vendor-body">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-text-secondary">
                        ×{fmt(qty)} @ {fmt(quote.vendor.unitPrice)} cr
                        {quote.vendor.itemOfTheDay ? (
                          <span className="ml-1 font-black text-amber">Item of the Day — 25% off</span>
                        ) : null}
                      </span>
                      <span className="font-bold text-text-primary">{fmt(vendorTotal ?? 0)} cr</span>
                    </div>
                    <div className="text-[11px] text-text-muted">
                      {quote.vendor.staple
                        ? 'A vendor staple — stocked every day, flat price, no fee.'
                        : 'In today’s vendor rotation — the stock doesn’t run out today, and it’s gone tomorrow.'}
                    </div>
                  </div>
                ) : null}

                <div className="border-t border-border/50 pt-2 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-secondary">Total</span>
                    <span className="text-sm font-black text-text-primary">{fmt(activeTotal ?? 0)} cr</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-text-secondary">Your balance</span>
                    <span className="font-bold text-text-primary">
                      {fmt(balance ?? 0)} cr
                      {shortBy <= 0 && activeTotal !== null ? (
                        <span className="text-text-muted"> · {fmt((balance ?? 0) - (activeTotal ?? 0))} cr after</span>
                      ) : null}
                    </span>
                  </div>
                  <div className="text-[11px] leading-snug text-text-muted">
                    Your quote is a hard ceiling — if prices moved when you tap Buy, you pay the lower
                    price, or get a fresh quote before anything is charged. Never more.
                  </div>
                  {shortBy > 0 && (
                    <div className="space-y-1" data-testid="quickbuy-short-by">
                      <div className="text-[11px] font-black text-red">SHORT BY {fmt(shortBy)} cr</div>
                      <div className="pl-1 text-[11px] text-text-secondary">
                        <span className="text-text-muted">Get credits: </span>
                        <button type="button" className="inline-flex items-center gap-0.5 font-black text-amber" onClick={() => nav('market:sell')}>
                          Sell loot <PxIcon name="chevR" size={13} />
                        </button>
                        <span className="text-text-muted"> · </span>
                        <button type="button" className="inline-flex items-center gap-0.5 font-black text-amber" onClick={() => nav('home')}>
                          Roam for loot <PxIcon name="chevR" size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {lock.locked ? (
                  <button
                    type="button"
                    data-testid="quickbuy-buy"
                    onClick={() => lock.guardTransact('buy', () => undefined)}
                    className="w-full bg-amber px-3 py-3 text-xs font-black text-bg"
                  >
                    Buying needs an account · Sign in <PxIcon name="chevR" size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    data-testid="quickbuy-buy"
                    disabled={busy || activeFillQty <= 0 || shortBy > 0}
                    onClick={() => void buy()}
                    className="w-full bg-amber px-3 py-3 text-xs font-black text-bg disabled:opacity-40"
                  >
                    {busy
                      ? 'Buying…'
                      : plan.partial && tab === 'market'
                        ? `Buy ${fmt(activeFillQty)} of ${fmt(qty)} × ${goodName} · ${fmt(activeTotal ?? 0)} cr`
                        : `Buy ${fmt(activeFillQty)} × ${goodName} · ${fmt(activeTotal ?? 0)} cr`}
                  </button>
                )}
              </>
            )}
          </>
        )}
        {lock.prompt}
      </div>
    </PickerSheet>
  );
};
