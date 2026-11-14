/**
 * C1 ceremony harness page (Stage Iteration C1, dev only) —
 * mounts the ceremony / sheet surfaces with seeded stores for
 * before/after captures at phone width. Driven by URL params:
 *
 *   surface  death | starter | streak-claimable | streak-claimed |
 *            streak-day7 | return | sheet
 *   timer    death only: ready (free recovery available, the
 *            ClaimPulse state) | waiting (4:37 on the clock)
 *   credits  death only: player balance for the paid row
 *   rarity   return only: the best drop's rarity (poster timing)
 *
 * Nothing here is imported by the app bundle; c1-harness.html is
 * served by the Vite dev server only. Seeds use the same fixture
 * shapes as the surfaces' own test suites.
 */
import React, { useState } from 'react';
import { DeathOverlay } from '@/components/action/DeathOverlay';
import { StarterBundleReveal } from '@/components/activity/StarterBundleReveal';
import { OfflineRecapCard } from '@/components/activity/OfflineRecap';
import { LoginStreakPanel } from '@/components/dashboard/LoginStreakPanel';
import { PickerSheet } from '@/components/common/PickerSheet';
import { useInitialBundleRevealStore } from '@/store/slices/initialBundleRevealSlice';
import {
  loginStreakClaimKey,
  useLoginStreakStore,
} from '@/store/slices/loginStreakSlice';
import { loginStreakUtcDay } from '@/content/loginStreak';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { usePlayerStore, useSurvivalStore } from '@/store';
import { Rarity } from '@/types/game';
import type { GearItem } from '@/types/items';

const params = new URLSearchParams(window.location.search);
const surface = params.get('surface') ?? 'sheet';

const MISS_RULE =
  'Miss a day and the streak restarts at Day 1 — your longest streak is kept on your profile.';

const ladder = (today: number) =>
  [1, 2, 3, 4, 5, 6, 7].map((cycleDay) => ({
    cycleDay,
    credits: [100, 150, 200, 250, 300, 400, 500][cycleDay - 1],
    fragments: 0,
    cacheKeys: cycleDay === 7 ? 1 : 0,
    state: cycleDay < today ? 'earned' : cycleDay === today ? 'today' : 'upcoming',
  }));

const streakResult = (day: number, claimable: boolean) => {
  const credits = [100, 150, 200, 250, 300, 400, 500][day - 1];
  const cacheKeys = day === 7 ? 1 : 0;
  return {
    verified: true,
    loginStreak: {
      currentStreak: day,
      longestStreak: 5,
      tier: 1,
      cycleDay: day,
      todayState: 'earned',
      todayClaimable: claimable,
      todayReward: { credits, fragments: 0, cacheKeys },
      nextReward: { credits: 250, fragments: 0, cacheKeys: 0 },
      nextStreakLength: day + 1,
      ladder: ladder(day),
      missRule: MISS_RULE,
    },
    granted: {
      alreadyClaimed: false,
      claimable,
      streakLength: day,
      cycleDay: day,
      tier: 1,
      creditsAwarded: credits,
      fragmentsAwarded: 0,
      cacheKeysAwarded: cacheKeys,
    },
    profile: null,
  } as never;
};

function seed() {
  if (surface === 'death') {
    const timer = params.get('timer') ?? 'ready';
    useSurvivalStore.setState({
      isDead: true,
      lastKilledBy: {
        monsterId: 'rust-hound',
        monsterName: 'Rust Hound',
        areaId: 'dustwaste_frontier',
        at: Date.now(),
      },
      resurrectionReadyAt: timer === 'ready' ? Date.now() - 1000 : Date.now() + 277_000,
    });
    usePlayerStore.setState({
      id: 'c1-harness',
      credits: Number(params.get('credits') ?? '1200'),
    });
  } else if (surface === 'starter') {
    useInitialBundleRevealStore.setState({
      grant: { credits: 500, scrap: 120, cacheKeys: 2, vehicleName: 'Dune Runner' },
    });
  } else if (surface === 'streak-claimable') {
    useLoginStreakStore.setState({
      result: streakResult(3, true),
      loadState: 'ready',
      resultDay: loginStreakUtcDay(new Date()),
    });
  } else if (surface === 'streak-claimed' || surface === 'streak-day7') {
    const day = surface === 'streak-day7' ? 7 : 3;
    const result = streakResult(day, false);
    const resultDay = loginStreakUtcDay(new Date());
    useLoginStreakStore.setState({
      result,
      loadState: 'ready',
      resultDay,
      lastClaimedGrantKey: loginStreakClaimKey(result, resultDay),
      seenClaimKey: null,
    });
  } else if (surface === 'return') {
    const rarity = (params.get('rarity') ?? 'Legendary') as Rarity;
    const best = {
      id: 'c1-best',
      name: 'Emberline Longshot',
      level: 12,
      rarity,
      affixes: [{}, {}],
      damagePerSecond: 148,
    } as unknown as GearItem;
    const filler = {
      id: 'c1-filler',
      name: 'Scrap Revolver',
      level: 9,
      rarity: Rarity.Common,
      affixes: [],
    } as unknown as GearItem;
    useOfflineRecapStore.setState({
      lastSettlement: {
        settled: true,
        held: false,
        areaId: 'dustwaste_frontier',
        areaName: 'Dustwaste Frontier',
        timeAway: '2h 34m',
        elapsedMs: 9_240_000,
        cappedMs: 9_240_000,
        capReached: false,
        capHours: 8,
        ticksSettled: 1848,
        startTick: 1000,
        endTick: 2848,
        profile: {},
        rewards: {
          creditsAwarded: 1240,
          scrapAwarded: 85,
          xpAwarded: 460,
          cacheKeysAwarded: 1,
          materials: {},
          essences: {},
          killsRecorded: 132,
          ticks: 1848,
        },
        items: [filler, best],
      } as never,
    });
  }
}

seed();

const SheetDemo: React.FC = () => {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ padding: 12 }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ color: '#FFC65C', fontWeight: 700 }}
      >
        Reopen sheet
      </button>
      <PickerSheet open={open} title="Level 12" subtitle="1,240 / 2,000 XP" onClose={() => setOpen(false)}>
        <div className="space-y-3 p-3">
          <p className="text-sm text-text-primary">
            Sheet body copy for the motion capture — the panel rides the shared sheet spring and the
            backdrop fades on the Enter tier. Closing runs the exit: panel down, backdrop out.
          </p>
          <p className="text-sm text-text-muted">
            A second paragraph keeps the sheet at a realistic height for the frame.
          </p>
        </div>
      </PickerSheet>
    </div>
  );
};

export const C1HarnessPage: React.FC = () => (
  <div style={{ minHeight: '100vh', background: '#0B0B10', boxSizing: 'border-box' }}>
    <div style={{ width: 390, margin: '0 auto' }} data-testid="c1-harness-root">
      {surface === 'death' && <DeathOverlay />}
      {surface === 'starter' && <StarterBundleReveal />}
      {(surface === 'streak-claimable' || surface === 'streak-claimed' || surface === 'streak-day7') && (
        <div style={{ padding: 12 }}>
          <LoginStreakPanel onDone={() => undefined} />
        </div>
      )}
      {surface === 'return' && (
        <div style={{ padding: 12 }}>
          <OfflineRecapCard />
        </div>
      )}
      {surface === 'sheet' && <SheetDemo />}
    </div>
  </div>
);
