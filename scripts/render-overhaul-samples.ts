/**
 * Gate-sample + golden-baseline renderer (visual overhaul).
 *
 *   npx tsx scripts/render-overhaul-samples.ts
 *     → writes every golden scene to docs/pixel-samples/<id>.png
 *       (the G0–G4 review boards are tiled from these by
 *        scripts/tile-sample-boards.py)
 *   npx tsx scripts/render-overhaul-samples.ts --baselines
 *     → ALSO writes src/test/golden/baselines/<id>.png
 *       (npm run golden:update) — baseline changes are reviewed by
 *        Muse against the gate-approved art direction.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../src/lib/pixel/pngCodec';
import { GOLDEN_SCENES } from '../src/test/golden/goldenScenes';

const writeBaselines = process.argv.includes('--baselines');
const samplesDir = join(process.cwd(), 'docs/pixel-samples');
const baselinesDir = join(process.cwd(), 'src/test/golden/baselines');
mkdirSync(samplesDir, { recursive: true });
if (writeBaselines) mkdirSync(baselinesDir, { recursive: true });

for (const goldenScene of GOLDEN_SCENES) {
  const png = encodePng(goldenScene.render());
  writeFileSync(join(samplesDir, `${goldenScene.id}.png`), png);
  if (writeBaselines) writeFileSync(join(baselinesDir, `${goldenScene.id}.png`), png);
  console.log(`rendered ${goldenScene.id}`);
}
console.log(`done: ${GOLDEN_SCENES.length} scenes${writeBaselines ? ' (baselines updated)' : ''}`);
