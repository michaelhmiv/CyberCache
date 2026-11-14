import React from 'react';
import { createRoot } from 'react-dom/client';
import { PanelGaugesPage } from './PanelGaugesPage';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <PanelGaugesPage />
  </React.StrictMode>,
);
