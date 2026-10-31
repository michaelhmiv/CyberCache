import { SKILL_NODES } from '@/constants/skillTrees';
import { WeaponType } from '@/types/game';
import type { BossDef } from '@/types/boss';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import type { PlayerProfile } from '@/types/player';
import { computeHunterMaxHp } from '@/lib/combat/damageContract';
import { computeBossRelativeDps, computeStandardDps } from '@/lib/stats/dpsChain';
import { STAT_SOURCE_BUCKETS, type StatSourceBucket } from '@/lib/stats/sourceBuckets';

export type MechanicsContribution = {
  bucket: MechanicsContributionBucket;
  source: string;
  stat: string;
  value: number;
};

export type MechanicsContributionBucket = StatSourceBucket;

export const MECHANICS_CONTRIBUTION_BUCKETS: MechanicsContributionBucket[] = [...STAT_SOURCE_BUCKETS];

export type MechanicsScalar = {
  value: number;
  contributions: MechanicsContribution[];
  buckets: Record<MechanicsContributionBucket, number>;
};

export type CharacterMechanicsSnapshot = {
  maxHp: MechanicsScalar;
  shield: MechanicsScalar;
  mitigation: MechanicsScalar;
  effectiveHp: MechanicsScalar;
  standardWeaponDps: MechanicsScalar;
  bossRelativeDps: MechanicsScalar;
  simulatedBossDps: MechanicsScalar;
  shieldBreak: MechanicsScalar;
  armorBreak: MechanicsScalar;
  ordnanceContribution: MechanicsScalar;
  lootRareFind: MechanicsScalar;
  scrapModifier: MechanicsScalar;
  xpModifier: MechanicsScalar;
  offlineEarningModifier: MechanicsScalar;
};

export type BuildCharacterMechanicsSnapshotInput = {
  player: PlayerProfile;
  weapons: Array<Weapon | undefined>;
  shield?: Shield;
  classMod?: ClassMod;
  relic?: Relic;
  ordnance?: Ordnance;
  spentSkills: Record<string, number>;
  boss?: BossDef;
  activityMods?: Record<string, number>;
  consumableMods?: Record<string, number>;
  bossSimDps?: number;
};

function liveWeapons(weapons: Array<Weapon | undefined>): Weapon[] {
  return weapons.filter((weapon): weapon is Weapon => Boolean(weapon));
}

function skillTotal(spent: Record<string, number>, key: string): number {
  return Object.entries(spent).reduce((sum, [nodeId, points]) => {
    const node = SKILL_NODES.find((candidate) => candidate.id === nodeId);
    return sum + ((node?.effects[key] ?? 0) * points);
  }, 0);
}

function affixTotal(gear: Array<GearItem | undefined>, key: string): number {
  return gear.reduce((sum, item) => {
    if (!item || !('affixes' in item)) return sum;
    return sum + item.affixes.reduce((inner, affix) => inner + (affix.stat === key ? affix.value : 0), 0);
  }, 0);
}

function contribution(bucket: MechanicsContributionBucket, source: string, stat: string, value: number): MechanicsContribution {
  return { bucket, source, stat, value };
}

function scalar(value: number, contributions: MechanicsContribution[]): MechanicsScalar {
  const buckets = Object.fromEntries(MECHANICS_CONTRIBUTION_BUCKETS.map((bucket) => [bucket, 0])) as Record<MechanicsContributionBucket, number>;
  contributions.forEach((entry) => {
    buckets[entry.bucket] += entry.value;
  });
  return {
    value,
    contributions,
    buckets,
  };
}

function recordTotal(mods: Record<string, number> | undefined, keys: string[]): number {
  if (!mods) return 0;
  return keys.reduce((sum, key) => sum + (Number(mods[key]) || 0), 0);
}

export function buildCharacterMechanicsSnapshot(input: BuildCharacterMechanicsSnapshotInput): CharacterMechanicsSnapshot {
  const weapons = liveWeapons(input.weapons);
  const gear = [...weapons, input.shield, input.classMod, input.relic, input.ordnance];
  const shieldHp = input.shield?.hp ?? 0;
  const baseHp = computeHunterMaxHp(input.player.level, 0);
  const maxHp = computeHunterMaxHp(input.player.level, shieldHp);
  const mitigation = Math.min(0.8, input.shield?.mitigation ?? 0);
  const effectiveHp = Math.round(maxHp / Math.max(0.2, 1 - mitigation));
  const standardWeaponDps = weapons.reduce((sum, weapon) => sum + computeStandardDps(weapon), 0);
  const bossRelativeDps = input.boss
    ? computeBossRelativeDps(weapons, input.boss.weaknesses, input.boss.resistances)
    : standardWeaponDps;
  const skillDamageBonus =
    skillTotal(input.spentSkills, 'weaponDamage') +
    skillTotal(input.spentSkills, 'attackSpeed') +
    skillTotal(input.spentSkills, 'critChance') * 0.5 +
    skillTotal(input.spentSkills, 'critDamage') * 0.5;
  const gearDamageBonus = affixTotal(gear, 'weaponDamage');
  // Conditional major bonuses (Phase 2d): the boss sim applies these
  // only when their condition holds, and the display must not promise
  // them otherwise. Weapons arrive slot-ordered (primary first): the
  // primary drives Focus Fire; Scorched Earth's DPS half is checked
  // against any Launcher in the set (the sim itself is slot-exact —
  // this scalar stays the documented display approximation);
  // Elemental Overclock needs a weakness match against the boss.
  const primaryWeapon = weapons[0];
  const skillBossBonus =
    skillTotal(input.spentSkills, 'bossDamageMod') +
    (primaryWeapon && (primaryWeapon.weaponType === WeaponType.Sniper || primaryWeapon.weaponType === WeaponType.Pistol)
      ? skillTotal(input.spentSkills, 'bossDamageSniperPistol')
      : 0) +
    (weapons.some((weapon) => weapon.weaponType === WeaponType.Launcher)
      ? skillTotal(input.spentSkills, 'launcherBossDps')
      : 0) +
    (input.boss && weapons.some((weapon) => input.boss!.weaknesses.includes(weapon.element))
      ? skillTotal(input.spentSkills, 'weaknessMatchDamage')
      : 0);
  const gearBossBonus = affixTotal([input.classMod, input.relic], 'bossDamageMod');
  // NOTE: skill and gear damage bonuses are flat lump-sum multipliers
  // applied post-hoc on top of bossRelativeDps. This is a display-layer
  // approximation — the full DPS chain in computeWeaponDps() handles crit,
  // status, and signature per-weapon. skill/affix bonuses are summed here
  // rather than threaded into the per-weapon chain to keep the snapshot
  // fast and the contribution trace readable. For the authoritative combat
  // number, use bossSimulator.simulateBoss() which runs the full chain.
  const playerDamageBonus = skillDamageBonus + gearDamageBonus + skillBossBonus + gearBossBonus;
  const bossDpsAfterPlayerMods = bossRelativeDps * (1 + playerDamageBonus);
  const weaponShieldBreak = weapons.reduce((sum, weapon) => sum + computeStandardDps(weapon) * Math.max(0, weapon.shieldDamageMod), 0);
  const weaponArmorBreak = weapons.reduce((sum, weapon) => sum + computeStandardDps(weapon) * Math.max(0, weapon.armorDamageMod), 0);
  const skillShieldBreak = standardWeaponDps * (skillTotal(input.spentSkills, 'shieldDamageMod') + skillTotal(input.spentSkills, 'ordnanceShieldBreak'));
  const skillArmorBreak = standardWeaponDps * (skillTotal(input.spentSkills, 'armorDamageMod') + skillTotal(input.spentSkills, 'explosiveArmorBreak'));
  const shieldBreak = weaponShieldBreak + (input.ordnance?.shieldDamage ?? 0) + skillShieldBreak;
  const armorBreak = weaponArmorBreak + (input.ordnance?.armorDamage ?? 0) + skillArmorBreak;
  const ordnanceContribution = input.ordnance?.damage ?? 0;
  const activityRareFind = recordTotal(input.activityMods, ['rareDropChanceMod']);
  const activityScrap = recordTotal(input.activityMods, ['scrapYieldMod']);
  const activityOffline = recordTotal(input.activityMods, ['offlineEarningsMod']);
  const activityCreditsPerKill = recordTotal(input.activityMods, ['creditsPerKill']);
  const consumableRareFind = recordTotal(input.consumableMods, ['rareDropChanceMod', 'lootQuantity', 'bonusLootChance']);
  const consumableScrap = recordTotal(input.consumableMods, ['scrapYieldMod']);
  const consumableXp = recordTotal(input.consumableMods, ['xpBoostMod']);

  return {
    maxHp: scalar(maxHp, [
      contribution('base', 'Hunter chassis', 'baseHp', baseHp),
      contribution('gear', input.shield?.name ?? 'No shield', 'shieldHp', shieldHp),
    ]),
    shield: scalar(shieldHp, [contribution('gear', input.shield?.name ?? 'No shield', 'shieldHp', shieldHp)]),
    mitigation: scalar(mitigation, [contribution('gear', input.shield?.name ?? 'No shield', 'mitigation', mitigation)]),
    effectiveHp: scalar(effectiveHp, [
      contribution('base', 'Max HP', 'maxHp', maxHp),
      contribution('gear', input.shield?.name ?? 'No shield', 'mitigationEffectiveHp', effectiveHp - maxHp),
    ]),
    standardWeaponDps: scalar(
      standardWeaponDps,
      weapons.map((weapon) => contribution('weapon', weapon.name, 'standardDps', computeStandardDps(weapon))),
    ),
    bossRelativeDps: scalar(
      bossRelativeDps,
      weapons.map((weapon) => contribution('weapon', weapon.name, 'bossRelativeDps', input.boss ? computeBossRelativeDps([weapon], input.boss.weaknesses, input.boss.resistances) : computeStandardDps(weapon))),
    ),
    simulatedBossDps: scalar(input.bossSimDps ?? bossDpsAfterPlayerMods, [
      contribution('weapon', 'Boss-relative DPS', 'bossRelativeDps', bossRelativeDps),
      contribution('skill', 'Skill tree damage', 'skillDamageMods', bossRelativeDps * (skillDamageBonus + skillBossBonus)),
      contribution('gear', 'Gear affixes', 'gearDamageMods', bossRelativeDps * (gearDamageBonus + gearBossBonus)),
      contribution('server', 'Server simulation override', 'bossSimDpsOverride', input.bossSimDps === undefined ? 0 : input.bossSimDps - bossDpsAfterPlayerMods),
    ]),
    shieldBreak: scalar(shieldBreak, [
      ...weapons.map((weapon) => contribution('weapon', weapon.name, 'shieldBreak', computeStandardDps(weapon) * Math.max(0, weapon.shieldDamageMod))),
      contribution('gear', input.ordnance?.name ?? 'No ordnance', 'ordnanceShieldBreak', input.ordnance?.shieldDamage ?? 0),
      contribution('skill', 'Skill tree', 'shieldBreakSkillMods', skillShieldBreak),
    ]),
    armorBreak: scalar(armorBreak, [
      ...weapons.map((weapon) => contribution('weapon', weapon.name, 'armorBreak', computeStandardDps(weapon) * Math.max(0, weapon.armorDamageMod))),
      contribution('gear', input.ordnance?.name ?? 'No ordnance', 'ordnanceArmorBreak', input.ordnance?.armorDamage ?? 0),
      contribution('skill', 'Skill tree', 'armorBreakSkillMods', skillArmorBreak),
    ]),
    ordnanceContribution: scalar(ordnanceContribution, [contribution('gear', input.ordnance?.name ?? 'No ordnance', 'ordnanceDamage', ordnanceContribution)]),
    lootRareFind: scalar(
      weapons.reduce((sum, weapon) => sum + weapon.rareDropChanceMod, 0) + skillTotal(input.spentSkills, 'rareDropChance') + affixTotal(gear, 'rareDropChanceMod') + activityRareFind + consumableRareFind,
      [
        ...weapons.map((weapon) => contribution('weapon', weapon.name, 'rareDropChanceMod', weapon.rareDropChanceMod)),
        contribution('skill', 'Skill tree', 'rareDropChance', skillTotal(input.spentSkills, 'rareDropChance')),
        contribution('gear', 'Gear affixes', 'rareDropChanceMod', affixTotal(gear, 'rareDropChanceMod')),
        contribution('activity', 'Activity / area modifiers', 'rareDropChanceMod', activityRareFind),
        contribution('consumable', 'Consumable / temporary modifiers', 'rareDropChanceMod', consumableRareFind),
      ],
    ),
    scrapModifier: scalar(
      weapons.reduce((sum, weapon) => sum + weapon.scrapYieldMod, 0) + skillTotal(input.spentSkills, 'scrapYield') + skillTotal(input.spentSkills, 'salvageBonus') + skillTotal(input.spentSkills, 'lowRarityScrapBonus') + affixTotal(gear, 'scrapYieldMod') + activityScrap + consumableScrap,
      [
        ...weapons.map((weapon) => contribution('weapon', weapon.name, 'scrapYieldMod', weapon.scrapYieldMod)),
        contribution('skill', 'Skill tree', 'scrapYield', skillTotal(input.spentSkills, 'scrapYield') + skillTotal(input.spentSkills, 'salvageBonus') + skillTotal(input.spentSkills, 'lowRarityScrapBonus')),
        contribution('gear', 'Gear affixes', 'scrapYieldMod', affixTotal(gear, 'scrapYieldMod')),
        contribution('activity', 'Activity / area modifiers', 'scrapYieldMod', activityScrap),
        contribution('consumable', 'Consumable / temporary modifiers', 'scrapYieldMod', consumableScrap),
      ],
    ),
    xpModifier: scalar(
      affixTotal(gear, 'xpBoostMod') + skillTotal(input.spentSkills, 'xpBoostMod') + consumableXp,
      [
        ...gear.flatMap((item) => item && 'affixes' in item ? item.affixes.filter((affix) => affix.stat === 'xpBoostMod').map((affix) => contribution('gear', item.name, 'xpBoostMod', affix.value)) : []),
        contribution('skill', 'Skill tree', 'xpBoostMod', skillTotal(input.spentSkills, 'xpBoostMod')),
        contribution('consumable', 'Consumable / temporary modifiers', 'xpBoostMod', consumableXp),
      ],
    ),
    offlineEarningModifier: scalar(
      weapons.reduce((sum, weapon) => sum + weapon.offlineEarningsMod, 0) + skillTotal(input.spentSkills, 'offlineEarnings') + affixTotal(gear, 'offlineEarningsMod') + activityOffline + activityCreditsPerKill,
      [
        ...weapons.map((weapon) => contribution('weapon', weapon.name, 'offlineEarningsMod', weapon.offlineEarningsMod)),
        contribution('skill', 'Skill tree', 'offlineEarnings', skillTotal(input.spentSkills, 'offlineEarnings')),
        contribution('gear', 'Gear affixes', 'offlineEarningsMod', affixTotal(gear, 'offlineEarningsMod')),
        contribution('activity', 'Activity / area modifiers', 'offlineEarningsMod', activityOffline),
        contribution('activity', 'Credits per kill', 'creditsPerKill', activityCreditsPerKill),
      ],
    ),
  };
}
