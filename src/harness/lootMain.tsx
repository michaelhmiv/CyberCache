import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { LootHarnessPage } from './LootHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <LootHarnessPage />
    </React.StrictMode>,
  );
}
