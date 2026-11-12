/**
 * Hero rundown — the tappable headline stats attached to the
 * stage's foot. Born as four heroes in the Home consolidation
 * (owner steers 2026-11-03: the mode word dies, the ~15-entry
 * scroller becomes heroes, every hero opens its source
 * breakdown); the owner's device review the same evening stacked
 * it into TWO rows of four at the Door type step — DPS · Dmg/tick
 * · Crit % · Crit × over HP · Shield · Mit · Shield Break — so
 * more of the hunter's real numbers ride the stage's foot.
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
 *
 * Percentage law (owner, 2026-11-03): a stat whose model carries
 * a true base→effective pair (DPS off the weapon pool, HP off
 * the chassis base) prints its delta AS A PERCENTAGE OF BASE,
 * derived from the SAME pair its source-breakdown sheet prints,
 * so rundown and sheet agree exactly. A stat with no base pair
 * in the math (crit, shield, mitigation, shield break) prints
 * plain — a baseline is never invented for the chip.
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
  key: 'dps' | 'dmgTick' | 'critChance' | 'critDamage' | 'shield' | 'mitigation' | 'shieldBreak';
  label: string;
  /** The EFFECTIVE value — the hero number (numbers-emphasis law). */
  display: string;
  tone: StatTone;
  /** Present exactly when modifiers moved the number off base:
   *  the move AS A PERCENTAGE OF BASE, green for gains, red for
   *  losses. Unmodified prints plain; a stat whose model has no
   *  base→effective pair never carries one. */
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
  /** The max pool's move off the chassis base AS A PERCENTAGE —
   *  the health metric's own "+N% from base" figure, computed
   *  from the metric's base-bucket contribution and its value
   *  with the sheet's whole-rounding, so the rundown and the
   *  breakdown sheet print the identical number. Absent when
   *  the pool sits exactly on base. (Shield and mitigation used
   *  to ride this cell as a microline; they are their own cells
   *  in the second row now — no redundant state.) */
  delta?: { display: string; tone: StatTone };
}

export interface HeroRundownModel {
  /** No weapons equipped: row 1 is the honest unarmed line
   *  alone; row 2 (HP · Shield · Mit · Shield Break) still
   *  renders in full — none of it needs a weapon. */
  unarmed: boolean;
  /** Row 1 — the damage line. */
  dps: HeroStatCell | null;
  dmgTick: HeroStatCell | null;
  critChance: HeroStatCell | null;
  critDamage: HeroStatCell | null;
  /** Row 2 — the survival line. */
  hp: HeroHpCell;
  shield: HeroStatCell;
  mitigation: HeroStatCell;
  shieldBreak: HeroStatCell | null;
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
  // The HP percentage is the health metric's OWN figure: the
  // sheet computes round((effective − base) / base × 100) with
  // base = its chassis ('base' bucket) contribution and prints
  // it as "Effective HP (+N% from base)". Recompute from that
  // same pair — never from the survival mirror — so the chip
  // and the sheet can never disagree.
  const healthMetric = metricOf(summary, 'health');
  let hpDelta: { display: string; tone: StatTone } | undefined;
  if (healthMetric) {
    const base = healthMetric.contributions
      .filter((c) => c.bucket === 'base')
      .reduce((sum, c) => sum + c.value, 0);
    if (base > 0 && Number.isFinite(healthMetric.value)) {
      const pct = Math.round(((healthMetric.value - base) / base) * 100);
      if (pct !== 0) {
        hpDelta = { display: `${pct > 0 ? '+' : ''}${pct}%`, tone: pct > 0 ? 'green' : 'red' };
      }
    }
  }
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
    delta: hpDelta,
  };

  // Row 2's gear cells — built before the unarmed return: none
  // of them needs a weapon. Shield capacity and mitigation are
  // the equipped shield's OWN numbers (the snapshot reads them
  // straight off the item): no base→effective pair exists, so
  // they print plain by the percentage law. Shield Break is the
  // summary's additive aggregate (weapon mods + ordnance +
  // skills) — likewise no single base, likewise plain.
  const shield: HeroStatCell = {
    key: 'shield',
    label: 'Shield',
    display: formatWhole(snapshot.shield.value),
    tone: 'cyan',
  };
  const mitigationCell: HeroStatCell = {
    key: 'mitigation',
    label: 'Mit',
    display: formatPct(snapshot.mitigation.value),
    tone: 'cyan',
  };
  const shieldBreakMetric = metricOf(summary, 'shieldBreak');
  const shieldBreak: HeroStatCell | null = shieldBreakMetric
    ? {
        key: 'shieldBreak',
        label: 'Shield Break',
        display: shieldBreakMetric.display,
        tone: shieldBreakMetric.tone,
      }
    : null;

  if (weapons.length === 0) {
    return { unarmed: true, dps: null, dmgTick: null, critChance: null, critDamage: null, hp, shield, mitigation: mitigationCell, shieldBreak };
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
    // Roaming settles a different input from standard weapon DPS:
    // wave/break pools and ordnance participate. Read the Chef's
    // shared derivation from the snapshot, then apply the tick window.
    const tickDps = bossContext ? undefined : snapshot.roamingDps;
    dmgTick = {
      key: 'dmgTick',
      label: 'Dmg/tick',
      display: formatWhole((tickDps?.value ?? dpsMetric.value) * STAGE_TICK_SECONDS),
      tone: 'red',
      delta: tickDps ? stageStatDelta(tickDps.buckets.weapon, tickDps.value) ?? undefined : delta,
    };
  }

  // Crit splits into its two steerable components — chance and
  // multiplier get their own cells in the two-row rundown. Both
  // print PLAIN, deliberately: no base→effective derivation for
  // crit exists in the math. The chain consumes each weapon's
  // own crit fields; skill/affix crit never rewrites them — it
  // converts into the DPS aggregate at 0.5 weight
  // (skillBonuses.dps), where the DPS delta already tells that
  // story. Inventing an "effective crit" here would be a
  // parallel number no engine settles.
  let critChance: HeroStatCell | null = null;
  let critDamage: HeroStatCell | null = null;
  const critPool = pooledCrit(weapons);
  if (critPool) {
    critChance = {
      key: 'critChance',
      label: 'Crit %',
      display: `${Math.round(critPool.chance * 100)}%`,
      tone: 'amber',
    };
    critDamage = {
      key: 'critDamage',
      label: 'Crit ×',
      display: `×${(1 + critPool.damage).toFixed(1)}`,
      tone: 'amber',
    };
  }

  return { unarmed: false, dps, dmgTick, critChance, critDamage, hp, shield, mitigation: mitigationCell, shieldBreak };
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

/**
 * The Shield sheet's metric — shield capacity has no summary
 * metric of its own (the summary folds it into HP), so the
 * breakdown sheet synthesizes one from the snapshot scalar the
 * rundown cell reads: the equipped shield's own contribution
 * rows, carried over verbatim. With no shield equipped the
 * scalar's single row says so ("No shield", 0) — the sheet
 * renders the honest empty state.
 */
export function buildShieldMetric(snapshot: CharacterMechanicsSnapshot): StatMetric {
  const shield = snapshot.shield;
  return {
    key: 'shield',
    label: 'Shield',
    value: shield.value,
    display: formatWhole(shield.value),
    detail: 'The equipped shield\u2019s capacity — incoming damage drains this pool before it reaches HP.',
    tone: 'cyan',
    contributions: shield.contributions.map((c) => ({
      source: c.source,
      detail: 'Shield capacity',
      value: c.value,
      display: formatWhole(c.value),
      tone: 'cyan' as StatTone,
      bucket: c.bucket,
    })),
  };
}

/**
 * The Mitigation sheet's metric — same synthesis as the shield
 * metric, from the snapshot's mitigation scalar: the equipped
 * shield's damage-reduction rate and its source row.
 */
export function buildMitigationMetric(snapshot: CharacterMechanicsSnapshot): StatMetric {
  const mitigation = snapshot.mitigation;
  return {
    key: 'mitigation',
    label: 'Mitigation',
    value: mitigation.value,
    display: formatPct(mitigation.value),
    detail: 'The share of incoming damage the equipped shield turns away before it lands.',
    tone: 'cyan',
    contributions: mitigation.contributions.map((c) => ({
      source: c.source,
      detail: 'Damage mitigation',
      value: c.value,
      display: formatPct(c.value),
      tone: 'cyan' as StatTone,
      bucket: c.bucket,
    })),
  };
}
