import { SKILL_NODES } from '@/constants/skillTrees';
import type { PlayerProfile } from '@/types/player';
import type { Affix, ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import type { BossDef } from '@/types/boss';
import { computeStandardDps } from '@/lib/stats/dpsChain';
import { buildCharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { sumActivityModifier } from '@/lib/stats/activityModifiers';
import { ACTIVITY_MODULE_DEFS } from '@/content/activityModuleDefs';
import { CONSUMABLES } from '@/constants/consumables';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import type { ActivityKind } from '@/types/activity';
import type { StatSource } from '@/lib/stats/statSources';
import { sourcesToSegments } from '@/lib/stats/statSources';
import { formatMultiplierOrWhole, formatPct, formatSignedPct, formatWhole } from '@/lib/stats/formatStat';

export type StatTone = 'amber' | 'green' | 'red' | 'cyan' | 'purple' | 'muted';

export type StatContribution = StatSource;

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
   * MetricCard in the modal renders the same data as a contribution list.
   *
   * If absent, the HUD renders no bar for the metric (default text-only).
   * Idle-game convention: a single non-stacked bar uses `stacked = [{...}]`
   * with one entry equal to `value`.
   */
  stacked?: Array<{ value: number; display: string; tone: StatTone; label: string }>;
  /**
   * When this metric is an activity-module sub-stat, this field records
   * which activity it belongs to. This disambiguates metrics that share
   * the same key across activities (e.g., `droneAssistSpeed` exists in
   * both crafting and workshop modules). The breakdown modal uses this
   * to filter metrics by the player's current activity.
   */
  sourceActivity?: ActivityKind;
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
  activeBuffs?: ActiveBuff[];
  consumableMods?: Record<string, number>;
  /** Server-authoritative MedKit HP buffer (from survival store / Chef result). */
  medKitBuffer?: number;
};

const pct = formatPct;
const signedPct = formatSignedPct;
const whole = formatWhole;
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
    return [{ source: node.name, detail: `${points}/${node.maxPoints} · ${node.tree}`, value, display: format(value), tone: 'purple' as StatTone, bucket: 'skill' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' }];
  });
}

function affixContribs(gear: Array<GearItem | undefined>, key: string, scalar: number, format: (value: number) => string): StatContribution[] {
  return gearAffixes(gear, key).map(({ item, affix }) => {
    const value = affix.value * scalar;
    return { source: item?.name ?? 'Gear affix', detail: affix.displayText, value, display: format(value), tone: 'amber' as StatTone, bucket: 'gear' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' };
  });
}

function metric(key: string, label: string, value: number, display: string, detail: string, tone: StatTone, contributions: StatContribution[], stacked?: StatMetric['stacked'], sourceActivity?: ActivityKind): StatMetric {
  return { key, label, value, display, detail, tone, contributions: contributions.filter((entry) => entry.value !== 0), stacked, sourceActivity };
}

export function buildCharacterStatSummary(input: Input): CharacterStatSummary {
  const { player, weapons, shield, classMod, relic, ordnance, spentSkills, boss, activeBuffs = [], medKitBuffer: survivalStoreBuffer = 0 } = input;
  const mechanics = buildCharacterMechanicsSnapshot(input);
  const liveWeapons = weapons.filter((weapon): weapon is Weapon => !!weapon);
  const gear = [...liveWeapons, shield, classMod, relic, ordnance];
  const baseHealth = mechanics.maxHp.contributions.find((entry) => entry.stat === 'baseHp')?.value ?? mechanics.maxHp.value;
  const shieldHp = shield?.hp ?? 0;
  // Mechanics-only HP is adjusted with the server-authoritative survival
  // buffer below, after active consumable contributions are classified.
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

  // Route active consumable contributions by family so a Med Kit (survival)
  // doesn't show as a DPS source, and an Ammo Pack (ammo) doesn't show as
  // an HP source. Each family goes only to the metrics it actually affects.
  const activeConsumableContribsByFamily = (families: string[]): StatContribution[] =>
    activeBuffs
      .filter((buff) => buff.displayState === 'active' || buff.displayState === 'recent')
      .filter((buff) => {
        const def = CONSUMABLES[buff.consumableId];
        return def && families.includes(def.family);
      })
      .map((buff) => {
        const def = CONSUMABLES[buff.consumableId];
        const remainingMs = Math.max(0, buff.expiresAt - Date.now());
        return {
          source: def?.name ?? buff.consumableId,
          detail: buff.displayState === 'recent'
            ? 'Recently triggered consumable feedback'
            : `${Math.ceil(remainingMs / 1000)}s remaining · ${buff.source}`,
          value: buff.value ?? 0,
          display: buff.value ? formatMultiplierOrWhole(buff.value) : 'active',
          tone: 'amber' as StatTone,
          bucket: 'consumable' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime',
        };
      });

  const dpsConsumableContribs = activeConsumableContribsByFamily(['ammo', 'corrupted', 'tactical']);
  const survivalConsumableContribs = activeConsumableContribsByFamily(['survival']);
  const economyConsumableContribs = activeConsumableContribsByFamily(['economy']);

  // Survival consumable buffer (MedKit, ShieldCell, etc.) from active roaming buffs.
  // Fall back to the survival store's medKitBuffer if activeBuffs are empty
  // (e.g., offline, claim RPC fallback, or before the first Chef reply lands).
  const survivalContribBufferFromBuffs = survivalConsumableContribs.reduce((sum, c) => sum + c.value, 0);
  const survivalContribBuffer = survivalContribBufferFromBuffs > 0
    ? survivalContribBufferFromBuffs
    : survivalStoreBuffer;
  const totalHealth = mechanics.maxHp.value + survivalContribBuffer;
  const totalMitigation = shield?.mitigation ?? 0;
  const mitigationHp = Math.max(0, Math.round(totalHealth / Math.max(0.2, 1 - totalMitigation)) - totalHealth);
  const effectiveHpWithBuffer = totalHealth + mitigationHp;

  const survivalStoreMedKitContrib: StatContribution | undefined =
    survivalConsumableContribs.length === 0 && survivalStoreBuffer > 0
      ? {
          source: 'MedKit',
          detail: 'Server-authoritative survival buffer',
          value: survivalStoreBuffer,
          display: whole(survivalStoreBuffer),
          tone: 'amber',
          bucket: 'consumable',
        }
      : undefined;

  const healthContribs: StatContribution[] = [
    { source: 'Hunter chassis', segmentLabel: 'Chassis', detail: `Base + level ${player.level}`, value: baseHealth, display: whole(baseHealth), tone: 'muted', bucket: 'base' },
    shield ? { source: shield.name, segmentLabel: 'Shield', detail: 'Shield HP pool', value: shieldHp, display: whole(shieldHp), tone: 'cyan', bucket: 'gear' } : undefined,
    ...survivalConsumableContribs.filter((entry) => entry.value !== 0),
    survivalStoreMedKitContrib,
  ].filter(Boolean) as StatContribution[];

  const effectiveHpContribs: StatContribution[] = [
    { source: 'Max HP', detail: 'Combat HP before mitigation', value: totalHealth, display: whole(totalHealth), tone: 'green', bucket: 'base' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' },
    shield ? { source: shield.name, detail: `Mitigation ${pct(shield.mitigation)}`, value: mitigationHp, display: whole(mitigationHp), tone: 'cyan', bucket: 'gear' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' } : undefined,
  ].filter(Boolean) as StatContribution[];

  const dpsContribs: StatContribution[] = [
    ...liveWeapons.map((weapon) => ({ source: weapon.name, detail: `${weapon.weaponType} · ${weapon.element}`, value: weaponDps(weapon), display: whole(weaponDps(weapon)), tone: 'red' as StatTone, bucket: 'weapon' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' })),
    ...skillContribs(spentSkills, 'weaponDamage', baseDps, whole),
    ...skillContribs(spentSkills, 'attackSpeed', baseDps, whole),
    ...skillContribs(spentSkills, 'critChance', baseDps * 0.5, whole),
    ...skillContribs(spentSkills, 'critDamage', baseDps * 0.5, whole),
    ...affixContribs(gear, 'weaponDamage', baseDps, whole),
    ...dpsConsumableContribs.filter((entry) => entry.value !== 0),
  ];

  // DPS label: shows "Base DPS" (raw pooled weapon power) or "Effective DPS"
  // (after all modifiers vs the selected boss). The two-number format answers
  // "what my gear says on paper" vs "what it actually does to this target."
  const dpsLabel = boss ? 'Effective DPS' : 'Base DPS';

  const bossContribs: StatContribution[] = [
    { source: 'Base DPS', detail: 'Weapons + skills + affixes before boss mods', value: totalDps, display: whole(totalDps), tone: 'red', bucket: 'base' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' },
    ...liveWeapons.map((weapon) => ({ source: weapon.name, detail: `Boss dmg mod +${Math.round(weapon.bossDamageMod * 100)}%`, value: totalDps * weapon.bossDamageMod / Math.max(1, liveWeapons.length), display: whole(totalDps * weapon.bossDamageMod / Math.max(1, liveWeapons.length)), tone: 'amber' as StatTone, bucket: 'weapon' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' })),
    ...skillContribs(spentSkills, 'bossDamageMod', totalDps, whole),
    ...skillContribs(spentSkills, 'bossDamageSniperPistol', totalDps, whole),
    ...skillContribs(spentSkills, 'launcherBossDps', totalDps, whole),
    ...skillContribs(spentSkills, 'weaknessMatchDamage', totalDps, whole),
    ...dpsConsumableContribs.filter((entry) => entry.value !== 0),
    // Relic & classMod contributions to boss DPS
    ...(relic ? relic.affixes.filter((a) => a.stat === 'bossDamageMod').map((a) => ({ source: relic.name, detail: a.displayText, value: totalDps * a.value, display: whole(totalDps * a.value), tone: 'amber' as StatTone, bucket: 'gear' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' })) : []),
    ...(classMod ? classMod.affixes.filter((a) => a.stat === 'bossDamageMod').map((a) => ({ source: classMod.name, detail: a.displayText, value: totalDps * a.value, display: whole(totalDps * a.value), tone: 'amber' as StatTone, bucket: 'gear' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' })) : []),
  ];

  const breakContribs = (type: 'shield' | 'armor'): StatContribution[] => [
    ...liveWeapons.map((weapon) => ({ source: weapon.name, detail: `${type === 'shield' ? 'Shield' : 'Armor'} modifier`, value: weaponDps(weapon) * Math.max(0, type === 'shield' ? weapon.shieldDamageMod : weapon.armorDamageMod), display: whole(weaponDps(weapon) * Math.max(0, type === 'shield' ? weapon.shieldDamageMod : weapon.armorDamageMod)), tone: type === 'shield' ? 'cyan' as StatTone : 'amber' as StatTone, bucket: 'weapon' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' })),
    ordnance ? { source: ordnance.name, detail: `${ordnance.effect} ordnance`, value: type === 'shield' ? ordnance.shieldDamage : ordnance.armorDamage, display: whole(type === 'shield' ? ordnance.shieldDamage : ordnance.armorDamage), tone: 'red' as StatTone, bucket: 'gear' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' } : undefined,
    ...skillContribs(spentSkills, type === 'shield' ? 'shieldDamageMod' : 'armorDamageMod', baseDps, whole),
    ...skillContribs(spentSkills, type === 'shield' ? 'ordnanceShieldBreak' : 'explosiveArmorBreak', baseDps, whole),
  ].filter(Boolean) as StatContribution[];

  const utilityContribs = (keys: string[], scalar = 1): StatContribution[] => [
    ...liveWeapons.flatMap((weapon) => keys.flatMap((key) => key in weapon ? [{ source: weapon.name, detail: key, value: Number((weapon as unknown as Record<string, number>)[key]), display: signedPct(Number((weapon as unknown as Record<string, number>)[key])), tone: 'amber' as StatTone, bucket: 'weapon' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' }] : [])),
    ...keys.flatMap((key) => skillContribs(spentSkills, key, scalar, signedPct)),
    ...keys.flatMap((key) => affixContribs(gear, key, scalar, signedPct)),
  ];

  const healthStacked = sourcesToSegments(healthContribs, 'green');

  const all = [
    metric('health', 'Max HP', totalHealth, whole(totalHealth), 'combat HP: chassis + shield + consumables', 'green', healthContribs, healthStacked),
    metric('effectiveHp', 'Effective HP', effectiveHpWithBuffer, whole(effectiveHpWithBuffer), 'max HP adjusted by mitigation (includes consumable buffers)', 'cyan', effectiveHpContribs),
    metric('dps', dpsLabel, dpsDisplayValue, whole(dpsDisplayValue), dpsDetail, 'red', dpsContribs),
    metric('boss', 'vs Boss', bossDps, whole(bossDps), 'Effective DPS with all boss modifiers applied', 'amber', bossContribs),
    metric('shieldBreak', 'Shield Break', shieldBreak, whole(shieldBreak), 'weapon mods + ordnance + skills', 'cyan', breakContribs('shield')),
    metric('armorBreak', 'Armor Break', armorBreak, whole(armorBreak), 'armor mods + ordnance + skills', 'purple', breakContribs('armor')),
    metric('rareFind', 'Rare Find', rareFind, signedPct(rareFind), 'drop chance modifiers', 'amber', [...utilityContribs(['rareDropChanceMod', 'rareDropChance', 'postBossDropChance']), ...economyConsumableContribs.filter((entry) => entry.value !== 0)]),
    metric('offline', 'Offline', offline, signedPct(offline), 'idle earning modifiers', 'green', utilityContribs(['offlineEarningsMod', 'offlineEarnings'])),
    metric('scrap', 'Scrap Yield', scrap, signedPct(scrap), 'salvage and scrap modifiers', 'cyan', utilityContribs(['scrapYieldMod', 'scrapYield', 'autoSalvageBonus', 'lowRarityScrapBonus'])),
    metric('ordnance', 'Ordnance', ordnanceDamage, whole(ordnanceDamage), ordnance ? `${ordnance.effect} · ${ordnance.element}` : 'no ordnance slotted', 'red', ordnance ? [{ source: ordnance.name, detail: `${ordnance.effect} payload`, value: ordnanceDamage, display: whole(ordnanceDamage), tone: 'red', bucket: 'gear' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime' }] : []),
  ];

  // Activity-module metrics: one StatMetric per (module, sub-stat). The value
  // comes from the canonical sumActivityModifier aggregator (the single
  // read-path for activity-modifier math). The `contributions` list is built
  // from contributing gear pieces — each gear item's matching activity affix
  // becomes a row so the HUD's source list shows exactly which piece of gear
  // is fueling the buff.
  const gearForMods = [...liveWeapons, shield, classMod, relic, ordnance].filter(
    (g): g is NonNullable<typeof g> => Boolean(g),
  );
  const activityModTotals: Record<ActivityKind, Record<string, number>> = {
    none: {},
    boss_fight: {},
    crafting: sumActivityModifier(gearForMods, 'crafting'),
    salvaging: sumActivityModifier(gearForMods, 'salvaging'),
    market_listing: sumActivityModifier(gearForMods, 'market_listing'),
    workshop_service: sumActivityModifier(gearForMods, 'workshop_service'),
    roaming_loot: sumActivityModifier(gearForMods, 'roaming_loot'),
    idle_standby: sumActivityModifier(gearForMods, 'idle_standby'),
  };

  const activityModuleMetrics: StatMetric[] = Object.values(ACTIVITY_MODULE_DEFS).flatMap((def) =>
    def.subStats.map((sub) => {
      const value = activityModTotals[def.activityKind][sub.key] ?? 0;
      return metric(
        sub.key,
        sub.label,
        value,
        signedPct(value),
        `${def.name} · sub-stat`,
        'amber',
        value > 0
          ? gearForMods
              .filter((g): g is Extract<typeof g, { affixes: Affix[] }> =>
                'affixes' in g && Array.isArray(g.affixes))
              .flatMap((g) => g.affixes
                .filter((a) => a.category === 'activity' && a.stat === `${def.activityKind}Module` && a.subStats?.[sub.key])
                .map((a) => ({
                  source: g.name ?? 'Gear',
                  detail: a.displayText ?? sub.label,
                  value: a.subStats![sub.key],
                  display: signedPct(a.subStats![sub.key]),
                  tone: 'amber' as StatTone,
                  bucket: 'activity' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime',
                })))
          : [],
        undefined,
        def.activityKind,
      );
    }),
  );

  return { headline: [all[0], all[1], all[2], all[5]], all: [...all, ...activityModuleMetrics] };
}
