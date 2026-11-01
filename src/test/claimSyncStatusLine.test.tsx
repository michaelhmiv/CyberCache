/**
 * ClaimSyncStatusLine — the visible half of the ticker's claim-
 * failure fix. The line renders ONLY while the ticker's syncStalled
 * flag is set (2+ consecutive failed claim cycles) and the player is
 * roaming; it must never appear during healthy play or over other
 * activities, where it would cry wolf about rewards that are not
 * actually paused.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { ClaimSyncStatusLine } from '@/components/action/ClaimSyncStatusLine';
import { useIdleTickerStore } from '@/store/slices/idleTickerSlice';
import { useActivityStore } from '@/store/slices/activitySlice';

const setActivityKind = (kind: string) => {
  useActivityStore.setState({
    current: { ...useActivityStore.getState().current, kind } as never,
  });
};

describe('ClaimSyncStatusLine', () => {
  beforeEach(() => {
    useIdleTickerStore.setState({ syncStalled: false, consecutiveClaimFailures: 0 });
    setActivityKind('roaming_loot');
  });

  it('renders nothing while claims are landing', () => {
    const { queryByTestId } = render(<ClaimSyncStatusLine />);
    expect(queryByTestId('claim-sync-status')).toBeNull();
  });

  it('shows the stall notice while roaming once the ticker flags a stall', () => {
    useIdleTickerStore.setState({ syncStalled: true, consecutiveClaimFailures: 2 });
    const { getByTestId } = render(<ClaimSyncStatusLine />);
    expect(getByTestId('claim-sync-status').textContent).toContain('Connection interrupted');
    expect(getByTestId('claim-sync-status').textContent).toContain('rewards paused');
  });

  it('stays hidden over non-roaming activities even when stalled', () => {
    useIdleTickerStore.setState({ syncStalled: true, consecutiveClaimFailures: 3 });
    setActivityKind('crafting');
    const { queryByTestId } = render(<ClaimSyncStatusLine />);
    expect(queryByTestId('claim-sync-status')).toBeNull();
  });
});
