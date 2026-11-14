import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

import { ChunkHarnessPage } from './ChunkHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <ChunkHarnessPage />
    </React.StrictMode>,
  );
}
