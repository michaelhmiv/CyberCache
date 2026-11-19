// Store-screenshots harness fetch backstop (dash/store-shots,
// dev only). Chef API calls in the capture rig resolve
// same-origin — answer them fast and offline so mount-time reads
// settle immediately instead of riding the dev server's fallback.
//
// mode 'offline': every /api/ call gets a fast 503; the seeded
// stores carry every value the screen renders.
//
// mode 'market': the Market browse page is answered with the
// seed module's real-shaped page (inspectSeed MARKET_PAGE), the
// caller's own listings (sellerId query) answer empty, and price
// stats answer an empty book — the pattern the inspect round's
// backstop proved against this exact screen. Everything else
// 503s.
import { MARKET_PAGE } from './inspectSeed';

export function installShotsBackstop(mode: 'offline' | 'market') {
  const realFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (mode === 'market' && url.includes('/market/listings')) {
      const body = url.includes('sellerId=') ? { listings: [], total: 0 } : MARKET_PAGE;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    if (mode === 'market' && url.includes('/market/price-stats')) {
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
}
