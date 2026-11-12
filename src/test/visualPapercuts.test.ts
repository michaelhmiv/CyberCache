/**
 * Visual-audit papercuts (2026-10-29 audit, fixed in the tune-up pass).
 * Behavioral checks where the logic is testable; source-shape checks
 * (the repo's established pattern) for pure-render fixes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toMessage } from '../auth/errorText';
import { canStartCraft } from '../lib/craftingEngine';

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

describe('A1 — auth errors are human', () => {
  it('network failures become an explanation, not "Failed to fetch"', () => {
    expect(toMessage(new TypeError('Failed to fetch'))).toBe(
      "Couldn't reach the server. Check your connection and try again.",
    );
    expect(toMessage(new Error('NetworkError when attempting to fetch resource.'))).toContain(
      "Couldn't reach the server",
    );
  });

  it('server-provided messages pass through untouched', () => {
    expect(toMessage(new Error('Invalid email or password.'))).toBe('Invalid email or password.');
    expect(toMessage('plain string')).toBe('plain string');
    expect(toMessage(undefined)).toBe('Something went wrong.');
  });
});

describe('W1 — material display names, never raw ids', () => {
  it('craft availability reports labels in the missing list', () => {
    const check = canStartCraft('recipe_medkit', {}, {}, 10);
    expect(check.can).toBe(false);
    expect(check.missing.join(' ')).toContain('Scrap: 0/40'); // Med Kit's leg, repriced 15 -> 40 by tuning T3
    // Raw ids never print: the second entry is the display name
    // ("Reactive Components"), not the camel-case id. (Scrap's
    // display name IS "Scrap" post-merge — id and label coincide.)
    expect(check.missing.join(' ')).not.toContain('ReactiveComponents:');
  });
});

describe('render fixes (source shape)', () => {
  it('X1/D3/X4 — the Strip: counts never truncate, scrap is "scrap", level is not duplicated', () => {
    const bar = read('../components/layout/ResourceBar.tsx');
    // Drift-fix F1 superseded the r2 chip grid with DESIGN.md §1's
    // Strip: ONE row, icon + value per resource. The X1 intent is
    // unchanged and stronger here — the fragment count rides the
    // key value as a micro on the same baseline (never on a slanted
    // corner that can clip it, the original DISP-01 defect), every
    // segment names its resource and its micro's meaning in its
    // aria-label, values never truncate, and the row scrolls
    // rather than shrinks (scroll-don't-shrink). Audit UX-04's
    // profile-loaded skeleton carries the same one-row geometry.
    expect(bar).toContain('label="Scrap"');
    expect(bar).not.toContain('sub="bench"');
    expect(bar).not.toContain('LV ${player.level}');
    expect(bar).toContain('resource-bar-strip');
    expect(bar).toContain('overflow-x-auto');
    expect(bar).not.toContain('grid-cols-3');
    // 0082: the keys chip carries NO fragment micro — fragments are
    // abolished and the key count stands alone.
    expect(bar).not.toContain('cacheKeyFragments');
    expect(bar).not.toContain('of 5 fragments');
    expect(bar).toContain('micro={`${equippedCount}/7`}');
    expect(bar).toContain('of 7 gear slots equipped');
    expect(bar).toContain('resource-bar-loading');
    expect(bar).not.toContain('flex-[1.35]');
  });

  it('M1 — market empty state waits for loading to finish (and yields to the X-07 error state)', () => {
    const market = read('../screens/MarketScreen.tsx');
    expect(market).toContain('!loadingListings && !buyError && filteredListings.length === 0');
  });

  it('P1 — profile handle actions are null-account safe', () => {
    const profile = read('../screens/ProfileScreen.tsx');
    expect(profile).not.toContain('{!account.isAnonymous && (');
    // Register B (2026-11-05): the handle actions moved into the
    // telemetry record; the null-account guard rides both props.
    expect(profile).toContain('canRename={!!account && !account.isAnonymous}');
    expect(profile).toContain('canSetUsername={!!account && !account.isAnonymous}');
  });

  it('X4 — dev copy is gone from player surfaces', () => {
    expect(read('../screens/HomeScreen.tsx')).not.toContain('XP Chalk Mark');
    expect(read('../components/dashboard/DashboardDeck.tsx')).not.toContain('XP Chalk Mark');
    expect(read('../screens/WorkshopScreen.tsx')).not.toContain('Craft dispatch briefly claims');
    expect(read('../components/dashboard/LiveTurfDiorama.tsx')).not.toContain('runner parked at camp');
  });

  it('W1/W2 — workshop costs use labels and honest colors', () => {
    const workshop = read('../screens/WorkshopScreen.tsx');
    // Both cost surfaces (job-card "eats" line + recipe escrow rows)
    // render material LABELS, never raw ids (0024 screen rewrite:
    // the loop variable is `key` in both places now).
    const labelUses = workshop.match(/getVisualAsset\('material', \w+\)\.label/g) ?? [];
    expect(labelUses.length).toBeGreaterThanOrEqual(2);
    expect(workshop).not.toContain("${hasEnough ? colorClass : 'text-red-400 line-through'}");
  });
});
