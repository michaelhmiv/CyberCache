/**
 * Home harness page (craft-zoom round 3, dev only) — the FULL
 * Home screen at phone width for the owner's full-screen review:
 * the real HomeScreen inside the real ScreenWrapper scroller
 * with the real BottomNav under it (Home active), exactly the
 * shell App composes. Driven entirely by URL params:
 *
 *   state     working (a running Ammo Pack job, Crafting holds
 *             the action slot) | paused (the same job held
 *             paused — it seats at rest with no FX)
 *   recipe    ammo (default; recipe_ammo_pack — the owner's own
 *             queued job) | patch (recipe_patch_kit)
 *   craftzoom 1 | 2 | 3 — read by the diorama itself (the
 *             round 1–3 review gate), not by this page.
 *
 * Seeding follows the repo's own screen tests
 * (homeComposition / craftConsolidation): player store settled,
 * activity store holding Crafting, the workshop mirror carrying
 * the job, and the workshop refresh stubbed to a no-op so no
 * mount read can churn the tree. Auth resolves through the
 * harness stub (vite.home.config.ts); Chef reads are answered
 * offline by homeMain's fetch backstop. Nothing here is
 * imported by the app bundle; home-harness.html is served by
 * the Vite dev server only.
 */
import React from 'react';
import { HomeScreen } from '@/screens/HomeScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { IDLE_ACTIVITY } from '@/types/activity';
import { useActivityStore, usePlayerStore, useWorkshopStore } from '@/store';
import type { WorkshopJobView, WorkshopServerView } from '@/store/slices/workshopSlice';

const params = new URLSearchParams(window.location.search);
const state = params.get('state') ?? 'working';
const recipeParam = params.get('recipe');

const harnessJob = (over: Partial<WorkshopJobView>): WorkshopJobView => ({
  id: 'harness-job-1',
  bench: 0,
  kind: 'consumable',
  recipeId: 'recipe_patch_kit',
  name: 'Patch Kit',
  state: 'running',
  unitsTotal: 2,
  unitsCompleted: 0,
  unitDurationMs: 60_000,
  accruedMs: 12_000,
  remainingMs: 48_000,
  xpAwarded: 0,
  gearRarity: null,
  catalystMaterialId: null,
  outputs: [],
  createdAtMs: 0,
  completedAtMs: null,
  repairItemId: null,
  repairKitType: null,
  repairPointsRestored: 0,
  ...over,
});

const jobFamily: Partial<WorkshopJobView> =
  recipeParam === 'patch'
    ? { kind: 'consumable', recipeId: 'recipe_patch_kit', name: 'Patch Kit' }
    : { kind: 'consumable', recipeId: 'recipe_ammo_pack', name: 'Ammo Pack' };

const baseView = (over: Partial<WorkshopServerView>): WorkshopServerView => ({
  benches: 1,
  tools: { owned: {}, fitted: {}, charges: {} },
  jobs: [],
  masteries: {},
  activeActionKind: null,
  recentCompletions: [],
  ...over,
});

function seedStores() {
  usePlayerStore.setState({
    id: 'p1',
    level: 25,
    xp: 0,
    credits: 6420,
    scrap: 1240,
    materials: { Scrap: 42 },
    essences: {},
    consumables: {},
    profileLoaded: true,
  } as never);
  useWorkshopStore.setState({
    server: baseView({
      jobs: [harnessJob({ ...jobFamily, state: state === 'paused' ? 'paused' : 'running' })],
      activeActionKind: 'crafting',
    }),
    error: null,
    loading: false,
    refresh: async () => undefined,
    enqueue: async () => true,
    cancel: async () => true,
  } as never);
  useActivityStore.setState({
    current: { ...IDLE_ACTIVITY, kind: 'crafting' },
    hydrated: true,
    pending: false,
    error: null,
  } as never);
}

seedStores();

export const HomeHarnessPage: React.FC = () => (
  <div
    style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0B0B10' }}
    data-testid="home-harness-root"
  >
    <ScreenWrapper hidden={false}>
      <HomeScreen onNavigate={() => {}} />
    </ScreenWrapper>
    <BottomNav activeTab="home" onChange={() => {}} />
  </div>
);
