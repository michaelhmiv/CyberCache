import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DropSource, Rarity } from '@/types/game';
import type { Relic } from '@/types/items';
import { GearIllustration } from '@/components/gearArt/GearIllustration';

/**
 * Gear marriage, slice 4 — the dispatcher flip, end to end.
 *
 * A relic through GearIllustration renders its pixel plate (never
 * its old SVG) — since Top-Choice INT-2 (2026-11-11) that plate is
 * the relic's adopted Wave 4 painting, resolved by NAME (a relic's
 * name is its form): the render mounts the painting carrying the
 * sprite identity, at every size — one render signature per item,
 * the same painting on every surface. The mounted node is the
 * placeholder canvas while bytes decode, or the resolved <img>
 * when the master's own colors serve as-is (relics carry no
 * colorway swap, so jsdom settles straight onto the <img>); both
 * nodes carry data-painted-sprite / data-painted-form.
 */

const token: Relic = {
  id: 'rec-glitched-legendary',
  name: 'Glitched Token',
  level: 40,
  rarity: Rarity.Legendary,
  affixes: [
    { id: 'a1', category: 'combat', stat: 'luck', value: 5, displayText: '+5 Luck' },
    { id: 'a2', category: 'combat', stat: 'luck', value: 4, displayText: '+4 Luck' },
  ],
  sourceTag: DropSource.BossDrop,
  isLocked: false,
};

describe('GearIllustration — relics render pixel (slice 4 flip)', () => {
  it('a relic renders its adopted painting, not an SVG', () => {
    const { container } = render(<GearIllustration item={token} size="card" showBadges={false} />);
    expect(container.querySelector('svg')).toBeNull();
    const painted = container.querySelector<HTMLElement>('[data-painted-sprite]');
    expect(painted).not.toBeNull();
    expect(painted!.dataset.paintedSprite).toBe('gear-relic-glitched-token');
    expect(painted!.dataset.paintedForm).toBe('glitched-token');
  });

  it('a small numeric size renders the same painting', () => {
    const { container } = render(<GearIllustration item={token} size={44} showBadges={false} />);
    const painted = container.querySelector<HTMLElement>('[data-painted-sprite]');
    expect(painted).not.toBeNull();
    expect(painted!.dataset.paintedSprite).toBe('gear-relic-glitched-token');
  });

  it('an off-pool relic name renders no plate instead of crashing the surface', () => {
    // The derivation itself throws (pinned in relicGrammar.test.ts —
    // pool drift is a suite failure), but the render seam degrades:
    // no canvas, no SVG, no exception. A cosmetic layer never takes
    // down a screen over a record it has no truthful art for.
    const alien: Relic = { ...token, id: 'rec-alien', name: 'Odd Relic' };
    const { container } = render(<GearIllustration item={alien} size="card" showBadges={false} />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-painted-sprite]')).toBeNull();
  });
});
