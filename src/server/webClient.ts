/**
 * Web-client serving gate for the Chef server.
 *
 * The Chef is the app's API. It also historically served the built web
 * client from the same origin — but the game is app-only now: the public
 * production page only ever attracted crawlers, and every crawler that
 * executed the page minted a junk guest account on boot, polluting the
 * player numbers. Production therefore turns the page off with
 * SERVE_WEB_CLIENT=false while the API keeps answering untouched.
 *
 * Default is SERVE (any value except an explicit off), so local boots,
 * the staging service, CI, and the e2e-browser fixture — which serves
 * the production build locally and drives a real browser against it —
 * all keep the current behavior. Only production sets the flag off.
 */

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';

export const WEB_CLIENT_ENV_VAR = 'SERVE_WEB_CLIENT';

const OFF_VALUES = new Set(['false', '0', 'off', 'no']);

/**
 * The web client is served unless SERVE_WEB_CLIENT is explicitly off
 * ('false' / '0' / 'off' / 'no', any case). Unset or empty means serve —
 * the pre-gate behavior — so no existing boot changes by accident.
 */
export function isWebClientEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[WEB_CLIENT_ENV_VAR];
  if (raw === undefined) return true;
  const value = raw.trim().toLowerCase();
  if (value === '') return true;
  return !OFF_VALUES.has(value);
}

/**
 * Mounts the web-client surface on the app.
 *
 * Enabled: the static build + the SPA fallback, exactly as the server
 * has always served them.
 *
 * Disabled (production app-only mode): the API is untouched — requests
 * under /api fall through to the API routes (including the ones that
 * mount after this call, as Route B's do) — and /health keeps answering
 * 200 so health probes keep working. Everything else (/, /index.html,
 * static asset paths, SPA routes) is a plain 404: there is no page for
 * a crawler to execute, so no guest account gets minted.
 */
export function mountWebClient(app: Express, distDir: string, enabled: boolean): void {
  if (enabled) {
    // Static files — the React SPA
    app.use(express.static(distDir));

    // SPA fallback — all non-API routes serve index.html
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
    return;
  }

  console.log(
    `[cybercache] web client disabled (${WEB_CLIENT_ENV_VAR} off) — API only`,
  );

  // The health probe answers at /health as well as /api/health in
  // app-only mode (with the page gone, the SPA fallback that used to
  // answer it no longer exists).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', chef: 'ready' });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.status(404).type('text/plain').send('Not Found');
  });
}
