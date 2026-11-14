import React from 'react';
import { createRoot } from 'react-dom/client';
import { BossGaugesPage } from './BossGaugesPage';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BossGaugesPage />
  </React.StrictMode>,
);
