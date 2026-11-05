/**
 * Assembly-drift pin + "The Trade" tape behavior.
 *
 * Drift pin (equip-comparison memo §4, test 2): the summary the
 * live hook produces for seeded store state must equal a summary
 * assembled BY HAND from the same stores through the one helper —
 * a second, divergent assembly cannot land quietly (the
 * BossPickerList disagreement is the cautionary tale).
 *
 * Tape behavior: a mixed trade renders both groups with the
 * resulting value as hero; the equipped piece itself renders no
 * tape; a boosts-only class-mod swap names the skill it moves.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import {
  useActiveBuffsStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useSurvivalStore,
} from '@/store';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { assembleStatSummaryInput } from '@/lib/stats/assembleStatSummaryInput';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import { GearTradeTape } from '@/components/gear/GearTradeTape';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, Weapon } from '@/types/items';

function weapon(id: string, overrides: Partial<Weapon> = {}): Weapon {
  return {
    id, name: id, level: 5, rarity: Rarity.Rare,
    weaponType: WeaponType.SMG, manufacturer: Manufacturer.HelixWorks,
    element: Element.Kinetic, rollQuality: 50, baseDamage: 50, attackSpeed: 2,
    critChance: 0.1, critDamage: 1.5, statusChance: 0.1, statusDamage: 0.5,
    bossDamageMod: 0, waveDamageMod: 0, shieldDamageMod: 0.5, armorDamageMod: 0.5,
    offlineEarningsMod: 0, rareDropChanceMod: 0, scrapYieldMod: 0,
    parts: [], affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    pixelSeed: 1, combatPower: 100, bossPower: 100, farmPower: 100, economyScore: 0,
    ...overrides,
  };
}

const wornGun = weapon('worn-gun', { offlineEarningsMod: 0.3, legendaryEffectId: 'ricochet_gospel' });
const strongGun = weapon('strong-gun', { baseDamage: 90 });
const wornMod: ClassMod = {
  id: 'worn-mod', name: 'worn-mod', level: 5, rarity: Rarity.Rare,
  treeBonus: 'Scavenger', nodeBoosts: { scav_idle_1: 2 },
  affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
};
const plainMod: ClassMod = { ...wornMod, id: 'plain-mod', name: 'plain-mod', nodeBoosts: {} };

function seed() {
  useInventoryStore.setState({ items: [wornGun, strongGun, wornMod, plainMod] });
  useLoadoutStore.setState({
    slots: {
      primary: wornGun.id, secondary: null, heavy: null, ordnance: null,
      shield: null, classMod: wornMod.id, relic: null, vehicle: null,
    },
  });
  useSkillStore.setState({
    spent: { scav_idle_1: 2, gs_dmg_1: 3 },
    classModBoosts: { treeBonus: wornMod.treeBonus, nodeBoosts: { ...wornMod.nodeBoosts } },
  });
  usePlayerStore.setState({ level: 10, consumables: {} });
  useSurvivalStore.setState({ medKitBuffer: 0 });
  useActiveBuffsStore.setState({ buffs: [] });
}

beforeEach(seed);

describe('assembly drift pin', () => {
  it('the live hook summary equals the hand-assembled helper summary for the same stores', () => {
    const { result } = renderHook(() => useCharacterStatSummary());
    const player = usePlayerStore.getState();
    const loadout = useLoadoutStore.getState();
    const skills = useSkillStore.getState();
    const expected = buildCharacterStatSummary(assembleStatSummaryInput({
      player,
      weapons: [loadout.getWeapon('primary'), loadout.getWeapon('secondary'), loadout.getWeapon('heavy')],
      shield: loadout.getShield(),
      classMod: loadout.getClassMod(),
      relic: loadout.getRelic(),
      ordnance: loadout.getOrdnance(),
      spent: skills.spent,
      classModBoosts: skills.classModBoosts,
      activeBuffs: [],
      consumableMods: buildConsumableInventoryMods(player.consumables),
      consumableInventory: player.consumables,
      medKitBuffer: useSurvivalStore.getState().medKitBuffer,
    }));
    expect(result.current.summary.all).toEqual(expected.all);
  });
});

describe('GearTradeTape', () => {
  it('a mixed trade renders both groups and names the equipped baseline', () => {
    const { container } = render(<GearTradeTape candidate={strongGun} />);
    const text = container.textContent ?? '';
    expect(text).toContain('The Trade');
    expect(text).toContain('worn-gun');
    expect(text).toContain('You gain');
    expect(text).toContain('You give up');
    // The legendary the swap loses prints with its description.
    expect(text).toContain('Crits bounce to an additional target');
    // Offline drops (0.30 worn-only mod gone) — a loss line exists.
    expect(text).toContain('Offline');
  });

  it('the equipped piece itself renders no tape', () => {
    const { container } = render(<GearTradeTape candidate={wornGun} />);
    expect(container.textContent ?? '').not.toContain('The Trade');
  });

  it('a boosts-only class-mod swap names the skill node it moves', () => {
    const { container } = render(<GearTradeTape candidate={plainMod} />);
    const text = container.textContent ?? '';
    expect(text).toContain('You give up');
    expect(text).toContain('Uplink Tap');
    expect(text).toContain('-2 skill points');
  });

  it('an identical twin swap reads as an honest No build change', () => {
    const twin = weapon('twin-gun', { offlineEarningsMod: 0.3, legendaryEffectId: 'ricochet_gospel' });
    const { container } = render(<GearTradeTape candidate={twin} />);
    expect(container.textContent ?? '').toContain('No build change');
  });
});
