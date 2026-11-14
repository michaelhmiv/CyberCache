/**
 * Gear first-open warming (audit #569):
 * - The Gear pane's first build (lazy chunk + heaviest first render
 *   in the app) must be paid during idle time after the shell is up,
 *   not on the player's first tap — that tap lands mid-roam, behind
 *   the stage's startup storm, and the deferred build starved
 *   (>9 s in CI e2e; warm switches are ~0.1 s).
 * - useIdleWarmOnce is the scheduler: fires once, in idle time,
 *   with a timer fallback where requestIdleCallback is missing,
 *   and cancels cleanly if the shell goes away first.
 * - The App shell source-pins the wiring: Gear warms into
 *   visitedTabs (the keep-alive mount list) once signed in.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useIdleWarmOnce } from '@/hooks/useIdleWarmOnce';

const readSource = (rel: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', rel), 'utf8');

interface IdleStub {
  callbacks: Map<number, (d: { didTimeout: boolean; timeRemaining: () => number }) => void>;
  nextId: number;
}

function stubIdleCallback(): IdleStub {
  const stub: IdleStub = { callbacks: new Map(), nextId: 1 };
  (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = (
    cb: IdleStub['callbacks'] extends Map<number, infer T> ? T : never,
  ) => {
    const id = stub.nextId++;
    stub.callbacks.set(id, cb as never);
    return id;
  };
  (window as unknown as { cancelIdleCallback: unknown }).cancelIdleCallback = (id: number) => {
    stub.callbacks.delete(id);
  };
  return stub;
}

function dropIdleCallback() {
  delete (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
  delete (window as unknown as { cancelIdleCallback?: unknown }).cancelIdleCallback;
}

afterEach(() => {
  dropIdleCallback();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useIdleWarmOnce', () => {
  it('does not fire synchronously; fires when the idle callback runs', () => {
    const stub = stubIdleCallback();
    const warm = vi.fn();
    renderHook(() => useIdleWarmOnce(true, warm));
    expect(warm).not.toHaveBeenCalled();
    expect(stub.callbacks.size).toBe(1);
    const [cb] = [...stub.callbacks.values()];
    act(() => cb({ didTimeout: false, timeRemaining: () => 10 }));
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('passes a bounded timeout to requestIdleCallback so a busy thread still warms', () => {
    let seenOpts: { timeout: number } | undefined;
    (window as unknown as { requestIdleCallback: unknown }).requestIdleCallback = (
      _cb: unknown,
      opts?: { timeout: number },
    ) => {
      seenOpts = opts;
      return 1;
    };
    renderHook(() => useIdleWarmOnce(true, vi.fn()));
    expect(seenOpts?.timeout).toBeGreaterThan(0);
    expect(seenOpts?.timeout).toBeLessThanOrEqual(5000);
  });

  it('falls back to a timer when requestIdleCallback is unavailable', () => {
    dropIdleCallback();
    vi.useFakeTimers();
    const warm = vi.fn();
    renderHook(() => useIdleWarmOnce(true, warm));
    expect(warm).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('never fires while disabled; fires after it becomes enabled', () => {
    const stub = stubIdleCallback();
    const warm = vi.fn();
    const { rerender } = renderHook(({ on }) => useIdleWarmOnce(on, warm), {
      initialProps: { on: false },
    });
    expect(stub.callbacks.size).toBe(0);
    rerender({ on: true });
    expect(stub.callbacks.size).toBe(1);
    const [cb] = [...stub.callbacks.values()];
    act(() => cb({ didTimeout: true, timeRemaining: () => 0 }));
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it('cancels the pending warm on unmount', () => {
    const stub = stubIdleCallback();
    const warm = vi.fn();
    const { unmount } = renderHook(() => useIdleWarmOnce(true, warm));
    expect(stub.callbacks.size).toBe(1);
    unmount();
    expect(stub.callbacks.size).toBe(0);
    expect(warm).not.toHaveBeenCalled();
  });

  it('fires exactly once across re-renders and repeat idle ticks', () => {
    const stub = stubIdleCallback();
    const warm = vi.fn();
    const { rerender } = renderHook(() => useIdleWarmOnce(true, warm));
    const [cb] = [...stub.callbacks.values()];
    act(() => cb({ didTimeout: false, timeRemaining: () => 10 }));
    rerender();
    act(() => cb({ didTimeout: false, timeRemaining: () => 10 }));
    expect(warm).toHaveBeenCalledTimes(1);
  });
});

describe('App shell — gear warming source pins', () => {
  const app = readSource('src/App.tsx');

  it('warms the gear pane into the keep-alive mount list once signed in', () => {
    expect(app).toContain("useIdleWarmOnce(!!user && !loading");
    expect(app).toContain("new Set(prev).add('gear')");
  });

  it('the gear screen itself stays a lazy chunk (warming mounts it, never eager-imports it)', () => {
    expect(app).toContain('const InventoryScreen = React.lazy(');
    expect(app).not.toContain("import { InventoryScreen } from");
  });
});
