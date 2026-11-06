/**
 * wikiCorpus — the Field Manual's data layer (owner option 3,
 * 2026-11-05: the manual IS the game's wiki, rendered natively).
 *
 * Source of truth stays the repo's `wiki/` directory — the same
 * files CI publishes to the GitHub Wiki. Nothing here copies or
 * rewords wiki prose; the corpus is bundled at app build time, so
 * the manual always matches the build's game version and works
 * offline.
 *
 * Loading shape (the corpus is ~348 KB of markdown and ~9 MB of
 * images, so nothing heavy is eager):
 *  - The index manifest (page ids, groups, reading order) is built
 *    synchronously from the glob keys + the wiki's own `_Sidebar.md`
 *    — the same file GitHub Wiki renders as navigation.
 *  - Page bodies load per page, on open, via dynamic import
 *    (one chunk per page), then cache for the session.
 *  - A background preload (kicked off when the manual mounts) loads
 *    every body once: it converges index titles to each page's true
 *    H1, produces the corpus link count, and feeds full-text search.
 *  - Images resolve per reference through async URL loaders — an
 *    image's bytes move only when a page that references it renders.
 *
 * Index structure is parsed from `_Sidebar.md`: `**Group**` lines
 * open a group, `- [[Page Name]]` lines are its entries, in order.
 * Pages the sidebar never lists fall into a trailing "More Pages"
 * group so the in-app index is complete even where the sidebar is
 * not (today: Activity-Log).
 */

const pageLoaders = import.meta.glob<string>(
  ['../../../wiki/*.md', '!../../../wiki/_Sidebar.md'],
  { query: '?raw', import: 'default' },
);

const sidebarModules = import.meta.glob<string>('../../../wiki/_Sidebar.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const imageLoaders = import.meta.glob<string>(
  '../../../wiki/images/**/*.{png,jpg,jpeg,webp,gif,svg}',
  { query: '?url', import: 'default' },
);

export interface WikiPageMeta {
  /** File stem, e.g. "Getting-Started" — the canonical page id. */
  id: string;
  /**
   * Display title. Provisional until the page body loads (sidebar
   * label, else the prettified stem); converges to the page's first
   * H1 once loaded — the H1 is the title the wiki itself prints.
   */
  title: string;
  /** True for the generated Reference-* data pages. */
  generated: boolean;
}

export interface WikiPage extends WikiPageMeta {
  /** Raw markdown, exactly as published in wiki/. */
  markdown: string;
}

export interface WikiGroup {
  label: string;
  pages: WikiPageMeta[];
}

function stemOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '');
}

function titleOf(id: string, markdown: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (h1 ?? prettyStem(id)).replace(/\*\*/g, '');
}

/** Stem → display title for pages the sidebar never labels. */
function prettyStem(id: string): string {
  if (id.startsWith('Reference-')) {
    return `Reference — ${id.slice('Reference-'.length).replace(/-/g, ' ')}`;
  }
  return id.replace(/-/g, ' ');
}

/* ------------------------------------------------------------------ */
/* Manifest (synchronous)                                              */
/* ------------------------------------------------------------------ */

const META_BY_ID = new Map<string, WikiPageMeta>();
const LOADER_BY_ID = new Map<string, () => Promise<string>>();

for (const [path, loader] of Object.entries(pageLoaders)) {
  const id = stemOf(path);
  if (id === '_Sidebar') continue;
  LOADER_BY_ID.set(id, loader);
  META_BY_ID.set(id, { id, title: prettyStem(id), generated: id.startsWith('Reference-') });
}

const ALL_METAS: WikiPageMeta[] = [...META_BY_ID.values()].sort((a, b) =>
  a.id.localeCompare(b.id),
);

/** Name resolution: "Getting Started", "Getting-Started" and the
 *  page's own title all resolve to the same page, case-insensitive. */
const BY_NAME = new Map<string, WikiPageMeta>();
for (const meta of ALL_METAS) {
  BY_NAME.set(meta.id.toLowerCase(), meta);
  BY_NAME.set(meta.id.replace(/-/g, ' ').toLowerCase(), meta);
  BY_NAME.set(meta.title.toLowerCase(), meta);
}

export function resolveWikiPage(rawTarget: string): WikiPageMeta | null {
  const target = decodeURIComponent(rawTarget).split('#')[0].trim().replace(/\.md$/, '');
  if (!target) return null;
  return (
    BY_NAME.get(target.toLowerCase()) ??
    BY_NAME.get(target.replace(/\s+/g, '-').toLowerCase()) ??
    META_BY_ID.get(target) ??
    null
  );
}

/** Index groups, parsed from wiki/_Sidebar.md. Links that appear
 *  before the first **Group** header land in "Start Here"; pages the
 *  sidebar never lists are appended under "More Pages". Sidebar
 *  labels become the pages' provisional titles. */
export const WIKI_GROUPS: WikiGroup[] = (() => {
  const sidebar = Object.values(sidebarModules)[0] ?? '';
  const groups: WikiGroup[] = [];
  let current: WikiGroup = { label: 'Start Here', pages: [] };
  groups.push(current);
  const seen = new Set<string>();
  for (const line of sidebar.split('\n')) {
    const groupMatch = line.match(/^\s*\*\*(.+?)\*\*\s*$/);
    if (groupMatch) {
      current = { label: groupMatch[1].trim(), pages: [] };
      groups.push(current);
      continue;
    }
    const linkMatch = line.match(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/);
    if (linkMatch) {
      const page = resolveWikiPage(linkMatch[1]);
      if (page && !seen.has(page.id)) {
        seen.add(page.id);
        const label = linkMatch[2]?.trim();
        if (label) page.title = label;
        current.pages.push(page);
      }
    }
  }
  const leftovers = ALL_METAS.filter((p) => !seen.has(p.id));
  if (leftovers.length > 0) groups.push({ label: 'More Pages', pages: leftovers });
  return groups.filter((g) => g.pages.length > 0);
})();

/** Flat reading order (sidebar order) — drives Prev / Next keys. */
export const WIKI_ORDER: WikiPageMeta[] = WIKI_GROUPS.flatMap((g) => g.pages);

export const WIKI_STATS = {
  pages: ALL_METAS.length,
  images: Object.keys(imageLoaders).length,
};

/* ------------------------------------------------------------------ */
/* Page bodies (lazy, cached)                                          */
/* ------------------------------------------------------------------ */

const loadedPages = new Map<string, WikiPage>();
const pendingPages = new Map<string, Promise<WikiPage>>();
const listeners = new Set<() => void>();
let totalLinks: number | null = null;

function notify() {
  for (const cb of listeners) cb();
}

/** Subscribe to corpus changes (titles converging, link count
 *  landing, search readiness). Returns the unsubscribe. */
export function subscribeWikiCorpus(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getLoadedWikiPage(id: string): WikiPage | undefined {
  return loadedPages.get(id);
}

export function loadWikiPage(id: string): Promise<WikiPage> {
  const cached = loadedPages.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = pendingPages.get(id);
  if (pending) return pending;
  const loader = LOADER_BY_ID.get(id);
  const meta = META_BY_ID.get(id);
  if (!loader || !meta) return Promise.reject(new Error(`Unknown wiki page: ${id}`));
  const promise = loader().then((markdown) => {
    const page: WikiPage = { ...meta, markdown };
    loadedPages.set(id, page);
    // Converge the shared meta to the page's true H1 title and
    // keep the name index pointing at it under that title.
    const h1Title = titleOf(id, markdown);
    meta.title = h1Title;
    BY_NAME.set(h1Title.toLowerCase(), meta);
    pendingPages.delete(id);
    notify();
    return page;
  });
  pendingPages.set(id, promise);
  return promise;
}

let preloadPromise: Promise<void> | null = null;

/** Load every page body once (idempotent). Powers title
 *  convergence, the link count, and full-text search. */
export function preloadWikiCorpus(): Promise<void> {
  if (!preloadPromise) {
    preloadPromise = Promise.all(ALL_METAS.map((m) => loadWikiPage(m.id))).then(() => {
      totalLinks = ALL_METAS.reduce(
        (n, m) => n + (loadedPages.get(m.id)?.markdown.match(/\[\[/g)?.length ?? 0),
        0,
      );
      notify();
    });
  }
  return preloadPromise;
}

export function wikiCorpusReady(): boolean {
  return totalLinks !== null;
}

/** Total `[[…]]` occurrences across the corpus (page links + image
 *  embeds), or null until the preload has run. */
export function getWikiLinkCount(): number | null {
  return totalLinks;
}

/* ------------------------------------------------------------------ */
/* Images (lazy per reference)                                         */
/* ------------------------------------------------------------------ */

const IMAGE_LOADER_BY_REL = new Map<string, () => Promise<string>>();
for (const [path, loader] of Object.entries(imageLoaders)) {
  const rel = path.slice(path.indexOf('wiki/') + 'wiki/'.length);
  IMAGE_LOADER_BY_REL.set(rel.toLowerCase(), loader);
}

const resolvedImageUrls = new Map<string, string>();

function cleanImageRel(rel: string): string {
  return decodeURIComponent(rel).replace(/^\.?\//, '').toLowerCase();
}

/** True when the file exists under wiki/images (no bytes loaded). */
export function hasWikiImage(rel: string): boolean {
  return IMAGE_LOADER_BY_REL.has(cleanImageRel(rel));
}

/** The built asset URL if this reference has already resolved. */
export function getWikiImageUrl(rel: string): string | undefined {
  return resolvedImageUrls.get(cleanImageRel(rel));
}

/** Resolve a wiki-relative image path ("images/areas/x.jpg") to its
 *  built asset URL, loading only that file's reference. */
export function resolveWikiImage(rel: string): Promise<string | undefined> {
  const clean = cleanImageRel(rel);
  const cached = resolvedImageUrls.get(clean);
  if (cached) return Promise.resolve(cached);
  const loader = IMAGE_LOADER_BY_REL.get(clean);
  if (!loader) return Promise.resolve(undefined);
  return loader().then((url) => {
    resolvedImageUrls.set(clean, url);
    return url;
  });
}

/* ------------------------------------------------------------------ */
/* Full-text search (over loaded bodies)                               */
/* ------------------------------------------------------------------ */

export interface WikiTextHit {
  page: WikiPageMeta;
  /** The first matching line, markdown-lightened, match-centered. */
  snippet: string;
}

function snippetOf(markdown: string, lowerQuery: string): string | null {
  const clean = markdown.replace(/<!--[\s\S]*?-->/g, '');
  for (const rawLine of clean.split('\n')) {
    const idx = rawLine.toLowerCase().indexOf(lowerQuery);
    if (idx === -1) continue;
    const line = rawLine
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[\[([^\]|]+)\|([^\]]*)\]\]/g, '$2')
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/[#>*`]/g, '')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    const at = line.toLowerCase().indexOf(lowerQuery);
    if (line.length <= 150 || at === -1) return line.slice(0, 150);
    const start = Math.max(0, at - 55);
    return `${start > 0 ? '…' : ''}${line.slice(start, start + 145)}${start + 145 < line.length ? '…' : ''}`;
  }
  return null;
}

/** Body-text search across every loaded page. Call after
 *  preloadWikiCorpus() for corpus-wide results; unloaded pages are
 *  skipped. Results follow the sidebar reading order. */
export function searchWikiText(query: string, limit = 12): WikiTextHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: WikiTextHit[] = [];
  for (const meta of WIKI_ORDER) {
    const page = loadedPages.get(meta.id);
    if (!page) continue;
    const snippet = snippetOf(page.markdown, q);
    if (snippet) hits.push({ page: meta, snippet });
    if (hits.length >= limit) break;
  }
  return hits;
}
