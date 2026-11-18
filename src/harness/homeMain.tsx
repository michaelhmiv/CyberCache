import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// Round-3 home harness (craft-zoom package): Chef API calls in
// the capture rig resolve same-origin (audit H-01) — answer them
// fast and offline so mount-time reads settle immediately
// instead of riding the dev server's fallback. The seeded
// stores carry every value the screen renders; nothing here is
// imported by the app bundle.
const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/')) {
    return Promise.resolve(
      new Response(JSON.stringify({ error: 'harness offline' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return realFetch(input, init);
};

import { HomeHarnessPage } from './HomeHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <HomeHarnessPage />
    </React.StrictMode>,
  );
}
