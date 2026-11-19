import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// Store-screenshots market main (dash/store-shots): the
// market-mode backstop answers the Market browse page from the
// seed module (8 real-shaped player listings); the caller's own
// listings answer empty and price stats answer an empty book.
import { installShotsBackstop } from './shotsBackstop';

installShotsBackstop('market');

import { MarketHarnessPage } from './MarketHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <MarketHarnessPage />
    </React.StrictMode>,
  );
}
