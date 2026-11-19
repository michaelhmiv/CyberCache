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

/**
 * The static compliance pages that stay public even in app-only mode.
 * The Play Console listings and AdMob's UMP consent form point at these
 * URLs (see docs/PLAY_CONSOLE_REQUIREMENTS.md), so the privacy URL has
 * to resolve for either to work. They are plain documents — no game
 * client, nothing executes — so serving them cannot mint the junk
 * guest accounts the gate exists to stop. Exactly these three; the
 * list is pinned by test so the carve-out cannot quietly grow.
 */
export const COMPLIANCE_PAGES = [
  'privacy-policy.html',
  'data-deletion.html',
  'support.html',
] as const;

/**
 * The AdMob app-ads.txt verification file. AdMob requires this exact
 * line served at the developer-website root
 * (https://chef-production.up.railway.app/app-ads.txt) before it will
 * lift the "store not linked / app-ads.txt not detected" limit on the
 * Android app (ca-app-pub-2708638041809482~7527406300). It is a plain
 * text file, not a compliance page, so it lives outside
 * COMPLIANCE_PAGES — but like them it must answer in app-only mode,
 * served as text/plain from the same dist build. The single line is
 * pinned by test so it cannot drift from what AdMob was given.
 */
export const APP_ADS_TXT_FILE = 'app-ads.txt';
export const APP_ADS_TXT_LINE =
  'google.com, pub-2708638041809482, DIRECT, f08c47fec0942fa0';

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
 * 200 so health probes keep working. The three static compliance pages
 * (COMPLIANCE_PAGES) keep serving: plain documents the store listings
 * point at, with nothing for a crawler to execute. The AdMob
 * app-ads.txt file keeps serving too, as text/plain at the root.
 * Everything else (/, /index.html, static asset paths, SPA routes) is
 * a plain 404: there is no page for a crawler to execute, so no guest
 * account gets minted.
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

  // The compliance pages stay public in app-only mode (see
  // COMPLIANCE_PAGES above): plain static documents from the same dist
  // build the client ships in, served at their exact paths.
  for (const page of COMPLIANCE_PAGES) {
    app.get(`/${page}`, (_req, res) => {
      res.sendFile(path.join(distDir, page));
    });
  }

  // app-ads.txt stays public in app-only mode too (see APP_ADS_TXT_FILE
  // above): AdMob's crawler fetches it from the developer-website root
  // to verify the app's publisher, so it must answer 200 as text/plain
  // even with the game page retired.
  app.get(`/${APP_ADS_TXT_FILE}`, (_req, res) => {
    res.type('text/plain').sendFile(path.join(distDir, APP_ADS_TXT_FILE));
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.status(404).type('text/plain').send('Not Found');
  });
}
