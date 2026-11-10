/**
 * Anim-replay driver (Track A — animation iteration loop, 2026-11-10).
 *
 * Plays a fixed, deterministic fight timeline on the REAL roam stage
 * through the dev harness (/roam-harness.html) and records frame
 * sequences + the stage's own probe samples, so the metrics
 * extractor can grade the animation against the brief's B2 criteria
 * without a human re-recording anything.
 *
 * Scenarios:
 *   fight  (pixi) — drone spawn + walk-in → shot beats → a crit →
 *                   a player-hit → kill → loot rise; travel advance
 *                   to a raider; brute fight; a mid-fight target
 *                   swap (F6 transition profile).
 *   resume (pixi + dom) — mid-fight: seed a shot beat and let it
 *                   settle, freeze the page's rAF for HOLD_MS
 *                   (10s wall-clock — the backgrounding shape),
 *                   grab the last pre-freeze frame, restore, and
 *                   record 5s of post-resume frames + probes.
 *
 * The rAF freeze is done by stalling every requestAnimationFrame
 * callback in a queue and releasing the queue on restore: the
 * page's clocks (performance.now) keep running, only frame delivery
 * stops — the same outer shape as a backgrounded tab/app (rAF
 * halted, timers throttled, wall clock advanced). CDP lifecycle
 * freeze was rejected for the baseline because headless Chrome's
 * Page.setWebLifecycleState also freezes the CDP screenshot path
 * the loop depends on; the fidelity limits are written up in the
 * baseline report.
 *
 * Env: ANIM_WT (worktree root), ANIM_OUT (frames dir), ANIM_PORT,
 * ANIM_ONLY (fight|resume), REPO_SHA (provenance stamp).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let chromium;
for (const candidate of [
  process.env.PLAYWRIGHT_CORE,
  'playwright-core',
  '/home/hatch/workspace/cybercache-prep/visual-audit/node_modules/playwright-core/index.mjs',
]) {
  if (!candidate) continue;
  try {
    ({ chromium } = await import(candidate));
    if (chromium) break;
  } catch { /* try next */ }
}
if (!chromium) throw new Error('playwright-core not resolvable (set PLAYWRIGHT_CORE)');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WT = process.env.ANIM_WT ?? path.resolve(HERE, '..', '..');
const OUT = process.env.ANIM_OUT ?? path.join(WT, 'anim-replay-out');
const PORT = Number(process.env.ANIM_PORT ?? 5417);
const ONLY = process.env.ANIM_ONLY ?? '';
const CHROME = process.env.CHROME_PATH ?? '/home/hatch/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome';
const FRAME_MS = 100; // ~10fps sampling — pose/beat scale, cheap files
const HOLD_MS = 10_000;

mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(url, tries = 90) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`server did not come up: ${url}`);
}

// ── Frame recorder ────────────────────────────────────────────────
// Polls the stage canvas (Pixi) or the stage element (DOM) on a
// fixed cadence. Canvas grabs are in-page toDataURL round-trips
// (the M2b pattern: an element screenshot of a SwiftShader canvas
// takes ~1.5s and would destroy the cadence); DOM has no canvas,
// so it takes element screenshots at a coarser cadence.
function startRecorder(page, { renderer, tag }) {
  const frames = [];
  let stopped = false;
  const startedAt = Date.now();
  const cadence = renderer === 'pixi' ? FRAME_MS : 250;
  const loop = async () => {
    while (!stopped) {
      const t = Date.now() - startedAt;
      try {
        if (renderer === 'pixi') {
          const dataUrl = await page.evaluate(() => {
            const app = window.__pixiApp;
            const c = document.querySelector('[data-testid="roam-pixi-stage"] canvas');
            if (!c) return null;
            // The stage app does not preserve its drawing buffer, so a
            // bare toDataURL reads the cleared (black) buffer. Force a
            // synchronous render first — the M2b grab pattern worked
            // because its rAF callback grabbed inside the app's own
            // frame; this render-then-grab is the deterministic form.
            if (app) { try { app.renderer.render(app.stage); } catch { /* keep the grab attempt */ } }
            return c.toDataURL('image/png');
          });
          if (dataUrl) {
            const file = `${tag}-${String(frames.length).padStart(4, '0')}.png`;
            writeFileSync(path.join(OUT, file), Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'));
            frames.push({ t, file });
          }
        } else {
          const el = await page.$('[data-testid="pixel-diorama-stage"]');
          if (el) {
            const file = `${tag}-${String(frames.length).padStart(4, '0')}.png`;
            await el.screenshot({ path: path.join(OUT, file) });
            frames.push({ t, file });
          }
        }
      } catch { /* page mid-navigation or frozen CDP — the gap is data */ }
      await sleep(cadence);
    }
  };
  const done = loop();
  return {
    frames,
    startedAt,
    async stop() { stopped = true; await done; },
    now: () => Date.now() - startedAt,
  };
}

// ── Probe sampler ─────────────────────────────────────────────────
// Samples the stage's own DEV probe surface from inside the page at
// ~50ms: beat kind/ms, pose, enemy rig key, travel sample, pan —
// ground truth the pixel metrics are checked against.
async function installProbeSampler(page) {
  await page.evaluate(() => {
    const w = window;
    // Find the Pixi app through the stage's React fiber (the app is
    // held in a component ref, not on window). Used ONLY to force a
    // synchronous render before a frame grab (see startRecorder) —
    // read-only w.r.t. the game.
    if (!w.__pixiApp) {
      const host = document.querySelector('[data-testid="roam-pixi-stage"]');
      const key = host ? Object.keys(host).find((k) => k.startsWith('__reactFiber')) : null;
      let fiber = key && host ? host[key] : null;
      for (let depth = 0; fiber && depth < 60 && !w.__pixiApp; depth++) {
        const hooks = fiber.memoizedState;
        for (let h = hooks, i = 0; h && i < 30; i++, h = h.next) {
          const v = h.memoizedState?.current;
          if (v && v.scene && v.fps) { w.__pixiApp = null; w.__animRuntime = v; }
          if (v && typeof v.init === 'function' && v.stage && v.renderer) w.__pixiApp = v;
        }
        fiber = fiber.return;
      }
    }
    w.__animProbeSamples = [];
    const t0 = performance.now();
    w.__animProbeTimer = setInterval(() => {
      const p = w.__cybercacheRoamPixiStage;
      const samples = w.__animProbeSamples;
      if (samples.length > 4000) samples.shift();
      samples.push({
        t: Math.round(performance.now() - t0),
        beatKind: p?.beatKind ?? null,
        beatMs: p?.beatMs ?? null,
        pose: p?.pose ?? null,
        enemyRig: p?.enemyRig ?? null,
        enemyXPct: (p && "enemyXPct" in p) ? p.enemyXPct : "ABSENT",
        walkOffsetXPct: p?.walkOffsetXPct ?? null,
        travel: p?.travel ?? null,
        panNearPx: p?.panNearPx ?? null,
        fpsAvg: p?.fpsAvg ?? null,
        fpsDeltasTail: Array.isArray(w.__fpsDeltas) ? w.__fpsDeltas.length : 0,
      });
    }, 50);
  });
}

async function newStagePage(browser, renderer) {
  const page = await browser.newPage({ viewport: { width: 430, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  if (renderer === 'pixi') {
    // PRESERVE FIX: force preserveDrawingBuffer onto the stage's
    // WebGL context from BEFORE any page script runs. The stage app
    // never sets it, so canvas grabs (toDataURL) read the cleared
    // buffer — uniformly black frames. Pixi obtains its context via
    // HTMLCanvasElement.getContext; wrapping that entry point here
    // changes readback only — never game state or what's rendered.
    await page.addInitScript(() => {
      const proto = HTMLCanvasElement.prototype;
      const orig = proto.getContext;
      proto.getContext = function (type, attrs) {
        if (type === 'webgl2' || type === 'webgl') {
          return orig.call(this, type, { ...(attrs || {}), preserveDrawingBuffer: true });
        }
        return orig.call(this, type, attrs);
      };
    });
  }
  await page.goto(`http://127.0.0.1:${PORT}/roam-harness.html?renderer=${renderer}&scene=travel&width=390`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pixel-diorama-stage"]', { timeout: 20000 });
  if (renderer === 'pixi') {
    await page.waitForSelector('[data-testid="roam-pixi-stage"] canvas', { timeout: 20000 });
    await page.waitForFunction(() => !!window.__cybercacheRoamPixiStage, { timeout: 20000 });
  } else {
    await page.waitForSelector('[data-testid="pixel-hunter"]', { timeout: 20000 });
    await page.waitForSelector('[data-testid="pixel-enemy"]', { timeout: 20000 });
  }
  return { page, errors };
}

const ev = (page, fn, arg) => page.evaluate(fn, arg);

// ── Scenario: fight (pixi) ────────────────────────────────────────
async function scenarioFight(browser, results) {
  const { page, errors } = await newStagePage(browser, 'pixi');
  await installProbeSampler(page);
  const actions = [];
  const rec = startRecorder(page, { renderer: 'pixi', tag: 'fight' });
  // Phase 0 — mount target is the raider; settle into the idle fight.
  await sleep(2000);
  // Phase 1 — drone: spawn (walk-in replays), then the beat ladder.
  const A = async (name, fn, afterMs) => { actions.push({ name, t: rec.now() }); await fn(); await sleep(afterMs); };
  await A('drone-spawn', () => ev(page, () => window.__setTarget('dustwaste_drone', 35, 35)), 1400);
  await A('shot-1', () => ev(page, () => window.__seedBeat('shot', 10)), 1300);
  await A('shot-2', () => ev(page, () => window.__seedBeat('shot', 10)), 1300);
  await A('crit', () => ev(page, () => window.__seedBeat('crit', 20)), 1300);
  await A('player-hit', () => ev(page, () => window.__seedBeat('playerHit', 7)), 1500);
  await A('drone-kill', () => ev(page, () => window.__seedBeat('kill', 10)), 900);
  await A('loot-drop', () => ev(page, () => window.__seedBeat('drop')), 3200);
  // Phase 2 — travel advance: kill gap -> the raider walks the hunter over.
  await A('travel-advance', () => ev(page, () => window.__advanceTarget()), 2600);
  await A('raider-shot', () => ev(page, () => window.__seedBeat('shot', 10)), 1300);
  // Phase 3 — brute fight.
  await A('brute-spawn', () => ev(page, () => window.__setTarget('dustwaste_brute', 80, 80)), 1400);
  await A('brute-shot', () => ev(page, () => window.__seedBeat('shot', 10)), 1300);
  await A('brute-kill', () => ev(page, () => window.__seedBeat('kill', 10)), 1600);
  // Phase 4 — mid-fight swap (F6): straight back to the drone.
  await A('swap-to-drone', () => ev(page, () => window.__setTarget('dustwaste_drone', 35, 35)), 1800);

  await rec.stop();
  const probes = await ev(page, () => window.__animProbeSamples ?? []);
  const fpsDeltas = await ev(page, () => window.__fpsDeltas ?? []);
  results.push({ scenario: 'fight', renderer: 'pixi', frames: rec.frames, actions, probes, fpsDeltas, errors });
  await page.close();
}

// ── Scenario: resume (pixi + dom) ─────────────────────────────────
async function scenarioResume(browser, results, renderer) {
  const { page, errors } = await newStagePage(browser, renderer);
  if (renderer === 'pixi') await installProbeSampler(page);
  // Arm the rAF stall BEFORE the fight starts so the freeze helper
  // is in place; the stall itself is toggled by flags.
  await page.evaluate(() => {
    const w = window;
    if (w.__animFreezeInstalled) return;
    w.__animFreezeInstalled = true;
    w.__animFrozen = false;
    w.__animStash = [];
    const origRaf = window.requestAnimationFrame.bind(window);
    const origCancel = window.cancelAnimationFrame.bind(window);
    const held = new Map();
    let nextId = 1;
    window.requestAnimationFrame = (cb) => {
      const id = nextId++;
      if (w.__animFrozen) { w.__animStash.push({ id, cb }); return id; }
      held.set(id, origRaf((ts) => { held.delete(id); cb(ts); }));
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      const i = w.__animStash.findIndex((s) => s.id === id);
      if (i >= 0) { w.__animStash.splice(i, 1); return; }
      if (held.has(id)) { origCancel(held.get(id)); held.delete(id); }
    };
    w.__animSetFrozen = (frozen) => {
      w.__animFrozen = frozen;
      if (!frozen) {
        const stash = w.__animStash.splice(0, w.__animStash.length);
        // Release the held callbacks with the CURRENT timestamp —
        // what a real browser does when the page becomes visible:
        // queued rAFs fire with fresh time, not catch-up time.
        for (const { cb } of stash) { try { cb(performance.now()); } catch { /* a dead callback is data */ } }
      }
    };
  });
  await sleep(1500);
  // Mid-fight: a shot lands, its reaction window opens, then the
  // app "backgrounds" before the fight can settle.
  await ev(page, () => window.__seedBeat('shot', 10));
  await sleep(600);
  const rec = startRecorder(page, { renderer, tag: `resume-${renderer}` });
  const t0 = rec.now();
  await sleep(400);
  const freezeAt = rec.now();
  await ev(page, () => window.__animSetFrozen(true));
  await sleep(HOLD_MS);
  const resumeAt = rec.now();
  await ev(page, () => window.__animSetFrozen(false));
  await sleep(5000);
  await rec.stop();
  const probes = renderer === 'pixi' ? await ev(page, () => window.__animProbeSamples ?? []) : [];
  const fpsDeltas = await ev(page, () => window.__fpsDeltas ?? []);
  results.push({
    scenario: 'resume', renderer, frames: rec.frames,
    actions: [
      { name: 'rec-start', t: t0 }, { name: 'freeze', t: freezeAt },
      { name: 'resume', t: resumeAt }, { name: 'rec-end', t: rec.now() },
    ],
    probes, fpsDeltas, errors,
  });
  await page.close();
}

// ── Main ──────────────────────────────────────────────────────────
const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'], {
  cwd: WT, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; });
server.stderr.on('data', (d) => { serverLog += d; });

const results = [];
let failure = null;
try {
  await waitForServer(`http://127.0.0.1:${PORT}/roam-harness.html`);
  const harnessSrc = await (await fetch(`http://127.0.0.1:${PORT}/src/harness/roamMain.tsx`)).text();
  if (!harnessSrc.includes('RoamHarnessPage')) throw new Error('asset-identity: harness module mismatch');
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
  });
  if (ONLY !== 'resume') await scenarioFight(browser, results);
  if (ONLY !== 'fight') {
    await scenarioResume(browser, results, 'pixi');
    await scenarioResume(browser, results, 'dom');
  }
  await browser.close();
} catch (e) {
  failure = e;
} finally {
  server.kill('SIGTERM');
}
writeFileSync(path.join(OUT, 'replay.json'), JSON.stringify({
  sha: process.env.REPO_SHA ?? 'unknown',
  generatedAt: new Date().toISOString(),
  frameMs: FRAME_MS, holdMs: HOLD_MS,
  results, serverLogTail: serverLog.slice(-400),
  ...(failure ? { failure: String(failure?.stack ?? failure) } : {}),
}, null, 2));
// Exit EXPLICITLY, success or failure. The first CI dispatch
// (2026-11-10, run 42893452472) proved why: all scenarios finished
// and replay.json was written at 20:17:57Z, yet the step ran 75+
// minutes until cancelled — SIGTERM kills the npx wrapper but its
// vite child can survive orphaned, holding the stdio pipes open,
// so node's event loop never drains and the process never exits
// (and the workflow's metrics step never runs). A scenario failure
// must likewise fail fast with its partial results on disk, not
// hang the job until the runner timeout.
if (failure) {
  console.error(`replay FAILED: ${failure?.stack ?? failure}`);
  process.exit(1);
}
console.log(`replay done: ${results.map((r) => `${r.scenario}/${r.renderer}=${r.frames.length} frames`).join(' · ')}`);
process.exit(0);
