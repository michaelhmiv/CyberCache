/**
 * Home harness page (craft-info render round, dev only) — the
 * FULL Home screen at phone width for the owner's full-screen
 * review: the real HomeScreen inside the real ScreenWrapper
 * scroller with the real BottomNav under it (Home active),
 * exactly the shell App composes. Ported from the craft-zoom
 * round-3 harness; the seed mirrors the owner's own device
 * screenshot of 2026-11-17 (the premise this round renders
 * against):
 *
 *   LV 18 · credits 72.9K · scrap 198.0K · 3 keys · HP 194/1,780
 *   (plain LV18 chassis — computeCanonicalMaxHp(18,0,0) = 1,780)
 *   · no weapon equipped (0/7 gear) · belt slot 1 = Ammo Pack ×82
 *   · bench RUNNING an Ammo Pack job, 0/407 units at 10m/unit
 *   (unit 1 accrued 40% — the strip's 0% read), with a Med Kit
 *   ×25 and a Shield Cell ×40 queued behind it.
 *
 * Driven by URL params:
 *   state     working (head job running, Crafting holds the
 *             action slot) | paused (the same queue with the
 *             head job held paused — it seats at rest, no FX)
 *   craftinfo 1 | 2 | 3 — read by the rundown swap in
 *             ActionScreenContextual, not by this page. Absent
 *             the param the screen is the shipped picture.
 *
 * Seeding follows the repo's own screen tests
 * (homeComposition / craftConsolidation): player store settled,
 * activity store holding Crafting, the workshop mirror carrying
 * the jobs, and the workshop refresh stubbed to a no-op so no
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
import {
  useActivityStore,
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
  useWorkshopStore,
} from '@/store';
import type { WorkshopJobView, WorkshopServerView } from '@/store/slices/workshopSlice';

const params = new URLSearchParams(window.location.search);
const state = params.get('state') ?? 'working';
const headState = state === 'paused' ? 'paused' : 'running';

const harnessJob = (over: Partial<WorkshopJobView>): WorkshopJobView => ({
  id: 'harness-job-1',
  bench: 1,
  kind: 'consumable',
  recipeId: 'recipe_ammo_pack',
  name: 'Ammo Pack',
  state: 'running',
  unitsTotal: 407,
  unitsCompleted: 0,
  unitDurationMs: 600_000,
  accruedMs: 240_000,
  remainingMs: 243_960_000,
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
    level: 18,
    xp: 12837,
    credits: 72900,
    scrap: 198000,
    cacheKeys: 3,
    materials: { Scrap: 42 },
    essences: {},
    consumables: { AmmoPack: 82 },
    profileLoaded: true,
  } as never);
  useLoadoutStore.setState({
    consumables: { PreFight: 'AmmoPack', MidFight: null, Emergency: null },
  } as never);
  useSurvivalStore.setState({
    currentHp: 194,
    shieldHp: 0,
    isDead: false,
  } as never);
  useWorkshopStore.setState({
    server: baseView({
      jobs: [
        harnessJob({ id: 'harness-job-1', state: headState }),
        harnessJob({
          id: 'harness-job-2',
          recipeId: 'recipe_medkit',
          name: 'Med Kit',
          state: 'queued',
          unitsTotal: 25,
          unitsCompleted: 0,
          unitDurationMs: 720_000,
          accruedMs: 0,
          remainingMs: 18_000_000,
        }),
        harnessJob({
          id: 'harness-job-3',
          recipeId: 'recipe_shieldcell',
          name: 'Shield Cell',
          state: 'queued',
          unitsTotal: 40,
          unitsCompleted: 0,
          unitDurationMs: 900_000,
          accruedMs: 0,
          remainingMs: 36_000_000,
        }),
      ],
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
