/**
 * Workshop bench scene cause bar (F7 regression pins).
 *
 * The bench stage used to mount CraftingBenchScene with no
 * progress/causeLabel, so the scene's G-3 cause bar computed a NaN%
 * width under an empty label. These pins hold the fix: while a job
 * runs, the bar receives the job card's own progress numbers as a
 * finite 0..1 fraction and names the running job's recipe; with no
 * job running it renders the honest idle shape (0% under the bench's
 * name) — never NaN.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkshopScreen } from '../screens/WorkshopScreen';
import { usePlayerStore, useWorkshopStore } from '../store';
import { ALL_CRAFT_RECIPES } from '../content/crafting';
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

vi.mock('@/lib/chef/chefClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/chef/chefClient')>();
  return {
    ...actual,
    getStandingState: vi.fn(async () => ({ standing: { manufacturers: [] } })),
    getResearchState: vi.fn(async () => ({
      research: {
        courses: [{ id: 'production_systems', status: 'available' }],
      },
    })),
    getActionSkillState: vi.fn(async () => {
      throw new Error('no action skill state in tests');
    }),
  };
});

const MASTERIES = {
  crafting_consumables: { level: 9, xp: 0 },
  'crafting.refining': { level: 6, xp: 0 },
  'crafting.gear': { level: 4, xp: 0 },
  'crafting.cosmetics': { level: 2, xp: 0 },
};

const MEDKIT = (() => {
  const found = ALL_CRAFT_RECIPES.find((r) => r.id === 'recipe_medkit');
  if (!found) throw new Error('recipe_medkit missing from the catalog');
  return found;
})();

/** A Med Kit job, 1 of 4 units done and halfway through the second. */
function runningJob(overrides: Partial<WorkshopJobView> = {}): WorkshopJobView {
  return {
    id: 'job-cause-bar-1',
    bench: 1,
    kind: 'consumable',
    recipeId: MEDKIT.id,
    name: MEDKIT.name,
    state: 'running',
    unitsTotal: 4,
    unitsCompleted: 1,
    unitDurationMs: 60_000,
    accruedMs: 30_000,
    remainingMs: 150_000,
    xpAwarded: 0,
    gearRarity: null,
    catalystMaterialId: null,
    outputs: [],
    createdAtMs: 0,
    completedAtMs: null,
    repairItemId: null,
    repairKitType: null,
    repairPointsRestored: 0,
    ...overrides,
  };
}

function seedStores(jobs: WorkshopJobView[]) {
  usePlayerStore.setState({
    level: 14,
    credits: 6420,
    scrap: 1240,
    materials: { Scrap: 42, ReactiveComponents: 17, BallisticParts: 9 },
    essences: {},
    consumables: {},
  });
  useWorkshopStore.setState({
    server: {
      benches: 1,
      tools: { owned: {}, fitted: {}, charges: {} },
      jobs,
      masteries: { ...MASTERIES },
      activeActionKind: null,
      recentCompletions: [],
    },
    error: null,
    loading: false,
    refresh: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => true),
  });
}

function causeBar(scene: HTMLElement) {
  const fill = scene.querySelector<HTMLElement>('.bg-amber-400');
  if (!fill) throw new Error('cause bar fill not rendered in the bench scene');
  return fill;
}

describe('Workshop bench scene — cause bar (F7)', { timeout: 60_000 }, () => {
  beforeEach(() => {
    seedStores([]);
  });

  it('names the running job’s recipe and fills on the job card’s numbers', async () => {
    seedStores([runningJob()]);
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const scene = await screen.findByTestId('crafting-bench-scene');
    const inScene = within(scene);
    // The cause label is the running job's recipe name.
    expect(inScene.getByText(MEDKIT.name)).toBeTruthy();
    // Progress = (1 completed + 30s of a 60s unit) / 4 units = 0.375,
    // rendered by the scene as a rounded, finite percent in [0, 100].
    const width = causeBar(scene).style.width;
    expect(width).toBe('38%');
    const pct = Number.parseFloat(width);
    expect(Number.isFinite(pct)).toBe(true);
    expect(pct).toBeGreaterThanOrEqual(0);
    expect(pct).toBeLessThanOrEqual(100);
    expect(scene.innerHTML).not.toContain('NaN');
  });

  it('renders the idle shape — 0% under the bench’s name, no NaN — when the bench is empty', async () => {
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const scene = await screen.findByTestId('crafting-bench-scene');
    const inScene = within(scene);
    expect(inScene.getByText('The Bench')).toBeTruthy();
    expect(inScene.getByText('awaiting a job')).toBeTruthy();
    expect(causeBar(scene).style.width).toBe('0%');
    expect(scene.innerHTML).not.toContain('NaN');
  });

  it('stays idle while jobs are only paused or queued — only a running job drives the bar', async () => {
    seedStores([
      runningJob({ id: 'job-paused', state: 'paused' }),
      runningJob({ id: 'job-queued', state: 'queued', unitsCompleted: 0, accruedMs: 0 }),
    ]);
    render(<WorkshopScreen onNavigate={vi.fn()} />);
    const scene = await screen.findByTestId('crafting-bench-scene');
    const inScene = within(scene);
    expect(inScene.getByText('The Bench')).toBeTruthy();
    expect(causeBar(scene).style.width).toBe('0%');
    expect(scene.innerHTML).not.toContain('NaN');
  });
});
