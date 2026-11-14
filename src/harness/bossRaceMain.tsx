import React from 'react';
import { createRoot } from 'react-dom/client';
import { BossRacePage } from './BossRacePage';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BossRacePage />
  </React.StrictMode>,
);
