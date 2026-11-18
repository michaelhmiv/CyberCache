/**
 * First-screen fix R2 — the bars package (owner-approved layout
 * 2026-11-17).
 *
 * Pins:
 *  - the boss prep bar renders THE PANEL'S OWN fee: with the boss
 *    defeated and one victory banked today, the bar prints the
 *    rematch base under the panel's ×2 escalation (1,000 cr) —
 *    the same locals the in-flow notes print, no second formula;
 *    a player who cannot afford it sees their balance on the bar
 *    and the button disabled; a locked boss gets NO bar;
 *  - exactly one boss-start / endless-start control exists (the
 *    bar's button) — the in-flow duplicates are gone;
 *  - the endless prep bar renders the intel's own feeCredits
 *    under escalation (runsStartedToday 1 → ×2), not the
 *    un-escalated base;
 *  - EndlessPanel publishes its live run to the endless-run
 *    slice; ChamberRundown prints the escrow / death-pays /
 *    milestone / bank figures FROM that lifted state, and its
 *    BANK & LEAVE executes through the panel's own bank handler;
 *  - ExtractionPanel publishes its read state; ExtractRundown
 *    prints the Deep Delve below-×0.80 warning exactly when the
 *    pass method is deep AND the factor is below 0.80 — paused
 *    or active — and not for surface delves or healthy factors;
 *    Resume fires the panel's start path with the SAVED site
 *    and method.
 *
 * Habitats mirror bossEncounterFlow.test.tsx (boss panel),
 * endlessIntelRetry.test.tsx (endless panel) and
 * extractionPanelStage.test.tsx (extraction panel).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/chef/chefClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/chef/chefClient')>()),
  verifyBossFight: vi.fn(),
  getEndlessMe: vi.fn(),
  startEndlessRun: vi.fn(),
  advanceEndlessEncounter: vi.fn(),
  bankEndlessRun: vi.fn(),
  getExtractionState: vi.fn(),
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
vi.mock('@/lib/api/activityService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api/activityService')>()),
  startActiveActivity: vi.fn(async () => ({})),
}));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { buildBossFightActivity } from '@/lib/activity/activityBuilders';
import {
  bankEndlessRun,
  getEndlessMe,
  getExtractionState,
  type ChefEndlessMeResult,
  type ChefEndlessRun,
  type ChefExtractionState,
} from '@/lib/chef/chefClient';
import { startActiveActivity } from '@/lib/api/activityService';
import { endlessEncounterForDepth, endlessIntel } from '@/content/endless';
import {
  useActivityStore,
  useBossStore,
  useEndlessRunStore,
  useExtractionRunStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
} from '@/store';
import { BossEncounterPanel } from '@/components/fight/BossEncounterPanel';
import { EndlessPanel } from '@/components/fight/EndlessPanel';
import { ExtractionPanel } from '@/components/fight/ExtractionPanel';
import { ChamberRundown } from '@/components/dashboard/ChamberRundown';
import { ExtractRundown } from '@/components/dashboard/ExtractRundown';

const mockGetEndlessMe = vi.mocked(getEndlessMe);
const mockBankEndlessRun = vi.mocked(bankEndlessRun);
const mockGetExtractionState = vi.mocked(getExtractionState);
const mockStartActiveActivity = vi.mocked(startActiveActivity);

function makeWeapon(id: string, name: string): Weapon {
  return {
    id,
    name,
    level: 5,
    rarity: Rarity.Common,
    weaponType: WeaponType.Pistol,
    manufacturer: Manufacturer.Ironwood,
    element: Element.Kinetic,
    rollQuality: 50,
    baseDamage: 25,
    attackSpeed: 2,
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
    sourceTag: DropSource.WorldDrop,
    isLocked: false,
    pixelSeed: 7,
    combatPower: 50,
    bossPower: 50,
    farmPower: 50,
    economyScore: 0,
  };
}

const primaryWeapon = makeWeapon('primary-gun', 'Trusty Pistol');
// REGION_1_BOSSES[2]: entryCost 400 / rematchCost 500.
const feeBoss = REGION_1_BOSSES[2];

function seedBossPrep({ credits, defeated, victoriesToday, unlocked }: { credits: number; defeated: boolean; victoriesToday: number; unlocked: boolean }) {
  usePlayerStore.setState({ id: 'test-player', level: 20, credits, consumables: { MedKit: 5 } });
  useInventoryStore.setState({ items: [primaryWeapon] });
  useLoadoutStore.setState({
    slots: { primary: primaryWeapon.id, secondary: null, heavy: null, shield: null, ordnance: null, classMod: null, relic: null, vehicle: null },
  });
  useBossStore.setState({
    currentBossId: feeBoss.id,
    unlockedBossIds: unlocked ? [feeBoss.id] : [],
    defeatedBossIds: defeated ? [feeBoss.id] : [],
    bossVictoriesToday: { [feeBoss.id]: victoriesToday },
    pityCounters: {},
    preparedConsumables: {},
    selectedRisk: RiskSetting.Balanced,
    attemptHistory: [],
  });
  const built = buildBossFightActivity(feeBoss, primaryWeapon, 'prep');
  useActivityStore.setState({
    current: {
      ...built,
      bossPhase: 'prep',
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
    },
    pending: false,
  });
}

describe('R2 bars — boss prep bar renders the panel’s own fee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defeated + one victory today: Rematch 1,000 cr, escalated ×2, one start control', () => {
    seedBossPrep({ credits: 10000, defeated: true, victoriesToday: 1, unlocked: true });
    render(<BossEncounterPanel boss={feeBoss} onChangeBoss={() => {}} onLeave={() => {}} />);

    const bar = screen.getByTestId('boss-prep-bar');
    expect(bar.textContent).toContain(feeBoss.name);
    expect(bar.textContent).toContain('Rematch 1,000 cr');
    expect(bar.textContent).toContain('escalated ×2 today');
    expect(screen.getAllByTestId('boss-start')).toHaveLength(1);
    expect(screen.getByTestId('boss-start')).not.toBeDisabled();
  });

  it('cannot afford: the bar names the balance and disables the start', () => {
    seedBossPrep({ credits: 250, defeated: true, victoriesToday: 1, unlocked: true });
    render(<BossEncounterPanel boss={feeBoss} onChangeBoss={() => {}} onLeave={() => {}} />);

    const bar = screen.getByTestId('boss-prep-bar');
    expect(bar.textContent).toContain('you hold 250 cr');
    expect(screen.getByTestId('boss-start')).toBeDisabled();
  });

  it('first attempt, no victories: half the entry cost, no escalation note', () => {
    seedBossPrep({ credits: 10000, defeated: false, victoriesToday: 0, unlocked: true });
    render(<BossEncounterPanel boss={feeBoss} onChangeBoss={() => {}} onLeave={() => {}} />);

    const bar = screen.getByTestId('boss-prep-bar');
    expect(bar.textContent).toContain('Entry 200 cr');
    expect(bar.textContent).not.toContain('escalated');
  });

  it('locked boss: no bar (the lock card owns locked bosses)', () => {
    seedBossPrep({ credits: 10000, defeated: false, victoriesToday: 0, unlocked: false });
    render(<BossEncounterPanel boss={feeBoss} onChangeBoss={() => {}} onLeave={() => {}} />);
    expect(screen.queryByTestId('boss-prep-bar')).toBeNull();
  });
});

const endlessMe = (overrides: Partial<ChefEndlessMeResult>): ChefEndlessMeResult => ({
  verified: true,
  intel: endlessIntel(20, 1),
  bestDepth: 11,
  runsStartedToday: 1,
  recentRuns: [],
  activeRun: null,
  ...overrides,
});

const activeRun: ChefEndlessRun = {
  id: 'run-1',
  status: 'active',
  started_at: new Date().toISOString(),
  ended_at: null,
  start_level: 20,
  risk: 'Balanced',
  prepared_consumables: {},
  depth_reached: 7,
  escrow_credits: 2400,
  escrow_xp: 900,
  escrow_scrap: 35,
  entry_fee: 200,
  milestone_drops: [],
  paid_credits: 0,
  paid_xp: 0,
  paid_scrap: 0,
  payout_fraction: null,
};

describe('R2 bars — endless prep bar + run lift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEndlessRunStore.setState({ view: null, bankRequests: 0 });
    usePlayerStore.setState({ id: 'test-player', level: 20, credits: 10000, consumables: {} });
    useSurvivalStore.setState({ currentHp: 500, maxHp: 1000, shieldHp: 0, isDead: false });
  });

  it('prep bar prints the intel’s escalated feeCredits, not the base fee', async () => {
    const me = endlessMe({});
    mockGetEndlessMe.mockResolvedValue(me);
    render(<EndlessPanel onLeave={() => {}} />);

    const bar = await screen.findByTestId('endless-prep-bar');
    const fee = me.intel.entry.feeCredits;
    expect(me.intel.entry.feeMultiplier).toBe(2);
    expect(fee).toBe(me.intel.entry.baseFeeCredits * 2);
    expect(bar.textContent).toContain(`Entry ${fee.toLocaleString()} cr`);
    expect(bar.textContent).toContain('escalated ×2 today');
    expect(screen.getAllByTestId('endless-start')).toHaveLength(1);
  });

  it('the panel publishes the run; the zone prints its figures; BANK executes through the panel', async () => {
    mockGetEndlessMe.mockResolvedValue(endlessMe({ activeRun }));
    mockBankEndlessRun.mockResolvedValue({
      verified: true,
      ended: true,
      runId: 'run-1',
      run: { ...activeRun, status: 'banked' },
      depthReached: 7,
      payout: { credits: 2400, xp: 900, scrap: 35, fraction: 1 },
      profile: {},
    });
    render(
      <>
        <ChamberRundown />
        <EndlessPanel onLeave={() => {}} />
      </>,
    );

    const zone = await screen.findByTestId('chamber-rundown');
    expect(zone.textContent).toContain('Depth 7 cleared');
    expect(zone.textContent).toContain('2,400');
    // Death pays: floor(2,400 × 50 / 100) — the intel's death rule.
    expect(zone.textContent).toContain('1,200 cr');
    // Milestone: next depth 8 → next multiple of 5 is 10.
    expect(zone.textContent).toContain('Depth 10');
    expect(zone.textContent).toContain(endlessEncounterForDepth(8, 20).name);
    const bank = screen.getByTestId('chamber-bank');
    expect(bank.textContent).toContain('Bank & Leave — 2,400 cr · 900 XP · 35 scrap');

    fireEvent.click(bank);
    await waitFor(() => expect(mockBankEndlessRun).toHaveBeenCalledTimes(1));
    // The run ended through the panel: the published view retires
    // and the zone leaves the screen.
    await waitFor(() => expect(screen.queryByTestId('chamber-rundown')).toBeNull());
  });

  it('zone alone: figures come from the lifted state; bank click is an intent, not an action', () => {
    useEndlessRunStore.setState({
      view: {
        runId: 'run-9',
        depthReached: 3,
        startLevel: 12,
        escrowCredits: 1000,
        escrowXp: 40,
        escrowScrap: 5,
        deathPayoutPercent: 50,
        bestDepth: 9,
        busy: false,
      },
      bankRequests: 0,
    });
    render(<ChamberRundown />);
    const zone = screen.getByTestId('chamber-rundown');
    expect(zone.textContent).toContain('Depth 3 cleared');
    expect(zone.textContent).toContain('500 cr');
    fireEvent.click(screen.getByTestId('chamber-bank'));
    expect(useEndlessRunStore.getState().bankRequests).toBe(1);
    expect(mockBankEndlessRun).not.toHaveBeenCalled();
  });
});

const extractionState = (overrides: Partial<ChefExtractionState>): ChefExtractionState => ({
  active: false,
  hasState: true,
  areaId: 'dustwaste_frontier',
  method: 'deep',
  passAreaId: 'dustwaste_frontier',
  passMethod: 'deep',
  accruedMs: 408_000,
  passMs: 600_000,
  pendingPasses: 0,
  finalizedPasses: 2,
  totalXpAwarded: 240,
  mastery: { level: 6, xp: 40 },
  preview: {
    areaId: 'dustwaste_frontier',
    areaName: 'Dustwaste Frontier',
    method: 'deep',
    gearFactor: 0.72,
    survivalPool: 500,
    expectedPassDamage: 320,
    drawsPerPass: 48,
    xpPerPass: 180,
    deepDegraded: true,
    deepUnlocked: true,
    isHot: false,
  },
  settled: { advancedMs: 0, xpAwarded: 0, materials: {}, essences: {}, passes: [] },
  ...overrides,
});

describe('R2 bars — extract zone warning + resume', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExtractionRunStore.setState({ view: null, resumeRequests: 0 });
    useSurvivalStore.setState({ currentHp: 500, maxHp: 1000, shieldHp: 0, isDead: false });
    usePlayerStore.setState({ id: 'test-player', level: 20, credits: 10000, consumables: {} });
  });

  const seedView = (state: ChefExtractionState) =>
    useExtractionRunStore.setState({ view: { state, readAt: Date.now(), starting: false }, resumeRequests: 0 });

  it('paused deep delve below ×0.80: warning prints, countdown and Resume ride the zone', () => {
    seedView(extractionState({}));
    render(<ExtractRundown />);
    const zone = screen.getByTestId('extract-rundown');
    expect(zone.textContent).toContain('Dustwaste Frontier — Deep Delve');
    expect(zone.textContent).toContain('Paused');
    expect(zone.textContent).toContain('3:12');
    expect(zone.textContent).toContain('×0.72');
    expect(screen.getByTestId('extract-rundown-warning').textContent).toContain('Deep Delve paying as Surface — factor below ×0.80');
    expect(screen.getByTestId('extract-resume').textContent).toContain('Resume — Pass 3 · 3:12 left');
  });

  it('deep delve at a healthy factor: no warning', () => {
    seedView(
      extractionState({
        preview: { ...extractionState({}).preview!, gearFactor: 0.85, deepDegraded: false },
      }),
    );
    render(<ExtractRundown />);
    expect(screen.queryByTestId('extract-rundown-warning')).toBeNull();
  });

  it('surface delve below ×0.80: no warning (the floor is a Deep Delve rule)', () => {
    seedView(
      extractionState({
        method: 'surface',
        passMethod: 'surface',
        preview: { ...extractionState({}).preview!, method: 'surface', gearFactor: 0.72 },
      }),
    );
    render(<ExtractRundown />);
    expect(screen.queryByTestId('extract-rundown-warning')).toBeNull();
  });

  it('active deep delve below ×0.80: warning prints, Resume does not (the panel carries active controls)', () => {
    seedView(extractionState({ active: true }));
    render(<ExtractRundown />);
    expect(screen.getByTestId('extract-rundown-warning')).toBeTruthy();
    expect(screen.queryByTestId('extract-resume')).toBeNull();
  });

  it('panel publishes its read; zone Resume starts the SAVED delve through the panel’s own path', async () => {
    mockGetExtractionState.mockResolvedValue({ verified: true, extraction: extractionState({}) });
    render(
      <>
        <ExtractRundown />
        <ExtractionPanel />
      </>,
    );

    const zone = await screen.findByTestId('extract-rundown');
    expect(zone.textContent).toContain('×0.72');
    // The panel itself is untouched: its own paused cause line
    // still prints below the zone.
    expect(screen.getByText(/paused at 3:12 left/)).toBeTruthy();

    fireEvent.click(screen.getByTestId('extract-resume'));
    await waitFor(() => expect(mockStartActiveActivity).toHaveBeenCalledTimes(1));
    expect(mockStartActiveActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'extraction',
        targetId: 'dustwaste_frontier',
        activityPayload: { area_id: 'dustwaste_frontier', method: 'deep' },
      }),
    );
  });
});
