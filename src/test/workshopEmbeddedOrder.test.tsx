/**
 * Embedded Workshop order (device-pass fix round, 2026-11-17) —
 * in Home's Craft workspace the queue is the state the player just
 * changed, so it leads:
 *
 *  - Bench Jobs renders ABOVE the catalog (it used to sit below
 *    the whole catalog + TintPanel, invisible on the first
 *    screenful — a queued job read as "nothing happened");
 *  - a workshop error (a refused enqueue/cancel) prints at the top
 *    of the workspace, beside the bench strip, exactly once;
 *  - the standalone Workshop page keeps its shipped order
 *    (Bench Jobs stays in flow below the catalog).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeCraftBench } from '../components/workshop/HomeCraftBench';
import { WorkshopScreen } from '../screens/WorkshopScreen';
import { useActivityStore, usePlayerStore, useWorkshopStore } from '../store';
import { IDLE_ACTIVITY } from '../types/activity';
import type { WorkshopJobView } from '../store/slices/workshopSlice';

// jsdom has no IntersectionObserver; ChipRail needs one. Same stub
// shape as craftConsolidation.test.tsx.
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
    startActiveActivity: vi.fn(async (input: Record<string, unknown>) => ({ ...idle, kind: input.kind })),
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

const benchJob: WorkshopJobView = {
  id: 'job-bench-1',
  bench: 1,
  kind: 'consumable',
  recipeId: 'recipe_medkit',
  name: 'Med Kit',
  state: 'queued',
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
};

const FOLLOWS = 4; // Node.DOCUMENT_POSITION_FOLLOWING

function seedStores(error: string | null) {
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
      jobs: [benchJob],
      masteries: { ...MASTERIES },
      activeActionKind: 'roaming_loot',
      recentCompletions: [],
    },
    error,
    loading: false,
    refresh: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
  });
  useActivityStore.setState({
    current: { ...IDLE_ACTIVITY, kind: 'roaming_loot' as never },
    pending: false,
    start: vi.fn(async () => ({} as never)) as never,
  });
}

describe('embedded Workshop order — queue and errors lead', { timeout: 60_000 }, () => {
  beforeEach(() => {
    seedStores(null);
  });

  it('Bench Jobs renders above the catalog in the embedded workspace', async () => {
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const heading = await screen.findByText('Bench Jobs');
    const card = document.getElementById('workshop-recipe-recipe_medkit');
    expect(card).not.toBeNull();
    // The catalog card FOLLOWS the Bench Jobs heading in the document.
    expect(heading.compareDocumentPosition(card as Node) & FOLLOWS).toBeTruthy();
    // And the section itself carries the queued job.
    expect(heading.parentElement?.textContent).toContain('Med Kit');
  });

  it('a workshop error prints once, at the top of the workspace', async () => {
    seedStores('Bench queue is full — test refusal');
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const errors = await screen.findAllByText('Bench queue is full — test refusal');
    expect(errors).toHaveLength(1);
    const heading = screen.getByText('Bench Jobs');
    // The Bench Jobs heading FOLLOWS the error — the error is above it.
    expect(errors[0].compareDocumentPosition(heading) & FOLLOWS).toBeTruthy();
    const card = document.getElementById('workshop-recipe-recipe_medkit');
    expect(errors[0].compareDocumentPosition(card as Node) & FOLLOWS).toBeTruthy();
  });

  it('the standalone page keeps its order: Bench Jobs below the catalog', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const heading = await screen.findByText('Bench Jobs');
    const card = document.getElementById('workshop-recipe-recipe_medkit');
    expect(card).not.toBeNull();
    // The heading FOLLOWS the catalog card in the document.
    expect((card as Node).compareDocumentPosition(heading) & FOLLOWS).toBeTruthy();
  });
});
