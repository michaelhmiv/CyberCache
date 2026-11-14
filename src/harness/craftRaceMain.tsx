import React from 'react';
import { createRoot } from 'react-dom/client';
import { CraftRacePage } from './CraftRacePage';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CraftRacePage />
  </React.StrictMode>,
);
