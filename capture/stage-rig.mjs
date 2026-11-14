// CyberCache stage-iteration capture rig (parent-built, 2026-11-12).
// GitHub Actions copy (2026-11-13): identical capture logic; the only
// changes are (1) the Chromium binary comes from $CHROME_PATH when set
// (the Actions workflow resolves it the e2e-lane way) and (2) when
// $RIG_FULL_CHROME=1 the binary is a full Chrome and needs --headless=new
// (the local default is the headless shell, which needs no such flag).
// Drives headless Chromium over CDP with zero npm deps.
//
// Usage:
//   node stage-rig.mjs <vitePort> <pagePath> <outDir> <planFile.json>
//
// planFile.json:
//   { "width": 412, "height": 915, "dsf": 2,
//     "steps": [ { "eval": "window.__seedBeat('shot',25)" },
//                { "wait": 450 },
//                { "shot": "shot-mid" },
//                { "eval": "...", "wait": 300, "shot": "after" } ] }
//
// Waits for a <canvas> (or [data-testid]) to exist before running steps.
// Every screenshot lands in outDir as NN-<name>.png; a run log with
// per-file byte sizes is printed (black frames are ~125 KB at 412x915x2;
// full-art frames are ~330 KB+ — size is a tripwire, eyes are the judge).
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const [port, pagePath, outDir, planFile] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
mkdirSync(outDir, { recursive: true });

const CHROME = process.env.CHROME_PATH || (process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
const CDP_PORT = 9400 + (Number(port) % 400);
const chromeArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${CDP_PORT}`, '--window-size=500,1100', 'about:blank'];
if (process.env.RIG_FULL_CHROME === '1') chromeArgs.unshift('--headless=new');
const proc = spawn(CHROME, chromeArgs, { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let version;
for (let i = 0; i < 300; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json(); break; }
  catch { await sleep(500); }
}
if (!version) { console.log('NO CDP'); proc.kill(); process.exit(1); }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
function send(method, params = {}, sessionId) {
  return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
}
const t = await send('Target.createTarget', { url: 'about:blank' });
const att = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
const sid = att.result.sessionId;
await send('Page.enable', {}, sid);
await send('Runtime.enable', {}, sid);
await send('Emulation.setDeviceMetricsOverride', { width: plan.width ?? 412, height: plan.height ?? 915, deviceScaleFactor: plan.dsf ?? 2, mobile: true, screenWidth: plan.width ?? 412, screenHeight: plan.height ?? 915 }, sid);
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result?.result?.value;
}
await send('Page.navigate', { url: `http://127.0.0.1:${port}${pagePath}` }, sid);
for (let i = 0; i < 80; i++) { const ok = await ev(`!!(document.querySelector('canvas') || document.querySelector('[data-testid]'))`); if (ok) break; await sleep(250); }
let n = 0;
for (const step of plan.steps) {
  if (step.eval) await ev(step.eval);
  if (step.wait) await sleep(step.wait);
  if (step.shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sid);
    const buf = Buffer.from(r.result.data, 'base64');
    const name = `${outDir}/${String(n++).padStart(2, '0')}-${step.shot}.png`;
    writeFileSync(name, buf);
    console.log('shot', name, buf.length);
  }
  if (step.dump) console.log('dump', step.dump, JSON.stringify(await ev(step.dump)).slice(0, 900));
}
proc.kill();
process.exit(0);
