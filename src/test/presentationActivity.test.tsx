import React from 'react';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { useNow } from '@/hooks/useNow';
import { usePresentationActive, useStageVisible } from '@/hooks/usePresentationActive';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('kept-alive presentation activity', () => {
  it('shares one clock and releases it when the pane is hidden, then resumes at current time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const renders = vi.fn();
    function Clocks() {
      const first = useNow();
      const second = useNow();
      renders();
      return <output>{first}:{second}</output>;
    }
    const view = render(<ScreenWrapper><Clocks /></ScreenWrapper>);
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole('status')).toHaveTextContent('11000:11000');
    view.rerender(<ScreenWrapper hidden><Clocks /></ScreenWrapper>);
    expect(vi.getTimerCount()).toBe(0);
    const hiddenRenders = renders.mock.calls.length;
    act(() => vi.advanceTimersByTime(5000));
    expect(renders).toHaveBeenCalledTimes(hiddenRenders);
    view.rerender(<ScreenWrapper><Clocks /></ScreenWrapper>);
    expect(screen.getByRole('status')).toHaveTextContent('16000:16000');
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('suspends presentation when the browser backgrounds, independently of the pane', () => {
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const { result } = renderHook(usePresentationActive);
    expect(result.current).toBe(true);
    act(() => { hidden.mockReturnValue(true); document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current).toBe(false);
    act(() => { hidden.mockReturnValue(false); document.dispatchEvent(new Event('visibilitychange')); });
    expect(result.current).toBe(true);
  });

  it('suspends offscreen stages and disconnects the observer on unmount', () => {
    let notify: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', vi.fn(function (callback: IntersectionObserverCallback) {
      notify = callback;
      return { observe: vi.fn(), disconnect };
    }));
    function Stage() {
      const ref = React.useRef<HTMLElement | null>(null);
      const active = useStageVisible(ref);
      return <section ref={ref}><output>{String(active)}</output></section>;
    }
    const view = render(<Stage />);
    act(() => notify([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole('status')).toHaveTextContent('false');
    act(() => notify([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole('status')).toHaveTextContent('true');
    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
