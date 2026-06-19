import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DashboardScreen } from '@/screens/DashboardScreen';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useActivityStore } from '@/store/slices/activitySlice';
import { useBossStore } from '@/store/slices/bossSlice';
import { IDLE_ACTIVITY } from '@/types/activity';

describe('Dashboard Hunter Totals panel — Sources button', () => {
  beforeEach(() => {
    // Reset relevant stores to a minimal valid state.
    // Shapes here mirror the real `PlayerProfile`, `LoadoutState`,
    // `InventoryState`, `ActiveActivity`, and `BossState` so that
    // `DashboardScreen` can mount without throwing.
    useLoadoutStore.setState({
      slots: { primary: null, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null },
      consumables: { PreFight: null, MidFight: null, Emergency: null },
    });
    usePlayerStore.setState({
      id: 'test',
      name: 'tester',
      level: 5,
      xp: 0,
      credits: 0,
      scrap: 0,
      cacheKeys: 0,
      cacheKeyFragments: 0,
      currentZoneId: 'dustwaste_1',
      highestZoneId: 'dustwaste_1',
      offlineCapHours: 2,
      lastClaimTime: 0,
      deathFeeInsurance: false,
      consumables: {},
      consumableBatches: [],
      materials: {},
      essences: {},
      workshopQueues: [],
      lastWorkshopTick: 0,
      lastClaimedTick: 0,
    });
    useInventoryStore.setState({ items: [] });
    useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
    useBossStore.setState({ currentBossId: null, defeatedBossIds: [] });
  });

  it('renders a Sources button in the Hunter Totals panel header', () => {
    render(<DashboardScreen onNavigate={() => {}} />);
    expect(screen.getByTestId('hunter-totals-sources-button')).toBeInTheDocument();
  });

  it('opens the source breakdown modal when the Sources button is tapped', () => {
    render(<DashboardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('hunter-totals-sources-button'));
    expect(screen.getByTestId('hunter-totals-breakdown-modal')).toBeInTheDocument();
  });

  it('closes the modal when the X button is tapped', () => {
    render(<DashboardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('hunter-totals-sources-button'));
    fireEvent.click(screen.getByLabelText('Close source breakdown'));
    expect(screen.queryByTestId('hunter-totals-breakdown-modal')).toBeNull();
  });

  it('passes player consumable inventory into the source breakdown', () => {
    usePlayerStore.setState((state) => ({
      ...state,
      consumables: { MedKit: 12 },
    }));

    render(<DashboardScreen onNavigate={() => {}} />);
    fireEvent.click(screen.getByTestId('hunter-totals-sources-button'));

    expect(screen.getAllByText('Med Kit ×12').length).toBeGreaterThan(0);
    expect(screen.getAllByText('1,800').length).toBeGreaterThan(0);
  });
});
