import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import { HeatResearchPage } from './HeatResearchPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HeatResearchPage />
    </React.StrictMode>,
  );
}
