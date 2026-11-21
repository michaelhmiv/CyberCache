/**
 * PR #646 before/after harness fetch backstop (dev only). Chef API
 * calls in the capture rig resolve same-origin — answer the routes
 * the seeded screens read with the seed module's real-shaped
 * bodies, and fail everything else under /api/ fast (503) so
 * mount-time reads settle immediately and NO request can ever
 * reach a real backend from a capture run.
 */
import { ACTIVITY_PAGE, MARKET_PAGE, OWN_PAGE, buildApiBodies } from './pr646Seed';

export function installPr646Backstop() {
  const bodies = buildApiBodies();
  const realFetch = window.fetch.bind(window);
  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method === 'GET' && url.includes('/market/listings')) {
      return json(url.includes('sellerId=') ? OWN_PAGE : MARKET_PAGE);
    }
    if (method === 'GET' && url.includes('/market/price-stats')) {
      return json({ stats: {} });
    }
    if (method === 'GET' && url.includes('/activity-log/me')) {
      return json(ACTIVITY_PAGE);
    }
    if (method === 'GET' && url.includes('/research/me')) {
      return json({ verified: true, research: bodies.research });
    }
    if (method === 'GET' && url.includes('/cache-rank/me')) {
      return json({ verified: true, cacheRank: bodies.cacheRank });
    }
    if (method === 'GET' && url.includes('/standing/me')) {
      return json({ verified: true, standing: bodies.standing });
    }
    if (method === 'GET' && url.includes('/dispatch/me')) {
      return json({ verified: true, dispatch: bodies.dispatch });
    }
    if (url.includes('/api/') || url.includes('railway.app')) {
      return json({ error: 'harness offline' }, 503);
    }
    return realFetch(input, init);
  };
}
