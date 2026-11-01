/**
 * Audit fix A — "Truth in numbers", client panel behavior.
 *
 * Drives the real BossEncounterPanel with real stores, a mocked Chef
 * transport, and a mocked activity transport (the repo's client-test
 * boundaries):
 *  - CONS-03: resolving an attempt completes the activity record —
 *    the persisted label becomes the terminal "Defeated <boss>",
 *    never a lingering "Fighting <boss>".
 *  - COPY-01: the victory card itemizes the server's settled fields —
 *    reward line, a fee line ONLY when a fee was charged (labeled by
 *    the server's feeKind), then the net.
 *  - DATA-01: the fight card's Player row shows the hunter's real
 *    account HP (survival store), not the simulation timeline's
 *    narrative pool.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import type { ActiveActivity, StartActivityInput } from '@/types/activity';
import { buildBossFightActivity } from '@/lib/activity/activityBuilders';
import { verifyBossFight, type ChefVerifyBossResult } from '@/lib/chef/chefClient';
import { startActiveActivity } from '@/lib/api/activityService';
import {
  useActivityStore, useBossStore, useInventoryStore, useLoadoutStore, usePlayerStore, useSurvivalStore,
} from '@/store';
import { BossEncounterPanel } from '@/components/fight/BossEncounterPanel';

vi.mock('@/lib/chef/chefClient', () => ({
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
      noKeystoneNote: 'No action skill yet — own any skill tree’s keystone to unlock its signature ability.',
    },
  })),
}));

vi.mock('@/lib/api/activityService', () => {
  const idle: ActiveActivity = {
    kind: 'idle_standby', bossPhase: 'prep', startedAt: null, completesAt: null,
    targetType: null, targetId: null, targetLabel: null, sceneKey: null, notes: null,
    activityPayload: {}, publicPayload: {}, lastHeartbeatAt: null,
    publicVisible: true, schemaVersion: 1, updatedAt: null,
  };
  return {
    startActiveActivity: vi.fn(async (input: StartActivityInput): Promise<ActiveActivity> => ({
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

// The fight animation can be held open (DATA-01 inspects the card
// mid-fight) or released; otherwise the real animation runs.
const gate = vi.hoisted(() => ({ hold: false, release: null as null | (() => void) }));
vi.mock('@/lib/animation/fightTimeline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/animation/fightTimeline')>();
  return {
    ...actual,
    runFightAnimation: async (
      initial: Parameters<typeof actual.runFightAnimation>[0],
      phases: Parameters<typeof actual.runFightAnimation>[1],
      reduced: boolean,
      cancel: { cancelled: boolean },
      onSnapshot: Parameters<typeof actual.runFightAnimation>[4],
    ) => {
      if (gate.hold) {
        await new Promise<void>((resolve) => { gate.release = resolve; });
        if (cancel.cancelled) return initial;
      }
      return actual.runFightAnimation(initial, phases, reduced, cancel, onSnapshot);
    },
  };
});

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

const mockVerifyBossFight = vi.mocked(verifyBossFight);
const mockStartActivity = vi.mocked(startActiveActivity);

/**
 * The result stage arrives after the Sample-B animation (~seconds of
 * wall clock); findBy's 1s default flakes under full-suite load, so
 * every result wait in this file uses an explicit generous timeout.
 */
async function awaitResultCard(): Promise<HTMLElement> {
  await waitFor(() => expect(screen.getByTestId('boss-result')).toBeInTheDocument(), { timeout: 15000 });
  return screen.getByTestId('boss-result');
}

const boss = REGION_1_BOSSES[0]; // Dune Tyrant — free entry

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
const lootWeapon = makeWeapon('loot-gun', 'Dune Spoils');

function victoryResult(over: Partial<ChefVerifyBossResult> = {}): ChefVerifyBossResult {
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
      loot: [lootWeapon.id],
      reasons: ['Victory: Dune Tyrant defeated with current prep.'],
      recommendations: [],
    },
    creditsDelta: 750,
    xpAwarded: 100,
    loot: [lootWeapon],
    items: [lootWeapon],
    consumedConsumables: {},
    extraLoot: false,
    bonusLootRolls: 0,
    entryFee: 0,
    creditsReward: 750,
    feeKind: null,
    levelBefore: 20,
    levelAfter: 20,
    dedicatedDropAwarded: false,
    pityIncremented: false,
    telemetry: { serverRolled: true, adjustedWinChance: 0.9, effectiveDps: 500, timeToKill: 2 },
    ...over,
  };
}

describe('BossEncounterPanel — truth in numbers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gate.hold = false;
    gate.release = null;
    usePlayerStore.setState({ id: 'test-player', level: 20, credits: 10000, consumables: { MedKit: 5, AmmoPack: 2 } });
    useInventoryStore.setState({ items: [primaryWeapon] });
    useLoadoutStore.setState({ slots: { primary: primaryWeapon.id, secondary: null, heavy: null, shield: null, ordnance: null, classMod: null, relic: null } });
    useBossStore.setState({
      currentBossId: boss.id,
      unlockedBossIds: [boss.id],
      defeatedBossIds: [],
      pityCounters: {},
      preparedConsumables: {},
      selectedRisk: RiskSetting.Balanced,
      attemptHistory: [],
    });
    useActivityStore.setState({ current: buildBossFightActivity(boss, primaryWeapon, 'prep'), pending: false });
    // The walk's account state: HP 749/760 throughout the boss fight.
    useSurvivalStore.setState({ currentHp: 749, maxHp: 760, isDead: false });
  });

  it('CONS-03 + COPY-01: a resolved victory completes the activity and itemizes a free entry truthfully', async () => {
    mockVerifyBossFight.mockResolvedValue(victoryResult());
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);

    fireEvent.click(screen.getByTestId('boss-start'));

    const resultCard = await awaitResultCard();
    expect(resultCard).toHaveTextContent('BOSS DEFEATED');
    // Itemized from the server fields: reward, NO fee line (none was
    // charged), then the net. The walk's card invented a rematch fee
    // for exactly this free first entry.
    expect(resultCard).toHaveTextContent('Reward +750cr');
    expect(resultCard).toHaveTextContent('Credits +750 net');
    expect(resultCard).not.toHaveTextContent(/fee/i);

    // The activity record was completed with the terminal label —
    // this is the same publicPayload Profile and Dashboard read, so
    // neither can keep claiming "Fighting Dune Tyrant" after a reload.
    await waitFor(() => {
      expect(useActivityStore.getState().current.publicPayload.activity_label).toBe(`Defeated ${boss.name}`);
    }, { timeout: 15000 });
    expect(useActivityStore.getState().current.bossPhase).toBe('resolved');
    const resolvedCall = mockStartActivity.mock.calls
      .map((call) => call[0])
      .find((input) => input.bossPhase === 'resolved');
    expect(resolvedCall).toBeDefined();
    expect(resolvedCall!.publicPayload.activity_label).toBe(`Defeated ${boss.name}`);
  });

  it('COPY-01: a real rematch fee is itemized as a fee line, labeled by the server', async () => {
    mockVerifyBossFight.mockResolvedValue(victoryResult({
      entryFee: 400,
      feeKind: 'rematch',
      creditsDelta: 350,
      creditsReward: 750,
    }));
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);

    fireEvent.click(screen.getByTestId('boss-start'));

    const resultCard = await awaitResultCard();
    expect(resultCard).toHaveTextContent('Reward +750cr');
    expect(resultCard).toHaveTextContent('Rematch fee −400cr');
    expect(resultCard).toHaveTextContent('Credits +350 net');
  });

  it('DATA-01: the fight card Player row shows the real account HP, not the simulation pool', async () => {
    gate.hold = true;
    mockVerifyBossFight.mockResolvedValue(victoryResult());
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);

    fireEvent.click(screen.getByTestId('boss-start'));

    // Mid-fight: the timeline's pool for a level-20 hunter is 1,900 —
    // the row must show the survival store's untouched 749 / 760.
    await waitFor(() => expect(screen.getByTestId('fight-player-hp')).toBeInTheDocument(), { timeout: 15000 });
    expect(screen.getByText('749 / 760')).toBeInTheDocument();
    expect(screen.queryByText('1,900 / 1,900')).not.toBeInTheDocument();
    expect(screen.getByText(/Account HP/)).toBeInTheDocument();

    gate.release?.();
    expect(await awaitResultCard()).toHaveTextContent('BOSS DEFEATED');
  });
});
