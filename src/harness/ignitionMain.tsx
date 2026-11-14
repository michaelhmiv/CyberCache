import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { IgnitionHarnessPage } from './IgnitionHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <IgnitionHarnessPage />
    </React.StrictMode>,
  );
}
