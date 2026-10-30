/**
 * Visual-audit papercuts (2026-10-29 audit, fixed in the tune-up pass).
 * Behavioral checks where the logic is testable; source-shape checks
 * (the repo's established pattern) for pure-render fixes.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { toMessage } from '../auth/AuthProvider';
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
  it('X1/D3/X4 — resource bar: key chip is wide, scrap is "scrap", level is not duplicated', () => {
    const bar = read('../components/layout/ResourceBar.tsx');
    expect(bar).toContain('sub="scrap"');
    expect(bar).not.toContain('sub="bench"');
    expect(bar).toContain('sub="level"');
    expect(bar).not.toContain('sub={`LV ${player.level}`}');
    expect(bar).toContain('wide');
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
    expect(read('../screens/DashboardScreen.tsx')).not.toContain('XP Chalk Mark');
    expect(read('../screens/WorkshopScreen.tsx')).not.toContain('Craft dispatch briefly claims');
    expect(read('../components/dashboard/LiveTurfDiorama.tsx')).not.toContain('runner parked at camp');
  });

  it('W1/W2 — workshop costs use labels and honest colors', () => {
    const workshop = read('../screens/WorkshopScreen.tsx');
    expect(workshop).toContain("getVisualAsset('material', k).label");
    expect(workshop).toContain("getVisualAsset('material', key).label");
    expect(workshop).not.toContain("${hasEnough ? colorClass : 'text-red-400 line-through'}");
  });
});
