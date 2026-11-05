/**
 * assembleStatSummaryInput — the ONE summary-input assembly.
 *
 * Pins: the class-mod boost fold (the truth fix), slot-exact
 * overrides for hypothetical loadouts, and field-for-field parity
 * with the hand-rolled assembly this helper replaced (the
 * assembly-drift pin: a future second assembly cannot land quietly
 * because this helper's output shape is locked here).
 */
import { describe, expect, it } from 'vitest';
import { assembleStatSummaryInput, type StatSummaryAssemblyState } from '@/lib/stats/assembleStatSummaryInput';
import { effectiveSkillPoints } from '@/lib/skills/skillBonuses';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, Weapon } from '@/types/items';
import type { PlayerProfile } from '@/types/player';

const player: PlayerProfile = {
  id: 'test-player',
  name: 'Test Hunter',
  level: 10,
  xp: 0,
  credits: 0,
  scrap: 0,
  cacheKeys: 0,
  legendaryCores: 0,
  currentZoneId: 'zone-1',
  highestZoneId: 'zone-1',
  offlineCapHours: 8,
  lastClaimTime: 0,
  deathFeeInsurance: false,
  consumables: {},
  consumableBatches: [],
  materials: {},
  essences: {},
  workshopQueues: [],
  lastWorkshopTick: 0,
  lastClaimedTick: 0,
};

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

function classMod(id: string, overrides: Partial<ClassMod> = {}): ClassMod {
  return {
    id, name: id, level: 5, rarity: Rarity.Rare,
    treeBonus: 'Scavenger', nodeBoosts: { scav_idle_1: 2 },
    affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    ...overrides,
  };
}

const wornMod = classMod('worn-mod');
const spent = { scav_idle_1: 2, gs_dmg_1: 3 };

function state(overrides: Partial<StatSummaryAssemblyState> = {}): StatSummaryAssemblyState {
  return {
    player,
    weapons: [weapon('primary-gun'), undefined, weapon('heavy-gun')],
    classMod: wornMod,
    spent,
    classModBoosts: { treeBonus: wornMod.treeBonus, nodeBoosts: { ...wornMod.nodeBoosts } },
    medKitBuffer: 25,
    ...overrides,
  };
}

describe('assembleStatSummaryInput', () => {
  it('folds class-mod boosts through effectiveSkillPoints (the truth fix)', () => {
    const input = assembleStatSummaryInput(state());
    // scav_idle_1: 2 spent + 2 nodeBoost, then the Scavenger
    // treeBonus +1 (capped at maxPoints 5) = 5. gs_dmg_1 is a
    // Gunslinger node: untouched by the Scavenger folds, stays 3.
    expect(input.spentSkills.scav_idle_1).toBe(5);
    expect(input.spentSkills.gs_dmg_1).toBe(3);
    expect(input.spentSkills).toEqual(
      effectiveSkillPoints(spent, { treeBonus: 'Scavenger', nodeBoosts: { scav_idle_1: 2 } }),
    );
  });

  it('with no boosts the spent map passes through as effective points unchanged', () => {
    const input = assembleStatSummaryInput(state({ classMod: undefined, classModBoosts: { nodeBoosts: {} } }));
    expect(input.spentSkills).toEqual(spent);
  });

  it('matches the replaced hand-rolled assembly field-for-field (drift pin)', () => {
    const s = state();
    const input = assembleStatSummaryInput(s);
    expect(input).toEqual({
      player: s.player,
      weapons: s.weapons,
      shield: undefined,
      classMod: s.classMod,
      relic: undefined,
      ordnance: undefined,
      spentSkills: effectiveSkillPoints(s.spent, s.classModBoosts),
      boss: undefined,
      activeBuffs: undefined,
      consumableMods: undefined,
      consumableInventory: undefined,
      medKitBuffer: 25,
    });
  });

  it('a weapon override is slot-exact: secondary fills the hole, primary and heavy untouched', () => {
    const candidate = weapon('candidate-gun');
    const input = assembleStatSummaryInput(state(), { slot: 'secondary', item: candidate });
    expect(input.weapons[0]?.id).toBe('primary-gun');
    expect(input.weapons[1]?.id).toBe('candidate-gun');
    expect(input.weapons[2]?.id).toBe('heavy-gun');
  });

  it('a weapon override with null prices the slot empty', () => {
    const input = assembleStatSummaryInput(state(), { slot: 'primary', item: null });
    expect(input.weapons[0]).toBeUndefined();
    expect(input.weapons[2]?.id).toBe('heavy-gun');
  });

  it('a classMod override re-derives boosts from the CANDIDATE mod, not the worn one', () => {
    const candidate = classMod('candidate-mod', { treeBonus: 'Gunslinger', nodeBoosts: { gs_dmg_1: 2 } });
    const input = assembleStatSummaryInput(state(), { slot: 'classMod', item: candidate });
    expect(input.classMod?.id).toBe('candidate-mod');
    // Candidate boosts: gs_dmg_1 nodeBoost +2 (3 spent -> 5) and the
    // Gunslinger treeBonus +1 capped at maxPoints 5 -> still 5.
    // The worn mod's scav_idle_1 boost is GONE: 2 spent, no fold.
    expect(input.spentSkills.gs_dmg_1).toBe(5);
    expect(input.spentSkills.scav_idle_1).toBe(2);
  });

  it('a classMod override with null strips all boosts', () => {
    const input = assembleStatSummaryInput(state(), { slot: 'classMod', item: null });
    expect(input.classMod).toBeUndefined();
    expect(input.spentSkills).toEqual(spent);
  });

  it('a non-classMod override leaves the worn mod and its boosts in place', () => {
    const input = assembleStatSummaryInput(state(), { slot: 'shield', item: null });
    expect(input.classMod?.id).toBe('worn-mod');
    expect(input.spentSkills.scav_idle_1).toBe(5);
  });
});
