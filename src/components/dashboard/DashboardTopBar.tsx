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
 *  - WEEKLY claim chip (redesign Wave C): renders ONLY while a
 *    weekly Parts Crate or Signature Order is claimable at the
 *    Rep Desk (the standing mirror's read drives it). Pulses
 *    with the claimable count; opens the weekly claim sheet
 *    (the same claim list the deck's Weekly panel carries).
 *    Guests see the chip too — the lock sits on the claim
 *    buttons inside, never on the announcement.
 *
 * HARD INVARIANT — the check-in is NOT behind the tap: this row
 * mounts with the Dashboard and its mount performs the streak
 * state read (which IS the daily check-in), the contracts
 * board read (which issues the sets and drives the badge), and
 * the standing read (which drives the weekly chip). The pop-up
 * panels consume the same shared stores; opening a pop-up
 * is never what records the day.
 *
 * The RETURN SHEET (DESIGN.md §10) presents the offline-return
 * recap: totals row, the absence's best drop as a poster card
 * on the loot ladder's timings, one Collect button, the push
 * primer in the footer once. The LEVEL chip is its door —
 * while a settlement exists (acknowledged or not), tapping the
 * level button opens the Return Sheet; the level pop-up itself
 * holds level specifics ONLY, with a door row back to the recap
 * while one exists. While a settlement is unacknowledged the
 * level button carries the away beacon (pulse + "AWAY" badge);
 * the animation is never the only signal — every animated state
 * is paired with badge text and an accessible label that
 * carries the same information. The <5-minute suppression and
 * all settlement logic live in the recap slice, untouched by
 * this presentation.
 *
 * Pop-ups are the shipped PickerSheet (SheetPortal to
 * document.body — sheets never render inside transformed or
 * clipped ancestors, the flow-fix F17 pattern).
 */
import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion, useReducedMotion } from 'framer-motion';
import { PickerSheet } from '@/components/common/PickerSheet';
import { MobileCard } from '@/components/layout/MobileCard';
import { OfflineRecapCard } from '@/components/activity/OfflineRecap';
import { LoginStreakPanel } from './LoginStreakPanel';
import { ContractsPanel } from './ContractsPanel';
import { WeeklyClaimablesList } from './WeeklyClaimables';
import { usePlayerStore } from '@/store';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { countClaimableContracts, useContractsStore } from '@/store/slices/contractsSlice';
import { useStandingStore, weeklyClaimables } from '@/store/slices/standingSlice';
import { xpToNextLevel } from '@/content/simulation';

const STREAK_ACCENT = '#FF8A3D';
const CONTRACTS_ACCENT = '#E8B33D';
const WEEKLY_ACCENT = '#3FD6E8';

type TopSheet = 'level' | 'return' | 'streak' | 'contracts' | 'weekly' | null;

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

function CornerBadge({ text, icon, color }: { text?: string; icon?: PxIconName; color: string }) {
  // Fully INSIDE the button's top-right corner (QC papercut): the
  // badge used to protrude (-top-1.5 -right-1.5) and every host
  // button clips at its own box — Tailwind overflow-hidden plus
  // .bl-panel's overflow:hidden + clip-path — so the protruding
  // half was sliced off at the button's top edge. The bl-panel
  // clip-path keeps the top-right corner square, so an inset
  // badge there renders whole.
  // Size (owner ruling, 2026-11-02): the label renders at the
  // DESIGN.md §5 floor — 11px, never below. The badge got BIGGER;
  // the floor did not move. Padding and the icon grow with it so
  // the pill keeps its proportions.
  return (
    <span
      className="absolute right-1 top-1 z-10 px-1.5 py-0.5 text-[11px] font-black leading-none text-black"
      style={{ backgroundColor: color }}
    >
      {icon ? <PxIcon name={icon} size={15} /> : text}
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
  const standingView = useStandingStore((s) => s.view);
  const loadStanding = useStandingStore((s) => s.load);
  const lastSettlement = useOfflineRecapStore((s) => s.lastSettlement);
  const recapDismissed = useOfflineRecapStore((s) => s.dismissed);
  const [sheet, setSheet] = useState<TopSheet>(null);

  // The check-in + board reads fire HERE, on Dashboard mount —
  // never gated on opening a pop-up (see header). The stores
  // dedupe: the panels' own mounts no-op once this has loaded.
  useEffect(() => {
    void loadStreak();
    void loadContracts();
    void loadStanding();
  }, [loadStreak, loadContracts, loadStanding]);

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

  const weekly = weeklyClaimables(standingView);
  const weeklyCount = weekly.length;
  const weeklyLabel =
    weeklyCount > 0
      ? `Weekly claimables — ${weeklyCount} ready at the Rep Desk`
      : 'Weekly claimables';

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
        {/* Level — progress bar; the chip is the Return Sheet's
            door while a settlement exists (DESIGN.md §3/§10),
            and the level pop-up's door otherwise. */}
        <button
          type="button"
          data-testid="top-level-button"
          aria-label={levelLabel}
          onClick={() => setSheet(lastSettlement ? 'return' : 'level')}
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
            {/* While the AWAY badge is up, the text block reserves
                the badge's corner (DESIGN.md §6: adapt the host,
                never shrink the type) so the XP readout never tucks
                under the enlarged badge. */}
            <span className={`min-w-0 flex-1 ${awayPending ? 'pr-12' : ''}`}>
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[11px] font-black uppercase tracking-wider text-text-muted">
                  Level Progress
                </span>
                <span className="shrink-0 text-[11px] font-bold tabular-nums text-text-muted">
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
          className="bl-panel relative flex min-h-[52px] min-w-[60px] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden px-2 py-1.5"
        >
          {streakJustClaimed && <PulseGlow color={STREAK_ACCENT} testId="streak-claim-pulse" />}
          {streakJustClaimed && <CornerBadge text="NEW" color={STREAK_ACCENT} />}
          <PxIcon name="flame" size={17} />
          <span className="text-[11px] font-black uppercase tracking-wider text-text-muted">
            {streakDay !== null ? `Day ${streakDay}` : 'Streak'}
          </span>
        </button>

        {/* Contracts — icon + pop-up door */}
        <button
          type="button"
          data-testid="top-contracts-button"
          aria-label={contractsLabel}
          onClick={() => setSheet('contracts')}
          className="bl-panel relative flex min-h-[52px] min-w-[60px] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden px-2 py-1.5"
        >
          {contractsPulsing && <PulseGlow color={CONTRACTS_ACCENT} testId="contracts-claim-pulse" />}
          {contractsPulsing && <CornerBadge text={String(claimable)} color={CONTRACTS_ACCENT} />}
          {contractsGuestLocked && <CornerBadge icon="lock" color="#8A847C" />}
          <PxIcon name="orders" size={17} />
          <span className="text-[11px] font-black uppercase tracking-wider text-text-muted">
            Orders
          </span>
        </button>

        {/* Weekly claimables — chip; renders only while a weekly
            Parts Crate / Signature Order is claimable (§9). */}
        {weeklyCount > 0 && (
          <button
            type="button"
            data-testid="top-weekly-button"
            aria-label={weeklyLabel}
            onClick={() => setSheet('weekly')}
            className="bl-panel relative flex min-h-[52px] min-w-[60px] shrink-0 flex-col items-center justify-center gap-0.5 overflow-hidden px-2 py-1.5"
          >
            <PulseGlow color={WEEKLY_ACCENT} testId="weekly-claim-pulse" />
            <CornerBadge text={String(weeklyCount)} color={WEEKLY_ACCENT} />
            <PxIcon name="crate" size={17} />
            <span className="text-[11px] font-black uppercase tracking-wider text-text-muted">
              Weekly
            </span>
          </button>
        )}
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
                <span className="text-[11px] font-black uppercase tracking-wider text-text-muted">
                  Level Progress
                </span>
                <span className="text-[11px] font-bold tabular-nums text-text-muted">
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

            {/* Level specifics ONLY (DESIGN.md §3): the recap
                lives on the Return Sheet, nowhere else — this row
                is its door while a settlement exists. */}
            {lastSettlement && (
              <button
                type="button"
                onClick={() => setSheet('return')}
                className="flex w-full items-center justify-between border border-border bg-bg/60 px-3 py-2.5 text-left text-xs font-black text-text-primary"
              >
                <span>While You Were Away</span>
                <PxIcon name="chevR" size={14} />
              </button>
            )}
          </div>
        </PickerSheet>
      )}

      {sheet === 'return' && lastSettlement && (
        <PickerSheet title="Return" onClose={() => setSheet(null)}>
          <div className="space-y-3 p-3">
            {/* The Return Sheet body (§10): totals row, best drop
                as a poster card on the loot ladder's timings, one
                Collect button, the push primer in the footer
                once — all inside OfflineRecapCard. Collect
                acknowledges (stops the beacon) and closes. */}
            <OfflineRecapCard onDone={() => setSheet(null)} />
            <button
              type="button"
              onClick={() => setSheet('level')}
              className="flex w-full items-center justify-between border border-border bg-bg/60 px-3 py-2.5 text-left text-xs font-black text-text-primary"
            >
              <span>Level details</span>
              <PxIcon name="chevR" size={14} />
            </button>
          </div>
        </PickerSheet>
      )}

      {sheet === 'weekly' && (
        <PickerSheet
          title="Weekly Claimables"
          subtitle="Rep Desk weekly offers — the desk itself is at Market, Rep Desk"
          onClose={() => setSheet(null)}
        >
          <div className="p-3">
            <WeeklyClaimablesList />
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
