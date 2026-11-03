/**
 * Wiki W7 — UI orientation plates: recapture script.
 *
 * What this produces: 412-CSS-px screen captures of the shipped game
 * (four tabs, a gear inspect sheet, boss prep, the market Buy stop,
 * the Workshop) for use as ORIENTATION art in wiki pages
 * (Getting-Started / The-Board / Gear / The-Market). The raw frames
 * land in <out>/raw at 824x1830 (DPR 2); post-process them to 412 px
 * wide before committing (see "Post-processing" in the committed
 * copy at scripts/wiki-gen/capture-ui-plates.mjs).
 *
 * How it works — the same rig every recent slice used:
 *   1. Build the client from CURRENT master with
 *      VITE_CHEF_URL=http://127.0.0.1:<PORT> so every API call goes
 *      to the local origin.
 *   2. This script serves that build from a tiny same-origin relay:
 *      static files from dist/, and /api/* proxied server-side to
 *      the real Chef (default https://chef-production.up.railway.app,
 *      which auto-deploys master). Same-origin matters: the Chef's
 *      CORS allow-list does not include localhost browser origins.
 *   3. Playwright (chromium headless shell) opens the relay, taps
 *      "Continue as Guest" — a real guest account on the real Chef,
 *      real market/standings data (guest visibility law) — and drives
 *      the real UI: roams, cracks the free daily cache for real gear,
 *      equips a drop, opens its inspect sheet, reads boss intel.
 *      No harness, no InMemory twins, no seeded state beyond what a
 *      new guest actually receives and earns in the session.
 *
 * Post-processing (deterministic, PIL): downscale each raw frame to
 * 412 px wide (LANCZOS), save optimized PNG into wiki/images/ui/.
 * market-row.png is a crop of market-buy.png's first listing row,
 * taken at raw resolution and scaled to 412 wide the same way.
 *
 * Prerequisites: node 20+, and playwright-core ^1.57 resolvable from
 * this script's folder (run `npm i playwright-core@^1.57` beside the
 * script, or set PW_ANCHOR to any file inside a tree that has it in
 * node_modules). Chromium headless shell 1248 in ~/.cache/ms-playwright
 * (override with CHROMIUM_PATH).
 *
 * Env knobs:
 *   W7_DIST   — client build output (default: <cwd>/dist)
 *   W7_OUT    — capture output dir   (default: ./captures)
 *   W7_PORT   — relay port           (default: 3407)
 *   CHEF_ORIGIN — upstream Chef      (default: production)
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { appendFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const requireFrom = createRequire(process.env.PW_ANCHOR || import.meta.url);
const { chromium } = requireFrom('playwright-core');

const DIST = process.env.W7_DIST || join(process.cwd(), 'dist');
const OUT = process.env.W7_OUT || join(process.cwd(), 'captures');
const PORT = Number(process.env.W7_PORT || 3407);
const CHEF = (process.env.CHEF_ORIGIN || 'https://chef-production.up.railway.app').replace(/\/+$/, '');
const BASE = `http://127.0.0.1:${PORT}`;
mkdirSync(join(OUT, 'raw'), { recursive: true });
const log = (m) => { appendFileSync(join(OUT, 'capture-log.txt'), `${new Date().toISOString()} ${m}\n`); console.log(m); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- same-origin relay: static dist + /api proxy ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain' };
const relay = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const headers = { ...req.headers };
      delete headers.host; delete headers.origin; delete headers.referer;
      const up = await fetch(CHEF + url.pathname + url.search, {
        method: req.method, headers,
        body: body.length ? body : undefined,
      });
      const buf = Buffer.from(await up.arrayBuffer());
      res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/octet-stream' });
      res.end(buf);
      return;
    }
    let p = normalize(join(DIST, url.pathname));
    if (!p.startsWith(DIST)) { res.writeHead(403); res.end(); return; }
    let data;
    try { data = await readFile(p); }
    catch { data = await readFile(join(DIST, 'index.html')); p = join(DIST, 'index.html'); }
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
    res.end(data);
  } catch (e) {
    res.writeHead(502); res.end(String(e).slice(0, 200));
  }
});
await new Promise((r) => relay.listen(PORT, '127.0.0.1', r));
log(`relay on ${BASE} -> ${CHEF}, dist=${DIST}`);

// ---------- drive the real UI ----------
async function clickByText(page, re, tag, exact = false) {
  const loc = exact
    ? page.locator('button').filter({ hasText: new RegExp(`^${re}$`, 'i') })
    : page.getByRole('button', { name: new RegExp(re, 'i') });
  const ok = await loc.first().click({ timeout: 15000 })
    .then(() => true)
    .catch((e) => { log(`${tag} click "${re}" err: ${e.message.slice(0, 110)}`); return false; });
  if (ok) log(`${tag} clicked "${re}"`);
  return ok;
}
async function dumpButtons(page, tag) {
  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim()).filter(Boolean),
  ).catch(() => []);
  log(`${tag} buttons: ${JSON.stringify(buttons.slice(0, 70))}`);
  return buttons;
}
async function shoot(page, name, tag) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.screenshot({ path: join(OUT, 'raw', name), timeout: 90000 });
      log(`${tag} shot ${name}`);
      return;
    } catch (e) {
      log(`${tag} shot ${name} attempt ${attempt} err: ${e.message.slice(0, 100)}`);
      await sleep(3000);
    }
  }
}
async function closeSheet(page, tag) {
  // Sheets close via their chevron/back affordance; Escape is the
  // fallback. Verify with a marker check by the caller when needed.
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(700);
  await page.mouse.click(388, 205).catch(() => {}); // sheet chevron spot (boss select)
  await sleep(900);
  log(`${tag} sheet close attempted`);
}
async function collectIfPresent(page, tag) {
  const collect = page.getByRole('button', { name: /^collect$/i }).first();
  if ((await collect.count()) && (await collect.isVisible().catch(() => false))) {
    await collect.click({ timeout: 8000 }).then(() => log(`${tag} collect clicked`)).catch(() => {});
    await sleep(2500);
    return true;
  }
  return false;
}

try {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/home/hatch/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell',
    args: ['--no-proxy-server'],
  });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log('pageerror: ' + String(e).slice(0, 200)));

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => log('goto err: ' + e.message.slice(0, 120)));
  await sleep(2500);
  await clickByText(page, 'continue as guest', 'auth');
  await sleep(6000);
  await collectIfPresent(page, 'entry');
  await dumpButtons(page, 'home');

  // 1 — Home, top of the Board, standby (Getting-Started orientation)
  await shoot(page, 'home-top.png', 'home');

  // Roam a little so the stage is alive, then frame stage + workspace.
  await clickByText(page, 'start roam', 'roam');
  await sleep(20000);
  await collectIfPresent(page, 'roam');
  await page.evaluate(() => window.scrollBy(0, 430)).catch(() => {});
  await sleep(1200);
  // 2 — Home, stage + workspace, roaming (The-Board)
  await shoot(page, 'home-stage.png', 'home');
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(800);

  // Crack the free daily cache — the designed first-hour gear source.
  await clickByText(page, 'crack cache', 'cache');
  await sleep(5000);
  await clickByText(page, 'open free cache', 'cache');
  await sleep(6000);
  let cacheBtns = await dumpButtons(page, 'cache-open');
  if (!cacheBtns.some((t) => /^collect$/i.test(t))) {
    log('cache reveal not up; retrying open');
    await clickByText(page, 'open free cache', 'cache-retry');
    await sleep(6000);
  }
  await collectIfPresent(page, 'cache');
  await clickByText(page, 'done|close|back', 'cache');
  await sleep(1500);
  await clickByText(page, 'Home', 'nav', true);
  await sleep(3000);

  // 3 — Gear tab: equip via the slot picker, shoot the Split.
  // The slot blocks carry aria-labels ("Primary: empty — tap to
  // equip"); the inventory rows are clickable cards (not buttons).
  await clickByText(page, 'Gear', 'nav', true);
  await sleep(5000);
  const slot = page.locator('button[aria-label*="Primary: empty"]').first();
  await slot.click({ timeout: 15000 }).then(() => log('equip slot block clicked')).catch((e) => log('equip slot err: ' + e.message.slice(0, 110)));
  await sleep(2500);
  await dumpButtons(page, 'picker');
  // In the picker, a row tap opens the item's inspect sheet; the
  // row's own Equip button is what equips.
  await clickByText(page, '^equip$', 'picker-equip');
  await sleep(3000);
  await closeSheet(page, 'gear');
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(800);
  await shoot(page, 'gear-loadout.png', 'gear');

  // 4 — Inspect sheet: in #gear-inventory-section, tap the item row
  // (the card that carries the item's canvas render).
  const invRect = await page.evaluate(() => {
    const sec = document.querySelector('#gear-inventory-section');
    if (!sec) return null;
    const canvas = sec.querySelector('canvas');
    if (!canvas) return null;
    let row = canvas;
    for (let i = 0; i < 6 && row.parentElement; i++) { row = row.parentElement; if (row.getBoundingClientRect().width > 250) break; }
    row.scrollIntoView({ block: 'center' });
    const r = row.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (row.textContent ?? '').replace(/\s+/g, ' ').slice(0, 90) };
  }).catch(() => null);
  log(`inventory row: ${JSON.stringify(invRect)}`);
  if (invRect) await page.mouse.click(invRect.x, invRect.y).catch(() => {});
  await sleep(3000);
  await dumpButtons(page, 'inspect');
  await shoot(page, 'gear-inspect.png', 'gear');
  await page.keyboard.press('Escape').catch(() => {});
  await sleep(900);

  // 5 — Market tab, Buy stop
  await clickByText(page, 'Market', 'nav', true);
  await sleep(6000);
  await shoot(page, 'market-buy.png', 'market');

  // 6 — Hunter tab
  await clickByText(page, 'Hunter', 'nav', true);
  await sleep(5000);
  await shoot(page, 'hunter-profile.png', 'hunter');

  // 7 — Boss prep: Home -> Boss rail stop -> tap the Dune Tyrant card
  // in the target sheet -> the prep panel (intel, phases, belt, risk).
  await clickByText(page, 'Home', 'nav', true);
  await sleep(4000);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await clickByText(page, 'boss', 'rail');
  await sleep(3500);
  const tyrant = page.getByText('Dune Tyrant', { exact: true }).first();
  await tyrant.click({ timeout: 15000 }).then(() => log('boss card clicked')).catch((e) => log('boss card err: ' + e.message.slice(0, 110)));
  await sleep(5000);
  await dumpButtons(page, 'boss-prep');
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(600);
  await shoot(page, 'boss-prep.png', 'boss');
  await closeSheet(page, 'boss');

  // 8 — Workshop: the Gear tab's own Workshop stop renders the full
  // WorkshopScreen (the crafting catalog). The segment button's text
  // is exactly "Workshop".
  await clickByText(page, 'Gear', 'nav', true);
  await sleep(4000);
  await clickByText(page, 'Workshop', 'workshop-stop', true);
  await sleep(5000);
  await dumpButtons(page, 'workshop');
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(600);
  await shoot(page, 'workshop.png', 'workshop');

  await browser.close();
  log('DONE');
} catch (e) {
  log('FATAL: ' + String(e).slice(0, 300));
} finally {
  relay.close();
}
