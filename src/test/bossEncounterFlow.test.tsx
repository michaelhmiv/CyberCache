/**
 * Phase 0 Slice 1 — the shipped Fight flow, client side.
 *
 * The prep panel is where boss selection already lives. This test
 * drives the real panel with the real stores and a mocked Chef
 * transport (the boundary the repo's client tests use): preparing
 * consumables and pressing Start must send ONE verify-boss attempt
 * carrying exactly the prepared set + risk, and the returned outcome
 * must surface as the result card with the boss LootMoment on
 * victory. No outcome is computed client-side.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, RiskSetting, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';
import { buildBossFightActivity } from '@/lib/activity/activityBuilders';
import { verifyBossFight, type ChefVerifyBossResult } from '@/lib/chef/chefClient';
import { useActivityStore, useBossStore, useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import { BossEncounterPanel } from '@/components/fight/BossEncounterPanel';

vi.mock('@/lib/chef/chefClient', () => ({ verifyBossFight: vi.fn() }));
vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

const mockVerifyBossFight = vi.mocked(verifyBossFight);

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
      consumablesUsed: { MedKit: 2, AmmoPack: 1 },
      consumablesLost: { MedKit: 2, AmmoPack: 1 },
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
    consumedConsumables: { MedKit: 2, AmmoPack: 1 },
    extraLoot: false,
    bonusLootRolls: 0,
    entryFee: 0,
    dedicatedDropAwarded: false,
    pityIncremented: false,
    telemetry: { serverRolled: true, adjustedWinChance: 0.9, effectiveDps: 500, timeToKill: 2 },
  };
}

describe('BossEncounterPanel — shipped boss flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  it('sends exactly the prepared set + risk in ONE attempt and surfaces the Chef outcome + loot moment', async () => {
    mockVerifyBossFight.mockResolvedValue(victoryResult());
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);

    // Prepare: 2 Med Kits + 1 Ammo Pack (owned 5 / 2 — counts cap at owned).
    fireEvent.click(screen.getByLabelText('Prepare more Med Kit'));
    fireEvent.click(screen.getByLabelText('Prepare more Med Kit'));
    fireEvent.click(screen.getByLabelText('Prepare more Ammo Pack'));
    expect(screen.getByTestId('prepared-MedKit')).toHaveTextContent('2');
    expect(screen.getByTestId('prepared-AmmoPack')).toHaveTextContent('1');

    fireEvent.click(screen.getByTestId('boss-start'));

    await waitFor(() => expect(mockVerifyBossFight).toHaveBeenCalledTimes(1));
    const request = mockVerifyBossFight.mock.calls[0][0];
    expect(request.bossId).toBe(boss.id);
    expect(request.consumables).toEqual({ MedKit: 2, AmmoPack: 1 });
    expect(request.risk).toBe(RiskSetting.Balanced);
    expect(request.attemptNonce).toEqual(expect.any(Number));
    expect(request.primary?.id).toBe(primaryWeapon.id);

    // The Chef's outcome is what renders: result card + victory loot moment.
    expect(await screen.findByTestId('boss-result')).toHaveTextContent('BOSS DEFEATED');
    expect(screen.getByTestId('boss-loot-moment-backdrop')).toBeInTheDocument();
    // The awarded loot was synced into the inventory by the result sync.
    expect(useInventoryStore.getState().items.some((item) => item.id === lootWeapon.id)).toBe(true);
    expect(useBossStore.getState().attemptHistory).toHaveLength(1);
  });

  it('shows intel and prep — never a win chance or readiness verdict', () => {
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);
    const panel = screen.getByTestId('boss-encounter-panel');
    expect(panel).toHaveTextContent(boss.mechanic.name);
    expect(panel).toHaveTextContent(boss.phases[0].name);
    expect(panel).not.toHaveTextContent(/win chance/i);
    expect(panel).not.toHaveTextContent(/readiness/i);
  });

  it('surfaces a Chef rejection as an error and returns to prep', async () => {
    mockVerifyBossFight.mockRejectedValue(new Error('Chef boss verification failed (403): Boss locked'));
    render(<BossEncounterPanel boss={boss} onChangeBoss={() => {}} onLeave={() => {}} />);
    fireEvent.click(screen.getByTestId('boss-start'));
    expect(await screen.findByText(/Boss locked/)).toBeInTheDocument();
    expect(screen.queryByTestId('boss-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('boss-start')).toBeInTheDocument();
  });
});
