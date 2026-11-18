#!/usr/bin/env node
/**
 * iOS simulator smoke test for CyberCache — the ios-simulator lane's tests.
 *
 * The Android emulator lane's instrumented test only proves the package
 * installs; this lane asserts the three things the iOS brief requires, and
 * every assertion can fail the job:
 *
 *   1. LAUNCH      — the app installs, launches, and is still alive after a
 *                    settle window (no launch crash).
 *   2. FIRST SCREEN — a screenshot of the first screen is pixel-checked
 *                    (scripts/ios-smoke/png-check.py): a rendered dark game
 *                    screen, not a blank/white WebView failure frame.
 *   3. GUEST FLOW  — through the WebView's WebInspector (ios-webkit-debug-
 *                    proxy + the DevTools protocol), the DOM must contain
 *                    the four tab labels (Home/Gear/Market/Hunter — the
 *                    guest-visible game, per the Guest Visibility Law), and
 *                    tapping Market as a guest must render the Market
 *                    screen's own controls. No sign-in wall may intervene.
 *
 * Env: APP_PATH (required, the built .app), BUNDLE_ID (default
 * com.michaelhmiv.cybercache), OUT_DIR (default build/ios-smoke),
 * SETTLE_MS (default 10000).
 *
 * Artifacts in OUT_DIR: first-screen.png, market-screen.png,
 * smoke-summary.json, proxy.log. Exit code 0 only if every assertion held.
 */

import { execFile, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const BUNDLE_ID = process.env.BUNDLE_ID || 'com.michaelhmiv.cybercache';
const APP_PATH = process.env.APP_PATH;
const OUT_DIR = process.env.OUT_DIR || 'build/ios-smoke';
const SETTLE_MS = Number(process.env.SETTLE_MS || 10000);
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname);

const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function simctl(args, opts = {}) {
  return run('xcrun', ['simctl', ...args], { maxBuffer: 16 * 1024 * 1024, ...opts });
}

/** execFile's error.message drops the child's output — fold it back in so a
 *  failure record carries the actual simctl/xcodebuild complaint. */
function errText(error) {
  const parts = [error.message || String(error), error.stdout || '', error.stderr || '']
    .map((s) => String(s).trim())
    .filter(Boolean);
  return parts.join('\n').slice(0, 1200);
}

/**
 * Wait until the simulator finishes booting. A single `bootstatus -b` call
 * is not enough on a cold CI runner: the first boot of a fresh runtime can
 * run well past any one call's timeout (run 44418576052: still on the Apple
 * logo at ~80% after 6 minutes). bootstatus is only an observer — killing
 * it does not disturb the boot — so poll it until it reports completion,
 * with `simctl list` state as a fallback signal, under one overall deadline.
 */
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

/** Minimal DevTools-protocol client over the proxy's WebSocket (Node 22 global WebSocket). */
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

/**
 * Start ios-webkit-debug-proxy in listing mode (device list on :9221, one
 * port per device from :9222). Output streams to this process's log live —
 * the first real run (44421693207) failed the DOM leg with an empty proxy
 * log and an undiagnosable "proxy not up yet", so the transport now reports
 * on itself. Resolves with the child process once spawned.
 */
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
  child.on('error', (error) => console.log(`[proxy] spawn error: ${error.message}`));
  child.on('exit', (code, signal) => console.log(`[proxy] exited code=${code} signal=${signal}`));
  return child;
}

/** One probe of a proxy base URL; returns { wsUrl } or { state } for diagnosis. */
async function probeProxy(base) {
  let targets;
  try {
    targets = await fetchJson(`${base}/json`);
  } catch (error) {
    return { state: `${base}/json unreachable: ${error.message || error}` };
  }
  if (!Array.isArray(targets)) return { state: `${base}/json answered with a non-list` };
  // Listing mode answers with devices (each carrying its own url); per-device
  // mode answers with the device's pages directly. Handle both shapes.
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

/**
 * Poll the debug proxy until our app's WebView page appears; return its
 * WebSocket URL. Two transports, one run: listing mode first (45s), then a
 * per-device proxy (`-c <udid>:9222`) — the shape most CI recipes use for a
 * known simulator. The failure message names the last probe state of each.
 */
async function waitForPage(udid, restartProxyPerDevice, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  const listingWindowMs = 45000;
  let lastState = 'no probe yet';
  let perDevice = false;
  while (Date.now() < deadline) {
    if (!perDevice && Date.now() > deadline - timeoutMs + listingWindowMs) {
      console.log('[smoke] listing mode produced no page in 45s — restarting proxy per-device');
      restartProxyPerDevice();
      perDevice = true;
    }
    const base = perDevice ? 'http://127.0.0.1:9222' : 'http://127.0.0.1:9221';
    const probe = await probeProxy(base);
    if (probe.wsUrl) return probe.wsUrl;
    lastState = `${perDevice ? 'per-device' : 'listing'}: ${probe.state}`;
    await sleep(3000);
  }
  throw new Error(`WebView page never appeared in the debug proxy (last probe — ${lastState})`);
}

async function main() {
  if (!APP_PATH) throw new Error('APP_PATH env is required (the built .app)');
  mkdirSync(OUT_DIR, { recursive: true });
  let proxy = null;
  let cdp = null;
  let udid = null;

  try {
    const device = await pickDevice();
    udid = device.udid;
    console.log(`Simulator: ${device.name} (${udid})`);
    await simctl(['boot', udid]).catch((error) => console.log(`simctl boot: ${errText(error)}`));
    await waitForBoot(udid);

    await simctl(['install', udid, APP_PATH]);
    const container = await simctl(['get_app_container', udid, BUNDLE_ID]);
    record('install', true, `container: ${container.stdout.trim().split('\n')[0]}`);

    // Start the WebInspector proxy before launch so it sees the page early.
    proxy = startProxy([]);
    process.on('exit', () => writeFileSync(path.join(OUT_DIR, 'proxy.log'), proxyLogChunks.join('')));
    const restartProxyPerDevice = () => {
      try { proxy.kill('SIGTERM'); } catch { /* already gone */ }
      proxy = startProxy(['-c', `${udid}:9222`]);
    };

    const launched = await simctl(['launch', udid, BUNDLE_ID]);
    record('launch', true, launched.stdout.trim());

    await sleep(SETTLE_MS);
    const processes = await simctl(['spawn', udid, 'launchctl', 'list']);
    const alive = processes.stdout.includes(BUNDLE_ID);
    record('still-alive-after-settle', alive, alive ? '' : `bundle ID absent from launchctl list:\n${processes.stdout.slice(0, 800)}`);
    if (!alive) throw new Error('app did not survive launch');

    const firstShot = path.join(OUT_DIR, 'first-screen.png');
    await simctl(['io', udid, 'screenshot', `--type=png`, firstShot]);
    try {
      const check = await run('python3', [path.join(SCRIPT_DIR, 'png-check.py'), firstShot], {
        env: { ...process.env }, maxBuffer: 4 * 1024 * 1024,
      });
      record('first-screen-rendered', true, check.stdout.trim().split('\n')[0]);
    } catch (error) {
      record('first-screen-rendered', false, `${error.stdout || ''} ${error.stderr || ''}`.trim());
    }

    const wsUrl = await waitForPage(udid, restartProxyPerDevice);
    cdp = new Cdp(wsUrl);
    await cdp.connect();
    await cdp.call('Runtime.enable');

    let homeText = '';
    const domDeadline = Date.now() + 90000;
    while (Date.now() < domDeadline) {
      homeText = await cdp.evaluate('document.body ? document.body.textContent : ""').catch(() => '');
      if (homeText && homeText.trim().length > 50) break;
      await sleep(3000);
    }
    const lower = (homeText || '').toLowerCase();
    const tabs = ['home', 'gear', 'market', 'hunter'];
    const missingTabs = tabs.filter((tab) => !lower.includes(tab));
    record('guest-first-screen-dom', missingTabs.length === 0,
      missingTabs.length ? `missing tab labels: ${missingTabs.join(', ')}; body starts: ${(homeText || '').trim().slice(0, 200)}` : 'all four tab labels present');

    const clicked = await cdp.evaluate(`(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === 'market');
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    record('market-tab-found', clicked === true);
    if (clicked) {
      await sleep(3000);
      const marketText = await cdp.evaluate('document.body ? document.body.textContent : ""');
      const marketRendered = marketText.includes('Market Filters') || marketText.includes('Refresh listings');
      const changed = marketText !== homeText;
      record('guest-market-reachable', marketRendered && changed,
        `changed=${changed} marketControls=${marketRendered}; body starts: ${(marketText || '').trim().slice(0, 200)}`);
      const marketShot = path.join(OUT_DIR, 'market-screen.png');
      await simctl(['io', udid, 'screenshot', '--type=png', marketShot]).catch(() => {});
    }
  } catch (error) {
    record('smoke-run', false, errText(error));
    if (udid) {
      await simctl(['io', udid, 'screenshot', '--type=png', path.join(OUT_DIR, 'failure-screen.png')]).catch(() => {});
    }
  } finally {
    if (cdp) cdp.close();
    if (proxy) proxy.kill('SIGTERM');
    const failures = results.filter((r) => !r.ok);
    writeFileSync(path.join(OUT_DIR, 'smoke-summary.json'), JSON.stringify({ bundleId: BUNDLE_ID, results }, null, 2));
    console.log(`\n${results.length - failures.length}/${results.length} assertions passed`);
    process.exit(failures.length ? 1 : 0);
  }
}

main();
