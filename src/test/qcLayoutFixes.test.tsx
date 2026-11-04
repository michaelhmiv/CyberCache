/**
 * QC fix slice C — layout defects from the final QC playtest
 * (2026-11-02, QC-PLAYTEST-2026-11-02.md). A4's render contract
 * lives in deviceLayoutContract.test.tsx; this file pins the
 * remaining four:
 *
 *  - A5: PickerSheet (the one sheet container behind the level,
 *    streak, weekly, return, and slot-picker sheets) sizes to its
 *    content — max-h cap, never a fixed full height — so short
 *    sheets don't float over a black void.
 *  - A8: Market Buy card stat lines print in full: the badge line
 *    (which carries activity-module stat values) wraps instead of
 *    ellipsizing, stat chips never break mid-value, and the
 *    seller/trend row wraps instead of crushing.
 *  - A9: the gain-toast lane sits in its own lane above the 66px
 *    bottom nav (66 + 14px gap), pointer-transparent, and the
 *    toast entry slide (6px) can never dip into the nav.
 *  - C1: "Switch Action" prints once in the stage zone — the
 *    one button (and the sheet it opens). (Superseded in form
 *    by the owner ruling of 2026-11-03: the one door is now an
 *    icon-only stage button whose name lives in its aria-label;
 *    the C1 tests below pin that end state. The diorama's
 *    secondary door to the same sheet was labeled "All Actions"
 *    under C1; drift-fix F2 retired that door with the in-stage
 *    action bar. Owner ruling 2026-11-02 then moved the one
 *    remaining door out of its controls row under the rail and
 *    onto the stage itself as a floating chip — still the one
 *    named door C1 wanted; actionControlsOnStage.test.tsx pins
 *    its new home.)
 *
 * jsdom has no layout engine, so these are DOM/source contracts in
 * the repo's established style; the 412×915 geometry proof is the
 * Playwright capture recorded in the slice PR.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PickerSheet } from '@/components/common/PickerSheet';

const readSource = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8');

describe('QC A5 — PickerSheet sizes to content, capped at 92vh', () => {
  it('panel carries a max-height cap, never a fixed height', () => {
    render(
      <PickerSheet title="Level" onClose={() => {}}>
        <div>short content</div>
      </PickerSheet>,
    );
    const overlay = screen.getByTestId('picker-sheet-overlay');
    const panel = overlay.firstElementChild as HTMLElement;
    expect(panel.className).toContain('max-h-[92vh]');
    expect(panel.className.split(' ')).not.toContain('h-[92vh]');
    // The scroll body can shrink below content height at the cap.
    const body = screen.getByTestId('picker-sheet-body');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('overflow-y-auto');
  });

  it('no sheet container in the app uses a fixed viewport height', () => {
    const picker = readSource('src/components/common/PickerSheet.tsx');
    expect(picker).not.toContain('className="h-[92vh]');
    expect(picker).toContain('className="max-h-[92vh]');
  });
});

describe('QC A8 — Market card stat lines print in full', () => {
  const market = readSource('src/screens/MarketScreen.tsx');

  it('the badge line wraps — no truncate on the stat-bearing badge', () => {
    expect(market).not.toContain('text-amber mt-0.5 truncate');
    expect(market).toContain('text-amber mt-0.5 leading-snug');
  });

  it('stat chips are nowrap so a value never breaks mid-number', () => {
    expect(market).toContain('inline-flex items-center gap-0.5 whitespace-nowrap rounded border border-border bg-bg px-1 py-0.5');
  });

  it('the seller / price-trend row wraps instead of crushing', () => {
    expect(market).toContain('flex flex-wrap items-center justify-between gap-x-2 gap-y-1');
  });
});

describe('QC A9 — gain toasts get their own lane above the bottom nav', () => {
  const deck = readSource('src/components/dashboard/DashboardDeck.tsx');

  it('lane bottom = nav height (66px) + a 14px clear gap', () => {
    expect(deck).toContain('bottom-[calc(80px+env(safe-area-inset-bottom))]');
    expect(deck).not.toContain('bottom-[calc(70px+env(safe-area-inset-bottom))]');
  });

  it('the lane container never intercepts taps meant for the page', () => {
    expect(deck).toContain('pointer-events-none fixed bottom-[calc(80px');
  });

  it('toast entry slide stays inside the lane (6px < 14px gap)', () => {
    expect(deck).toContain('initial={{ opacity: 0, y: 6, scale: 0.9, rotate: -1 }}');
    expect(deck).not.toContain('y: 14, scale: 0.9');
  });
});

describe('QC C1 — the one switch door in the stage zone (icon-only since 2026-11-03)', () => {
  const action = readSource('src/screens/ActionScreenContextual.tsx');

  // Drift-fix F2 retired the diorama's duplicate door entirely:
  // the stage carries no action bar, so the "All Actions" alias
  // the C1 fix gave the second door is gone with it. The sheet
  // has exactly ONE door — the Switch Action button, since the
  // 2026-11-02 owner ruling a floating chip on the stage —
  // which is the end state C1 was protecting (one door, one name).
  it('the retired diorama door and its "All Actions" alias are gone', () => {
    expect(action).not.toContain('All Actions');
    expect(action).not.toContain('secondaryActionLabel');
    expect(action).not.toContain(": 'Switch Action'");
  });

  // Owner ruling 2026-11-03 (Home consolidation): the stage
  // controls are ICON-ONLY — the one door keeps its one name as
  // an accessible name (aria-label), and no visible text prints.
  it('the stage controls are icon-only: the one name survives as an aria-label, no visible text', () => {
    expect(action).not.toContain('>Switch Action</button>');
    expect(action).not.toContain('>Stop</button>');
    expect(action).toContain('aria-label="Switch Action"');
    expect(action).toContain('aria-label="Stop"');
  });
});
