/**
 * Stage stats band — the effective-numbers builder for the stage's
 * bottom ribbon (owner direction 2026-11-02: the ribbon stops
 * narrating the latest event and instead shows ALL the player's
 * effective stats for the action they're in — DPS and damage for
 * combat, yields and chances for gathering — visible the moment
 * they walk in).
 *
 * Pure builder: the component assembles the inputs from the stores
 * and the canonical summaries, this module turns them into an
 * ordered list of band entries for the CURRENT activity kind.
 *
 * Source law (AGENTS.md): every number here is read from the same
 * summaries/aggregates the engines consume — the character stat
 * summary + mechanics snapshot (buildCharacterStatSummary /
 * buildCharacterMechanicsSnapshot), the roaming base rates
 * (src/content/roamingRates.ts), the vehicle helpers
 * (src/lib/vehicles/vehicles.ts), the crafting bounds function
 * (src/content/crafting.ts) and the extraction pass math
 * (src/content/extraction.ts). Nothing is re-derived from a
 * parallel formula. Where the Chef applies additional server-side
 * terms the client cannot see (economy levers, hot-area yield,
 * roaming-event windows, cache-rank faucet bonuses), the band shows
 * the client-mirrorable composition — the same basis the roaming
 * workspace panel has always displayed — and the PR's inventory
 * table names those terms explicitly.
 */
import type { ActivityKind } from '@/types/activity';
import type { Weapon } from '@/types/items';
import type { CharacterStatSummary, StatMetric, StatTone } from '@/lib/stats/characterStats';
import type { CharacterMechanicsSnapshot } from '@/lib/mechanics/buildCharacterMechanicsSnapshot';
import { computeStandardDps } from '@/lib/stats/dpsChain';
import { formatPct, formatWhole } from '@/lib/stats/formatStat';
import { CACHE_FRAGMENT_CHANCE, GEAR_DROP_CHANCE, MATERIAL_FIND_CHANCE } from '@/content/roamingRates';
import {
  ALL_CRAFT_RECIPES,
  CRAFT_XP_RATE_DEFAULT,
  craftQualityBounds,
  craftUnitXp,
  qualityMasteryTrackForKind,
} from '@/content/crafting';

/** The game tick, seconds — the same constant the damage contract
 *  (src/lib/combat/damageContract.ts) and the boss tick apply. */
export const STAGE_TICK_SECONDS = 3;

export interface StageStatEntry {
  key: string;
  label: string;
  /** The EFFECTIVE value — the hero number, rendered largest and
   *  brightest (owner refinement 2026-11-02: "This is a numbers
   *  game and people like idle games because they like seeing
   *  numbers go up and we need to lean into that"). */
  display: string;
  tone: StatTone;
  /**
   * The modifier delta vs the stat's base value, present exactly
   * when a base→effective derivation changed the number: green
   * when the modifiers gained, red when they cost (debuffs,
   * out-of-fuel yield loss). Rendered smaller than the hero.
   * Unmodified stats print plain — no delta.
   */
  delta?: { display: string; tone: StatTone };
}

/**
 * The delta between a base value and its effective (modified)
 * value, as a signed percentage: 100 → 150 prints "+50%", a yield
 * lost to an empty tank prints its shortfall vs the vehicle's
 * fueled potential in red. Returns null when there is nothing to
 * say: no base, no change, or a change too small to print a
 * nonzero percentage for.
 */
export function stageStatDelta(base: number, effective: number): { display: string; tone: StatTone } | null {
  if (!(base > 0) || !Number.isFinite(base) || !Number.isFinite(effective)) return null;
  const change = effective / base - 1;
  if (Math.abs(change) < 0.0005) return null;
  const pts = Math.abs(change) * 100;
  const magnitude = pts >= 9.95 ? `${Math.round(pts)}` : pts.toFixed(1);
  return { display: `${change > 0 ? '+' : '-'}${magnitude}%`, tone: change > 0 ? 'green' : 'red' };
}

/** The running workshop job, structurally — the component maps the
 *  workshop store's WorkshopJobView onto this shape. */
export interface StageBandJob {
  name: string;
  bench: number;
  kind: string;
  recipeId: string;
  state: string;
  unitsTotal: number;
  unitsCompleted: number;
  unitDurationMs: number;
  remainingMs: number;
  catalystMaterialId: string | null;
}

export interface StageStatsBandInput {
  kind: ActivityKind;
  summary: CharacterStatSummary;
  snapshot: CharacterMechanicsSnapshot;
  /** Equipped weapons in slot order (primary first); empty = unarmed. */
  weapons: Weapon[];
  area: {
    idleCreditsPerMinute: number;
    idleScrapPerMinute: number;
    idleXpPerTick: number;
    dangerRating: string;
  };
  survival: {
    currentHp: number;
    maxHp: number;
    shieldHp: number;
    isDead: boolean;
  };
  vehicle: {
    equipped: boolean;
    /** True when the yield bonus is live (fueled + condition > 0). */
    active: boolean;
    /** Effective yield factor the claim applies (1 when inactive). */
    factor: number;
    /** The factor the vehicle WOULD apply fueled and sound — the
     *  base an inactive vehicle's ×1.00 is delta'd against, so an
     *  empty tank shows its yield loss in red. */
    potentialFactor: number;
    fuelUnits: number;
    /** Whole fueled ticks the current tank buys at the class burn. */
    fuelTicks: number;
    /** 'empty' | 'worn' when equipped but inactive; null otherwise. */
    inactiveReason: 'empty' | 'worn' | null;
    /** Vehicle scanner affix total (fraction) — scales loot rolls. */
    scannerPct: number;
    /** Cargo/material bonus-find chance from the vehicle (fraction). */
    cargoChance: number;
  };
  /** The current boss def's band facts, when a boss context exists. */
  boss: { recommendedPower: number; dps: number } | null;
  crafting: {
    runningJob: StageBandJob | null;
    benchesFree: number;
    masteries: Record<string, { level: number; xp: number }>;
    playerLevel: number;
  };
  extraction: {
    /** EXTRACTION_PASS_MS, formatted by the builder. */
    passMs: number;
    gearFactor: number;
    pool: number;
    expectedPassDamage: number;
    deepGateFactor: number;
  } | null;
  /** effectiveOfflineCapHours(...) — standby's AFK cap entry. */
  offlineCapHours: number;
}

const entry = (key: string, label: string, display: string, tone: StatTone): StageStatEntry => ({ key, label, display, tone });

/** Fractional faucet rate: up to 2 decimals, trailing zeros trimmed
 *  (the roaming panel's established preview format). */
export const formatRate = (value: number): string => `${parseFloat(value.toFixed(2))}`;

/** A per-tick chance as a percentage: whole above 10%, one decimal
 *  below (0.8% must never round up to a lying 1%). */
export const formatChance = (chance: number): string => {
  const pct = Math.max(0, chance) * 100;
  return pct >= 10 ? `${Math.round(pct)}%` : `${pct.toFixed(1)}%`;
};

export const formatBandDuration = (ms: number): string => {
  const mins = Math.floor(ms / 60000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  if (mins >= 1) return `${mins}m`;
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
};

const metricOf = (summary: CharacterStatSummary, key: string): StatMetric | undefined =>
  summary.all.find((m) => m.key === key);

const moduleMetric = (summary: CharacterStatSummary, kind: ActivityKind, key: string): StatMetric | undefined =>
  summary.all.find((m) => m.sourceActivity === kind && m.key === key);

/** Non-zero activity-module sub-stats for a kind — real engine
 *  inputs (sumActivityModifier is the canonical read path), shown
 *  for the kinds whose folded headline numbers don't already carry
 *  them (crafting / salvaging / market / workshop / extraction). */
const moduleEntries = (summary: CharacterStatSummary, kind: ActivityKind): StageStatEntry[] =>
  summary.all
    .filter((m) => m.sourceActivity === kind && m.value !== 0)
    .map((m) => entry(`mod-${kind}-${m.key}`, m.label, m.display, m.tone));

/** DPS-weighted pooled crit across the equipped set — the chain
 *  (dpsChain step 1) folds (1 + critChance × critDamage) per weapon,
 *  so the pooled pair is weighted by each weapon's standard DPS,
 *  the same weighting the pooled damage uses. */
function pooledCrit(weapons: Weapon[]): { chance: number; damage: number } | null {
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

/** Combat entries shared by roaming, boss and endless: the armed
 *  set (DPS first — the owner's example), or the honest unarmed
 *  line the standby stage has always printed. */
function combatEntries(input: StageStatsBandInput, bossContext: boolean): StageStatEntry[] {
  const { summary, weapons } = input;
  if (weapons.length === 0) {
    return [entry('weapon', 'Weapon', 'No weapon equipped', 'red')];
  }
  const dps = metricOf(summary, 'dps');
  const out: StageStatEntry[] = [];
  if (dps) {
    // Base→effective for DPS: the snapshot's pooled standard DPS
    // (boss-relative pool in a boss context) is the base the
    // summary multiplies by skills + affixes + cache rank — the
    // delta is that multiplier story, printed beside the hero.
    const dpsBase = bossContext ? input.snapshot.bossRelativeDps.value : input.snapshot.standardWeaponDps.value;
    const dpsDelta = stageStatDelta(dpsBase, dps.value) ?? undefined;
    out.push({ ...entry('dps', bossContext ? 'Eff. DPS' : 'DPS', dps.display, 'red'), delta: dpsDelta });
    // Damage per tick: the contract applies 3 seconds of DPS per
    // tick (variance 0.85–1.15 and monster defense resolve per
    // target; the band shows the expectation at variance 1.0
    // against an undefended target — DPS × tick). Same derivation,
    // same delta.
    out.push({ ...entry('dmgTick', 'Dmg/tick', formatWhole(dps.value * STAGE_TICK_SECONDS), 'red'), delta: dpsDelta });
  }
  const crit = pooledCrit(weapons);
  if (crit) {
    // Crit prints PLAIN, deliberately: no base→effective
    // derivation for crit exists in the math. The chain consumes
    // each weapon's own crit fields; skill/affix crit never
    // rewrites them — it converts into the DPS aggregate at 0.5
    // weight (skillBonuses.dps), where the DPS delta already
    // tells that story. Inventing an "effective crit" here would
    // be a parallel number no engine settles.
    out.push(entry('crit', 'Crit', `${Math.round(crit.chance * 100)}% · ×${(1 + crit.damage).toFixed(1)}`, 'amber'));
  }
  const primary = weapons[0];
  if (primary) out.push(entry('element', 'Element', `${primary.element}`, 'muted'));
  return out;
}

/** HP / shield / mitigation — the survival state the claim settles
 *  against (survival store is the server-synced mirror). */
function survivalEntries(input: StageStatsBandInput): StageStatEntry[] {
  const { survival, snapshot } = input;
  const max = Math.max(1, Math.round(survival.maxHp));
  const cur = Math.round(survival.currentHp);
  const fraction = cur / max;
  const tone: StatTone = survival.isDead || fraction < 0.3 ? 'red' : fraction < 0.6 ? 'amber' : 'green';
  const out: StageStatEntry[] = [
    entry('hp', 'HP', survival.isDead ? `${formatWhole(cur)}/${formatWhole(max)} · Dead` : `${formatWhole(cur)}/${formatWhole(max)}`, tone),
  ];
  if (survival.shieldHp > 0) out.push(entry('shieldHp', 'Shield', formatWhole(survival.shieldHp), 'cyan'));
  const mitigation = snapshot.mitigation.value;
  if (mitigation > 0) out.push(entry('mitigation', 'Mitigation', formatPct(mitigation), 'cyan'));
  return out;
}

/** The gathering faucet for the selected area: per-tick yields and
 *  find chances with the summary's modifier aggregates and the
 *  vehicle factor folded in — the composition the Chef's claim
 *  applies (see the inventory in the PR body). */
function gatheringEntries(input: StageStatsBandInput): StageStatEntry[] {
  const { summary, snapshot, area, vehicle, kind } = input;
  const offlineMod = metricOf(summary, 'offline')?.value ?? 0;
  const scrapMod = metricOf(summary, 'scrap')?.value ?? 0;
  const rareFind = metricOf(summary, 'rareFind')?.value ?? 0;
  const xpMod = snapshot.xpModifier.value;
  const fragmentBonus = moduleMetric(summary, 'roaming_loot', 'cacheFragmentChance')?.value ?? 0;
  const materialBonus = moduleMetric(summary, 'roaming_loot', 'materialFindChance')?.value ?? 0;
  const scanner = 1 + Math.max(0, vehicle.scannerPct);
  const factor = vehicle.factor;

  const credits = (area.idleCreditsPerMinute / 20) * (1 + offlineMod) * factor;
  const scrap = (area.idleScrapPerMinute / 20) * (1 + scrapMod) * factor;
  const xp = area.idleXpPerTick * (1 + xpMod) * factor;
  const gearChance = GEAR_DROP_CHANCE * (1 + rareFind) * factor * scanner;
  const fragChance = CACHE_FRAGMENT_CHANCE * (1 + fragmentBonus) * factor * scanner;
  const matChance = MATERIAL_FIND_CHANCE * (1 + materialBonus) * factor;

  // Every faucet prints its effective rate as the hero with the
  // delta vs its raw base (area rate / content base chance) beside
  // it — the modifier story (offline/scrap/rare-find aggregates,
  // activity bonuses, the vehicle factor) at a glance.
  const withDelta = (e: StageStatEntry, base: number, effective: number): StageStatEntry => {
    const delta = stageStatDelta(base, effective) ?? undefined;
    return delta ? { ...e, delta } : e;
  };
  const out: StageStatEntry[] = [
    withDelta(entry('credits', 'Credits/tick', `+${formatRate(credits)}`, 'cyan'), area.idleCreditsPerMinute / 20, credits),
    withDelta(entry('scrap', 'Scrap/tick', `+${formatRate(scrap)}`, 'green'), area.idleScrapPerMinute / 20, scrap),
    withDelta(entry('xp', 'XP/tick', `+${formatRate(xp)}`, 'purple'), area.idleXpPerTick, xp),
    withDelta(entry('gearChance', 'Gear/tick', formatChance(gearChance), 'amber'), GEAR_DROP_CHANCE, gearChance),
    withDelta(entry('fragChance', 'Frag/tick', formatChance(fragChance), 'cyan'), CACHE_FRAGMENT_CHANCE, fragChance),
    withDelta(entry('matChance', 'Mats/tick', formatChance(matChance), 'green'), MATERIAL_FIND_CHANCE, matChance),
  ];
  if (vehicle.cargoChance > 0) {
    out.push(entry('cargo', 'Cargo bonus', formatChance(vehicle.cargoChance), 'amber'));
  }
  // The one roaming module sub-stat that is NOT folded into a
  // headline number above: credits-per-kill is a per-kill faucet,
  // distinct from the per-tick credit rate.
  const creditsPerKill = moduleMetric(summary, kind === 'idle_standby' || kind === 'none' ? 'roaming_loot' : kind, 'creditsPerKill');
  if (creditsPerKill && creditsPerKill.value !== 0) {
    out.push(entry('creditsPerKill', creditsPerKill.label, creditsPerKill.display, creditsPerKill.tone));
  }
  return out;
}

/** Vehicle yield + fuel state. The yield prints its delta against
 *  the ×1.00 on-foot base while active; while inactive (empty tank
 *  or worn out) the hero is ×1.00 and the delta runs the other way
 *  — the loss vs the vehicle's fueled potential, in red. */
function vehicleEntry(input: StageStatsBandInput): StageStatEntry[] {
  const { vehicle } = input;
  if (!vehicle.equipped) {
    return [entry('vehicle', 'Vehicle', 'On foot ×1.00', 'muted')];
  }
  if (vehicle.active) {
    const delta = stageStatDelta(1, vehicle.factor) ?? undefined;
    const out: StageStatEntry[] = [
      { ...entry('vehicle', 'Vehicle', `×${vehicle.factor.toFixed(2)}`, 'green'), delta },
    ];
    out.push(entry('fuel', 'Fuel', `${Math.floor(vehicle.fuelUnits)}u · ~${vehicle.fuelTicks} ticks`, 'muted'));
    return out;
  }
  const reason = vehicle.inactiveReason === 'worn' ? 'Worn out' : 'Empty';
  const loss = stageStatDelta(vehicle.potentialFactor, 1) ?? undefined;
  return [{ ...entry('vehicle', 'Vehicle', `×1.00 · ${reason}`, 'red'), delta: loss }];
}

function craftingEntries(input: StageStatsBandInput): StageStatEntry[] {
  const { crafting } = input;
  const job = crafting.runningJob;
  if (!job) {
    const out: StageStatEntry[] = [
      entry('benches', 'Benches', crafting.benchesFree > 0 ? `${crafting.benchesFree} free` : 'All busy', crafting.benchesFree > 0 ? 'green' : 'red'),
    ];
    const trackLabels: Array<[string, string]> = [
      ['crafting.gear', 'Mastery · Gear'],
      ['crafting_consumables', 'Mastery · Consumables'],
      ['crafting.cosmetics', 'Mastery · Cosmetics'],
    ];
    for (const [track, label] of trackLabels) {
      const mastery = crafting.masteries[track];
      if (mastery) out.push(entry(`mastery-${track}`, label, `Lv ${mastery.level}`, 'purple'));
    }
    return out;
  }
  const recipe = ALL_CRAFT_RECIPES.find((r) => r.id === job.recipeId);
  const track = qualityMasteryTrackForKind(job.kind as Parameters<typeof qualityMasteryTrackForKind>[0]);
  const masteryLevel = crafting.masteries[track]?.level;
  const bounds = recipe
    ? craftQualityBounds({
        consumableType: job.kind === 'consumable' ? recipe.consumableType : null,
        masteryLevel: masteryLevel ?? 1,
        bench: job.bench,
        catalyst: job.catalystMaterialId !== null,
      })
    : null;
  const xpPerUnit = craftUnitXp(job.unitDurationMs, crafting.playerLevel, CRAFT_XP_RATE_DEFAULT);
  const out: StageStatEntry[] = [
    entry('job', 'Job', job.name, 'amber'),
    entry('bench', 'Bench', `${job.bench}`, 'muted'),
  ];
  if (masteryLevel !== undefined) out.push(entry('mastery', 'Mastery', `Lv ${masteryLevel}`, 'purple'));
  if (bounds) out.push(entry('quality', 'Quality', `${Math.round(bounds.min)}–${Math.round(bounds.max)}%`, 'green'));
  out.push(entry('units', 'Units', `${job.unitsCompleted}/${job.unitsTotal}`, 'muted'));
  out.push(entry('jobXp', 'XP/unit', formatRate(xpPerUnit), 'purple'));
  out.push(entry('jobLeft', 'Left', job.state === 'paused' ? 'Paused' : formatBandDuration(job.remainingMs), job.state === 'paused' ? 'red' : 'muted'));
  return out;
}

function bossEntries(input: StageStatsBandInput): StageStatEntry[] {
  const { summary, boss } = input;
  const out: StageStatEntry[] = [...combatEntries(input, true)];
  const sim = metricOf(summary, 'boss');
  if (sim) out.push(entry('simDps', 'Sim DPS', sim.display, 'amber'));
  const shieldBreak = metricOf(summary, 'shieldBreak');
  if (shieldBreak) out.push(entry('shieldBreak', 'Shield Break', shieldBreak.display, 'cyan'));
  const armorBreak = metricOf(summary, 'armorBreak');
  if (armorBreak) out.push(entry('armorBreak', 'Armor Break', armorBreak.display, 'purple'));
  out.push(...survivalEntries(input));
  if (boss) {
    out.push(entry('bossDps', 'Boss DPS', formatWhole(boss.dps), 'red'));
    out.push(entry('recPower', 'Rec. Power', formatWhole(boss.recommendedPower), 'muted'));
  }
  return out;
}

/**
 * The band for the current activity kind, ordered by importance
 * for that action. Pure: same input, same entries.
 */
export function buildStageStatsBand(input: StageStatsBandInput): StageStatEntry[] {
  const { kind, summary } = input;
  switch (kind) {
    case 'roaming_loot':
      return [...combatEntries(input, false), ...survivalEntries(input), ...gatheringEntries(input), ...vehicleEntry(input), dangerEntry(input)];
    case 'idle_standby':
    case 'none': {
      // Standby shows the stats the loadout WILL roam with (the
      // roaming set) plus the idle economy: offline modifier and
      // the effective AFK cap.
      const out: StageStatEntry[] = [...combatEntries(input, false), ...survivalEntries(input), ...gatheringEntries(input), ...vehicleEntry(input)];
      const offline = metricOf(summary, 'offline');
      if (offline) out.push(entry('offline', 'Offline', offline.display, 'green'));
      out.push(entry('afkCap', 'AFK cap', `${input.offlineCapHours}h`, 'muted'));
      out.push(dangerEntry(input));
      return out;
    }
    case 'boss_fight':
      return bossEntries(input);
    case 'endless_run':
      return [...combatEntries(input, false), ...survivalEntries(input)];
    case 'crafting':
      return [...craftingEntries(input), ...moduleEntries(summary, 'crafting')];
    case 'extraction': {
      const ex = input.extraction;
      if (!ex) return [...combatEntries(input, false), ...survivalEntries(input)];
      const out: StageStatEntry[] = [
        entry('pass', 'Pass', formatBandDuration(ex.passMs), 'muted'),
        entry('gearFactor', 'Gear factor', `×${ex.gearFactor.toFixed(2)}`, ex.gearFactor >= ex.deepGateFactor ? 'green' : 'amber'),
        entry('pool', 'Pool', formatWhole(ex.pool), 'green'),
        entry('dmgPass', 'Dmg/pass', formatWhole(ex.expectedPassDamage), 'red'),
        entry('deepGate', 'Deep gate', `×${ex.deepGateFactor.toFixed(2)}`, 'muted'),
      ];
      return [...out, ...moduleEntries(summary, 'extraction')];
    }
    case 'salvaging': {
      const scrap = metricOf(summary, 'scrap');
      const out: StageStatEntry[] = [];
      if (scrap) out.push(entry('scrapYield', 'Scrap Yield', scrap.display, 'cyan'));
      return [...out, ...moduleEntries(summary, 'salvaging')];
    }
    case 'workshop_service':
    case 'market_listing':
      return [...combatEntries(input, false), ...survivalEntries(input), ...moduleEntries(summary, kind)];
    default:
      return [...combatEntries(input, false), ...survivalEntries(input)];
  }
}

function dangerEntry(input: StageStatsBandInput): StageStatEntry {
  return entry('danger', 'Danger', `${input.area.dangerRating}`, 'muted');
}

