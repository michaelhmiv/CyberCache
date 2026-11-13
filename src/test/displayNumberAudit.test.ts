import { describe, expect, it } from 'vitest';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { assembleStatSummaryInput, type StatSummaryAssemblyState } from '@/lib/stats/assembleStatSummaryInput';
import { buildHeroRundown } from '@/lib/stats/heroRundown';
import { computeEffectiveDpsFromGear } from '@/lib/combat/loadoutSurvival';
import { computeSkillBonuses } from '@/lib/skills/skillBonuses';
import { cacheRankBonuses } from '@/content/cacheRank';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { Weapon } from '@/types/items';

const weapon: Weapon = {
  id: 'audit-gun', name: 'Audit gun', level: 20, rarity: Rarity.Rare,
  weaponType: WeaponType.Pistol, manufacturer: Manufacturer.Redline, element: Element.Fire,
  rollQuality: 100, baseDamage: 100, attackSpeed: 2, critChance: 0.2, critDamage: 1.5,
  statusChance: 0, statusDamage: 0, bossDamageMod: 0.2, waveDamageMod: 0.3,
  shieldDamageMod: 0.8, armorDamageMod: 0.6, offlineEarningsMod: 0.1,
  rareDropChanceMod: 0.1, scrapYieldMod: 0.2, parts: [], affixes: [],
  sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 1,
  combatPower: 0, bossPower: 0, farmPower: 0, economyScore: 0,
};
const state: StatSummaryAssemblyState = {
  player: { level: 20, cacheRankSpends: { maxHp: 10, damage: 10 } },
  weapons: [weapon, undefined, { ...weapon, id: 'heavy', weaponType: WeaponType.Launcher }],
  shield: { id: 'audit-shield', name: 'Audit shield', level: 20, rarity: Rarity.Rare,
    hp: 200, mitigation: 0.25, rechargeRate: 10, element: Element.Kinetic,
    affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false, pixelSeed: 2 },
  spent: { gs_dmg_1: 5, demo_ord_1: 3 }, classModBoosts: { nodeBoosts: {} },
  consumableInventory: { AmmoPack: 3, ShieldCell: 2 }, medKitBuffer: 0,
};

describe('display numbers audit', () => {
  it('keeps headline identity stable and formats extra queue slots as counts', () => {
    const input = assembleStatSummaryInput({ ...state, weapons: [{ ...weapon, affixes: [{
      id: 'queue', category: 'activity', stat: 'workshop_serviceModule', value: 0,
      displayText: '+2 Queue Slots', subStats: { parallelQueueSlots: 2 },
    }] }] });
    const summary = buildCharacterStatSummary(input);
    expect(summary.headline.map((m) => m.key)).toEqual(['health', 'dps', 'boss', 'rareFind']);
    const slots = summary.all.find((m) => m.key === 'parallelQueueSlots')!;
    expect(slots.display).toBe('2');
    expect(slots.contributions[0].display).toBe('2');
  });

  it.each([undefined, REGION_1_BOSSES[0]])('core source rows add to their totals with Cache Rank, consumables and boss overrides (%s)', (boss) => {
    const input = assembleStatSummaryInput({ ...state, boss });
    const summary = buildCharacterStatSummary(input);
    for (const metric of summary.all.filter((m) => !m.sourceActivity)) {
      expect(metric.contributions.reduce((sum, c) => sum + c.value, 0), metric.key).toBeCloseTo(metric.value, 8);
    }
    for (const key of ['health', 'dps']) {
      expect(summary.all.find((m) => m.key === key)!.contributions.some((c) => c.source === 'Cache Rank')).toBe(true);
    }
    if (boss) expect(summary.all.find((m) => m.key === 'dps')!.value).toBe(input.bossSimDps);
  });

  it('Dmg/tick uses the Chef roaming input, including wave, break, skill and Cache Rank bonuses', () => {
    const input = assembleStatSummaryInput(state);
    const snapshot = buildCharacterMechanicsSnapshot(input);
    const summary = buildCharacterStatSummary(input, snapshot);
    const bonuses = computeSkillBonuses(state.spent, state.classModBoosts);
    const chefDps = computeEffectiveDpsFromGear({
      weapons: state.weapons.filter((w): w is Weapon => !!w), ordnance: null, relic: null, classMod: null,
      skillDpsMult: 1 + (bonuses.dps ?? 0) + cacheRankBonuses(state.player.cacheRankSpends).damage,
      skillStatusChance: bonuses.statusChance ?? 0,
    });
    const model = buildHeroRundown({
      summary, snapshot, weapons: [weapon], bossContext: false,
      survival: { currentHp: 2000, maxHp: 2290, shieldHp: 200, isDead: false },
    });
    expect(model.dmgTick?.display).toBe(Math.round(chefDps * 3).toLocaleString());
    expect(chefDps).not.toBeCloseTo(summary.all.find((m) => m.key === 'dps')!.value);
  });
});
