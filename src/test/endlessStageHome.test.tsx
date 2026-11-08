/**
 * Endless stage home — Motion Reboot M3 (the #431 pattern carried
 * to the Chaos Chamber).
 *
 * The defect this file exists to keep dead: `endless_run` had no
 * stage mode at all — modeFromActivity fell through to 'idle', so
 * the main stage showed the CAMP VISTA for a run's whole duration
 * while the EndlessPanel ran a second, private fight stage inside
 * its own card (the PR #384 follow-up; two animated stages in the
 * app during a run's fight).
 *
 * These tests assert the stage itself, through the real screen:
 *  - during a run, the NEXT encounter stands on the main stage in
 *    its arena (presence) — no camp crate, no camp vista mode.
 *  - a fight the panel publishes plays ON THE MAIN STAGE (exactly
 *    one fight stage in the document — the panel mounts none).
 *  - the identity guard: a presentation whose run id does not
 *    match the activity record's targetId (the server-pinned run
 *    id) never renders.
 *  - a real advance through the panel drives the same path end to
 *    end: victory retires the presentation and the stage returns
 *    to presence; defeat CLOSES the run — the panel's ended card,
 *    both stage publications cleared.
 *
 * The render harness mirrors bossStageHome.test.tsx (same mocks,
 * same store seeding) — this screen's established habitat.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const hoisted = vi.hoisted(() => ({
  auth: {
    user: { id: 'user-1' } as { id: string } | null,
    account: null as import('@/auth/accountState').AccountState | null,
    signInWithGoogle: vi.fn(async () => {}),
    actionLoading: false as boolean,
    signOut: vi.fn(async () => {}),
    session: null,
    loading: false,
    refreshAccount: vi.fn(async () => {}),
  },
}));

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => hoisted.auth }));

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    recycleItem: vi.fn(),
    equipItem: vi.fn(),
  },
  fetchProfileLifetime: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
}));

vi.mock('@/lib/api/leaderboardService', () => ({
  getLeaderboard: vi.fn(),
  getWeeklyLeaderboards: vi.fn(() => Promise.resolve({
    week: { key: '2026-10-26', start: '2026-10-26T00:00:00.000Z', ends_at: '2026-11-02T00:00:00.000Z' },
    races: [],
    previous_week: {
      key: '2026-10-19', start: '2026-10-19T00:00:00.000Z', ends_at: '2026-10-26T00:00:00.000Z',
      settled: false, settled_at: null, races: [],
    },
    my_drop_buff: null,
  })),
}));
vi.mock('@/lib/api/publicProfileService', () => ({ getPublicProfile: vi.fn(async () => null) }));
vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  getLoginStreakState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  getCacheRankState: vi.fn(async () => { throw new Error('no chef in screen tests'); }),
  verifyBossFight: vi.fn(),
  getEndlessMe: vi.fn(),
  advanceEndlessEncounter: vi.fn(),
  startEndlessRun: vi.fn(),
  bankEndlessRun: vi.fn(),
  getActionSkillState: vi.fn(async () => ({
    verified: true,
    actionSkill: {
      charge: 0,
      chargeMax: 100,
      charged: false,
      selection: null,
      selected: null,
      qualified: [],
      signatures: [],
      noKeystoneNote: 'No action skill yet.',
    },
  })),
}));
vi.mock('@/lib/api/statsService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/statsService')>()),
  getMyStatsSummary: vi.fn(async () => null),
}));
vi.mock('@/lib/api/usernameService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/usernameService')>()),
  getMyProfileSummary: vi.fn(async () => null),
}));
vi.mock('@/lib/api/progressionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/progressionService')>()),
  getMyProgressionSnapshots: vi.fn(async () => []),
}));

import { ActionScreenContextual } from '@/screens/ActionScreenContextual';
import {
  advanceEndlessEncounter,
  getEndlessMe,
  type ChefEndlessEncounterResult,
  type ChefEndlessMeResult,
  type ChefEndlessRun,
} from '@/lib/chef/chefClient';
import {
  useActivityStore,
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useTickFeedStore,
} from '@/store';
import { IDLE_ACTIVITY } from '@/types/activity';
import { endlessIntel } from '@/content/endless';
import { FIXTURE_PHASES, FIXTURE_WEAPON, freezeSnapshot } from '@/harness/fightFixture';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { AccountState } from '@/auth/accountState';

const mockGetEndlessMe = vi.mocked(getEndlessMe);
const mockAdvance = vi.mocked(advanceEndlessEncounter);

const RUN_ID = 'run-1';

const weapon: Weapon = {
  id: 'weapon-1',
  name: 'Test Weapon',
  level: 1,
  rarity: Rarity.Common,
  weaponType: WeaponType.Pistol,
  manufacturer: Manufacturer.Redline,
  element: Element.Kinetic,
  rollQuality: 50,
  baseDamage: 10,
  attackSpeed: 1,
  critChance: 0.1,
  critDamage: 1.5,
  statusChance: 0,
  statusDamage: 0,
  bossDamageMod: 0,
  waveDamageMod: 0,
  shieldDamageMod: 0,
  armorDamageMod: 0,
  offlineEarningsMod: 0,
  rareDropChanceMod: 0,
  scrapYieldMod: 0,
  parts: [],
  affixes: [],
  legendaryEffectId: undefined,
  sourceTag: DropSource.WorldDrop,
  isLocked: false,
  pixelSeed: 0,
  combatPower: 0,
  bossPower: 0,
  farmPower: 0,
  economyScore: 0,
};

const verifiedAccount: AccountState = {
  userId: 'user-1',
  accountType: 'verified',
  username: 'hunter',
  hasUsername: true,
  email: 'hunter@example.com',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  verificationGraceExpiresAt: null,
  verificationReminderLastSeenAt: null,
  isAnonymous: false,
};

function runFixture(depthReached: number): ChefEndlessRun {
  return {
    id: RUN_ID,
    status: 'active',
    started_at: '2026-11-07T00:00:00.000Z',
    ended_at: null,
    start_level: 20,
    risk: 'balanced',
    prepared_consumables: {},
    depth_reached: depthReached,
    escrow_credits: 0,
    escrow_xp: 0,
    escrow_scrap: 0,
    entry_fee: 200,
    milestone_drops: [],
    paid_credits: 0,
    paid_xp: 0,
    paid_scrap: 0,
    payout_fraction: null,
  };
}

function meFixture(depthReached: number): ChefEndlessMeResult {
  return {
    verified: true,
    intel: endlessIntel(20, 1),
    bestDepth: 3,
    runsStartedToday: 1,
    recentRuns: [],
    activeRun: runFixture(depthReached),
  };
}

function seedStores(depthReached = 0) {
  useLoadoutStore.setState({
    slots: { primary: weapon.id, secondary: null, heavy: null, ordnance: null, shield: null, classMod: null, relic: null, vehicle: null },
    consumables: { PreFight: null, MidFight: null, Emergency: null },
  });
  usePlayerStore.setState({
    id: 'test',
    name: 'tester',
    level: 20,
    xp: 0,
    credits: 10000,
    scrap: 0,
    cacheKeys: 0,
    currentZoneId: 'dustwaste_1',
    highestZoneId: 'dustwaste_1',
    offlineCapHours: 2,
    lastClaimTime: 0,
    deathFeeInsurance: false,
    consumables: {},
    consumableBatches: [],
    materials: {},
    essences: {},
    workshopQueues: [],
    lastWorkshopTick: 0,
    lastClaimedTick: 0,
  });
  useInventoryStore.setState({ items: [weapon] });
  useBossStore.setState({
    currentBossId: null,
    defeatedBossIds: [],
    preparedConsumables: {},
    fightPresentation: null,
    endlessPresentation: null,
    endlessPresence: null,
    activeBossId: null,
    activeBossHp: 0,
    activeBossMaxHp: 0,
    activeStatus: 'idle',
  });
  useTickFeedStore.setState({ events: [] });
  // The run holds the action slot; the record's targetId IS the
  // server-pinned run id (migration 0028) — the stage's guard key.
  useActivityStore.setState({
    current: {
      ...IDLE_ACTIVITY,
      kind: 'endless_run',
      targetType: 'endless_run',
      targetId: RUN_ID,
      targetLabel: 'Chaos Chamber',
    },
    hydrated: true,
    pending: false,
    error: null,
  });
  hoisted.auth.account = verifiedAccount;
  hoisted.auth.signInWithGoogle.mockClear();
  mockGetEndlessMe.mockResolvedValue(meFixture(depthReached));
}

function victoryOutcome(): ChefEndlessEncounterResult {
  const run = runFixture(1);
  run.escrow_credits = 440;
  run.escrow_xp = 120;
  run.escrow_scrap = 10;
  return {
    verified: true,
    victory: true,
    result: {
      id: 'enc-1',
      depth: 1,
      bossId: 'endless-depth-1',
      victory: true,
      winChance: 0.9,
      bossHpRemaining: 0,
      reasons: [],
      recommendations: [],
    },
    rewards: { xp: 120, credits: 440, scrap: 10 },
    items: [],
    escrow: { credits: 440, xp: 120, scrap: 10 },
    runStatus: 'active',
    payout: null,
    run,
  };
}

function defeatOutcome(): ChefEndlessEncounterResult {
  const run = runFixture(4);
  run.status = 'died';
  run.ended_at = '2026-11-07T01:00:00.000Z';
  return {
    verified: true,
    victory: false,
    result: {
      id: 'enc-5',
      depth: 5,
      bossId: 'dune_tyrant',
      victory: false,
      winChance: 0.2,
      bossHpRemaining: 500,
      reasons: [],
      recommendations: [],
    },
    rewards: { xp: 0, credits: 0, scrap: 0 },
    items: [],
    escrow: { credits: 0, xp: 0, scrap: 0 },
    runStatus: 'died',
    payout: { credits: 220, xp: 60, scrap: 5, fraction: 0.5 },
    run,
  };
}

beforeEach(() => {
  mockGetEndlessMe.mockReset();
  mockAdvance.mockReset();
  seedStores();
});

describe('endless stage home — the wiring (source pins)', () => {
  it('the screen passes the run id; the diorama maps endless_run to its own mode; the panel publishes and mounts no stage', () => {
    const screenSrc = readFileSync(resolve(process.cwd(), 'src/screens/ActionScreenContextual.tsx'), 'utf8');
    expect(screenSrc).toContain("endlessRunId={currentKind === 'endless_run' ? activity.current.targetId : undefined}");
    const dioramaSrc = readFileSync(resolve(process.cwd(), 'src/components/dashboard/LiveTurfDiorama.tsx'), 'utf8');
    expect(dioramaSrc).toContain("if (kind === 'endless_run') return 'endless';");
    expect(dioramaSrc).toContain('endlessPresentation.runId === endlessRunId');
    const panelSrc = readFileSync(resolve(process.cwd(), 'src/components/fight/EndlessPanel.tsx'), 'utf8');
    expect(panelSrc).toContain('setEndlessPresentation');
    expect(panelSrc).toContain('setEndlessPresence');
    expect(panelSrc).not.toContain('BossFightStage');
  });
});

describe('endless stage home — what the stage renders', () => {
  it('during a run: the next encounter stands on the main stage — no camp crate, no fight', async () => {
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    // The panel loads the run and publishes its presence; the
    // encounter takes the stage (the boss-prep treatment).
    await waitFor(() => {
      expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
    }, { timeout: 8000 });
    expect(useBossStore.getState().endlessPresence?.runId).toBe(RUN_ID);
    // The camp defector: no crate prop stands in for the scene.
    expect(screen.queryByTestId('pixel-crate-prop')).toBeNull();
    expect(screen.queryByTestId('diorama-endless-fight')).toBeNull();
    // The panel is in its run state, mounting no stage of its own.
    expect(screen.getByTestId('endless-advance')).toBeTruthy();
    expect(screen.queryByTestId('boss-fight-stage')).toBeNull();
  });

  it('fight: the published fight plays on the main stage — exactly one — and the scene layer is replaced', async () => {
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('endless-advance')).toBeTruthy();
    }, { timeout: 8000 });
    // The panel mid-playback: it has published the presentation
    // for THIS run (the state handleAdvance maintains).
    useBossStore.setState({
      endlessPresentation: {
        timeline: freezeSnapshot(2),
        phases: FIXTURE_PHASES,
        runId: RUN_ID,
        depth: 1,
        encounterId: 'endless-depth-1',
        band: 0,
        weapon: FIXTURE_WEAPON,
        signatureFire: null,
      },
    });
    const stageMount = await screen.findByTestId('diorama-endless-fight');
    expect(within(stageMount).getByTestId('boss-fight-stage')).toBeTruthy();
    expect(screen.getAllByTestId('boss-fight-stage')).toHaveLength(1);
    // The ambient scene layer is replaced, not doubled.
    expect(screen.queryByTestId('pixel-diorama-stage')).toBeNull();
  });

  it('identity guard: a presentation from another run never wears the stage', async () => {
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('endless-advance')).toBeTruthy();
    }, { timeout: 8000 });
    useBossStore.setState({
      endlessPresentation: {
        timeline: freezeSnapshot(2),
        phases: FIXTURE_PHASES,
        runId: 'run-someone-else',
        depth: 1,
        encounterId: 'endless-depth-1',
        band: 0,
        weapon: FIXTURE_WEAPON,
        signatureFire: null,
      },
    });
    // Give the store update a beat to (not) land on the stage.
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByTestId('diorama-endless-fight')).toBeNull();
    // The run's own presence scene still owns the stage.
    expect(screen.getByTestId('pixel-diorama-stage')).toBeTruthy();
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
  });

  it('a real advance drives the fight onto the main stage and retires it at resolution', async () => {
    mockAdvance.mockResolvedValue(victoryOutcome());
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    const advance = await screen.findByTestId('endless-advance', undefined, { timeout: 8000 });
    fireEvent.click(advance);
    // Mid-flight: the fight is on the main stage, exactly one.
    await waitFor(() => {
      expect(screen.getByTestId('diorama-endless-fight')).toBeTruthy();
      expect(screen.getAllByTestId('boss-fight-stage')).toHaveLength(1);
    }, { timeout: 8000 });
    // Resolution: the result lands in the panel, the presentation
    // is retired, the stage returns to the run's presence.
    expect(await screen.findByTestId('endless-last-result', undefined, { timeout: 20000 })).toBeTruthy();
    expect(useBossStore.getState().endlessPresentation).toBeNull();
    expect(screen.queryByTestId('diorama-endless-fight')).toBeNull();
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
  }, 30000);

  it('defeat closes the run: ended card in the panel, both stage publications cleared', async () => {
    seedStores(4);
    mockGetEndlessMe.mockResolvedValue(meFixture(4));
    mockAdvance.mockResolvedValue(defeatOutcome());
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    const advance = await screen.findByTestId('endless-advance', undefined, { timeout: 8000 });
    fireEvent.click(advance);
    await waitFor(() => {
      expect(screen.getByTestId('diorama-endless-fight')).toBeTruthy();
    }, { timeout: 8000 });
    const ended = await screen.findByTestId('endless-ended', undefined, { timeout: 20000 });
    expect(ended.textContent).toContain('THE CHAMBER CLAIMS ANOTHER');
    // The presentation clear is a synchronous store call in the
    // walk; the PRESENCE clear rides the panel's stage effect —
    // wait for both to land rather than sampling the store in the
    // same tick the ended card appears (a race CI caught once).
    await waitFor(() => {
      expect(useBossStore.getState().endlessPresentation).toBeNull();
      expect(useBossStore.getState().endlessPresence).toBeNull();
    }, { timeout: 5000 });
    expect(screen.queryByTestId('diorama-endless-fight')).toBeNull();
  }, 30000);
});
