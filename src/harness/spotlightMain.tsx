import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { SpotlightHarnessPage } from './SpotlightHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <SpotlightHarnessPage />
    </React.StrictMode>,
  );
}
