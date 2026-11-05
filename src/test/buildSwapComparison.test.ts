/**
 * buildSwapComparison — "The Trade" correctness pins.
 *
 * The core pin is post-equip equivalence: the trade's candidate
 * side must equal the summary of the loadout you would actually
 * have after equipping — assembled here by hand, independently of
 * the override path the trade itself uses. Around it: the
 * class-mod blind spot (a boosts-only swap must show its skill
 * change), keystone qualification crossings, the honest no-change
 * state, legendary lines with descriptions, XP priced from the
 * snapshot, and boss-context DPS honoring the input's boss.
 */
import { describe, expect, it } from 'vitest';
import { buildSwapComparison, type TradeMetricLine } from '@/lib/stats/buildSwapComparison';
import { assembleStatSummaryInput, type StatSummaryAssemblyState } from '@/lib/stats/assembleStatSummaryInput';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { stageStatDelta } from '@/lib/stats/heroRundown';
import { classModBoostsOf } from '@/lib/skills/skillBonuses';
import { qualifiedActionSkillTrees } from '@/content/actionSkills';
import { legendaryEffectName } from '@/constants/legendaryEffects';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DropSource, Element, Manufacturer, Rarity, WeaponType } from '@/types/game';
import type { ClassMod, Weapon } from '@/types/items';
import type { PlayerProfile } from '@/types/player';

const player: PlayerProfile = {
  id: 'test-player', name: 'Test Hunter', level: 10, xp: 0, credits: 0, scrap: 0,
  cacheKeys: 0, legendaryCores: 0, cacheRankTokens: 0, cacheRankSpends: {}, vehicleFuel: 0,
  currentZoneId: 'zone-1', highestZoneId: 'zone-1', offlineCapHours: 8,
  lastClaimTime: 0, deathFeeInsurance: false, consumables: {}, consumableBatches: [],
  materials: {}, essences: {}, workshopQueues: [], lastWorkshopTick: 0, lastClaimedTick: 0,
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
    treeBonus: 'Scavenger', nodeBoosts: {},
    affixes: [], sourceTag: DropSource.WorldDrop, isLocked: false,
    ...overrides,
  };
}

const spent = { scav_idle_1: 2, gs_dmg_1: 3 };

function state(overrides: Partial<StatSummaryAssemblyState> = {}): StatSummaryAssemblyState {
  return {
    player,
    weapons: [weapon('worn-gun')],
    spent,
    classModBoosts: { nodeBoosts: {} },
    ...overrides,
  };
}

function tradeFor(
  s: StatSummaryAssemblyState,
  slot: 'primary' | 'classMod',
  candidate: Weapon | ClassMod,
  currentItem: Weapon | ClassMod | undefined,
) {
  const currentInput = assembleStatSummaryInput(s);
  const candidateInput = assembleStatSummaryInput(s, { slot, item: candidate });
  const candidateBoosts = slot === 'classMod' ? classModBoostsOf(candidate as ClassMod) : s.classModBoosts;
  return buildSwapComparison(currentInput, candidateInput, {
    currentItem,
    candidateItem: candidate,
    spent: s.spent,
    currentQualified: qualifiedActionSkillTrees(s.spent, s.classModBoosts),
    candidateQualified: qualifiedActionSkillTrees(s.spent, candidateBoosts),
  });
}

const metricLine = (lines: unknown[], label: string) =>
  lines.find((l): l is TradeMetricLine => (l as TradeMetricLine).kind === 'metric' && (l as TradeMetricLine).label === label);

describe('buildSwapComparison', () => {
  it('post-equip equivalence: trade heroes equal the real post-swap summary', () => {
    const worn = weapon('worn-gun');
    const candidate = weapon('candidate-gun', { baseDamage: 80, offlineEarningsMod: 0.2 });
    const s = state({ weapons: [worn] });
    const trade = tradeFor(s, 'primary', candidate, worn);

    // The post-swap loadout, assembled BY HAND (no override path):
    const postSwapSummary = buildCharacterStatSummary(assembleStatSummaryInput(state({ weapons: [candidate] })));
    const currentSummary = buildCharacterStatSummary(assembleStatSummaryInput(s));

    const postDps = postSwapSummary.all.find((m) => m.key === 'dps');
    const curDps = currentSummary.all.find((m) => m.key === 'dps');
    const dpsLine = metricLine([...trade.gains, ...trade.losses], 'DPS');
    expect(dpsLine).toBeDefined();
    expect(dpsLine?.hero).toBe(postDps?.display);
    expect(dpsLine?.delta).toBe(stageStatDelta(curDps!.value, postDps!.value)?.display);
    expect(dpsLine?.tone).toBe('gain');

    const offlineLine = metricLine([...trade.gains, ...trade.losses], 'Offline');
    expect(offlineLine?.hero).toBe(postSwapSummary.all.find((m) => m.key === 'offline')?.display);
    expect(offlineLine?.delta).toBe('+20%');

    expect(trade.hasBuildChange).toBe(true);
  });

  it('a boosts-only class-mod swap shows its skill change (the old blind spot)', () => {
    const worn = classMod('worn-mod', { nodeBoosts: { scav_idle_1: 2 } });
    const candidate = classMod('candidate-mod', { nodeBoosts: {} });
    const s = state({
      classMod: worn,
      classModBoosts: { treeBonus: worn.treeBonus, nodeBoosts: { ...worn.nodeBoosts } },
    });
    const trade = tradeFor(s, 'classMod', candidate, worn);
    // Identical item stats, different boosts: the Offline metric
    // must fall and the node line must name the skill.
    const offlineLine = metricLine(trade.losses, 'Offline');
    expect(offlineLine).toBeDefined();
    expect(offlineLine?.delta).toBe('-30%');
    expect(trade.losses.some((l) => l.kind === 'note' && l.label === 'Uplink Tap' && l.text === '-2 skill points')).toBe(true);
    expect(trade.hasBuildChange).toBe(true);
  });

  it('a keystone-crossing mod names the action skill it unlocks — and its loss', () => {
    const worn = classMod('worn-mod');
    const candidate = classMod('candidate-mod', { nodeBoosts: { gs_keystone: 1 } });
    const s = state({ classMod: worn, spent: {} });
    const trade = tradeFor(s, 'classMod', candidate, worn);
    expect(trade.gains.some((l) => l.kind === 'note' && l.text === 'Qualifies for Deadeye Salvo')).toBe(true);

    const s2 = state({
      classMod: candidate,
      classModBoosts: classModBoostsOf(candidate),
      spent: {},
    });
    const reverse = tradeFor(s2, 'classMod', worn, candidate);
    expect(reverse.losses.some((l) => l.kind === 'note' && l.text === 'Loses Deadeye Salvo qualification')).toBe(true);
  });

  it('a stat-identical swap is an honest "No build change"', () => {
    const worn = weapon('worn-gun');
    const twin = weapon('twin-gun');
    const trade = tradeFor(state({ weapons: [worn] }), 'primary', twin, worn);
    expect(trade.hasBuildChange).toBe(false);
    expect(trade.gains).toHaveLength(0);
    expect(trade.losses).toHaveLength(0);
  });

  it('losing a legendary prints its name AND its description', () => {
    const worn = weapon('worn-gun', { legendaryEffectId: 'ricochet_gospel' });
    const candidate = weapon('candidate-gun', { baseDamage: 90 });
    const trade = tradeFor(state({ weapons: [worn] }), 'primary', candidate, worn);
    const line = trade.losses.find((l) => l.kind === 'note' && l.label === 'Legendary');
    expect(line).toBeDefined();
    expect(line && 'text' in line ? line.text : '').toContain(legendaryEffectName('ricochet_gospel'));
    expect(line && 'text' in line ? line.text : '').toContain('Crits bounce to an additional target');
  });

  it('XP moves price from the snapshot when an affix changes them', () => {
    const worn = weapon('worn-gun', {
      affixes: [{ id: 'a1', category: 'idle', stat: 'xpBoostMod', value: 0.1, displayText: '+10% XP Gain' }],
    });
    const candidate = weapon('candidate-gun');
    const trade = tradeFor(state({ weapons: [worn] }), 'primary', candidate, worn);
    const xpLine = metricLine(trade.losses, 'XP');
    expect(xpLine).toBeDefined();
    expect(xpLine?.delta).toBe('-10%');
    // The affix itself is also a first-class loss line.
    expect(trade.losses.some((l) => l.kind === 'note' && l.text === '+10% XP Gain')).toBe(true);
  });

  it('empty slot: a first weapon prices as a pure gain, hero from the post-equip summary', () => {
    const candidate = weapon('first-gun', { baseDamage: 80 });
    const s = state({ weapons: [] });
    const currentInput = assembleStatSummaryInput(s);
    const candidateInput = assembleStatSummaryInput(s, { slot: 'primary', item: candidate });
    const trade = buildSwapComparison(currentInput, candidateInput, {
      currentItem: undefined,
      candidateItem: candidate,
      spent: s.spent,
      currentQualified: qualifiedActionSkillTrees(s.spent, s.classModBoosts),
      candidateQualified: qualifiedActionSkillTrees(s.spent, s.classModBoosts),
    });
    const postSwapSummary = buildCharacterStatSummary(candidateInput);
    const dpsLine = metricLine(trade.gains, 'DPS');
    expect(dpsLine).toBeDefined();
    expect(dpsLine?.hero).toBe(postSwapSummary.all.find((m) => m.key === 'dps')?.display);
    expect(dpsLine?.delta).toBe('New');
    expect(trade.losses).toHaveLength(0);
    expect(trade.hasBuildChange).toBe(true);
  });

  it('boss context: the trade DPS hero follows the boss carried by the inputs', () => {
    // A REAL boss def (Heap Guard, weak to Shock): the candidate
    // differs ONLY by element, so standard DPS is identical on both
    // sides and any DPS line can only come from boss pricing.
    const boss = REGION_1_BOSSES.find((b) => b.id === 'heap_guard')!;
    const worn = weapon('worn-gun');
    const candidate = weapon('candidate-gun', { element: Element.Shock });
    const s = state({ weapons: [worn], boss });
    const trade = tradeFor(s, 'primary', candidate, worn);
    const candidateSummary = buildCharacterStatSummary(
      assembleStatSummaryInput(state({ weapons: [candidate], boss })),
    );
    const dpsLine = metricLine([...trade.gains, ...trade.losses], 'Eff. DPS');
    expect(dpsLine).toBeDefined();
    expect(dpsLine?.hero).toBe(candidateSummary.all.find((m) => m.key === 'dps')?.display);
    expect(dpsLine?.tone).toBe('gain');
    // The same swap with no boss selected prices no DPS line at
    // all — the gain exists only against this boss.
    const noBoss = tradeFor(state({ weapons: [worn] }), 'primary', candidate, worn);
    expect(metricLine([...noBoss.gains, ...noBoss.losses], 'DPS')).toBeUndefined();
    expect(metricLine([...noBoss.gains, ...noBoss.losses], 'Eff. DPS')).toBeUndefined();
  });
});
