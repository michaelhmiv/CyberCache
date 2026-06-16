/**
 * Tests for ActionTickTimer — the per-second display clock for the active run.
 *
 * Goal: verify the component owns its own 1-second interval so the parent
 * screen does not have to re-render every second to update the time string.
 * This is the contract that prevents the vertical reflow the layout-thrash
 * bug was caused by.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import React from 'react';
import { ActionTickTimer } from '@/components/action/ActionTickTimer';

describe('ActionTickTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows "paused" when disabled', () => {
    const { getByTestId } = render(<ActionTickTimer tickSeconds={3} enabled={false} />);
    expect(getByTestId('action-tick-timer').textContent).toBe('paused');
  });

  it('advances once per second when enabled', () => {
    const { getByTestId } = render(<ActionTickTimer tickSeconds={3} enabled />);
    expect(getByTestId('action-tick-timer').textContent).toBe('0m 0s');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(getByTestId('action-tick-timer').textContent).toBe('0m 3s');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(getByTestId('action-tick-timer').textContent).toBe('0m 6s');
  });

  it('rolls over to minutes correctly', () => {
    const { getByTestId } = render(<ActionTickTimer tickSeconds={3} enabled />);
    // 20 ticks × 3s = 60s = 1m 0s
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(getByTestId('action-tick-timer').textContent).toBe('1m 0s');
    // 21 ticks × 3s = 63s = 1m 3s
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(getByTestId('action-tick-timer').textContent).toBe('1m 3s');
  });

  it('freezes and shows "paused" when enabled flips to false', () => {
    const { getByTestId, rerender } = render(<ActionTickTimer tickSeconds={3} enabled />);
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(getByTestId('action-tick-timer').textContent).toBe('0m 9s');
    rerender(<ActionTickTimer tickSeconds={3} enabled={false} />);
    expect(getByTestId('action-tick-timer').textContent).toBe('paused');
    act(() => { vi.advanceTimersByTime(5_000); });
    // Still "paused" — the interval was torn down on disable.
    expect(getByTestId('action-tick-timer').textContent).toBe('paused');
  });

  it('locks its rendered width so the parent row does not jiggle on digit count changes', () => {
    const { getByTestId } = render(<ActionTickTimer tickSeconds={3} enabled />);
    const style = getByTestId('action-tick-timer').getAttribute('style') ?? '';
    expect(style).toMatch(/min-width/);
  });
});
