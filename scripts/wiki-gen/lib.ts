/**
 * Wiki Phase 3 — generated reference tables.
 *
 * Shared helpers for the family generators in this directory. Every
 * generator renders markdown from the SAME source constants the game
 * runs on (src/content/, src/constants/, src/lib/) — no value is
 * hand-copied into a generator. Rendering is deterministic: source
 * order is preserved, and no timestamps or random values ever enter
 * a generated block, so the CI freshness gate can diff a fresh render
 * against the committed pages byte for byte.
 *
 * A generated block lives in a wiki page between marker comments:
 *
 *   <!-- GENERATED from <owner files> — do not edit by hand -->
 *   <!-- wiki-gen:<id> -->
 *   ...rendered markdown...
 *   <!-- /wiki-gen:<id> -->
 *
 * generate-all.ts owns splicing blocks into pages and the --check
 * mode the CI gate runs.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const WIKI_DIR = join(REPO_ROOT, 'wiki');

export interface GenBlock {
  /** Marker id, unique across all pages. */
  id: string;
  /** Source-of-truth files named in the GENERATED-from marker line. */
  owners: string[];
  /** Render the block body (markdown between the wiki-gen markers). */
  render: () => string;
}

/** Escape a cell for a markdown table. */
export function esc(value: string | number): string {
  return String(value).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** Round away float dust and print the shortest honest form. */
export function num(n: number): string {
  return String(Number(n.toFixed(4)));
}

/** Fraction (0.505) → percent string ("50.5%"). */
export function pct(frac: number): string {
  return `${num(frac * 100)}%`;
}

/** Multiplier (1.15) → "×1.15". */
export function mult(n: number): string {
  return `×${num(n)}`;
}

/** Milliseconds → "25 min" / "2 h" / "1 h 40 min". */
export function mins(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 'sidearm_recovery' → 'Sidearm Recovery'; 'baseDamage' → 'Base Damage'. */
export function titleCase(id: string): string {
  return id
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Build a GitHub-flavored markdown table. */
export function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.map(esc).join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(esc).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

/** Join a list for one cell, or an em dash when empty. */
export function listOrDash(items: string[]): string {
  return items.length ? items.join(', ') : '—';
}
