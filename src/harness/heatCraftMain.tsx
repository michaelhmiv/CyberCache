import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import { HeatCraftPage } from './HeatCraftPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HeatCraftPage />
    </React.StrictMode>,
  );
}
