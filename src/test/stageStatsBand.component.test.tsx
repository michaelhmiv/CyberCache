/**
 * Stage stats band — component pins.
 *
 *  - The band renders the CURRENT action's effective stats from
 *    the live stores (DPS hero + its green delta when gear affixes
 *    lift it off the weapons' base pool).
 *  - The Loadout door at the band's end fires onOpenLoadout.
 *  - In the diorama ribbon, the band REPLACES the old latest-event
 *    line; without a band the ribbon keeps its legacy line (the
 *    standalone-render contract the other stage tests rely on).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StageStatsBand } from '../components/dashboard/StageStatsBand';
import { LiveTurfDiorama } from '../components/dashboard/LiveTurfDiorama';
import {
  useActivityStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSurvivalStore,
} from '../store';
import { IDLE_ACTIVITY } from '../types/activity';
import { ROAMING_AREAS } from '../constants/roamingAreas';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '../types/game';
import type { Weapon } from '../types/items';

function makeWeapon(overrides: Partial<Weapon> = {}): Weapon {
  return {
    id: 'band-weapon',
    name: 'Band Gun',
    level: 5,
    rarity: Rarity.Epic,
    weaponType: WeaponType.SMG,
    manufacturer: Manufacturer.Redline,
    element: Element.Fire,
    rollQuality: 75,
    baseDamage: 100,
    attackSpeed: 5,
    critChance: 0.2,
    critDamage: 1.5,
    statusChance: 0.1,
    statusDamage: 1.0,
    bossDamageMod: 0,
    waveDamageMod: 0,
    shieldDamageMod: 0,
    armorDamageMod: 0,
    offlineEarningsMod: 0,
    rareDropChanceMod: 0,
    scrapYieldMod: 0,
    parts: [],
    affixes: [],
    sourceTag: 'cacheKey' as DropSource,
    isLocked: false,
    pixelSeed: 12345,
    combatPower: 0,
    bossPower: 0,
    farmPower: 0,
    economyScore: 0,
    ...overrides,
  };
}

function seedStores(weapon: Weapon) {
  usePlayerStore.setState({
    level: 5,
    xp: 0,
    credits: 100,
    scrap: 0,
    consumables: {},
    materials: {},
    essences: {},
    vehicleFuel: 0,
    offlineCapHours: 0,
  });
  useInventoryStore.setState({ items: [weapon] });
  useLoadoutStore.setState({
    slots: { primary: weapon.id, secondary: null, heavy: null, shield: null, classMod: null, relic: null, ordnance: null, vehicle: null },
  });
  useSurvivalStore.setState({
    currentHp: 900,
    maxHp: 1000,
    shieldHp: 0,
    medKitBuffer: 0,
    nanoSwarmTicksRemaining: 0,
    isDead: false,
  });
  useActivityStore.setState({ current: { ...IDLE_ACTIVITY, kind: 'roaming_loot' } });
}

describe('StageStatsBand component', () => {
  beforeEach(() => {
    seedStores(makeWeapon());
  });

  it('renders the roaming band from the live stores: DPS hero, HP, gathering faucet', () => {
    render(<StageStatsBand onOpenLoadout={() => {}} />);
    const band = screen.getByTestId('stage-stats-band');
    expect(within(band).getByTestId('stage-stat-dps')).toBeTruthy();
    expect(within(band).getByTestId('stage-stat-hp').textContent).toContain('900/1,000');
    expect(within(band).getByTestId('stage-stat-credits')).toBeTruthy();
    // Unmodified loadout: no delta on DPS.
    expect(within(band).queryByTestId('stage-stat-dps-delta')).toBeNull();
  });

  it('a +50% weapon-damage affix prints the green delta beside the DPS hero', () => {
    seedStores(makeWeapon({
      affixes: [{ id: 'aff-1', category: 'combat', stat: 'weaponDamage', value: 0.5, displayText: '+50% weapon damage' }],
    }));
    render(<StageStatsBand onOpenLoadout={() => {}} />);
    const delta = screen.getByTestId('stage-stat-dps-delta');
    expect(delta.textContent).toBe('+50%');
    expect(delta.className).toContain('text-green');
  });

  it('the Loadout door fires onOpenLoadout', () => {
    const onOpenLoadout = vi.fn();
    render(<StageStatsBand onOpenLoadout={onOpenLoadout} />);
    fireEvent.click(screen.getByTestId('stage-stats-loadout'));
    expect(onOpenLoadout).toHaveBeenCalledTimes(1);
  });
});

describe('LiveTurfDiorama ribbon slot', () => {
  beforeEach(() => {
    seedStores(makeWeapon());
  });

  it('with a band, the ribbon carries the stats — the old event line is gone', () => {
    render(
      <LiveTurfDiorama
        area={ROAMING_AREAS[0]}
        playerLevel={5}
        equippedCount={1}
        activityKind="roaming_loot"
        statsBand={<StageStatsBand onOpenLoadout={() => {}} />}
      />,
    );
    const ribbon = screen.getByTestId('diorama-status-ribbon');
    expect(within(ribbon).getByTestId('stage-stats-band')).toBeTruthy();
    expect(within(ribbon).getByTestId('stage-stats-loadout')).toBeTruthy();
    // The legacy latest-event/caption line (roaming's caption is
    // "scanning turf for real drops") no longer prints in the band
    // ribbon.
    expect(within(ribbon).queryByText(/scanning turf/)).toBeNull();
  });

  it('without a band, the ribbon keeps its legacy line', () => {
    render(
      <LiveTurfDiorama
        area={ROAMING_AREAS[0]}
        playerLevel={5}
        equippedCount={1}
        activityKind="roaming_loot"
      />,
    );
    const ribbon = screen.getByTestId('diorama-status-ribbon');
    expect(within(ribbon).queryByTestId('stage-stats-band')).toBeNull();
    expect(ribbon.textContent).toContain('scanning turf');
  });
});
