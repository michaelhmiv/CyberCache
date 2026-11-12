/**
 * H-05 — the Workshop pause reason must name the real blocker.
 *
 * Boss prep collapsed into the 'boss_fight' activity kind (bossPhase
 * 'prep' | 'fight' | 'resolved'), but the bench's pause copy keyed
 * on the kind alone — so a player standing in boss PREP (their last
 * attempt resolved, no fight anywhere) was told the bench was
 * "paused — you're in a boss fight."
 *
 * The audit's CI assertion: render the Workshop/bench with activity
 * = boss-phase prep (not fight) and a queued job; assert the pause
 * reason does not contain "in a boss fight" and does name the prep
 * state. The fight-phase control case keeps the original copy.
 * Both reason helpers (Home bench banner + Workshop screen) are
 * fixed; the Home bench is the played surface and is rendered here.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeCraftBench } from '../components/workshop/HomeCraftBench';
import { useActivityStore, useInventoryStore, usePlayerStore, useWorkshopStore } from '../store';
import { IDLE_ACTIVITY } from '../types/activity';
import type { WorkshopJobView } from '../store/slices/workshopSlice';

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

const benchJob: WorkshopJobView = {
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
  id: 'job-bench-1',
  kind: 'consumable',
  recipeId: 'recipe_medkit',
  name: 'Med Kit',
  state: 'queued',
} as WorkshopJobView;

function seed(kind: string, bossPhase: string) {
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
      masteries: {},
      activeActionKind: kind,
      recentCompletions: [],
    },
    error: null,
    loading: false,
    refresh: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => true),
    cancel: vi.fn(async () => true),
  });
  useActivityStore.setState({
    current: { ...IDLE_ACTIVITY, kind: kind as never, bossPhase: bossPhase as never },
    pending: false,
    start: vi.fn(async () => ({} as never)) as never,
  });
}

describe('workshop pause reason names the real blocker (audit H-05)', { timeout: 60_000 }, () => {
  beforeEach(() => {
    useInventoryStore.setState({ items: [] });
  });

  it('boss PREP pauses the bench as prepping — never as "in a boss fight"', async () => {
    seed('boss_fight', 'prep');
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const banner = await screen.findByTestId('craft-bench-banner');
    expect(banner.textContent).toContain("Bench paused — you're prepping for a boss");
    expect(banner.textContent).not.toContain('in a boss fight');
    expect(banner.textContent).toContain('1 job waiting');
  });

  it('a resolved attempt (back in prep) reads as prep, not as a fight', async () => {
    seed('boss_fight', 'resolved');
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const banner = await screen.findByTestId('craft-bench-banner');
    expect(banner.textContent).toContain("you're prepping for a boss");
    expect(banner.textContent).not.toContain('in a boss fight');
  });

  it('the fight phase keeps the fight copy', async () => {
    seed('boss_fight', 'fight');
    render(<HomeCraftBench onNavigate={vi.fn()} />);
    const banner = await screen.findByTestId('craft-bench-banner');
    expect(banner.textContent).toContain("Bench paused — you're in a boss fight");
  });
});
