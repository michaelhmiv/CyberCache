import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { TempoHarnessPage } from './TempoHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <TempoHarnessPage />
    </React.StrictMode>,
  );
}
