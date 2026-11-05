/**
 * Gear-truth slice — ONE display DPS.
 *
 * The playtest's same equipped SMG printed 146 on Home (the stat
 * summary), 598 in the Gear header (the pooled engine derivation,
 * which folds shield/armor break pools and ordnance into "DPS"),
 * and 285 on the boss surfaces (a single-weapon chain projection).
 * These tests pin the unification: Home's rundown, the Gear header,
 * and the boss picker chip all print the character stat summary's
 * dps metric — standard context on Home/Gear, boss context (same
 * base, boss inputs) on boss surfaces. The pooled derivation stays
 * where it belongs: pricing claims and duels server-side.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { BossPickerList } from '@/components/fight/BossPickerList';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import { computeEffectiveDpsFromGear } from '@/lib/combat/loadoutSurvival';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { useInventoryStore } from '@/store/slices/inventorySlice';
import { useLoadoutStore } from '@/store/slices/loadoutSlice';
import { usePlayerStore } from '@/store/slices/playerSlice';
import { useSkillStore } from '@/store/slices/skillSlice';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useActiveBuffsStore } from '@/store/slices/activeBuffsSlice';
import { Rarity, WeaponType, Manufacturer, Element, DropSource } from '@/types/game';
import type { Weapon } from '@/types/items';

vi.mock('@/lib/api/verifiedOps', () => ({
  verifiedOps: {
    equipItem: vi.fn(async () => ({})),
    unequipSlot: vi.fn(async () => ({})),
    refuelVehicle: vi.fn(async () => ({})),
    enqueueRepairJob: vi.fn(async () => ({})),
    itemLock: vi.fn(async () => ({})),
    recycleItem: vi.fn(async () => ({})),
    claimCraftedConsumable: vi.fn(async () => ({})),
  },
  fetchWorkshopState: vi.fn(async () => ({
    benches: 1, tools: {}, jobs: [], masteries: {}, activeActionKind: null, recentCompletions: [],
  })),
}));

vi.mock('framer-motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('framer-motion')>();
  return { ...actual, useReducedMotion: () => true };
});

globalThis.IntersectionObserver = vi.fn(function (this: unknown, callback: IntersectionObserverCallback) {
  return {
    observe: (target: Element) => callback([{ isIntersecting: false, target } as unknown as IntersectionObserverEntry], {} as IntersectionObserver),
    unobserve: () => undefined,
    disconnect: () => undefined,
  };
}) as unknown as typeof IntersectionObserver;

const EMPTY_SLOTS = {
  primary: null, secondary: null, heavy: null,
  ordnance: null, shield: null, classMod: null, relic: null, vehicle: null,
} as const;

/** The evidence build: an Epic SMG with fat break/wave mods — the
 *  exact shape whose pooled number diverges from its standard DPS. */
const cacheSmg: Weapon = {
  id: 'cache-smg', name: 'Epic Cache SMG', level: 4, rarity: Rarity.Epic,
  weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks,
  element: Element.Shock, rollQuality: 80, baseDamage: 65, attackSpeed: 1.96,
  critChance: 0.1, critDamage: 1.5, statusChance: 0.2, statusDamage: 0.5,
  bossDamageMod: 0.2, waveDamageMod: 0.3, shieldDamageMod: 0.9, armorDamageMod: 0.8,
  offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
  parts: [], affixes: [], sourceTag: DropSource.CacheForged, isLocked: false,
  pixelSeed: 9, combatPower: 151, bossPower: 200, farmPower: 190, economyScore: 0,
};

function summaryDps(bossId?: string): number {
  const player = usePlayerStore.getState();
  const loadout = useLoadoutStore.getState();
  const boss = bossId ? REGION_1_BOSSES.find((b) => b.id === bossId) : undefined;
  const summary = buildCharacterStatSummary({
    player: player as never,
    weapons: [loadout.getWeapon('primary'), loadout.getWeapon('secondary'), loadout.getWeapon('heavy')]
      .filter((w): w is Weapon => !!w),
    shield: loadout.getShield(),
    classMod: loadout.getClassMod(),
    relic: loadout.getRelic(),
    ordnance: loadout.getOrdnance(),
    spentSkills: useSkillStore.getState().spent,
    boss,
    activeBuffs: [],
    consumableMods: buildConsumableInventoryMods(player.consumables),
    consumableInventory: player.consumables,
    medKitBuffer: useSurvivalStore.getState().medKitBuffer,
  });
  return summary.all.find((entry) => entry.key === 'dps')?.value ?? 0;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useInventoryStore.setState({ items: [cacheSmg] });
  useLoadoutStore.setState({ slots: { ...EMPTY_SLOTS, secondary: 'cache-smg' } });
  usePlayerStore.setState({ level: 6, consumables: {} } as never);
  useSkillStore.setState({ spent: {} });
  useActiveBuffsStore.setState({ buffs: [] });
});

describe('one display DPS', () => {
  it('the fixture actually exercises the old divergence (pooled ≠ summary)', () => {
    const pooled = computeEffectiveDpsFromGear({
      weapons: [cacheSmg],
      ordnance: null,
      relic: null,
      classMod: null,
      skillDpsMult: 1,
      skillStatusChance: 0,
    });
    expect(Math.abs(pooled - summaryDps())).toBeGreaterThan(50);
  });

  it('the Gear header prints the summary DPS — the Home figure', () => {
    const expected = Math.round(summaryDps());
    render(<ActionLoadout />);
    const panel = within(screen.getByTestId('action-loadout'));
    const values = panel.getAllByText(String(expected));
    expect(values.length).toBeGreaterThan(0);
    // And the pooled figure appears nowhere in the panel.
    const pooled = Math.round(computeEffectiveDpsFromGear({
      weapons: [cacheSmg], ordnance: null, relic: null, classMod: null, skillDpsMult: 1, skillStatusChance: 0,
    }));
    expect(panel.queryByText(String(pooled))).toBeNull();
  });

  it('the boss picker chip prints the boss-context summary for the same loadout', () => {
    const tyrant = REGION_1_BOSSES[0];
    const expected = Math.round(summaryDps(tyrant.id));
    render(<BossPickerList onSelect={() => undefined} />);
    const chip = screen.getByTestId(`bossselect-dps-${tyrant.id}`);
    expect(chip.textContent).toContain(String(expected));
    expect(chip.textContent).toContain('Your DPS vs');
  });
});
