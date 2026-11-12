/**
 * Tab keep-alive (tab-switch latency fix, 2026-11-12):
 * - A hidden ScreenWrapper pane keeps its children MOUNTED (state,
 *   scroll, canvases survive) — it is display:none, never unmounted.
 * - The App shell source-pins the keep-alive + code-split contract:
 *   visited-tab panes, React.lazy screens, sub-screen takeover.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';

const readSource = (rel: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', rel), 'utf8');

describe('ScreenWrapper keep-alive panes', () => {
  it('a hidden pane keeps its children mounted with display:none', () => {
    const { container } = render(
      <ScreenWrapper hidden>
        <div data-testid="pane-child">still here</div>
      </ScreenWrapper>,
    );
    expect(screen.getByTestId('pane-child')).toBeTruthy();
    const pane = container.firstElementChild as HTMLElement;
    expect(pane.style.display).toBe('none');
    expect(pane.getAttribute('aria-hidden')).toBe('true');
    // Its own scroller: scroll position is per-pane state now.
    expect(pane.className).toContain('overflow-y-auto');
  });

  it('a visible pane renders without the hidden style', () => {
    const { container } = render(
      <ScreenWrapper>
        <div data-testid="pane-child">here</div>
      </ScreenWrapper>,
    );
    const pane = container.firstElementChild as HTMLElement;
    expect(pane.style.display).toBe('');
    expect(screen.getByTestId('pane-child')).toBeTruthy();
  });

  it('pane-local state survives a hide/show cycle (no remount)', () => {
    const Stateful = () => {
      const [n] = React.useState(() => Math.random());
      return <div data-testid="stateful">{n}</div>;
    };
    const { rerender } = render(
      <ScreenWrapper hidden={false}><Stateful /></ScreenWrapper>,
    );
    const before = screen.getByTestId('stateful').textContent;
    rerender(<ScreenWrapper hidden><Stateful /></ScreenWrapper>);
    rerender(<ScreenWrapper hidden={false}><Stateful /></ScreenWrapper>);
    expect(screen.getByTestId('stateful').textContent).toBe(before);
  });
});

describe('App shell — keep-alive + lazy source pins', () => {
  const app = readSource('src/App.tsx');

  it('tab screens are React.lazy chunks, not static imports', () => {
    for (const name of ['HomeScreen', 'InventoryScreen', 'MarketScreen', 'ProfileScreen']) {
      expect(app).toContain(`const ${name} = React.lazy(`);
      expect(app).not.toContain(`import { ${name} } from`);
    }
  });

  it('tabs mount on first visit and stay mounted (visitedTabs)', () => {
    expect(app).toContain('visitedTabs');
    expect(app).toContain("hidden={!!subScreen || activeTab !== 'home'}");
    expect(app).toContain("hidden={!!subScreen || activeTab !== 'hunter'}");
    // Sub-screen takeover still replaces the visible tab area.
    expect(app).toContain('{subScreen ? renderSubScreen() : null}');
  });

  it('Market receives the refresh-on-return active signal', () => {
    expect(app).toContain("active={!subScreen && activeTab === 'market'}");
  });
});
