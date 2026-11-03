import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DropSource, Rarity } from '@/types/game';
import type { Relic } from '@/types/items';
import { GearIllustration } from '@/components/gearArt/GearIllustration';
import { composeGear } from '@/lib/pixel/gearCardCompositor';
import { relicGrammar, relicInputFromItem } from '@/lib/pixel/relicGrammar';

/**
 * Gear marriage, slice 4 — the dispatcher flip, end to end.
 *
 * A relic through GearIllustration now renders a canvas carrying
 * the relic grammar's core signature (never its old SVG), at card
 * density for named sizes and thumb density for small numeric
 * sizes — the same signature every other surface computes for the
 * same record.
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
  it('a relic renders a canvas with the grammar signature, not an SVG', () => {
    const { container } = render(<GearIllustration item={token} size="card" showBadges={false} />);
    expect(container.querySelector('svg')).toBeNull();
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const expected = composeGear(relicInputFromItem(token), relicGrammar, 'card');
    expect(canvas!.dataset.signature).toBe(expected.signature);
    expect(canvas!.dataset.density).toBe('card');
  });

  it('a small numeric size renders the thumb density signature', () => {
    const { container } = render(<GearIllustration item={token} size={44} showBadges={false} />);
    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    const expected = composeGear(relicInputFromItem(token), relicGrammar, 'thumb');
    expect(canvas!.dataset.signature).toBe(expected.signature);
    expect(canvas!.dataset.density).toBe('thumb');
  });
});
