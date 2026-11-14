import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { AnatomyHarnessPage } from './AnatomyHarnessPage';
const rootEl = document.getElementById('root');
if (rootEl) createRoot(rootEl).render(<React.StrictMode><AnatomyHarnessPage /></React.StrictMode>);
