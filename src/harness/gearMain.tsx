import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { GearHarnessPage } from './GearHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <GearHarnessPage />
    </React.StrictMode>,
  );
}
