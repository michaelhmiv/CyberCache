/**
 * STRING-HYGIENE GUARD — the QC 2026-11-02 defect class, enforced.
 *
 * The final-QC playtest found three sibling defects across the UI:
 *  A1 — labels glued without spaces ("earned2h", "fuel0units"):
 *       JSX text whose chunk ends at a line break right before an
 *       expression loses the space at the boundary (Babel trims it),
 *       and an expression followed by a fresh-line text chunk glues
 *       the same way. The shipped codebase's defense is the explicit
 *       {' '} at such boundaries; this guard re-derives every
 *       text/expression boundary in the shipped screens with the
 *       TypeScript parser + Babel's own JSXText cleaning rules and
 *       fails on any boundary that would glue a word to a value.
 *  A2 — descriptions clipped instead of wrapped: the two known
 *       line-clamp sites on description copy (skill node grid,
 *       Collections cards) are pinned off.
 *  A3 — raw identifiers as player text (snake_case effect ids,
 *       camelCase stat keys, material ids printing "Unknown", raw
 *       scene keys, id-slice name fallbacks, a migration number in
 *       prose, a dev explainer paragraph): each fixed site is pinned,
 *       and the label registries are checked at runtime so every
 *       material/essence/effect id resolves to a human name.
 *
 * Scope: `src/screens/**`, `src/components/**`, `src/App.tsx` — the
 * shipped UI (same scope as the no-emoji guard). Test files are NOT
 * scanned.
 *
 * ALLOWLIST: intentional no-space joins (compact badges like
 * "Q{quality}", unit-prefixed counts like "x{owned}", and joins whose
 * rendered segment carries its own leading space). Each entry needs a
 * reason; the bar is "the rendered text is correct as-is".
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { getVisualAsset } from '@/constants/visualAssets';
import { LEGENDARY_EFFECTS, legendaryEffectName } from '@/constants/legendaryEffects';
import { MaterialType, EssenceType } from '@/types/game';
import { resolveSceneLabel } from '@/lib/dashboard/sceneLabel';

const ROOT = process.cwd();
const SCAN_DIRS = ['src/screens', 'src/components'];
const SCAN_FILES = ['src/App.tsx'];

function collectTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, entry);
    const abs = join(ROOT, rel);
    if (statSync(abs).isDirectory()) collectTsx(rel, out);
    else if (rel.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

const UI_FILES = [...SCAN_DIRS.flatMap((d) => collectTsx(d)), ...SCAN_FILES];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

/** Babel's cleanJSXElementLiteralChild, replicated: what a JSXText
 *  chunk actually renders as after whitespace processing. */
function cleanJSXText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].replace(/[\t ]+/g, ' ').trim()) lastNonEmptyLine = i;
  }
  let str = '';
  for (let i = 0; i < lines.length; i++) {
    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;
    const isLastNonEmptyLine = i === lastNonEmptyLine;
    let t = lines[i].replace(/\t/g, ' ');
    if (!isFirstLine) t = t.replace(/^ +/, '');
    if (!isLastLine) t = t.replace(/ +$/, '');
    if (t) {
      if (!isLastNonEmptyLine) t += ' ';
      str += t;
    }
  }
  return str;
}

type ExprClass = 'value' | 'space' | 'block' | 'other';

function classifyExpr(expr: ts.Expression | undefined): ExprClass {
  if (!expr) return 'other';
  if (ts.isStringLiteral(expr)) {
    // {' '} (or any whitespace-only / space-leading literal) IS the
    // explicit-space defense — never a glue risk.
    return /^\s/.test(expr.text) || expr.text.trim() === '' ? 'space' : 'value';
  }
  if (ts.isTemplateExpression(expr)) {
    return expr.templateSpans.length === 0 || expr.head.text.startsWith(' ')
      ? 'space'
      : 'value';
  }
  if (ts.isConditionalExpression(expr)) return 'block';
  if (ts.isBinaryExpression(expr)) {
    const op = expr.operatorToken.kind;
    if (op === ts.SyntaxKind.AmpersandAmpersandToken || op === ts.SyntaxKind.BarBarToken) {
      return 'block';
    }
    return 'value';
  }
  if (
    ts.isIdentifier(expr) ||
    ts.isPropertyAccessExpression(expr) ||
    ts.isCallExpression(expr) ||
    ts.isNumericLiteral(expr) ||
    ts.isPrefixUnaryExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return 'value';
  }
  if (ts.isParenthesizedExpression(expr)) return classifyExpr(expr.expression);
  return 'other';
}

/** Unit suffixes that attach to a number by house style ("2h", "95cr",
 *  "7d", ticks "12t") — an expression followed by one of these is not
 *  a glue defect. */
const UNIT_START = /^(h|hr|hrs|cr|xp|%|s|sec|secs|min|mins|d|day|days|wk|mo|t|x|tier|lv)\b/;

interface GlueHit {
  file: string;
  line: number;
  side: 'text>expr' | 'expr>text';
  cleaned: string;
}

const ALLOWLIST: Array<{ file: string; side: GlueHit['side']; cleanedEndsOrStarts: string; reason: string }> = [
  { file: 'src/screens/MarketScreen.tsx', side: 'text>expr', cleanedEndsOrStarts: 'cr', reason: 'SalesGuidance: {unit} is " ea" or "" — the segment carries its own leading space.' },
  { file: 'src/screens/WorkshopScreen.tsx', side: 'text>expr', cleanedEndsOrStarts: 'cr', reason: 'Bench unlock: cost-input segments each render as " + N <label>" — leading space by construction.' },
  { file: 'src/screens/WorkshopScreen.tsx', side: 'text>expr', cleanedEndsOrStarts: 'R', reason: 'Compact rank badge "{manufacturer} R{rank}" — R{rank} is one token, like Lv.{n}.' },
  { file: 'src/components/consumables/ConsumableInspectSheet.tsx', side: 'text>expr', cleanedEndsOrStarts: 'x', reason: 'Count prefix "x{owned} owned" is one token.' },
  { file: 'src/components/profile/ResearchPanel.tsx', side: 'text>expr', cleanedEndsOrStarts: 'T', reason: 'Compact tier chip "T{tier}" is one token, like R{rank} / Lv.{n} — the Instrument Panel row badge (owner pick B, 2026-11-05).' },
];

function findGlue(file: string, code: string): GlueHit[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: GlueHit[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const kids = node.children;
      for (let i = 0; i < kids.length - 1; i++) {
        const a = kids[i];
        const b = kids[i + 1];
        if (ts.isJsxText(a) && ts.isJsxExpression(b) && classifyExpr(b.expression) === 'value') {
          const cleaned = cleanJSXText(a.text);
          if (/[A-Za-z]$/.test(cleaned)) {
            hits.push({
              file,
              line: sf.getLineAndCharacterOfPosition(a.getStart(sf)).line + 1,
              side: 'text>expr',
              cleaned,
            });
          }
        }
        if (ts.isJsxExpression(a) && ts.isJsxText(b) && classifyExpr(a.expression) === 'value') {
          const cleaned = cleanJSXText(b.text);
          if (/^[A-Za-z]/.test(cleaned) && !UNIT_START.test(cleaned)) {
            hits.push({
              file,
              line: sf.getLineAndCharacterOfPosition(b.getStart(sf)).line + 1,
              side: 'expr>text',
              cleaned,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

function isAllowlisted(hit: GlueHit): boolean {
  return ALLOWLIST.some((entry) => {
    if (entry.file !== hit.file || entry.side !== hit.side) return false;
    return hit.side === 'text>expr'
      ? hit.cleaned.endsWith(entry.cleanedEndsOrStarts)
      : hit.cleaned.startsWith(entry.cleanedEndsOrStarts);
  });
}

describe('string hygiene — A1: no glued JSX text/expression boundaries', () => {
  // Whole-tree parse: ~2s standalone, but the 5s default test timeout
  // is too tight under full-suite parallel load — this scan gets a
  // real budget instead of flaking.
  it('every word↔value boundary in the shipped UI carries its space', { timeout: 120_000 }, () => {
    const violations: string[] = [];
    for (const file of UI_FILES) {
      for (const hit of findGlue(file, read(file))) {
        if (!isAllowlisted(hit)) {
          violations.push(
            `${hit.file}:${hit.line} [${hit.side}] "...${hit.cleaned.slice(-50)}"`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('string hygiene — A3: label registries resolve every id to a human name', () => {
  // A label is "raw" when it is the UNKNOWN fallback, contains a word
  // separator from the id space, or is an unspaced CamelCase compound
  // ('ForgeheartIngots'). Single proper names ('Siltglass') are fine.
  const isRawLabel = (label: string) =>
    label === 'Unknown' || label.includes('_') || /[a-z][A-Z]/.test(label);

  it('every material id has a real visual label (never "Unknown")', () => {
    for (const id of Object.values(MaterialType)) {
      expect(isRawLabel(getVisualAsset('material', id).label), `material ${id}`).toBe(false);
    }
  });

  it('every essence id has a real visual label (never "Unknown")', () => {
    for (const id of Object.values(EssenceType)) {
      expect(isRawLabel(getVisualAsset('essence', id).label), `essence ${id}`).toBe(false);
    }
  });

  it('every legendary effect id resolves to its display name', () => {
    for (const def of LEGENDARY_EFFECTS) {
      expect(legendaryEffectName(def.id)).toBe(def.name);
      expect(def.name).not.toContain('_');
    }
  });

  it('scene keys resolve to player labels (Profile Scene row)', () => {
    expect(resolveSceneLabel('workshop:crafting')).toBe('Crafting Bench');
    expect(resolveSceneLabel('dustwaste_frontier')).toBe('Dustwaste Frontier');
  });
});

describe('string hygiene — A2/A3/A6: fixed sites stay fixed (source pins)', () => {
  const pins: Array<{ file: string; mustContain?: string[]; mustNotContain?: string[] }> = [
    {
      file: 'src/components/fight/BossPickerList.tsx',
      mustContain: ['legendaryEffectName'],
      mustNotContain: ['dedicatedDrops.slice(0, 3).join('],
    },
    {
      // The stat-deck rendering moved to the ONE shared source
      // (cache reveal one-page, 2026-11-04): the sheet renders its
      // Roll Parts / Legendary Effect tapes through PartLine /
      // LegendaryEffectBlock, so the A3 law (part keys and effect
      // ids render through their labels, never raw) now pins at
      // the shared sites below. skillNodeName(node) still renders
      // in the sheet's own Skill Node Boosts tape.
      file: 'src/components/gear/GearInspectSheet.tsx',
      mustContain: ['skillNodeName(node)', 'PartLine', 'LegendaryEffectBlock'],
      mustNotContain: ['`${k} ${typeof v'],
    },
    {
      file: 'src/components/gear/itemStatDeck.tsx',
      mustContain: ['partStatLabel(k)'],
      mustNotContain: ['`${k} ${typeof v'],
    },
    {
      file: 'src/lib/gear/itemStatDeck.ts',
      mustContain: ['legendaryEffectName(item.legendaryEffectId)'],
    },
    {
      file: 'src/components/vendor/RepDeskPanel.tsx',
      mustContain: ['getMaterialVisual(k).label'],
      mustNotContain: ['`${k} ×${v}`'],
    },
    {
      file: 'src/screens/WorkshopScreen.tsx',
      // The original pinned site rendered the bench-unlock card's
      // cost inputs (`getVisualAsset('material', k).label`); slice
      // 9 deleted the unlock card with the bench tiers. The law
      // (material keys render through their labels, never raw)
      // now pins at the surviving MaterialUsageSheet site, which
      // iterates with `type`.
      mustContain: ["getVisualAsset('material', type).label"],
      mustNotContain: ['` + ${v} ${k}`', '(${catalystId})', 'Refines to ${recipe.outputMaterial}'],
    },
    {
      file: 'src/screens/SkillTreeScreen.tsx',
      mustContain: ['Respec cost', 'costs 100cr per point spent'],
      mustNotContain: ['refunds every spent point for', 'line-clamp'],
    },
    {
      file: 'src/screens/CollectionsScreen.tsx',
      mustNotContain: ['line-clamp'],
    },
    {
      file: 'src/screens/ProfileScreen.tsx',
      mustContain: ['resolveSceneLabel'],
      mustNotContain: ['sanitized activity fields'],
    },
    {
      file: 'src/components/profile/LifetimeStatsPanel.tsx',
      mustNotContain: ['0034 trophy record'],
    },
    {
      file: 'src/components/profile/UsernameSetupModal.tsx',
      mustNotContain: ['placeholder="hunter_name"'],
    },
    {
      file: 'src/components/leaderboard/LeaderboardRow.tsx',
      mustContain: ["'Vault Runner'"],
      mustNotContain: ['`Player ${'],
    },
    {
      file: 'src/components/profile/PublicProfilePanel.tsx',
      mustContain: ["'Vault Runner'"],
      mustNotContain: ['`Player ${'],
    },
    {
      file: 'src/components/common/MaterialUsageSheet.tsx',
      mustNotContain: ['refines to ${recipe.outputMaterial}', 'makes ${recipe.consumableType}'],
    },
    {
      file: 'src/components/dispatch/DispatchPanel.tsx',
      mustContain: ['getMaterialVisual(m.payout_material_id).label'],
      mustNotContain: ['${m.payout_material_id}`'],
    },
  ];

  for (const pin of pins) {
    it(pin.file, () => {
      const code = read(pin.file);
      for (const needle of pin.mustContain ?? []) {
        expect(code, `${pin.file} must contain ${needle}`).toContain(needle);
      }
      for (const needle of pin.mustNotContain ?? []) {
        expect(code, `${pin.file} must NOT contain ${needle}`).not.toContain(needle);
      }
    });
  }
});
