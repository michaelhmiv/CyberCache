/**
 * Boss stage home — One-Stage Law (owner ruling 2026-11-06, F5 closed).
 *
 * The defect this file exists to keep dead: the main stage could
 * never enter its boss scene. `bossPhase` was dropped at TWO hops —
 * ActionScreenContextual rendered <LiveTurfDiorama> without the
 * prop it computed, and the diorama's own mode call dropped it
 * again — so boss_fight always computed 'bossPrep': no boss on the
 * stage, no boss HP plate, the fight exiled to the encounter card.
 * It shipped because existing tests set the store's bossPhase but
 * never asserted what the STAGE rendered.
 *
 * These tests assert the stage itself, through the real screen:
 *  - prep: the boss STANDS on the main stage (no crate in its place),
 *    and the boss HP plate stays off (it is a fight plate).
 *  - fight: the animated BossFightStage plays ON THE MAIN STAGE
 *    (exactly one in the document — the card mounts none), and the
 *    boss HP plate rides the stage.
 *  - a real launch through the panel drives the same path end to
 *    end and retires the stage presentation at resolution.
 *  - roaming is untouched by the wiring.
 *
 * The render harness mirrors actionControlsOnStage.test.tsx (same
 * mocks, same store seeding) — this screen's established habitat.
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
import { verifyBossFight, type ChefVerifyBossResult } from '@/lib/chef/chefClient';
import {
  useActivityStore,
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useTickFeedStore,
} from '@/store';
import { IDLE_ACTIVITY, type BossPhase } from '@/types/activity';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { buildBossFightActivity } from '@/lib/activity/activityBuilders';
import { FIXTURE_PHASES, FIXTURE_WEAPON, freezeSnapshot } from '@/harness/fightFixture';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { AccountState } from '@/auth/accountState';

const mockVerifyBossFight = vi.mocked(verifyBossFight);
const boss = REGION_1_BOSSES[0]; // Dune Tyrant — free entry

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

function seedStores() {
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
  useActivityStore.setState({ current: IDLE_ACTIVITY, hydrated: true, pending: false, error: null });
  useBossStore.setState({
    currentBossId: null,
    defeatedBossIds: [],
    preparedConsumables: {},
    fightPresentation: null,
    activeBossId: null,
    activeBossHp: 0,
    activeBossMaxHp: 0,
    activeStatus: 'idle',
  });
  useTickFeedStore.setState({ events: [] });
  hoisted.auth.account = verifiedAccount;
  hoisted.auth.signInWithGoogle.mockClear();
}

function bossActivityRecord(phase: BossPhase) {
  const built = buildBossFightActivity(boss, weapon, phase);
  return {
    ...built,
    bossPhase: phase,
    targetType: built.targetType ?? null,
    targetId: built.targetId ?? null,
    targetLabel: built.targetLabel ?? null,
    sceneKey: built.sceneKey ?? null,
    notes: built.notes ?? null,
    activityPayload: built.activityPayload ?? {},
    publicPayload: built.publicPayload ?? {},
    publicVisible: built.publicVisible ?? true,
    startedAt: null,
    completesAt: null,
    lastHeartbeatAt: null,
    schemaVersion: 1,
    updatedAt: null,
  };
}

function seedBossEncounter(phase: BossPhase) {
  useBossStore.setState({
    currentBossId: boss.id,
    unlockedBossIds: [boss.id],
    defeatedBossIds: [],
    pityCounters: {},
    preparedConsumables: {},
    attemptHistory: [],
  });
  useActivityStore.setState({ current: bossActivityRecord(phase), pending: false });
}

function victoryResult(): ChefVerifyBossResult {
  return {
    actionType: 'cc_apply_boss_attempt',
    verified: true,
    victory: true,
    result: {
      id: 'attempt-1',
      bossId: boss.id,
      timestamp: Date.now(),
      victory: true,
      winChance: 0.9,
      consumablesUsed: {},
      consumablesLost: {},
      entryFee: 0,
      creditsGained: 750,
      creditsLost: 0,
      loot: [],
      reasons: ['Victory: Dune Tyrant defeated with current prep.'],
      recommendations: [],
    },
    creditsDelta: 750,
    xpAwarded: 100,
    loot: [],
    items: [],
    consumedConsumables: {},
    extraLoot: false,
    bonusLootRolls: 0,
    entryFee: 0,
    dedicatedDropAwarded: false,
    pityIncremented: false,
    telemetry: { serverRolled: true, adjustedWinChance: 0.9, effectiveDps: 500, timeToKill: 2 },
  };
}

beforeEach(() => {
  mockVerifyBossFight.mockReset();
  seedStores();
});

describe('boss stage home — the wiring (source pins)', () => {
  it('the screen passes bossPhase to the diorama; the diorama feeds it to the mode', () => {
    const screenSrc = readFileSync(resolve(process.cwd(), 'src/screens/ActionScreenContextual.tsx'), 'utf8');
    expect(screenSrc).toContain('bossPhase={bossPhase}');
    const dioramaSrc = readFileSync(resolve(process.cwd(), 'src/components/dashboard/LiveTurfDiorama.tsx'), 'utf8');
    expect(dioramaSrc).toContain('modeFromActivity(activityKind, bossPhase)');
  });
});

describe('boss stage home — what the stage renders', () => {
  it('prep: the boss stands on the main stage; no fight plate yet', () => {
    seedBossEncounter('prep');
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    // The boss itself, on the stage — where the crate used to stand.
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
    expect(screen.queryByTestId('pixel-crate-prop')).toBeNull();
    // The HP plate is a fight plate; prep has none.
    expect(screen.queryByTestId('primary-diorama-boss-hp')).toBeNull();
    expect(screen.queryByTestId('diorama-boss-fight')).toBeNull();
  });

  it('fight: the animated fight plays on the main stage — exactly one — and the boss HP plate rides it', () => {
    seedBossEncounter('fight');
    // The panel mid-playback: it has published the presentation and
    // the live-fight read (this is the state handleStart maintains).
    useBossStore.setState({
      activeBossId: boss.id,
      activeBossHp: 400,
      activeBossMaxHp: 1000,
      activeStatus: 'active',
      fightPresentation: {
        timeline: freezeSnapshot(2),
        phases: FIXTURE_PHASES,
        bossId: boss.id,
        weapon: FIXTURE_WEAPON,
        signatureFire: null,
      },
    });
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    const stageMount = screen.getByTestId('diorama-boss-fight');
    // The fight stage — with its boss — inside the main stage mount…
    expect(within(stageMount).getByTestId('boss-fight-stage')).toBeTruthy();
    expect(within(stageMount).getByTestId('boss-stage-boss')).toBeTruthy();
    // …and nowhere else: the encounter card mounts no second fight.
    expect(screen.getAllByTestId('boss-fight-stage')).toHaveLength(1);
    // The ambient scene layer is replaced, not doubled.
    expect(screen.queryByTestId('pixel-diorama-stage')).toBeNull();
    // The boss HP plate the wiring finally reaches.
    const plate = screen.getByTestId('primary-diorama-boss-hp');
    expect(plate.textContent).toContain('Dune Tyrant');
    expect(plate.textContent).toContain('40%');
  });

  it('roaming: untouched by the wiring', () => {
    useActivityStore.setState({
      current: {
        ...IDLE_ACTIVITY, kind: 'roaming_loot', targetType: 'roaming_area',
        targetId: 'dustwaste_frontier', targetLabel: 'Dustwaste Frontier',
      },
      pending: false,
    });
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
    expect(screen.queryByTestId('primary-diorama-boss-hp')).toBeNull();
    expect(screen.queryByTestId('diorama-boss-fight')).toBeNull();
  });

  it('a real launch drives the fight onto the main stage and retires it at resolution', async () => {
    seedBossEncounter('prep');
    mockVerifyBossFight.mockResolvedValue(victoryResult());
    render(<ActionScreenContextual onOpenBossSelect={() => {}} />);
    fireEvent.click(screen.getByTestId('boss-start'));
    // Mid-flight: the fight is on the main stage and the boss HP
    // plate is live (the walk runs at Sample B pacing, real time).
    await waitFor(() => {
      expect(screen.getByTestId('diorama-boss-fight')).toBeTruthy();
      expect(screen.getByTestId('primary-diorama-boss-hp')).toBeTruthy();
      expect(screen.getAllByTestId('boss-fight-stage')).toHaveLength(1);
    }, { timeout: 6000 });
    // Resolution: the result lands in the panel, the stage
    // presentation is retired, the stage goes back to presence.
    expect(await screen.findByTestId('boss-result', undefined, { timeout: 15000 })).toHaveTextContent('BOSS DEFEATED');
    expect(screen.queryByTestId('diorama-boss-fight')).toBeNull();
    expect(useBossStore.getState().fightPresentation).toBeNull();
    expect(screen.getByTestId('pixel-enemy')).toBeTruthy();
  }, 25000);
});
