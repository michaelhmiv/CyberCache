import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { C1HarnessPage } from './C1HarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <C1HarnessPage />
    </React.StrictMode>,
  );
}
