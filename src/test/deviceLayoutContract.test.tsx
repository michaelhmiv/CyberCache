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
 *  - ResourceBar — THE STRIP (DESIGN.md §1; drift-fix F1 replaced
 *    the 3-across chip grid the r2 round built): ONE row on every
 *    tab — icon + value per resource, the fragment and equipped
 *    counts as micros riding their values, LV + level at the
 *    right, the settings gear as the row's one resident, and the
 *    XP hairline fused to the bottom edge. Values carry NO
 *    truncate/clip treatment and never render below the 11px
 *    floor; segments are shrink-0 and the shared formatter bounds
 *    every value to ≤6 glyphs, so the row fits at phone width —
 *    and if an extreme balance set cannot fit honestly, the row
 *    scrolls horizontally (scroll-don't-shrink) rather than
 *    squeezing. Until the first server profile lands the bar
 *    renders a skeleton strip instead of placeholder numbers
 *    (audit UX-04), and fractional balances under 10,000 render
 *    with one decimal (audit UX-05).
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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      // it-0 is the equipped primary: it needs a weapon shape or the
      // shared loadout read model (CONS-04) resolves its slot as
      // wrong-slot-type and the equipped count is honestly 0.
      items: Array.from({ length: 123 }, (_, i) => (i === 0 ? { id: 'it-0', weaponType: 'Pistol' } : { id: `it-${i}` })) as never,
    });
    useLoadoutStore.setState((s) => ({ slots: { ...s.slots, primary: 'it-0' } }));
  });

  it('arranges the wallet as ONE row — the Strip, never a grid', () => {
    render(<ResourceBar />);
    const bar = screen.getByTestId('resource-bar-strip');
    expect(bar.className).toContain('flex');
    expect(bar.className).not.toContain('grid');
    // Scroll-don't-shrink (DESIGN.md §6): if an extreme balance
    // set cannot fit at honest sizes, the row scrolls — the type
    // never drops below the floor to force a fit.
    expect(bar.className).toContain('overflow-x-auto');
    // All six wallet segments ride the one row, in mock order.
    const order = ['credits', 'scrap', 'cacheKey', 'legendaryCore', 'loot', 'level'];
    const positions = order.map((id) => {
      const el = screen.getByTestId(`resource-chip-${id}`);
      expect(el.className).toContain('shrink-0');
      return Array.from(bar.querySelectorAll('[data-testid^="resource-chip-"]')).indexOf(el);
    });
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
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
      // Strip values render at 13px — above the 11px floor.
      expect(valueEl.className).toContain('text-[13px]');
    }
  });

  it('shows the mock labels and the secondary counts (fragments, equipped)', () => {
    render(<ResourceBar />);
    // The mock language labels SCRAP visibly (its icon is the
    // least distinct) and closes the row with LV + the level.
    expect(screen.getByText('Scrap')).toBeTruthy();
    expect(screen.getByText('LV')).toBeTruthy();
    // The two counts Michael's screenshot truncated ("15 1/7 …")
    // ride their values as micros on the same baseline.
    expect(screen.getByText('3/5')).toBeTruthy();
    expect(screen.getByText('1/7')).toBeTruthy();
    // Assumption-gaps G4: the denominators are taught at the
    // counters' destination surfaces, not on the Strip — the
    // cache lane prints "5 fragments = 1 Cache Key" under its
    // fragment bar, and the Loadout header prints "{n}/7 Gear
    // slots". Visible labels on the Strip itself were measured
    // NOT to fit at 412px (they pushed the LV segment off-screen
    // at rest), so the micros stay bare here and the aria-labels
    // below carry the names in words.
    // Audit DISP-01: every count is NAMED — each segment's
    // aria-label states the resource and what its micro counts,
    // in words, so no quantity on the bar is unlabeled.
    expect(screen.getByTestId('resource-chip-cacheKey').getAttribute('aria-label'))
      .toContain('3 of 5 fragments');
    expect(screen.getByTestId('resource-chip-loot').getAttribute('aria-label'))
      .toContain('1 of 7 gear slots equipped');
    expect(screen.getByTestId('resource-chip-credits').getAttribute('aria-label'))
      .toContain('Credits');
    expect(screen.getByTestId('resource-chip-legendaryCore').getAttribute('aria-label'))
      .toContain('legendary cores');
  });

  it('carries the settings gear as its one resident when a handler is given (DESIGN.md §1)', () => {
    const onOpenSettings = vi.fn();
    render(<ResourceBar onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByTestId('strip-settings-button'));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    cleanup();
    render(<ResourceBar />);
    expect(screen.queryByTestId('strip-settings-button')).toBeNull();
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

  it('the Strip is a display bar: no per-chip tap boxes, no slant clips', () => {
    render(<ResourceBar onOpenSettings={() => {}} />);
    // The wallet segments are readouts, not buttons — the only
    // tap target in the bar is the settings gear resident, which
    // keeps a real touch box.
    const chip = screen.getByTestId('resource-chip-credits');
    expect(chip.className).not.toContain('min-h-[46px]');
    expect((chip as HTMLElement).style.clipPath ?? '').not.toContain('polygon');
    const gearButton = screen.getByTestId('strip-settings-button');
    expect(gearButton.className).toContain('h-9');
    expect(gearButton.className).toContain('w-9');
    // The bar itself keeps the family border, and the XP hairline
    // is fused to its bottom edge (DESIGN.md §1).
    const bar = screen.getByTestId('resource-bar');
    expect(bar.className).toContain('border-2');
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
  it('Market stops are one scrolling rail at honest type size (redesign v2), not a tile grid', () => {
    const market = read('src/screens/MarketScreen.tsx');
    // One rail, ChipRail track, ≥44px targets, labels at the 11px
    // floor — the 3×2 tile grid (and its 10px labels) is retired:
    // listings start in the first viewport now.
    expect(market).toContain('<ChipRail>');
    expect(market).toContain('min-h-[44px]');
    expect(market).toContain('text-[11px]');
    expect(market).not.toContain('grid grid-cols-3 gap-2');
    expect(market).not.toContain('min-w-[60px]');
    // The rail carries exactly DESIGN.md §2's seven stops, Rep
    // Desk + Slots included; My Listings and History are segments
    // of the Sell stop, not stops.
    for (const id of ['buy', 'sell', 'vendor', 'repair', 'shieldTech', 'repdesk', 'slots']) {
      expect(market).toContain(`{ id: '${id}'`);
    }
    expect(market).not.toContain("{ id: 'mylistings', label: 'My Listings', px");
    expect(market).not.toContain("{ id: 'history', label: 'History', px");
  });

  it('the Gear tab prints the wallet once (the Strip); no gear-home chrome formats wallet values', () => {
    const inventory = read('src/screens/InventoryScreen.tsx');
    // Wave D removed the summary tiles: the Cash tile re-printed
    // credits/scrap directly under the Strip (DESIGN.md §1 — the
    // wallet prints exactly once anywhere in the app). The gear
    // home's own chrome now formats no wallet values at all.
    expect(inventory).toContain('<ResourceBar');
    expect(inventory).not.toContain('compactResourceValue');
    expect(inventory).not.toContain('player.credits');
    // Drift-fix F5 completed the rule on the Loadout stop: the
    // panel's own Credits/Scrap/Items/Keys row (the last wallet
    // re-print on the Gear tab) is gone — the Strip above the rail
    // prints all four, and the panel header carries only the
    // numbers the Strip doesn't (DPS, HP).
    const loadout = read('src/components/action/ActionLoadout.tsx');
    expect(loadout).not.toContain('compactResourceValue');
    expect(loadout).not.toContain('player.credits');
    expect(loadout).not.toContain('player.scrap');
  });

  it('the BottomNav labels fit their cells (≤6 chars at the 11px floor in quarter-width cells)', () => {
    const nav = read('src/components/layout/BottomNav.tsx');
    const sigils = read('src/constants/navSigils.ts');
    // Four tabs now (DESIGN.md §2, Wave B): Home · Gear · Market ·
    // Hunter. The wider cells carry the labels at the §5 type
    // floor (11px) instead of the six-tab bar's 8px shrink —
    // scroll-don't-shrink's sibling rule: honest sizes when the
    // width exists.
    for (const label of ['Home', 'Gear', 'Market', 'Hunter']) {
      expect(sigils).toContain(`label: '${label}'`);
    }
    expect(nav).toContain('grid-cols-4');
    expect(nav).toContain('text-[11px]');
  });
});
