import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';

// Match src/test/lootVisualHonesty.test.tsx's canvas-adjacent mock.
vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

describe('DropRiseIcon — the chip names what dropped', () => {
  it('prints the full material label with quantity', () => {
    const { container } = render(<DropRiseIcon tone="material" label="+1 TechFragments" />);
    expect(container.textContent).toContain('+1 TechFragments');
  });

  it('prints the full fragment label with quantity', () => {
    const { container } = render(<DropRiseIcon tone="fragment" label="+1 Cache Shard" />);
    expect(container.textContent).toContain('+1 Cache Shard');
  });

  it('prints the full essence label with quantity', () => {
    const { container } = render(<DropRiseIcon tone="essence" label="+1 Ember Essence" />);
    expect(container.textContent).toContain('+1 Ember Essence');
  });

  it('cash rises stay icon-only (a payout is not an item)', () => {
    const { container } = render(<DropRiseIcon tone="cash" label="scrap" />);
    expect(container.textContent).not.toContain('scrap');
  });
});
