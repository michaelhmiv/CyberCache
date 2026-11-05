/**
 * wikiCorpus — PROTOTYPE data layer (design/field-manual-wiki-native,
 * 2026-11-05; NEVER shipped from this branch).
 *
 * Loads the repo's REAL wiki at build time: every `wiki/*.md` page as
 * raw text (Vite glob `?raw`) and every `wiki/images/**` asset as a
 * URL. What the prototype Field Manual renders is byte-for-byte the
 * game's published wiki content — no fixtures, no copied prose.
 *
 * Index structure is parsed from the wiki's own `_Sidebar.md`, the
 * same file GitHub Wiki renders as its navigation: `**Group**` lines
 * open a group, `- [[Page Name]]` lines are its entries, in order.
 * Pages the sidebar never lists fall into a trailing group so the
 * in-app index is complete even where the GitHub sidebar is not.
 */

const rawModules = import.meta.glob<string>('../../wiki/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const imageModules = import.meta.glob<string>('../../wiki/images/**/*.{png,jpg,jpeg,webp,gif,svg}', {
  query: '?url',
  import: 'default',
  eager: true,
});

export interface WikiPage {
  /** File stem, e.g. "Getting-Started" — the canonical page id. */
  id: string;
  /** Display title: the page's first H1, else the de-hyphenated stem. */
  title: string;
  /** Raw markdown, exactly as published in wiki/. */
  markdown: string;
  /** True for the generated Reference-* data pages. */
  generated: boolean;
}

function stemOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '');
}

function titleOf(id: string, markdown: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (h1 ?? id.replace(/-/g, ' ')).replace(/\*\*/g, '');
}

const ALL_PAGES: WikiPage[] = Object.entries(rawModules)
  .filter(([path]) => stemOf(path) !== '_Sidebar')
  .map(([path, markdown]) => {
    const id = stemOf(path);
    return { id, title: titleOf(id, markdown), markdown, generated: id.startsWith('Reference-') };
  })
  .sort((a, b) => a.id.localeCompare(b.id));

export const WIKI_PAGES: WikiPage[] = ALL_PAGES;

const BY_ID = new Map(ALL_PAGES.map((p) => [p.id.toLowerCase(), p]));

/** Name resolution: "Getting Started", "Getting-Started" and the
 *  page's own H1 title all resolve to the same page, case-insensitive. */
const BY_NAME = new Map<string, WikiPage>();
for (const p of ALL_PAGES) {
  BY_NAME.set(p.id.toLowerCase(), p);
  BY_NAME.set(p.id.replace(/-/g, ' ').toLowerCase(), p);
  BY_NAME.set(p.title.toLowerCase(), p);
}

export function resolveWikiPage(rawTarget: string): WikiPage | null {
  const target = decodeURIComponent(rawTarget).split('#')[0].trim().replace(/\.md$/, '');
  if (!target) return null;
  return (
    BY_NAME.get(target.toLowerCase()) ??
    BY_NAME.get(target.replace(/\s+/g, '-').toLowerCase()) ??
    BY_ID.get(target.toLowerCase()) ??
    null
  );
}

/** Resolve a wiki-relative image path ("images/areas/x.jpg") to the
 *  built asset URL, or undefined when the file is not in wiki/images. */
const IMAGE_BY_REL = new Map<string, string>();
for (const [path, url] of Object.entries(imageModules)) {
  const rel = path.slice(path.indexOf('wiki/') + 'wiki/'.length);
  IMAGE_BY_REL.set(rel.toLowerCase(), url);
}

export function wikiImageUrl(rel: string): string | undefined {
  const clean = decodeURIComponent(rel).replace(/^\.?\//, '').toLowerCase();
  return IMAGE_BY_REL.get(clean);
}

export interface WikiGroup {
  label: string;
  pages: WikiPage[];
}

/** Index groups, parsed live from wiki/_Sidebar.md. Links that appear
 *  before the first **Group** header land in "Start Here"; pages the
 *  sidebar never lists are appended under "More Pages" so nothing in
 *  the wiki is unreachable from the index. */
export const WIKI_GROUPS: WikiGroup[] = (() => {
  const sidebarPath = Object.keys(rawModules).find((p) => stemOf(p) === '_Sidebar');
  const sidebar = sidebarPath ? rawModules[sidebarPath] : '';
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
    const linkMatch = line.match(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/);
    if (linkMatch) {
      const page = resolveWikiPage(linkMatch[1]);
      if (page && !seen.has(page.id)) {
        seen.add(page.id);
        current.pages.push(page);
      }
    }
  }
  const leftovers = ALL_PAGES.filter((p) => !seen.has(p.id));
  if (leftovers.length > 0) groups.push({ label: 'More Pages', pages: leftovers });
  return groups.filter((g) => g.pages.length > 0);
})();

/** Flat reading order (sidebar order) — drives Prev / Next keys. */
export const WIKI_ORDER: WikiPage[] = WIKI_GROUPS.flatMap((g) => g.pages);

export const WIKI_STATS = {
  pages: ALL_PAGES.length,
  links: ALL_PAGES.reduce((n, p) => n + (p.markdown.match(/\[\[/g)?.length ?? 0), 0),
  images: IMAGE_BY_REL.size,
  bytes: ALL_PAGES.reduce((n, p) => n + new TextEncoder().encode(p.markdown).length, 0),
};
