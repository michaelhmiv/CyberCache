import React from 'react';
import { createRoot } from 'react-dom/client';
import { RoamGaugesPage } from './RoamGaugesPage';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RoamGaugesPage />
  </React.StrictMode>,
);
