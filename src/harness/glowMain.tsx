import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { GlowHarnessPage } from './GlowHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <GlowHarnessPage />
    </React.StrictMode>,
  );
}
