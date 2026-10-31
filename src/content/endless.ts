/**
 * Endless mode — the Chaos Chamber (migration 0028).
 *
 * This module owns the RULES: the encounter rotation, the escalation
 * curve, the escrow reward curves, the entry-fee schedule, the
 * milestone-drop rarity shaping, and the prep INTEL payload. The
 * server engine (processEndlessEncounter in src/server/chef.ts)
 * resolves encounters through the shared boss simulator against the
 * defs built here; the SQL appliers (cc_start_endless_run /
 * cc_apply_endless_encounter / cc_end_endless_run) are the charging
 * and payout authority and recompute the fee / death fraction from
 * the economy_config table — the formulas below are the TS mirror,
 * parity-pinned by tests.
 *
 * Design rulings (owner-approved run brief, 2026-10-31):
 *
 *  - THE SLOT: a run occupies the personal action slot
 *    (active_actions kind 'endless_run') for its whole duration —
 *    the occupations law, crafting brief flag F6. Starting a run
 *    takes the slot atomically inside cc_start_endless_run; ending
 *    (bank / death / abandon) releases it.
 *  - ESCROW: currency rewards (credits / XP / scrap) accrue into
 *    the run's escrow and are PAID ONLY at run end, from server
 *    state. Milestone gear drops are the exception: they are won
 *    outright at the milestone and stored immediately, exactly like
 *    boss loot — the Chamber taxes the bank, never the trophies.
 *  - DEATH IS CONTAINED (ruling 5): dying in the Chamber ends the
 *    run but does NOT write the roaming death record (0013) — no
 *    death_state, no death_log entry, no resurrection. The 0013
 *    system is anchored to roaming areas (its paid price derives
 *    from the death area's unlockLevel; a Chamber death has no
 *    honest area), and death is the Chamber's EXPECTED ending
 *    ("load up, go until you die"), not an accident to punish with
 *    a roaming lockout on top of the loss. The price of dying is
 *    the escrow tax: death pays floor(escrow × deathPayoutFraction)
 *    (lever, default 50%); banking out alive pays 100%. That gap is
 *    the mode's core decision — push deeper or bank now.
 *    Walking away mid-run (starting another run over an active one)
 *    settles the old run as 'abandoned' at the same death fraction:
 *    the Chamber carries you out on the same stretcher.
 *  - CONSUMABLES: the prepared belt (boss-prep semantics — the
 *    player's chosen set, validated against owned inventory) is
 *    committed ONCE at run start and burned there (through
 *    cc_consume_consumable_batch, like a boss attempt). The sim
 *    prices the belt into every encounter of the run: the run is
 *    ONE attempt, its encounters are phases. This deliberately
 *    diverges from per-attempt boss consumption and is priced into
 *    the reward curves (endless pays less per encounter than a boss
 *    kill partly because the belt is paid once).
 *  - ENTRY FEE (ruling 10): every entry charges
 *    perLevel × playerLevel, escalated ×2 per run already started
 *    today (UTC), capped — the boss rematch-fee shape
 *    (src/lib/bossFees.ts) with starts in place of victories: the
 *    Chamber charges per entry, win or lose. The fee is destroyed
 *    and metered (endless_fees_destroyed, folded into
 *    credits_destroyed_total).
 *  - INTEL LAW: the prep payload carries the RUN's facts — scaling
 *    rates, first-encounter vitals, reward rates, fee schedule, the
 *    death rule — and never a player-readiness figure. There is no
 *    win-chance, odds, or readiness field at any depth of the intel
 *    payload (pinned by the key-walk test, the #218 pattern).
 *  - Each encounter prices the loadout the player CURRENTLY holds
 *    (derived server-side per encounter, like boss attempts):
 *    swapping gear between encounters is legitimate agency.
 */
import { REGION_1_BOSSES } from '../constants/bosses';
import { RARITIES } from '../constants/rarities';
import { ROAMING_AREAS, type RoamingAreaDef } from '../constants/roamingAreas';
import type { BossDef } from '../types/boss';
import { Rarity } from '../types/game';

/** Every Nth depth is a boss-tier encounter (a shipped boss's kit). */
export const ENDLESS_BOSS_EVERY = 5;
/** Milestone gear drops land on boss-tier depths (same cadence). */
export const ENDLESS_MILESTONE_EVERY = ENDLESS_BOSS_EVERY;
/** Visual escalation band width (depths per band) for stage treatment. */
export const ENDLESS_BAND_DEPTHS = 5;

/** Lever defaults (registered in src/server/economy/config.ts). */
export const ENDLESS_HP_GROWTH_DEFAULT = 1.12;
export const ENDLESS_DPS_GROWTH_DEFAULT = 1.1;
export const ENDLESS_XP_PER_LEVEL_DEFAULT = 6;
export const ENDLESS_CREDITS_PER_LEVEL_DEFAULT = 22;
export const ENDLESS_SCRAP_PER_LEVEL_DEFAULT = 0.5;
export const ENDLESS_REWARD_DEPTH_GROWTH_DEFAULT = 0.04;
export const ENDLESS_DEATH_PAYOUT_FRACTION_DEFAULT = 0.5;
export const ENDLESS_ENTRY_FEE_PER_LEVEL_DEFAULT = 10;
export const ENDLESS_FEE_ESCALATION_CAP_DEFAULT = 8;
export const ENDLESS_MILESTONE_LEGENDARY_PER_DEPTH_DEFAULT = 0.1;
export const ENDLESS_MILESTONE_EPIC_PER_DEPTH_DEFAULT = 0.05;
export const ENDLESS_MAX_DEPTH_DEFAULT = 250;

/** Caps on the milestone rarity-weight growth (constants, not levers). */
export const ENDLESS_MILESTONE_LEGENDARY_MULT_CAP = 10;
export const ENDLESS_MILESTONE_EPIC_MULT_CAP = 5;

/** Pack encounters price at this share of the par boss kit's pools.
 *  Tuned against full seven-slot level-appropriate builds in the
 *  boundedness sims: at the original 0.55 health / 0.7 DPS shares the
 *  top-tier par kits (tiers 11–13, whose stats out-scale generated
 *  gear) made even depth 1 a coin flip at L100 (measured winChance
 *  ≈ 0.52, median depth 1 across generated Epic builds). Packs are
 *  roaming-elite tier, not mini-bosses — the floored boss depths are
 *  the gates, and the compounding growth curve, not the depth-1
 *  anchor, is what makes every run finite. */
export const ENDLESS_PACK_HEALTH_SHARE = 0.35;
export const ENDLESS_PACK_POOL_SHARE = 0.25;
export const ENDLESS_PACK_DPS_SHARE = 0.45;

export interface EndlessLeverValues {
  /** Enemy health/shield/armor multiplier per depth (compounding). */
  endlessHpGrowth: number;
  /** Enemy DPS multiplier per depth (compounding). */
  endlessDpsGrowth: number;
  /** Escrow XP per encounter = encounter level × this (before depth growth). */
  endlessXpPerLevel: number;
  /** Escrow credits per encounter = encounter level × this (before depth growth). */
  endlessCreditsPerLevel: number;
  /** Escrow scrap per encounter = encounter level × this (before depth growth). */
  endlessScrapPerLevel: number;
  /** Per-depth additive growth on per-encounter rewards (0.04 = +4%/depth). */
  endlessRewardDepthGrowth: number;
  /** Fraction of escrow paid when a run ends in death (or abandonment). */
  endlessDeathPayoutFraction: number;
  /** Entry fee base = this × player level. */
  endlessEntryFeePerLevel: number;
  /** Cap on the entry-fee escalation multiplier (×2 per start today). */
  endlessFeeEscalationCap: number;
  /** Milestone Legendary rarity-weight growth per depth (additive multiplier). */
  endlessMilestoneLegendaryPerDepth: number;
  /** Milestone Epic rarity-weight growth per depth (additive multiplier). */
  endlessMilestoneEpicPerDepth: number;
  /** Hard depth cap — an anti-pathology valve; reaching it banks the run in full. */
  endlessMaxDepth: number;
}

export const ENDLESS_LEVER_DEFAULTS: EndlessLeverValues = {
  endlessHpGrowth: ENDLESS_HP_GROWTH_DEFAULT,
  endlessDpsGrowth: ENDLESS_DPS_GROWTH_DEFAULT,
  endlessXpPerLevel: ENDLESS_XP_PER_LEVEL_DEFAULT,
  endlessCreditsPerLevel: ENDLESS_CREDITS_PER_LEVEL_DEFAULT,
  endlessScrapPerLevel: ENDLESS_SCRAP_PER_LEVEL_DEFAULT,
  endlessRewardDepthGrowth: ENDLESS_REWARD_DEPTH_GROWTH_DEFAULT,
  endlessDeathPayoutFraction: ENDLESS_DEATH_PAYOUT_FRACTION_DEFAULT,
  endlessEntryFeePerLevel: ENDLESS_ENTRY_FEE_PER_LEVEL_DEFAULT,
  endlessFeeEscalationCap: ENDLESS_FEE_ESCALATION_CAP_DEFAULT,
  endlessMilestoneLegendaryPerDepth: ENDLESS_MILESTONE_LEGENDARY_PER_DEPTH_DEFAULT,
  endlessMilestoneEpicPerDepth: ENDLESS_MILESTONE_EPIC_PER_DEPTH_DEFAULT,
  endlessMaxDepth: ENDLESS_MAX_DEPTH_DEFAULT,
};

function resolveLevers(levers?: Partial<EndlessLeverValues>): EndlessLeverValues {
  return { ...ENDLESS_LEVER_DEFAULTS, ...(levers ?? {}) };
}

/** The boss kit a run is paced against: the highest-level shipped boss
 *  at or below the anchor level (tier 1 when the anchor is below every boss). */
export function parBossForLevel(level: number): BossDef {
  const anchor = Math.max(1, Math.trunc(level) || 1);
  let par = REGION_1_BOSSES[0];
  for (const boss of REGION_1_BOSSES) {
    if (boss.level <= anchor) par = boss;
  }
  return par;
}

/** The roaming area a depth's pack dresses in (rotation through all 7). */
export function endlessAreaForDepth(depth: number): RoamingAreaDef {
  const d = Math.max(1, Math.trunc(depth) || 1);
  return ROAMING_AREAS[(d - 1) % ROAMING_AREAS.length];
}

export function isEndlessBossDepth(depth: number): boolean {
  return depth > 0 && depth % ENDLESS_BOSS_EVERY === 0;
}

export function isEndlessMilestoneDepth(depth: number): boolean {
  return depth > 0 && depth % ENDLESS_MILESTONE_EVERY === 0;
}

/** Visual escalation band (0-based) for a depth. */
export function endlessDepthBand(depth: number): number {
  return Math.floor((Math.max(1, Math.trunc(depth) || 1) - 1) / ENDLESS_BAND_DEPTHS);
}

export interface EndlessEncounterDef {
  depth: number;
  kind: 'pack' | 'boss';
  /** Sim/boss id: the boss kit's id, or `endless_pack_<areaId>` for packs. */
  id: string;
  name: string;
  /** Rotation area for packs; the boss kit's home rotation for boss depths. */
  areaId: string;
  /** Encounter level = run start level + (depth − 1). */
  level: number;
  health: number;
  shield: number;
  armor: number;
  dps: number;
  /** The full sim def (boss kit identity + scaled pools). */
  def: BossDef;
}

/**
 * The encounter at `depth` of a run anchored at `startLevel`.
 * Pools compound from the kit's base stats: health/shield/armor by
 * hpGrowth^(depth−1), DPS by dpsGrowth^(depth−1). Packs price at a
 * share of the par kit (the boss at-or-below the anchor level);
 * boss-tier depths wear a shipped boss's own kit, mechanic, phases,
 * weaknesses, and dedicated-drop identity — with its stat block
 * FLOORED at the par kit's, so a boss depth is always a genuine
 * spike over the packs around it even when the rotation reaches an
 * early-game kit at a high anchor (an unfloored depth-5 Dune Tyrant
 * would be weaker than the depth-4 pack at L20+).
 */
export function endlessEncounterForDepth(
  depth: number,
  startLevel: number,
  leversInput?: Partial<EndlessLeverValues>,
): EndlessEncounterDef {
  const levers = resolveLevers(leversInput);
  const d = Math.max(1, Math.trunc(depth) || 1);
  const anchor = Math.max(1, Math.trunc(startLevel) || 1);
  const level = anchor + (d - 1);
  const hpMult = Math.pow(levers.endlessHpGrowth, d - 1);
  const dpsMult = Math.pow(levers.endlessDpsGrowth, d - 1);
  const area = endlessAreaForDepth(d);

  if (isEndlessBossDepth(d)) {
    const kit = REGION_1_BOSSES[Math.floor(d / ENDLESS_BOSS_EVERY - 1) % REGION_1_BOSSES.length];
    const par = parBossForLevel(anchor);
    const def: BossDef = {
      ...kit,
      level,
      health: Math.round(Math.max(kit.health, par.health) * hpMult),
      shield: Math.round(Math.max(kit.shield, par.shield) * hpMult),
      armor: Math.round(Math.max(kit.armor, par.armor) * hpMult),
      dps: Math.round(Math.max(kit.dps, par.dps) * dpsMult),
      recommendedPower: Math.round(Math.max(kit.recommendedPower, par.recommendedPower) * hpMult),
    };
    return {
      depth: d,
      kind: 'boss',
      id: kit.id,
      name: kit.name,
      areaId: area.id,
      level,
      health: def.health,
      shield: def.shield,
      armor: def.armor,
      dps: def.dps,
      def,
    };
  }

  const par = parBossForLevel(anchor);
  const health = Math.max(1, Math.round(par.health * ENDLESS_PACK_HEALTH_SHARE * hpMult));
  const shield = Math.round(par.shield * ENDLESS_PACK_POOL_SHARE * hpMult);
  const armor = Math.round(par.armor * ENDLESS_PACK_POOL_SHARE * hpMult);
  const dps = Math.max(1, Math.round(par.dps * ENDLESS_PACK_DPS_SHARE * dpsMult));
  const def: BossDef = {
    id: `endless_pack_${area.id}`,
    name: `${area.name} War Pack`,
    tier: par.tier,
    level,
    health,
    shield,
    armor,
    dps,
    weaknesses: [...par.weaknesses],
    resistances: [...par.resistances],
    mechanic: {
      id: 'none',
      name: 'No Special Mechanic',
      description: 'A Chamber war pack. No special requirement — the escalation is the mechanic.',
      checkType: 'mechanic',
    },
    tags: ['simple'],
    phases: [
      {
        id: 'pack_assault',
        name: 'Pack Assault',
        description: 'The pack presses in waves. Raw survival and damage carry the depth.',
        type: 'survival',
        targetValue: 0.6,
        recommendedCounters: ['sustained DPS', 'Med Kit', 'Shield Cell'],
        failureReason: 'The pack overran the position.',
        successReason: 'The pack broke against the position.',
        eventTrigger: 'fightStart',
      },
    ],
    recommendedPower: Math.round(par.recommendedPower * ENDLESS_PACK_HEALTH_SHARE * hpMult),
    entryCost: 0,
    rematchCost: 0,
    dropTable: [],
    dedicatedDrops: [],
  };
  return { depth: d, kind: 'pack', id: def.id, name: def.name, areaId: area.id, level, health, shield, armor, dps, def };
}

export interface EndlessRewards {
  xp: number;
  credits: number;
  scrap: number;
}

/**
 * Escrow earned by clearing `depth` (paid at run end, never per
 * encounter). Rates are anchored to the game's economy: a boss
 * victory pays boss.level × 50 XP and × 150 gross credits for a
 * prepared, fee-charged discrete attempt; an endless encounter is a
 * lighter, faster resolution inside one committed run, so it pays
 * 6 XP and 22 credits per encounter level, both compounding at
 * +4%/depth — a 15-depth run banks roughly 2.4 boss kills of XP
 * while exposing the whole bank to the death tax. Competitive with
 * boss farming per hour at moderate depths, never dominant.
 */
export function endlessRewardsForDepth(
  depth: number,
  encounterLevel: number,
  leversInput?: Partial<EndlessLeverValues>,
): EndlessRewards {
  const levers = resolveLevers(leversInput);
  const d = Math.max(1, Math.trunc(depth) || 1);
  const level = Math.max(1, Math.trunc(encounterLevel) || 1);
  const growth = 1 + levers.endlessRewardDepthGrowth * (d - 1);
  return {
    xp: Math.max(1, Math.round(level * levers.endlessXpPerLevel * growth)),
    credits: Math.max(0, Math.round(level * levers.endlessCreditsPerLevel * growth)),
    scrap: Math.max(0, Math.round(level * levers.endlessScrapPerLevel * growth)),
  };
}

/**
 * The entry fee for the next run: base (perLevel × player level)
 * doubled per run already started today (UTC), capped — the boss
 * rematch shape with starts in place of victories. First run of the
 * day pays the base (multiplier ×1), like a boss's first entryCost.
 */
export function endlessEntryFeeFor(
  playerLevel: number,
  runsStartedToday: number,
  leversInput?: Partial<EndlessLeverValues>,
): { fee: number; baseFee: number; multiplier: number } {
  const levers = resolveLevers(leversInput);
  const baseFee = Math.max(0, Math.round(levers.endlessEntryFeePerLevel * Math.max(1, Math.trunc(playerLevel) || 1)));
  const starts = Math.max(0, Math.trunc(runsStartedToday) || 0);
  const cap = Math.max(1, Math.trunc(levers.endlessFeeEscalationCap) || 1);
  const multiplier = Math.min(cap, 2 ** starts);
  return { fee: baseFee * multiplier, baseFee, multiplier };
}

/**
 * Milestone-drop rarity weights: the global drop table (the same
 * weights boss generic rolls use) with the Epic and Legendary
 * entries growing per depth cleared — legendaries stay scarce
 * (1% of the base table) and only become meaningful deep in a run:
 * at depth 5 the Legendary share is ~1.5%, at depth 25 ~3.4%, at
 * depth 50 ~5.7% — always under the bosses' 10% dedicated rate.
 */
export function endlessMilestoneRarityWeights(
  depth: number,
  leversInput?: Partial<EndlessLeverValues>,
): Partial<Record<Rarity, number>> {
  const levers = resolveLevers(leversInput);
  const d = Math.max(1, Math.trunc(depth) || 1);
  const legendaryMult = Math.min(
    ENDLESS_MILESTONE_LEGENDARY_MULT_CAP,
    1 + levers.endlessMilestoneLegendaryPerDepth * d,
  );
  const epicMult = Math.min(ENDLESS_MILESTONE_EPIC_MULT_CAP, 1 + levers.endlessMilestoneEpicPerDepth * d);
  return {
    [Rarity.Common]: RARITIES[Rarity.Common].dropWeight,
    [Rarity.Uncommon]: RARITIES[Rarity.Uncommon].dropWeight,
    [Rarity.Rare]: RARITIES[Rarity.Rare].dropWeight,
    [Rarity.Epic]: RARITIES[Rarity.Epic].dropWeight * epicMult,
    [Rarity.Legendary]: RARITIES[Rarity.Legendary].dropWeight * legendaryMult,
  };
}

/** The share of milestone rolls that land Legendary at `depth` (display/test math). */
export function endlessMilestoneLegendaryShare(depth: number, leversInput?: Partial<EndlessLeverValues>): number {
  const weights = endlessMilestoneRarityWeights(depth, leversInput);
  const total = Object.values(weights).reduce((sum, w) => sum + (w ?? 0), 0);
  return total > 0 ? (weights[Rarity.Legendary] ?? 0) / total : 0;
}

export interface EndlessIntel {
  mode: 'chaos_chamber';
  startLevel: number;
  bossEvery: number;
  milestoneEvery: number;
  maxDepth: number;
  escalation: {
    healthGrowthPercentPerDepth: number;
    damageGrowthPercentPerDepth: number;
    packHealthSharePercent: number;
    packDamageSharePercent: number;
  };
  firstEncounter: {
    name: string;
    kind: 'pack' | 'boss';
    level: number;
    health: number;
    shield: number;
    armor: number;
    dps: number;
    weaknesses: string[];
    resistances: string[];
  };
  firstBossEncounter: {
    name: string;
    depth: number;
    level: number;
    health: number;
    shield: number;
    armor: number;
    dps: number;
    mechanicName: string;
    mechanicDescription: string;
  };
  rewards: {
    xpPerEncounterLevel: number;
    creditsPerEncounterLevel: number;
    scrapPerEncounterLevel: number;
    rewardGrowthPercentPerDepth: number;
    firstEncounterXp: number;
    firstEncounterCredits: number;
    firstEncounterScrap: number;
    milestoneItemLevelRule: 'encounter_level';
    milestoneLegendaryWeightGrowthPercentPerDepth: number;
  };
  entry: {
    feeCredits: number;
    baseFeeCredits: number;
    feeMultiplier: number;
    runsStartedToday: number;
    escalationCap: number;
    escalationRule: 'doubles_per_run_started_today';
  };
  deathRule: {
    payoutPercentOnDeath: number;
    payoutPercentOnBank: number;
    roamingDeathRecord: false;
    beltRule: 'prepared_set_burned_at_entry';
  };
}

/**
 * The prep INTEL payload (Boss Intel Law): the RUN's mechanics and
 * stats — never the player's readiness. Field names avoid every
 * chance/odds/readiness term by construction (key-walk test).
 */
export function endlessIntel(
  startLevel: number,
  runsStartedToday: number,
  leversInput?: Partial<EndlessLeverValues>,
): EndlessIntel {
  const levers = resolveLevers(leversInput);
  const anchor = Math.max(1, Math.trunc(startLevel) || 1);
  const first = endlessEncounterForDepth(1, anchor, levers);
  const firstBoss = endlessEncounterForDepth(ENDLESS_BOSS_EVERY, anchor, levers);
  const firstRewards = endlessRewardsForDepth(1, first.level, levers);
  const fee = endlessEntryFeeFor(anchor, runsStartedToday, levers);
  return {
    mode: 'chaos_chamber',
    startLevel: anchor,
    bossEvery: ENDLESS_BOSS_EVERY,
    milestoneEvery: ENDLESS_MILESTONE_EVERY,
    maxDepth: levers.endlessMaxDepth,
    escalation: {
      healthGrowthPercentPerDepth: Math.round((levers.endlessHpGrowth - 1) * 100),
      damageGrowthPercentPerDepth: Math.round((levers.endlessDpsGrowth - 1) * 100),
      packHealthSharePercent: Math.round(ENDLESS_PACK_HEALTH_SHARE * 100),
      packDamageSharePercent: Math.round(ENDLESS_PACK_DPS_SHARE * 100),
    },
    firstEncounter: {
      name: first.name,
      kind: first.kind,
      level: first.level,
      health: first.health,
      shield: first.shield,
      armor: first.armor,
      dps: first.dps,
      weaknesses: [...first.def.weaknesses],
      resistances: [...first.def.resistances],
    },
    firstBossEncounter: {
      name: firstBoss.name,
      depth: firstBoss.depth,
      level: firstBoss.level,
      health: firstBoss.health,
      shield: firstBoss.shield,
      armor: firstBoss.armor,
      dps: firstBoss.dps,
      mechanicName: firstBoss.def.mechanic.name,
      mechanicDescription: firstBoss.def.mechanic.description,
    },
    rewards: {
      xpPerEncounterLevel: levers.endlessXpPerLevel,
      creditsPerEncounterLevel: levers.endlessCreditsPerLevel,
      scrapPerEncounterLevel: levers.endlessScrapPerLevel,
      rewardGrowthPercentPerDepth: Math.round(levers.endlessRewardDepthGrowth * 100),
      firstEncounterXp: firstRewards.xp,
      firstEncounterCredits: firstRewards.credits,
      firstEncounterScrap: firstRewards.scrap,
      milestoneItemLevelRule: 'encounter_level',
      milestoneLegendaryWeightGrowthPercentPerDepth: Math.round(levers.endlessMilestoneLegendaryPerDepth * 100),
    },
    entry: {
      feeCredits: fee.fee,
      baseFeeCredits: fee.baseFee,
      feeMultiplier: fee.multiplier,
      runsStartedToday: Math.max(0, Math.trunc(runsStartedToday) || 0),
      escalationCap: levers.endlessFeeEscalationCap,
      escalationRule: 'doubles_per_run_started_today',
    },
    deathRule: {
      payoutPercentOnDeath: Math.round(levers.endlessDeathPayoutFraction * 100),
      payoutPercentOnBank: 100,
      roamingDeathRecord: false,
      beltRule: 'prepared_set_burned_at_entry',
    },
  };
}
