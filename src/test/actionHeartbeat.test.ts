/**
 * useActionHeartbeat — owner cadence aligned to the 3-second game
 * tick (2026-11-02), with the guards that make the poll safe:
 * in-flight skip, visibility pause, and failure backoff.
 *
 * Foreground resume (owner report, 2026-11-02 — returning from an
 * app switch left the stage sitting stale): the first beat fires
 * IMMEDIATELY on mount instead of a tick later, a return to
 * visibility beats at once instead of waiting out the interval
 * phase, and a resume beat bypasses an armed failure backoff (a
 * resume that itself fails re-arms it). Fake timers throughout
 * (vitest fakes Date too, which the backoff gate reads).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useActionHeartbeat,
  ACTION_HEARTBEAT_INTERVAL_MS,
  ACTION_HEARTBEAT_RETRY_MS,
} from '@/components/activity/useActionHeartbeat';

let hidden = false;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function setHidden(next: boolean) {
  hidden = next;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('useActionHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    hidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('pins the owner cadence at the 3-second game tick', () => {
    expect(ACTION_HEARTBEAT_INTERVAL_MS).toBe(3000);
    expect(ACTION_HEARTBEAT_RETRY_MS).toBe(5000);
  });

  it('beats immediately on mount, then once per game tick while enabled', async () => {
    const heartbeat = vi.fn(async () => {});
    renderHook(() => useActionHeartbeat(true, heartbeat));
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await advance(9000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it('sends nothing while disabled, and starts when enabled', async () => {
    const heartbeat = vi.fn(async () => {});
    const { rerender } = renderHook(({ enabled }) => useActionHeartbeat(enabled, heartbeat), {
      initialProps: { enabled: false },
    });
    await advance(5000);
    expect(heartbeat).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await advance(9000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it('skips beats while a heartbeat is in flight — never stacks', async () => {
    let release: (() => void) | undefined;
    const heartbeat = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    renderHook(() => useActionHeartbeat(true, heartbeat));
    await advance(9000);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    release?.();
    await advance(6000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });

  it('pauses while the document is hidden and resumes on return', async () => {
    const heartbeat = vi.fn(async () => {});
    renderHook(() => useActionHeartbeat(true, heartbeat));
    await advance(6000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    hidden = true;
    await advance(9000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    hidden = false;
    await advance(6000);
    expect(heartbeat).toHaveBeenCalledTimes(5);
  });

  it('beats immediately on return to visible, mid-interval', async () => {
    const heartbeat = vi.fn(async () => {});
    renderHook(() => useActionHeartbeat(true, heartbeat));
    await advance(3000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    await setHidden(true);
    await advance(6000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    // The return beats at once — no timer advance needed.
    await setHidden(false);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    // And the tick cadence continues from there.
    await advance(6000);
    expect(heartbeat).toHaveBeenCalledTimes(5);
  });

  it('a return to visible bypasses an armed failure backoff', async () => {
    const heartbeat = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValue(undefined);
    renderHook(() => useActionHeartbeat(true, heartbeat));
    // Mount beat fails at t=0; backoff is armed until t=5000.
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await setHidden(true);
    await advance(1000);
    // Back with 4s of backoff still armed: the resume beat fires anyway.
    await setHidden(false);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    // Its success restores the plain tick cadence.
    await advance(6000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it('a resume does not stack onto an in-flight beat', async () => {
    let release: (() => void) | undefined;
    const heartbeat = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined);
    renderHook(() => useActionHeartbeat(true, heartbeat));
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    await setHidden(true);
    await setHidden(false);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    release?.();
    await advance(3000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
  });

  it('backs off after a failure and restores the tick cadence on success', async () => {
    const heartbeat = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('server down'))
      .mockResolvedValue(undefined);
    renderHook(() => useActionHeartbeat(true, heartbeat));
    await advance(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    // Inside the 5s backoff window: the next tick's beat is gated.
    await advance(3000);
    expect(heartbeat).toHaveBeenCalledTimes(1);
    // Backoff elapses: the retry fires and succeeds.
    await advance(3000);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    // Success restores the 3s tick cadence.
    await advance(6000);
    expect(heartbeat).toHaveBeenCalledTimes(4);
  });

  it('stops beating after unmount', async () => {
    const heartbeat = vi.fn(async () => {});
    const { unmount } = renderHook(() => useActionHeartbeat(true, heartbeat));
    await advance(6000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    unmount();
    await advance(9000);
    expect(heartbeat).toHaveBeenCalledTimes(3);
    // Resume signals after unmount reach no listener.
    await setHidden(true);
    await setHidden(false);
    expect(heartbeat).toHaveBeenCalledTimes(3);
  });
});
