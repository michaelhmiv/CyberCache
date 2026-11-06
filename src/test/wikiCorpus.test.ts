/**
 * wikiCorpus census — the Field Manual renders the repo's real
 * wiki, so the corpus itself is under test: every page is in the
 * index, every wikilink resolves, every image reference has a file
 * behind it, titles converge to each page's own H1, and body-text
 * search finds what the wiki actually says. A wiki edit that
 * breaks a link or drops an image fails here before it ships in
 * the app.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  WIKI_GROUPS,
  WIKI_ORDER,
  WIKI_STATS,
  getLoadedWikiPage,
  getWikiLinkCount,
  hasWikiImage,
  preloadWikiCorpus,
  resolveWikiImage,
  resolveWikiPage,
  searchWikiText,
  wikiCorpusReady,
} from '@/lib/wiki/wikiCorpus';

// Independent page inventory, globbed from this test file — the
// cross-check that the corpus module's manifest matches wiki/ on
// disk, not just itself.
const diskPages = import.meta.glob<string>('../../wiki/*.md', {
  query: '?raw',
  import: 'default',
});

function stemOf(path: string): string {
  return path.split('/').pop()!.replace(/\.md$/, '');
}

beforeAll(async () => {
  await preloadWikiCorpus();
});

describe('wikiCorpus manifest', () => {
  it('indexes every wiki page on disk exactly once', () => {
    const diskIds = Object.keys(diskPages).map(stemOf).filter((id) => id !== '_Sidebar');
    expect(WIKI_STATS.pages).toBe(diskIds.length);
    expect(WIKI_ORDER.length).toBe(diskIds.length);
    expect(new Set(WIKI_ORDER.map((p) => p.id)).size).toBe(diskIds.length);
    for (const id of diskIds) {
      expect(resolveWikiPage(id), `page ${id} resolves`).not.toBeNull();
    }
  });

  it('groups come from the sidebar, and unlisted pages land in More Pages', () => {
    const labels = WIKI_GROUPS.map((g) => g.label);
    expect(labels).toContain('Start Here');
    expect(labels[labels.length - 1]).toBe('More Pages');
    const more = WIKI_GROUPS.find((g) => g.label === 'More Pages');
    expect(more?.pages.map((p) => p.id)).toContain('Activity-Log');
  });

  it('name resolution accepts ids, spaced names, and titles', () => {
    expect(resolveWikiPage('Getting-Started')?.id).toBe('Getting-Started');
    expect(resolveWikiPage('getting started')?.id).toBe('Getting-Started');
    // Title form, read from the loaded page itself (no literal to drift).
    const refTitle = getLoadedWikiPage('Reference-Consumables')!.title;
    expect(resolveWikiPage(refTitle)?.id).toBe('Reference-Consumables');
    expect(resolveWikiPage('No-Such-Page')).toBeNull();
  });
});

describe('wikiCorpus census (after preload)', () => {
  it('is ready and counts every [[ occurrence as a link', () => {
    expect(wikiCorpusReady()).toBe(true);
    let expected = 0;
    for (const meta of WIKI_ORDER) {
      expected += getLoadedWikiPage(meta.id)?.markdown.match(/\[\[/g)?.length ?? 0;
    }
    expect(getWikiLinkCount()).toBe(expected);
    expect(expected).toBeGreaterThan(300);
  });

  it('every page title converges to the H1 its own markdown prints', () => {
    for (const meta of WIKI_ORDER) {
      const page = getLoadedWikiPage(meta.id);
      expect(page, `${meta.id} loaded`).toBeTruthy();
      const h1 = page!.markdown.match(/^#\s+(.+)$/m)?.[1]?.trim().replace(/\*\*/g, '');
      expect(meta.title, `${meta.id} title`).toBe(h1);
    }
  });

  it('every wikilink in every page resolves', () => {
    const dead: string[] = [];
    for (const meta of WIKI_ORDER) {
      const md = getLoadedWikiPage(meta.id)!.markdown;
      for (const m of md.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)) {
        const target = m[1].trim();
        if (/^images\//i.test(target)) continue;
        if (!resolveWikiPage(target)) dead.push(`${meta.id} → ${target}`);
      }
    }
    expect(dead).toEqual([]);
  });

  it('every image reference has a file, and files resolve to URLs', async () => {
    const missing: string[] = [];
    let refs = 0;
    for (const meta of WIKI_ORDER) {
      const md = getLoadedWikiPage(meta.id)!.markdown;
      for (const m of md.matchAll(/\[\[(images\/[^\]]+)\]\]/gi)) {
        refs += 1;
        if (!hasWikiImage(m[1])) missing.push(`${meta.id} → ${m[1]}`);
      }
      for (const m of md.matchAll(/<img[^>]*src="([^"]+)"/g)) {
        refs += 1;
        if (!hasWikiImage(m[1])) missing.push(`${meta.id} → ${m[1]}`);
      }
    }
    expect(refs).toBeGreaterThan(250);
    expect(missing).toEqual([]);
    const url = await resolveWikiImage('images/areas/dustwaste-frontier.jpg');
    expect(typeof url).toBe('string');
    expect(url!.length).toBeGreaterThan(0);
    expect(await resolveWikiImage('images/nope/not-real.png')).toBeUndefined();
  });
});

describe('wikiCorpus search', () => {
  it('finds body text the titles never mention', () => {
    const hits = searchWikiText('Dustwaste');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.snippet.toLowerCase()).toContain('dustwaste');
    }
    // Getting-Started's title carries no "Dustwaste" — the hit can
    // only come from its body text.
    expect(hits.map((h) => h.page.id)).toContain('Getting-Started');
  });

  it('snippets never leak raw HTML (img-tag lines read as text)', () => {
    const hits = searchWikiText('siltglass');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.snippet).not.toContain('<');
      expect(hit.snippet.toLowerCase()).toContain('siltglass');
    }
  });

  it('returns nothing for a term the wiki never uses', () => {
    expect(searchWikiText('zzz-no-such-term-zzz')).toEqual([]);
  });
});
