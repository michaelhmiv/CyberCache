import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import { TickerRoamPage } from './ticker/TickerRoamPage';
import { TickerBossPage } from './ticker/TickerBossPage';
import { TickerCraftPage } from './ticker/TickerCraftPage';
import { TickerGatherPage } from './ticker/TickerGatherPage';
import { TickerResearchPage } from './ticker/TickerResearchPage';

/**
 * Ticker Ledger harness entry (iter-04, dev only).
 *   /ticker-harness.html?activity=roam|boss|craft|gather|research
 */
const activity = new URLSearchParams(window.location.search).get('activity') ?? 'roam';
const Page =
  activity === 'boss'
    ? TickerBossPage
    : activity === 'craft'
      ? TickerCraftPage
      : activity === 'gather'
        ? TickerGatherPage
        : activity === 'research'
          ? TickerResearchPage
          : TickerRoamPage;

const rootEl = document.getElementById('root');
if (rootEl) {
  // No StrictMode: the tape pages append ledger rows from effects,
  // and StrictMode's dev double-mount would post every row twice.
  createRoot(rootEl).render(<Page />);
}
