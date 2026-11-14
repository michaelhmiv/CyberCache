import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import { HeatGatherPage } from './HeatGatherPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HeatGatherPage />
    </React.StrictMode>,
  );
}
