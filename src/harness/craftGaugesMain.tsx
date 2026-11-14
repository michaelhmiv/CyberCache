import React from 'react';
import { createRoot } from 'react-dom/client';
import { CraftGaugesPage } from './CraftGaugesPage';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CraftGaugesPage />
  </React.StrictMode>,
);
