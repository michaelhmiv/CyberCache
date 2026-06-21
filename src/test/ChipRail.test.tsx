import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChipRail } from '@/components/common/ChipRail';

describe('ChipRail', () => {
  let originalIntersectionObserver: typeof globalThis.IntersectionObserver | undefined;
  let mockObserverInstance: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };

  function createMockObserver(callback: IntersectionObserverCallback) {
    mockObserverInstance = {
      observe: vi.fn(() => {
        callback([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
      }),
      disconnect: vi.fn(),
    };
    return mockObserverInstance;
  }

  beforeEach(() => {
    originalIntersectionObserver = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = vi.fn(function (this: IntersectionObserver, callback: IntersectionObserverCallback) {
      return createMockObserver(callback);
    }) as unknown as typeof IntersectionObserver;
  });

  afterEach(() => {
    if (originalIntersectionObserver) {
      globalThis.IntersectionObserver = originalIntersectionObserver;
    }
  });

  it('renders children', () => {
    render(
      <ChipRail>
        <span data-testid="chip">A</span>
      </ChipRail>,
    );
    expect(screen.getByTestId('chip')).toBeInTheDocument();
  });

  it('shows overflow indicator when content overflows', () => {
    render(
      <ChipRail>
        <span>Chip</span>
      </ChipRail>,
    );
    expect(screen.getByText('›')).toBeInTheDocument();
  });
});
