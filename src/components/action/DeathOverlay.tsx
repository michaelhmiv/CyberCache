/**
 * DeathOverlay — the full-screen modal that appears when the hunter's
 * `useSurvivalStore.isDead` is true. Offers three resurrect paths:
 *
 *   1. **Free recovery** — wait for the 5-minute timer on the
 *      `resurrectionReadyAt` timestamp. The button is disabled and
 *      shows a live countdown until ready.
 *   2. **Pay credits** — skip the timer for a credit cost that scales
 *      with the area's `unlockLevel`. Disabled if the player can't
 *      afford it. Cost is computed by `resurrectionCostForArea()`.
 *   3. **Use revive token** — instant, consumes one ReviveToken from
 *      the player's consumable count. Disabled if no tokens.
 *
 * The overlay reads from the survival slice for death state, the
 * player slice for credits and tokens, and the activity slice for
 * the area (so the credit cost reflects where the player died).
 *
 * The overlay is rendered by `App.tsx` (or the action tab) — it
 * returns null when `!isDead` so it's safe to mount unconditionally.
 *
 * Tests: see `DeathOverlay.test.tsx` for rendering, disabled-state,
 * and click-handler coverage.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Coins, Ticket, Skull } from 'lucide-react';
import {
  useSurvivalStore,
  usePlayerStore,
  useKillCycleStore,
  useActivityStore,
} from '@/store';
import { resurrectionCostForArea, formatCreditCost, RESURRECTION_FREE_TIMER_MS } from '@/lib/combat/resurrectionCost';
import { mountIdleTicker } from '@/store/slices/idleTickerSlice';

export interface DeathOverlayProps {
  /** Optional className for the outer container. */
  className?: string;
}

/** Format the remaining timer as `M:SS` for the free recovery button. */
function formatRemaining(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export const DeathOverlay: React.FC<DeathOverlayProps> = ({ className }) => {
  // Subscribe with narrow selectors so the overlay doesn't re-render
  // on every tick. The survival slice's persisted `isDead` is the
  // primary signal.
  const isDead = useSurvivalStore((s) => s.isDead);
  const lastKilledBy = useSurvivalStore((s) => s.lastKilledBy);
  const readyAt = useSurvivalStore((s) => s.resurrectionReadyAt);

  const credits = usePlayerStore((s) => s.credits);
  const reviveTokens = usePlayerStore((s) => s.getConsumableCount('ReviveToken'));

  // Read the area where the player died (activity store).
  const areaId = useActivityStore((s) => s.current.targetId);
  const areaLabel = useActivityStore((s) => s.current.targetLabel);

  const [now, setNow] = useState<number>(() => Date.now());

  // Live-count the free timer every second while dead.
  useEffect(() => {
    if (!isDead) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isDead]);

  const freeReadyAt = readyAt ?? 0;
  const freeRemainingMs = Math.max(0, freeReadyAt - now);
  const freeTimerEnabled = freeRemainingMs <= 0;

  const creditCost = resurrectionCostForArea(areaId);
  const canPayCredits = credits >= creditCost;
  const canUseToken = reviveTokens > 0;

  if (!isDead) return null;

  // ─── Click handlers ─────────────────────────────────────────────
  const handleFree = () => {
    if (!freeTimerEnabled) return;
    useSurvivalStore.getState().resurrect();
    useKillCycleStore.getState().resetForAreaChange();
    // Ticker is still mounted, but the slice's `isDead` flips and the
    // next tick will start processing again. mountIdleTicker is
    // idempotent so calling it is a safe no-op if already mounted.
    mountIdleTicker();
  };

  const handlePay = () => {
    if (!canPayCredits) return;
    usePlayerStore.getState().removeCredits(creditCost);
    useSurvivalStore.getState().resurrectPaid();
    useKillCycleStore.getState().resetForAreaChange();
    mountIdleTicker();
  };

  const handleToken = () => {
    if (!canUseToken) return;
    usePlayerStore.getState().removeConsumable('ReviveToken', 1);
    useSurvivalStore.getState().resurrectToken();
    useKillCycleStore.getState().resetForAreaChange();
    mountIdleTicker();
  };

  return (
    <AnimatePresence>
      <motion.div
        data-testid="death-overlay"
        data-monster-id={lastKilledBy?.monsterId ?? null}
        data-area-id={lastKilledBy?.areaId ?? null}
        className={
          'fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm ' +
          (className ?? '')
        }
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="death-overlay-title"
      >
        <motion.div
          className="w-full max-w-md space-y-4 rounded-2xl border-2 border-red bg-surface p-5 shadow-[6px_6px_0_rgba(0,0,0,0.75)]"
          initial={{ y: 20, scale: 0.95 }}
          animate={{ y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        >
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center border-2 border-red bg-red/20 text-red">
              <Skull size={22} />
            </div>
            <div className="min-w-0 flex-1">
              <div
                id="death-overlay-title"
                className="text-xl font-black uppercase tracking-wide text-red"
              >
                Hunter Down
              </div>
              <div className="text-xs text-text-muted">
                {lastKilledBy?.monsterName
                  ? `Killed by ${lastKilledBy.monsterName}${areaLabel ? ` in ${areaLabel}` : ''}.`
                  : 'Your hunter is down. Choose a recovery option.'}
              </div>
            </div>
          </div>

          {/* Option 1: Free timer */}
          <button
            data-testid="death-option-free"
            data-timer-ms-remaining={freeRemainingMs}
            data-enabled={freeTimerEnabled}
            onClick={handleFree}
            disabled={!freeTimerEnabled}
            className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-transform active:scale-[0.98] ${
              freeTimerEnabled
                ? 'border-border bg-bg hover:border-amber'
                : 'border-border bg-bg opacity-60'
            }`}
          >
            <Clock size={20} className={freeTimerEnabled ? 'text-amber' : 'text-text-muted'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black uppercase tracking-wide text-text-primary">Free Recovery</div>
              <div className="text-[10px] text-text-muted">
                {freeTimerEnabled ? 'Ready now' : `Wait ${formatRemaining(freeRemainingMs)}`}
              </div>
            </div>
            <div className="text-xs font-black text-amber">0 cr</div>
          </button>

          {/* Option 2: Pay credits */}
          <button
            data-testid="death-option-pay"
            data-credit-cost={creditCost}
            data-enabled={canPayCredits}
            onClick={handlePay}
            disabled={!canPayCredits}
            className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-transform active:scale-[0.98] ${
              canPayCredits
                ? 'border-border bg-bg hover:border-amber'
                : 'border-border bg-bg opacity-60'
            }`}
          >
            <Coins size={20} className={canPayCredits ? 'text-amber' : 'text-text-muted'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black uppercase tracking-wide text-text-primary">Pay Credits</div>
              <div className="text-[10px] text-text-muted">
                {canPayCredits ? 'Skip the timer' : `Need ${formatCreditCost(creditCost)}`}
              </div>
            </div>
            <div className="text-xs font-black text-amber">{formatCreditCost(creditCost)}</div>
          </button>

          {/* Option 3: Revive token */}
          <button
            data-testid="death-option-token"
            data-token-count={reviveTokens}
            data-enabled={canUseToken}
            onClick={handleToken}
            disabled={!canUseToken}
            className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-transform active:scale-[0.98] ${
              canUseToken
                ? 'border-border bg-bg hover:border-amber'
                : 'border-border bg-bg opacity-60'
            }`}
          >
            <Ticket size={20} className={canUseToken ? 'text-amber' : 'text-text-muted'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black uppercase tracking-wide text-text-primary">Use Revive Token</div>
              <div className="text-[10px] text-text-muted">
                {canUseToken ? `${reviveTokens} available` : 'Craft or buy a Revive Token'}
              </div>
            </div>
            <div className="text-xs font-black text-amber">×{reviveTokens}</div>
          </button>

          <div className="text-[10px] text-text-muted text-center">
            Free timer: {Math.floor(RESURRECTION_FREE_TIMER_MS / 60000)} min · Credit cost scales with area tier.
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
