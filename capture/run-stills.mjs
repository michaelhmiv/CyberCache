// Dashboard-iteration stills driver for GitHub Actions (2026-11-13).
// Runs inside the checked-out ITERATION branch workspace; the shared rig
// (stage-rig.mjs) sits next to this file in the .dash-capture checkout.
//
// Reads ./capture-manifest.json from the workspace root:
//   { "iter": "02", "port": 7120, "harnessPage": "/anatomy-harness.html",
//     "captures": [ { "name": "roam-rest",
//                     "path": "/anatomy-harness.html?act=roam&beat=rest",
//                     "plan": "capture/plans/roam-rest.json" }, ... ] }
//
// Starts the iteration's Vite dev server, waits for the harness page,
// runs each capture plan through stage-rig.mjs (STILLS ONLY — clip plans
// are never in the manifest), and collects the frames into stills-out/
// under the program naming convention (<activity>-<beat>.png).
// Writes stills-out/capture-summary.json; exit code 1 if any capture is
// missing or suspiciously small (the workflow uploads the artifact with
// if: always(), so evidence survives a failed run).
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync, readdirSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const manifest = JSON.parse(readFileSync(join(root, 'capture-manifest.json'), 'utf8'));
const port = manifest.port;
const outDir = join(root, 'stills-out');
const tmpDir = join(root, '.capture-tmp');
mkdirSync(outDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let vite;
let exitCode = 0;

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    p.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    p.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    const timer = opts.timeoutMs ? setTimeout(() => { p.kill('SIGKILL'); }, opts.timeoutMs) : null;
    p.on('close', (code) => { if (timer) clearTimeout(timer); res({ code, out }); });
    p.on('error', (err) => { if (timer) clearTimeout(timer); res({ code: -1, out: String(err) }); });
  });
}

try {
  const viteLog = createWriteStream(join(root, 'vite-capture.log'));
  vite = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(port), '--host', '127.0.0.1', '--strictPort'], { cwd: root, env: process.env });
  vite.stdout.pipe(viteLog);
  vite.stderr.pipe(viteLog);

  const pageUrl = `http://127.0.0.1:${port}${manifest.harnessPage}`;
  let up = false;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(pageUrl); if (r.status === 200) { up = true; break; } } catch { /* not up yet */ }
    await sleep(1000);
  }
  if (!up) throw new Error(`vite never served ${pageUrl}`);
  console.log(`vite up on ${port}, harness ${manifest.harnessPage} HTTP 200`);

  for (const cap of manifest.captures) {
    const capTmp = join(tmpDir, cap.name);
    mkdirSync(capTmp, { recursive: true });
    const planAbs = resolve(root, cap.plan);
    console.log(`\n=== capture ${cap.name} :: ${cap.path} :: plan ${cap.plan} ===`);
    const r = await run('node', [join(here, 'stage-rig.mjs'), String(port), cap.path, capTmp, planAbs], { timeoutMs: 300000 });
    const shots = existsSync(capTmp) ? readdirSync(capTmp).filter((f) => f.endsWith('.png')) : [];
    const src = shots.map((f) => join(capTmp, f)).find((f) => f.endsWith(`-${cap.name}.png`)) || (shots.length ? join(capTmp, shots[0]) : null);
    if (src && existsSync(src)) {
      const bytes = statSync(src).size;
      const dest = join(outDir, `${cap.name}.png`);
      copyFileSync(src, dest);
      results.push({ name: cap.name, ok: bytes > 0, bytes, rigExit: r.code });
      console.log(`LANDED ${cap.name}.png ${bytes} bytes`);
    } else {
      results.push({ name: cap.name, ok: false, bytes: 0, rigExit: r.code, error: 'no PNG produced' });
      console.log(`MISSING ${cap.name} (rig exit ${r.code})`);
      exitCode = 1;
    }
  }
} catch (err) {
  console.log('DRIVER ERROR', String(err && err.message || err));
  exitCode = 1;
} finally {
  if (vite) vite.kill('SIGKILL');
}

const landed = results.filter((r) => r.ok).length;
const summary = { iter: manifest.iter, port, total: manifest.captures.length, landed, results, finishedAt: new Date().toISOString() };
writeFileSync(join(outDir, 'capture-summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nSUMMARY iter-${manifest.iter}: ${landed}/${manifest.captures.length} stills landed`);
process.exit(exitCode);
