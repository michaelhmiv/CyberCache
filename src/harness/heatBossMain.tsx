import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import { HeatBossPage } from './HeatBossPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HeatBossPage />
    </React.StrictMode>,
  );
}
