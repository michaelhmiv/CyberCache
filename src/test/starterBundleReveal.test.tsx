/**
 * Starter bundle reveal (audit FR-02): the initial bundle used to
 * land silently — balances changed between glances and nothing ever
 * announced the starter stake. The reveal card renders ONLY from
 * the reveal store, which AuthProvider sets solely in the session
 * whose bootstrap performed the grant (already-granted accounts and
 * reloads never populate it), and it itemizes exactly what the
 * parsed grant carries.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StarterBundleReveal } from '@/components/activity/StarterBundleReveal';
import { useInitialBundleRevealStore } from '@/store/slices/initialBundleRevealSlice';

describe('StarterBundleReveal', () => {
  beforeEach(() => {
    useInitialBundleRevealStore.getState().reset();
  });

  it('renders nothing when no fresh grant happened this session', () => {
    render(<StarterBundleReveal />);
    expect(screen.queryByText('Loot Secured')).toBeNull();
  });

  it('itemizes the grant: credits, scrap, keys, and the starter vehicle', () => {
    useInitialBundleRevealStore.getState().show({
      credits: 5000,
      scrap: 500,
      cacheKeys: 3,
      vehicleName: 'Scrap Bike',
    });
    render(<StarterBundleReveal />);
    expect(screen.getByText('Loot Secured')).toBeInTheDocument();
    expect(screen.getByText('+5,000')).toBeInTheDocument();
    expect(screen.getByText('+500')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('Scrap Bike')).toBeInTheDocument();
  });

  it('omits rows the grant did not carry (no vehicle row without a vehicle)', () => {
    useInitialBundleRevealStore.getState().show({
      credits: 5000,
      scrap: 500,
      cacheKeys: 3,
      vehicleName: null,
    });
    render(<StarterBundleReveal />);
    expect(screen.getByText('Loot Secured')).toBeInTheDocument();
    expect(screen.queryByText(/Vehicle/)).toBeNull();
  });

  it('Collect dismisses the reveal for the rest of the session', async () => {
    useInitialBundleRevealStore.getState().show({
      credits: 5000,
      scrap: 500,
      cacheKeys: 3,
      vehicleName: 'Scrap Bike',
    });
    const first = render(<StarterBundleReveal />);
    fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    // Session-dismiss semantics live in the store: Collect clears the
    // grant synchronously, and the store is the only thing that can
    // populate the card — nothing in the session can bring it back.
    expect(useInitialBundleRevealStore.getState().grant).toBeNull();
    // The card itself leaves through its exit fade (AnimatePresence
    // keeps it mounted until the exit completes — C1-12 made the exit
    // actually play), so removal is awaited, not synchronous.
    await waitFor(() => expect(screen.queryByText('Loot Secured')).toBeNull());
    // A fresh mount later in the same session still shows nothing.
    first.unmount();
    render(<StarterBundleReveal />);
    expect(screen.queryByText('Loot Secured')).toBeNull();
  });
});
