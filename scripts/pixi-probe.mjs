#!/usr/bin/env node
/**
 * Pixi motion pilot — evidence probe (brief §7). Dev-only tooling;
 * not part of the app bundle or CI. Drives the harness page
 * (pixi-harness.html, Vite dev server) through Playwright and
 * produces the approval package evidence:
 *
 *   1. fixture determinism — DOM vs Pixi runs consume identical
 *      snapshot events and reach the identical outcome.
 *   2. timing conformance — phase interval 1150ms, hit reaction
 *      420ms (sampled on the stage's effective clock; hit-stop is
 *      absorbed, so the wall span reads longer by exactly the
 *      freeze), ghost HP drain 480ms, shake durations vs
 *      movement.ts — each within a stated tolerance.
 *   3. fidelity stills — six beats × both renderers.
 *   4. performance — fps trace across the full fixture fight at
 *      phone width, pool/node count, cold-open times.
 *   5. fallback — WebGL disabled: DOM stage, fixture completes,
 *      no console errors (beyond the VM's known font-tunnel noise).
 *   6. videos — BEFORE (DOM) / AFTER (Pixi) full-fight recordings
 *      + raw beat clips for the reel (ffmpeg assembly is separate).
 *
 * Usage:
 *   node scripts/pixi-probe.mjs --base http://127.0.0.1:5317 --out <evidence-dir>
 * Requires playwright-core (resolved from PIXI_PROBE_PW or the
 * workspace visual-audit node_modules) and a Chromium build under
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
const BASE = argOf('base', 'http://127.0.0.1:5317');
const OUT = argOf('out', '/tmp/pixi-evidence');
mkdirSync(OUT, { recursive: true });
mkdirSync(path.join(OUT, 'stills'), { recursive: true });
mkdirSync(path.join(OUT, 'videos'), { recursive: true });

const require = createRequire(argOf('pw', '/home/hatch/workspace/cybercache-prep/visual-audit/'));
const { chromium } = require('playwright-core');

const VIEWPORT = { width: 460, height: 760 };
const LAUNCH_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const TUNNEL_NOISE = /ERR_TUNNEL_CONNECTION_FAILED|Failed to load resource/;

const results = { base: BASE, startedAt: new Date().toISOString(), checks: {} };
const note = (k, v) => {
  results.checks[k] = v;
  console.log(`[${k}]`, typeof v === 'object' ? JSON.stringify(v) : v);
};

async function newPage(browser, extra = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ...extra });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !TUNNEL_NOISE.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { context, page, errors };
}

/** Run the full fixture on one renderer; returns the fight log,
 *  probe samples, and fps summary. */
async function runFight(browser, renderer, { sample = false } = {}) {
  const { context, page, errors } = await newPage(browser);
  await page.goto(`${BASE}/pixi-harness.html?renderer=${renderer}&autostart=1`, { waitUntil: 'networkidle' });
  if (sample) {
    await page.evaluate(() => {
      const samples = [];
      window.__samples = samples;
      const ghostEl = () => document.querySelector('[data-testid="harness-boss-bar-ghost"]');
      const realEl = () => document.querySelector('[data-testid="harness-boss-bar-real"]');
      const barEl = () => document.querySelector('[data-testid="harness-boss-bar"]');
      window.__sampler = setInterval(() => {
        const probe = window.__cybercachePixiStage;
        const bar = barEl();
        const ghost = ghostEl();
        const real = realEl();
        const canvas = document.querySelector('canvas');
        const wrap = canvas?.parentElement?.parentElement;
        samples.push({
          t: performance.now(),
          phaseIndex: probe?.phaseIndex ?? null,
          rawMs: probe?.rawMs ?? null,
          effMs: probe?.effMs ?? null,
          bossScaleX: probe?.bossScaleX ?? null,
          ghostPct: bar && ghost ? (ghost.getBoundingClientRect().width / bar.getBoundingClientRect().width) * 100 : null,
          realPct: bar && real ? (real.getBoundingClientRect().width / bar.getBoundingClientRect().width) * 100 : null,
          shakeTransform: wrap ? wrap.style.transform || '' : null,
          shakeKey: probe?.shakeKey ?? null,
        });
      }, 8);
    });
  }
  await page.waitForFunction(() => window.__harnessDone === true, null, { timeout: 30000 });
  await page.waitForTimeout(150);
  const data = await page.evaluate(() => ({
    fightLog: window.__fightLog,
    fpsDeltas: window.__fpsDeltas,
    samples: window.__samples ?? null,
    shakeEvents: window.__pixiShakeEvents ?? null,
    probe: window.__cybercachePixiStage ?? null,
  }));
  await context.close();
  return { ...data, errors };
}

function fpsSummary(deltas) {
  const frames = deltas.filter((d) => d > 0 && d < 1000);
  const sorted = [...frames].sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const over20 = frames.filter((d) => d > 20).length;
  // Worst sustained 1s window (rolling sum of consecutive deltas).
  let worstWindowFps = Infinity;
  let acc = 0;
  const windowFrames = [];
  for (const d of frames) {
    windowFrames.push(d);
    acc += d;
    while (acc > 1000) acc -= windowFrames.shift();
    if (acc >= 990) worstWindowFps = Math.min(worstWindowFps, windowFrames.length / (acc / 1000));
  }
  return {
    frames: frames.length,
    avgFps: +(1000 / avg).toFixed(1),
    avgFrameMs: +avg.toFixed(2),
    p95FrameMs: +p95.toFixed(2),
    pctFramesOver20ms: +((over20 / frames.length) * 100).toFixed(1),
    worstSustained1sFps: worstWindowFps === Infinity ? null : +worstWindowFps.toFixed(1),
  };
}

const browser = await chromium.launch({ args: LAUNCH_ARGS });

// ── 1. Determinism: DOM vs Pixi consume identical events ──────────
const domRun = await runFight(browser, 'dom');
const pixiRun = await runFight(browser, 'pixi', { sample: true });
const strip = (log) => log.map(({ index, bossHp, playerHp, finished }) => ({ index, bossHp, playerHp, finished }));
note('determinism', {
  identicalEvents: JSON.stringify(strip(domRun.fightLog)) === JSON.stringify(strip(pixiRun.fightLog)),
  domEvents: strip(domRun.fightLog),
  pixiEvents: strip(pixiRun.fightLog),
  domConsoleErrors: domRun.errors,
  pixiConsoleErrors: pixiRun.errors,
});

// ── 2. Timing conformance (Pixi run samples) ───────────────────────
const intervals = pixiRun.fightLog.slice(1).map((e, i) => e.atMs - pixiRun.fightLog[i].atMs);
note('phaseIntervalsMs', {
  values: intervals.map((v) => Math.round(v)),
  law: 1150,
  toleranceMs: 45,
  pass: intervals.every((v) => Math.abs(v - 1150) <= 45),
});

const phase1 = pixiRun.samples.filter((s) => s.phaseIndex === 1 && s.bossScaleX !== null);
let reaction = null;
if (phase1.length) {
  // First-changed → exact-settle: the sampler clamps to the final
  // keyframe (exactly 1) at the track's end, so the settle sample
  // is a sharp endpoint. Sampling granularity is the stage's own
  // frame rate under SwiftShader (~17–29ms), hence the tolerance.
  const changed = phase1.findIndex((s) => s.bossScaleX !== 1);
  let settleIdx = -1;
  if (changed >= 0) {
    for (let i = changed + 1; i < phase1.length - 2; i += 1) {
      if (phase1[i].bossScaleX === 1 && phase1[i + 1].bossScaleX === 1 && phase1[i + 2].bossScaleX === 1) {
        settleIdx = i;
        break;
      }
    }
  }
  if (changed >= 0 && settleIdx > changed) {
    const start = phase1[changed];
    const end = phase1[settleIdx];
    reaction = {
      method: 'first-changed sample → exact-settle sample (scale returns to exactly 1), 8ms sampler over the stage frame clock',
      startEffMs: Math.round(start.effMs),
      endEffMs: Math.round(end.effMs),
      durationEffMs: Math.round(end.effMs - start.effMs),
      durationWallMs: Math.round(end.rawMs - start.rawMs),
      law: 420,
      toleranceMs: 90,
    };
    reaction.pass = Math.abs(reaction.durationEffMs - 420) <= 90;
  }
}
note('hitReaction', reaction);

// Ghost drain: phase 2 (Overdrive) drops the boss bar 79% → 53%.
// Find the ghost's motion window after that phase's samples begin.
const phase2 = pixiRun.samples.filter((s) => s.phaseIndex === 2 && s.ghostPct !== null);
let ghost = null;
if (phase2.length > 4) {
  const startPct = phase2[0].ghostPct;
  const moving = phase2.filter((s) => s.ghostPct < startPct - 0.3);
  if (moving.length) {
    const target = phase2[phase2.length - 1].ghostPct;
    const settled = moving.find((s) => Math.abs(s.ghostPct - target) < 0.6);
    ghost = {
      fromPct: +startPct.toFixed(1),
      toPct: +target.toFixed(1),
      motionStartMs: Math.round(moving[0].t - phase2[0].t),
      drainMs: settled ? Math.round(settled.t - moving[0].t) : null,
      law: 480,
      toleranceMs: 130,
    };
    ghost.pass = ghost.drainMs !== null && Math.abs(ghost.drainMs - 480) <= 130;
  }
}
note('ghostDrain', ghost);

// Shake: events recorded by the stage + transform activity windows.
const shakeWindows = [];
{
  let active = null;
  for (const s of pixiRun.samples) {
    const on = s.shakeTransform && s.shakeTransform !== '' && s.shakeTransform !== 'none';
    if (on && !active) active = { key: s.shakeKey, start: s.t };
    if (!on && active) {
      shakeWindows.push({ key: active.key, activeMs: Math.round(s.t - active.start) });
      active = null;
    }
  }
}
note('shakes', {
  events: pixiRun.shakeEvents?.map((e) => ({ key: e.key, durationMs: e.durationMs })),
  observedActiveWindows: shakeWindows,
  toleranceMs: 90,
  pass:
    (pixiRun.shakeEvents?.length ?? 0) > 0 &&
    shakeWindows.every((w) => {
      const ev = pixiRun.shakeEvents.find((e) => e.key === w.key);
      return ev ? Math.abs(w.activeMs - ev.durationMs) <= 90 : false;
    }),
});
note('nodeCount', { observed: pixiRun.probe?.nodeCount, cap: 40, pass: (pixiRun.probe?.nodeCount ?? 99) <= 40 });

// ── 4. Performance ─────────────────────────────────────────────────
note('fpsPixiFight', fpsSummary(pixiRun.fpsDeltas));
note('fpsDomFight', fpsSummary(domRun.fpsDeltas));

// Cold open: navigation → stage interactive (DOM) / first Pixi tick.
async function coldOpen(renderer) {
  const { context, page } = await newPage(browser);
  const t0 = Date.now();
  await page.goto(`${BASE}/pixi-harness.html?renderer=${renderer}`, { waitUntil: 'commit' });
  if (renderer === 'pixi') {
    await page.waitForFunction(() => !!window.__cybercachePixiStage, null, { timeout: 20000 });
  } else {
    await page.waitForFunction(
      () => !!document.querySelector('[data-testid="boss-stage-boss"] img'),
      null,
      { timeout: 20000 },
    );
  }
  const ms = Date.now() - t0;
  await context.close();
  return ms;
}
note('coldOpenMs', { dom: await coldOpen('dom'), pixi: await coldOpen('pixi'), note: 'dev-server timings; indicative only' });

// ── 5. Fallback: WebGL disabled ────────────────────────────────────
{
  const fb = await chromium.launch({ args: [...LAUNCH_ARGS, '--disable-webgl', '--disable-webgl2'] });
  const { context, page, errors } = await newPage(fb);
  await page.goto(`${BASE}/pixi-harness.html?renderer=pixi&autostart=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__harnessDone === true, null, { timeout: 30000 });
  const fbState = await page.evaluate(() => ({
    // The DOM stage legitimately contains a 2D canvas (the weapon
    // compositor) — the fallback discriminator is a WEBGL canvas.
    webglCanvasPresent: [...document.querySelectorAll('canvas')].some(
      (c) => c.getContext('webgl2') || c.getContext('webgl'),
    ),
    renderer: document.querySelector('[data-testid="boss-fight-pixel-stage"]')?.getAttribute('data-renderer') ?? 'dom',
    banner: document.querySelector('[data-testid="boss-fight-banner"]')?.textContent ?? null,
    events: window.__fightLog?.length ?? 0,
  }));
  note('fallbackNoWebGL', {
    ...fbState,
    consoleErrors: errors,
    pass: !fbState.webglCanvasPresent && fbState.renderer === 'dom' && fbState.events === 6 && errors.length === 0,
  });
  await context.close();
  await fb.close();
}

// ── 3. Fidelity stills: six beats × both renderers ─────────────────
const BEATS = [
  { name: 'telegraph', freeze: 0, offsetMs: 640 },
  { name: 'hit', freeze: 1, offsetMs: 170 },
  { name: 'crit', freeze: 2, offsetMs: 170 },
  { name: 'kill', freeze: 4, offsetMs: 720 },
  { name: 'boss-death', freeze: 4, offsetMs: 1090 },
  { name: 'victory', freeze: 5, offsetMs: 850 },
];
for (const renderer of ['dom', 'pixi']) {
  const { context, page } = await newPage(browser);
  for (const beat of BEATS) {
    await page.goto(`${BASE}/pixi-harness.html?renderer=${renderer}&freeze=${beat.freeze}`, { waitUntil: 'domcontentloaded' });
    // Anchor on the phase actually starting, not on page-load
    // timing: Pixi exposes its phase clock; the DOM stage's beat
    // layer (or the end banner) mounts with the phase.
    if (renderer === 'pixi') {
      await page.waitForFunction(() => !!window.__cybercachePixiStage, null, { timeout: 20000 });
      await page.waitForFunction(
        (target) => (window.__cybercachePixiStage?.rawMs ?? -1) >= target,
        beat.offsetMs,
        { timeout: 20000 },
      );
    } else if (beat.name === 'victory') {
      await page.waitForSelector('[data-testid="boss-fight-banner"]', { timeout: 20000 });
      await page.waitForTimeout(beat.offsetMs);
    } else {
      await page.waitForSelector('[data-testid="boss-fight-beats"]', { timeout: 20000 });
      await page.waitForTimeout(beat.offsetMs);
    }
    await page.getByTestId('boss-fight-stage').screenshot({ path: path.join(OUT, 'stills', `${beat.name}-${renderer}.png`) });
  }
  await context.close();
}
note('stills', { beats: BEATS.map((b) => b.name), renderers: ['dom', 'pixi'], dir: 'stills/', anchor: 'phase-start + offsetMs (Pixi rawMs clock / DOM beat-layer mount)' });

// ── 6. Videos: full fixture fight, both renderers ──────────────────
// The reel is cut from the Pixi full-fight recording: fightLog
// timestamps are performance.now() (ms since the page's timeOrigin,
// which is when recording starts), so each beat's video time is
// log[phase].atMs + offset. reel-clips.json carries the windows.
async function recordFight(renderer) {
  const dir = path.join(OUT, 'videos', `raw-${renderer}`);
  mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir, size: VIEWPORT },
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/pixi-harness.html?renderer=${renderer}&autostart=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__harnessDone === true, null, { timeout: 30000 });
  await page.waitForTimeout(900);
  const log = await page.evaluate(() => window.__fightLog);
  await context.close(); // flushes the video
  return log;
}
await recordFight('dom');
const pixiVideoLog = await recordFight('pixi');
const REEL_PHASE = { telegraph: 0, hit: 1, crit: 2, kill: 4, 'boss-death': 4, victory: 5 };
const reelClips = BEATS.map((beat) => {
  const phaseStartMs = pixiVideoLog[REEL_PHASE[beat.name]].atMs;
  const beatAtSec = (phaseStartMs + beat.offsetMs) / 1000;
  return { name: beat.name, startSec: Math.max(0, +(beatAtSec - 0.35).toFixed(2)), durationSec: 2.8 };
});
writeFileSync(path.join(OUT, 'videos', 'reel-clips.json'), JSON.stringify({ source: 'raw-pixi', clips: reelClips }, null, 2));
note('videos', { full: ['dom', 'pixi'], reelClips, format: 'webm (Playwright); mp4 assembled by ffmpeg step' });

writeFileSync(path.join(OUT, 'probe-results.json'), JSON.stringify(results, null, 2));
await browser.close();
console.log('\nWrote', path.join(OUT, 'probe-results.json'));
