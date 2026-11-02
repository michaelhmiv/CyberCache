/**
 * DeathOverlay — the full-screen modal that appears when the hunter's
 * `useSurvivalStore.isDead` is true. Offers two resurrect paths, both
 * resolved by the Chef (POST /api/resurrect — the only resurrection
 * authority since Phase 0 Slice 4):
 *
 *   1. **Free recovery** — wait for the 5-minute timer anchored to
 *      the server-recorded death time. The button shows a live
 *      countdown; the server re-validates the elapsed time against
 *      its own clock when clicked.
 *   2. **Pay credits** — skip the timer for a credit cost that scales
 *      with the unlock level of the area the hunter died in. The
 *      displayed cost comes from the same shared
 *      `resurrectionCostForArea()` the server route derives the
 *      charge from (over the death record's area), and the server
 *      deducts it — this component never touches the credit balance.
 *
 * (There used to be a third option, "Use revive token". The
 * ReviveToken item never existed — no def, no source, no server
 * record — so the button was permanently disabled fiction. It was
 * removed in Slice 4; a real revive token would need a consumable
 * def, an acquisition source, and a server consume path.)
 *
 * The overlay reads from the survival slice for death state, the
 * player slice for the credit balance (affordability display only),
 * and the activity slice as the area fallback when no death record
 * is present.
 *
 * The overlay is rendered by `App.tsx` (or the action tab) — it
 * returns null when `!isDead` so it's safe to mount unconditionally.
 *
 * Tests: see `DeathOverlay.test.tsx` for rendering, disabled-state,
 * and click-handler coverage (the Chef client is mocked there).
 */
import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock } from 'lucide-react';
import {
  useSurvivalStore,
  usePlayerStore,
  useKillCycleStore,
  useActivityStore,
} from '@/store';
import { ResourceIcon } from '@/components/common/ResourceIcon';
import { resurrectionCostForArea, formatCreditCost, RESURRECTION_FREE_TIMER_MS } from '@/lib/combat/resurrectionCost';
import { newResurrectNonce, resurrectViaChef } from '@/lib/chef/chefClient';
import { syncVerifiedResult } from '@/lib/api/verifiedStateSync';
import { saveCurrentRuntimeStores } from '@/store/runtimeSupabaseSync';
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
  const playerId = usePlayerStore((s) => s.id);

  // The area the hunter died in (death record) prices the paid path;
  // the activity area is only a fallback for deaths recorded before
  // the record carried an area.
  const activityAreaId = useActivityStore((s) => s.current.targetId);
  const areaLabel = useActivityStore((s) => s.current.targetLabel);
  const deathAreaId = lastKilledBy?.areaId ?? activityAreaId;

  const [now, setNow] = useState<number>(() => Date.now());
  const [busyMethod, setBusyMethod] = useState<'free' | 'paid' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live-count the free timer every second while dead.
  useEffect(() => {
    if (!isDead) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isDead]);

  const freeReadyAt = readyAt ?? 0;
  const freeRemainingMs = Math.max(0, freeReadyAt - now);
  const freeTimerEnabled = freeRemainingMs <= 0;

  const creditCost = resurrectionCostForArea(deathAreaId);
  const canPayCredits = credits >= creditCost;
  const busy = busyMethod !== null;

  if (!isDead) return null;

  // ─── Click handlers ─────────────────────────────────────────────
  // Both paths are intents to the Chef: the server requires its own
  // death record, validates the free timer on its own clock, charges
  // the paid path itself, and returns the canonical state, which is
  // synced here (profile via syncVerifiedResult, death log from the
  // server copy, survival via the slice's resurrect applier). The
  // local stores deduct nothing on their own.
  const runResurrect = async (method: 'free' | 'paid') => {
    if (busy || !playerId) return;
    setBusyMethod(method);
    setError(null);
    try {
      const result = await resurrectViaChef({ playerId, method, nonce: newResurrectNonce() });
      syncVerifiedResult(result as unknown as Record<string, unknown>);
      if (Array.isArray(result.deathLog)) {
        useSurvivalStore.getState().syncDeathLogFromServer(result.deathLog);
      }
      useSurvivalStore.getState().resurrect();
      useKillCycleStore.getState().resetForAreaChange();
      await saveCurrentRuntimeStores();
      // Ticker is still mounted, but the slice's `isDead` flips and the
      // next tick will start processing again. mountIdleTicker is
      // idempotent so calling it is a safe no-op if already mounted.
      mountIdleTicker();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resurrection failed. Try again.');
    } finally {
      setBusyMethod(null);
    }
  };

  const handleFree = () => {
    if (!freeTimerEnabled) return;
    void runResurrect('free');
  };

  const handlePay = () => {
    if (!canPayCredits) return;
    void runResurrect('paid');
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
              <PxIcon name="skull" size={26} />
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
            data-enabled={freeTimerEnabled && !busy}
            onClick={handleFree}
            disabled={!freeTimerEnabled || busy}
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
                {busyMethod === 'free' ? 'Recovering…' : freeTimerEnabled ? 'Ready now' : `Wait ${formatRemaining(freeRemainingMs)}`}
              </div>
            </div>
            <div className="text-xs font-black text-amber">0 cr</div>
          </button>

          {/* Option 2: Pay credits */}
          <button
            data-testid="death-option-pay"
            data-credit-cost={creditCost}
            data-enabled={canPayCredits && !busy}
            onClick={handlePay}
            disabled={!canPayCredits || busy}
            className={`flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left transition-transform active:scale-[0.98] ${
              canPayCredits
                ? 'border-border bg-bg hover:border-amber'
                : 'border-border bg-bg opacity-60'
            }`}
          >
            <ResourceIcon id="credits" size={20} className={canPayCredits ? '' : 'opacity-40'} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-black uppercase tracking-wide text-text-primary">Pay Credits</div>
              <div className="text-[10px] text-text-muted">
                {busyMethod === 'paid' ? 'Charging…' : canPayCredits ? 'Skip the timer — charged by the server' : `Need ${formatCreditCost(creditCost)}`}
              </div>
            </div>
            <div className="text-xs font-black text-amber">{formatCreditCost(creditCost)}</div>
          </button>

          {error && (
            <div data-testid="death-error" className="text-center text-[11px] font-bold text-red">
              {error}
            </div>
          )}

          <div className="text-[10px] text-text-muted text-center">
            Free timer: {Math.floor(RESURRECTION_FREE_TIMER_MS / 60000)} min · Credit cost scales with the tier of the area you died in.
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};
