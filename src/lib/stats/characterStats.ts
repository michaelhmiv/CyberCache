import { SKILL_NODES } from '@/constants/skillTrees';
import { WeaponType } from '@/types/game';
import type { Affix, ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import type { BossDef } from '@/types/boss';
import { buildCharacterMechanicsSnapshot, type BuildCharacterMechanicsSnapshotInput, type CharacterMechanicsSnapshot, type MechanicsScalar } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { sumActivityModifier } from '@/lib/stats/activityModifiers';
import { ACTIVITY_MODULE_DEFS } from '@/content/activityModuleDefs';
import { cacheRankBonuses } from '@/content/cacheRank';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import type { ActivityKind } from '@/types/activity';
import type { StatSource } from '@/lib/stats/statSources';
import { sourcesToSegments } from '@/lib/stats/statSources';
import { buildConsumableStatSources } from '@/lib/stats/consumableStatSources';
import { formatPct, formatSignedPct, formatWhole } from '@/lib/stats/formatStat';

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

export type CharacterStatSummaryInput = {
  player: BuildCharacterMechanicsSnapshotInput['player'];
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
  /** Boss-sim overrides for the snapshot (audit HTR-05), supplied by the assembly when a boss is in context. */
  bossSimDps?: number;
  bossSimShieldBreak?: number;
  activeBuffs?: ActiveBuff[];
  consumableMods?: Record<string, number>;
  /** Server-authoritative MedKit HP buffer (from survival store / Chef result). */
  medKitBuffer?: number;
  /** Player consumable inventory counts used for inventory-backed stat sources. */
  consumableInventory?: Record<string, number>;
};

const pct = formatPct;
const signedPct = formatSignedPct;
const whole = formatWhole;
// DPS computation is delegated to the unified modifier chain. The standard
// target (no weakness, no resistance, no consumables) is the right baseline
// for the dashboard stat summary — boss-relative DPS lives in the boss sim.
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

function mechanicsSources(scalar: MechanicsScalar, tone: StatTone, format = whole): StatContribution[] {
  return scalar.contributions.map((entry) => ({
    source: entry.bucket === 'server' ? 'Combat adjustment' : entry.source,
    detail: entry.bucket === 'server' ? 'Slot weights and combat modifiers' : entry.bucket === 'skill' ? 'Build bonus' : 'Equipped loadout',
    value: entry.value,
    display: format(entry.value),
    tone,
    bucket: entry.bucket,
  }));
}

export function buildCharacterStatSummary(
  input: CharacterStatSummaryInput,
  mechanics: CharacterMechanicsSnapshot = buildCharacterMechanicsSnapshot(input),
): CharacterStatSummary {
  const { player, weapons, shield, classMod, relic, ordnance, spentSkills, boss, activeBuffs = [], medKitBuffer: survivalStoreBuffer = 0, consumableInventory } = input;
  const liveWeapons = weapons.filter((weapon): weapon is Weapon => !!weapon);
  const gear = [...liveWeapons, shield, classMod, relic, ordnance];
  const baseHealth = mechanics.maxHp.contributions.find((entry) => entry.stat === 'baseHp')?.value ?? mechanics.maxHp.value;
  const shieldHp = shield?.hp ?? 0;
  // Mechanics-only HP is adjusted with the server-authoritative survival
  // buffer below, after active consumable contributions are classified.
  const baseDps = mechanics.standardWeaponDps.value;
  const weaponDamageBonus = skillTotal(spentSkills, 'weaponDamage') + skillTotal(spentSkills, 'attackSpeed') + skillTotal(spentSkills, 'critChance') * 0.5 + skillTotal(spentSkills, 'critDamage') * 0.5;
  const affixDamageBonus = gearAffixes(gear, 'weaponDamage').reduce((sum, item) => sum + item.affix.value, 0);
  // Cache Rank Heavy Hand (0031): the same resolved fraction the
  // snapshot folds into simulatedBossDps.
  const cacheRankDamageBonus = cacheRankBonuses(player.cacheRankSpends).damage;
  const totalDps = baseDps * (1 + weaponDamageBonus + affixDamageBonus + cacheRankDamageBonus);
  // When a boss is supplied, the DPS metric becomes the boss-relative DPS so
  // the player can read the effective damage they'll deal. Otherwise it stays
  // as the standard-target total. The detail label flips with the context.
  const baseDpsForBoss = boss ? mechanics.bossRelativeDps.value : 0;
  // Include boss-specific skill bonuses (bossDamageMod, bossDamageSniperPistol,
  // launcherBossDps, weaknessMatchDamage) that are omitted from the generic
  // weaponDamageBonus. Without these, the HUD's Effective DPS for a boss
  // under-reports real damage. The conditional majors (Phase 2d) count
  // only when their condition holds — the same conditions the boss
  // sim enforces: Focus Fire needs a Sniper/Pistol primary (weapons
  // are slot-ordered, primary first), Scorched Earth a Launcher in
  // the set, Elemental Overclock a weakness-matching element.
  const primaryWeapon = liveWeapons[0];
  const focusFireBonus =
    boss && primaryWeapon && (primaryWeapon.weaponType === WeaponType.Sniper || primaryWeapon.weaponType === WeaponType.Pistol)
      ? skillTotal(spentSkills, 'bossDamageSniperPistol')
      : 0;
  const launcherBonus =
    boss && liveWeapons.some((weapon) => weapon.weaponType === WeaponType.Launcher)
      ? skillTotal(spentSkills, 'launcherBossDps')
      : 0;
  const weaknessMatchBonus =
    boss && liveWeapons.some((weapon) => boss.weaknesses.includes(weapon.element))
      ? skillTotal(spentSkills, 'weaknessMatchDamage')
      : 0;
  const bossSkillBonus = boss
    ? skillTotal(spentSkills, 'bossDamageMod') +
      focusFireBonus +
      launcherBonus +
      weaknessMatchBonus
    : 0;
  const totalDpsForBoss = baseDpsForBoss * (1 + weaponDamageBonus + affixDamageBonus + bossSkillBonus + cacheRankDamageBonus);
  const dpsDisplayValue = boss ? (input.bossSimDps ?? totalDpsForBoss) : totalDps;
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

  const consumableSources = buildConsumableStatSources({
    consumableInventory,
    activeBuffs,
    medKitBuffer: survivalStoreBuffer,
    survivalPool: mechanics.maxHp.value,
  });


  // Consumable HP buffers (Med Kit, refined Med Kit, future survival buffers)
  // come from the canonical consumable source builder. It prefers server
  // state when present, then active buffs, then inventory-backed potential.
  const survivalContribBuffer = consumableSources.health.reduce((sum, c) => sum + c.value, 0);
  // (Audit HTR-03 sub-fix: every HP source here used to be scaled by
  // `1 + skillTotal(spentSkills, 'survival')` — a dead term. No skill
  // node emits an effect key named 'survival', so that multiplier was
  // permanently 1. The composite named 'survival' in skillBonuses.ts
  // is a different mechanism.
  // SETTLED 2026-11-12 (owner ruling HTR-03): the canonical pool is
  // computeCanonicalMaxHp — the snapshot value this summary reads
  // (mechanics.maxHp) IS that pool, and roaming / offline gate /
  // boss sim / fight bar now read the same definition. The raw pool
  // below stays labeled "HP"; the mitigation-folded figure is
  // "Effective HP" — two numbers, two names, never one blended
  // figure.)
  const scaledBaseHealth = Math.round(baseHealth);
  const totalHealth = Math.round(mechanics.maxHp.value) + survivalContribBuffer;
  const totalMitigation = shield?.mitigation ?? 0;
  const mitigationHp = Math.max(0, Math.round(totalHealth / Math.max(0.2, 1 - totalMitigation)) - totalHealth);
  const effectiveHpWithBuffer = totalHealth + mitigationHp;

  // Delta percentage: how far the effective HP is above/below the base chassis HP.
  const hpDeltaPct = scaledBaseHealth > 0 ? Math.round((effectiveHpWithBuffer - scaledBaseHealth) / scaledBaseHealth * 100) : 0;
  const hpDeltaSign = hpDeltaPct >= 0 ? '+' : '';
  const hpDisplay = `${whole(effectiveHpWithBuffer)} (${hpDeltaSign}${hpDeltaPct}%)`;

  const healthContribs: StatContribution[] = [
    { source: 'Hunter chassis', segmentLabel: 'Chassis', detail: `Base + level ${player.level}`, value: scaledBaseHealth, display: whole(scaledBaseHealth), tone: 'muted', bucket: 'base' },
    ...mechanicsSources(mechanics.maxHp, 'purple').filter((entry) => entry.bucket === 'skill'),
    shield ? { source: shield.name, segmentLabel: 'Shield', detail: 'Shield HP pool', value: Math.round(shieldHp), display: whole(Math.round(shieldHp)), tone: 'cyan', bucket: 'gear' } : undefined,
    ...consumableSources.health.filter((entry) => entry.value !== 0),
    mitigationHp > 0 ? { source: shield?.name ?? 'Shield', detail: `Mitigation ${pct(totalMitigation)}`, value: mitigationHp, display: whole(mitigationHp), tone: 'cyan', bucket: 'gear' as (typeof healthContribs)[number]['bucket'] } : undefined,
  ].filter(Boolean) as StatContribution[];

  const dpsSourceBase = boss ? baseDpsForBoss : baseDps;
  const dpsContribs: StatContribution[] = boss && input.bossSimDps !== undefined
    ? mechanicsSources(mechanics.simulatedBossDps, 'red')
    : [
    ...mechanicsSources(boss ? mechanics.bossRelativeDps : mechanics.standardWeaponDps, 'red'),
    ...skillContribs(spentSkills, 'weaponDamage', dpsSourceBase, whole),
    ...skillContribs(spentSkills, 'attackSpeed', dpsSourceBase, whole),
    ...skillContribs(spentSkills, 'critChance', dpsSourceBase * 0.5, whole),
    ...skillContribs(spentSkills, 'critDamage', dpsSourceBase * 0.5, whole),
    ...affixContribs(gear, 'weaponDamage', dpsSourceBase, whole),
    { source: 'Cache Rank', detail: 'Heavy Hand', value: dpsSourceBase * cacheRankDamageBonus, display: whole(dpsSourceBase * cacheRankDamageBonus), tone: 'purple', bucket: 'skill' },
    ...(boss ? skillContribs(spentSkills, 'bossDamageMod', dpsSourceBase, whole) : []),
    ...(focusFireBonus ? skillContribs(spentSkills, 'bossDamageSniperPistol', dpsSourceBase, whole) : []),
    ...(launcherBonus ? skillContribs(spentSkills, 'launcherBossDps', dpsSourceBase, whole) : []),
    ...(weaknessMatchBonus ? skillContribs(spentSkills, 'weaknessMatchDamage', dpsSourceBase, whole) : []),
  ];

  // DPS label: shows "Base DPS" (raw pooled weapon power) or "Effective DPS"
  // (after all modifiers vs the selected boss). The two-number format answers
  // "what my gear says on paper" vs "what it actually does to this target."
  const dpsLabel = boss ? 'Effective DPS' : 'Base DPS';

  const healthStacked = sourcesToSegments(healthContribs, 'green');

  const all = [
    metric('health', 'Effective HP', effectiveHpWithBuffer, hpDisplay, hpDeltaPct !== 0 ? `HP pool ${whole(totalHealth)} · mitigation counted as HP (${hpDeltaSign}${hpDeltaPct}% from base)` : `HP pool ${whole(totalHealth)} · mitigation counted as HP`, 'green', healthContribs, healthStacked),
    metric('dps', dpsLabel, dpsDisplayValue, whole(dpsDisplayValue), dpsDetail, 'red', dpsContribs),
    metric('roamingDps', 'Roaming DPS', mechanics.roamingDps.value, whole(mechanics.roamingDps.value), 'Standing roaming loadout · before temporary effects and target defense', 'red', mechanicsSources(mechanics.roamingDps, 'red')),
    metric('boss', 'vs Boss', bossDps, whole(bossDps), 'Effective DPS with all boss modifiers applied', 'amber', mechanicsSources(mechanics.simulatedBossDps, 'amber')),
    metric('shieldBreak', 'Shield Break', shieldBreak, whole(shieldBreak), 'weapon mods + ordnance + skills', 'cyan', mechanicsSources(mechanics.shieldBreak, 'cyan')),
    metric('armorBreak', 'Armor Break', armorBreak, whole(armorBreak), 'armor mods + ordnance + skills', 'purple', mechanicsSources(mechanics.armorBreak, 'purple')),
    metric('rareFind', 'Rare Find', rareFind, signedPct(rareFind), 'drop chance modifiers', 'amber', mechanicsSources(mechanics.lootRareFind, 'amber', signedPct)),
    metric('offline', 'Offline', offline, signedPct(offline), 'idle earning modifiers', 'green', mechanicsSources(mechanics.offlineEarningModifier, 'green', signedPct)),
    metric('scrap', 'Scrap Yield', scrap, signedPct(scrap), 'salvage and scrap modifiers', 'cyan', mechanicsSources(mechanics.scrapModifier, 'cyan', signedPct)),
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
    endless_run: {},
    // Extraction reads NO gear activity modifiers by law (0033 brief):
    // roaming activity mods never apply to a pass.
    extraction: {},
  };

  const activityModuleMetrics: StatMetric[] = Object.values(ACTIVITY_MODULE_DEFS).flatMap((def) =>
    def.subStats.map((sub) => {
      const value = activityModTotals[def.activityKind][sub.key] ?? 0;
      const format = sub.displayFormat.includes('%') ? signedPct : whole;
      return metric(
        sub.key,
        sub.label,
        value,
        format(value),
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
                  display: format(a.subStats![sub.key]),
                  tone: 'amber' as StatTone,
                  bucket: 'activity' as 'base' | 'gear' | 'weapon' | 'skill' | 'activity' | 'consumable' | 'server' | 'runtime',
                })))
          : [],
        undefined,
        def.activityKind,
      );
    }),
  );

  return { headline: all.filter((m) => ['health', 'dps', 'boss', 'rareFind'].includes(m.key)), all: [...all, ...activityModuleMetrics] };
}
