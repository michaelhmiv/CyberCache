import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { BenchHarnessPage } from './BenchHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <BenchHarnessPage />
    </React.StrictMode>,
  );
}
