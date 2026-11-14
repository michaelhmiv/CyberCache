// Dashboard-iteration stills driver for GitHub Actions (2026-11-13, v2).
// Runs inside the checked-out ITERATION branch workspace; the shared rig
// (stage-rig.mjs) sits next to this file in the .dash-capture checkout.
//
// Reads ./capture-manifest.json from the workspace root:
//   { "iter": "02", "port": 7120, "harnessPage": "/anatomy-harness.html",
//     "viteConfig": "vite.signal.config.ts",            // optional
//     "captures": [
//       { "label": "roam",                               // plan-run label
//         "path": "/signal-harness.html?activity=roam&beat=rest&renderer=dom",
//         "plan": "capture/plans/roam.json",
//         "prefix": "roam",                              // optional: bare
//                                                        // shot names get
//                                                        // "<prefix>-"
//         "expect": ["roam-rest", "roam-surge"] } ] }    // optional: final
//                                                        // still names that
//                                                        // MUST land
//
// Starts the iteration's Vite dev server, waits for the harness page,
// runs each capture plan through stage-rig.mjs (STILLS ONLY — clip plans
// are never in the manifest), and collects EVERY frame the plan produces
// into stills-out/ under the program naming convention
// (<activity>-<beat>.png, NN- index stripped). Writes
// stills-out/capture-summary.json; exit code 1 if any capture errors or
// any expected still is missing/empty (the workflow uploads the
// artifact with if: always(), so evidence survives a failed run).
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
const landed = new Map(); // still name -> bytes
const runReports = [];
let vite;
let exitCode = 0;

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', (d) => process.stdout.write(d));
    p.stderr.on('data', (d) => process.stderr.write(d));
    const timer = opts.timeoutMs ? setTimeout(() => { p.kill('SIGKILL'); }, opts.timeoutMs) : null;
    p.on('close', (code) => { if (timer) clearTimeout(timer); res({ code }); });
    p.on('error', (err) => { if (timer) clearTimeout(timer); res({ code: -1, error: String(err) }); });
  });
}

try {
  const viteLog = createWriteStream(join(root, 'vite-capture.log'));
  const viteArgs = ['node_modules/vite/bin/vite.js', '--port', String(port), '--host', '127.0.0.1', '--strictPort'];
  if (manifest.viteConfig) viteArgs.push('--config', manifest.viteConfig);
  vite = spawn('node', viteArgs, { cwd: root, env: process.env });
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
    const label = cap.label || cap.name; // v1 manifests used "name"
    const capTmp = join(tmpDir, label);
    mkdirSync(capTmp, { recursive: true });
    const planAbs = resolve(root, cap.plan);
    console.log(`\n=== capture ${cap.label} :: ${cap.path} :: plan ${cap.plan} ===`);
    const rigFile = cap.rig === 'dom' ? 'stage-rig-dom.mjs' : 'stage-rig.mjs';
    const r = await run('node', [join(here, rigFile), String(port), cap.path, capTmp, planAbs], { timeoutMs: 420000 });
    const shots = existsSync(capTmp) ? readdirSync(capTmp).filter((f) => f.endsWith('.png')).sort() : [];
    const got = [];
    for (const f of shots) {
      const shot = f.replace(/^\d+-/, '').replace(/\.png$/, '');
      const name = cap.prefix && !shot.startsWith(`${cap.prefix}-`) ? `${cap.prefix}-${shot}` : shot;
      const src = join(capTmp, f);
      const bytes = statSync(src).size;
      copyFileSync(src, join(outDir, `${name}.png`));
      landed.set(name, bytes);
      got.push({ name, bytes });
      console.log(`LANDED ${name}.png ${bytes} bytes`);
    }
    if (!got.length) { console.log(`MISSING ${label} (rig exit ${r.code})`); exitCode = 1; }
    runReports.push({ label, rigExit: r.code, shots: got });
  }
} catch (err) {
  console.log('DRIVER ERROR', String((err && err.message) || err));
  exitCode = 1;
} finally {
  if (vite) vite.kill('SIGKILL');
}

const expected = manifest.captures.flatMap((c) => c.expect || []);
const missing = expected.filter((n) => !landed.has(n) || (landed.get(n) || 0) === 0);
if (missing.length) { console.log(`EXPECTED BUT MISSING/EMPTY: ${missing.join(', ')}`); exitCode = 1; }
const summary = {
  iter: manifest.iter, port,
  landedCount: landed.size,
  landed: Object.fromEntries([...landed.entries()].map(([n, b]) => [n, b])),
  expected, missing, runs: runReports,
  finishedAt: new Date().toISOString(),
};
writeFileSync(join(outDir, 'capture-summary.json'), JSON.stringify(summary, null, 2));
console.log(`\nSUMMARY iter-${manifest.iter}: ${landed.size} stills landed, ${missing.length} expected missing`);
process.exit(exitCode);
