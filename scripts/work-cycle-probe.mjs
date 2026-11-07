#!/usr/bin/env node
/**
 * Work cycle probe — Motion Reboot M1 evidence (brief acceptance:
 * before/after frame sequences at phone width, timing assertions
 * on the RENDERED stage, reduced-motion check). Dev-only tooling;
 * not part of the app bundle or CI. Drives bench-harness.html
 * (Vite dev server) through Playwright against either master
 * (--label before) or the M1 branch (--label after) with the
 * IDENTICAL harness inputs, and writes:
 *
 *   stills/<label>-<scenario>-f<n>.png   frame sequences
 *   stills/<label>-completion.png        the completion rise
 *   stills/<label>-reduced.png           reduced-motion bench
 *   videos/<label>-craft-working.webm    full recordings
 *   probe-<label>.json                   measurements:
 *     - arm rotation series on the live stage → cycle period
 *       (lift-peak spacing; law: 900ms from SEGMENT.WORK_CYCLE_MS)
 *       and motion variance (the before statue: ~0)
 *     - fps trace while cycling (headless software render —
 *       indicative only, the pilot's caveat)
 *     - bench node accounting observed in the DOM
 *     - completion rise presence + console errors
 *
 * Usage:
 *   node scripts/work-cycle-probe.mjs --base http://127.0.0.1:5318 \
 *     --label after --out <evidence-dir>
 * Requires playwright-core (resolved from --pw or the workspace
 * visual-audit node_modules) and a Chromium build under
 * ~/.cache/ms-playwright.
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = argOf('base', 'http://127.0.0.1:5318');
const LABEL = argOf('label', 'after');
const OUT = argOf('out', '/tmp/work-cycle-evidence');
mkdirSync(path.join(OUT, 'stills'), { recursive: true });
mkdirSync(path.join(OUT, 'videos'), { recursive: true });

const require = createRequire(argOf('pw', '/home/hatch/workspace/cybercache-prep/visual-audit/'));
const { chromium } = require('playwright-core');

const VIEWPORT = { width: 390, height: 520 };
const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const TUNNEL_NOISE = /ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource/;

const results = { base: BASE, label: LABEL, startedAt: new Date().toISOString(), checks: {} };
const note = (k, v) => {
  results.checks[k] = v;
  console.log(`[${k}]`, typeof v === 'object' ? JSON.stringify(v) : v);
};

async function newPage(browser, extra = {}) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    isMobile: true,
    ...extra,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !TUNNEL_NOISE.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { context, page, errors };
}

const stageClip = async (page) => {
  const el = page.locator('[data-testid="bench-harness-root"] > *').first();
  const box = await el.boundingBox();
  return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : undefined;
};

/** Screenshot via raw CDP, clipped to the stage box. Playwright's
 *  page.screenshot waits on renderer stability that a permanently
 *  animating stage (plus a loaded VM) never grants — it timed out
 *  at 45s on this page while CDP's captureScreenshot completes.
 *  The clip also shrinks the software raster to the stage. */
async function shoot(context, page, clip, filePath) {
  const cdp = await context.newCDPSession(page);
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: clip ? { ...clip, scale: 1 } : undefined,
  });
  writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
  await cdp.detach();
}

const SCENARIOS = [
  { name: 'craft-working', qs: 'mode=crafting&state=working', offsets: [0, 180, 420, 640, 1120] },
  { name: 'salvage-working', qs: 'mode=salvaging&state=working', offsets: [0, 180, 420, 640, 1120] },
  { name: 'service-working', qs: 'mode=workshopService&state=working', offsets: [0, 180, 420, 640, 1120] },
  { name: 'craft-rest', qs: 'mode=crafting&state=rest', offsets: [0, 500] },
  { name: 'panel-craft', qs: 'mode=panel-craft&state=working', offsets: [0, 420] },
  { name: 'panel-repair', qs: 'mode=panel-repair&state=working', offsets: [0, 420] },
  { name: 'panel-shield', qs: 'mode=panel-shield&state=working', offsets: [0, 420] },
];

/** Frame sequence: engage, then shoot across ~2 cycles. On the
 *  branch build the cycle-active attribute anchors t0; on master
 *  nothing ever activates (the statue) and the same wall-clock
 *  schedule runs — identical frames are the finding. */
async function captureScenario(browser, { name, qs, offsets }) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(`${BASE}/bench-harness.html?${qs}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pixel-diorama-stage"], [data-testid$="-scene"]', { timeout: 15000 });
  const engaged = await page
    .waitForSelector('[data-cycle-active="true"]', { timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  const clip = await stageClip(page);
  for (let i = 0; i < offsets.length; i += 1) {
    if (i > 0) await page.waitForTimeout(offsets[i] - offsets[i - 1]);
    await shoot(context, page, clip, path.join(OUT, 'stills', `${LABEL}-${name}-f${i}.png`));
  }
  await context.close();
  return { engaged, errors };
}

/** Sample the near upper arm's rendered rotation on the live
 *  stage for ~3.6s and derive the cycle period from lift peaks. */
async function probeTiming(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(`${BASE}/bench-harness.html?mode=crafting&state=working`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pixel-hunter"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  const out = await page.evaluate(async () => {
    const arm = document.querySelector('[data-testid="pixel-hunter"] [data-part="armUpperN"]');
    const stage = document.querySelector('[data-testid="pixel-diorama-stage"]');
    if (!arm) return { samples: [], nodes: {} };
    const angleOf = (el) => {
      const t = getComputedStyle(el).transform;
      if (!t || t === 'none') return 0;
      const m = t.match(/matrix\(([^)]+)\)/);
      if (!m) return 0;
      const [a, b] = m[1].split(',').map(Number);
      return (Math.atan2(b, a) * 180) / Math.PI;
    };
    const samples = [];
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        samples.push({ t: Math.round(performance.now() - t0), deg: Math.round(angleOf(arm) * 10) / 10 });
        if (performance.now() - t0 < 3700) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    // FPS over the same window, from the sample cadence itself.
    const nodes = {
      parts: stage ? stage.querySelectorAll('[data-part]').length : 0,
      fxNodes: document.querySelector('[data-testid="bench-fx"]')
        ? document.querySelector('[data-testid="bench-fx"]').childElementCount
        : 0,
      benchFxPresent: !!document.querySelector('[data-testid="bench-fx"]'),
      cycleActive: document.querySelector('[data-testid="pixel-hunter"]')?.getAttribute('data-cycle-active') === 'true',
      armed: document.querySelector('[data-testid="pixel-hunter"]')?.getAttribute('data-armed'),
    };
    return { samples, nodes };
  });
  await context.close();
  const { samples, nodes } = out;
  // Lift peaks: local minima of the arm angle (the wind-up peak),
  // separated by at least 500ms.
  const peaks = [];
  for (let i = 2; i < samples.length - 2; i += 1) {
    const v = samples[i].deg;
    if (v <= samples[i - 1].deg && v < samples[i + 1].deg && v <= samples[i - 2].deg && v < samples[i + 2].deg) {
      if (peaks.length === 0 || samples[i].t - peaks[peaks.length - 1].t > 500) peaks.push(samples[i]);
    }
  }
  const spacings = [];
  for (let i = 1; i < peaks.length; i += 1) spacings.push(peaks[i].t - peaks[i - 1].t);
  const degs = samples.map((s) => s.deg);
  const variance = degs.length
    ? Math.round((Math.max(...degs) - Math.min(...degs)) * 10) / 10
    : 0;
  // rAF cadence from the sample timestamps.
  const deltas = [];
  for (let i = 1; i < samples.length; i += 1) deltas.push(samples[i].t - samples[i - 1].t);
  const medianDelta = deltas.length ? [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] : 0;
  return {
    sampleCount: samples.length,
    armSwingDeg: variance,
    liftPeaks: peaks,
    periodSpacingsMs: spacings,
    medianFrameMs: medianDelta,
    approxFps: medianDelta > 0 ? Math.round(1000 / medianDelta) : 0,
    nodes,
    errors,
  };
}

async function probeCompletion(browser) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(`${BASE}/bench-harness.html?mode=crafting&state=complete`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pixel-diorama-stage"]', { timeout: 15000 });
  const seenAt = await page
    .waitForSelector('[data-testid="bench-completion-rise"]', { timeout: 9000 })
    .then(() => true)
    .catch(() => false);
  if (seenAt) {
    const clip = await stageClip(page);
    await shoot(context, page, clip, path.join(OUT, 'stills', `${LABEL}-completion.png`));
  }
  await context.close();
  return { completionRiseSeen: seenAt, errors };
}

async function probeReduced(browser) {
  const { context, page, errors } = await newPage(browser, { reducedMotion: 'reduce' });
  await page.goto(`${BASE}/bench-harness.html?mode=crafting&state=working`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pixel-diorama-stage"]', { timeout: 15000 });
  await page.waitForTimeout(2600);
  const state = await page.evaluate(() => ({
    benchFxPresent: !!document.querySelector('[data-testid="bench-fx"]'),
    cycleActive:
      document.querySelector('[data-testid="pixel-hunter"]')?.getAttribute('data-cycle-active') === 'true',
    armed: document.querySelector('[data-testid="pixel-hunter"]')?.getAttribute('data-armed'),
  }));
  const clip = await stageClip(page);
  await shoot(context, page, clip, path.join(OUT, 'stills', `${LABEL}-reduced.png`));
  await context.close();
  return { ...state, errors };
}

async function recordVideo(browser) {
  const dir = path.join(OUT, 'videos', `raw-${LABEL}`);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    isMobile: true,
    recordVideo: { dir, size: VIEWPORT },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/bench-harness.html?mode=crafting&state=working`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pixel-diorama-stage"]', { timeout: 15000 });
  await page.waitForTimeout(6000);
  await context.close(); // flushes the webm
  return dir;
}

const browser = await chromium.launch({ args: LAUNCH_ARGS });
const scenarioResults = {};
for (const s of SCENARIOS) {
  scenarioResults[s.name] = await captureScenario(browser, s);
  note(`scenario:${s.name}`, scenarioResults[s.name]);
}
note('timing', await probeTiming(browser));
note('completion', await probeCompletion(browser));
note('reduced', await probeReduced(browser));
note('videoDir', await recordVideo(browser));
await browser.close();

writeFileSync(path.join(OUT, `probe-${LABEL}.json`), JSON.stringify(results, null, 2));
console.log('\nWrote', path.join(OUT, `probe-${LABEL}.json`));
