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
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type GenBlock, WIKI_DIR } from './lib';
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

function main(): void {
  const check = process.argv.includes('--check');
  const stale: string[] = [];
  for (const spec of PAGES) {
    const path = join(WIKI_DIR, spec.page);
    const original = readFileSync(path, 'utf8');
    let next = original;
    for (const block of spec.blocks) {
      next = splice(next, block, spec.page);
    }
    if (next !== original) {
      stale.push(spec.page);
      if (!check) writeFileSync(path, next);
    }
  }
  if (check) {
    if (stale.length) {
      console.error(`wiki-gen: STALE — ${stale.length} page(s) differ from a fresh render:`);
      for (const page of stale) console.error(`  - wiki/${page}`);
      console.error('Run `npm run wiki:gen` and commit the regenerated pages with the data change.');
      process.exit(1);
    }
    console.log(`wiki-gen: OK — ${PAGES.length} page(s), every generated block matches a fresh render.`);
    return;
  }
  if (stale.length) {
    console.log(`wiki-gen: regenerated ${stale.length} page(s): ${stale.join(', ')}`);
  } else {
    console.log('wiki-gen: all pages already match a fresh render; nothing written.');
  }
}

main();
