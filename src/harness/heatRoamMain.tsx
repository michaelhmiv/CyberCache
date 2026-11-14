import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import { HeatRoamPage } from './HeatRoamPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HeatRoamPage />
    </React.StrictMode>,
  );
}
