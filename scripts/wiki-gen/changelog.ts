/**
 * Changelog automation — Wiki Phase 4, in the form that cannot
 * silently lapse.
 *
 * The Phase 4 design (docs/WIKI.md) promised the publish workflow
 * would append merged-PR titles to wiki/Changelog.md automatically.
 * That exact form was never built, and building it literally is not
 * possible inside the freshness gate, for two mechanical reasons:
 *
 *  1. The wiki-gen-check CI job checks the repo out at the default
 *     fetch-depth (1). A generator running there sees exactly one
 *     commit — there is no merged-PR history to render from, and the
 *     job is handed no token for a `gh pr list` call.
 *  2. Even with history or an API, "merged PRs as of now" is not a
 *     function of the checkout: the set changes the moment any other
 *     PR merges, so a byte-diff gate rendered from it would fail on
 *     master after EVERY merge until a follow-up PR re-rendered, and
 *     would stale every open PR at once. The Phase 3 gate's whole
 *     premise is determinism (see lib.ts).
 *
 * So Phase 4 ships as two cooperating pieces, both deterministic:
 *
 *  A. THE MERGE LEDGER (generated block in wiki/Changelog.md).
 *     `npm run wiki:gen` harvests master's first-parent merge history
 *     from git (available locally and in any full clone), snapshots it
 *     to scripts/wiki-gen/changelog-ledger.json, and renders the
 *     ledger block from that snapshot. In CI, --check re-renders from
 *     the committed snapshot only — byte-stable — so the gate proves
 *     the published ledger matches the recorded merge history.
 *
 *  B. THE STALENESS TRIPWIRE (this module, run by generate-all in
 *     --check mode). CI's wiki-gen-check job now checks out with
 *     fetch-depth: 0 (same as wiki-map-check), so the gate can see the
 *     newest master merge. If that merge's date (America/New_York —
 *     the audience's calendar, and the calendar the page's headings
 *     use) is newer than the newest dated heading in Changelog.md,
 *     the gate FAILS. A merge the Changelog has not caught up with
 *     can no longer slip past quietly: master's own CI goes red until
 *     a PR adds the day's entry and refreshes the ledger. Regenerating
 *     alone cannot silence it — the tripwire reads git, not the page.
 *
 * The ledger era starts where the hand-kept page lapsed: PR #262 /
 * 2026-11-01 (the last hand-covered merge is #261, Wiki Phase 2).
 * Earlier merges are already accounted for by the hand entries above
 * the ledger.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type GenBlock, REPO_ROOT } from './lib';

export const LEDGER_START_PR = 262;
export const LEDGER_START_DATE = '2026-11-01';

const SNAPSHOT_PATH = join(REPO_ROOT, 'scripts', 'wiki-gen', 'changelog-ledger.json');

export interface LedgerMerge {
  number: number;
  title: string;
}

export interface LedgerDay {
  date: string;
  merges: LedgerMerge[];
}

export interface LedgerSnapshot {
  startPr: number;
  startDate: string;
  days: LedgerDay[];
}

/* ------------------------------------------------------------------ */
/* git helpers                                                         */
/* ------------------------------------------------------------------ */

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

function isShallowCheckout(): boolean {
  try {
    return git(['rev-parse', '--is-shallow-repository']).trim() === 'true';
  } catch {
    return true; // no usable git at all — same treatment as shallow
  }
}

const etDayFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** ISO timestamp → its calendar date in America/New_York (YYYY-MM-DD). */
export function etDateOf(iso: string): string {
  const parts = etDayFormat.formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

interface MergeRecord {
  sha: string;
  number: number;
  /** ET calendar date of the merge. */
  date: string;
}

function parseMergeSubject(subject: string): number | null {
  const merge = subject.match(/^Merge pull request #(\d+) from /);
  if (merge) return Number(merge[1]);
  const squash = subject.match(/\(#(\d+)\)\s*$/);
  if (squash) return Number(squash[1]);
  return null;
}

interface RawCommit {
  sha: string;
  iso: string;
  subject: string;
}

/** Every first-parent commit reachable from HEAD, newest first. */
function firstParentCommits(): RawCommit[] {
  const out = git(['log', '--first-parent', '--format=%H|%cI|%s']);
  const commits: RawCommit[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [sha, iso, ...subjectParts] = line.split('|');
    commits.push({ sha, iso, subject: subjectParts.join('|') });
  }
  return commits;
}

/**
 * PR landings reachable from HEAD along the first-parent chain,
 * newest first. Two landing shapes exist in this repo's history:
 * merge commits ("Merge pull request #N from …") and squash merges
 * ("<PR title> (#N)") — both are first-parent commits; restricting
 * the walk to --merges would silently drop every squashed PR.
 */
function firstParentMerges(): MergeRecord[] {
  const records: MergeRecord[] = [];
  for (const c of firstParentCommits()) {
    const number = parseMergeSubject(c.subject);
    if (number === null) continue;
    records.push({ sha: c.sha, number, date: etDateOf(c.iso) });
  }
  return records;
}

/**
 * The PR title a landing carried. A true merge commit's body opens
 * with the PR title (GitHub's merge-message convention); a squash
 * merge's subject IS the title ("<title> (#N)") and its body is the
 * PR description, whose first line is not the title — so the body is
 * only consulted for merge commits.
 */
function mergeTitle(sha: string, subject: string): string {
  if (subject.startsWith('Merge pull request #')) {
    try {
      const body = git(['log', '-1', '--format=%b', sha]);
      const first = body.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
      if (first) return first;
    } catch {
      /* fall through to the subject */
    }
    return subject;
  }
  const squash = subject.match(/^(.+) \(#\d+\)\s*$/);
  return squash ? squash[1] : subject;
}

/* ------------------------------------------------------------------ */
/* A — the merge ledger                                                */
/* ------------------------------------------------------------------ */

/**
 * Rebuild changelog-ledger.json from local git history. Called by
 * generate-all in WRITE mode only; --check never touches the
 * snapshot, so the CI gate renders from committed data and stays
 * byte-stable. On a shallow checkout the existing snapshot is kept
 * (with a printed note) — a partial harvest would be worse than the
 * recorded one.
 */
export function refreshChangelogLedger(): void {
  if (isShallowCheckout()) {
    console.log('wiki-gen: changelog ledger NOT refreshed (shallow checkout — keeping the committed snapshot).');
    return;
  }
  const merges = firstParentMerges().filter(
    (m) => m.number >= LEDGER_START_PR && m.date >= LEDGER_START_DATE,
  );
  const subjects = new Map<string, string>();
  for (const c of firstParentCommits()) subjects.set(c.sha, c.subject);
  const byDay = new Map<string, LedgerMerge[]>();
  for (const m of merges) {
    const entry: LedgerMerge = { number: m.number, title: mergeTitle(m.sha, subjects.get(m.sha) ?? '') };
    const day = byDay.get(m.date) ?? [];
    day.push(entry);
    byDay.set(m.date, day);
  }
  const days: LedgerDay[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, dayMerges]) => ({
      date,
      merges: dayMerges.sort((a, b) => a.number - b.number),
    }));
  const snapshot: LedgerSnapshot = { startPr: LEDGER_START_PR, startDate: LEDGER_START_DATE, days };
  const text = `${JSON.stringify(snapshot, null, 2)}\n`;
  const previous = existsSync(SNAPSHOT_PATH) ? readFileSync(SNAPSHOT_PATH, 'utf8') : '';
  if (previous !== text) {
    writeFileSync(SNAPSHOT_PATH, text);
    const total = days.reduce((n, d) => n + d.merges.length, 0);
    console.log(`wiki-gen: changelog ledger refreshed — ${total} merges over ${days.length} day(s).`);
  }
}

function readSnapshot(): LedgerSnapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as LedgerSnapshot;
}

function ledgerBody(): string {
  const snapshot = readSnapshot();
  const total = snapshot.days.reduce((n, d) => n + d.merges.length, 0);
  const lines: string[] = [
    '### Merge ledger',
    '',
    `_Every pull request merged since ${snapshot.startDate} (PR #${snapshot.startPr}), recorded exactly as merged — ${total} merges. This ledger is the completeness record behind the themed entries above it: if a merge shipped, it is listed here. Generated from master's merge history; see \`docs/WIKI.md\`._`,
    '',
  ];
  for (const day of snapshot.days) {
    lines.push(`**${day.date}** — ${day.merges.length} merge${day.merges.length === 1 ? '' : 's'}`, '');
    for (const m of day.merges) {
      lines.push(`- #${m.number} — ${m.title}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export const changelogBlock: GenBlock = {
  id: 'changelog-ledger',
  owners: ['master merge history (git log, first-parent) via scripts/wiki-gen/changelog.ts', 'scripts/wiki-gen/changelog-ledger.json'],
  render: ledgerBody,
};

/* ------------------------------------------------------------------ */
/* B — the staleness tripwire                                          */
/* ------------------------------------------------------------------ */

/** Newest calendar date named by any `## ` heading in the page. */
export function newestChangelogEntryDate(pageText: string): string | null {
  let newest: string | null = null;
  for (const line of pageText.split('\n')) {
    if (!line.startsWith('## ')) continue;
    for (const match of line.matchAll(/\d{4}-\d{2}-\d{2}/g)) {
      if (newest === null || match[0] > newest) newest = match[0];
    }
  }
  return newest;
}

export interface TripwireResult {
  status: 'ok' | 'stale' | 'skipped';
  message: string;
}

/**
 * Fail when master's newest merge is newer than the Changelog's
 * newest entry. Reads git history, never the page's generated
 * ledger, so regenerating cannot silence it — only writing the
 * missing entry can. Skips (loudly, in the log) on shallow
 * checkouts; CI runs it with fetch-depth: 0.
 */
export function checkChangelogFreshness(pageText: string): TripwireResult {
  const entryDate = newestChangelogEntryDate(pageText);
  if (entryDate === null) {
    return {
      status: 'stale',
      message: 'changelog tripwire: wiki/Changelog.md has no dated `## YYYY-MM-DD` heading at all — the page has lapsed.',
    };
  }
  if (isShallowCheckout()) {
    return {
      status: 'skipped',
      message: 'changelog tripwire skipped: shallow checkout (CI runs this gate with fetch-depth: 0).',
    };
  }
  let merges: MergeRecord[];
  try {
    merges = firstParentMerges();
  } catch {
    return { status: 'skipped', message: 'changelog tripwire skipped: git history unavailable in this environment.' };
  }
  if (merges.length === 0) {
    return { status: 'skipped', message: 'changelog tripwire skipped: no first-parent merges in history.' };
  }
  const newest = merges[0];
  if (newest.date > entryDate) {
    return {
      status: 'stale',
      message:
        `changelog tripwire: master merge #${newest.number} landed on ${newest.date} (America/New_York), ` +
        `but wiki/Changelog.md's newest entry is dated ${entryDate}. ` +
        `Add the missing day's entry — player-facing themes, as the page's other entries are written; ` +
        `a day whose merges were all internal still gets a one-line "Under the hood" entry — ` +
        `then run \`npm run wiki:gen\` to refresh the merge ledger and commit both.`,
    };
  }
  return {
    status: 'ok',
    message: `changelog tripwire: OK — newest master merge #${newest.number} (${newest.date}) is covered by the ${entryDate} entry.`,
  };
}
