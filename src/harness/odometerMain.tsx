import React from 'react';
import { createRoot } from 'react-dom/client';
import { OdometerHarnessPage } from './OdometerHarnessPage';
import '../index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OdometerHarnessPage />
  </React.StrictMode>,
);
