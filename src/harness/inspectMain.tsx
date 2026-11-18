import React from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';

// Inspect-sheet harness (first-screen fix R3): Chef API calls in
// the capture rig resolve same-origin — answer them fast and
// offline so mount-time reads settle immediately instead of
// riding the dev server's fallback. The one live answer is the
// Market browse page: MarketScreen fetches it on mount and syncs
// it into the shared market store the inspect sheet's intel tape
// reads, so the page served here IS the seed module's page (the
// dimmed rows behind the sheet and the intel numbers agree by
// construction). The caller's own listings (sellerId query)
// answer empty; price stats answer an empty book (the fetcher
// also tolerates failure on its own). Everything else 503s.
import { MARKET_PAGE } from './inspectSeed';

const realFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/market/listings')) {
    const body = url.includes('sellerId=')
      ? { listings: [], total: 0 }
      : MARKET_PAGE;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  if (url.includes('/market/price-stats')) {
    return Promise.resolve(
      new Response(JSON.stringify({ stats: {} }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
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

import { InspectHarnessPage } from './InspectHarnessPage';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <InspectHarnessPage />
    </React.StrictMode>,
  );
}
