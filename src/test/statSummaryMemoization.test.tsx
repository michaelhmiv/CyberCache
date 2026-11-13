import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { usePlayerStore, useSurvivalStore, useInventoryStore } from '@/store';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('summary invalidation', () => {
  it('keeps the same summary across clock ticks, credit changes, HP hits and unrelated loot', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() => useCharacterStatSummary());
    const original = result.current;
    act(() => vi.advanceTimersByTime(3000));
    act(() => usePlayerStore.setState({ credits: usePlayerStore.getState().credits + 1 }));
    act(() => useSurvivalStore.setState({ currentHp: 10 }));
    act(() => useInventoryStore.setState({ items: [...useInventoryStore.getState().items] }));
    rerender();
    expect(result.current).toBe(original);
    act(() => usePlayerStore.setState({ level: usePlayerStore.getState().level + 1 }));
    expect(result.current).not.toBe(original);
  });
});
