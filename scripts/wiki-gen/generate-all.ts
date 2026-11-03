#!/usr/bin/env node
/**
 * Wiki Phase 3 — generated reference tables: runner + freshness gate.
 *
 *   npm run wiki:gen         regenerate every generated block in wiki/
 *   npm run wiki:gen:check   render fresh and FAIL if any committed
 *                            page differs (the CI freshness gate)
 *
 * Each family module under scripts/wiki-gen/ renders one block from
 * the game's own source constants. A block sits in its page between:
 *
 *   <!-- GENERATED from <owners> — do not edit by hand -->
 *   <!-- wiki-gen:<id> -->
 *   ...markdown...
 *   <!-- /wiki-gen:<id> -->
 *
 * The splice replaces the GENERATED-from line through the end marker
 * with a fresh render, so owner lists stay canonical too. Everything
 * outside the markers is hand-written prose and is never touched.
 * Rendering is deterministic (source order, no timestamps), so a
 * check diff means the game data moved and the page did not — exactly
 * the drift Phase 3 exists to catch. To fix a stale page, run
 * `npm run wiki:gen` and commit the result with the data change.
 *
 * Blocks may also own binary image plates (images.ts): the runner writes
 * them under wiki/images/ and --check byte-compares them, so illustrated
 * tables are covered by the same freshness gate.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type GenAsset, type GenBlock, WIKI_DIR } from './lib';
import { weaponsBlock, affixesBlock } from './weapons';
import { areasBlock } from './areas';
import { vehiclesBlock } from './vehicles';
import { slotsBlock } from './slots';
import { legendaryEffectsBlock } from './legendaryEffects';
import { consumablesBlock } from './consumables';
import { recipesBlock } from './recipes';
import { bossesBlock } from './bosses';
import { skillTreesBlock, cacheRankBlock } from './progression';
import { collectionsBlock } from './collections';
import { changelogBlock, checkChangelogFreshness, refreshChangelogLedger } from './changelog';

interface PageSpec {
  page: string;
  blocks: GenBlock[];
}

const PAGES: PageSpec[] = [
  { page: 'Reference.md', blocks: [weaponsBlock, affixesBlock, areasBlock, vehiclesBlock, slotsBlock] },
  { page: 'Reference-Legendary-Effects.md', blocks: [legendaryEffectsBlock] },
  { page: 'Reference-Consumables.md', blocks: [consumablesBlock] },
  { page: 'Reference-Recipes.md', blocks: [recipesBlock] },
  { page: 'Reference-Bosses.md', blocks: [bossesBlock] },
  { page: 'Reference-Progression.md', blocks: [skillTreesBlock, cacheRankBlock] },
  { page: 'Reference-Collections.md', blocks: [collectionsBlock] },
  { page: 'Changelog.md', blocks: [changelogBlock] },
];

function renderBlock(block: GenBlock): string {
  const from = `<!-- GENERATED from ${block.owners.join(', ')} — do not edit by hand -->`;
  return [from, `<!-- wiki-gen:${block.id} -->`, block.render(), `<!-- /wiki-gen:${block.id} -->`].join('\n');
}

function splice(pageText: string, block: GenBlock, page: string): string {
  const beginMarker = `<!-- wiki-gen:${block.id} -->`;
  const endMarker = `<!-- /wiki-gen:${block.id} -->`;
  const lines = pageText.split('\n');
  const begin = lines.findIndex((l) => l.trim() === beginMarker);
  const end = lines.findIndex((l) => l.trim() === endMarker);
  if (begin < 0 || end < 0 || end < begin) {
    throw new Error(`${page}: generated block markers for '${block.id}' not found (looked for ${beginMarker} … ${endMarker})`);
  }
  if (begin === 0 || !lines[begin - 1].startsWith('<!-- GENERATED from ')) {
    throw new Error(`${page}: block '${block.id}' is missing its GENERATED-from line directly above the begin marker`);
  }
  const rendered = renderBlock(block).split('\n');
  return [...lines.slice(0, begin - 1), ...rendered, ...lines.slice(end + 1)].join('\n');
}

/**
 * Binary assets (image plates) ride the same freshness contract as the
 * markdown blocks: render fresh, byte-compare in --check mode, write in
 * gen mode. A file inside a managed asset directory that no block renders
 * anymore is an orphan — stale in check mode, deleted in gen mode — so a
 * renamed or removed item cannot leave its plate published.
 */
function syncAssets(assets: GenAsset[], check: boolean, stale: string[]): number {
  let written = 0;
  const wanted = new Set(assets.map((a) => a.path));
  for (const asset of assets) {
    const full = join(WIKI_DIR, asset.path);
    const fresh = !existsSync(full) || !Buffer.from(asset.bytes).equals(readFileSync(full));
    if (!fresh) continue;
    if (check) {
      stale.push(`${asset.path} (image plate ${existsSync(full) ? 'differs' : 'missing'})`);
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, asset.bytes);
      written++;
    }
  }
  const managedDirs = [...new Set(assets.map((a) => dirname(a.path)))];
  for (const dir of managedDirs) {
    const fullDir = join(WIKI_DIR, dir);
    if (!existsSync(fullDir)) continue;
    for (const file of readdirSync(fullDir)) {
      const rel = `${dir}/${file}`;
      if (wanted.has(rel)) continue;
      if (check) stale.push(`${rel} (orphan image plate)`);
      else {
        unlinkSync(join(fullDir, file));
        written++;
      }
    }
  }
  return written;
}

function main(): void {
  const check = process.argv.includes('--check');
  // Phase 4 (changelog): in write mode, harvest master's merge
  // history into the ledger snapshot before rendering, so the
  // Changelog block below renders the recorded merges. In --check
  // mode the snapshot is read-only — the gate renders from committed
  // data only, which is what keeps it deterministic.
  if (!check) refreshChangelogLedger();
  const stale: string[] = [];
  let changelogText = '';
  for (const spec of PAGES) {
    const path = join(WIKI_DIR, spec.page);
    const original = readFileSync(path, 'utf8');
    if (spec.page === 'Changelog.md') changelogText = original;
    let next = original;
    for (const block of spec.blocks) {
      next = splice(next, block, spec.page);
    }
    if (next !== original) {
      stale.push(spec.page);
      if (!check) writeFileSync(path, next);
    }
  }
  const assets = PAGES.flatMap((spec) => spec.blocks.flatMap((block) => block.assets?.() ?? []));
  const assetsWritten = syncAssets(assets, check, stale);
  const assetBytes = assets.reduce((sum, a) => sum + a.bytes.length, 0);
  if (check) {
    // Phase 4 tripwire: a master merge newer than the Changelog's
    // newest entry fails the gate even when every block renders
    // fresh — the lapse this catches is an ABSENT entry, which no
    // byte-diff of generated content can see.
    const tripwire = checkChangelogFreshness(changelogText);
    if (tripwire.status !== 'ok') console.error(`wiki-gen: ${tripwire.message}`);
    else console.log(`wiki-gen: ${tripwire.message}`);
    const failed = stale.length > 0 || tripwire.status === 'stale';
    if (stale.length) {
      console.error(`wiki-gen: STALE — ${stale.length} item(s) differ from a fresh render:`);
      for (const page of stale) console.error(`  - wiki/${page}`);
      console.error('Run `npm run wiki:gen` and commit the regenerated pages with the data change.');
    }
    if (failed) process.exit(1);
    console.log(
      `wiki-gen: OK — ${PAGES.length} page(s) and ${assets.length} image plate(s) (${assetBytes} bytes) match a fresh render.`,
    );
    return;
  }
  if (stale.length) {
    console.log(`wiki-gen: regenerated ${stale.length} page(s): ${stale.join(', ')}`);
  } else {
    console.log('wiki-gen: all pages already match a fresh render; nothing written.');
  }
  if (assets.length) {
    console.log(
      `wiki-gen: ${assets.length} image plate(s), ${assetBytes} bytes total${assetsWritten ? ` — ${assetsWritten} file(s) written` : ' — all already current'}.`,
    );
  }
}

main();
