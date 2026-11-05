/**
 * FeedbackDemo — PROTOTYPE harness (design/feedback-prototype,
 * 2026-11-04). NOT shipped UI: a fixture stage for the
 * feedback-legibility pass, served only at /feedback-demo
 * (main.tsx branches before the real app mounts).
 *
 * It mounts the REAL Strip (ResourceBar) and the REAL claim
 * row (DashboardTopBar → PickerSheet → LoginStreakPanel) over
 * seeded store state — a veteran wallet and a claimable Day 3
 * (or Day 7) streak — so the proposed beats can be driven and
 * captured at phone width:
 *
 *  - the streak claim: chip (CLAIM badge + pulse) → sheet →
 *    Claim button → landing celebration + Strip pulses;
 *  - scripted gains: a roaming tick (micro pulse), a market
 *    sale (full pulse), a salvage yield (scrap pulse).
 *
 * The claim transport is the slice's demo seam: it stands in
 * for POST /api/login-streak/claim, paying the seeded amounts
 * into the player store after a realistic delay. The stage
 * block below the claim row is scaffolding (the real Home
 * stage is being edited by a parallel builder) — nothing in
 * this file is a design proposal except the two surfaces
 * named above.
 */
import React, { useEffect } from 'react';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { DashboardTopBar } from '@/components/dashboard/DashboardTopBar';
import { usePlayerStore } from '@/store';
import {
  setLoginStreakClaimTransportForDemo,
  useLoginStreakStore,
} from '@/store/slices/loginStreakSlice';
import {
  loginStreakAddDays,
  loginStreakStateView,
  loginStreakUtcDay,
  resolveLoginStreakLevers,
  type LoginStreakClaim,
} from '@/content/loginStreak';
import type { ChefLoginStreakResult } from '@/lib/chef/chefClient';

const WALLET = {
  credits: 24100,
  scrap: 31600,
  cacheKeys: 15,
  cacheKeyFragments: 2,
  legendaryCores: 3,
  level: 12,
  xp: 340,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function claimableResult(cycleDay: 3 | 7): ChefLoginStreakResult {
  const today = loginStreakUtcDay(new Date());
  const yesterday = loginStreakAddDays(today, -1);
  const streakLength = cycleDay === 3 ? 3 : 7;
  const claim: LoginStreakClaim =
    cycleDay === 3
      ? { day: today, streakLength, cycleDay, tier: 1, creditsAwarded: 200, fragmentsAwarded: 1, cacheKeysAwarded: 0 }
      : { day: today, streakLength, cycleDay, tier: 1, creditsAwarded: 500, fragmentsAwarded: 3, cacheKeysAwarded: 1 };
  const view = loginStreakStateView(
    { currentStreak: streakLength - 1, longestStreak: 9, lastClaimDay: yesterday, todayClaim: claim },
    resolveLoginStreakLevers(),
    today,
  );
  return {
    verified: true,
    loginStreak: view,
    granted: {
      alreadyClaimed: false,
      claimable: true,
      streakLength: claim.streakLength,
      cycleDay: claim.cycleDay,
      tier: claim.tier,
      creditsAwarded: claim.creditsAwarded,
      fragmentsAwarded: claim.fragmentsAwarded,
      cacheKeysAwarded: claim.cacheKeysAwarded,
    },
    profile: null,
  };
}

function seed(cycleDay: 3 | 7): void {
  const result = claimableResult(cycleDay);
  usePlayerStore.getState().syncFromServer({ ...WALLET });
  useLoginStreakStore.setState({
    result,
    loadState: 'ready',
    resultDay: loginStreakUtcDay(new Date()),
    seenGrantKey: null,
    tickedGrantKey: null,
    claiming: false,
    claimError: false,
    lastClaimedGrantKey: null,
    seenClaimKey: null,
  });
  // The fixture transport: stands in for the claim POST. It
  // pays the seeded reward into the wallet (the profile sync
  // the real response would carry) and returns the post-claim
  // result — claimable spent, day recorded as claimed.
  setLoginStreakClaimTransportForDemo(async () => {
    await sleep(650);
    const p = usePlayerStore.getState();
    p.syncFromServer({
      credits: p.credits + result.granted.creditsAwarded,
      cacheKeyFragments: p.cacheKeyFragments + result.granted.fragmentsAwarded,
      cacheKeys: p.cacheKeys + result.granted.cacheKeysAwarded,
    });
    return {
      ...result,
      granted: { ...result.granted, claimable: false, alreadyClaimed: true },
    };
  });
}

function bump(partial: Partial<typeof WALLET>): void {
  const p = usePlayerStore.getState();
  const next: Partial<typeof WALLET> = {};
  (Object.keys(partial) as Array<keyof typeof WALLET>).forEach((k) => {
    next[k] = (p[k] as number) + (partial[k] as number);
  });
  p.syncFromServer(next);
}

const ACTIONS = {
  seed3: () => seed(3),
  seed7: () => seed(7),
  roamTick: () => bump({ credits: 17, scrap: 3, xp: 6 }),
  marketSale: () => bump({ credits: 1250 }),
  salvage: () => bump({ scrap: 45 }),
};

declare global {
  interface Window {
    __feedbackDemo?: typeof ACTIONS;
  }
}

export const FeedbackDemo: React.FC = () => {
  useEffect(() => {
    window.__feedbackDemo = ACTIONS;
    seed(3);
  }, []);

  const btn =
    'border border-[#453218] bg-[#241a10] px-2.5 py-2 text-[11px] font-black uppercase tracking-wide text-[#f5ecda] active:bg-[#2e2113]';

  return (
    <div className="min-h-screen bg-[#0b0805]">
      <div className="mx-auto w-[390px] max-w-full bg-[#171008] px-2 pb-6 pt-2">
        <ResourceBar />
        <div className="mt-2">
          <DashboardTopBar />
        </div>
        {/* Scaffolding — NOT a proposal: a stand-in for the Home
            stage so the claim row sits in its real composition
            (Strip → claim chips → stage). */}
        <div className="flex h-[300px] items-center justify-center border-2 border-dashed border-[#453218] bg-[#120c06] px-6 text-center">
          <span className="text-[11px] font-bold uppercase leading-relaxed tracking-wider text-[#9a8a6e]">
            Stage — demo scaffolding
            <br />
            (the claim row above is the real surface)
          </span>
        </div>
        <p className="mt-3 text-[11px] leading-snug text-[#9a8a6e]">
          Fixture: veteran wallet (24,100 cr · 31,600 scrap · LV 12) and a Day 3 streak reward
          recorded by the server but not yet claimed — 200 credits + 1 fragment, face-up behind the
          Claim button in the streak sheet.
        </p>
      </div>

      {/* Harness controls — outside the phone column's flow,
          fixed to the viewport foot; capture scripts drive the
          same actions through window.__feedbackDemo. */}
      <div className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap justify-center gap-1.5 bg-black/85 px-2 py-2">
        <button type="button" className={btn} onClick={ACTIONS.seed3}>Seed Day 3 claim</button>
        <button type="button" className={btn} onClick={ACTIONS.seed7}>Seed Day 7 claim</button>
        <button type="button" className={btn} onClick={ACTIONS.roamTick}>Roam tick +17cr/+3</button>
        <button type="button" className={btn} onClick={ACTIONS.marketSale}>Sale +1,250cr</button>
        <button type="button" className={btn} onClick={ACTIONS.salvage}>Salvage +45 scrap</button>
      </div>
    </div>
  );
};
