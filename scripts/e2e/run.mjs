/**
 * Lane 1 — `e2e-browser` driver (CI overhaul, blueprint REPORT.md §6.3).
 *
 * Boots the PRODUCTION build (served by the real Chef server against
 * a local Postgres fixture) in Chromium with SwiftShader WebGL, phone
 * viewport, 4x CPU throttle, and PLAYS the core flows as a guest,
 * asserting outcomes — the class of gate whose absence let an
 * invisible enemy, a hanging decrypt, a black-flash stage, and a
 * collapsing gear list all ship through green CI.
 *
 * Usage:
 *   node scripts/e2e/run.mjs [case ...]        (default: all cases)
 * Env:
 *   E2E_BASE    server origin (default http://127.0.0.1:3000)
 *   E2E_OUT     artifact dir (default ./e2e-out)
 *   CHROME_PATH Chromium executable (else: Playwright cache lookup)
 *   E2E_DATABASE_URL  fixture DB (boss-case level seed; optional)
 *
 * Exit code: 0 when every run case passes, 1 otherwise. Per-case
 * JSON + screenshots land in E2E_OUT for the workflow artifact.
 *
 * Design rules carried from the blueprint:
 *  - Every assertion is written so the audited defect FAILS it.
 *  - No dev instrumentation: production probe surfaces are
 *    import.meta.env.DEV-gated, so presence is proven from rendered
 *    pixels + shipped DOM testids only.
 *  - Budgets are the blueprint's initial values (§6.3 budgets
 *    summary); calibration notes live in scripts/e2e/README.md.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { elementRegionStats, imageLumaGrid, gridDistance, captureClipPng } from './pixels.mjs';

let chromium;
for (const candidate of [process.env.PLAYWRIGHT_CORE, 'playwright-core']) {
  if (!candidate) continue;
  try {
    ({ chromium } = await import(candidate));
    if (chromium) break;
  } catch { /* next candidate */ }
}
if (!chromium) throw new Error('playwright-core not resolvable (set PLAYWRIGHT_CORE)');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3000';
const OUT = process.env.E2E_OUT ?? path.resolve(HERE, '..', '..', 'e2e-out');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Budgets (blueprint §6.3, initial values) ─────────────────────
const BUDGET = {
  tabMarkerMs: 2500, // content marker per tab switch, throttled
  longtaskMaxMs: 1000, // no single longtask above this during a switch
  decryptSlackMs: 1500, // over the Sample B rarity timing
  sampleB: { Common: 900, Uncommon: 1000, Rare: 1100, Epic: 1400, Legendary: 2600 },
  gearArtSettleMs: 5000, // visible-row art leaves "pending" (blueprint: 3s; calibrated, see README)
  gearRowCap: 120, // mounted rows at 2,366 items (fix cap 96 + overscan headroom)
  enemyPlateChangeMs: 45000, // enemy HP plate must move within this window
  bossFinishMs: 150000,
};

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = spawnSync('bash', ['-lc', 'find ~/.cache/ms-playwright -name chrome -type f 2>/dev/null | head -1'], {
    encoding: 'utf8',
  });
  const p = (found.stdout ?? '').trim();
  return p || undefined;
}

const INIT_SCRIPT = `
window.__e2e = { longtasks: [], roamPixiMounts: 0 };
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__e2e.longtasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true });
} catch {}
document.addEventListener('DOMContentLoaded', () => {
  const seen = new WeakSet();
  const scan = (node) => {
    if (!(node instanceof Element)) return;
    if (node.matches && node.matches('[data-testid="roam-pixi-stage"]') && !seen.has(node)) {
      seen.add(node);
      window.__e2e.roamPixiMounts++;
    }
    node.querySelectorAll && node.querySelectorAll('[data-testid="roam-pixi-stage"]').forEach((el) => {
      if (!seen.has(el)) { seen.add(el); window.__e2e.roamPixiMounts++; }
    });
  };
  new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(scan); })
    .observe(document.documentElement, { subtree: true, childList: true });
});
`;

const MARKERS = {
  HOME: `!!document.querySelector('[data-testid="roam-pixi-stage"], [data-testid="pixel-diorama-stage"]')`,
  GEAR: `!!document.querySelector('[data-testid="action-loadout"]')`,
  MARKET: `/Vendor/.test(document.body.innerText) && /Filters/.test(document.body.innerText)`,
  HUNTER: `!!document.querySelector('[data-testid="hunter-section-hub"]')`,
};

// Regions (fractions of the stage element box). The roam layout puts
// the hunter left / enemy right on a shared ground line; the boss
// stage mirrors it. Calibrated against audit captures (REPORT §3).
const ENEMY_REGION = { x: 0.52, y: 0.18, w: 0.44, h: 0.68 };
const BOSS_REGION = { x: 0.52, y: 0.12, w: 0.46, h: 0.74 };

class Case {
  constructor(name) {
    this.name = name;
    this.assertions = [];
    this.notes = [];
  }
  check(name, ok, detail = '') {
    this.assertions.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
    return !!ok;
  }
  note(text) {
    this.notes.push(String(text).slice(0, 400));
    console.log(`  [note] ${text}`);
  }
  get ok() {
    return this.assertions.every((a) => a.ok);
  }
}

async function newGuestContext(browser) {
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2,
    reducedMotion: 'no-preference',
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36',
  });
  await context.addInitScript(INIT_SCRIPT);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const responses = [];
  page.on('response', (res) => {
    try {
      const u = new URL(res.url());
      if (u.pathname.startsWith('/api/')) {
        responses.push({ method: res.request().method(), path: u.pathname, status: res.status() });
      }
    } catch { /* non-URL response */ }
  });
  // Aborted/failed requests emit no 'response' — record them too, so
  // an interception case can prove its sabotage actually engaged.
  const failures = [];
  page.on('requestfailed', (req) => {
    try {
      const u = new URL(req.url());
      if (u.pathname.startsWith('/api/')) {
        failures.push({ method: req.method(), path: u.pathname, error: req.failure()?.errorText ?? '' });
      }
    } catch { /* non-URL request */ }
  });
  const pageErrors = [];
  page.on('pageerror', (e) => {
    pageErrors.push(String(e).slice(0, 200));
    console.log('  [pageerror]', String(e).slice(0, 200));
  });
  const consoleMsgs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMsgs.push(`${msg.type()}: ${msg.text().slice(0, 160)}`);
      if (consoleMsgs.length > 24) consoleMsgs.shift();
    }
  });
  return { context, page, responses, failures, pageErrors, consoleMsgs };
}

async function guestSignIn(page, { dismissCollect = true } = {}) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue as Guest', { exact: false }).first().click({ timeout: 30000 });
  await page.waitForFunction(
    () => /GEAR/.test(document.body.innerText) && /HUNTER/.test(document.body.innerText),
    null,
    { timeout: 30000 },
  );
  if (dismissCollect) {
    await page
      .getByRole('button', { name: /^Collect$/ })
      .first()
      .click({ timeout: 8000 })
      .catch(() => {});
  }
  await page.waitForFunction((m) => eval(m), MARKERS.HOME, { timeout: 30000 });
}

async function clickTab(page, tab) {
  const btn = page.locator('button').filter({ hasText: new RegExp(`^\\s*${tab}\\s*$`, 'i') }).last();
  await btn.click({ timeout: 15000, force: true });
}

async function measureSwitch(page, toTab) {
  const lt0 = await page.evaluate(() => window.__e2e.longtasks.length);
  const t0 = Date.now();
  await clickTab(page, toTab);
  let markerMs = null;
  while (Date.now() - t0 < 9000) {
    const hit = await page.evaluate((m) => eval(m), MARKERS[toTab]).catch(() => false);
    if (hit) {
      markerMs = Date.now() - t0;
      break;
    }
    await sleep(50);
  }
  const lts = await page.evaluate((n) => window.__e2e.longtasks.slice(n), lt0);
  return {
    to: toTab,
    markerMs,
    longtaskMax: lts.reduce((a, b) => Math.max(a, b.dur), 0),
    longtaskTotal: lts.reduce((a, b) => a + b.dur, 0),
    longtaskCount: lts.length,
  };
}

async function shot(page, name) {
  const file = path.join(OUT, name);
  try {
    await page.screenshot({ path: file, timeout: 20000 });
  } catch {
    // Evidence capture must not depend on Playwright's font wait —
    // fall back to a raw CDP surface capture written directly.
    try {
      const box = await page.evaluate(() => ({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight }));
      const png = await captureClipPng(page, box);
      fs.writeFileSync(file, png);
    } catch { /* evidence is best-effort; assertions carry the verdict */ }
  }
  return file;
}

// ── Case: enemy presence (blueprint assertion 1) ─────────────────
async function caseEnemyPresence(browser) {
  const c = new Case('enemy-presence');
  const { context, page } = await newGuestContext(browser);
  try {
    await guestSignIn(page);
    await page.getByRole('button', { name: /Start Roam/i }).first().click({ timeout: 15000, force: true });
    let pixiUp = false;
    for (let i = 0; i < 40 && !pixiUp; i++) {
      pixiUp = await page.evaluate(() => !!document.querySelector('[data-testid="roam-pixi-stage"]'));
      if (!pixiUp) await sleep(1500);
    }
    c.check('pixi roam stage mounts', pixiUp);
    if (!pixiUp) return c;
    const stage = page.locator('[data-testid="pixel-diorama-stage"]').first();
    // The enemy walks in over ~850ms of stage time; sample after the
    // walk-in window, twice, and require actor mass in the enemy
    // region on the settled stage. (The alpha-0 defect leaves the
    // region as bare vista forever, so this fails on it by design.)
    await sleep(2500);
    const s1 = await elementRegionStats(page, stage, ENEMY_REGION);
    await sleep(3000);
    const s2 = await elementRegionStats(page, stage, ENEMY_REGION);
    console.log('  enemy region samples:', JSON.stringify({ s1, s2 }));
    c.check(
      'enemy pixel mass present in enemy region',
      s2.nonBgMass > 0.05 && s2.distinct > 30,
      `nonBgMass=${s2.nonBgMass.toFixed(3)} distinct=${s2.distinct} modalShare=${s2.modalShare.toFixed(2)}`,
    );
    c.check('stage is not a stranded black canvas', s2.meanLuma > 12, `meanLuma=${s2.meanLuma.toFixed(1)}`);
    await shot(page, 'enemy-presence.png');
    // HP plate: the plate percent must move within the window —
    // damage lands per claimed tick, so a plate frozen at its first
    // reading across ~15 ticks is the frozen-plate failure shape.
    const plateOf = () =>
      page.evaluate(() => {
        const m = document.body.innerText.match(/([A-Z][A-Z ']{3,30})\s*\n?\s*(\d{1,3})%/);
        return m ? { name: m[1].trim(), pct: Number(m[2]) } : null;
      });
    const first = await plateOf();
    c.check('enemy HP plate readable', !!first, JSON.stringify(first));
    let changed = false;
    const deadline = Date.now() + BUDGET.enemyPlateChangeMs;
    while (first && Date.now() < deadline) {
      const now = await plateOf();
      if (now && (now.pct !== first.pct || now.name !== first.name)) {
        changed = true;
        break;
      }
      await sleep(1500);
    }
    c.check('enemy HP plate changes within the tick window', changed, `first=${JSON.stringify(first)}`);
  } finally {
    await context.close().catch(() => {});
  }
  return c;
}

// ── Case: tab-switch budget (blueprint assertion 2 + Wave 2 H-06) ─
async function caseTabBudget(browser) {
  const c = new Case('tab-switch-budget');
  const { context, page, responses } = await newGuestContext(browser);
  try {
    await guestSignIn(page);
    // H-06: the fresh-guest bootstrap must fire the initial-bundle op
    // exactly once and surface no 4xx before Home is interactive.
    const bundlePosts = responses.filter((r) => r.method === 'POST' && r.path === '/api/ops/initial-bundle');
    c.check('initial-bundle POST fires exactly once (H-06)', bundlePosts.length === 1, `count=${bundlePosts.length}`);
    const bootstrapErrors = responses.filter((r) => r.status >= 400);
    c.check('no >=400 API responses during bootstrap (H-06)', bootstrapErrors.length === 0, JSON.stringify(bootstrapErrors.slice(0, 4)));
    // Roam first so the Pixi stage exists; its init count is the
    // keep-alive tripwire for the whole switch sequence.
    await page.getByRole('button', { name: /Start Roam/i }).first().click({ timeout: 15000, force: true }).catch(() => {});
    let pixiUp = false;
    for (let i = 0; i < 40 && !pixiUp; i++) {
      pixiUp = await page.evaluate(() => !!document.querySelector('[data-testid="roam-pixi-stage"]'));
      if (!pixiUp) await sleep(1500);
    }
    c.check('roam stage live before switch sequence', pixiUp);
    const sequence = ['GEAR', 'HOME', 'MARKET', 'HOME', 'HUNTER', 'HOME', 'GEAR', 'HOME'];
    for (const to of sequence) {
      const m = await measureSwitch(page, to);
      console.log(`  switch ->${to}:`, JSON.stringify(m));
      c.check(
        `${to} content marker within ${BUDGET.tabMarkerMs}ms`,
        m.markerMs !== null && m.markerMs <= BUDGET.tabMarkerMs,
        `marker=${m.markerMs}ms`,
      );
      c.check(
        `${to} switch has no longtask over ${BUDGET.longtaskMaxMs}ms`,
        m.longtaskMax <= BUDGET.longtaskMaxMs,
        `max=${m.longtaskMax}ms total=${m.longtaskTotal}ms n=${m.longtaskCount}`,
      );
      await sleep(600);
    }
    const mounts = await page.evaluate(() => window.__e2e.roamPixiMounts);
    c.check('Pixi stage initialised exactly once for the session', mounts === 1, `mounts=${mounts}`);
  } finally {
    await context.close().catch(() => {});
  }
  return c;
}

// ── Case: decrypt completion (blueprint assertion 3) ─────────────
// Poll a reveal that has been triggered (by OPEN WITH KEY or by the
// deck's own Open Another) and assert its timing. Returns true when
// the settled deck appeared.
async function observeReveal(page, c, label, t0) {
  let momentAt = null;
  let deckAt = null;
  let rarity = null;
  while (Date.now() - t0 < 20000) {
    const s = await page.evaluate(() => ({
      moment: !!document.querySelector('[data-testid="cache-loot-moment"]'),
      deck: !!document.querySelector('[data-testid="cache-reveal-deck"]'),
      rarity:
        document.querySelector('[data-testid="cache-loot-moment"]')?.querySelector('[data-rarity]')?.getAttribute('data-rarity') ??
        null,
      decrypting: document.body.innerText.includes('DECRYPTING CACHE'),
    }));
    if (s.moment && momentAt === null) momentAt = Date.now() - t0;
    if (s.rarity) rarity = s.rarity;
    if (s.deck) {
      deckAt = Date.now() - t0;
      break;
    }
    await sleep(200);
  }
  const sampleB = BUDGET.sampleB[rarity ?? 'Legendary'] ?? BUDGET.sampleB.Legendary;
  c.check(`${label}: reveal moment plays`, momentAt !== null, `momentAt=${momentAt}ms rarity=${rarity}`);
  c.check(
    `${label}: deck within Sample B (${sampleB}ms) + ${BUDGET.decryptSlackMs}ms slack of the moment`,
    deckAt !== null && momentAt !== null && deckAt - momentAt <= sampleB + BUDGET.decryptSlackMs,
    `deckAt=${deckAt}ms momentAt=${momentAt}ms`,
  );
  return deckAt !== null;
}

// Leave the settled deck. "Collect" returns to the cache screen
// ('collected'); "Open Another" immediately starts the next reveal
// ('another-started') — the caller must not click OPEN WITH KEY for
// that next open.
async function settleDeck(page, c) {
  const collect = page.getByRole('button', { name: /^Collect$/ }).first();
  if (await collect.isVisible().catch(() => false)) {
    await collect.click({ timeout: 8000 }).catch(() => {});
    // Wait for the deck to actually leave before touching the cache
    // screen again — clicking OPEN WITH KEY through the deck's exit
    // overlay is what timed the first calibration run out.
    await page
      .locator('[data-testid="cache-reveal-deck"]')
      .first()
      .waitFor({ state: 'detached', timeout: 10000 })
      .catch(() => {});
    const back = await page
      .getByRole('button', { name: /OPEN WITH KEY/i })
      .first()
      .waitFor({ state: 'visible', timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (!back && c) {
      const blocker = await page
        .evaluate(() => {
          const b = [...document.querySelectorAll('button')].find((x) => /OPEN WITH KEY/i.test(x.textContent ?? ''));
          if (!b) return 'open-with-key button absent';
          const r = b.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return `blocked by: ${top ? `${top.tagName}.${(top.className ?? '').toString().slice(0, 60)} testid=${top.getAttribute?.('data-testid') ?? ''}` : 'nothing'}`;
        })
        .catch(() => 'blocker probe failed');
      c.note(`settleDeck: deck collected but cache screen not ready — ${blocker}`);
    }
    return back ? 'collected' : 'unknown';
  }
  const another = page.getByRole('button', { name: /Open Another/i }).first();
  if (await another.isVisible().catch(() => false)) {
    await another.click({ timeout: 8000 }).catch(() => {});
    return 'another-started';
  }
  return 'unknown';
}

async function openOneCache(page, c, label) {
  const t0 = Date.now();
  const btn = page.getByRole('button', { name: /OPEN WITH KEY/i }).first();
  // Actionability probe (calibration round 3): in both prior rounds
  // this click timed out with the locator resolved to the real
  // button — something covers its click point or the button never
  // settles. Record what sits at the centre, keep the screenshot,
  // and fall back to a force click so the reveal assertions still
  // get exercised; the probe note carries the finding either way.
  const probe = await page
    .evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /OPEN WITH KEY/i.test(x.textContent ?? ''));
      if (!b) return 'button absent';
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      const covered = top && top !== b && !b.contains(top);
      return (
        `disabled=${b.disabled} rect=${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.x)},${Math.round(r.y)}` +
        ` covered=${!!covered}` +
        (covered
          ? ` by ${top.tagName}.${(top.className ?? '').toString().slice(0, 50)} testid=${top.getAttribute?.('data-testid') ?? ''}`
          : '')
      );
    })
    .catch(() => 'probe failed');
  try {
    // Tap off-centre, the way a player's thumb lands: the probe
    // (round 3) showed the button's exact centre covered by a 1px
    // progress-bar div and a layout container — Playwright's
    // centre-point "receives events" check can never pass there,
    // while the button itself is enabled and tappable elsewhere.
    await btn.click({ timeout: 15000, position: { x: 36, y: 22 } });
  } catch {
    c.note(`${label}: OPEN WITH KEY off-centre click timed out — probe: ${probe}; retrying with force`);
    await shot(page, 'decrypt-blocked.png');
    await btn.click({ timeout: 15000, force: true });
  }
  return observeReveal(page, c, label, t0);
}

async function enterCacheScreen(page) {
  await page.locator('[data-testid="top-cache-button"]').click({ timeout: 15000 });
  await sleep(1500);
  return page.evaluate(() => {
    const m = document.body.innerText.match(/Keys:\s*(\d+)/);
    return m ? Number(m[1]) : null;
  });
}

async function caseDecrypt(browser) {
  const c = new Case('decrypt-completion');
  // Variant 1 — normal transport: open every seeded key.
  {
    const { context, page } = await newGuestContext(browser);
    try {
      await guestSignIn(page);
      const keys = await enterCacheScreen(page);
      c.check('guest holds seeded cache keys', keys !== null && keys >= 1, `keys=${keys}`);
      const opens = Math.min(keys ?? 0, 3);
      let anotherStarted = false;
      for (let i = 0; i < opens; i++) {
        if (anotherStarted) {
          // The previous deck's Open Another already triggered this
          // reveal; just observe it.
          await observeReveal(page, c, `normal open ${i + 1} (via Open Another)`, Date.now());
          anotherStarted = false;
        } else {
          await openOneCache(page, c, `normal open ${i + 1}`);
        }
        if (i < opens - 1) {
          const settled = await settleDeck(page, c);
          anotherStarted = settled === 'another-started';
          if (settled === 'unknown') c.note(`open ${i + 1}: deck settle path not recognised`);
        }
      }
      await shot(page, 'decrypt-normal.png');
    } finally {
      await context.close().catch(() => {});
    }
  }
  // Variant 2 — sabotage: the display-only snapshot write stalls
  // forever. Post-#512 that save is fire-and-forget, so the deck
  // must land on the same budget. (The pre-fix build hangs the
  // DECRYPTING overlay indefinitely here — this variant is the
  // regression tripwire for the owner's defect 3.)
  {
    const { context, page } = await newGuestContext(browser);
    try {
      await guestSignIn(page);
      // Stall AFTER bootstrap: other paths still legitimately await
      // a snapshot save (REPORT §7 follow-up), and stalling those
      // would test the bootstrap, not the decrypt. The decrypt's own
      // display-only save is the one that must not gate the reveal.
      await page.route('**/api/runtime/snapshot', () => {
        /* never fulfilled: the request hangs */
      });
      const keys = await enterCacheScreen(page);
      c.check('sabotage-snapshot: keys present', keys !== null && keys >= 1, `keys=${keys}`);
      if (keys) await openOneCache(page, c, 'sabotage-snapshot open');
      await shot(page, 'decrypt-sabotage-snapshot.png');
    } finally {
      await context.close().catch(() => {});
    }
  }
  // Variant 3 — sabotage: the op endpoint itself is delayed 10 s
  // (blueprint wording). The flow must surface a RECOVERABLE state —
  // the deck, or an error with a way forward — and must not sit in
  // DECRYPTING past the 15 s transport timeout + slack.
  {
    const { context, page } = await newGuestContext(browser);
    try {
      await page.route('**/api/ops/make-item', async (route) => {
        await sleep(10000);
        await route.continue();
      });
      await guestSignIn(page);
      const keys = await enterCacheScreen(page);
      c.check('sabotage-op-delay: keys present', keys !== null && keys >= 1, `keys=${keys}`);
      if (keys) {
        const t0 = Date.now();
        await page.getByRole('button', { name: /OPEN WITH KEY/i }).first().click({ timeout: 15000 });
        let outcome = null;
        while (Date.now() - t0 < 45000) {
          const s = await page.evaluate(() => ({
            deck: !!document.querySelector('[data-testid="cache-reveal-deck"]'),
            decrypting: document.body.innerText.includes('DECRYPTING CACHE'),
            error: /timed out|try again|failed/i.test(document.body.innerText),
          }));
          if (s.deck) {
            outcome = 'deck';
            break;
          }
          if (!s.decrypting && s.error) {
            outcome = 'recoverable-error';
            break;
          }
          if (!s.decrypting && Date.now() - t0 > 20000) {
            outcome = 'overlay-cleared';
            break;
          }
          await sleep(400);
        }
        c.check(
          'sabotage-op-delay: recoverable state, never an endless DECRYPTING',
          outcome !== null,
          `outcome=${outcome} after ${Date.now() - t0}ms`,
        );
        await shot(page, 'decrypt-sabotage-opdelay.png');
      }
    } finally {
      await context.close().catch(() => {});
    }
  }
  return c;
}

// ── Case: gear at scale (blueprint assertion 4) ──────────────────
async function caseGearScale(browser) {
  const c = new Case('gear-at-scale');
  const { context, page, consoleMsgs, pageErrors } = await newGuestContext(browser);
  try {
    // Productised audit fixture: expand the runtime items response
    // to the owner's 2,366-item scale, varying the art signatures so
    // the list exercises distinct composes (relay.mjs seed-gear).
    let seedNoted = false;
    await page.route('**/api/runtime/items**', async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      try {
        const rows = JSON.parse(body);
        if (Array.isArray(rows) && rows.length > 0) {
          if (!seedNoted) {
            seedNoted = true;
            const kinds = rows
              .slice(0, 8)
              .map((r) => `${r.payload?.kind ?? r.kind ?? '?'}/${r.payload?.form ?? r.form ?? '?'}`)
              .join(' ');
            c.note(`seed source: rows=${rows.length} kinds: ${kinds}`);
          }
          // Validity-preserving expansion (calibration round 2): the
          // scale variable is the ROW COUNT, not invented art combos.
          // Round 1 forced element/rarity values onto source rows,
          // which can mint painted declarations with no sprite behind
          // them (a pending canvas forever, by construction) — so
          // clones now keep the source row's own element/rarity/form
          // and vary only identity, name, and level.
          const out = [];
          const TOTAL = 2366;
          for (let i = 0; i < TOTAL; i++) {
            const src = rows[i % rows.length];
            const clone = JSON.parse(JSON.stringify(src));
            clone.id = `${src.id}-e2eseed${i}`;
            if (clone.payload && typeof clone.payload === 'object') {
              clone.payload.id = clone.id;
              if (typeof clone.payload.level === 'number') clone.payload.level = 1 + (i % 14);
              if (typeof clone.payload.name === 'string' && i % 3 === 0) {
                clone.payload.name = `${clone.payload.name} Mk.${1 + (i % 9)}`;
              }
            }
            out.push(clone);
          }
          body = JSON.stringify(out);
        }
      } catch { /* pass the original body through */ }
      await route.fulfill({ response: res, body });
    });
    await guestSignIn(page);
    const into = await measureSwitch(page, 'GEAR');
    c.check('GEAR marker within budget at scale', into.markerMs !== null && into.markerMs <= BUDGET.tabMarkerMs, `marker=${into.markerMs}ms`);
    const sample = () =>
      page.evaluate(() => ({
        rows: document.querySelectorAll('[data-testid="gear-list-row"]').length,
        pending: document.querySelectorAll('[data-testid="gear-list-row"] [data-deferred-art="pending"]').length,
        header: document.body.innerText.match(/(\d[\d,]*)\s*\/\s*(\d[\d,]*)/)?.[0] ?? null,
      }));
    let s = await sample();
    c.check('mounted rows are windowed, not the whole inventory', s.rows > 0 && s.rows <= BUDGET.gearRowCap, `rows=${s.rows} header=${s.header}`);
    const settleDeadline = Date.now() + BUDGET.gearArtSettleMs;
    const series = [s.pending];
    while (s.pending > 0 && Date.now() < settleDeadline) {
      await sleep(300);
      s = await sample();
      series.push(s.pending);
    }
    c.check('visible-row art settles (no pending art on screen)', s.pending === 0, `pending=${s.pending} after settle window`);
    if (s.pending > 0) {
      // Diagnostics for the calibration loop (notes, not assertions):
      // what are the stuck elements, and did anything error?
      const stuck = await page.evaluate(() =>
        [...document.querySelectorAll('[data-deferred-art="pending"]')].slice(0, 3).map((el) => {
          const r = el.getBoundingClientRect();
          return {
            tag: el.tagName,
            sprite: el.getAttribute('data-painted-sprite'),
            form: el.getAttribute('data-painted-form'),
            testid: el.getAttribute('data-testid'),
            rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          };
        }),
      );
      c.note(`pending series: ${series.join('>')}; stuck sample: ${JSON.stringify(stuck)}`);
      c.note(`console: ${consoleMsgs.slice(-4).join(' | ') || 'none'}; pageErrors: ${pageErrors.slice(-2).join(' | ') || 'none'}`);
      // Does a scroll nudge wake the deferred-art activation?
      // (IntersectionObserver margin probe — notes only.)
      await page.mouse.wheel(0, 600);
      await sleep(1500);
      const afterKick = await sample();
      await page.mouse.wheel(0, -600);
      c.note(`after scroll kick: pending=${afterKick.pending} rows=${afterKick.rows}`);
      // Round-4 root-cause probe: attach a FRESH observer (same
      // options the app uses) to a stuck canvas and watch it, and
      // time a requestAnimationFrame tick. This separates "IO never
      // fires in this environment" from "the app's activation queue
      // or the component's render never lands".
      const probe = await page.evaluate(
        () =>
          new Promise((resolve) => {
            const el = document.querySelector('[data-testid="gear-list-row"] [data-deferred-art="pending"]');
            if (!el) return resolve('no pending element to probe');
            const r = el.getBoundingClientRect();
            let ioFired = 'not fired within 1500ms';
            const io = new IntersectionObserver(
              (entries) => {
                ioFired = entries
                  .map((e) => `isIntersecting=${e.isIntersecting} ratio=${e.intersectionRatio.toFixed(2)}`)
                  .join('; ');
              },
              { rootMargin: '600px 0px 600px 0px' },
            );
            io.observe(el);
            const rafT0 = performance.now();
            requestAnimationFrame(() => {
              const rafMs = Math.round(performance.now() - rafT0);
              setTimeout(() => {
                io.disconnect();
                resolve(
                  `rect=${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` +
                    ` viewport=${window.innerWidth}x${window.innerHeight} visibility=${document.visibilityState}` +
                    ` rafTick=${rafMs}ms io: ${ioFired}`,
                );
              }, 1500);
            });
          }),
      );
      c.note(`activation probe: ${probe}`);
    }
    await shot(page, 'gear-scale-top.png');
    // Scroll to the bottom of the list and check the last screenful.
    await page.evaluate(() => {
      const sc = [...document.querySelectorAll('div')].find(
        (d) => d.scrollHeight > d.clientHeight + 200 && getComputedStyle(d).overflowY !== 'visible',
      );
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
    await sleep(1200);
    s = await sample();
    c.check('bottom screenful mounts windowed rows', s.rows > 0 && s.rows <= BUDGET.gearRowCap, `rows=${s.rows}`);
    const settle2 = Date.now() + BUDGET.gearArtSettleMs;
    while (s.pending > 0 && Date.now() < settle2) {
      await sleep(300);
      s = await sample();
    }
    c.check('bottom screenful art settles', s.pending === 0, `pending=${s.pending}`);
    await shot(page, 'gear-scale-bottom.png');
    // Leave and return: the art cache must make the revisit instant.
    await measureSwitch(page, 'HOME');
    await measureSwitch(page, 'GEAR');
    const revisit = await sample();
    c.check('revisit shows art immediately (cache hit, no re-trickle)', revisit.pending === 0, `pending=${revisit.pending} rows=${revisit.rows}`);
  } finally {
    await context.close().catch(() => {});
  }
  return c;
}

// ── Case: boss stage (blueprint assertion 5) ─────────────────────
async function caseBossStage(browser) {
  const c = new Case('boss-stage');
  const { context, page } = await newGuestContext(browser);
  try {
    await guestSignIn(page);
    // Durability seed (best effort): a level-1 guest dies before the
    // cadence special presents. Lift the fixture account with the
    // game's own XP curve so the fight runs its phases. Logged
    // either way; the telegraph assertion below states its own
    // precondition (phase reach) instead of hiding behind the seed.
    if (process.env.E2E_DATABASE_URL || process.env.DATABASE_URL) {
      try {
        const { withPool, seedAccountLevel } = await import('./fixture.mjs');
        const level = await withPool(async (pool) => {
          const newest = await pool.query('select id from public.profiles order by created_at desc limit 1');
          if (!newest.rows[0]) return null;
          return seedAccountLevel(pool, newest.rows[0].id, 40);
        });
        c.note(`boss durability seed: level=${level}`);
        // The client caches the profile at boot; reload so the seeded
        // level is what the attempt sim sees.
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction((m) => eval(m), MARKERS.HOME, { timeout: 30000 });
      } catch (e) {
        c.note(`boss durability seed unavailable: ${String(e).slice(0, 160)}`);
      }
    } else {
      c.note('boss durability seed skipped (no fixture DB env)');
    }
    // Enter boss mode from the Home mode rail. The rail stop's
    // accessible name is its aria-label ("Boss — choose a boss to
    // fight"), so a /^Boss$/ role match never resolves — target the
    // shipped testid instead (calibration round 2).
    await page.locator('[data-testid="mode-rail-boss"]').click({ timeout: 15000, force: true });
    await sleep(1500);
    // Boss mode may open a picker (BossSelectModal) or land on a prep
    // panel with a default boss. If a picker is up, choose the first
    // enabled boss cell — locked bosses render disabled, so the
    // first enabled control in the dialog is the weakest unlocked
    // boss by construction.
    const panelReady = await page.evaluate(() => !!document.querySelector('[data-testid="boss-encounter-panel"]'));
    if (!panelReady) {
      const cell = page
        .locator('[role="dialog"] button:not([disabled]), [data-testid="boss-select-modal"] button:not([disabled])')
        .filter({ hasNotText: /close|cancel/i })
        .first();
      await cell.click({ timeout: 10000 }).catch(() => {});
      await page
        .waitForFunction(() => !!document.querySelector('[data-testid="boss-encounter-panel"]'), null, { timeout: 15000 })
        .catch(() => {});
    }
    c.check('boss prep panel reached', await page.evaluate(() => !!document.querySelector('[data-testid="boss-encounter-panel"]')));
    // The panel's start control reads "Start Boss Encounter — …"
    // (BossEncounterPanel handleStart) — no button in the panel
    // contains the word "fight", so the round-1/2 /fight/i filter
    // could never resolve. Probe the control's state first so a
    // disabled (unaffordable) entry is data, not a timeout.
    const fightState = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="boss-encounter-panel"]');
      const btn = panel
        ? [...panel.querySelectorAll('button')].find((b) => /Start Boss Encounter/i.test(b.textContent ?? ''))
        : null;
      return btn
        ? { found: true, disabled: btn.disabled, label: (btn.textContent ?? '').trim().slice(0, 60) }
        : { found: false, disabled: null, label: null };
    });
    c.note(`boss start control: ${JSON.stringify(fightState)}`);
    c.check('boss start control present', fightState.found, JSON.stringify(fightState));
    if (!fightState.found) {
      // Record what the panel actually offers before conceding —
      // its state (locked boss? prep step pending?) is the finding.
      const panelDump = await page.evaluate(() => {
        const panel = document.querySelector('[data-testid="boss-encounter-panel"]');
        if (!panel) return 'panel absent';
        const btns = [...panel.querySelectorAll('button')].map(
          (b) => `${(b.textContent ?? '').trim().slice(0, 40)}${b.disabled ? ' [disabled]' : ''}`,
        );
        return `buttons: ${btns.join(' | ')} || text: ${(panel.innerText ?? '').replace(/\s+/g, ' ').slice(0, 240)}`;
      });
      c.note(`boss panel dump: ${panelDump}`);
      await shot(page, 'boss-panel.png');
      c.check('boss fight started', false, 'no Start Boss Encounter control in the prep panel — see panel dump note');
      return c;
    }
    const fightBtn = page.locator('[data-testid="boss-encounter-panel"] button').filter({ hasText: /Start Boss Encounter/i }).last();
    try {
      await fightBtn.click({ timeout: 15000, force: true });
    } catch (e) {
      c.check('boss fight started', false, `start click failed: ${String(e).slice(0, 160)}`);
      await shot(page, 'boss-panel.png');
      return c;
    }
    // Observe the whole attempt.
    const t0 = Date.now();
    let stageSeen = false;
    let actorChecked = false;
    let phases = new Set();
    let telegraphSeen = false;
    let finished = false;
    while (Date.now() - t0 < BUDGET.bossFinishMs) {
      const s = await page.evaluate(() => {
        const stage = document.querySelector('[data-testid="boss-fight-stage"]');
        return {
          stage: !!stage,
          phase: stage?.getAttribute('data-phase') ?? null,
          finished: stage?.getAttribute('data-finished') === 'true',
          telegraph: !!document.querySelector('[data-testid="boss-special-layer"]'),
          banner: !!document.querySelector('[data-testid="boss-fight-banner"]'),
        };
      });
      if (s.stage) stageSeen = true;
      if (s.phase !== null) phases.add(s.phase);
      if (s.telegraph) telegraphSeen = true;
      if (s.stage && !actorChecked) {
        actorChecked = true;
        const stageEl = page.locator('[data-testid="boss-fight-stage"]').first();
        const stats = await elementRegionStats(page, stageEl, BOSS_REGION);
        console.log('  boss region stats:', JSON.stringify(stats));
        c.check(
          'boss actor pixel mass present on the stage',
          stats.nonBgMass > 0.05 && stats.distinct > 30,
          `nonBgMass=${stats.nonBgMass.toFixed(3)} distinct=${stats.distinct}`,
        );
        await shot(page, 'boss-stage.png');
      }
      if (s.finished || s.banner) {
        finished = true;
        break;
      }
      await sleep(200);
    }
    c.check('boss stage mounted for the attempt', stageSeen);
    c.check('fight phases advance', phases.size >= 2, `phases seen=${[...phases].join(',')}`);
    c.check(
      'cadence special telegraph rendered during the fight (C3)',
      telegraphSeen,
      `phases=${phases.size} — a fight too short to reach the special cannot satisfy this; see seed note`,
    );
    c.check('fight reaches a finished state', finished, `elapsed=${Date.now() - t0}ms`);
  } finally {
    await context.close().catch(() => {});
  }
  return c;
}

// ── Case: market error state (Wave 2 X-07) ───────────────────────
async function caseMarketError(browser) {
  const c = new Case('market-error-state');
  const { context, page, failures } = await newGuestContext(browser);
  try {
    await guestSignIn(page);
    // Force the listings read to fail AFTER bootstrap, then open the
    // Buy stop. The client requests GET /api/market/listings
    // (src/lib/api/marketListings.ts). Interceptions are counted in
    // the handler itself — an aborted request emits no 'response'
    // event, so a response-side recorder can never prove the hit
    // (calibration round 1's gets=0 was that artifact).
    let intercepted = 0;
    await page.route(/\/api\/[^ ]*(market|listing)[^ ]*/i, (route) => {
      if (route.request().method() === 'GET') {
        intercepted++;
        return route.abort('failed');
      }
      return route.continue();
    });
    // The standard MARKET marker (Vendor + Filters) describes the
    // HEALTHY screen; under a forced failure the error state may be
    // what renders, so this case waits for either shape.
    const t0 = Date.now();
    await clickTab(page, 'MARKET');
    let arrivedMs = null;
    while (Date.now() - t0 < 12000) {
      const s = await page.evaluate(() => ({
        healthy: /Vendor/.test(document.body.innerText) && /Filters/.test(document.body.innerText),
        retry: [...document.querySelectorAll('button')].some((b) => /retry/i.test(b.textContent ?? '')),
      }));
      if (s.healthy || s.retry) {
        arrivedMs = Date.now() - t0;
        break;
      }
      await sleep(150);
    }
    c.check('MARKET stop renders (healthy or error state)', arrivedMs !== null, `arrived=${arrivedMs}ms`);
    await sleep(2500);
    const failedGets = failures.filter((f) => f.method === 'GET' && /market|listing/i.test(f.path));
    const state = await page.evaluate(() => ({
      retry: [...document.querySelectorAll('button')].some((b) => /retry/i.test(b.textContent ?? '')),
      falseEmpty: /No listings found/.test(document.body.innerText),
      errorCopy: /couldn.t load|failed to load|something went wrong|try again/i.test(document.body.innerText),
      rows: document.querySelectorAll('[data-testid="market-listing-row"], [data-testid="listing-row"]').length,
    }));
    console.log('  market failure state:', JSON.stringify(state), 'intercepted:', intercepted, 'failedGets:', JSON.stringify(failedGets.slice(0, 4)));
    c.check('listings fetch was actually intercepted', intercepted > 0, `intercepted=${intercepted} failedGets=${failedGets.length}`);
    c.check('failure shows an error state with a Retry control (X-07)', state.retry && state.errorCopy, JSON.stringify(state));
    c.check('failure is NOT presented as an empty market (X-07)', !(state.falseEmpty && !state.retry), JSON.stringify(state));
    await shot(page, 'market-error.png');
    if (state.retry) {
      const before = intercepted;
      await page.getByRole('button', { name: /retry/i }).first().click({ timeout: 8000 }).catch(() => {});
      await sleep(1500);
      c.check('Retry re-invokes the listings fetch (X-07)', intercepted > before, `interceptions ${before} -> ${intercepted}`);
    }
  } finally {
    await context.close().catch(() => {});
  }
  return c;
}

const CASES = {
  'enemy-presence': caseEnemyPresence,
  'tab-switch-budget': caseTabBudget,
  decrypt: caseDecrypt,
  'gear-at-scale': caseGearScale,
  'boss-stage': caseBossStage,
  'market-error-state': caseMarketError,
};

async function main() {
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const names = requested.length ? requested : Object.keys(CASES);
  for (const n of names) {
    if (!CASES[n]) throw new Error(`unknown case: ${n} (have: ${Object.keys(CASES).join(', ')})`);
  }
  // Server must be up before any case runs.
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try {
      const r = await fetch(`${BASE}/health`);
      up = r.ok;
    } catch { /* not yet */ }
    if (!up) await sleep(1000);
  }
  if (!up) throw new Error(`server did not answer /health at ${BASE}`);
  const browser = await chromium.launch({
    executablePath: chromePath(),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  const results = [];
  try {
    for (const name of names) {
      console.log(`\n=== case: ${name} ===`);
      const started = Date.now();
      let result;
      try {
        result = await CASES[name](browser);
      } catch (e) {
        result = new Case(name);
        result.check('case completed without driver error', false, String(e).slice(0, 300));
      }
      result.ms = Date.now() - started;
      results.push(result);
      fs.writeFileSync(
        path.join(OUT, `result-${name}.json`),
        JSON.stringify({ case: result.name, ok: result.ok, ms: result.ms, assertions: result.assertions, notes: result.notes }, null, 1),
      );
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const failed = results.filter((r) => !r.ok);
  console.log('\n=== e2e-browser summary ===');
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(1)}s, ${r.assertions.filter((a) => a.ok).length}/${r.assertions.length} assertions)`);
  }
  if (failed.length) {
    console.log(`FAILING: ${failed.map((f) => f.name).join(', ')}`);
    process.exit(1);
  }
  console.log('all cases passed');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
