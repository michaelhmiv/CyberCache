/**
 * Home harness page (R2 bars-render round, dev only) — the
 * FULL Home screen at phone width for the owner's full-screen
 * review: the real HomeScreen inside the real ScreenWrapper
 * scroller with the real BottomNav under it (Home active),
 * exactly the shell App composes.
 *
 * The seed continues the owner's device state from the
 * craft-info round (LV 18 · credits 72.9K · scrap 198.0K ·
 * 3 keys · HP 194/1,780 · belt slot 1 = Ammo Pack ×82), with
 * one change: a Rare Lv.12 pistol is equipped as primary, so
 * the prep panels' loadout and DPS rows price against a real
 * weapon. Driven by URL params:
 *
 *   state     boss (Gromm prep: defeated, one victory today —
 *             the rematch fee reads 500 × 2 = 1,000 cr) |
 *             endless-prep (Chaos Chamber prep, real intel
 *             from /endless/me) | endless-run (depth 7, escrow
 *             1,240 cr / 3,860 XP / 412 scrap at risk) |
 *             extract (a paused Deep Delve at Dustwaste with
 *             extraction holding the slot — the stage carries
 *             the rig scene; corrected 2026-11-17, see the
 *             bars-render CORRECTION.md)
 *   panel     endless | extract — read by the view-state seam
 *             in ActionScreenContextual, not by this page.
 *   bars      1 — read by the R2 seams (bars, zones, overflow
 *             clip), not by this page. Absent it, the screen
 *             is the shipped picture.
 *
 * Seeding follows the repo's own screen tests: stores settled
 * before render, the workshop refresh stubbed to a no-op so no
 * mount read can churn the tree. Auth resolves through the
 * harness stub (vite.home.config.ts); Chef reads are answered
 * by homeMain's fetch router. Nothing here is imported by the
 * app bundle; home-harness.html is served by the Vite dev
 * server only.
 */
import React from 'react';
import { HomeScreen } from '@/screens/HomeScreen';
import { BottomNav } from '@/components/layout/BottomNav';
import { ScreenWrapper } from '@/components/layout/ScreenWrapper';
import { IDLE_ACTIVITY } from '@/types/activity';
import {
  useActivityStore,
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
  useWorkshopStore,
} from '@/store';
import type { WorkshopJobView, WorkshopServerView } from '@/store/slices/workshopSlice';
import { FIXTURE_WEAPON } from './fightFixture';

const params = new URLSearchParams(window.location.search);
const state = params.get('state') ?? 'boss';

const weapon = { ...FIXTURE_WEAPON, id: 'bars-weapon-1', name: 'Scrapyard Persuader' };

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

function seedCommon() {
  usePlayerStore.setState({
    id: 'p1',
    level: 18,
    xp: 12837,
    credits: 72900,
    scrap: 198000,
    cacheKeys: 3,
    materials: { Scrap: 42 },
    essences: {},
    consumables: { AmmoPack: 82, MedKit: 6, ShieldCell: 4 },
    profileLoaded: true,
  } as never);
  useInventoryStore.setState({ items: [weapon] } as never);
  useLoadoutStore.setState({
    slots: {
      primary: weapon.id,
      secondary: null,
      heavy: null,
      shield: null,
      ordnance: null,
      relic: null,
      classMod: null,
    },
    consumables: { PreFight: 'AmmoPack', MidFight: null, Emergency: null },
  } as never);
  useSurvivalStore.setState({
    currentHp: 194,
    // maxHp rides along: the max-hp sync preserves the current/max
    // fraction when it recomputes, so the wound alone (194 against
    // the slice's 700 default) would rescale on first sync.
    maxHp: 1780,
    shieldHp: 0,
    isDead: false,
  } as never);
}

function seedActivity(current: Record<string, unknown>) {
  useActivityStore.setState({
    current: { ...IDLE_ACTIVITY, ...current },
    hydrated: true,
    pending: false,
    error: null,
  } as never);
}

function seedStores() {
  seedCommon();
  if (state === 'boss') {
    useBossStore.setState({
      currentBossId: 'heap_guard',
      unlockedBossIds: ['dune_tyrant', 'siltstalker', 'heap_guard'],
      defeatedBossIds: ['dune_tyrant', 'siltstalker', 'heap_guard'],
      bossVictoriesToday: { heap_guard: 1 },
      preparedConsumables: {},
    } as never);
    seedActivity({ kind: 'boss_fight', bossPhase: 'prep' });
  } else if (state === 'endless-prep') {
    useBossStore.setState({ preparedConsumables: { AmmoPack: 1 } } as never);
    seedActivity({});
  } else if (state === 'endless-run') {
    useBossStore.setState({ preparedConsumables: { AmmoPack: 1 } } as never);
    seedActivity({ kind: 'endless_run', targetId: 'run-harness-1' });
  } else if (state === 'extract') {
    useWorkshopStore.setState({
      server: baseView({
        jobs: [
          harnessJob({ id: 'harness-job-1', state: 'running' }),
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
        activeActionKind: 'extraction',
      }),
      error: null,
      loading: false,
      refresh: async () => undefined,
      enqueue: async () => true,
      cancel: async () => true,
    } as never);
    seedActivity({ kind: 'extraction' });
  }
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
