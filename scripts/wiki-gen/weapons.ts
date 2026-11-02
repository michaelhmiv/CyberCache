/**
 * Weapons & itemization — weapon types, manufacturers, elements,
 * rarities, and the affix pools every gear kind rolls from.
 * Owners: src/constants/{weaponTypes,manufacturers,elements,rarities}.ts
 * and src/lib/gear/affixPools.ts (the one affix-pool source; the gear
 * generators and reforge both read it).
 */
import { WEAPON_TYPES } from '../../src/constants/weaponTypes';
import { MANUFACTURERS } from '../../src/constants/manufacturers';
import { ELEMENTS } from '../../src/constants/elements';
import { RARITIES } from '../../src/constants/rarities';
import {
  WEAPON_COMBAT_POOL,
  WEAPON_BOSS_POOL,
  WEAPON_IDLE_POOL,
  SHIELD_AFFIX_POOL,
  ORDNANCE_COMBAT_POOL,
  CLASSMOD_AFFIX_POOL,
  RELIC_AFFIX_POOL,
  type AffixPoolDef,
} from '../../src/lib/gear/affixPools';
import { type GenBlock, listOrDash, mult, num, pct, table, titleCase } from './lib';

function weaponTypesSection(): string {
  const rows = Object.values(WEAPON_TYPES).map((w) => {
    const s = w.baseStats;
    return [
      `**${w.name}**`,
      s.baseDamage,
      num(s.attackSpeed),
      pct(s.critChance),
      mult(s.critDamage),
      pct(s.statusChance),
      mult(s.statusDamage),
      mult(s.bossDamageMod),
      mult(s.waveDamageMod),
      mult(s.shieldDamageMod),
      mult(s.armorDamageMod),
      `${w.magDurationSeconds}s`,
      `${num(w.reloadSeconds)}s`,
      titleCase(w.signatureMechanic),
    ];
  });
  return [
    '### Weapon types',
    '',
    'Base stats below are the frame every roll starts from, before manufacturer bias, rarity quality, and affixes.',
    '',
    table(
      ['Type', 'Base DMG', 'Atk speed', 'Crit', 'Crit DMG', 'Status', 'Status DMG', 'Boss', 'Wave', 'Shield', 'Armor', 'Mag', 'Reload', 'Signature'],
      rows,
    ),
  ].join('\n');
}

function manufacturersSection(): string {
  const rows = Object.values(MANUFACTURERS).map((m) => [
    `**${m.name}**`,
    m.identity,
    m.mechanic,
    Object.entries(m.baseStatBias)
      .map(([stat, v]) => `${titleCase(stat).replace(/ Mod$/, '')} ${mult(v ?? 1)}`)
      .join(', '),
  ]);
  return [
    '### Manufacturers',
    '',
    table(['Manufacturer', 'Identity', 'Baked-in mechanic', 'Stat bias'], rows),
  ].join('\n');
}

function elementsSection(): string {
  const rows = Object.values(ELEMENTS).map((e) => [
    `**${e.name}**`,
    listOrDash(e.strongAgainst),
    listOrDash(e.weakAgainst),
    e.description,
  ]);
  return [
    '### Elements',
    '',
    'A strong matchup deals ×1.3 damage; a weak one ×0.7 (from `getElementMatchup`, the same function the combat math reads).',
    '',
    table(['Element', 'Strong against', 'Weak against', 'Notes'], rows),
  ].join('\n');
}

function raritiesSection(): string {
  const rows = Object.values(RARITIES).map((r) => [
    `**${r.name}**`,
    r.affixCount.min === r.affixCount.max ? String(r.affixCount.min) : `${r.affixCount.min}–${r.affixCount.max}`,
    `+${r.rollQualityBias}`,
    r.specialEffectChance === 0 ? '—' : pct(r.specialEffectChance),
    mult(r.scrapMultiplier),
    r.dropWeight,
  ]);
  return [
    '### Rarities',
    '',
    table(['Rarity', 'Affixes', 'Roll-quality bias', 'Special-effect chance', 'Scrap value', 'Drop weight (relative)'], rows),
  ].join('\n');
}

function affixTable(title: string, defs: AffixPoolDef[], withCategory = false): string {
  const headers = withCategory ? ['Affix roll', 'Stat', 'Category'] : ['Affix roll', 'Stat'];
  const rows = defs.map((d) => {
    const roll = d.text.replace('{v}', d.min === d.max ? String(d.min) : `${d.min}–${d.max}`);
    return withCategory ? [roll, d.stat, d.category ?? '—'] : [roll, d.stat];
  });
  return [`#### ${title}`, '', table(headers, rows)].join('\n');
}

function affixesBody(): string {
  return [
    'Weapons roll from three sub-pools (combat, boss, idle); shields, ordnance, class mods, and relics each roll from their own pool. Ranges below are the roll ranges baked into an item when an affix lands.',
    '',
    affixTable('Weapon — combat pool', WEAPON_COMBAT_POOL),
    '',
    affixTable('Weapon — boss pool', WEAPON_BOSS_POOL),
    '',
    affixTable('Weapon — idle pool', WEAPON_IDLE_POOL),
    '',
    affixTable('Shield pool', SHIELD_AFFIX_POOL),
    '',
    affixTable('Ordnance pool', ORDNANCE_COMBAT_POOL),
    '',
    affixTable('Class mod pool', CLASSMOD_AFFIX_POOL),
    '',
    affixTable('Relic pool', RELIC_AFFIX_POOL, true),
  ].join('\n');
}

export const weaponsBlock: GenBlock = {
  id: 'weapons',
  owners: [
    'src/constants/weaponTypes.ts',
    'src/constants/manufacturers.ts',
    'src/constants/elements.ts',
    'src/constants/rarities.ts',
  ],
  render: () => [weaponTypesSection(), manufacturersSection(), elementsSection(), raritiesSection()].join('\n\n'),
};

export const affixesBlock: GenBlock = {
  id: 'affixes',
  owners: ['src/lib/gear/affixPools.ts'],
  render: affixesBody,
};
