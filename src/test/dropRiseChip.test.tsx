import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { DropRiseIcon, DropRiseMasterIcon } from '@/components/dashboard/LiveTurfDiorama';
import { tintedDropRiseCanvas } from '@/lib/pixel/iconTint';

vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

vi.mock('@/lib/pixel/iconTint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pixel/iconTint')>();
  return { ...actual, tintedDropRiseCanvas: vi.fn() };
});

/**
 * Fix round 1 (2026-11-13) — the owner rejected the R2 material
 * drop: "I still don't see the actual item being dropped." Three
 * presentation defects compounded: the chip's label was a 4-letter
 * truncation ("TECH"), the retinted master canvas painted only if
 * the master had decoded before the component's single attempt
 * (one 60 ms re-render that never re-ran the draw), and the chip
 * held inside the enemy name plate's box. These tests pin the two
 * code-level halves: the chip names the drop in full, and the
 * master icon keeps attempting the draw until the tint exists.
 * (The plate-clearance half is geometric — it is pinned by the
 * round-fix1 capture dumps, tracks/r2/round-fix1/.)
 */
describe('DropRiseIcon — the chip names the drop', () => {
  it('shows the full material label, quantity and all', () => {
    const { container } = render(<DropRiseIcon tone="material" label="+1 TechFragments" />);
    expect(container.textContent).toContain('+1 TechFragments');
    expect(container.textContent).not.toBe('TECH');
  });

  it('shows the full fragment label instead of "FRAG"', () => {
    const { container } = render(<DropRiseIcon tone="fragment" label="+1 Cache Shard" />);
    expect(container.textContent).toContain('+1 Cache Shard');
    expect(container.textContent).not.toContain('FRAG');
  });

  it('shows the full essence label', () => {
    const { container } = render(<DropRiseIcon tone="essence" label="+1 Ember Essence" />);
    expect(container.textContent).toContain('+1 Ember Essence');
  });

  it('keeps cash rises icon-only (a payout is not an item)', () => {
    const { container } = render(<DropRiseIcon tone="cash" label="+150" />);
    expect(container.textContent ?? '').not.toContain('+150');
  });
});

describe('DropRiseMasterIcon — the icon keeps trying until the tint exists', () => {
  const mockedTint = vi.mocked(tintedDropRiseCanvas);

  beforeEach(() => {
    vi.useFakeTimers();
    mockedTint.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-attempts the draw until the tinted canvas lands, then stops', () => {
    const painted = document.createElement('canvas');
    painted.width = 60;
    painted.height = 60;
    mockedTint
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(null)
      .mockReturnValue(painted);
    render(<DropRiseMasterIcon kind="material" base="#9C27B0" />);
    expect(mockedTint).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(mockedTint).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(mockedTint).toHaveBeenCalledTimes(3);
    // Success reached: the poll is done — no further attempts.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockedTint).toHaveBeenCalledTimes(3);
  });

  it('stops polling on unmount', () => {
    mockedTint.mockReturnValue(null);
    const { unmount } = render(<DropRiseMasterIcon kind="material" base="#9C27B0" />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const callsWhileMounted = mockedTint.mock.calls.length;
    expect(callsWhileMounted).toBeGreaterThan(1);
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(mockedTint).toHaveBeenCalledTimes(callsWhileMounted);
  });
});
