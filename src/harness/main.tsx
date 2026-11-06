import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { PixiHarnessPage } from './PixiHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <PixiHarnessPage />
    </React.StrictMode>,
  );
}
