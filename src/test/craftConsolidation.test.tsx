/**
 * Crafting consolidation (owner ruling 2026-11-04) — the bench's
 * new home, pinned:
 *
 *  - Home's Craft workspace IS the Workshop: a truth banner on top
 *    (paused reason + the remedy in place while anything else
 *    holds the action slot; plain running state while Craft does),
 *    the full bench embedded, and a Repairs & Service section.
 *  - Looking never switches the action: the bench's own Work the
 *    Bench control claims the slot.
 *  - Service-lane jobs (Garage repairs, shield recalibrations) are
 *    managed in the section — progress, Work (aims the
 *    workshop_service action at the job), Cancel — and no longer
 *    ride the Bench Jobs list.
 *  - Every 'workshop' door lands here: App's alias carries a
 *    seq-stamped intent and Home opens the bench on arrival; the
 *    Gear page's status strip reads Craft's state at a glance.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeCraftBench } from '../components/workshop/HomeCraftBench';
import { HomeScreen } from '../screens/HomeScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { useActivityStore, useInventoryStore, usePlayerStore, useWorkshopStore } from '../store';
import { IDLE_ACTIVITY } from '../types/activity';
import type { WorkshopJobView } from '../store/slices/workshopSlice';

// jsdom has no IntersectionObserver; ChipRail needs one. Same stub
// shape as workshopDirectionAScreen.test.tsx.
globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    account: null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  }),
}));

vi.mock('@/lib/chef/chefClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chef/chefClient')>();
  return {
    ...actual,
    getStandingState: vi.fn(async () => ({ standing: { manufacturers: [] } })),
    getResearchState: vi.fn(async () => ({
      research: { courses: [{ id: 'production_systems', status: 'available' }] },
    })),
    getActionSkillState: vi.fn(async () => { throw new Error('no action skill state in tests'); }),
    getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
    getContractsState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
    getEndlessMe: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
    getExtractionState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  };
});

vi.mock('@/lib/api/activityService', () => {
  const idle = {
    kind: 'idle_standby', bossPhase: 'prep', startedAt: null, completesAt: null,
    targetType: null, targetId: null, targetLabel: null, sceneKey: null, notes: null,
    activityPayload: {}, publicPayload: {}, lastHeartbeatAt: null,
    publicVisible: true, schemaVersion: 1, updatedAt: null,
  };
  return {
    startActiveActivity: vi.fn(async (input: Record<string, unknown>) => ({
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
    })),
    getMyActiveActivity: vi.fn(async () => idle),
    clearActiveActivity: vi.fn(async () => idle),
    heartbeatActiveActivity: vi.fn(async () => idle),
  };
});

vi.mock('@/lib/notifications/pushNotifications', () => ({
  checkPushPermission: vi.fn(async () => 'prompt'),
  requestPushNotifications: vi.fn(async () => true),
  syncPushRegistration: vi.fn(async () => {}),
}));

const MASTERIES = {
  crafting_consumables: { level: 9, xp: 0 },
  'crafting.refining': { level: 6, xp: 0 },
  'crafting.gear': { level: 4, xp: 0 },
  'crafting.cosmetics': { level: 2, xp: 0 },
};

const baseJob = {
  bench: 1,
  unitsTotal: 3,
  unitsCompleted: 0,
  unitDurationMs: 60_000,
  accruedMs: 0,
  remainingMs: 180_000,
  xpAwarded: 0,
  gearRarity: null,
  catalystMaterialId: null,
  outputs: [],
  createdAtMs: 0,
  completedAtMs: null,
  repairItemId: null,
  repairKitType: null,
  repairPointsRestored: 0,
} as const;

const benchJob: WorkshopJobView = {
  ...baseJob,
  id: 'job-bench-1',
  kind: 'consumable',
  recipeId: 'recipe_medkit',
  name: 'Med Kit',
  state: 'queued',
};

const repairJob: WorkshopJobView = {
  ...baseJob,
  id: 'job-repair-1',
  kind: 'repair',
  recipeId: 'repair',
  name: 'Vehicle repair — PatchKit',
  state: 'paused',
  unitsCompleted: 1,
  repairItemId: 'veh-1',
  repairKitType: 'PatchKit',
  repairPointsRestored: 30,
};

const shieldtechJob: WorkshopJobView = {
  ...baseJob,
  id: 'job-shield-1',
  kind: 'shieldtech',
  recipeId: 'shieldtech',
  name: 'Shield recalibration — Aegis → Bastion',
  state: 'queued',
  unitsTotal: 4,
  unitsCompleted: 2,
  shieldtechItemId: 'shield-1',
  shieldtechFromBehavior: 'Aegis',
  shieldtechToBehavior: 'Bastion',
  shieldtechPointsApplied: 40,
};

const startMock = vi.fn(async () => ({} as never));
const cancelMock = vi.fn(async () => true);

function seedStores(jobs: WorkshopJobView[], kind: string) {
  usePlayerStore.setState({
    id: 'p1',
    level: 14,
    credits: 6420,
    scrap: 1240,
    materials: { Scrap: 42 },
    essences: {},
    consumables: {},
  });
  useWorkshopStore.setState({
    server: {
      benches: 1,
      tools: { owned: {}, fitted: {}, charges: {} },
      jobs,
      masteries: { ...MASTERIES },
      activeActionKind: kind,
      recentCompletions: [],
    },
    error: null,
    loading: false,
    refresh: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => true),
    cancel: cancelMock,
  });
  useActivityStore.setState({
    current: { ...IDLE_ACTIVITY, kind: kind as never },
    pending: false,
    start: startMock as never,
  });
}

describe('crafting consolidation — the bench on Home', { timeout: 60_000 }, () => {
  beforeEach(() => {
    startMock.mockClear();
    cancelMock.mockClear();
    useInventoryStore.setState({ items: [] });
  });

  it('paused truth: while roaming, the banner names the reason and carries the remedy in place', async () => {
    seedStores([benchJob], 'roaming_loot');
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const banner = await screen.findByTestId('craft-bench-banner');
    expect(banner.textContent).toContain("Bench paused — you're roaming");
    expect(banner.textContent).toContain('1 job waiting');
    expect(banner.textContent).toContain('jobs progress only while Crafting holds the action slot');
    expect(screen.getByTestId('craft-bench-state').textContent).toBe('Paused');
    // The remedy is in place — and using it is what switches.
    fireEvent.click(screen.getByTestId('craft-bench-work-button'));
    await waitFor(() => expect(startMock).toHaveBeenCalled());
    expect(startMock.mock.calls[0][0]).toMatchObject({ kind: 'crafting' });
  });

  it('while Crafting holds the slot, the state reads plainly and no remedy is offered', async () => {
    seedStores([{ ...benchJob, state: 'running', unitsCompleted: 1 }], 'crafting');
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const banner = await screen.findByTestId('craft-bench-banner');
    expect(banner.textContent).toContain('Crafting is your current action — the bench is running');
    expect(banner.textContent).toContain('Med Kit');
    expect(screen.getByTestId('craft-bench-state').textContent).toBe('Running');
    expect(screen.queryByTestId('craft-bench-work-button')).toBeNull();
  });

  it('the service section manages a Garage repair job: progress, Work, Cancel', async () => {
    seedStores([repairJob], 'roaming_loot');
    useInventoryStore.setState({ items: [{ id: 'veh-1', name: 'Dust Runner' } as never] });
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const row = await screen.findByTestId('service-job-job-repair-1');
    const inRow = within(row);
    expect(row.textContent).toContain('Dust Runner');
    expect(row.textContent).toContain('Repair');
    expect(row.textContent).toContain('1/3 kits applied');
    expect(row.textContent).toContain('30 condition restored so far');
    // Work aims the service action at this job.
    fireEvent.click(inRow.getByRole('button', { name: 'Work this repair' }));
    await waitFor(() => expect(startMock).toHaveBeenCalled());
    expect(startMock.mock.calls[0][0]).toMatchObject({ kind: 'workshop_service', targetId: 'job-repair-1' });
    // Cancel rides the same workshop op the Garage uses.
    fireEvent.click(inRow.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalledWith('job-repair-1'));
  });

  it('shield-tech jobs render in the service section, not in the Bench Jobs list', async () => {
    seedStores([benchJob, shieldtechJob], 'roaming_loot');
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const row = await screen.findByTestId('service-job-job-shield-1');
    expect(row.textContent).toContain('Shield-tech');
    expect(row.textContent).toContain('Aegis → Bastion');
    const benchJobsHeading = await screen.findByText('Bench Jobs');
    const benchJobsSection = benchJobsHeading.parentElement;
    expect(benchJobsSection?.textContent).toContain('Med Kit');
    expect(benchJobsSection?.textContent).not.toContain('Shield recalibration');
  });

  it('a craft intent from a workshop door opens the bench on Home — without switching the action', async () => {
    seedStores([], 'idle_standby');
    render(<HomeScreen onNavigate={() => {}} craftBenchIntent={{ seq: 42 }} />);
    expect(await screen.findByTestId('home-craft-bench', undefined, { timeout: 10_000 })).toBeTruthy();
    expect(useActivityStore.getState().current.kind).toBe('idle_standby');
    expect(screen.getByTestId('mode-rail-craft').getAttribute('aria-pressed')).toBe('true');
  });

  it('the Gear status strip reads Craft active while crafting holds the slot', async () => {
    seedStores([], 'crafting');
    render(<InventoryScreen onNavigate={vi.fn()} />);
    expect(await screen.findByTestId('gear-workshop-strip')).toBeTruthy();
    expect(screen.getByTestId('gear-workshop-strip-state').textContent).toBe('Craft active');
  });
});
