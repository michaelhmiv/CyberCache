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
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('Collect dismisses the reveal for the rest of the session', () => {
    useInitialBundleRevealStore.getState().show({
      credits: 5000,
      scrap: 500,
      cacheKeys: 3,
      vehicleName: 'Scrap Bike',
    });
    render(<StarterBundleReveal />);
    fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    expect(screen.queryByText('Loot Secured')).toBeNull();
    expect(useInitialBundleRevealStore.getState().grant).toBeNull();
  });
});
