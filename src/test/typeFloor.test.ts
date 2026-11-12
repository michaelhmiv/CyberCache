/**
 * THE 11px TYPE FLOOR, mechanically enforced (DESIGN.md Standing
 * laws: "THE FLOOR: 11px. No text a player must read renders below
 * 11px"; audit X-03).
 *
 * The floor used to be enforced spot-only (the Strip, the feed, the
 * boards each had a local pin) while a static census counted ~365
 * sub-floor text classes across the shipped UI — including text a
 * player must read: the diorama's "Unarmed" state word at 9px,
 * workspace labels at 8px, badge labels at 8–10px, the AreaPicker
 * stat grid at 9px.
 *
 * This scan walks the shipped UI sources (screens, components,
 * App.tsx — the noEmojiIcons scope), comments stripped, and counts
 * every sub-floor occurrence: `text-[8px|9px|10px]` classes and
 * literal `fontSize` values under 11. Every occurrence must be
 * accounted for in typeFloorAllowlist.json (per file, per token,
 * exact counts) — the allowlist is the registry of the remaining
 * sub-floor text, which is decorative/stage dressing (pixel-stage
 * float tags, dense data-table micro-labels in admin/debug kits,
 * fit-shrunk names) rather than player-read state/stat text.
 *
 * The player-read items the audit named were FIXED to the floor in
 * the same change (LiveTurfDiorama's Unarmed word, ActionWorkspace
 * labels/details, MaterialBadge, VisualBadge, AreaPicker,
 * PresetSwitcher's Active word, App's sub-screen kicker,
 * TabErrorBoundary's error body) — they do not appear in the
 * allowlist at all. A new sub-floor occurrence, or a count growing
 * in an allowlisted file, fails here; a count shrinking fails too
 * (prune the allowance in the same PR — the list stays honest).
 * Regenerate the census after an intentional change by re-running
 * this scan's counting over the tree and updating the JSON.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/screens', 'src/components'];
const SCAN_FILES = ['src/App.tsx'];

type Census = Record<string, Record<string, number>>;

const ALLOWLIST = JSON.parse(
  readFileSync(join(ROOT, 'src/test/typeFloorAllowlist.json'), 'utf8'),
) as Census;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(path);
  }
}

/** Replace comments with spaces (newlines preserved), strings untouched. */
function stripComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  const tplDepth: number[] = [];
  let braceDepth = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1] ?? '';
    if (mode === 'code') {
      if (c === '/' && next === '/') { mode = 'line'; out.push(' ', ' '); i += 2; continue; }
      if (c === '/' && next === '*') { mode = 'block'; out.push(' ', ' '); i += 2; continue; }
      if (c === "'") { mode = 'sq'; out.push(c); i += 1; continue; }
      if (c === '"') { mode = 'dq'; out.push(c); i += 1; continue; }
      if (c === '`') { mode = 'tpl'; out.push(c); i += 1; continue; }
      if (c === '{') { braceDepth += 1; out.push(c); i += 1; continue; }
      if (c === '}') {
        braceDepth -= 1;
        if (tplDepth.length > 0 && braceDepth === tplDepth[tplDepth.length - 1]) { tplDepth.pop(); mode = 'tpl'; }
        out.push(c); i += 1; continue;
      }
      out.push(c); i += 1; continue;
    }
    if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out.push(c); } else { out.push(' '); }
      i += 1; continue;
    }
    if (mode === 'block') {
      if (c === '*' && next === '/') { mode = 'code'; out.push(' ', ' '); i += 2; continue; }
      out.push(c === '\n' ? '\n' : ' ');
      i += 1; continue;
    }
    if (mode === 'sq' || mode === 'dq') {
      const quote = mode === 'sq' ? "'" : '"';
      out.push(c);
      if (c === '\\') { out.push(next); i += 2; continue; }
      if (c === quote) mode = 'code';
      i += 1; continue;
    }
    out.push(c);
    if (c === '\\') { out.push(next); i += 2; continue; }
    if (c === '`') { mode = 'code'; i += 1; continue; }
    if (c === '$' && next === '{') {
      out.push(next);
      tplDepth.push(braceDepth);
      braceDepth += 1;
      mode = 'code';
      i += 2; continue;
    }
    i += 1; continue;
  }
  return out.join('');
}

function censusFile(path: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const text = stripComments(readFileSync(path, 'utf8'));
  for (const m of text.matchAll(/text-\[(8|9|10)px\]/g)) {
    const key = `text-[${m[1]}px]`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  for (const m of text.matchAll(/fontSize:\s*'?([0-9]+(?:\.[0-9]+)?)(?:px)?'?\s*[,}]/g)) {
    if (Number(m[1]) < 11) {
      const key = `fontSize:${m[1]}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

describe('11px type floor — repo-wide scan (audit X-03)', () => {
  it('every sub-floor occurrence in the shipped UI is allowlisted, exactly', () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files);
    for (const file of SCAN_FILES) files.push(join(ROOT, file));

    const problems: string[] = [];
    const seen = new Set<string>();
    for (const path of files) {
      const rel = path.slice(ROOT.length + 1);
      seen.add(rel);
      const actual = censusFile(path);
      const allowed = ALLOWLIST[rel] ?? {};
      const keys = new Set([...Object.keys(actual), ...Object.keys(allowed)]);
      for (const key of keys) {
        const a = actual[key] ?? 0;
        const w = allowed[key] ?? 0;
        if (a > w) problems.push(`${rel}: ${key} ×${a} exceeds the allowlist ×${w} — player-read text goes to 11px; decorative text gets an allowance with a reason in the PR`);
        if (a < w) problems.push(`${rel}: ${key} ×${a} is below the allowlist ×${w} — prune the stale allowance in the same PR`);
      }
    }
    for (const rel of Object.keys(ALLOWLIST)) {
      if (!seen.has(rel)) problems.push(`${rel}: allowlisted but no longer in the scan scope — prune it`);
    }
    expect(problems).toEqual([]);
  });
});
