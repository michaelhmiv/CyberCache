/**
 * Device feedback round 2 — Part 2: phone-width layout contract.
 *
 * Michael's device report (2026-10-31): "buttons look squished" —
 * his screenshot showed the top resource bar truncating at phone
 * width ("85 cre…", "15 scr…", "0 cor…", "15 1/7 …"). The old bar
 * forced six chips into one row: at 360dp each chip was ~50px wide
 * with an 18px icon, a 24px content offset, and a 16px value —
 * arithmetically impossible, so values clipped and labels
 * ellipsized.
 *
 * The contract pinned here (logical widths 360dp / 412dp):
 *  - ResourceBar: 3-across grid at phone width (6-across only from
 *    560dp), stacked chips (icon + full label on line 1, the value on
 *    line 2 with the secondary count as a labeled stack beside it),
 *    values carry NO truncate/clip treatment, chips are ≥44dp tall,
 *    and the shared formatter bounds every value to ≤6 glyphs so it
 *    always fits. Until the first server profile lands the bar
 *    renders skeleton chips instead of placeholder numbers (audit
 *    UX-04), and fractional balances under 10,000 render with one
 *    decimal (audit UX-05).
 *  - Hunter Totals (Board): metric values never truncate.
 *  - Market tabs: an even 3×2 grid with ≥44px targets (was a
 *    flex-wrap that broke 4+2 against a 60px floor).
 *  - Inventory summary tiles + the loadout panel's resource row use
 *    the same bounded formatter.
 *
 * jsdom has no layout engine, so the proof is the DOM contract:
 * full strings present in the tree, no ellipsis machinery on value
 * elements, and the arrangement classes that produce the geometry —
 * plus the formatter's output bound checked exhaustively by
 * magnitude. (Repo precedent: phase1UxStructure / deviceFeedback
 * source-shape tests.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import { compactResourceValue } from '@/lib/ui/formatValue';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { CharacterStatBarBody } from '@/components/stats/CharacterStatBar';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('layout contract — compactResourceValue bounds', () => {
  it('formats the boundary values exactly', () => {
    expect(compactResourceValue(0)).toBe('0');
    expect(compactResourceValue(999)).toBe('999');
    expect(compactResourceValue(1_000)).toBe('1,000');
    expect(compactResourceValue(9_999)).toBe('9,999');
    expect(compactResourceValue(10_000)).toBe('10.0K');
    expect(compactResourceValue(999_949)).toBe('999.9K');
    expect(compactResourceValue(999_950)).toBe('1.0M');
    expect(compactResourceValue(12_480_235)).toBe('12.5M');
  });

  it('never emits more than 6 glyphs at any magnitude under 10^12', () => {
    for (let n = 0; n <= 2_000_000; n += 9_973) {
      expect(compactResourceValue(n).length).toBeLessThanOrEqual(6);
    }
    for (const n of [999, 9_999, 99_999, 999_949, 999_950, 9_999_999, 999_949_999, 999_950_000, 999_949_999_999]) {
      expect(compactResourceValue(n).length).toBeLessThanOrEqual(6);
    }
    expect(compactResourceValue(999_950_000)).toBe('1.0B');
  });

  it('renders fractional balances under 10,000 with one decimal (audit UX-05)', () => {
    // Roaming pays +0.75cr/+0.15 scrap per tick; an integer render
    // made scrap look frozen while the fraction banked server-side.
    expect(compactResourceValue(0.75)).toBe('0.8');
    expect(compactResourceValue(0.25)).toBe('0.3');
    expect(compactResourceValue(500.5)).toBe('500.5');
    expect(compactResourceValue(5_100.3)).toBe('5100.3');
    expect(compactResourceValue(9_999.9)).toBe('9999.9');
    // A fraction that rounds up to 10000.0 falls into the K form.
    expect(compactResourceValue(9_999.96)).toBe('10.0K');
    // Integer values keep the established grouped/compact forms.
    expect(compactResourceValue(5_100)).toBe('5,100');
    expect(compactResourceValue(10_000.5)).toBe('10.0K');
    for (let n = 0; n < 10_000; n += 613) {
      expect(compactResourceValue(n + 0.75).length).toBeLessThanOrEqual(6);
    }
  });
});

describe('layout contract — ResourceBar at phone width', () => {
  beforeEach(() => {
    usePlayerStore.setState({
      credits: 999_949, scrap: 12_345, cacheKeys: 15, cacheKeyFragments: 3,
      legendaryCores: 2, level: 100,
      // Audit UX-04: these tests simulate a loaded profile — the bar
      // skeletons until the first server sync sets this flag.
      profileLoaded: true,
    });
    useInventoryStore.setState({
      items: Array.from({ length: 123 }, (_, i) => ({ id: `it-${i}` })) as never,
    });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, primary: 'it-0' } }));
  });

  it('arranges the six chips 3-across on phones, 6-across only when wide', () => {
    const { container } = render(<ResourceBar />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className).toContain('grid');
    expect(bar.className).toContain('grid-cols-3');
    expect(bar.className).toContain('min-[560px]:grid-cols-6');
    expect(bar.className).not.toContain('flex');
  });

  it('shows every resource value in full, with no truncation machinery', () => {
    render(<ResourceBar />);
    const expected: Record<string, string> = {
      credits: '999.9K',
      scrap: '12.3K',
      cacheKey: '15',
      legendaryCore: '2',
      loot: '123',
      level: '100',
    };
    for (const [id, text] of Object.entries(expected)) {
      const valueEl = screen.getByTestId(`resource-value-${id}`);
      expect(valueEl.textContent).toBe(text);
      expect(valueEl.className).toContain('whitespace-nowrap');
      expect(valueEl.className).not.toContain('truncate');
    }
  });

  it('shows full labels and the secondary counts (fragments, equipped)', () => {
    render(<ResourceBar />);
    for (const label of ['Credits', 'Scrap', 'Keys', 'Cores', 'Loot', 'Level']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // The two counts Michael's screenshot truncated ("15 1/7 …").
    expect(screen.getByText('3/5')).toBeTruthy();
    expect(screen.getByText('1/7')).toBeTruthy();
    // Audit DISP-01: each secondary count carries a micro-label
    // naming what it counts — a bare "3/5" over the key count read
    // as two unlabeled quantities stacked on one tile.
    expect(screen.getByText('frag')).toBeTruthy();
    expect(screen.getByText('equipped')).toBeTruthy();
  });

  it('skeletons until the first server profile lands — never false zeros (audit UX-04)', () => {
    usePlayerStore.setState(usePlayerStore.getInitialState(), true);
    expect(usePlayerStore.getState().profileLoaded).toBe(false);
    render(<ResourceBar />);
    expect(screen.getByTestId('resource-bar-loading')).toBeTruthy();
    expect(screen.getByTestId('resource-chip-credits-skeleton')).toBeTruthy();
    // No value testids exist in the skeleton — nothing paints the
    // store's placeholder numbers as if they were the player's.
    expect(screen.queryByTestId('resource-value-credits')).toBeNull();
    expect(screen.queryByTestId('resource-value-scrap')).toBeNull();
  });

  it('chips keep a ≥44dp tap height and the angled-chip language', () => {
    render(<ResourceBar />);
    const chip = screen.getByTestId('resource-chip-credits');
    expect(chip.className).toContain('min-h-[46px]');
    expect(chip.className).toContain('border-2');
    expect((chip as HTMLElement).style.clipPath).toContain('polygon');
  });
});

describe('layout contract — Hunter Totals values never truncate', () => {
  const summary: CharacterStatSummary = {
    headline: [],
    all: [
      { key: 'health', label: 'Health', value: 820, display: '820 (+0%)', detail: 'HP', tone: 'green', contributions: [] },
      { key: 'dps', label: 'Base DPS', value: 0, display: '0', detail: 'DPS', tone: 'amber', contributions: [] },
      { key: 'shieldBreak', label: 'Shield Break', value: 0, display: '0', detail: 'Break', tone: 'red', contributions: [] },
    ],
  };

  it('the HP value renders whole with no truncate class', () => {
    render(<CharacterStatBarBody summary={summary} currentHp={820} maxHp={820} />);
    const metric = screen.getByTestId('hud-metric-health');
    const valueEl = Array.from(metric.querySelectorAll('div')).find((d) => d.textContent === '820 (+0%)');
    expect(valueEl).toBeTruthy();
    expect(valueEl!.className).toContain('whitespace-nowrap');
    expect(valueEl!.className).not.toContain('truncate');
  });
});

describe('layout contract — swept surfaces (source shape)', () => {
  it('Market tabs are an even 3×2 grid with ≥44px targets, no 60px floor', () => {
    const market = read('src/screens/MarketScreen.tsx');
    expect(market).toContain('grid grid-cols-3 gap-2');
    expect(market).toContain('min-h-[52px]');
    expect(market).not.toContain('min-w-[60px]');
  });

  it('Inventory summary tiles and the loadout resource row use the bounded formatter', () => {
    const inventory = read('src/screens/InventoryScreen.tsx');
    expect(inventory).toContain('compactResourceValue(player.credits)');
    expect(inventory).not.toContain('player.credits.toLocaleString()');
    const loadout = read('src/components/action/ActionLoadout.tsx');
    expect(loadout).toContain('compactResourceValue(player.credits)');
    expect(loadout).toContain('compactResourceValue(player.scrap)');
  });

  it('the BottomNav labels fit their cells (≤6 chars at 8px in ~52px cells)', () => {
    const nav = read('src/components/layout/BottomNav.tsx');
    const sigils = read('src/constants/navSigils.ts');
    // The six tab labels are short established forms rendered at
    // 8px in ~52px cells; the bar itself was not part of the device
    // complaint and stays unchanged.
    for (const label of ['Board', 'Action', 'Gear', 'Market', 'Rank', 'Hunter']) {
      expect(sigils).toContain(`label: '${label}'`);
    }
    expect(nav).toContain('grid-cols-6');
    expect(nav).toContain('text-[8px]');
  });
});
