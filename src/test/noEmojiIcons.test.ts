/**
 * NO-EMOJI GUARD — the owner's hard rule, enforced.
 *
 * Every emoji / unicode glyph used as iconography in the shipped UI was
 * replaced by a pixel icon from `src/lib/pixel/icons.ts` (rendered by
 * <PxIcon>). This test fails if an emoji-range character re-enters the
 * shipped screen/component sources or the icon registries, so the purge
 * cannot silently regress.
 *
 * Scope (deliberate):
 *  - `src/screens/**`, `src/components/**`, `src/App.tsx` — the shipped UI.
 *  - The data registries that feed icon slots in those sources
 *    (navSigils, activityVisuals, consumableFamilyVisuals,
 *    skillTreeVisuals, consumables, cacheRank).
 *  - Test files are NOT scanned: fixtures may legitimately quote the old
 *    glyphs when asserting they are gone.
 *  - Comments are stripped before scanning: ASCII-art diagrams in comments
 *    (the ActionLoadout slot map, MetricCard's box sketch) are not UI.
 *  - String contents ARE scanned: a glyph hiding in a string literal
 *    (`glyph: '⚔'`) is exactly the regression this guard exists to catch.
 *  - Out of scope by design: `src/lib/pixel/lootMoment.ts`'s loot-card
 *    stamp string and the weapon-art decal keys (`src/lib/weaponArt/`)
 *    are data for the pixel-art pipeline itself, not font iconography;
 *    prose typography (arrows in labels, ≤/≥/·, delta signs) is not in
 *    the banned set.
 *
 * ALLOWLIST: empty. If a future change truly needs an exception, add an
 * entry { file, line, char, reason } here AND justify it in the PR — the
 * bar is "this character is typography, not iconography."
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const SCAN_DIRS = ['src/screens', 'src/components'];
const SCAN_FILES = [
  'src/App.tsx',
  'src/constants/navSigils.ts',
  'src/constants/activityVisuals.ts',
  'src/constants/consumableFamilyVisuals.ts',
  'src/constants/skillTreeVisuals.ts',
  'src/constants/consumables.ts',
  'src/content/cacheRank.ts',
];

const ALLOWLIST: Array<{ file: string; line: number; char: string; reason: string }> = [];

/** Codepoints that are iconography, never typography, in this UI. */
function isBanned(cp: number): boolean {
  if (cp >= 0x1f000 && cp <= 0x1faff) return true; // emoji & pictographs
  if (cp >= 0x2600 && cp <= 0x27bf) return true; // misc symbols + dingbats (★ ✓ ✦ ♥ ⚔ ♻ …)
  if (cp >= 0x2b00 && cp <= 0x2bff) return true; // stars/arrows (⬢ ⬆ ⬇ …)
  if (cp === 0xfe0f) return true; // variation selector-16 = emoji presentation
  // Curated geometric / technical glyphs that shipped as icons before the purge:
  if (
    cp === 0x2295 || // ⊕ circled plus
    cp === 0x2303 || cp === 0x2304 || // ⌃ ⌄ arrowheads
    cp === 0x2316 || // ⌖ position indicator
    cp === 0x233e || // ⌾ circled cross pommee
    cp === 0x23f1 || cp === 0x23f8 || cp === 0x23fb || // ⏱ ⏸ ⏻
    cp === 0x221e || // ∞ (standalone icon use; formula use lives in comments)
    // Geometric shapes that shipped as icons: ▣ ▤ ▧ ▰ ▱ ▴ ▸ ▾ ▻ and the
    // circle/diamond family ◎ ◍ ◉ ◐ ● ◈ ◆ ◇ ◌. NOT banned: ▲ ▼ ► ◄ —
    // trend/direction triangles inside numeric text are typography.
    cp === 0x25a3 || cp === 0x25a4 || cp === 0x25a7 ||
    cp === 0x25b0 || cp === 0x25b1 || cp === 0x25b4 || cp === 0x25b8 || cp === 0x25bb || cp === 0x25be ||
    (cp >= 0x25cb && cp <= 0x25cf) || cp === 0x25c6 || cp === 0x25c7 || cp === 0x25c8 || cp === 0x25c9 || cp === 0x25cc
  ) {
    return true;
  }
  return false;
}

/**
 * Replace comments with spaces (newlines preserved, so line numbers hold)
 * while leaving string/template contents untouched.
 */
function stripComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  // mode stack: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl'
  let mode: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  const tplDepth: number[] = []; // ${ } nesting depth stack for templates
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
        if (tplDepth.length > 0 && braceDepth === tplDepth[tplDepth.length - 1]) {
          tplDepth.pop();
          mode = 'tpl';
        }
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
    // tpl
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

function collectFiles(): string[] {
  const files = [...SCAN_FILES];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${entry}`;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) { walk(rel); continue; }
      if ((rel.endsWith('.ts') || rel.endsWith('.tsx')) && !/\.test\.(ts|tsx)$/.test(rel)) {
        files.push(rel);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(dir);
  return files.sort();
}

describe('no-emoji guard (owner rule: UI iconography is pixel icons only)', () => {
  it('no emoji-range or glyph-icon characters in shipped screen/component sources', () => {
    const violations: string[] = [];
    for (const rel of collectFiles()) {
      const raw = readFileSync(join(ROOT, rel), 'utf8');
      const stripped = stripComments(raw);
      const lines = stripped.split('\n');
      lines.forEach((line, idx) => {
        for (const ch of line) {
          const cp = ch.codePointAt(0) ?? 0;
          if (!isBanned(cp)) continue;
          const allowed = ALLOWLIST.some((a) => a.file === rel && a.line === idx + 1 && a.char === ch);
          if (!allowed) {
            violations.push(
              `${rel}:${idx + 1} — U+${cp.toString(16).toUpperCase().padStart(4, '0')} '${ch}' in: ${line.trim().slice(0, 90)}`,
            );
          }
        }
      });
    }
    expect(violations, `Emoji/glyph iconography found (use <PxIcon> instead):\n${violations.join('\n')}`).toEqual([]);
  });

  it('the guard itself is not vacuous (it can see a planted emoji)', () => {
    const planted = stripComments("const x = '🔥'; // 🔥 in a comment is fine\n");
    const hits = [...planted].filter((ch) => isBanned(ch.codePointAt(0) ?? 0));
    expect(hits).toEqual(['🔥']);
  });
});
