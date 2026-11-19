import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// Store-screenshots home-combat main (dash/store-shots): Chef
// reads answered offline by the shared backstop; the seeded
// stores carry every value the screen renders.
import { installShotsBackstop } from './shotsBackstop';

installShotsBackstop('offline');

import { HomeCombatHarnessPage } from './HomeCombatHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HomeCombatHarnessPage />
    </React.StrictMode>,
  );
}
