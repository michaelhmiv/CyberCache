/**
 * Hero rundown — the four tappable headline stats that replaced
 * the stage ribbon's stats-band scroller in the Home consolidation
 * (owner steers 2026-11-03: the mode word dies, the ~15-entry
 * scroller becomes four heroes, every hero opens its source
 * breakdown).
 *
 * Pure builder: the component assembles the inputs from the
 * stores and the canonical summaries, this module shapes them.
 * Source law (AGENTS.md): every number is read from the same
 * summaries the engines consume — buildCharacterStatSummary /
 * buildCharacterMechanicsSnapshot — plus the survival store's
 * server-synced HP mirror. Nothing is re-derived from a parallel
 * formula; the DPS delta derivation, the pooled crit weighting,
 * and the per-tick damage expectation are the exact derivations
 * the retired band shipped with (they moved here verbatim).
 */
import type { Weapon } from '@/types/items';
import type { CharacterStatSummary, StatMetric, StatTone } from '@/lib/stats/characterStats';
import type { CharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { computeStandardDps } from '@/lib/stats/dpsChain';
import { formatPct, formatWhole } from '@/lib/stats/formatStat';

/** The game tick, seconds — the same constant the damage contract
 *  (src/lib/combat/damageContract.ts) and the boss tick apply. */
export const STAGE_TICK_SECONDS = 3;

/**
 * The delta between a base value and its effective (modified)
 * value, as a signed percentage: 100 → 150 prints "+50%", a yield
 * lost to an empty tank prints its shortfall vs the vehicle's
 * fueled potential in red. Returns null when there is nothing to
 * say: no base, no change, or a change too small to print a
 * nonzero percentage for. (Numbers-emphasis law: unmodified stats
 * print plain — no delta.)
 */
export function stageStatDelta(base: number, effective: number): { display: string; tone: StatTone } | null {
  if (!(base > 0) || !Number.isFinite(base) || !Number.isFinite(effective)) return null;
  const change = effective / base - 1;
  if (Math.abs(change) < 0.0005) return null;
  const pts = Math.abs(change) * 100;
  const magnitude = pts >= 9.95 ? `${Math.round(pts)}` : pts.toFixed(1);
  return { display: `${change > 0 ? '+' : '-'}${magnitude}%`, tone: change > 0 ? 'green' : 'red' };
}

/** DPS-weighted pooled crit across the equipped set — the chain
 *  (dpsChain step 1) folds (1 + critChance × critDamage) per weapon,
 *  so the pooled pair is weighted by each weapon's standard DPS,
 *  the same weighting the pooled damage uses. */
export function pooledCrit(weapons: Weapon[]): { chance: number; damage: number } | null {
  let total = 0;
  let chance = 0;
  let damage = 0;
  for (const weapon of weapons) {
    const dps = computeStandardDps(weapon);
    total += dps;
    chance += dps * (weapon.critChance ?? 0);
    damage += dps * (weapon.critDamage ?? 0);
  }
  if (total <= 0) return null;
  return { chance: chance / total, damage: damage / total };
}

export interface HeroStatCell {
  key: 'dps' | 'dmgTick' | 'crit';
  label: string;
  /** The EFFECTIVE value — the hero number (numbers-emphasis law). */
  display: string;
  tone: StatTone;
  /** Present exactly when modifiers moved the number off base:
   *  green for gains, red for losses. Unmodified prints plain. */
  delta?: { display: string; tone: StatTone };
}

export interface HeroHpCell {
  key: 'hp';
  label: 'HP';
  /** "812 / 1,040" — current over max, whole numbers. */
  display: string;
  current: number;
  max: number;
  /** 0..1 — drives the cell's 4px bar. */
  fraction: number;
  tone: StatTone;
  isDead: boolean;
  shieldHp: number;
  /** "Shield 260 · Mit 8%" — the HP cell's microline; null when
   *  neither shield nor mitigation exists to report. */
  microline: string | null;
}

export interface HeroRundownModel {
  /** No weapons equipped: the DPS cell carries the honest
   *  unarmed line and the dmg/crit cells do not render. */
  unarmed: boolean;
  dps: HeroStatCell | null;
  dmgTick: HeroStatCell | null;
  crit: HeroStatCell | null;
  hp: HeroHpCell;
}

export interface HeroRundownInput {
  summary: CharacterStatSummary;
  snapshot: CharacterMechanicsSnapshot;
  /** Equipped weapons in slot order (primary first); empty = unarmed. */
  weapons: Weapon[];
  survival: {
    currentHp: number;
    maxHp: number;
    shieldHp: number;
    isDead: boolean;
  };
  /** Boss context: DPS reads "Eff. DPS" against the boss pool. */
  bossContext: boolean;
}

const metricOf = (summary: CharacterStatSummary, key: string): StatMetric | undefined =>
  summary.all.find((m) => m.key === key);

export function buildHeroRundown(input: HeroRundownInput): HeroRundownModel {
  const { summary, snapshot, weapons, survival, bossContext } = input;

  // HP — the survival state the claim settles against (survival
  // store is the server-synced mirror). Max is the pool; current
  // rides the live mirror, exactly as the retired band read it.
  const max = Math.max(1, Math.round(survival.maxHp));
  const cur = Math.round(survival.currentHp);
  const fraction = Math.max(0, Math.min(1, cur / max));
  const hpTone: StatTone = survival.isDead || fraction < 0.3 ? 'red' : fraction < 0.6 ? 'amber' : 'green';
  const mitigation = snapshot.mitigation.value;
  const microParts: string[] = [];
  if (survival.shieldHp > 0) microParts.push(`Shield ${formatWhole(survival.shieldHp)}`);
  if (mitigation > 0) microParts.push(`Mit ${formatPct(mitigation)}`);
  const hp: HeroHpCell = {
    key: 'hp',
    label: 'HP',
    display: survival.isDead ? `${formatWhole(cur)}/${formatWhole(max)} · Dead` : `${formatWhole(cur)}/${formatWhole(max)}`,
    current: cur,
    max,
    fraction,
    tone: hpTone,
    isDead: survival.isDead,
    shieldHp: survival.shieldHp,
    microline: microParts.length > 0 ? microParts.join(' · ') : null,
  };

  if (weapons.length === 0) {
    return { unarmed: true, dps: null, dmgTick: null, crit: null, hp };
  }

  let dps: HeroStatCell | null = null;
  let dmgTick: HeroStatCell | null = null;
  const dpsMetric = metricOf(summary, 'dps');
  if (dpsMetric) {
    // Base→effective for DPS: the snapshot's pooled standard DPS
    // (boss-relative pool in a boss context) is the base the
    // summary multiplies by skills + affixes + cache rank — the
    // delta is that multiplier story, printed beside the hero.
    const dpsBase = bossContext ? snapshot.bossRelativeDps.value : snapshot.standardWeaponDps.value;
    const delta = stageStatDelta(dpsBase, dpsMetric.value) ?? undefined;
    dps = {
      key: 'dps',
      label: bossContext ? 'Eff. DPS' : 'DPS',
      display: dpsMetric.display,
      tone: 'red',
      delta,
    };
    // Damage per tick: the contract applies 3 seconds of DPS per
    // tick (variance 0.85–1.15 and monster defense resolve per
    // target; the expectation at variance 1.0 against an
    // undefended target is DPS × tick). Same derivation, same delta.
    dmgTick = {
      key: 'dmgTick',
      label: 'Dmg/tick',
      display: formatWhole(dpsMetric.value * STAGE_TICK_SECONDS),
      tone: 'red',
      delta,
    };
  }

  let crit: HeroStatCell | null = null;
  const critPool = pooledCrit(weapons);
  if (critPool) {
    // Crit prints PLAIN, deliberately: no base→effective
    // derivation for crit exists in the math. The chain consumes
    // each weapon's own crit fields; skill/affix crit never
    // rewrites them — it converts into the DPS aggregate at 0.5
    // weight (skillBonuses.dps), where the DPS delta already
    // tells that story. Inventing an "effective crit" here would
    // be a parallel number no engine settles.
    crit = {
      key: 'crit',
      label: 'Crit',
      display: `${Math.round(critPool.chance * 100)}% · ×${(1 + critPool.damage).toFixed(1)}`,
      tone: 'amber',
    };
  }

  return { unarmed: false, dps, dmgTick, crit, hp };
}

/**
 * The Crit sheet's metric — crit has no summary metric (see the
 * plain-print note in buildHeroRundown), so the breakdown sheet
 * synthesizes one from the same pooled derivation: one
 * contribution row per equipped weapon, weighted exactly as the
 * hero cell pools them. Display-only; the sheet renders it
 * through the standard MetricCard.
 */
export function buildCritMetric(weapons: Weapon[]): StatMetric | null {
  const pool = pooledCrit(weapons);
  if (!pool) return null;
  return {
    key: 'crit',
    label: 'Crit',
    value: pool.chance,
    display: `${Math.round(pool.chance * 100)}% · ×${(1 + pool.damage).toFixed(1)}`,
    detail: 'Pooled across the equipped set, weighted by each weapon\u2019s standard DPS — the weighting the damage chain uses.',
    tone: 'amber',
    contributions: weapons.map((weapon) => ({
      source: weapon.name,
      detail: 'Crit chance · crit damage',
      value: weapon.critChance ?? 0,
      display: `${Math.round((weapon.critChance ?? 0) * 100)}% · ×${(1 + (weapon.critDamage ?? 0)).toFixed(1)}`,
      tone: 'amber' as StatTone,
      bucket: 'weapon' as const,
    })),
  };
}
