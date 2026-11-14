import React from 'react';
import { createRoot } from 'react-dom/client';
import { PanelRacePage } from './PanelRacePage';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PanelRacePage />
  </React.StrictMode>,
);
