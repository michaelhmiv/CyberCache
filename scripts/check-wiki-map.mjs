#!/usr/bin/env node
/**
 * Wiki drift check (Wiki Phase 3 — mode-driven, FAIL by default).
 *
 * Reads wiki/.page-map.json and a list of changed files, then reports every
 * mapped gameplay source that changed WITHOUT at least one of its wiki pages
 * also changing. This is the prose-drift tripwire described in docs/WIKI.md.
 * The `mode` field in the map decides the consequence: "fail" (the shipped
 * Phase 3 setting) exits non-zero on unresolved hits; "warn" only annotates.
 *
 * Changed-file list sources, first match wins:
 *   1. Positional argv:   node scripts/check-wiki-map.mjs src/content/slots.ts
 *   2. Env CHANGED_FILES: newline- or comma-separated paths
 *   3. Env BASE_REF / --base <ref>: `git diff --name-only <ref>...HEAD`
 *   4. Default: `git diff --name-only origin/master...HEAD`
 *
 * A PR can opt out per the AGENTS.md rule by carrying `wiki-impact: none`
 * in the PR body; CI passes that through as env WIKI_IMPACT_NONE=1, which
 * silences the report (the note itself is the audit trail).
 *
 * Exit codes: 0 always in warn mode; in fail mode, 1 when hits exist.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function globToRegExp(glob) {
  // Trailing slash = directory prefix match.
  if (glob.endsWith('/')) {
    const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + esc);
  }
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; }
      else re += '[^/]*';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function changedFilesFromGit(baseRef) {
  const out = execFileSync('git', ['diff', '--name-only', `${baseRef}...HEAD`], {
    cwd: root, encoding: 'utf8',
  });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

function resolveChangedFiles(argv) {
  const baseFlag = argv.indexOf('--base');
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--base');
  if (positional.length) return positional;
  if (process.env.CHANGED_FILES) {
    return process.env.CHANGED_FILES.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  }
  const base = baseFlag >= 0 ? argv[baseFlag + 1] : (process.env.BASE_REF || 'origin/master');
  try {
    return changedFilesFromGit(base);
  } catch {
    console.log(`check-wiki-map: could not diff against ${base}; nothing to check.`);
    return [];
  }
}

function main() {
  const map = JSON.parse(readFileSync(join(root, 'wiki', '.page-map.json'), 'utf8'));
  const mode = map.mode || 'warn';
  const changed = resolveChangedFiles(process.argv.slice(2));
  const changedSet = new Set(changed);

  if (process.env.WIKI_IMPACT_NONE === '1') {
    console.log('check-wiki-map: PR declares `wiki-impact: none`; skipping.');
    return;
  }
  if (!changed.length) {
    console.log('check-wiki-map: no changed files; nothing to check.');
    return;
  }

  const hits = [];
  for (const entry of map.map) {
    const matchers = entry.sources.map(globToRegExp);
    const touchedSources = changed.filter((f) => matchers.some((re) => re.test(f)));
    if (!touchedSources.length) continue;
    const touchedPages = entry.pages.filter((p) => changedSet.has(p));
    if (!touchedPages.length) hits.push({ entry, touchedSources });
  }

  if (!hits.length) {
    console.log(`check-wiki-map: OK — ${changed.length} changed file(s), every mapped source change is paired with a wiki page change.`);
    return;
  }

  for (const { entry, touchedSources } of hits) {
    const msg = `Wiki drift risk: ${touchedSources.join(', ')} changed but none of its wiki page(s) did: ${entry.pages.join(', ')}. Update the page in this PR, or add \`wiki-impact: none\` to the PR body if no player-visible fact changed.`;
    // GitHub Actions annotation syntax; harmless plain output elsewhere.
    console.log(`::warning::${msg}`);
    console.log(`  - ${msg}`);
  }
  console.log(`check-wiki-map: ${hits.length} mapped source group(s) changed without a wiki update (mode: ${mode}).`);
  if (mode === 'fail') process.exit(1);
}

main();
