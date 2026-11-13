/**
 * Dashboard Top Bar — the claim row + streak/contracts icon
 * pop-ups (owner's device feedback, 2026-11-01; the two-buttons
 * package, owner direction 2026-11-05).
 *
 * The top row of the home screen, directly under the ResourceBar
 * so it is on first paint without scrolling:
 *
 *  - CACHE + OFFLINE buttons (flex-1 pair, 2026-11-05): they
 *    replaced the LEVEL pill, whose LV badge + second XP bar +
 *    readout duplicated the Strip above it. CACHE carries the
 *    key-count bubble (the Strip's cache segment leaves Home —
 *    the count prints once) and opens the cache chest. OFFLINE
 *    shows the true pending held amount from the profile
 *    snapshot's offline_hold (server truth, synced into the
 *    player store — never client-computed earnings); while a
 *    hold waits it is a real claimable (pulse + CLAIM badge)
 *    and tapping CLAIMS the held settlement (migration 0083's
 *    hold-and-claim, the streak's 0079 model), landing on the
 *    Return Sheet as the receipt. With nothing held it is the
 *    Return Sheet's quiet door.
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
 * on the loot ladder's timings, one primary button, the push
 * primer in the footer once. The OFFLINE button is its door —
 * while a hold waits, the sheet shows the held amounts as
 * WAITING and its primary button is the Claim; after claiming
 * it is the receipt with Collect (acknowledge). The away
 * beacon moved with the door: the OFFLINE button pulses with
 * its CLAIM badge exactly while the server holds unpaid
 * earnings — the animation is never the only signal (badge
 * text + the pending figure + the accessible label carry the
 * same information). The level pop-up holds level specifics
 * ONLY; its doors are the Strip's LV segment (Home variant)
 * and this sheet's "Level details" row. The <5-minute
 * suppression and all settlement logic live in the recap
 * slice, untouched by this presentation.
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
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { motion, useReducedMotion } from 'framer-motion';
import { PickerSheet } from '@/components/common/PickerSheet';
import { ClaimPulse } from '@/components/common/ClaimPulse';
import { MobileCard } from '@/components/layout/MobileCard';
import { OfflineRecapCard } from '@/components/activity/OfflineRecap';
import { LoginStreakPanel } from './LoginStreakPanel';
import { ContractsPanel } from './ContractsPanel';
import { WeeklyClaimablesList } from './WeeklyClaimables';
import { useMarketStore, usePlayerStore, useSkillStore } from '@/store';
import { hasPayableOfflineHold } from '@/store/slices/playerSlice';
import { claimOfflineEarnings } from '@/lib/activity/activitySettlement';
import { xpBarTransition } from '@/lib/animation/uiMotion';
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
import { MAX_PLAYER_LEVEL, xpToNextLevel } from '@/content/simulation';

const STREAK_ACCENT = '#FF8A3D';
const CONTRACTS_ACCENT = '#E8B33D';
const WEEKLY_ACCENT = '#3FD6E8';

type TopSheet = 'level' | 'return' | 'streak' | 'contracts' | 'weekly' | null;

function CornerBadge({ text, icon, color }: { text?: string; icon?: PxIconName; color: string }) {
  // Fully INSIDE its host's top-right corner (QC papercut): the
  // badge used to protrude (-top-1.5 -right-1.5) and its host
  // button clipped at its own box — Tailwind overflow-hidden
  // plus .bl-panel's overflow:hidden + clip-path — so the
  // protruding half was sliced off at the button's top edge.
  // R3 (owner feedback, 2026-11-05): the badge is now a compact
  // corner TAB in the weekly count tab's manner — the label
  // hugged at px-[3px] py-px, tight-tracked (~40×13px for
  // the widest word, GUEST — not the old 44px-wide band) —
  // and its host is the key's transparent
  // HIT BOX (the 44px button, which carries no overflow or
  // clip of its own), so the papercut's guarantee survives the
  // move: the tab renders whole, never clipped, never at a
  // negative offset. The painted chip rides centered in the
  // hit box, 8px below its top, so the tab straddles the
  // chip's top-right corner while the glyphs — centered in
  // the chip — stay clear beneath it (the geometry probe
  // measures the clearance; qcPapercuts re-pins the position).
  // Size (owner ruling, 2026-11-02): the label renders at the
  // DESIGN.md §5 floor — 11px, never below. The badge got
  // SMALLER around the label; the floor did not move.
  return (
    <span
      className="absolute right-0 top-0 z-10 px-[3px] py-px text-[11px] font-black leading-none tracking-tight text-black"
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
  const reduceMotion = useReducedMotion();
  const level = usePlayerStore((s) => s.level);
  const xp = usePlayerStore((s) => s.xp);
  const cacheKeys = usePlayerStore((s) => s.cacheKeys);
  const offlineHold = usePlayerStore((s) => s.offlineHold);
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

  // The level pop-up's Home door: the Strip's LV segment (Home
  // variant) dispatches this event; the sheets live here.
  useEffect(() => {
    const openLevel = () => setSheet('level');
    window.addEventListener('cybercache:open-level-sheet', openLevel);
    return () => window.removeEventListener('cybercache:open-level-sheet', openLevel);
  }, []);

  const xpNeeded = xpToNextLevel(level);
  const xpProgress = xpNeeded > 0 ? Math.min(100, Math.round((xp / xpNeeded) * 100)) : 100;
  const xpRemaining = Math.max(0, xpNeeded - xp);

  // The OFFLINE button's truth (0083): the held settlement synced
  // from the profile snapshot — pending exactly while the server
  // holds something a claim would pay. The old away beacon read
  // the recap's dismissed flag; the beacon now reads the money.
  const holdPending = hasPayableOfflineHold(offlineHold);
  const [claiming, setClaiming] = useState(false);
  const handleOfflineTap = async () => {
    if (!holdPending) {
      // The Return Sheet's door (recap or its empty state).
      setSheet('return');
      return;
    }
    if (claiming) return;
    setClaiming(true);
    try {
      await claimOfflineEarnings({});
    } finally {
      setClaiming(false);
    }
    // The claim wrote the receipt into the recap store — the
    // Return Sheet is the landing moment. (A claim that found
    // nothing held still synced the profile: the button has
    // already quieted, and the sheet shows the latest recap.)
    setSheet('return');
  };

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

  // The OFFLINE button's spoken state: the held parts enumerated
  // while pending (the figure on the button is the credits leg);
  // the quiet state names its door.
  const offlineLabel = holdPending
    ? `Offline earnings waiting — ` +
      [
        offlineHold.credits > 0 ? `${offlineHold.credits.toLocaleString()} credits` : null,
        offlineHold.scrap > 0 ? `${offlineHold.scrap.toLocaleString()} scrap` : null,
        offlineHold.xp > 0 ? `${offlineHold.xp.toLocaleString()} XP` : null,
        offlineHold.cacheKeys > 0 ? `${offlineHold.cacheKeys} cache keys` : null,
        offlineHold.itemCount > 0
          ? `${offlineHold.itemCount} item${offlineHold.itemCount === 1 ? '' : 's'}`
          : null,
      ]
        .filter(Boolean)
        .join(', ') +
      '. Tap to claim.'
    : 'Offline earnings — nothing waiting. Opens your return summary.';
  const offlineFigure =
    offlineHold.credits > 0
      ? `+${offlineHold.credits.toLocaleString()} cr`
      : offlineHold.itemCount > 0
        ? `${offlineHold.itemCount} item${offlineHold.itemCount === 1 ? '' : 's'}`
        : 'Ready';
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
      {/* The claim row (drift-fix F1; the two-buttons package,
          2026-11-05): one thin row of pills directly under the
          Strip (DESIGN.md §4 step 2). The level pill is retired —
          its LV badge + second XP bar duplicated the Strip; the
          level pop-up's doors are the Strip's LV segment and the
          Return Sheet's door row. In its footprint: CACHE and
          OFFLINE.
          ICON-ONLY LAW (owner ruling, 2026-11-05): the row's
          controls carry NO word labels — icon + data only, on ONE
          line in every state. The owner's words: "just make those
          logos then without text — people will learn what the
          logos mean." This supersedes PR #402's flex-wrap fix,
          which he rejected outright ("that second line looks so
          bad"), and it is §6's own permitted shortening: the full
          words live in the aria-labels and print in full on every
          destination these keys open (the chest, the Return
          Sheet, the streak and contracts panels, the Rep Desk).
          What stays painted is DATA, never labels: the CACHE key
          bubble (the count's only print on Home), the OFFLINE
          pending figure, the streak day numeral, and the CLAIM /
          GUEST / count corner badges.
          FIT: with no label text, the old badge-corner padding
          reservations (64/48/36px of right padding, there so a
          badge could never tuck a label's last glyph) buy
          nothing, so they are gone. Each key is two zones: the
          CornerBadge keeps its inset top-right corner (absolute,
          unchanged), and the content rides a fixed stage below
          the badge band — the two never share a band at any
          width.
          THE LOOK (design fix, 2026-11-05 — the owner rejected
          #403's geometry-as-design: "Those logos look terrible"):
          #403 kept the label-era plates and shrank the glyphs to
          15px floor-huggers in their corners, so the wide keys
          read as empty slabs. This pass (impeccable layout +
          polish, DESIGN.md §6 alignment law) designs the row as
          ONE instrument rail: every key takes an EQUAL flex
          share at one height, so the row has a single
          rhythm instead of two slabs and two stubs; the icons
          stand large — the visual heroes of their keys — each
          tinted in its own key's accent,
          the color its CLAIM badge and pulse already speak (the
          key in the Strip's teal resource tint, §5; the clock in
          the offline gold; the calendar in the streak accent; the
          orders in the contracts green; the crate in the weekly
          sky); and each key's cluster (icon + its one data
          readout) centers optically on the shared content stage
          (a fixed band, mt-auto in the flex-col key,
          centered both axes), so icons share one center line
          across the row and the bubble/figure/numeral read as
          part of the icon, never as flotsam at a plate corner.
          R2 AMENDMENT (owner feedback on the presented r1
          captures, 2026-11-05: "They don't need to be so tall
          and reduce the spacing"): the rail compacts — keys
          56 → 48px (the tap-target floor is 44), the content
          stage 33 → 26px, the row gap 8 → 6px, key padding
          6 → 4px, cluster gap 6 → 4px. The icons come down
          26 → 24px — the minimum reduction the shorter key
          honestly allows: at 48px the badge band (the badge's
          bottom edge sits 21px below the key's top) plus a
          clear stage caps the stage at 26px, and 24 is the
          largest glyph that centers in it with the badge and
          content zones still clear — nowhere near the 15px
          #403 failure the heroes rule bans.
          Floors are sized from the clusters they must hold; the
          one deliberate asymmetry is OFFLINE pending, whose
          floor widens to carry its figure at full size — the
          row's one live claim earns the width (eye-leading:
          lead the eye to the money waiting). The widest state
          (pending hold + both word badges + weekly) sums
          ≈352px of the 386px row. Never wrap, never shrink
          the type.
          R3 AMENDMENT (owner feedback on the presented r2
          captures, 2026-11-05: "cut the button size in half,
          still too big" + the section-gap ruling below): the
          rail of plates is GONE. Each key is now a content-
          sized CHIP — 28px tall, ~48–57px wide, icon + its
          readout composed inline — roughly half the 92×48
          plate it replaces. What halves is the PAINT: the
          button itself stays a 44px-tall transparent hit box
          (h-11, min 44px wide) with the chip centered inside
          it, so the keys stay thumb-true while they read at
          half size. The row no longer stretches edge-to-edge:
          the chips dock at the column's left edge — the edge
          every other Home section starts from — on the same
          8px beat as everything else (gap-3 renders
          --cc-gap-md under .bl-page). The badges shrink to
          compact corner tabs (see CornerBadge): with no badge
          band to reserve, nothing forces the keys tall again.
          Icons stand at 20px — the largest the 28px chip
          honestly holds with the tab clear above them.
          SECTION-GAP LAW (same owner direction): ONE vertical
          gap — 8px, the system's --cc-gap-md — at every
          distinct-section boundary on Home (Strip → this row
          → mode rail → stage → belt → workspace → feed →
          deck). This row's mb-3 and the chips' mb-3 are gone:
          Home's stack owns the boundary, and the spacing
          probe (claim-row-look-captures) measures every
          boundary and asserts the one value.
          R4 AMENDMENT (owner feedback on the presented r3
          captures, 2026-11-05: "Space the cache etc buttons
          horizontal to fill that whole space"): the left dock
          is gone. The row now spreads its hit boxes across
          the full column width — justify-between over the
          gap-3 floor: the first key sits flush at the
          column's left edge, the last flush at its right
          edge, and the leftover width lands as EQUAL gaps
          between the keys, in the four-key everyday state
          and the five-key weekly state alike (the geometry
          probe reports every inter-key gap per state and
          asserts the equality). gap-3 stays as the minimum
          beat: the distribution adds on top of it, and the
          tightest honest state (weekly + a pending figure)
          still clears it by a wide margin. The hit boxes are
          flex items, so space-between can never overlap
          them — distribution only ever widens the gaps.
          Everything r3 settled is untouched: the paint (28px
          chips in 44px hit boxes, corner tabs, 20px icons),
          icon-only, one line, all data, and the vertical
          section-gap law. */}
      <div data-testid="dashboard-top-bar" className="flex items-center justify-between gap-3">
        {/* CACHE — the key count's one print on Home (the Strip's
            cache segment leaves Home in this package), as a
            bubble attached to the key icon in the chip on the
            button that spends them. */}
        <button
          type="button"
          data-testid="top-cache-button"
          aria-label={`Cache — ${cacheKeys} cache keys held. Opens the cache chest.`}
          onClick={() => onNavigate?.('chest')}
          className="relative flex h-11 min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <span data-chip className="bl-panel relative flex h-[28px] min-w-[48px] items-center justify-center gap-1 overflow-hidden px-1.5">
            <PxIcon name="key" size={20} className="text-[#3FD6E8]" />
            <span
              data-testid="top-cache-key-count"
              className="shrink-0 bg-amber px-1 py-px text-[12px] font-black leading-none tabular-nums text-black"
            >
              {cacheKeys}
            </span>
          </span>
        </button>

        {/* OFFLINE — the held settlement's door and claim. While
            the server holds unpaid earnings the button is a real
            claimable (pulse + CLAIM badge + the pending figure,
            the credits leg of the hold); tapping claims and
            lands on the Return Sheet receipt. Quiet — plain
            door to the Return Sheet — when nothing is held. */}
        <button
          type="button"
          data-testid="top-offline-button"
          aria-label={offlineLabel}
          aria-busy={claiming || undefined}
          disabled={claiming}
          onClick={() => void handleOfflineTap()}
          className="relative flex h-11 min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <span data-chip className="bl-panel relative flex h-[28px] min-w-[48px] items-center justify-center gap-1 overflow-hidden px-1.5">
            {holdPending && <ClaimPulse color="#F2C063" testId="offline-pending-pulse" />}
            <PxIcon name="clock" size={20} className="text-[#F2C063]" />
            {holdPending && (
              <span
                data-testid="top-offline-pending"
                className="shrink-0 whitespace-nowrap text-[13px] font-black leading-none tabular-nums"
                style={{ color: GAIN_GREEN }}
              >
                {claiming ? 'Claiming…' : offlineFigure}
              </span>
            )}
          </span>
          {holdPending && <CornerBadge text="CLAIM" color="#F2C063" />}
        </button>

        {/* Daily streak — icon + day numeral + pop-up door. The
            numeral is data (the current streak), not a label:
            it stays under the icon-only law. The CLAIM / NEW
            tab rides the hit box's top corner; the cluster
            rides centered in the chip below it, so the two
            never meet. */}
        <button
          type="button"
          data-testid="top-streak-button"
          aria-label={streakLabel}
          onClick={() => setSheet('streak')}
          className="relative flex h-11 min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <span data-chip className="bl-panel relative flex h-[28px] min-w-[48px] items-center justify-center gap-1 overflow-hidden px-1.5">
            {streakClaimable ? (
              <ClaimPulse color="#FF8A00" testId="streak-claim-pulse" />
            ) : streakAnnouncement && !streakJustClaimed ? (
              <ClaimPulse color={STREAK_ACCENT} testId="streak-announce-pulse" />
            ) : null}
            <PxIcon name="calendar" size={20} className="text-[#FF8A3D]" />
            {streakDay !== null && (
              <span className="whitespace-nowrap text-[13px] font-black leading-none tabular-nums text-text-secondary">
                {streakDay}
              </span>
            )}
          </span>
          {streakClaimable ? (
            <CornerBadge text="CLAIM" color="#FF8A00" />
          ) : streakAnnouncement && !streakJustClaimed ? (
            <CornerBadge text="NEW" color={STREAK_ACCENT} />
          ) : null}
        </button>

        {/* Contracts — icon + pop-up door. Badges: the claimable
            count while any contract can claim, else the GUEST
            word badge for the guest lock (assumption-gaps G10:
            the why prints as a word in the badge language, not
            a bare lock glyph). */}
        <button
          type="button"
          data-testid="top-contracts-button"
          aria-label={contractsLabel}
          onClick={() => setSheet('contracts')}
          className="relative flex h-11 min-h-[44px] min-w-[44px] items-center justify-center"
        >
          <span data-chip className="bl-panel relative flex h-[28px] min-w-[48px] items-center justify-center gap-1 overflow-hidden px-1.5">
            {contractsPulsing && <ClaimPulse color={CONTRACTS_ACCENT} testId="contracts-claim-pulse" />}
            <PxIcon name="orders" size={20} className="text-[#5EE8A0]" />
          </span>
          {contractsPulsing && <CornerBadge text={String(claimable)} color={CONTRACTS_ACCENT} />}
          {contractsGuestLocked && <CornerBadge text="GUEST" color="#8A847C" />}
        </button>

        {/* Weekly claimables — icon + count badge; renders only
            while a weekly Parts Crate / Signature Order is
            claimable (§9). */}
        {weeklyCount > 0 && (
          <button
            type="button"
            data-testid="top-weekly-button"
            aria-label={weeklyLabel}
            onClick={() => setSheet('weekly')}
            className="relative flex h-11 min-h-[44px] min-w-[44px] items-center justify-center"
          >
            <span data-chip className="bl-panel relative flex h-[28px] min-w-[48px] items-center justify-center gap-1 overflow-hidden px-1.5">
              <ClaimPulse color={WEEKLY_ACCENT} testId="weekly-claim-pulse" />
              <PxIcon name="crate" size={20} className="text-[#7DD0F0]" />
            </span>
            <CornerBadge text={String(weeklyCount)} color={WEEKLY_ACCENT} />
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
          className="bl-panel relative flex min-h-[40px] w-full items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left"
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
          className="bl-panel relative flex min-h-[40px] w-full items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left"
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
          className="bl-panel relative flex min-h-[44px] w-full items-center gap-2 overflow-hidden px-2.5 py-1.5 text-left"
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

      <PickerSheet
          open={sheet === 'level'}
          title={`Level ${level}`}
          subtitle={level >= MAX_PLAYER_LEVEL
            ? `${xp} XP · MAX LEVEL`
            : `${xp} / ${xpNeeded} XP · ${xpRemaining} to level ${level + 1}`}
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
                  transition={xpBarTransition(reduceMotion)}
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

      <PickerSheet open={sheet === 'return'} title="Return" onClose={() => setSheet(null)}>
          <div className="space-y-3 p-3">
            {/* The Return Sheet body (§10): totals row, best drop
                as a poster card on the loot ladder's timings, one
                primary button (Claim while held, Collect on the
                receipt), the push primer in the footer once — all
                inside OfflineRecapCard. With no settlement on
                record the sheet says so plainly: the OFFLINE
                button is this sheet's door in every state. */}
            {lastSettlement ? (
              <OfflineRecapCard onDone={() => setSheet(null)} />
            ) : (
              <MobileCard className="p-4">
                <p className="text-sm font-bold text-text-primary">Nothing held right now</p>
                <p className="mt-1 text-xs leading-relaxed text-text-muted">
                  Your hunter keeps roaming while you're away. Whatever the next stretch
                  earns is held here — claim it when you get back.
                </p>
              </MobileCard>
            )}
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

      <PickerSheet
          open={sheet === 'weekly'}
          title="Weekly Claimables"
          subtitle="Rep Desk weekly offers — the desk itself is at Market, Rep Desk"
          onClose={() => setSheet(null)}
        >
          <div className="p-3">
            <WeeklyClaimablesList />
          </div>
      </PickerSheet>

      <PickerSheet
          open={sheet === 'streak'}
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

      <PickerSheet
          open={sheet === 'contracts'}
          title="Contracts"
          subtitle="Daily & weekly work orders"
          onClose={() => setSheet(null)}
        >
          <div className="p-3">
            <ContractsPanel />
          </div>
      </PickerSheet>
    </>
  );
};
