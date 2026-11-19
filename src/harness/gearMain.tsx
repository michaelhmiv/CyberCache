import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// Store-screenshots gear-inspect main (dash/store-shots): the
// market-mode backstop answers the Market browse page from the
// seed module, so the inspect sheet's intel tape and any market
// read agree with the seeded store; everything else 503s.
import { installShotsBackstop } from './shotsBackstop';

installShotsBackstop('market');

import { GearInspectHarnessPage } from './GearInspectHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <GearInspectHarnessPage />
    </React.StrictMode>,
  );
}
