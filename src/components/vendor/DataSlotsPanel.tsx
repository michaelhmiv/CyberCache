import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { Lock } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import { usePlayerStore } from '@/store';
import { useEconomyTransactLock } from '@/auth/useEconomyTransactLock';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { fetchSlotState } from '@/lib/api/slotService';
import { getPixelSprite } from '@/lib/pixel/manifest';
import {
  SLOT_OUTCOMES,
  SLOT_TIER_NAMES,
  buildSlotStateView,
  resolveSlotLevers,
  slotCreditRtp,
  slotOutcomePercent,
  type SlotGlyph,
  type SlotStateView,
} from '@/content/slots';

/**
 * Data Slots — the vendor's slot machine (0049), a panel at the foot
 * of the stall (brief §2.8: below the rotation, above buyback — a
 * stall fixture, not a shop tab).
 *
 * The panel only renders the Chef's state and sends intent (a tier +
 * nonce). The pull is decided SERVER-side by cc_slot_pull: the reels
 * below are a reveal of the returned outcome, never a roll (brief
 * §2.3/§2.9). The payout table is printed on the machine from the
 * SAME odds twin the server seeds (law: the odds are printed on the
 * machine — rendered from src/content/slots.ts, never re-typed).
 *
 * Guests see the whole machine — cabinet, reels, printed odds — with
 * the sign-in lock at the lever (guest-visibility law; §2.5 keeps
 * pulls verified-only because the machine can mint). The lock is the
 * #254 transact pattern (useEconomyTransactLock → SignInLockPrompt):
 * the tiers stay tappable, a locked tap raises the shared sign-in
 * prompt, and the server refuses the op regardless.
 */

const GLYPH_ICONS: Record<SlotGlyph, React.ReactNode> = {
  blank: <PxIcon name="x" size={26} className="text-text-muted" />,
  credit_stack: <PxIcon name="coin" size={26} className="text-amber" />,
  vial: <PxIcon name="crate" size={26} className="text-emerald-300" />,
  fragment: <PxIcon name="frag" size={26} className="text-cyan-300" />,
  key: <PxIcon name="key" size={26} className="text-amber" />,
  jackpot_star: <PxIcon name="star5" size={26} className="text-amber" />,
};

const SPIN_GLYPHS: SlotGlyph[] = ['credit_stack', 'vial', 'fragment', 'key', 'jackpot_star', 'blank'];

interface PullPayout {
  kind?: string;
  credits_paid?: number;
  fragments_paid?: number;
  key_paid?: boolean;
  key_fallback?: boolean;
  bundle?: Array<{ item_key: string; quantity: number; unit_price: number }>;
  bundle_value?: number;
  note?: string | null;
}

interface PullResult {
  outcome?: string;
  bet_tier?: number;
  bet_credits?: number;
  payout?: PullPayout;
  pulls_today?: number;
  pulls_remaining?: number;
  cap?: number;
  cache_budget?: { opened_today: number; cap: number; remaining: number };
}

function formatPercent(outcome: (typeof SLOT_OUTCOMES)[number]): string {
  const pct = slotOutcomePercent(outcome);
  return `${Number.isInteger(pct) ? pct.toFixed(0) : pct.toFixed(2).replace(/0$/, '')}%`;
}

function outcomeLabel(outcomeId: string | undefined): string {
  return SLOT_OUTCOMES.find((o) => o.id === outcomeId)?.label ?? 'Result';
}

function outcomeGlyph(outcomeId: string | undefined): SlotGlyph {
  return SLOT_OUTCOMES.find((o) => o.id === outcomeId)?.glyph ?? 'blank';
}

function payoutSummary(result: PullResult): string {
  const payout = result.payout ?? {};
  if (payout.note) return payout.note;
  switch (payout.kind) {
    case 'credits':
      return `Paid ${(payout.credits_paid ?? 0).toLocaleString()}cr.`;
    case 'bundle': {
      const items = (payout.bundle ?? []).map((i) => `${i.item_key} ×${i.quantity}`).join(', ');
      return `Vendor bundle (${(payout.bundle_value ?? 0).toLocaleString()}cr of goods): ${items}.`;
    }
    case 'fragments':
      return `Paid ${payout.fragments_paid ?? 0} cache fragments.`;
    case 'key':
      return payout.key_paid ? 'Paid 1 cache key.' : 'Paid out.';
    default:
      return 'No payout — the machine keeps the bet.';
  }
}

export const DataSlotsPanel: React.FC = () => {
  const player = usePlayerStore();
  const { locked, guardTransact, prompt: transactLockPrompt } = useEconomyTransactLock();
  const [state, setState] = useState<SlotStateView | null>(null);
  const [busy, setBusy] = useState(false);
  const [reels, setReels] = useState<[SlotGlyph, SlotGlyph, SlotGlyph]>(['credit_stack', 'fragment', 'key']);
  const [result, setResult] = useState<PullResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const spinTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchSlotState();
    if (next) setState(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSlotState().then((next) => {
      if (!cancelled && next) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (spinTimer.current) clearInterval(spinTimer.current);
  }, []);

  // Before the Chef answers, the panel shows the shipped defaults
  // (the content resolver over no live values) — the same numbers
  // the server enforces until a lever moves.
  const view: SlotStateView =
    state ??
    buildSlotStateView(
      { day: new Date().toISOString().slice(0, 10), pullsToday: 0, cacheOpenedToday: 0, cacheCap: 10 },
      resolveSlotLevers(),
    );

  const pullsRemaining = result?.pulls_remaining ?? view.pullsRemaining;
  const cacheBudget = result?.cache_budget
    ? { openedToday: result.cache_budget.opened_today, cap: result.cache_budget.cap, remaining: result.cache_budget.remaining }
    : view.cacheBudget;

  const handlePull = async (tier: number) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setResult(null);
    // The reel settle is display-only: glyphs cycle while the Chef
    // decides, then stop on the returned outcome's glyph (§2.9 —
    // the reels are a reveal, not a roll).
    let tick = 0;
    spinTimer.current = setInterval(() => {
      tick += 1;
      setReels([
        SPIN_GLYPHS[tick % SPIN_GLYPHS.length],
        SPIN_GLYPHS[(tick + 2) % SPIN_GLYPHS.length],
        SPIN_GLYPHS[(tick + 4) % SPIN_GLYPHS.length],
      ]);
    }, 90);
    try {
      const raw = (await verifiedOps.slotPull(tier)) as PullResult;
      const glyph = outcomeGlyph(raw.outcome);
      setReels([glyph, glyph, glyph]);
      setResult(raw);
      setNotice(`${outcomeLabel(raw.outcome)} — ${payoutSummary(raw)}`);
      void refresh();
    } catch (error) {
      setReels(['blank', 'blank', 'blank']);
      setNotice(error instanceof Error ? error.message : 'The pull failed.');
    } finally {
      if (spinTimer.current) clearInterval(spinTimer.current);
      spinTimer.current = null;
      setBusy(false);
    }
  };

  const machineSprite = getPixelSprite('prop-slot-machine');
  const rtpPercent = (slotCreditRtp() * 100).toFixed(1);

  return (
    <MobileCard className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {machineSprite && (
            <img
              src={machineSprite.url}
              alt="Data Slots machine"
              className="w-12 h-16 shrink-0 [image-rendering:pixelated]"
            />
          )}
          <div className="min-w-0">
            <div className="text-xs font-bold text-text-primary">Data Slots</div>
            <div className="text-[10px] text-amber">The vendor&apos;s machine — credits in, prizes out</div>
            <div className="text-[10px] text-text-muted">
              Pulls left today: {pullsRemaining} / {view.cap} • Cache budget: {cacheBudget.openedToday} of {cacheBudget.cap} boxes opened
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-text-muted uppercase">Credits</div>
          <div className="text-sm font-black text-amber">{player.credits.toLocaleString()}</div>
        </div>
      </div>

      <div className="flex justify-center gap-2" aria-label="Slot reels">
        {reels.map((glyph, i) => (
          <div key={i} className="bl-well w-14 h-14 flex items-center justify-center">
            {GLYPH_ICONS[glyph]}
          </div>
        ))}
      </div>

      {notice && <div className="text-xs text-text-secondary text-center">{notice}</div>}

      {transactLockPrompt}

      {locked && (
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-text-muted text-center">
          <Lock size={12} className="text-amber shrink-0" />
          <span>The machine can pay out up to 50× — pulls are verified-only. Tap a tier to sign in.</span>
        </div>
      )}

      <div className="flex gap-2">
        {view.tiers.map((bet, idx) => {
          const tier = idx + 1;
          const disabled = busy || (!locked && (!view.machineOpen || pullsRemaining <= 0 || player.credits < bet));
          return (
            <button
              key={tier}
              type="button"
              onClick={() => guardTransact('pull the lever', () => void handlePull(tier))}
              disabled={disabled}
              className="flex-1 py-2 rounded-xl bl-primary text-xs font-black disabled:opacity-40"
            >
              {busy ? 'Pulling…' : `${SLOT_TIER_NAMES[tier]} • ${bet.toLocaleString()}cr`}
            </button>
          );
        })}
      </div>

      <div className="space-y-1">
        <div className="text-[10px] font-black uppercase text-text-secondary">Payout table — the odds are printed on the machine</div>
        {SLOT_OUTCOMES.map((outcome) => (
          <div key={outcome.id} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="flex items-center gap-1.5 text-text-primary">
              {GLYPH_ICONS[outcome.glyph]}
              {outcome.label}
            </span>
            <span className="text-text-muted">{outcome.paysLabel}</span>
            <span className="font-black text-text-primary w-14 text-right">{formatPercent(outcome)}</span>
          </div>
        ))}
        <div className="text-[10px] text-text-muted leading-relaxed pt-1">
          Credit return {rtpPercent}% — the machine keeps the rest as a credit sink. A cache key pays against your
          daily cache budget; if the budget is full, a key result pays 5 cache fragments instead. The machine never
          pays gear, cores, scrap, or essences.
        </div>
      </div>
    </MobileCard>
  );
};
