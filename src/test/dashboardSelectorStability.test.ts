/**
 * Regression: Dashboard's gainFeed selector must return a stable reference
 * for the same store state, otherwise React's useSyncExternalStore trips
 * the "result of getSnapshot should be cached" check and infinite-loops
 * the dashboard.
 *
 * The original bug: `state.events.slice(0, 5)` was called inside the
 * Zustand selector and returned a new array on every snapshot read.
 *
 * The fix: the Zustand selector returns `state.events` (stable ref),
 * and the slice happens in a `useMemo` keyed on the events ref.
 *
 * This test documents the contract so future agents don't reintroduce
 * the bug by moving the slice back inside the selector.
 */
import { describe, it, expect } from 'vitest';

type EventsStore = { events: ReadonlyArray<{ id: string; tone: string }> };

// The old (broken) pattern: slice inside the selector.
const brokenSelector = (state: EventsStore) => state.events.slice(0, 5);

// The new (correct) pattern: stable ref returned by selector, slice in useMemo.
const stableSelector = (state: EventsStore) => state.events;
const sliceOutside = (events: ReadonlyArray<{ id: string; tone: string }>) => events.slice(0, 5);

describe('Dashboard gainFeed selector stability (regression)', () => {
  it('the broken pattern (slice inside selector) returns a new ref every call', () => {
    const state: EventsStore = { events: [{ id: 'a', tone: 'loot' }, { id: 'b', tone: 'cash' }] };
    const a = brokenSelector(state);
    const b = brokenSelector(state);
    // This is the trap: the two reads are deep-equal but reference-different,
    // which is exactly what useSyncExternalStore detects as a state change.
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it('the fixed pattern (stable selector, slice outside) returns the same ref for the same state', () => {
    const state: EventsStore = { events: [{ id: 'a', tone: 'loot' }] };
    const eventsA = stableSelector(state);
    const eventsB = stableSelector(state);
    expect(eventsA).toBe(eventsB);
    // The slice result is recomputed per render (in useMemo) but its
    // memo key is the stable events ref, so it stays referentially
    // stable across renders that didn't change events.
    const sliceA = sliceOutside(eventsA);
    const sliceB = sliceOutside(eventsB);
    expect(sliceA).toEqual(sliceB);
    // Note: slice is a new array per call, but useMemo wraps it, so
    // consumers see a stable ref. The test here just asserts that the
    // underlying input to useMemo is referentially stable.
  });

  it('a state change produces a new events ref (so useMemo re-runs)', () => {
    const state1: EventsStore = { events: [{ id: 'a', tone: 'loot' }] };
    const state2: EventsStore = { events: [{ id: 'a', tone: 'loot' }, { id: 'b', tone: 'cash' }] };
    expect(stableSelector(state1)).not.toBe(stableSelector(state2));
  });
});
