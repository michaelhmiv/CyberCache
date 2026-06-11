import { SKILL_NODES } from '@/constants/skillTrees';
import type { BossDef } from '@/types/boss';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import type { PlayerProfile } from '@/types/player';
import { computeHunterMaxHp } from '@/lib/combat/damageContract';
import { computeBossRelativeDps, computeStandardDps } from '@/lib/stats/dpsChain';

export type MechanicsContribution = {
  source: string;
  stat: string;
  value: number;
};

export type MechanicsScalar = {
  value: number;
  contributions: MechanicsContribution[];
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

function contribution(source: string, stat: string, value: number): MechanicsContribution {
  return { source, stat, value };
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
  const weaponDamageBonus =
    skillTotal(input.spentSkills, 'weaponDamage') +
    skillTotal(input.spentSkills, 'attackSpeed') +
    skillTotal(input.spentSkills, 'critChance') * 0.5 +
    skillTotal(input.spentSkills, 'critDamage') * 0.5 +
    affixTotal(gear, 'weaponDamage');
  const bossSkillBonus =
    skillTotal(input.spentSkills, 'bossDamageMod') +
    skillTotal(input.spentSkills, 'bossDamageSniperPistol') +
    skillTotal(input.spentSkills, 'launcherBossDps') +
    skillTotal(input.spentSkills, 'weaknessMatchDamage') +
    affixTotal([input.classMod, input.relic], 'bossDamageMod');
  const bossDpsAfterPlayerMods = bossRelativeDps * (1 + weaponDamageBonus + bossSkillBonus);
  const shieldBreak = weapons.reduce((sum, weapon) => sum + computeStandardDps(weapon) * Math.max(0, weapon.shieldDamageMod), 0) + (input.ordnance?.shieldDamage ?? 0);
  const armorBreak = weapons.reduce((sum, weapon) => sum + computeStandardDps(weapon) * Math.max(0, weapon.armorDamageMod), 0) + (input.ordnance?.armorDamage ?? 0);
  const ordnanceContribution = input.ordnance?.damage ?? 0;

  return {
    maxHp: {
      value: maxHp,
      contributions: [
        contribution('Hunter chassis', 'baseHp', baseHp),
        contribution(input.shield?.name ?? 'No shield', 'shieldHp', shieldHp),
      ],
    },
    shield: { value: shieldHp, contributions: [contribution(input.shield?.name ?? 'No shield', 'shieldHp', shieldHp)] },
    mitigation: { value: mitigation, contributions: [contribution(input.shield?.name ?? 'No shield', 'mitigation', mitigation)] },
    effectiveHp: {
      value: effectiveHp,
      contributions: [
        contribution('Max HP', 'maxHp', maxHp),
        contribution(input.shield?.name ?? 'No shield', 'mitigationEffectiveHp', effectiveHp - maxHp),
      ],
    },
    standardWeaponDps: {
      value: standardWeaponDps,
      contributions: weapons.map((weapon) => contribution(weapon.name, 'standardDps', computeStandardDps(weapon))),
    },
    bossRelativeDps: {
      value: bossRelativeDps,
      contributions: weapons.map((weapon) => contribution(weapon.name, 'bossRelativeDps', input.boss ? computeBossRelativeDps([weapon], input.boss.weaknesses, input.boss.resistances) : computeStandardDps(weapon))),
    },
    simulatedBossDps: {
      value: input.bossSimDps ?? bossDpsAfterPlayerMods,
      contributions: [
        contribution('Boss-relative DPS', 'bossRelativeDps', bossRelativeDps),
        contribution('Skills and affixes', 'playerDamageMods', bossDpsAfterPlayerMods - bossRelativeDps),
      ],
    },
    shieldBreak: { value: shieldBreak, contributions: weapons.map((weapon) => contribution(weapon.name, 'shieldBreak', computeStandardDps(weapon) * Math.max(0, weapon.shieldDamageMod))) },
    armorBreak: { value: armorBreak, contributions: weapons.map((weapon) => contribution(weapon.name, 'armorBreak', computeStandardDps(weapon) * Math.max(0, weapon.armorDamageMod))) },
    ordnanceContribution: { value: ordnanceContribution, contributions: [contribution(input.ordnance?.name ?? 'No ordnance', 'ordnanceDamage', ordnanceContribution)] },
    lootRareFind: {
      value: weapons.reduce((sum, weapon) => sum + weapon.rareDropChanceMod, 0) + skillTotal(input.spentSkills, 'rareDropChance') + skillTotal(input.spentSkills, 'postBossDropChance') + affixTotal(gear, 'rareDropChanceMod'),
      contributions: weapons.map((weapon) => contribution(weapon.name, 'rareDropChanceMod', weapon.rareDropChanceMod)),
    },
    scrapModifier: {
      value: weapons.reduce((sum, weapon) => sum + weapon.scrapYieldMod, 0) + skillTotal(input.spentSkills, 'scrapYield') + skillTotal(input.spentSkills, 'autoSalvageBonus') + skillTotal(input.spentSkills, 'lowRarityScrapBonus') + affixTotal(gear, 'scrapYieldMod'),
      contributions: weapons.map((weapon) => contribution(weapon.name, 'scrapYieldMod', weapon.scrapYieldMod)),
    },
    xpModifier: {
      value: affixTotal(gear, 'xpBoostMod') + skillTotal(input.spentSkills, 'xpBoostMod'),
      contributions: gear.flatMap((item) => item && 'affixes' in item ? item.affixes.filter((affix) => affix.stat === 'xpBoostMod').map((affix) => contribution(item.name, 'xpBoostMod', affix.value)) : []),
    },
    offlineEarningModifier: {
      value: weapons.reduce((sum, weapon) => sum + weapon.offlineEarningsMod, 0) + skillTotal(input.spentSkills, 'offlineEarnings') + affixTotal(gear, 'offlineEarningsMod'),
      contributions: weapons.map((weapon) => contribution(weapon.name, 'offlineEarningsMod', weapon.offlineEarningsMod)),
    },
  };
}
