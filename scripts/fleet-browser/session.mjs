/**
 * Fleet browser session type (CI overhaul, blueprint REPORT.md §6.3
 * fleet tie-in).
 *
 * The staging fleet plays real sessions every ~2h under the
 * assert-don't-log law, but it is API-level only: across 561 audited
 * sessions, ZERO referenced a UI flow, so a browser-only defect (the
 * decrypt hang is the type specimen) is structurally invisible to
 * it. This session type closes that hole at the layer where the
 * defects live. Per run it plays the REAL web build in Chromium
 * against the STAGING Chef and asserts:
 *
 *   1. one cache opened with a key -> the reveal deck appears
 *      (within the Sample B timing + slack budget);
 *   2. one roam fight -> the stage's pixels change across the fight
 *      AND the enemy region carries actor mass (not bare vista).
 *
 * How it runs: serves the repo's production `dist` on a local port
 * and proxies /api to the staging Chef (the latency audit's relay,
 * productised — serving the app same-origin is what routes its API
 * calls through the proxy). Guest session: the browser-outcome
 * assertions need no account progression (the initial bundle grants
 * every fresh guest 3 cache keys), and this type never touches the
 * fleet's archetype accounts.
 *
 * Output: ONE fleet-shaped JSON record printed to stdout and, when
 * FLEET_BROWSER_OUT is set, appended to that JSONL file:
 *   { type: "browser", at, ok, chef, assertions: [{name, ok, detail}] }
 * Exit code mirrors `ok` so a wrapper can treat it like any other
 * fleet session.
 *
 * Env:
 *   FLEET_CHEF_URL  staging Chef origin
 *                   (default https://cybercache-staging-chef-production.up.railway.app)
 *   DIST_DIR        built app to serve (default ./dist)
 *   FLEET_PORT      local port (default 3100)
 *   CHROME_PATH / PLAYWRIGHT_CORE  as in scripts/e2e/run.mjs
 */
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elementRegionStats, imageLumaGrid, gridDistance, captureClipPng } from '../e2e/pixels.mjs';

let chromium;
for (const candidate of [process.env.PLAYWRIGHT_CORE, 'playwright-core']) {
  if (!candidate) continue;
  try {
    ({ chromium } = await import(candidate));
    if (chromium) break;
  } catch { /* next */ }
}
if (!chromium) throw new Error('playwright-core not resolvable (set PLAYWRIGHT_CORE)');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CHEF = process.env.FLEET_CHEF_URL ?? 'https://cybercache-staging-chef-production.up.railway.app';
const DIST = process.env.DIST_DIR ?? path.join(ROOT, 'dist');
const PORT = Number(process.env.FLEET_PORT ?? 3100);
const BASE = `http://127.0.0.1:${PORT}`;
const SAMPLE_B = { Common: 900, Uncommon: 1000, Rare: 1100, Epic: 1400, Legendary: 2600 };
const ENEMY_REGION = { x: 0.52, y: 0.18, w: 0.44, h: 0.68 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain',
};

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const url = new URL(req.url, CHEF);
      const headers = { ...req.headers, host: url.host };
      delete headers['accept-encoding'];
      const preq = https.request(url, { method: req.method, headers }, (pres) => {
        const chunks = [];
        pres.on('data', (c) => chunks.push(c));
        pres.on('end', () => {
          const outHeaders = { ...pres.headers };
          delete outHeaders['content-length'];
          delete outHeaders['transfer-encoding'];
          res.writeHead(pres.statusCode ?? 502, outHeaders);
          res.end(Buffer.concat(chunks));
        });
      });
      preq.on('error', () => {
        res.writeHead(502);
        res.end('chef proxy error');
      });
      req.pipe(preq);
      return;
    }
    const clean = req.url.split('?')[0];
    let file = path.join(DIST, clean === '/' ? 'index.html' : clean);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      file = path.join(DIST, 'index.html'); // SPA fallback
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error(`no built app at ${DIST} — run npm run build first (or set DIST_DIR)`);
  }
  const assertions = [];
  const check = (name, ok, detail = '') => {
    assertions.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const server = await startServer();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
    });
    const context = await browser.newContext({
      viewport: { width: 412, height: 915 },
      deviceScaleFactor: 2,
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.getByText('Continue as Guest', { exact: false }).first().click({ timeout: 30000 });
    await page.waitForFunction(
      () => /GEAR/.test(document.body.innerText) && /HUNTER/.test(document.body.innerText),
      null,
      { timeout: 30000 },
    );
    await page.getByRole('button', { name: /^Collect$/ }).first().click({ timeout: 8000 }).catch(() => {});
    check('guest session established against staging', true, CHEF);

    // ── Roam fight: stage changes + enemy present ──
    await page.getByRole('button', { name: /Start Roam/i }).first().click({ timeout: 15000, force: true });
    let stageUp = false;
    for (let i = 0; i < 40 && !stageUp; i++) {
      stageUp = await page.evaluate(
        () => !!document.querySelector('[data-testid="roam-pixi-stage"], [data-testid="pixel-diorama-stage"]'),
      );
      if (!stageUp) await sleep(1500);
    }
    check('roam stage mounts', stageUp);
    if (stageUp) {
      const stage = page.locator('[data-testid="pixel-diorama-stage"], [data-testid="roam-pixi-stage"]').first();
      await sleep(3000);
      const stageBox = await stage.boundingBox();
      const grid1 = await imageLumaGrid(page, await captureClipPng(page, stageBox));
      const stats = await elementRegionStats(page, stage, ENEMY_REGION);
      await sleep(6000);
      const grid2 = await imageLumaGrid(page, await captureClipPng(page, stageBox));
      const dist = gridDistance(grid1, grid2);
      check('stage pixels change across the fight', dist !== null && dist > 1.5, `distance=${dist?.toFixed(2)}`);
      check(
        'enemy pixel mass present in enemy region',
        stats.nonBgMass > 0.05 && stats.distinct > 30,
        `nonBgMass=${stats.nonBgMass.toFixed(3)} distinct=${stats.distinct}`,
      );
    }

    // ── Cache: one key open, the reveal deck must land ──
    await page.locator('[data-testid="top-cache-button"]').click({ timeout: 15000 });
    await sleep(1500);
    const keys = await page.evaluate(() => {
      const m = document.body.innerText.match(/Keys:\s*(\d+)/);
      return m ? Number(m[1]) : null;
    });
    check('guest holds a cache key', keys !== null && keys >= 1, `keys=${keys}`);
    if (keys) {
      const t0 = Date.now();
      await page.getByRole('button', { name: /OPEN WITH KEY/i }).first().click({ timeout: 15000 });
      let momentAt = null;
      let deckAt = null;
      let rarity = null;
      while (Date.now() - t0 < 20000) {
        const s = await page.evaluate(() => ({
          moment: !!document.querySelector('[data-testid="cache-loot-moment"]'),
          deck: !!document.querySelector('[data-testid="cache-reveal-deck"]'),
          rarity:
            document.querySelector('[data-testid="cache-loot-moment"]')?.querySelector('[data-rarity]')?.getAttribute('data-rarity') ?? null,
        }));
        if (s.moment && momentAt === null) momentAt = Date.now() - t0;
        if (s.rarity) rarity = s.rarity;
        if (s.deck) {
          deckAt = Date.now() - t0;
          break;
        }
        await sleep(200);
      }
      const budget = (SAMPLE_B[rarity ?? 'Legendary'] ?? SAMPLE_B.Legendary) + 1500;
      check(
        'cache reveal deck appears within budget',
        deckAt !== null && momentAt !== null && deckAt - momentAt <= budget,
        `deckAt=${deckAt}ms momentAt=${momentAt}ms rarity=${rarity} budget=${budget}ms`,
      );
    }
  } finally {
    await browser?.close().catch(() => {});
    server.close();
  }
  const ok = assertions.every((a) => a.ok);
  const record = { type: 'browser', at: new Date().toISOString(), ok, chef: CHEF, assertions };
  console.log(JSON.stringify(record));
  if (process.env.FLEET_BROWSER_OUT) {
    fs.appendFileSync(process.env.FLEET_BROWSER_OUT, JSON.stringify(record) + '\n');
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
