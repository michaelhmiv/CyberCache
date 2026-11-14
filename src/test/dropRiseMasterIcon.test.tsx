import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { DropRiseMasterIcon } from '@/components/dashboard/LiveTurfDiorama';
import { tintedDropRiseCanvas } from '@/lib/pixel/iconTint';

// Match src/test/dropRiseIcon.test.tsx's canvas-adjacent mock.
vi.mock('@/lib/feedback/sfx', () => ({
  playTone: vi.fn(),
  playSfxEvent: vi.fn(),
  initAudio: vi.fn(),
  setSfxEnabled: vi.fn(),
}));

vi.mock('@/lib/pixel/iconTint', () => ({
  tintedDropRiseCanvas: vi.fn(),
}));

describe('DropRiseMasterIcon — retry repaints once the master decodes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(tintedDropRiseCanvas).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('re-runs the effect via the retry timer and calls tintedDropRiseCanvas again', () => {
    let calls = 0;
    vi.mocked(tintedDropRiseCanvas).mockImplementation(() => {
      calls += 1;
      return calls === 1 ? null : document.createElement('canvas');
    });

    render(<DropRiseMasterIcon kind="material" base="#A06CD5" />);
    expect(tintedDropRiseCanvas).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(vi.mocked(tintedDropRiseCanvas).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
