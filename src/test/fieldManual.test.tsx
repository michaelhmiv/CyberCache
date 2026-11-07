/**
 * Field Manual screen — the wiki-native manual in the app's
 * sub-screen seat (the old 'help' screen). Pins the reading flow:
 * index → article → wikilink push → back pop, deep-link entry,
 * body-text search, and the guided tour's absence (retired
 * 2026-11-05 — the wiki is the manual now).
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HelpScreen } from '@/screens/HelpScreen';

describe('Field Manual (HelpScreen)', () => {
  it('renders the masthead and the sidebar-grouped index', async () => {
    const { container } = render(<HelpScreen />);
    expect(screen.getByText('Unit FM-09 · Field Manual')).toBeTruthy();
    expect(screen.getByText('Start Here')).toBeTruthy();
    const row = container.querySelector('[data-page="Getting-Started"]');
    expect(row).toBeTruthy();
    expect(within(row as HTMLElement).getByText('PG-02')).toBeTruthy();
    // The background preload converges the Links LCD to a number.
    // (313 → 314 with One Grammar, 2026-11-06: Skins-and-Cosmetics
    // gained a [[Gear]] cross-reference for the held-weapon rule.)
    expect(await screen.findByText('314', {}, { timeout: 10000 })).toBeTruthy();
  });

  it('carries no trace of the retired guided tour or hand-written sections', () => {
    render(<HelpScreen />);
    expect(screen.queryByText('Guided Tour')).toBeNull();
    expect(screen.queryByText(/Step 1 of/)).toBeNull();
    expect(screen.queryByText('Pro Tips')).toBeNull();
  });

  it('opens an article from the index; its control key reads Index at depth 1', async () => {
    const { container } = render(<HelpScreen />);
    fireEvent.click(container.querySelector('[data-page="Getting-Started"]')!);
    const article = await screen.findByTestId('wiki-article', {}, { timeout: 10000 });
    expect(within(article).getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back to index' })).toBeTruthy();
    expect(screen.getByText(/End of page — source wiki\/Getting-Started\.md/)).toBeTruthy();
  });

  it('pushes a wikilink target onto the stack and pops it with Back', async () => {
    const { container } = render(<HelpScreen />);
    fireEvent.click(container.querySelector('[data-page="Getting-Started"]')!);
    await screen.findByTestId('wiki-article', {}, { timeout: 10000 });
    const marketLink = container.querySelector('a[data-wiki-link="The-Market"]');
    expect(marketLink).toBeTruthy();
    fireEvent.click(marketLink!);
    expect(await screen.findByText(/End of page — source wiki\/The-Market\.md/, {}, { timeout: 10000 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to previous page' }));
    expect(await screen.findByText(/End of page — source wiki\/Getting-Started\.md/, {}, { timeout: 10000 })).toBeTruthy();
  });

  it('deep-links straight to a page (Reference-Consumables, with its table)', async () => {
    render(<HelpScreen initialPageId="Reference-Consumables" />);
    const article = await screen.findByTestId('wiki-article', {}, { timeout: 10000 });
    expect(article.querySelector('[data-testid="wiki-table-scroll"]')).toBeTruthy();
  });

  it('search finds body text and opens the hit page', async () => {
    render(<HelpScreen />);
    const input = screen.getByLabelText('Filter wiki pages');
    fireEvent.change(input, { target: { value: 'dustwaste' } });
    const hits = await screen.findByTestId('wiki-search-hits', {}, { timeout: 10000 });
    const hitRow = hits.querySelector('[data-page]');
    expect(hitRow).toBeTruthy();
    fireEvent.click(hitRow!);
    expect(await screen.findByTestId('wiki-article', {}, { timeout: 10000 })).toBeTruthy();
  });

  it('filters the index by title', async () => {
    const { container } = render(<HelpScreen />);
    fireEvent.change(screen.getByLabelText('Filter wiki pages'), { target: { value: 'economy' } });
    expect(container.querySelector('[data-page="Economy"]')).toBeTruthy();
    expect(container.querySelector('[data-page="Getting-Started"]')).toBeNull();
  });
});
