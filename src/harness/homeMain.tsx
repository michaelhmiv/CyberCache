import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// R2 bars-render home harness: Chef API calls in the capture
// rig resolve same-origin — answer them fast and offline so
// mount-time reads settle immediately. Two endpoints carry
// seeded payloads because the panels under render read their
// facts from the Chef, not from stores:
//
//   /endless/me       — the REAL endlessIntel() for the seed's
//                       start level (real fee, real death rule),
//                       plus the prep history or the active run
//                       (?state=endless-run), whose escrow
//                       mirrors ./barsSeed so the panel and the
//                       ChamberRundown zone cannot disagree.
//   /extraction/state — ./barsSeed's paused Deep Delve, served
//                       verbatim so the panel and the
//                       ExtractRundown zone read one state.
//
// Everything else under /api/ gets the offline 503; the seeded
// stores carry the rest of the screen. Nothing here is
// imported by the app bundle.
import { endlessIntel } from '@/content/endless';
import type { ChefEndlessMeResult, ChefEndlessRun } from '@/lib/chef/chefClient';
import { BARS_ENDLESS_RUN, BARS_EXTRACTION_STATE } from './barsSeed';

const pageParams = new URLSearchParams(window.location.search);
const pageState = pageParams.get('state') ?? 'boss';

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const pastRun = (over: Partial<ChefEndlessRun>): ChefEndlessRun => ({
  id: 'run-prev-1',
  status: 'banked',
  started_at: '2026-11-16T14:02:00.000Z',
  ended_at: '2026-11-16T14:31:00.000Z',
  start_level: 16,
  risk: 'balanced',
  prepared_consumables: {},
  depth_reached: 9,
  escrow_credits: 0,
  escrow_xp: 0,
  escrow_scrap: 0,
  entry_fee: 250,
  milestone_drops: [5],
  paid_credits: 2210,
  paid_xp: 6100,
  paid_scrap: 388,
  payout_fraction: 1,
  ...over,
});

function endlessMe(): ChefEndlessMeResult {
  if (pageState === 'endless-run') {
    return {
      verified: true,
      intel: endlessIntel(BARS_ENDLESS_RUN.startLevel, 1),
      bestDepth: BARS_ENDLESS_RUN.bestDepth,
      runsStartedToday: 1,
      recentRuns: [],
      activeRun: {
        id: 'run-harness-1',
        status: 'active',
        started_at: '2026-11-17T23:52:00.000Z',
        ended_at: null,
        start_level: BARS_ENDLESS_RUN.startLevel,
        risk: 'balanced',
        prepared_consumables: { AmmoPack: 1 },
        depth_reached: BARS_ENDLESS_RUN.depthReached,
        escrow_credits: BARS_ENDLESS_RUN.escrowCredits,
        escrow_xp: BARS_ENDLESS_RUN.escrowXp,
        escrow_scrap: BARS_ENDLESS_RUN.escrowScrap,
        entry_fee: 300,
        milestone_drops: [5],
        paid_credits: 0,
        paid_xp: 0,
        paid_scrap: 0,
        payout_fraction: 0,
      },
    };
  }
  return {
    verified: true,
    intel: endlessIntel(18, 0),
    bestDepth: 9,
    runsStartedToday: 0,
    recentRuns: [
      pastRun({}),
      pastRun({
        id: 'run-prev-2',
        status: 'died',
        depth_reached: 4,
        milestone_drops: [],
        paid_credits: 310,
        paid_xp: 700,
        paid_scrap: 95,
        payout_fraction: 0.5,
      }),
    ],
    activeRun: null,
  };
}

const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/endless/me')) return json(endlessMe());
  if (url.includes('/extraction/state')) return json({ verified: true, extraction: BARS_EXTRACTION_STATE });
  if (url.includes('/api/')) {
    return json({ error: 'harness offline' }, 503);
  }
  return realFetch(input, init);
};

import { HomeHarnessPage } from './HomeHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HomeHarnessPage />
    </React.StrictMode>,
  );
}
