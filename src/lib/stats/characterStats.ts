import { SKILL_NODES } from '@/constants/skillTrees';
import type { PlayerProfile } from '@/types/player';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import type { BossDef } from '@/types/boss';
import { computeStandardDps } from '@/lib/stats/dpsChain';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';

export type StatTone = 'amber' | 'green' | 'red' | 'cyan' | 'purple' | 'muted';

export type StatContribution = {
  source: string;
  detail: string;
  value: number;
  display: string;
  tone?: StatTone;
};

export type StatMetric = {
  key: string;
  label: string;
  value: number;
  display: string;
  detail: string;
  tone: StatTone;
  contributions: StatContribution[];
  /**
   * Optional stacked sub-segments for a horizontal bar visualization.
   * Each segment is a (value, display, tone) triple that, summed, equals
   * `value`. The HUD uses this to render a single horizontal bar split
   * by source (e.g., HP bar: base chassis + shield + mitigation). The
   * SourceRow in the modal renders the same data as a contribution list.
   *
   * If absent, the HUD renders no bar for the metric (default text-only).
   * Idle-game convention: a single non-stacked bar uses `stacked = [{...}]`
   * with one entry equal to `value`.
   */
  stacked?: Array<{ value: number; display: string; tone: StatTone; label: string }>;
};

export type CharacterStatSummary = {
  headline: StatMetric[];
  all: StatMetric[];
};

type Input = {
  player: PlayerProfile;
  weapons: Array<Weapon | undefined>;
  shield?: Shield;
  classMod?: ClassMod;
  relic?: Relic;
  ordnance?: Ordnance;
  spentSkills: Record<string, number>;
  /**
   * When a boss is selected on the Dashboard, the DPS metric becomes
   * boss-relative: the displayed value uses computeLoadoutDps with the
   * boss's weaknesses applied, and the detail label switches from
   * "vs standard target" to "vs {boss.name} ({weakness1})".
   */
  boss?: BossDef;
};

const pct = (value: number) => `${Math.round(value * 100)}%`;
const signedPct = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;
const whole = (value: number) => Math.round(value).toLocaleString();
// DPS computation is delegated to the unified modifier chain. The standard
// target (no weakness, no resistance, no consumables) is the right baseline
// for the dashboard stat summary — boss-relative DPS lives in the boss sim.
const weaponDps = (weapon: Weapon) => computeStandardDps(weapon);
const gearAffixes = (gear: Array<GearItem | undefined>, stat: string) => gear.flatMap((item) => ('affixes' in (item ?? {}) && Array.isArray(item?.affixes) ? item.affixes.filter((affix) => affix.stat === stat).map((affix) => ({ item, affix })) : []));

function skillTotal(spent: Record<string, number>, key: string) {
  return Object.entries(spent).reduce((sum, [nodeId, points]) => {
    const node = SKILL_NODES.find((candidate) => candidate.id === nodeId);
    return sum + ((node?.effects[key] ?? 0) * points);
  }, 0);
}

function skillContribs(spent: Record<string, number>, key: string, scalar: number, format: (value: number) => string): StatContribution[] {
  return Object.entries(spent).flatMap(([nodeId, points]) => {
    const node = SKILL_NODES.find((candidate) => candidate.id === nodeId);
    const raw = (node?.effects[key] ?? 0) * points;
    if (!node || !raw) return [];
    const value = raw * scalar;
    return [{ source: node.name, detail: `${points}/${node.maxPoints} · ${node.tree}`, value, display: format(value), tone: 'purple' as StatTone }];
  });
}

function affixContribs(gear: Array<GearItem | undefined>, key: string, scalar: number, format: (value: number) => string): StatContribution[] {
  return gearAffixes(gear, key).map(({ item, affix }) => {
    const value = affix.value * scalar;
    return { source: item?.name ?? 'Gear affix', detail: affix.displayText, value, display: format(value), tone: 'amber' as StatTone };
  });
}

function metric(key: string, label: string, value: number, display: string, detail: string, tone: StatTone, contributions: StatContribution[], stacked?: StatMetric['stacked']): StatMetric {
  return { key, label, value, display, detail, tone, contributions: contributions.filter((entry) => entry.value !== 0), stacked };
}

export function buildCharacterStatSummary(input: Input): CharacterStatSummary {
  const { player, weapons, shield, classMod, relic, ordnance, spentSkills, boss } = input;
  const mechanics = buildCharacterMechanicsSnapshot(input);
  const liveWeapons = weapons.filter((weapon): weapon is Weapon => !!weapon);
  const gear = [...liveWeapons, shield, classMod, relic, ordnance];
  const baseHealth = mechanics.maxHp.contributions.find((entry) => entry.stat === 'baseHp')?.value ?? mechanics.maxHp.value;
  const shieldHp = shield?.hp ?? 0;
  const mitigationHp = Math.max(0, mechanics.effectiveHp.value - mechanics.maxHp.value);
  const totalHealth = mechanics.maxHp.value;
  const baseDps = mechanics.standardWeaponDps.value;
  const weaponDamageBonus = skillTotal(spentSkills, 'weaponDamage') + skillTotal(spentSkills, 'attackSpeed') + skillTotal(spentSkills, 'critChance') * 0.5 + skillTotal(spentSkills, 'critDamage') * 0.5;
  const affixDamageBonus = gearAffixes(gear, 'weaponDamage').reduce((sum, item) => sum + item.affix.value, 0);
  const totalDps = baseDps * (1 + weaponDamageBonus + affixDamageBonus);
  // When a boss is supplied, the DPS metric becomes the boss-relative DPS so
  // the player can read the effective damage they'll deal. Otherwise it stays
  // as the standard-target total. The detail label flips with the context.
  const baseDpsForBoss = boss ? mechanics.bossRelativeDps.value : 0;
  const totalDpsForBoss = baseDpsForBoss * (1 + weaponDamageBonus + affixDamageBonus);
  const dpsDisplayValue = boss ? totalDpsForBoss : totalDps;
  const dpsDetail = boss
    ? `vs ${boss.name} (${(boss.weaknesses[0] ?? 'no weakness').toLowerCase()})`
    : 'weapons + skills + affixes';
  const bossDps = mechanics.simulatedBossDps.value;
  const ordnanceDamage = ordnance?.damage ?? 0;
  const shieldBreak = mechanics.shieldBreak.value;
  const armorBreak = mechanics.armorBreak.value;
  const rareFind = mechanics.lootRareFind.value;
  const offline = mechanics.offlineEarningModifier.value;
  const scrap = mechanics.scrapModifier.value;

  const healthContribs: StatContribution[] = [
    { source: 'Hunter chassis', detail: `Base + level ${player.level}`, value: baseHealth, display: whole(baseHealth), tone: 'muted' },
    shield ? { source: shield.name, detail: 'Shield HP pool', value: shieldHp, display: whole(shieldHp), tone: 'cyan' } : undefined,
  ].filter(Boolean) as StatContribution[];

  const effectiveHpContribs: StatContribution[] = [
    { source: 'Max HP', detail: 'Combat HP before mitigation', value: totalHealth, display: whole(totalHealth), tone: 'green' },
    shield ? { source: shield.name, detail: `Mitigation ${pct(shield.mitigation)}`, value: mitigationHp, display: whole(mitigationHp), tone: 'cyan' } : undefined,
  ].filter(Boolean) as StatContribution[];

  const dpsContribs: StatContribution[] = [
    ...liveWeapons.map((weapon) => ({ source: weapon.name, detail: `${weapon.weaponType} · ${weapon.element}`, value: weaponDps(weapon), display: whole(weaponDps(weapon)), tone: 'red' as StatTone })),
    ...skillContribs(spentSkills, 'weaponDamage', baseDps, whole),
    ...skillContribs(spentSkills, 'attackSpeed', baseDps, whole),
    ...skillContribs(spentSkills, 'critChance', baseDps * 0.5, whole),
    ...skillContribs(spentSkills, 'critDamage', baseDps * 0.5, whole),
    ...affixContribs(gear, 'weaponDamage', baseDps, whole),
  ];

  // DPS label: shows "Base DPS" (raw pooled weapon power) or "Effective DPS"
  // (after all modifiers vs the selected boss). The two-number format answers
  // "what my gear says on paper" vs "what it actually does to this target."
  const dpsLabel = boss ? 'Effective DPS' : 'Base DPS';

  const bossContribs: StatContribution[] = [
    { source: 'Base DPS', detail: 'Weapons + skills + affixes before boss mods', value: totalDps, display: whole(totalDps), tone: 'red' },
    ...liveWeapons.map((weapon) => ({ source: weapon.name, detail: `Boss dmg mod +${Math.round(weapon.bossDamageMod * 100)}%`, value: totalDps * weapon.bossDamageMod / Math.max(1, liveWeapons.length), display: whole(totalDps * weapon.bossDamageMod / Math.max(1, liveWeapons.length)), tone: 'amber' as StatTone })),
    ...skillContribs(spentSkills, 'bossDamageMod', totalDps, whole),
    ...skillContribs(spentSkills, 'bossDamageSniperPistol', totalDps, whole),
    ...skillContribs(spentSkills, 'launcherBossDps', totalDps, whole),
    ...skillContribs(spentSkills, 'weaknessMatchDamage', totalDps, whole),
    // Relic & classMod contributions to boss DPS
    ...(relic ? relic.affixes.filter((a) => a.stat === 'bossDamageMod').map((a) => ({ source: relic.name, detail: a.displayText, value: totalDps * a.value, display: whole(totalDps * a.value), tone: 'amber' as StatTone })) : []),
    ...(classMod ? classMod.affixes.filter((a) => a.stat === 'bossDamageMod').map((a) => ({ source: classMod.name, detail: a.displayText, value: totalDps * a.value, display: whole(totalDps * a.value), tone: 'amber' as StatTone })) : []),
  ];

  const breakContribs = (type: 'shield' | 'armor'): StatContribution[] => [
    ...liveWeapons.map((weapon) => ({ source: weapon.name, detail: `${type === 'shield' ? 'Shield' : 'Armor'} modifier`, value: weaponDps(weapon) * Math.max(0, type === 'shield' ? weapon.shieldDamageMod : weapon.armorDamageMod), display: whole(weaponDps(weapon) * Math.max(0, type === 'shield' ? weapon.shieldDamageMod : weapon.armorDamageMod)), tone: type === 'shield' ? 'cyan' as StatTone : 'amber' as StatTone })),
    ordnance ? { source: ordnance.name, detail: `${ordnance.effect} ordnance`, value: type === 'shield' ? ordnance.shieldDamage : ordnance.armorDamage, display: whole(type === 'shield' ? ordnance.shieldDamage : ordnance.armorDamage), tone: 'red' as StatTone } : undefined,
    ...skillContribs(spentSkills, type === 'shield' ? 'shieldDamageMod' : 'armorDamageMod', baseDps, whole),
    ...skillContribs(spentSkills, type === 'shield' ? 'ordnanceShieldBreak' : 'explosiveArmorBreak', baseDps, whole),
  ].filter(Boolean) as StatContribution[];

  const utilityContribs = (keys: string[], scalar = 1): StatContribution[] => [
    ...liveWeapons.flatMap((weapon) => keys.flatMap((key) => key in weapon ? [{ source: weapon.name, detail: key, value: Number((weapon as unknown as Record<string, number>)[key]), display: signedPct(Number((weapon as unknown as Record<string, number>)[key])), tone: 'amber' as StatTone }] : [])),
    ...keys.flatMap((key) => skillContribs(spentSkills, key, scalar, signedPct)),
    ...keys.flatMap((key) => affixContribs(gear, key, scalar, signedPct)),
  ];

  const all = [
    metric('health', 'Max HP', totalHealth, whole(totalHealth), 'combat HP: chassis + shield', 'green', healthContribs, [
      { value: baseHealth, display: whole(baseHealth), tone: 'muted', label: 'Chassis' },
      ...(shield ? [{ value: shieldHp, display: whole(shieldHp), tone: 'cyan' as StatTone, label: 'Shield' }] : []),
    ]),
    metric('effectiveHp', 'Effective HP', mechanics.effectiveHp.value, whole(mechanics.effectiveHp.value), 'max HP adjusted by mitigation', 'cyan', effectiveHpContribs),
    metric('dps', dpsLabel, dpsDisplayValue, whole(dpsDisplayValue), dpsDetail, 'red', dpsContribs),
    metric('boss', 'vs Boss', bossDps, whole(bossDps), 'Effective DPS with all boss modifiers applied', 'amber', bossContribs),
    metric('shieldBreak', 'Shield Break', shieldBreak, whole(shieldBreak), 'weapon mods + ordnance + skills', 'cyan', breakContribs('shield')),
    metric('armorBreak', 'Armor Break', armorBreak, whole(armorBreak), 'armor mods + ordnance + skills', 'purple', breakContribs('armor')),
    metric('rareFind', 'Rare Find', rareFind, signedPct(rareFind), 'drop chance modifiers', 'amber', utilityContribs(['rareDropChanceMod', 'rareDropChance', 'postBossDropChance'])),
    metric('offline', 'Offline', offline, signedPct(offline), 'idle earning modifiers', 'green', utilityContribs(['offlineEarningsMod', 'offlineEarnings'])),
    metric('scrap', 'Scrap Yield', scrap, signedPct(scrap), 'salvage and scrap modifiers', 'cyan', utilityContribs(['scrapYieldMod', 'scrapYield', 'autoSalvageBonus', 'lowRarityScrapBonus'])),
    metric('ordnance', 'Ordnance', ordnanceDamage, whole(ordnanceDamage), ordnance ? `${ordnance.effect} · ${ordnance.element}` : 'no ordnance slotted', 'red', ordnance ? [{ source: ordnance.name, detail: `${ordnance.effect} payload`, value: ordnanceDamage, display: whole(ordnanceDamage), tone: 'red' }] : []),
  ];

  return { headline: [all[0], all[1], all[2], all[6]], all };
}
