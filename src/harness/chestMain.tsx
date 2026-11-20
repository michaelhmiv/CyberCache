import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// Reveal-hold capture main (dash/reveal-hold-shots): the Chef
// calls the cache flow makes are answered offline by the chest
// backstop (lane read + one fixed Legendary grant); everything
// else the screen renders comes from the seeded stores.
import { installChestBackstop } from './chestBackstop';

installChestBackstop();

import { ChestHarnessPage } from './ChestHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <ChestHarnessPage />
    </React.StrictMode>,
  );
}
