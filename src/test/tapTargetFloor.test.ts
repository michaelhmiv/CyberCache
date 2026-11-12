/**
 * THE 44px TAP FLOOR for the audited small-button pattern (DESIGN.md
 * Standing laws: controls size to the 44px tap law; audit X-04).
 *
 * The audit computed the app's small `px-2 py-1` buttons at ~25–32px
 * tall — 8px of vertical padding, a 13–16px line box, 4px of borders,
 * no min-height and no hit-area extension — across Gear/Home/Market:
 * PresetSwitcher's Save/Cancel/OK and its apply-report remedies,
 * SlotGearPicker's Unequip, AreaPicker's start door, BossEncounter's
 * Change Boss and consumable steppers, Extraction's Close/Settle/
 * Retry, GearHub's clear-filters chip and bulk Lock/Unlock/Scrap,
 * the verification banner's Dismiss, Collections' Retry.
 *
 * The audit's CI assertion, primary form: a browser geometry gate at
 * 412×915 enumerating visible buttons per tab and asserting ≥44px
 * boxes (fleet harness). This test is its static fallback form,
 * scoped to the files the audit named: every className string in
 * those files carrying the audited signature (the `px-2` + `py-1`
 * token pair) must also carry the remedy — `min-h-[44px]` (with
 * `min-w-[44px]`, and flex centering where the button was not
 * already a flex row) — or be one of the allowlisted NON-button
 * strings below (text inputs and one static badge share the padding
 * signature but are not tap targets of this pattern; they are
 * counted exactly, so the allowance cannot grow silently).
 *
 * A new `px-2 py-1` button in any of these files fails here until
 * it carries the remedy; an allowlist count drifting either way
 * fails too (prune or justify in the same PR).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const SCAN_FILES = [
  'src/components/action/PresetSwitcher.tsx',
  'src/components/action/SlotGearPicker.tsx',
  'src/components/common/AreaPicker.tsx',
  'src/components/fight/BossEncounterPanel.tsx',
  'src/components/fight/ExtractionPanel.tsx',
  'src/components/gear/GearHub.tsx',
  'src/App.tsx',
  'src/components/profile/CollectionsPanel.tsx',
];

/** Non-button class strings sharing the padding signature, counted exactly. */
const ALLOWLIST: Record<string, number> = {
  // PresetSwitcher's three build-name text inputs (save / row rename / manage rename).
  'bl-input flex-1 px-2 py-1 text-[11px]': 3,
  // GearHub's static result-count badge (a div, not a control).
  'rounded-full border border-border bg-surface px-2 py-1 text-[11px] font-black text-amber': 1,
};

/** Class strings remedied in the X-04 fix, counted exactly (burn-down discipline). */
const EXPECTED_REMEDIED = 33;

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

function classStrings(path: string): string[] {
  const text = stripComments(readFileSync(path, 'utf8'));
  const found: string[] = [];
  for (const m of text.matchAll(/className="([^"]*)"|className=\{`([^`]*)`\}|className=\{'([^']*)'\}/g)) {
    found.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\s+/g, ' ').trim());
  }
  return found;
}

describe('44px tap floor — audited px-2 py-1 button pattern (audit X-04)', () => {
  it('every px-2 py-1 class string in the audited files carries the 44px remedy or is an allowlisted non-button', () => {
    const problems: string[] = [];
    const allowSeen: Record<string, number> = {};
    let remedied = 0;
    for (const rel of SCAN_FILES) {
      for (const cls of classStrings(join(ROOT, rel))) {
        const tokens = cls.split(' ');
        if (!tokens.includes('px-2') || !tokens.includes('py-1')) continue;
        if (tokens.includes('min-h-[44px]')) { remedied += 1; continue; }
        if (cls in ALLOWLIST) { allowSeen[cls] = (allowSeen[cls] ?? 0) + 1; continue; }
        problems.push(`${rel}: sub-44 button pattern without the remedy — "${cls}"`);
      }
    }
    for (const [cls, want] of Object.entries(ALLOWLIST)) {
      const got = allowSeen[cls] ?? 0;
      if (got !== want) {
        problems.push(`allowlist drift: "${cls}" expected ×${want}, found ×${got} — prune or re-justify in the same PR`);
      }
    }
    if (remedied !== EXPECTED_REMEDIED) {
      problems.push(`remedied count drift: expected ${EXPECTED_REMEDIED}, found ${remedied} — a remedied button lost its min-h or the census moved; update EXPECTED_REMEDIED deliberately in the same PR`);
    }
    expect(problems).toEqual([]);
  });
});
