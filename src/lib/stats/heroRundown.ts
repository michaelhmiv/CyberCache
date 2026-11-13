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
 * formula; the DPS delta derivation and the per-tick damage
 * expectation are the exact derivations the retired band shipped
 * with (they moved here verbatim), and the crit cells print the
 * boss engine's own composition (see fightCrit).
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
import { computeEffectiveCritChance } from '@/lib/stats/dpsChain';
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

export interface FightCrit {
  /** The chance boss combat settles with, before consumables. */
  chance: number;
  /** The primary weapon's own crit multiplier term (critDamage);
   *  null when no primary is equipped — no weapon, no multiplier. */
  damage: number | null;
  /** The skill-node term inside the chance (0 when no crit nodes). */
  skillChance: number;
}

/**
 * The fight crit — the crit the boss engine settles with, priced
 * for display (audit HTR-04; owner ruling 2026-11-12: Hunter
 * shows the fight number, reversing the weapon-only pooled
 * display this module used to print). Chance is the shared
 * composition (computeEffectiveCritChance, the same function
 * simulateBoss reads for the Gunslinger keystone's high-crit
 * clause): the PRIMARY weapon's crit plus skill-node crit, with
 * the consumable term at zero — a standing display never prices
 * transient buffs. The multiplier is the primary's own
 * critDamage: the chain settles each weapon's crits at that
 * weapon's own multiplier, and skill crit-damage nodes never
 * raise any weapon's multiplier in combat (they convert into
 * the DPS aggregate at 0.5 weight — skillBonuses.dps), so they
 * correctly never move Crit ×.
 *
 * Null when there is nothing to print: no primary equipped and
 * no skill crit — an empty-handed hunter's crit cells stay
 * empty.
 */
export function fightCrit(primary: Weapon | null | undefined, skillBonuses: Record<string, number>): FightCrit | null {
  const skillChance = skillBonuses.critChance || 0;
  if (!primary && skillChance <= 0) return null;
  return {
    chance: computeEffectiveCritChance(primary, skillBonuses),
    damage: primary ? (primary.critDamage ?? 0) : null,
    skillChance,
  };
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
  /** The equipped primary weapon, slot-true: null when the
   *  primary slot is empty even if other slots are filled (the
   *  compacted `weapons` list cannot say which slot its first
   *  entry came from, and the fight crit is the primary's). */
  primary: Weapon | null;
  /** The build's skill-bonus record — the same record the boss
   *  sim receives (computeSkillBonuses over spends + class-mod
   *  boosts); the crit cells read its critChance term. */
  skillBonuses: Record<string, number>;
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
  const { summary, snapshot, weapons, primary, skillBonuses, survival, bossContext } = input;

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
  // print PLAIN, deliberately: crit carries no base→effective
  // pair to percentage against (the percentage law), so no
  // delta is invented for either cell.
  //
  // The VALUES are the boss engine's own (audit HTR-04; owner
  // ruling 2026-11-12 — this reverses the earlier display
  // premise, which held that no engine settles an effective
  // crit and printed a weapon-only pool instead; the boss sim
  // settles one every fight). Crit % is the chance boss combat
  // settles with — primary weapon crit plus skill-node crit,
  // the number the Gunslinger keystone's high-crit clause
  // reads — and Crit × is the primary's own multiplier, the
  // one the chain applies to the crits that chance produces.
  let critChance: HeroStatCell | null = null;
  let critDamage: HeroStatCell | null = null;
  const crit = fightCrit(primary, skillBonuses);
  if (crit) {
    critChance = {
      key: 'critChance',
      label: 'Crit %',
      display: `${Math.round(crit.chance * 100)}%`,
      tone: 'amber',
    };
    if (crit.damage !== null) {
      critDamage = {
        key: 'critDamage',
        label: 'Crit ×',
        display: `×${(1 + crit.damage).toFixed(1)}`,
        tone: 'amber',
      };
    }
  }

  return { unarmed: false, dps, dmgTick, critChance, critDamage, hp, shield, mitigation: mitigationCell, shieldBreak };
}

/**
 * The Crit sheet's metric — crit has no summary metric (see the
 * plain-print note in buildHeroRundown), so the breakdown sheet
 * synthesizes one from the fight crit: the primary weapon's row
 * and, when skill nodes grant crit, the skill row — the two
 * terms the boss engine adds together (audit HTR-04). The other
 * equipped weapons are NOT contributors: combat never pools
 * their crit into the number the keystone reads, so the sheet
 * does not list them. Display-only; the sheet renders it
 * through the standard MetricCard.
 */
export function buildCritMetric(primary: Weapon | null | undefined, skillBonuses: Record<string, number>): StatMetric | null {
  const crit = fightCrit(primary, skillBonuses);
  if (!crit) return null;
  const contributions: StatMetric['contributions'] = [];
  if (primary) {
    contributions.push({
      source: primary.name,
      detail: 'Crit chance · crit damage',
      value: primary.critChance ?? 0,
      display: `${Math.round((primary.critChance ?? 0) * 100)}% · ×${(1 + (primary.critDamage ?? 0)).toFixed(1)}`,
      tone: 'amber' as StatTone,
      bucket: 'weapon' as const,
    });
  }
  if (crit.skillChance > 0) {
    contributions.push({
      source: 'Skill trees',
      detail: 'Crit chance from skill nodes',
      value: crit.skillChance,
      display: `+${Math.round(crit.skillChance * 100)}%`,
      tone: 'purple' as StatTone,
      bucket: 'skill' as const,
    });
  }
  return {
    key: 'crit',
    label: 'Crit',
    value: crit.chance,
    display: crit.damage !== null
      ? `${Math.round(crit.chance * 100)}% · ×${(1 + crit.damage).toFixed(1)}`
      : `${Math.round(crit.chance * 100)}%`,
    detail: 'The crit chance boss combat settles with: your primary weapon\u2019s crit plus the crit your skill nodes grant — the number the Gunslinger keystone\u2019s high-crit clause reads. A consumable\u2019s crit bonus joins for its fight only and never prints here.',
    tone: 'amber',
    contributions,
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
