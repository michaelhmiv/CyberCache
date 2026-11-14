// R2 fix-round driver (GitHub Actions). Runs INSIDE the job workspace:
// the workspace root is a checkout of stage-iter/r2-drops; this file
// lives in .dash-capture/capture-r2/ (dash/capture tooling checkout).
// Serves the branch on vite 5212, runs the handoff capture queue with
// the CDP stage rig (stills sets) + clip rig (real-time clip), and
// collects everything into r2-out/ for the artifact upload. Rig stdout
// is saved per set (r2-out/<set>/rig-log.txt) — the plans' paired DOM
// dumps and the in-page rise sampler trace live there, which is the
// honesty record the handoff requires next to every still.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const OUT = join(ROOT, 'r2-out');
const PORT = 5212;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: ROOT, ...opts });
    let out = '';
    p.stdout?.on('data', (d) => { out += d; process.stdout.write(d); });
    p.stderr?.on('data', (d) => { out += d; process.stderr.write(d); });
    p.on('close', (code) => resolve({ code, out }));
    p.on('error', () => resolve({ code: -1, out }));
  });
}

async function waitForPage(path, timeoutMs = 120000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${path}`);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  return false;
}

const SETS = [
  { name: 'material-pixi2', page: '/roam-harness.html?width=412', plan: 'fix1-material2.json' },
  { name: 'material-dom2', page: '/roam-harness.html?renderer=dom&width=412', plan: 'fix1-material2.json' },
  { name: 'crate-pixi2', page: '/roam-harness.html?width=412', plan: 'fix1-crate2.json' },
  { name: 'bench', page: '/bench-harness.html?mode=crafting&state=complete', plan: 'fix1-bench2.json' },
  { name: 'salvage', page: '/loot-harness.html?mode=salvage', plan: 'fix1-salvage2.json' },
  { name: 'extract', page: '/loot-harness.html?mode=extract', plan: 'fix1-extract2.json' },
];

async function main() {
  if (!process.env.CHROME_PATH) { console.log('CHROME_PATH not set'); process.exit(1); }
  const vite = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(PORT),
    '--host', '127.0.0.1', '--strictPort'],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let viteLog = '';
  vite.stdout.on('data', (d) => { viteLog += d; });
  vite.stderr.on('data', (d) => { viteLog += d; });
  const cleanup = () => { try { vite.kill('SIGTERM'); } catch { /* gone */ } };
  process.on('exit', cleanup);

  const results = [];
  try {
    if (!(await waitForPage('/roam-harness.html'))) {
      console.log('VITE NEVER SERVED /roam-harness.html');
      results.push({ set: 'vite', ok: false });
      writeFileSync(join(OUT, 'vite-r2.log'), viteLog);
      writeFileSync(join(OUT, 'r2-summary.json'), JSON.stringify({ results }, null, 1));
      process.exit(1);
    }
    for (const s of SETS) {
      const setDir = join(OUT, s.name);
      mkdirSync(setDir, { recursive: true });
      console.log(`=== SET ${s.name} page=${s.page} plan=${s.plan}`);
      const r = await run('node', [join(TOOLS, 'stage-rig.mjs'), String(PORT), s.page,
        setDir, join(TOOLS, 'plans', s.plan)], { timeout: 420000 });
      writeFileSync(join(setDir, 'rig-log.txt'), r.out);
      const pngs = readdirSync(setDir).filter((f) => f.endsWith('.png'));
      const ok = r.code === 0 && pngs.length > 0 &&
        pngs.every((f) => statSync(join(setDir, f)).size > 0);
      results.push({ set: s.name, ok, rigExit: r.code, pngs: pngs.length });
      console.log(`=== ${s.name}: ${pngs.length} PNGs, rig exit ${r.code}`);
    }
    // Clip (kill-true material drop, real-time screencast, DSF 1).
    const clipDir = join(OUT, 'clips');
    mkdirSync(clipDir, { recursive: true });
    const clipPath = join(clipDir, 'material-drop-rise.mp4');
    console.log('=== CLIP material-drop-rise');
    const cr = await run('node', [join(TOOLS, 'clip-rig.mjs'), String(PORT),
      '/roam-harness.html?width=412', clipPath, join(TOOLS, 'plans', 'fix1-clip.json')],
      { timeout: 420000 });
    writeFileSync(join(clipDir, 'clip-rig-log.txt'), cr.out);
    const clipOk = cr.code === 0 && existsSync(clipPath) && statSync(clipPath).size > 0;
    results.push({ set: 'clip', ok: clipOk, rigExit: cr.code,
      bytes: clipOk ? statSync(clipPath).size : 0 });
    // Measured unique fps via mpdecimate (drops duplicate frames).
    if (clipOk) {
      const dec = await run('ffmpeg', ['-i', clipPath, '-vf', 'mpdecimate',
        '-loglevel', 'info', '-f', 'null', '-'], {});
      const m = [...dec.out.matchAll(/frame=\s*(\d+)/g)].pop();
      const total = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
        '-count_frames', '-show_entries', 'stream=nb_read_frames,duration,r_frame_rate',
        '-of', 'csv', clipPath], {});
      const report = { decimatedFrames: m ? Number(m[1]) : null,
        probe: total.out.trim(), seconds: 9,
        note: 'unique fps = decimatedFrames / 9 (plan seconds). Harness render (SwiftShader), not device fps.' };
      if (report.decimatedFrames) report.uniqueFps = +(report.decimatedFrames / 9).toFixed(2);
      writeFileSync(join(clipDir, 'fps-report.json'), JSON.stringify(report, null, 1));
      console.log('fps report:', JSON.stringify(report));
      results.push({ set: 'fps', ok: !!report.decimatedFrames, ...report });
    }
  } finally {
    cleanup();
  }
  writeFileSync(join(OUT, 'vite-r2.log'), viteLog);
  writeFileSync(join(OUT, 'r2-summary.json'), JSON.stringify({ results }, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`R2 DONE: ${results.length - failed.length}/${results.length} ok`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
