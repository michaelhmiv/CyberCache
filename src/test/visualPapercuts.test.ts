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
    expect(check.missing.join(' ')).toContain('Scrap Alloy: 0/15');
    expect(check.missing.join(' ')).not.toContain('ScrapAlloy');
  });
});

describe('render fixes (source shape)', () => {
  it('X1/D3/X4 — resource bar: key fragments never truncate, scrap is "scrap", level is not duplicated', () => {
    const bar = read('../components/layout/ResourceBar.tsx');
    // Device feedback r2 superseded the audit-X1 "wide key chip" hack:
    // the bar is now a 3-across grid at phone width (6-across from
    // 560dp) with stacked chips, and the key chip's fragment count is
    // a right-aligned micro — same intent (the fragment count is
    // always fully visible), stronger contract. Audit DISP-01 moved
    // that micro onto the value line as a labeled stack (fraction
    // over its unit name), off the slanted top-right corner that
    // clipped it; audit UX-04 added the profile-loaded skeleton.
    expect(bar).toContain('label="Scrap"');
    expect(bar).not.toContain('sub="bench"');
    expect(bar).toContain('label="Level"');
    expect(bar).not.toContain('LV ${player.level}');
    expect(bar).toContain('grid grid-cols-3');
    expect(bar).toContain('min-[560px]:grid-cols-6');
    expect(bar).toContain('micro={`${player.cacheKeyFragments}/5`}');
    expect(bar).toContain('microUnit="frag"');
    expect(bar).toContain('microUnit="equipped"');
    expect(bar).toContain('resource-bar-loading');
    expect(bar).not.toContain('flex-[1.35]');
  });

  it('M1 — market empty state waits for loading to finish', () => {
    const market = read('../screens/MarketScreen.tsx');
    expect(market).toContain('!loadingListings && filteredListings.length === 0');
  });

  it('P1 — profile handle actions are null-account safe', () => {
    const profile = read('../screens/ProfileScreen.tsx');
    expect(profile).not.toContain('{!account.isAnonymous && (');
    expect(profile).toContain('{account && !account.isAnonymous && (');
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
