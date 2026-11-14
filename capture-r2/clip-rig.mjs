// CyberCache stage-iteration CLIP rig (parent-built, 2026-11-12).
// Captures a real-time screencast of a harness page over CDP and
// assembles an .mp4 the owner can review. Zero npm deps.
//
// Usage:
//   node clip-rig.mjs <vitePort> <pagePath> <outFile.mp4> <planFile.json>
//
// planFile.json:
//   { "width": 412, "height": 915, "dsf": 2, "seconds": 12,
//     "steps": [ { "at": 2.0, "eval": "window.__seedBeat('shot',25)" }, ... ] }
//
// Honesty note: the harness renders under SwiftShader on this VM, so
// the frame rate inside the clip is the RIG's, not a Pixel's. The
// clip proves composition, spacing, sequencing, visibility — never
// device frame pacing. Say so wherever a clip is presented.
//
// Actions adaptation (2026-11-13): CHROME from $CHROME_PATH when set,
// FFMPEG from $FFMPEG_PATH or PATH (runner ffmpeg is a full build).
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const [port, pagePath, outFile, planFile] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(planFile, 'utf8'));
const seconds = plan.seconds ?? 12;

const CHROME = process.env.CHROME_PATH || (process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell');
// System ffmpeg (full build, libx264). The Playwright ffmpeg is a
// minimal webm-only build — do not use it for review clips.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const CDP_PORT = 9800 + (Number(port) % 150);
const SPAWN_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--remote-debugging-port=${CDP_PORT}`, '--window-size=500,1100', 'about:blank'];
if (process.env.RIG_FULL_CHROME === '1') SPAWN_ARGS.unshift('--headless=new');
const proc = spawn(CHROME, SPAWN_ARGS, { stdio: 'inherit' });
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
const frames = [];
let sid = null;
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Page.screencastFrame' && m.sessionId === sid) {
    frames.push({ data: m.params.data, ts: m.params.metadata.timestamp });
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId }, sid).catch(() => {});
  }
});
function send(method, params = {}, sessionId) {
  return new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
}
const t = await send('Target.createTarget', { url: 'about:blank' });
const att = await send('Target.attachToTarget', { targetId: t.result.targetId, flatten: true });
sid = att.result.sessionId;
await send('Page.enable', {}, sid);
await send('Runtime.enable', {}, sid);
const W = plan.width ?? 412, H = plan.height ?? 915;
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: plan.dsf ?? 2, mobile: true, screenWidth: W, screenHeight: H }, sid);
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid);
  if (r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
}
await send('Page.navigate', { url: `http://127.0.0.1:${port}${pagePath}` }, sid);
for (let i = 0; i < 80; i++) { const ok = await ev(`!!(document.querySelector('canvas') || document.querySelector('[data-testid]'))`); if (ok) break; await sleep(250); }
// let the stage settle to its rest state before the clip starts
await sleep(plan.settleMs ?? 2500);
await send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 }, sid);
const t0 = Date.now();
const timers = (plan.steps ?? []).map((s) => setTimeout(() => { ev(s.eval).catch(() => {}); }, (s.at ?? 0) * 1000));
await sleep(seconds * 1000);
timers.forEach(clearTimeout);
await send('Page.stopScreencast', {}, sid);
const elapsed = (Date.now() - t0) / 1000;
proc.kill();
if (frames.length < 5) { console.log('TOO FEW FRAMES', frames.length); process.exit(1); }
const dir = `/tmp/clipframes-${process.pid}`;
mkdirSync(dir, { recursive: true });
frames.forEach((f, i) => writeFileSync(`${dir}/${String(i).padStart(4, '0')}.jpg`, Buffer.from(f.data, 'base64')));
const fps = Math.max(1, Math.round(frames.length / elapsed));
console.log(`frames=${frames.length} elapsed=${elapsed.toFixed(1)}s fps=${fps}`);
try {
  execFileSync(FFMPEG, ['-y', '-framerate', String(fps), '-i', `${dir}/%04d.jpg`, '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile], { stdio: 'pipe' });
  console.log('encoded libx264 ->', outFile);
} catch {
  execFileSync(FFMPEG, ['-y', '-framerate', String(fps), '-i', `${dir}/%04d.jpg`, '-c:v', 'mpeg4', '-q:v', '3', '-movflags', '+faststart', outFile], { stdio: 'pipe' });
  console.log('encoded mpeg4 (libx264 unavailable) ->', outFile);
}
rmSync(dir, { recursive: true, force: true });
process.exit(0);
