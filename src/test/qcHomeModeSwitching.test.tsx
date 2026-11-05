/**
 * QC fix B2 — Home mode rail: dead Extract/Craft stops and the
 * un-dismissable Endless panel.
 *
 * The bug: Endless and Extraction open through local panel flags
 * (showEndless / showExtraction) that outrank every real activity
 * in the workspace selection, and NOTHING ever cleared them —
 * opening Endless then tapping Extract set the extraction flag
 * behind the still-raised endless flag (Endless wins the workspace
 * chain), tapping Craft started the crafting activity behind the
 * endless panel, and tapping Roam lit the Roam stop while the
 * Endless panel stayed on screen — the selected stop and the open
 * panel disagreed, and the panel could not be dismissed by any
 * mode control.
 *
 * These flow tests drive the merged Home screen exactly the way
 * the QC playtest did: open one mode from the rail, then choose
 * another, and require the workspace AND the rail's lit stop to
 * follow the latest choice. Harness mirrors homeComposition's —
 * the activity service mock echoes StartActivityInput the way the
 * shipped service contract does.
 *
 * The double is STATEFUL about the held activity (start records
 * the echoed activity; clear resets it; get/heartbeat return what
 * is held), because the foreground-resume slice (2026-11-02) made
 * the Action heartbeat sync IMMEDIATELY when the surface can tick
 * — including the moment a local start flips canTick on. The
 * shipped service answers that beat with the activity it just
 * accepted, never with a stale idle snapshot; a fixed-idle
 * heartbeat double models a server that forgot the start it had
 * just taken, and the beat's answer then reverts the just-started
 * roaming activity before these assertions read the workspace.
 * See PR #315 for the full diagnosis.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1' } as { id: string } | null,
    account: null as unknown,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
  // The activity the service double currently holds (see header):
  // null means "nothing started yet" — the idle standby snapshot.
  heldActivity: null as Record<string, unknown> | null,
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getContractsState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getStandingState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  standingBuy: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  standingOrder: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getEndlessMe: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getExtractionState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getResearchState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/activityService', () => {
  const idle = {
    kind: 'idle_standby', bossPhase: 'prep', startedAt: null, completesAt: null,
    targetType: null, targetId: null, targetLabel: null, sceneKey: null, notes: null,
    activityPayload: {}, publicPayload: {}, lastHeartbeatAt: null,
    publicVisible: true, schemaVersion: 1, updatedAt: null,
  };
  const held = () => hoisted.heldActivity ?? idle;
  return {
    startActiveActivity: vi.fn(async (input: Record<string, unknown>) => {
      const started = {
        ...idle,
        kind: input.kind,
        bossPhase: input.bossPhase ?? 'prep',
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        targetLabel: input.targetLabel ?? null,
        sceneKey: input.sceneKey ?? null,
        notes: input.notes ?? null,
        activityPayload: input.activityPayload ?? {},
        publicPayload: input.publicPayload ?? {},
        publicVisible: input.publicVisible ?? true,
      };
      hoisted.heldActivity = started;
      return started;
    }),
    getMyActiveActivity: vi.fn(async () => held()),
    clearActiveActivity: vi.fn(async () => {
      hoisted.heldActivity = idle;
      return idle;
    }),
    heartbeatActiveActivity: vi.fn(async () => held()),
  };
});

vi.mock('@/lib/notifications/pushNotifications', () => ({
  checkPushPermission: vi.fn(async () => 'prompt'),
  requestPushNotifications: vi.fn(async () => true),
  syncPushRegistration: vi.fn(async () => {}),
}));

import { HomeScreen } from '@/screens/HomeScreen';
import { usePlayerStore } from '@/store';
import { startActiveActivity } from '@/lib/api/activityService';
import { useActivityStore } from '@/store/slices/activitySlice';
import { useIdleStore } from '@/store/slices/idleSlice';
import { useLoginStreakStore } from '@/store/slices/loginStreakSlice';
import { useContractsStore } from '@/store/slices/contractsSlice';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { usePushPrimerStore } from '@/store/slices/pushPrimerSlice';
import { useStandingStore } from '@/store/slices/standingSlice';

beforeEach(() => {
  cleanup();
  localStorage.clear();
  hoisted.heldActivity = null;
  useLoginStreakStore.getState().reset();
  useContractsStore.getState().reset();
  useOfflineRecapStore.getState().reset();
  usePushPrimerStore.getState().reset();
  useStandingStore.getState().reset();
  usePlayerStore.setState({ level: 25, xp: 0, profileLoaded: true });
});

afterEach(() => {
  cleanup();
});

const pressed = (stop: string) =>
  screen.getByTestId(`mode-rail-${stop}`).getAttribute('aria-pressed');

describe('Home mode rail — switching modes replaces the open panel (QC B2)', () => {
  it('Endless → Extract: the extraction workspace replaces the endless panel', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-endless'));
    expect(await screen.findByTestId('endless-panel')).toBeTruthy();
    expect(pressed('endless')).toBe('true');

    fireEvent.click(screen.getByTestId('mode-rail-extract'));
    expect(await screen.findByTestId('extraction-panel')).toBeTruthy();
    expect(screen.queryByTestId('endless-panel')).toBeNull();
    expect(pressed('extract')).toBe('true');
    expect(pressed('endless')).toBe('false');
  });

  it('Extract → Endless: the endless workspace replaces the extraction panel', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-extract'));
    expect(await screen.findByTestId('extraction-panel')).toBeTruthy();
    expect(pressed('extract')).toBe('true');

    fireEvent.click(screen.getByTestId('mode-rail-endless'));
    expect(await screen.findByTestId('endless-panel')).toBeTruthy();
    expect(screen.queryByTestId('extraction-panel')).toBeNull();
    expect(pressed('endless')).toBe('true');
    expect(pressed('extract')).toBe('false');
  });

  it('Endless → Craft: crafting starts and the endless panel is gone', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-endless'));
    expect(await screen.findByTestId('endless-panel')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mode-rail-craft'));
    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe('crafting'));
    expect(await screen.findByRole('button', { name: 'Open Workshop' })).toBeTruthy();
    expect(screen.queryByTestId('endless-panel')).toBeNull();
    expect(pressed('craft')).toBe('true');
    expect(pressed('endless')).toBe('false');
  });

  it('Endless → Roam: roaming starts, the panel dismisses, and the lit stop agrees', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-endless'));
    expect(await screen.findByTestId('endless-panel')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mode-rail-roam'));
    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe('roaming_loot'));
    await waitFor(() => expect(screen.queryByTestId('endless-panel')).toBeNull());
    expect(screen.getByText('Active Area')).toBeTruthy();
    expect(pressed('roam')).toBe('true');
    expect(pressed('endless')).toBe('false');
  });
});

describe('Home mode rail — Roam is the area door (owner ruling 2026-11-04)', () => {
  // The rail's separate Area stop is gone. The exact model:
  // entering roam from any other activity starts the roam AND
  // auto-opens the area picker; tapping Roam while already
  // roaming opens the picker alone — no restart, and dismissing
  // the picker leaves the running roam untouched. The picker is
  // the same one the old Area stop opened (same cards, same
  // danger warnings — areas warn, never wall).

  const dismissPicker = async () => {
    // The sheet's backdrop is the topmost fixed overlay (sheets
    // portal to the body end; the latest-opened is last).
    const backdrops = document.querySelectorAll('.fixed.inset-0');
    const backdrop = backdrops[backdrops.length - 1];
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    await waitFor(() => expect(screen.queryByText('Choose Area')).toBeNull());
  };

  it('switch-to-roam opens the picker: entering roam from standby starts the roam and surfaces the location options', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-roam'));
    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe('roaming_loot'));
    // The picker auto-opened on entry — title plus the area cards.
    expect(await screen.findByText('Choose Area')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Select Ironwood Bastion' })).toBeTruthy();
    expect(pressed('roam')).toBe('true');
  });

  it('switch-to-roam from another activity (Endless) also opens the picker on entry', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-endless'));
    expect(await screen.findByTestId('endless-panel')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mode-rail-roam'));
    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe('roaming_loot'));
    expect(await screen.findByText('Choose Area')).toBeTruthy();
  });

  it('roam-while-roaming opens the picker only — the running roam is not restarted', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-roam'));
    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe('roaming_loot'));
    expect(await screen.findByText('Choose Area')).toBeTruthy();
    await dismissPicker();
    const startsAfterEntry = vi.mocked(startActiveActivity).mock.calls.length;

    fireEvent.click(screen.getByTestId('mode-rail-roam'));
    expect(await screen.findByText('Choose Area')).toBeTruthy();
    // No second start was issued; the same roam keeps running.
    expect(vi.mocked(startActiveActivity).mock.calls.length).toBe(startsAfterEntry);
    expect(useActivityStore.getState().current.kind).toBe('roaming_loot');
    expect(useActivityStore.getState().current.targetId).toBe('dustwaste_frontier');
  });

  it('picker select switches the roam target while the roam keeps running', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-roam'));
    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe('roaming_loot'));
    expect(await screen.findByText('Choose Area')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Select Ironwood Bastion' }));
    // The danger guard may interpose its warning first (areas
    // warn, never wall) — "Roam anyway" always proceeds.
    const confirm = await screen.findByTestId('area-danger-confirm-ironwood_bastion', {}, { timeout: 1500 }).catch(() => null);
    if (confirm) fireEvent.click(confirm);

    await waitFor(() => expect(useIdleStore.getState().selectedRoamingAreaId).toBe('ironwood_bastion'));
    expect(useActivityStore.getState().current.kind).toBe('roaming_loot');
    // The roaming workspace follows the new target.
    expect(screen.getByText('Active Area')).toBeTruthy();
    expect(screen.getAllByText('Ironwood Bastion').length).toBeGreaterThan(0);
  });

  it('picker dismiss keeps roaming: no restart, selection untouched, roam still running', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    fireEvent.click(await screen.findByTestId('mode-rail-roam'));
    await waitFor(() => expect(useActivityStore.getState().current.kind).toBe('roaming_loot'));
    expect(await screen.findByText('Choose Area')).toBeTruthy();
    const startsAfterEntry = vi.mocked(startActiveActivity).mock.calls.length;
    const selectionBefore = useIdleStore.getState().selectedRoamingAreaId;

    await dismissPicker();

    expect(useActivityStore.getState().current.kind).toBe('roaming_loot');
    expect(useIdleStore.getState().selectedRoamingAreaId).toBe(selectionBefore);
    expect(vi.mocked(startActiveActivity).mock.calls.length).toBe(startsAfterEntry);
    expect(pressed('roam')).toBe('true');
  });

  it('the Area stop is absent from the rail', async () => {
    render(<HomeScreen onNavigate={() => {}} />);
    await screen.findByTestId('home-mode-rail');
    expect(screen.queryByTestId('mode-rail-area')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Change area' })).toBeNull();
  });
});
