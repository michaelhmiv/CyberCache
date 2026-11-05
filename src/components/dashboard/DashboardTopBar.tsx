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
 *    LoginStreakPanel). While today's recorded reward is unpaid
 *    (0079, the true claim) the chip is a real claimable — pulse
 *    + amber "CLAIM" badge — until the claim lands in the sheet;
 *    an unclaimed reward expires at the 00:00 UTC rollover and
 *    the badge dies with the day. (A pre-0079 result instead
 *    carries the legacy announcement — pulse + "NEW" — that a
 *    grant banked on arrival; "Back to the hunt" acknowledges
 *    it.) The paid state carries no pulse and no badge.
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
 *
 * ANNOUNCEMENT LINE (eye-leading pass, 2026-11-04): directly
 * under this row, at most one announcement chip at a time —
 * orphan earning events that have no moment of their own
 * (DESIGN.md §9's announcement grammar: past tense, pulse until
 * acknowledged, opens the destination). First citizen: market
 * sale proceeds ("Sold · +N cr", the amount actually credited,
 * opening Market → Sell → History). Second: a bench job that
 * finished while the player was elsewhere ("Bench ready",
 * opening the Workshop). The announcements store owns the
 * signals and the queue order (Sold before bench); this row
 * only renders and routes.
 */
import React, { useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { motion, useReducedMotion } from 'framer-motion';
import { PickerSheet } from '@/components/common/PickerSheet';
import { ClaimPulse } from '@/components/common/ClaimPulse';
import { MobileCard } from '@/components/layout/MobileCard';
import { OfflineRecapCard } from '@/components/activity/OfflineRecap';
import { LoginStreakPanel } from './LoginStreakPanel';
import { ContractsPanel } from './ContractsPanel';
import { WeeklyClaimablesList } from './WeeklyClaimables';
import { useMarketStore, usePlayerStore, useSkillStore } from '@/store';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import {
  loginStreakAnnouncement,
  loginStreakClaimable,
  loginStreakClaimKey,
  useLoginStreakStore,
} from '@/store/slices/loginStreakSlice';
import { countClaimableContracts, useContractsStore } from '@/store/slices/contractsSlice';
import { useStandingStore, weeklyClaimables } from '@/store/slices/standingSlice';
import {
  useAnnouncementsStore,
  visibleAnnouncement,
} from '@/store/slices/announcementsSlice';
import { GAIN_GREEN } from '@/lib/ui/stripPulse';
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

const SOLD_ACCENT = GAIN_GREEN;
const BENCH_ACCENT = '#FFA01F';

interface DashboardTopBarProps {
  /** App navigation for the announcement chips' destinations
   *  (Market → Sell → History; the Workshop). Optional so the
   *  row still renders in isolated harnesses; a chip without a
   *  navigator still acknowledges on tap. */
  onNavigate?: (screen: string) => void;
}

export const DashboardTopBar: React.FC<DashboardTopBarProps> = ({ onNavigate }) => {
  const level = usePlayerStore((s) => s.level);
  const xp = usePlayerStore((s) => s.xp);
  const streakResult = useLoginStreakStore((s) => s.result);
  const streakResultDay = useLoginStreakStore((s) => s.resultDay);
  const streakSeenGrantKey = useLoginStreakStore((s) => s.seenGrantKey);
  const streakLastClaimedKey = useLoginStreakStore((s) => s.lastClaimedGrantKey);
  const streakSeenClaimKey = useLoginStreakStore((s) => s.seenClaimKey);
  const loadStreak = useLoginStreakStore((s) => s.load);
  const revalidateStreak = useLoginStreakStore((s) => s.revalidate);
  const contractsResult = useContractsStore((s) => s.result);
  const loadContracts = useContractsStore((s) => s.load);
  const standingView = useStandingStore((s) => s.view);
  const loadStanding = useStandingStore((s) => s.load);
  const lastSettlement = useOfflineRecapStore((s) => s.lastSettlement);
  const recapDismissed = useOfflineRecapStore((s) => s.dismissed);
  const soldAnnouncement = useAnnouncementsStore((s) => s.sold);
  const benchAnnouncement = useAnnouncementsStore((s) => s.bench);
  const checkSales = useAnnouncementsStore((s) => s.checkSales);
  const acknowledgeSold = useAnnouncementsStore((s) => s.acknowledgeSold);
  const acknowledgeBench = useAnnouncementsStore((s) => s.acknowledgeBench);
  const [sheet, setSheet] = useState<TopSheet>(null);

  // The check-in + board reads fire HERE, on Dashboard mount —
  // never gated on opening a pop-up (see header). The stores
  // dedupe: the panels' own mounts no-op once this has loaded.
  // The sales read (eye-leading pass) rides the same mount: it
  // is how a listing that sold while the player was away becomes
  // the Sold announcement under this row.
  useEffect(() => {
    void loadStreak();
    void loadContracts();
    void loadStanding();
    void checkSales();
  }, [loadStreak, loadContracts, loadStanding, checkSales]);

  // Day-boundary revalidation (streak audit D3): a session kept
  // alive across 00:00 UTC re-reads the streak when it returns
  // to the foreground, so the new day's check-in records
  // without an app restart. Same-day returns no-op in the store.
  // A sale can also land while the app is backgrounded, so the
  // sales read re-runs on the same foreground return.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void revalidateStreak();
        void checkSales();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [revalidateStreak, checkSales]);

  // Announcement chips (eye-leading pass, DESIGN.md §9): orphan
  // earning events with no moment of their own announce under
  // this row — past tense, pulsing until acknowledged, opening
  // their destination. One at a time, in the owner's order:
  // market sale proceeds first, then a finished bench job.
  const announcement = visibleAnnouncement({ sold: soldAnnouncement, bench: benchAnnouncement });

  // Unspent skill points (Arena Plates follow-on, owner-approved
  // 2026-11-05): a standing state, not an event, so it does not
  // join the one-at-a-time announcement queue — while points wait
  // unspent, its own chip rides under the announcement line in the
  // same grammar (amber = action waiting) and opens Hunter →
  // Skill Trees through the App's 'skills' route. Quiet at zero:
  // the chip renders only while there are points to spend. The
  // count is the same derivation the Hunter tab prints (level − 1
  // earned, minus the skill store's spent record).
  const skillSpent = useSkillStore((s) => s.spent);
  const unspentSkillPoints = Math.max(
    0,
    level - 1 - Object.values(skillSpent).reduce((sum, n) => sum + (n || 0), 0),
  );
  const openSkillPoints = () => {
    onNavigate?.('skills');
  };

  const openSold = () => {
    acknowledgeSold();
    useMarketStore.getState().requestSellSegment('history');
    onNavigate?.('market:sell');
  };
  const openBench = () => {
    acknowledgeBench();
    onNavigate?.('workshop');
  };

  const xpNeeded = xpToNextLevel(level);
  const xpProgress = xpNeeded > 0 ? Math.min(100, Math.round((xp / xpNeeded) * 100)) : 100;
  const xpRemaining = Math.max(0, xpNeeded - xp);

  const awayPending = Boolean(lastSettlement) && !recapDismissed;

  const granted = streakResult?.granted;
  // The announcement (D1/D2): a fresh grant pulses only while
  // unacknowledged. This replaces the old just-claimed
  // derivation, which no interaction could ever clear.
  const streakAnnouncement = loginStreakAnnouncement(
    streakResult,
    streakResultDay,
    streakSeenGrantKey,
  );
  // True claim (0079): a recorded-but-unpaid reward outranks the
  // announcement — the chip becomes a real claimable (pulse +
  // CLAIM badge, §9's language used truthfully on this chip)
  // until the claim lands.
  const streakClaimable = loginStreakClaimable(streakResult);
  // Just claimed (0079): this session's claim landed and the
  // landing is unacknowledged — the panel's own derivation.
  // The chip goes plain (the prototype's claimed frame): the
  // legacy NEW announcement must not re-fire for money the
  // player just took by hand, and the sheet speaks of the
  // claim, not of an arrival.
  const streakClaimKey = loginStreakClaimKey(streakResult, streakResultDay);
  const streakJustClaimed =
    !streakClaimable &&
    streakClaimKey !== null &&
    streakLastClaimedKey === streakClaimKey &&
    streakSeenClaimKey !== streakClaimKey;
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
      (streakClaimable
        ? `, day ${granted?.cycleDay ?? streakResult.loginStreak.cycleDay} reward ready to claim`
        : streakJustClaimed
          ? `, reward for day ${granted?.cycleDay ?? streakResult.loginStreak.cycleDay} claimed just now`
          : streakAnnouncement
            ? `, new grant banked for day ${granted?.streakLength}`
            : ', today checked in')
    : 'Daily streak';
  // The sheet's subtitle speaks the same tense as the panel: an
  // unpaid reward speaks in the present (it is ready, not
  // banked); a paid day speaks in the past tense — and a reward
  // the player just claimed by hand was never "granted on
  // arrival" (0079): it says claimed, just now.
  const streakSubtitle = !streakResult
    ? 'Daily check-in rewards'
    : streakClaimable
      ? `Daily check-in · Day ${granted?.cycleDay ?? streakResult.loginStreak.cycleDay} reward ready to claim`
      : streakJustClaimed
        ? `Daily check-in · Day ${granted?.cycleDay ?? streakResult.loginStreak.cycleDay} claimed just now`
        : granted && !granted.alreadyClaimed
          ? `Daily check-in · Day ${granted.cycleDay ?? streakResult.loginStreak.cycleDay} granted on arrival`
          : `Daily check-in · Day ${streakResult.loginStreak.cycleDay} claimed today`;
  const contractsLabel = !board
    ? 'Contracts'
    : contractsGuestLocked
      ? 'Contracts — sign in with Google to claim rewards'
      : claimable > 0
        ? `Contracts — ${claimable} ready to claim`
        : 'Contracts — none ready to claim';

  return (
    <>
      {/* The claim row (drift-fix F1): the same four doors as
          before, compressed from 52px stacked panels to one thin
          row of pills (DESIGN.md §4 step 2 — claim chips sit
          directly under the Strip). Every door, badge, pulse, and
          sheet is unchanged; badges keep their inset corner, and
          a pill carrying one reserves that corner in its padding
          (DESIGN.md §6: adapt the host, never shrink the type). */}
      <div data-testid="dashboard-top-bar" className="mb-3 flex items-stretch gap-2">
        {/* Level — LV chip + slim progress + readout on one line;
            the pill is the Return Sheet's door while a settlement
            exists (DESIGN.md §3/§10), and the level pop-up's door
            otherwise. The XP truth is the same curve the Strip's
            fused hairline reads. */}
        <button
          type="button"
          data-testid="top-level-button"
          aria-label={levelLabel}
          onClick={() => setSheet(lastSettlement ? 'return' : 'level')}
          className="bl-panel relative flex min-h-[40px] min-w-0 flex-1 items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left"
        >
          {awayPending && <PulseGlow color="#F2C063" testId="level-away-pulse" />}
          {awayPending && <CornerBadge text="AWAY" color="#F2C063" />}
          <span
            className="flex shrink-0 items-center gap-1 border-2 border-black/60 bg-amber px-1.5 py-0.5"
            aria-hidden
          >
            <span className="text-[11px] font-black tracking-widest text-black/70">LV</span>
            <span className="text-[13px] font-black leading-none text-black">{level}</span>
          </span>
          {/* While the AWAY badge is up, the progress block reserves
              the badge's corner (DESIGN.md §6) so the XP readout
              never tucks under the enlarged badge. */}
          <span className={`flex min-w-0 flex-1 items-center gap-2 ${awayPending ? 'pr-12' : ''}`}>
            <span className="block h-1.5 min-w-[12px] flex-1 overflow-hidden border border-black/50 bg-black/40">
              <motion.span
                className="block h-full bg-amber"
                initial={false}
                animate={{ width: `${xpProgress}%` }}
                transition={{ type: 'spring', damping: 20 }}
              />
            </span>
            <span className="shrink-0 whitespace-nowrap text-[11px] font-bold tabular-nums text-text-muted">
              {xp} / {xpNeeded} XP
            </span>
          </span>
        </button>

        {/* Daily streak — icon + pop-up door. While the NEW badge
            is up, the pill reserves its corner (pr-12): the badge
            is ~36px wide at its inset, so pr-10 left ~zero air and
            the label's last glyph ("Day 1" → "DAY ") tucked under
            it — the fix-pass defect on PR #293's captures. pr-12
            keeps the full label clear of the badge, the same
            reservation the level pill gives its AWAY badge. */}
        <button
          type="button"
          data-testid="top-streak-button"
          aria-label={streakLabel}
          onClick={() => setSheet('streak')}
          className={`bl-panel relative flex min-h-[40px] shrink-0 items-center gap-1.5 overflow-hidden px-2.5 py-1.5 ${streakClaimable ? 'pr-16' : streakAnnouncement && !streakJustClaimed ? 'pr-12' : ''}`}
        >
          {streakClaimable ? (
            <>
              <PulseGlow color="#FF8A00" testId="streak-claim-pulse" />
              <CornerBadge text="CLAIM" color="#FF8A00" />
            </>
          ) : streakAnnouncement && !streakJustClaimed ? (
            <>
              <PulseGlow color={STREAK_ACCENT} testId="streak-announce-pulse" />
              <CornerBadge text="NEW" color={STREAK_ACCENT} />
            </>
          ) : null}
          <PxIcon name="flame" size={15} />
          <span className="whitespace-nowrap text-[11px] font-black uppercase tracking-wider text-text-muted">
            {streakDay !== null ? `Day ${streakDay}` : 'Streak'}
          </span>
        </button>

        {/* Contracts — icon + pop-up door */}
        <button
          type="button"
          data-testid="top-contracts-button"
          aria-label={contractsLabel}
          onClick={() => setSheet('contracts')}
          className={`bl-panel relative flex min-h-[40px] shrink-0 items-center gap-1.5 overflow-hidden px-2.5 py-1.5 ${contractsPulsing ? 'pr-9' : contractsGuestLocked ? 'pr-16' : ''}`}
        >
          {contractsPulsing && <PulseGlow color={CONTRACTS_ACCENT} testId="contracts-claim-pulse" />}
          {contractsPulsing && <CornerBadge text={String(claimable)} color={CONTRACTS_ACCENT} />}
          {/* Assumption-gaps G10: the guest lock used to be a
              bare lock glyph — a badge with no visible why. In
              the badge language this row already speaks (AWAY,
              NEW, counts), the why prints as a word: GUEST. */}
          {contractsGuestLocked && <CornerBadge text="GUEST" color="#8A847C" />}
          <PxIcon name="orders" size={15} />
          <span className="whitespace-nowrap text-[11px] font-black uppercase tracking-wider text-text-muted">
            Orders
          </span>
        </button>

        {/* Weekly claimables — pill; renders only while a weekly
            Parts Crate / Signature Order is claimable (§9). */}
        {weeklyCount > 0 && (
          <button
            type="button"
            data-testid="top-weekly-button"
            aria-label={weeklyLabel}
            onClick={() => setSheet('weekly')}
            className="bl-panel relative flex min-h-[40px] shrink-0 items-center gap-1.5 overflow-hidden py-1.5 pl-2.5 pr-9"
          >
            <PulseGlow color={WEEKLY_ACCENT} testId="weekly-claim-pulse" />
            <CornerBadge text={String(weeklyCount)} color={WEEKLY_ACCENT} />
            <PxIcon name="crate" size={15} />
            <span className="whitespace-nowrap text-[11px] font-black uppercase tracking-wider text-text-muted">
              Weekly
            </span>
          </button>
        )}
      </div>

      {/* The announcement line — one chip at a time, directly
          under the claim row it belongs to (§4 step 2's block).
          Past tense and priced from the server's own records:
          the Sold amount is the proceeds the seller was actually
          credited (net of the sale fee, uplift included), and it
          has already pulsed the Strip's credits when it landed. */}
      {announcement === 'sold' && soldAnnouncement && (
        <button
          type="button"
          data-testid="announce-sold-chip"
          aria-label={
            soldAnnouncement.count === 1
              ? `Sold${soldAnnouncement.itemName ? ` — ${soldAnnouncement.itemName}` : ''}, +${soldAnnouncement.totalProceeds.toLocaleString()} credits. Opens your market trade history.`
              : `Sold — ${soldAnnouncement.count} items, +${soldAnnouncement.totalProceeds.toLocaleString()} credits. Opens your market trade history.`
          }
          onClick={openSold}
          className="bl-panel relative mb-3 flex min-h-[40px] w-full items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left"
        >
          <ClaimPulse color={SOLD_ACCENT} testId="announce-sold-pulse" />
          <PxIcon name="coin" size={15} />
          <span
            className="whitespace-nowrap text-[11px] font-black uppercase tracking-wider"
            style={{ color: SOLD_ACCENT }}
          >
            {soldAnnouncement.count === 1 ? 'Sold' : `Sold ×${soldAnnouncement.count}`}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-text-primary">
            {soldAnnouncement.count === 1
              ? (soldAnnouncement.itemName ?? 'Market listing')
              : 'Market listings'}
          </span>
          <span
            className="shrink-0 whitespace-nowrap text-[13px] font-black tabular-nums"
            style={{ color: SOLD_ACCENT }}
          >
            +{soldAnnouncement.totalProceeds.toLocaleString()} cr
          </span>
        </button>
      )}
      {announcement === 'bench' && benchAnnouncement && (
        <button
          type="button"
          data-testid="announce-bench-chip"
          aria-label={
            benchAnnouncement.count === 1
              ? `Bench ready — ${benchAnnouncement.latestName ?? 'a job'} finished. Opens the Workshop.`
              : `Bench ready — ${benchAnnouncement.count} jobs finished. Opens the Workshop.`
          }
          onClick={openBench}
          className="bl-panel relative mb-3 flex min-h-[40px] w-full items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left"
        >
          <ClaimPulse color={BENCH_ACCENT} testId="announce-bench-pulse" />
          <PxIcon name="anvil" size={15} />
          <span
            className="whitespace-nowrap text-[11px] font-black uppercase tracking-wider"
            style={{ color: BENCH_ACCENT }}
          >
            {benchAnnouncement.count === 1 ? 'Bench ready' : `Bench ready ×${benchAnnouncement.count}`}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-text-primary">
            {benchAnnouncement.count === 1
              ? (benchAnnouncement.latestName ?? 'Job finished')
              : 'Jobs finished at the Workshop'}
          </span>
          <PxIcon name="chevR" size={14} />
        </button>
      )}

      {/* Unspent skill points — the standing-action chip under the
          announcement line (see the derivation above). Amber is
          the claim/action color in this row's grammar; the count
          is the fact, and the tap lands on the trees themselves. */}
      {unspentSkillPoints > 0 && (
        <button
          type="button"
          data-testid="announce-points-chip"
          aria-label={`Skill points — ${unspentSkillPoints} unspent. Opens Hunter, Skill Trees.`}
          onClick={openSkillPoints}
          className="bl-panel relative mb-3 flex min-h-[44px] w-full items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left"
        >
          <ClaimPulse color="#FF9000" testId="announce-points-pulse" />
          <PxIcon name="nodes" size={15} />
          <span
            className="whitespace-nowrap text-[11px] font-black uppercase tracking-wider"
            style={{ color: '#FF9000' }}
          >
            Skill points
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-text-primary">
            {unspentSkillPoints} unspent — spend them in Skill Trees
          </span>
          <PxIcon name="chevR" size={14} />
        </button>
      )}

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
          subtitle={streakSubtitle}
          onClose={() => setSheet(null)}
        >
          <div className="p-3">
            {/* The panel's "Back to the hunt" acknowledges the
                grant (killing the pill's announcement) and closes
                the sheet through here. Closing via the sheet's
                own chrome leaves the announcement standing — the
                news stays announced until it is acknowledged. */}
            <LoginStreakPanel onDone={() => setSheet(null)} />
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
