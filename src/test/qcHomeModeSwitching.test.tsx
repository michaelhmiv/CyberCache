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
import { useActivityStore } from '@/store/slices/activitySlice';
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
