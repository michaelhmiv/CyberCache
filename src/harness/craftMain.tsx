import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// Store-screenshots craft main (dash/store-shots): Chef reads
// answered offline by the shared backstop; the seeded stores
// carry every value the screen renders.
import { installShotsBackstop } from './shotsBackstop';

installShotsBackstop('offline');

import { CraftHarnessPage } from './CraftHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <CraftHarnessPage />
    </React.StrictMode>,
  );
}
