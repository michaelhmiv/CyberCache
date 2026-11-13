/**
 * wikiMarkdown renderer — the corpus' constructs, pinned. The
 * renderer is hand-rolled (the repo has no markdown library), so
 * each construct the real wiki uses gets a case here, including
 * the prototype's one real bug: a shared /g regex whose lastIndex
 * the recursive inline pass corrupted, hanging the renderer on
 * any bold span.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { renderWikiMarkdown, type MdCtx } from '@/lib/wiki/wikiMarkdown';

function renderMd(markdown: string, openPage: MdCtx['openPage'] = () => {}) {
  return render(<div>{renderWikiMarkdown(markdown, { openPage })}</div>);
}

describe('wikiMarkdown blocks', () => {
  it('renders headings at their levels', () => {
    renderMd('# Top\n\n## Section\n\n### Sub');
    expect(screen.getByRole('heading', { level: 1, name: 'Top' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Sub' })).toBeTruthy();
  });

  it('strips generator HTML comments before rendering', () => {
    const { container } = renderMd('Visible.\n\n<!-- generator: secret -->\n\nAlso visible.');
    expect(container.textContent).not.toContain('generator: secret');
    expect(container.textContent).toContain('Also visible.');
  });

  it('renders a table in a scrolling well with the first column pinned', () => {
    const { container } = renderMd('| Icon | Name | Price |\n|---|---|---|\n| x | Med Kit | 250 |');
    const well = container.querySelector('[data-testid="wiki-table-scroll"]');
    expect(well).toBeTruthy();
    const firstTh = container.querySelector('th');
    expect((firstTh as HTMLElement).style.position).toBe('sticky');
    expect(screen.getByText('Med Kit')).toBeTruthy();
    expect(screen.getByText('250')).toBeTruthy();
  });

  it('renders bullet and numbered lists, one nesting level deep', () => {
    const { container } = renderMd('- Alpha\n  - Nested\n- Beta\n\n1. First\n2. Second');
    expect(container.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelectorAll('ol li').length).toBe(2);
    expect(screen.getByText('Nested')).toBeTruthy();
  });

  it('renders a standalone image as a figure and its lone-italic line as the caption', () => {
    const { container } = renderMd('[[images/areas/dustwaste-frontier.jpg]]\n\n*The first hunting ground.*');
    const figure = container.querySelector('[data-figure="images/areas/dustwaste-frontier.jpg"]');
    expect(figure).toBeTruthy();
    expect(screen.getByText('The first hunting ground.')).toBeTruthy();
  });

  it('renders code fences and blockquotes without interpreting them', () => {
    renderMd('```\n**not bold**\n```\n\n> Quoted line.');
    expect(screen.queryByText('**not bold**')).toBeTruthy();
    expect(screen.getByText('Quoted line.')).toBeTruthy();
  });
});

describe('wikiMarkdown inline', () => {
  it('renders bold, italic, and inline code — and returns (the lastIndex regression)', () => {
    const { container } = renderMd('A **bold claim** with *emphasis* and `cc_record_death` inline.');
    expect(container.querySelector('strong')?.textContent).toBe('bold claim');
    expect(container.querySelector('em')?.textContent).toBe('emphasis');
    expect(container.querySelector('code')?.textContent).toBe('cc_record_death');
  });

  it('does NOT parse underscore emphasis (snake_case identifiers stay literal)', () => {
    const { container } = renderMd('The RPC is `cc_apply_chef_boss_attempt` and _not italic_ stays plain.');
    // The only <em> allowed would come from asterisk italics; there are none here.
    expect(container.querySelector('em')).toBeNull();
    expect(container.textContent).toContain('_not italic_');
  });

  it('renders a wikilink as an in-app link that opens its page', () => {
    const openPage = vi.fn();
    renderMd('See [[The-Market|the market]] before you sell.', openPage);
    const link = screen.getByText('the market');
    expect(link.getAttribute('data-wiki-link')).toBe('The-Market');
    fireEvent.click(link);
    expect(openPage).toHaveBeenCalledWith('The-Market');
  });

  it('renders a page that links the same target twice — and returns (issue #551 fixture)', () => {
    // One paragraph links [[Progression]] twice, and a list item
    // links it a third time — the content shape PR #514 shipped when
    // the manual's index test hung (issue #551). The probes
    // (#560/#561/#562) exonerated this renderer — the hang was the
    // index test's stale count pin — and this fixture pins the
    // innocence: every occurrence renders as its own link, and the
    // render returns.
    const { container } = renderMd(
      'The cap lives on [[Progression]], and the road back runs through [[Progression]] too.\n\n- At the cap, see [[Progression]]',
    );
    expect(container.querySelectorAll('a[data-wiki-link="Progression"]').length).toBe(3);
  });

  it('renders a dead wikilink as a dotted span, never a link', () => {
    const { container } = renderMd('See [[No-Such-Page]] for details.');
    expect(container.querySelector('a')).toBeNull();
    expect(screen.getByText('No-Such-Page')).toBeTruthy();
  });

  it('renders external links with the Ext chip in a new tab', () => {
    renderMd('Read [the docs](https://example.com/docs) later.');
    const link = screen.getByText(/the docs/);
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('Ext')).toBeTruthy();
  });
});
