#!/usr/bin/env node
/**
 * App Review simulator recording for CyberCache (Guideline 2.1 reply).
 *
 * Apple asked for a screen recording covering launch, a typical flow,
 * registration/login, account deletion, UGC surfaces, and paid content.
 * This driver produces that recording on a booted iOS simulator using
 * the exact transport the ios-simulator smoke uses (run-smoke.mjs):
 * build elsewhere, boot, install, ios-webkit-debug-proxy, CDP
 * Runtime.evaluate against the WebView. The video itself is captured
 * with `simctl io recordVideo`, started BEFORE the app launches and
 * stopped (SIGINT, so the .mp4 finalizes) after the last beat.
 *
 * The arc (each beat logs PASS/FAIL and the run CONTINUES — a failed
 * beat must never kill the recording):
 *   a. Launch -> AuthScreen -> "Continue as Guest" -> first-run sheets
 *      (username defer, hunter pick, starter bundle) -> Home, dwell
 *      while ticks advance. Still: a-home.png
 *   b. Tabs in order: Gear -> Market (one slow scroll; still
 *      b-market.png) -> Hunter -> Home.
 *   c. Best effort: "Crack Cache" -> OPEN WITH KEY if enabled -> the
 *      reveal plays and holds -> Collect -> Back.
 *   d. Hunter/Profile: dwell on the guest "Link Google" / "Link Apple"
 *      rows (still d-signin.png) -> tap "Link Google" -> the native
 *      Google sign-in sheet appears -> dwell -> terminate + relaunch
 *      (the sheet is native chrome; relaunch is the way back, and the
 *      guest session persists). The full AuthScreen itself is dwelled
 *      on at the end of beat g, after sign-out.
 *   e. Signed-in segment (only when REVIEW_SESSION_JSON is set): the
 *      session is written to the app's own Preferences key through the
 *      Capacitor bridge, the app relaunches onto it, and the Profile
 *      screen proves the signed-in state (no guest link rows, Sign
 *      Out present). Still: e-signed-in.png. The session value is
 *      never logged, printed, or written anywhere by this script.
 *   f. Profile -> Settings ("Options Board") -> "Delete Account /
 *      Data" -> the data-deletion page opens (Capacitor browser) ->
 *      dwell (still f-data-deletion.png) -> terminate + relaunch to
 *      return to the app.
 *   g. Sign out from Profile (if signed in) -> the app lands back on
 *      the AuthScreen -> dwell -> stop recording.
 *
 * Env: APP_PATH (required, the built .app), BUNDLE_ID (default
 * com.michaelhmiv.cybercache), OUT_DIR (default
 * build/ios-review-recording), REVIEW_SESSION_JSON (optional; a
 * ChefSession JSON string as stored by src/lib/api/session.ts).
 *
 * Artifacts in OUT_DIR: review-recording.mp4, the beat stills,
 * recording-summary.json, driver.log, proxy.log. Exit code 0 when a
 * usable recording file was produced, 1 otherwise — beat failures are
 * reported in the summary, not hidden, but they do not fail the job:
 * the artifact is the deliverable and a human QCs it.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BUNDLE_ID = process.env.BUNDLE_ID || 'com.michaelhmiv.cybercache';
const APP_PATH = process.env.APP_PATH;
const OUT_DIR = process.env.OUT_DIR || 'build/ios-review-recording';
const SESSION_KEY = 'cybercache.chef.session.v1';
const SESSION_RAW = process.env.REVIEW_SESSION_JSON || '';

// ---------------------------------------------------------------------------
// Logging + beat bookkeeping. Log lines stream to stdout AND driver.log.
// The session JSON never passes through here.
// ---------------------------------------------------------------------------
const logLines = [];
function log(line) {
  logLines.push(line);
  console.log(line);
}
const beats = [];
function beat(name, ok, detail = '') {
  beats.push({ name, ok, detail });
  log(`${ok ? 'PASS' : 'FAIL'}  beat ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function dwell(ms, why = '') {
  log(`[rec] dwell ${Math.round(ms / 100) / 10}s${why ? ` — ${why}` : ''}`);
  await sleep(ms);
}

async function simctl(args, opts = {}) {
  return run('xcrun', ['simctl', ...args], { maxBuffer: 16 * 1024 * 1024, ...opts });
}

/** execFile's error.message drops the child's output — fold it back in. */
function errText(error) {
  const parts = [error.message || String(error), error.stdout || '', error.stderr || '']
    .map((s) => String(s).trim())
    .filter(Boolean);
  return parts.join('\n').slice(0, 1200);
}

// ---------------------------------------------------------------------------
// Simulator boot (copied from run-smoke.mjs — same cold-runner behavior).
// ---------------------------------------------------------------------------
async function waitForBoot(udid, deadlineMs = 15 * 60 * 1000) {
  const deadline = Date.now() + deadlineMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      await simctl(['bootstatus', udid, '-b'], { timeout: 120000 });
      return;
    } catch (error) {
      last = errText(error);
    }
    try {
      const { stdout } = await simctl(['list', 'devices', '--json']);
      const groups = JSON.parse(stdout).devices || {};
      const device = Object.values(groups).flat().find((d) => d.udid === udid);
      if (device && device.state === 'Booted') return;
    } catch { /* keep polling on bootstatus alone */ }
    await sleep(10000);
  }
  throw new Error(`simulator did not finish booting within ${Math.round(deadlineMs / 60000)} minutes; last bootstatus output: ${last}`);
}

async function pickDevice() {
  const { stdout } = await simctl(['list', 'devices', 'available', '--json']);
  const groups = JSON.parse(stdout).devices || {};
  const devices = Object.values(groups).flat().filter((d) => d.isAvailable && d.name.startsWith('iPhone'));
  if (!devices.length) throw new Error('No available iPhone simulator on this runner');
  devices.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  return devices[0];
}

// ---------------------------------------------------------------------------
// CDP client + WebInspector proxy (copied from run-smoke.mjs).
// ---------------------------------------------------------------------------
class Cdp {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }
  async connect(timeoutMs = 30000) {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), timeoutMs);
      this.ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('WebSocket error')); }, { once: true });
    });
  }
  call(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timeout`)); }, 30000);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      throw new Error(`evaluate failed: ${JSON.stringify(result.exceptionDetails).slice(0, 400)}`);
    }
    return result.result.value;
  }
  close() { try { this.ws.close(); } catch { /* already closed */ } }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

const proxyLogChunks = [];
function startProxy(args) {
  const child = spawn('ios_webkit_debug_proxy', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const tee = (prefix) => (d) => {
    const text = `${prefix} ${d}`;
    proxyLogChunks.push(text);
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  };
  child.stdout.on('data', tee('[proxy]'));
  child.stderr.on('data', tee('[proxy:err]'));
  child.on('error', (error) => log(`[proxy] spawn error: ${error.message}`));
  child.on('exit', (code, signal) => log(`[proxy] exited code=${code} signal=${signal}`));
  return child;
}

async function probeProxy(base) {
  let targets;
  try {
    targets = await fetchJson(`${base}/json`);
  } catch (error) {
    return { state: `${base}/json unreachable: ${error.message || error}` };
  }
  if (!Array.isArray(targets)) return { state: `${base}/json answered with a non-list` };
  const pagesHere = targets.filter((t) => t.webSocketDebuggerUrl);
  for (const page of pagesHere) {
    if (page.url && !page.url.startsWith('about:')) return { wsUrl: page.webSocketDebuggerUrl };
  }
  let pageCount = pagesHere.length;
  for (const device of targets) {
    if (!device.url) continue;
    const pages = await fetchJson(`${device.url}/json`).catch(() => []);
    pageCount += pages.length;
    for (const page of pages) {
      if (page.webSocketDebuggerUrl && page.url && !page.url.startsWith('about:')) {
        return { wsUrl: page.webSocketDebuggerUrl };
      }
    }
  }
  return { state: `${base}/json answered: ${targets.length} entr(ies), ${pageCount} page(s), none inspectable` };
}

async function waitForPage(udid, restartProxyPerDevice, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  const listingWindowMs = 45000;
  let lastState = 'no probe yet';
  let perDevice = false;
  while (Date.now() < deadline) {
    if (!perDevice && Date.now() > deadline - timeoutMs + listingWindowMs) {
      log('[rec] listing mode produced no page in 45s — restarting proxy per-device');
      restartProxyPerDevice();
      perDevice = true;
    }
    const base = perDevice ? 'http://127.0.0.1:9222' : 'http://127.0.0.1:9221';
    const probe = await probeProxy(base);
    if (probe.wsUrl) return probe.wsUrl;
    const state = `${perDevice ? 'per-device' : 'listing'}: ${probe.state}`;
    if (state !== lastState) log(`[rec] probe — ${state}`);
    lastState = state;
    await sleep(3000);
  }
  throw new Error(`WebView page never appeared in the debug proxy (last probe — ${lastState})`);
}

// ---------------------------------------------------------------------------
// In-page helpers. The app keeps visited tab panes mounted with
// display:none, so every finder filters to VISIBLE elements only.
// ---------------------------------------------------------------------------
const VIS_PREAMBLE = `
  const __vis = (el) => {
    if (!el || !el.getClientRects().length) return false;
    let n = el;
    while (n && n !== document.body) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      n = n.parentElement;
    }
    return true;
  };
  const __norm = (s) => (s || '').replace(/\\s+/g, ' ').trim().toLowerCase();
`;

async function pageText(cdp) {
  return cdp.evaluate('document.body ? (document.body.innerText || document.body.textContent || "") : ""').catch(() => '');
}

async function waitForText(cdp, needle, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  const target = needle.toLowerCase();
  while (Date.now() < deadline) {
    const text = await pageText(cdp);
    if (text.toLowerCase().includes(target)) return true;
    await sleep(2000);
  }
  return false;
}

/**
 * Click a visible control by its label. Pass 1 prefers real interactive
 * elements (button/a/[role=button]) with an exact label match, then a
 * prefix match (for labels carrying live counts, e.g. "OPEN WITH KEY
 * (2)"); pass 2 clicks any visible element with the exact label —
 * React handlers sit on ancestors and the synthetic click bubbles.
 * Returns 'exact' | 'prefix' | 'loose' | null.
 */
async function clickText(cdp, label, { prefix = false } = {}) {
  const expr = `(() => {
    ${VIS_PREAMBLE}
    const want = __norm(${JSON.stringify(label)});
    const matches = (el, mode) => {
      const t = __norm(el.textContent);
      if (mode === 'exact') return t === want;
      if (mode === 'prefix') return t.startsWith(want);
      return false;
    };
    const interactive = [...document.querySelectorAll('button, a, [role="button"]')].filter(__vis);
    for (const mode of ${prefix ? "['prefix', 'exact']" : "['exact']"}) {
      const hit = interactive.find((el) => matches(el, mode));
      if (hit) { hit.scrollIntoView({ block: 'center' }); hit.click(); return mode; }
    }
    const any = [...document.querySelectorAll('div, span, li')].filter(__vis);
    const loose = any.find((el) => __norm(el.textContent) === want && el.children.length <= 3);
    if (loose) { loose.scrollIntoView({ block: 'center' }); loose.click(); return 'loose'; }
    return null;
  })()`;
  return cdp.evaluate(expr).catch(() => null);
}

/** State of a labeled button: { found, disabled } (visible elements only). */
async function buttonState(cdp, label, { prefix = false } = {}) {
  const expr = `(() => {
    ${VIS_PREAMBLE}
    const want = __norm(${JSON.stringify(label)});
    const btns = [...document.querySelectorAll('button, a, [role="button"]')].filter(__vis);
    const hit = btns.find((el) => ${prefix ? '__norm(el.textContent).startsWith(want)' : '__norm(el.textContent) === want'});
    if (!hit) return { found: false, disabled: false };
    return { found: true, disabled: Boolean(hit.disabled) || hit.getAttribute('aria-disabled') === 'true' };
  })()`;
  return cdp.evaluate(expr).catch(() => ({ found: false, disabled: false }));
}

/** One slow, human-followable scroll of the largest visible scroller. */
async function smoothScroll(cdp, fraction = 0.6, durationMs = 1600) {
  const expr = `(async () => {
    ${VIS_PREAMBLE}
    const scrollers = [...document.querySelectorAll('div, main, section')]
      .filter((el) => __vis(el) && el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
    scrollers.sort((a, b) => b.clientHeight - a.clientHeight);
    const el = scrollers[0] || document.scrollingElement;
    if (!el) return false;
    const start = el.scrollTop;
    const target = Math.min(el.scrollHeight - el.clientHeight, start + el.clientHeight * ${fraction});
    if (target <= start) return false;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        const k = Math.min(1, (now - t0) / ${durationMs});
        el.scrollTop = start + (target - start) * k;
        if (k < 1) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    return true;
  })()`;
  return cdp.evaluate(expr).catch(() => false);
}

/**
 * First-run sheets, in the order App.tsx stacks them: a deferrable
 * username prompt, the hunter pick, the starter-bundle reveal. Each is
 * handled if (and only if) it is actually on screen. Returns a note of
 * what was handled, for the beat log.
 */
async function clearFirstRunSheets(cdp) {
  const handled = [];
  for (let round = 0; round < 4; round++) {
    const text = await pageText(cdp);
    if (/choose your hunter/i.test(text)) {
      const picked = await cdp.evaluate(`(() => {
        ${VIS_PREAMBLE}
        const sheet = document.querySelector('[aria-label="Choose your hunter"]');
        if (!sheet) return false;
        const cards = [...sheet.querySelectorAll('button')].filter(__vis)
          .filter((b) => !/close|later|skip/i.test(b.textContent || ''));
        if (!cards.length) return false;
        cards[0].click();
        return true;
      })()`).catch(() => false);
      if (picked) { handled.push('hunter pick'); await dwell(2500, 'hunter picked'); continue; }
    }
    if (await buttonState(cdp, 'Collect').then((s) => s.found)) {
      // Only the starter-bundle reveal uses a bare "Collect" on Home;
      // the cache reveal's Collect is handled inside beat c itself.
      const onHome = /crack cache/i.test(text);
      if (onHome && await clickText(cdp, 'Collect')) { handled.push('starter bundle'); await dwell(2000); continue; }
    }
    const skipped = await (async () => {
      for (const label of ['Skip', 'Later', 'Not now', 'Maybe later', 'Do this later']) {
        if (await clickText(cdp, label)) return label;
      }
      return null;
    })();
    if (skipped) { handled.push(`deferred prompt (${skipped})`); await dwell(2000); continue; }
    break;
  }
  return handled;
}

// ---------------------------------------------------------------------------
// Video capture.
// ---------------------------------------------------------------------------
function startRecording(udid, file) {
  const child = spawn('xcrun', ['simctl', 'io', udid, 'recordVideo', '--codec=h264', '--force', file], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => log(`[video] ${String(d).trim()}`));
  child.stderr.on('data', (d) => log(`[video] ${String(d).trim()}`));
  child.on('error', (error) => log(`[video] spawn error: ${error.message}`));
  return child;
}

async function stopRecording(child, file) {
  if (child && !child.killed) {
    child.kill('SIGINT'); // simctl finalizes the .mp4 on SIGINT
    await Promise.race([
      new Promise((resolve) => child.on('exit', resolve)),
      sleep(20000).then(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }),
    ]);
  }
  // Wait for the file size to settle (the muxer flushes after exit).
  let lastSize = -1;
  for (let i = 0; i < 10; i++) {
    const size = existsSync(file) ? statSync(file).size : 0;
    if (size > 0 && size === lastSize) return size;
    lastSize = size;
    await sleep(700);
  }
  return existsSync(file) ? statSync(file).size : 0;
}

// ---------------------------------------------------------------------------
// Session injection (beat e). The raw value goes ONLY into the evaluate
// payload — never into a log line, the summary, or an error message.
// ---------------------------------------------------------------------------
function parseReviewSession(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed.accessToken === 'string' &&
      typeof parsed.refreshToken === 'string' &&
      parsed.account && typeof parsed.account.id === 'string'
    ) return raw;
  } catch { /* malformed — treated as absent */ }
  return null;
}

async function injectSession(cdp, raw) {
  const expr = `(async () => {
    const prefs = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
    if (!prefs) return 'no-bridge';
    await prefs.set({ key: ${JSON.stringify(SESSION_KEY)}, value: ${JSON.stringify(raw)} });
    return 'set';
  })()`;
  try {
    return await cdp.evaluate(expr);
  } catch {
    return 'evaluate-failed'; // detail withheld: the payload carries the session
  }
}

// ---------------------------------------------------------------------------
// Main arc.
// ---------------------------------------------------------------------------
async function main() {
  if (!APP_PATH) throw new Error('APP_PATH env is required (the built .app)');
  mkdirSync(OUT_DIR, { recursive: true });
  const videoPath = path.join(OUT_DIR, 'review-recording.mp4');
  let proxy = null;
  let cdp = null;
  let video = null;
  let udid = null;
  let signedIn = false;

  const shot = async (name) => {
    if (!udid) return;
    await simctl(['io', udid, 'screenshot', '--type=png', path.join(OUT_DIR, name)])
      .then(() => log(`[rec] still ${name}`))
      .catch((error) => log(`[rec] still ${name} failed: ${errText(error).slice(0, 200)}`));
  };

  try {
    const device = await pickDevice();
    udid = device.udid;
    log(`Simulator: ${device.name} (${udid})`);
    await simctl(['boot', udid]).catch((error) => log(`simctl boot: ${errText(error)}`));
    await waitForBoot(udid);

    await simctl(['install', udid, APP_PATH]);
    log('[rec] app installed');

    // Proxy before launch (smoke pattern) so it sees the page early.
    proxy = startProxy(['-d']);
    process.on('exit', () => writeFileSync(path.join(OUT_DIR, 'proxy.log'), proxyLogChunks.join('')));
    const restartProxyPerDevice = () => {
      try { proxy.kill('SIGTERM'); } catch { /* already gone */ }
      proxy = startProxy(['-d', '-c', `${udid}:9222`]);
    };
    const attach = async () => {
      const wsUrl = await waitForPage(udid, restartProxyPerDevice);
      const next = new Cdp(wsUrl);
      await next.connect();
      await next.call('Runtime.enable');
      if (cdp) cdp.close();
      cdp = next;
      log('[rec] WebView attached');
      return cdp;
    };
    const relaunch = async (why) => {
      log(`[rec] relaunch — ${why}`);
      await simctl(['terminate', udid, BUNDLE_ID]).catch(() => {});
      await sleep(1500);
      await simctl(['launch', udid, BUNDLE_ID]);
      await sleep(4000);
      return attach();
    };

    // Recording starts BEFORE the app launches (the launch is a beat).
    video = startRecording(udid, videoPath);
    await sleep(1500); // let the recorder spin up so frame 1 is the launch

    await simctl(['launch', udid, BUNDLE_ID]);
    log('[rec] app launched — recording');

    try {
      await attach();
    } catch (error) {
      beat('transport', false, `WebView never attached: ${errText(error).slice(0, 300)}`);
    }

    if (!cdp) {
      // No transport: the launch footage + a still are still evidence,
      // and every driven beat records its failure honestly.
      await dwell(8000, 'launch settle without transport');
      await shot('a-home.png');
      for (const name of ['a-launch-guest-home', 'b-tabs-tour', 'c-cache-open', 'd-signin', 'e-signed-in', 'f-data-deletion', 'g-sign-out']) {
        beat(name, false, 'WebView transport unavailable — beat not driven');
      }
    } else {
      // -- Beat a: launch -> guest -> Home -------------------------------
      try {
        const sawAuth = await waitForText(cdp, 'Continue as Guest', 90000);
        const sawTabs = sawAuth ? false : await waitForText(cdp, 'Crack Cache', 15000);
        if (sawAuth) {
          await dwell(3000, 'AuthScreen: Google + Apple + guest entry');
          const clicked = await clickText(cdp, 'Continue as Guest');
          if (!clicked) throw new Error('"Continue as Guest" not clickable');
          log('[rec] entered as guest');
        } else if (!sawTabs) {
          throw new Error('neither the AuthScreen nor Home appeared within the wait window');
        }
        const homeReady = await waitForText(cdp, 'Crack Cache', 120000);
        if (!homeReady) throw new Error('Home did not render after guest entry');
        const handled = await clearFirstRunSheets(cdp);
        await dwell(8000, 'Home — game ticks advancing');
        await shot('a-home.png');
        beat('a-launch-guest-home', true, handled.length ? `first-run sheets handled: ${handled.join(', ')}` : 'straight to Home');
      } catch (error) {
        beat('a-launch-guest-home', false, errText(error).slice(0, 300));
      }

      // -- Beat b: tab tour ----------------------------------------------
      try {
        const tour = [];
        for (const [tab, marker, ms] of [
          ['Gear', 'Gear', 3000],
          ['Market', 'Market', 2500],
          ['Hunter', 'Hunter', 3000],
          ['Home', 'Crack Cache', 2500],
        ]) {
          const clicked = await clickText(cdp, tab);
          if (!clicked) { tour.push(`${tab}:no-control`); continue; }
          if (tab === 'Market') {
            await dwell(1500, 'Market renders');
            await smoothScroll(cdp, 0.6, 1800);
            await shot('b-market.png');
            await dwell(1000);
          } else {
            await dwell(ms, `${tab} tab`);
          }
          tour.push(`${tab}:ok`);
        }
        const allOk = tour.every((t) => t.endsWith(':ok'));
        beat('b-tabs-tour', allOk, tour.join(' · '));
      } catch (error) {
        beat('b-tabs-tour', false, errText(error).slice(0, 300));
      }

      // -- Beat c: open one cache (best effort) ---------------------------
      try {
        const opened = await clickText(cdp, 'Crack Cache');
        if (!opened) throw new Error('"Crack Cache" entry not found on Home');
        await dwell(3000, 'cache screen');
        const keyBtn = await buttonState(cdp, 'OPEN WITH KEY', { prefix: true });
        if (!keyBtn.found) {
          beat('c-cache-open', false, 'no OPEN WITH KEY control on the cache screen — skipped');
        } else if (keyBtn.disabled) {
          beat('c-cache-open', false, 'OPEN WITH KEY disabled (no keys on a fresh guest) — skipped');
        } else {
          await clickText(cdp, 'OPEN WITH KEY', { prefix: true });
          await dwell(6000, 'reveal plays and holds');
          const collected = await clickText(cdp, 'Collect');
          await dwell(2000, collected ? 'collected' : 'reveal left as-is');
          beat('c-cache-open', true, collected ? 'opened with key, reveal held, collected' : 'opened with key, reveal held');
        }
        await clickText(cdp, 'Back');
        await dwell(2000, 'back to Home');
      } catch (error) {
        beat('c-cache-open', false, errText(error).slice(0, 300));
        await clickText(cdp, 'Back').catch(() => null);
      }

      // -- Beat d: sign-in surface (guest link rows) ----------------------
      try {
        const onProfile = await clickText(cdp, 'Hunter');
        if (!onProfile) throw new Error('Hunter tab not clickable');
        await dwell(3000, 'Profile — guest account state');
        const linkState = await buttonState(cdp, 'Link Google');
        await shot('d-signin.png');
        if (!linkState.found) throw new Error('"Link Google" row not found on Profile');
        const tapped = await clickText(cdp, 'Link Google');
        if (!tapped) throw new Error('"Link Google" not clickable');
        await dwell(4000, 'native Google sign-in sheet');
        await relaunch('dismiss the native sign-in sheet; guest session persists');
        const homeAgain = await waitForText(cdp, 'Crack Cache', 90000);
        beat('d-signin', homeAgain, homeAgain ? 'link rows shown, Google sheet presented, returned as guest' : 'sheet presented; Home did not re-render after relaunch');
      } catch (error) {
        beat('d-signin', false, errText(error).slice(0, 300));
      }

      // -- Beat e: signed-in segment (session via env, never logged) ------
      const sessionRaw = parseReviewSession(SESSION_RAW);
      if (!sessionRaw) {
        beat('e-signed-in', false, SESSION_RAW ? 'REVIEW_SESSION_JSON present but malformed — segment skipped' : 'REVIEW_SESSION_JSON absent — signed-in segment skipped');
        log('[rec] signed-in segment skipped');
      } else {
        try {
          const injected = await injectSession(cdp, sessionRaw);
          if (injected !== 'set') throw new Error(`session injection did not complete (${injected})`);
          await relaunch('boot on the stored review session');
          const homeReady = await waitForText(cdp, 'Crack Cache', 120000);
          if (!homeReady) throw new Error('Home did not render on the review session');
          await dwell(3000, 'Home — signed in');
          await clickText(cdp, 'Hunter');
          await dwell(3000, 'Profile — signed-in account state');
          const guestRow = await buttonState(cdp, 'Link Google');
          const signOutRow = await buttonState(cdp, 'Sign Out');
          signedIn = signOutRow.found && !guestRow.found;
          await shot('e-signed-in.png');
          beat('e-signed-in', signedIn, signedIn ? 'Profile shows the signed-in account (Sign Out present, guest link rows gone)' : `Profile state unclear (signOut=${signOutRow.found}, guestLink=${guestRow.found})`);
        } catch (error) {
          beat('e-signed-in', false, errText(error).slice(0, 300));
        }
      }

      // -- Beat f: Settings -> Delete Account / Data ----------------------
      try {
        // Settings and Sign Out both live on Profile (Hunter tab).
        const onProfile = await clickText(cdp, 'Hunter');
        if (!onProfile) throw new Error('Hunter tab not clickable');
        await dwell(2500, 'Profile');
        const settingsTap = await clickText(cdp, 'Settings');
        if (!settingsTap) throw new Error('"Settings" row not found on Profile');
        const onSettings = await waitForText(cdp, 'Options Board', 30000);
        if (!onSettings) throw new Error('Settings (Options Board) did not render');
        await dwell(2500, 'Settings — Options Board');
        await smoothScroll(cdp, 0.9, 1800);
        const deleteState = await buttonState(cdp, 'Delete Account / Data');
        if (!deleteState.found) throw new Error('"Delete Account / Data" not found in Settings');
        await clickText(cdp, 'Delete Account / Data');
        await dwell(5000, 'data-deletion page (Capacitor browser)');
        await shot('f-data-deletion.png');
        await relaunch('return from the data-deletion page');
        beat('f-data-deletion', true, 'deletion page presented; returned to the app');
      } catch (error) {
        beat('f-data-deletion', false, errText(error).slice(0, 300));
      }

      // -- Beat g: sign out -> AuthScreen ---------------------------------
      try {
        if (!signedIn) {
          beat('g-sign-out', false, 'not signed in — sign-out beat skipped (end state: guest session)');
        } else {
          const onProfile = await clickText(cdp, 'Hunter');
          if (!onProfile) throw new Error('Hunter tab not clickable');
          await dwell(2500, 'Profile');
          await smoothScroll(cdp, 0.9, 1500);
          const tapped = await clickText(cdp, 'Sign Out');
          if (!tapped) throw new Error('"Sign Out" row not found on Profile');
          const backOnAuth = await waitForText(cdp, 'Continue as Guest', 60000);
          await dwell(3000, 'AuthScreen — end state');
          signedIn = false;
          beat('g-sign-out', backOnAuth, backOnAuth ? 'signed out; AuthScreen (Google + Apple + guest) is the end state' : 'sign-out tapped; AuthScreen not confirmed');
        }
      } catch (error) {
        beat('g-sign-out', false, errText(error).slice(0, 300));
      }
    }
  } catch (error) {
    beat('recording-run', false, errText(error).slice(0, 400));
    if (udid) await shot('failure-screen.png');
  } finally {
    let videoBytes = 0;
    if (video) videoBytes = await stopRecording(video, videoPath);
    if (cdp) cdp.close();
    if (proxy) proxy.kill('SIGTERM');
    const passed = beats.filter((b) => b.ok).length;
    const summary = { bundleId: BUNDLE_ID, recording: { path: 'review-recording.mp4', bytes: videoBytes }, beats };
    writeFileSync(path.join(OUT_DIR, 'recording-summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(path.join(OUT_DIR, 'driver.log'), logLines.join('\n') + '\n');
    log(`\n${passed}/${beats.length} beats passed; recording ${videoBytes} bytes`);
    process.exit(videoBytes > 100000 ? 0 : 1);
  }
}

main();
