/**
 * Dashboard Top Bar — level progress + streak/contracts icon
 * pop-ups (owner's device feedback, 2026-11-01).
 *
 * The top row of the home screen, directly under the ResourceBar
 * so it is on first paint without scrolling:
 *
 *  - LEVEL button (flex-1): the level badge, a live XP progress
 *    bar (the shipped xpToNextLevel curve read from the player
 *    store — the same numbers the old in-scroll Level Strip
 *    showed; no second XP truth), tappable → the level pop-up.
 *  - STREAK icon button: opens the login-streak pop-up (the real
 *    LoginStreakPanel). Pulses with a "NEW" badge when today's
 *    check-in just granted a reward.
 *  - CONTRACTS icon button: opens the contracts pop-up (the real
 *    ContractsPanel). Pulses with a claimable-count badge when
 *    contracts are ready to claim; guests get the lock badge the
 *    panel's claim buttons carry — no pulse, no count.
 *
 * HARD INVARIANT — the check-in is NOT behind the tap: this row
 * mounts with the Dashboard and its mount performs the streak
 * state read (which IS the daily check-in) and the contracts
 * board read (which issues the sets and drives the badge). The
 * pop-up panels consume the same shared stores; opening a pop-up
 * is never what records the day.
 *
 * The LEVEL pop-up holds the level specifics AND the relocated
 * Offline Recap ("while you were away" content — all settlement
 * variants, primer row included). While a settlement is
 * unacknowledged the level button carries the away beacon (pulse
 * + "AWAY" badge); the animation is never the only signal — every
 * animated state is paired with badge text and an accessible
 * label that carries the same information.
 *
 * Pop-ups are the shipped PickerSheet (SheetPortal to
 * document.body — sheets never render inside transformed or
 * clipped ancestors, the flow-fix F17 pattern).
 */
import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PickerSheet } from '@/components/common/PickerSheet';
import { MobileCard } from '@/components/layout/MobileCard';
import { OfflineRecapCard } from '@/components/activity/OfflineRecap';
import { LoginStreakPanel } from './LoginStreakPanel';
import { ContractsPanel } from './ContractsPanel';
import { usePlayerStore } from '@/store';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { countClaimableContracts, useContractsStore } from '@/store/slices/contractsSlice';
import { xpToNextLevel } from '@/content/simulation';

const STREAK_ACCENT = '#FF8A3D';
const CONTRACTS_ACCENT = '#E8B33D';

type TopSheet = 'level' | 'streak' | 'contracts' | null;

/** Pulsing glow underlay for an icon whose pop-up holds something
 *  actionable. Decorative only — the badge text and aria-label
 *  carry the signal for anyone who cannot see motion. */
function PulseGlow({ color, testId }: { color: string; testId: string }) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion) {
    return (
      <span
        data-testid={testId}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ boxShadow: `inset 0 0 0 2px ${color}, 0 0 10px ${color}66` }}
      />
    );
  }
  return (
    <motion.span
      data-testid={testId}
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ boxShadow: `inset 0 0 0 2px ${color}, 0 0 12px ${color}88` }}
      animate={{ opacity: [1, 0.3, 1] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

function CornerBadge({ text, color }: { text: string; color: string }) {
  return (
    <span
      className="absolute -top-1.5 -right-1.5 z-10 px-1 py-px text-[9px] font-black leading-none text-black"
      style={{ backgroundColor: color }}
    >
      {text}
    </span>
  );
}

export const DashboardTopBar: React.FC = () => {
  const level = usePlayerStore((s) => s.level);
  const xp = usePlayerStore((s) => s.xp);
  const streakResult = useLoginStreakStore((s) => s.result);
  const loadStreak = useLoginStreakStore((s) => s.load);
  const contractsResult = useContractsStore((s) => s.result);
  const loadContracts = useContractsStore((s) => s.load);
  const lastSettlement = useOfflineRecapStore((s) => s.lastSettlement);
  const recapDismissed = useOfflineRecapStore((s) => s.dismissed);
  const [sheet, setSheet] = useState<TopSheet>(null);

  // The check-in + board reads fire HERE, on Dashboard mount —
  // never gated on opening a pop-up (see header). The stores
  // dedupe: the panels' own mounts no-op once this has loaded.
  useEffect(() => {
    void loadStreak();
    void loadContracts();
  }, [loadStreak, loadContracts]);

  const xpNeeded = xpToNextLevel(level);
  const xpProgress = xpNeeded > 0 ? Math.min(100, Math.round((xp / xpNeeded) * 100)) : 100;
  const xpRemaining = Math.max(0, xpNeeded - xp);

  const awayPending = Boolean(lastSettlement) && !recapDismissed;

  const granted = streakResult?.granted;
  const streakJustClaimed = Boolean(
    granted && !granted.alreadyClaimed && granted.streakLength !== null,
  );
  const streakDay = streakResult?.loginStreak.currentStreak ?? null;

  const board = contractsResult?.contracts ?? null;
  const claimable = countClaimableContracts(contractsResult);
  const contractsPulsing = claimable > 0 && board?.canClaim === true;
  const contractsGuestLocked = board !== null && board.canClaim === false;

  const levelLabel =
    `Level ${level} progress — ${xp} of ${xpNeeded} XP, ` +
    `${xpRemaining} XP to level ${level + 1}` +
    (awayPending ? '. While you were away rewards are waiting.' : '');
  const streakLabel = streakResult
    ? `Daily streak — day ${streakDay ?? 0}` +
      (streakJustClaimed ? `, day ${granted?.streakLength} reward claimed` : ', today checked in')
    : 'Daily streak';
  const contractsLabel = !board
    ? 'Contracts'
    : contractsGuestLocked
      ? 'Contracts — sign in with Google to claim rewards'
      : claimable > 0
        ? `Contracts — ${claimable} ready to claim`
        : 'Contracts — none ready to claim';

  return (
    <>
      <div data-testid="dashboard-top-bar" className="mb-3 flex items-stretch gap-2">
        {/* Level — progress bar + pop-up door */}
        <button
          type="button"
          data-testid="top-level-button"
          aria-label={levelLabel}
          onClick={() => setSheet('level')}
          className="bl-panel relative min-h-[52px] min-w-0 flex-1 overflow-hidden px-3 py-2 text-left"
        >
          {awayPending && <PulseGlow color="#F2C063" testId="level-away-pulse" />}
          {awayPending && <CornerBadge text="AWAY" color="#F2C063" />}
          <span className="relative flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 shrink-0 rotate-45 items-center justify-center border-2 border-black/60 bg-amber"
              aria-hidden
            >
              <span className="-rotate-45 text-center leading-none">
                <span className="block text-[7px] font-black tracking-widest text-black/70">LV</span>
                <span className="block text-[13px] font-black text-black">{level}</span>
              </span>
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[10px] font-black uppercase tracking-wider text-text-muted">
                  Level Progress
                </span>
                <span className="shrink-0 text-[10px] font-bold tabular-nums text-text-muted">
                  {xp} / {xpNeeded} XP
                </span>
              </span>
              <span className="mt-1 block h-2 overflow-hidden border border-black/50 bg-black/40">
                <motion.span
                  className="block h-full bg-amber"
                  initial={false}
                  animate={{ width: `${xpProgress}%` }}
                  transition={{ type: 'spring', damping: 20 }}
                />
              </span>
            </span>
          </span>
        </button>

        {/* Daily streak — icon + pop-up door */}
        <button
          type="button"
          data-testid="top-streak-button"
          aria-label={streakLabel}
          onClick={() => setSheet('streak')}
          className="bl-panel relative flex min-h-[52px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden px-1 py-1.5"
        >
          {streakJustClaimed && <PulseGlow color={STREAK_ACCENT} testId="streak-claim-pulse" />}
          {streakJustClaimed && <CornerBadge text="NEW" color={STREAK_ACCENT} />}
          <span style={{ fontSize: 19, lineHeight: 1 }} aria-hidden>🔥</span>
          <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">
            {streakDay !== null ? `Day ${streakDay}` : 'Streak'}
          </span>
        </button>

        {/* Contracts — icon + pop-up door */}
        <button
          type="button"
          data-testid="top-contracts-button"
          aria-label={contractsLabel}
          onClick={() => setSheet('contracts')}
          className="bl-panel relative flex min-h-[52px] w-[52px] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden px-1 py-1.5"
        >
          {contractsPulsing && <PulseGlow color={CONTRACTS_ACCENT} testId="contracts-claim-pulse" />}
          {contractsPulsing && <CornerBadge text={String(claimable)} color={CONTRACTS_ACCENT} />}
          {contractsGuestLocked && <CornerBadge text="🔒" color="#8A847C" />}
          <span style={{ fontSize: 19, lineHeight: 1 }} aria-hidden>📋</span>
          <span className="text-[8px] font-black uppercase tracking-wider text-text-muted">
            Orders
          </span>
        </button>
      </div>

      {sheet === 'level' && (
        <PickerSheet
          title={`Level ${level}`}
          subtitle={`${xp} / ${xpNeeded} XP · ${xpRemaining} to level ${level + 1}`}
          onClose={() => setSheet(null)}
        >
          <div className="space-y-3 p-3">
            <MobileCard className="p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-text-muted">
                  Level Progress
                </span>
                <span className="text-[10px] font-bold tabular-nums text-text-muted">
                  {xpProgress}%
                </span>
              </div>
              <div className="mt-1.5 h-2.5 overflow-hidden border border-black/50 bg-black/40">
                <motion.div
                  className="h-full bg-amber"
                  initial={false}
                  animate={{ width: `${xpProgress}%` }}
                  transition={{ type: 'spring', damping: 20 }}
                />
              </div>
              <dl className="mt-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <dt className="text-text-muted">Current level</dt>
                  <dd className="font-black tabular-nums text-text-primary">{level}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-text-muted">XP into this level</dt>
                  <dd className="font-black tabular-nums text-text-primary">{xp}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-text-muted">XP for this level</dt>
                  <dd className="font-black tabular-nums text-text-primary">{xpNeeded}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-text-muted">XP to next level</dt>
                  <dd className="font-black tabular-nums text-amber">{xpRemaining}</dd>
                </div>
              </dl>
            </MobileCard>

            {/* The relocated "while you were away" recap — renders
                whenever a settlement exists; "Got it" acknowledges
                it (stops the beacon) and closes the pop-up. */}
            {lastSettlement && (
              <OfflineRecapCard onDone={() => setSheet(null)} />
            )}
          </div>
        </PickerSheet>
      )}

      {sheet === 'streak' && (
        <PickerSheet
          title="Login Streak"
          subtitle="Daily check-in rewards"
          onClose={() => setSheet(null)}
        >
          <div className="p-3">
            <LoginStreakPanel />
          </div>
        </PickerSheet>
      )}

      {sheet === 'contracts' && (
        <PickerSheet
          title="Contracts"
          subtitle="Daily & weekly work orders"
          onClose={() => setSheet(null)}
        >
          <div className="p-3">
            <ContractsPanel />
          </div>
        </PickerSheet>
      )}
    </>
  );
};
