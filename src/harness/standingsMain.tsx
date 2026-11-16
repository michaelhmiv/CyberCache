import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import { StandingsHarnessPage } from './StandingsHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <StandingsHarnessPage />
    </React.StrictMode>,
  );
}
