/**
 * Action skills — one signature charged ability per skill tree
 * (Action Skill slice, migration 0030).
 *
 * This module is the ONE content owner for the action-skill rules:
 * the four signature definitions, keystone qualification, the charge
 * model constants, the lever surface (defaults + hard clamps), the
 * boss-sim effect construction, and the Scavenger surge rarity
 * weights. Engines (the Chef boss/endless resolvers), routes, stores,
 * and screens all read from here — nobody re-derives a magnitude.
 *
 * The laws this file encodes (design briefs: expansion pack, Fixer
 * brief §3.7 for Overclock — approved by Michael 2026-10-31):
 *
 *  - UNLOCK: a tree's signature is qualified when the player OWNS the
 *    tree's keystone at effective points >= 1, derived SERVER-SIDE
 *    from profiles.skill_spends + the equipped class mod (the
 *    effectiveSkillPoints merge — nodeBoosts and treeBonus count,
 *    exactly like every other server-side skill derivation). A player
 *    may qualify in several trees but fields ONE active signature:
 *    the selection is a server-recorded choice on the profile
 *    (profiles.action_skill_selection), changeable at respec time and
 *    through the selection op. No keystone = no action skill.
 *  - CHARGE: ONE pool (profiles.action_skill_charge, 0..100), shared
 *    by the combat fire and the Fixer's workshop fire (Fixer brief
 *    §3.7 fixes one pool). Charge accrues ONLY from verified server
 *    settlements: boss attempts and endless encounters at the
 *    framework rates, plus — for a Fixer-selected player — craft units
 *    completed and repair points restored (the brief's Fixer sources).
 *    The resolution that FIRES grants no accrual. Endless run end (any
 *    ending) resets the pool to 0; boss charge persists across
 *    attempts until spent.
 *  - FIRE: a server op inside the SAME attempt resolution the Chef
 *    already owns. The applier validates selection + qualification +
 *    charge >= 100 under the profile row lock and zeroes the pool in
 *    the same transaction that persists the attempt — a nonce replay
 *    returns the stored result and can never double-fire. Firing
 *    mints and destroys NO currency; the Scavenger surge bends drop
 *    odds inside the shipped drop pipeline only.
 *  - INTEL LAW: prep surfaces may show the player's OWN signature
 *    state (this file's state view). Nothing here reads or exposes
 *    boss odds.
 *  - ROAMING: action skills never fire in roaming claims in this
 *    slice (non-goal).
 */
import { RARITIES } from '../constants/rarities';
import type { PxIconName } from '@/lib/pixel/icons';
import { SKILL_NODES } from '../constants/skillTrees';
import { SKILL_TREE_VISUALS } from '../constants/skillTreeVisuals';
import type { ActionSkillSimEffect } from '../lib/simulation/bossSimulator';
import { effectiveSkillPoints, type ClassModBoosts } from '../lib/skills/skillBonuses';
import { Rarity, SkillTreeType } from '../types/game';

// ─── Definitions ─────────────────────────────────────────────────────

export interface ActionSkillDef {
  tree: SkillTreeType;
  /** The keystone node whose ownership qualifies the signature. */
  keystoneNodeId: string;
  name: string;
  /** One-line player-facing summary of the fire. */
  summary: string;
  /** Longer player-facing description (prep surfaces, skill screen). */
  description: string;
}

export const ACTION_SKILL_DEFS: Record<SkillTreeType, ActionSkillDef> = {
  [SkillTreeType.Gunslinger]: {
    tree: SkillTreeType.Gunslinger,
    keystoneNodeId: 'gs_keystone',
    name: 'Deadeye Salvo',
    summary: 'A concentrated burst that burns a share of the boss’s health outright.',
    description:
      'When charged, fire Deadeye Salvo inside a boss attempt or endless encounter: a single concentrated burst that deals damage equal to a levered share of the target’s maximum health, resolved inside the fight simulation — it shortens the kill clock, and because the fight ends sooner, the boss deals that share less damage over the fight.',
  },
  [SkillTreeType.Demolition]: {
    tree: SkillTreeType.Demolition,
    keystoneNodeId: 'demo_keystone',
    name: 'Saturation Strike',
    summary: 'Ordnance saturation: flat damage plus shield/armor break and a stagger window.',
    description:
      'When charged, fire Saturation Strike inside a boss attempt or endless encounter: ordnance saturates the target through the simulation’s existing machinery — flat damage, bonus shield break and armor break, and a stagger window that cuts the damage the boss deals while it lasts. No parallel combat math.',
  },
  [SkillTreeType.Scavenger]: {
    tree: SkillTreeType.Scavenger,
    keystoneNodeId: 'scav_keystone',
    name: 'Cache Surge',
    summary: 'Extra drop rolls on victory, rolled hot — Epic and Legendary odds bent by a clamped lever.',
    description:
      'When charged, fire Cache Surge inside a boss attempt or endless encounter: on victory the attempt gains extra drop rolls through the normal drop pipeline, with Epic and Legendary rarity weights multiplied by levered, hard-clamped factors. The dedicated boss drop roll is never touched, and nothing is minted outside the drop pipeline.',
  },
  [SkillTreeType.Fixer]: {
    tree: SkillTreeType.Fixer,
    keystoneNodeId: 'fix_keystone',
    name: 'Overclock',
    summary: 'Combat: prepared consumables read at quality ×1.25. Workshop: instantly completes the unit on every bench.',
    description:
      'Overclock has two fires on one charge pool (Fixer brief §3.7). In a boss attempt or endless encounter, the attempt’s prepared consumables are read at quality × the overclock multiplier for that attempt. At the Workshop, firing instantly completes the in-progress unit on every active bench through the normal settler — same outputs, same quality roll, same XP; it buys time, never output.',
  },
};

export const ACTION_SKILL_TREES: SkillTreeType[] = [
  SkillTreeType.Gunslinger,
  SkillTreeType.Demolition,
  SkillTreeType.Scavenger,
  SkillTreeType.Fixer,
];

export function actionSkillDef(tree: SkillTreeType): ActionSkillDef {
  return ACTION_SKILL_DEFS[tree];
}

export function isActionSkillTree(value: unknown): value is SkillTreeType {
  return typeof value === 'string' && ACTION_SKILL_TREES.includes(value as SkillTreeType);
}

// ─── Charge model ────────────────────────────────────────────────────

/** The one charge pool's capacity. Firing requires a full pool. */
export const ACTION_SKILL_CHARGE_MAX = 100;

// ─── Levers ──────────────────────────────────────────────────────────

/**
 * The action-skill lever surface. Every magnitude and charge rate is
 * a live economy lever (0018 pattern: registered in
 * src/server/economy/config.ts, read through the ONE EconomyConfig
 * accessor, mirrored into SQL by cc_economy_config_number with the
 * same clamps). The defaults and hard clamps live HERE (content) and
 * the config registry imports them, so TS and SQL can never disagree
 * about the shipped default.
 */
export interface ActionSkillLeverValues {
  /** Charge granted by a resolved boss attempt that did not fire. */
  actionSkillChargePerBossAttempt: number;
  /** Charge granted by a resolved endless encounter that did not fire. */
  actionSkillChargePerEndlessEncounter: number;
  /** Charge per craft unit completed (Fixer-selected players only). */
  actionSkillChargePerCraftUnit: number;
  /** Charge per repair condition point restored (Fixer-selected only). */
  actionSkillChargePerRepairPoint: number;
  /** Deadeye Salvo: share of the target's max health dealt as damage. */
  gunslingerBurstBossHpShare: number;
  /** Saturation Strike: share of the target's max health dealt as damage. */
  demolitionSaturationBossHpShare: number;
  /** Saturation Strike: share of shield AND armor added as break damage. */
  demolitionSaturationBreakShare: number;
  /** Saturation Strike: stagger uptime (share of the fight staggered). */
  demolitionSaturationStaggerUptime: number;
  /** Saturation Strike: boss damage cut while staggered. */
  demolitionSaturationStaggerMitigation: number;
  /** Cache Surge: extra generic drop rolls on victory (integer). */
  scavengerSurgeBonusRolls: number;
  /** Cache Surge: Legendary rarity-weight multiplier (HARD clamp [1, 3]). */
  scavengerSurgeLegendaryWeightMult: number;
  /** Cache Surge: Epic rarity-weight multiplier. */
  scavengerSurgeEpicWeightMult: number;
  /** Overclock combat fire: consumable quality multiplier (Fixer brief §3.7). */
  overclockQualityMultiplier: number;
}

export const ACTION_SKILL_LEVER_DEFAULTS: ActionSkillLeverValues = {
  actionSkillChargePerBossAttempt: 34,
  actionSkillChargePerEndlessEncounter: 20,
  actionSkillChargePerCraftUnit: 3,
  actionSkillChargePerRepairPoint: 0.2,
  gunslingerBurstBossHpShare: 0.12,
  demolitionSaturationBossHpShare: 0.07,
  demolitionSaturationBreakShare: 0.35,
  demolitionSaturationStaggerUptime: 0.5,
  demolitionSaturationStaggerMitigation: 0.3,
  scavengerSurgeBonusRolls: 2,
  scavengerSurgeLegendaryWeightMult: 2,
  scavengerSurgeEpicWeightMult: 1.5,
  overclockQualityMultiplier: 1.25,
};

/** Hard clamps per lever — the SQL mirrors clamp identically. */
export const ACTION_SKILL_LEVER_CLAMPS: Record<
  keyof ActionSkillLeverValues,
  { min: number; max: number; integer?: boolean }
> = {
  actionSkillChargePerBossAttempt: { min: 0, max: 100 },
  actionSkillChargePerEndlessEncounter: { min: 0, max: 100 },
  actionSkillChargePerCraftUnit: { min: 0, max: 25 },
  actionSkillChargePerRepairPoint: { min: 0, max: 2 },
  gunslingerBurstBossHpShare: { min: 0, max: 0.35 },
  demolitionSaturationBossHpShare: { min: 0, max: 0.25 },
  demolitionSaturationBreakShare: { min: 0, max: 1 },
  demolitionSaturationStaggerUptime: { min: 0, max: 1 },
  demolitionSaturationStaggerMitigation: { min: 0, max: 0.6 },
  scavengerSurgeBonusRolls: { min: 0, max: 5, integer: true },
  scavengerSurgeLegendaryWeightMult: { min: 1, max: 3 },
  scavengerSurgeEpicWeightMult: { min: 1, max: 3 },
  overclockQualityMultiplier: { min: 1.0, max: 1.5 },
};

function clampLever(key: keyof ActionSkillLeverValues, value: number): number {
  const clamp = ACTION_SKILL_LEVER_CLAMPS[key];
  const clamped = Math.min(clamp.max, Math.max(clamp.min, value));
  return clamp.integer ? Math.trunc(clamped) : clamped;
}

/** Resolve a partial lever bag over the defaults, clamped. */
export function resolveActionSkillLevers(
  partial?: Partial<ActionSkillLeverValues> | null,
): ActionSkillLeverValues {
  const out = { ...ACTION_SKILL_LEVER_DEFAULTS };
  if (partial) {
    for (const key of Object.keys(ACTION_SKILL_LEVER_DEFAULTS) as Array<keyof ActionSkillLeverValues>) {
      const value = partial[key];
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = clampLever(key, value);
    }
  }
  return out;
}

// ─── Qualification + selection (server-side derivation) ─────────────

/**
 * The trees whose signature this player qualifies for: keystone
 * ownership at effective points >= 1, derived from the player's OWN
 * records (skill spends + equipped class mod boosts) — the same
 * derivation every server-side skill consumer uses (#222/#225). A
 * client-supplied tree is never consulted here.
 */
export function qualifiedActionSkillTrees(
  spent: Record<string, number>,
  classModBoosts: ClassModBoosts = { nodeBoosts: {} },
): SkillTreeType[] {
  const effective = effectiveSkillPoints(spent, classModBoosts);
  return ACTION_SKILL_TREES.filter((tree) => {
    const def = ACTION_SKILL_DEFS[tree];
    const node = SKILL_NODES.find((n) => n.id === def.keystoneNodeId);
    if (!node) return false;
    return (effective[def.keystoneNodeId] ?? 0) >= 1;
  });
}

export interface ActionSkillResolution {
  qualified: SkillTreeType[];
  /** The recorded selection when it is (still) qualified, else null. */
  selected: SkillTreeType | null;
}

/**
 * Resolve the player's action-skill standing from server records: the
 * qualified set plus the ACTIVE signature. A recorded selection the
 * player no longer qualifies for (respec removed the keystone) reads
 * as no selection — the stored value is left alone and simply stops
 * resolving (and stops being fireable: the appliers re-check
 * qualification at fire time).
 */
export function resolveActionSkill(
  spent: Record<string, number>,
  classModBoosts: ClassModBoosts,
  selection: string | null | undefined,
): ActionSkillResolution {
  const qualified = qualifiedActionSkillTrees(spent, classModBoosts);
  const selected =
    selection && isActionSkillTree(selection) && qualified.includes(selection) ? selection : null;
  return { qualified, selected };
}

// ─── Fire plans ──────────────────────────────────────────────────────

/** What a combat fire does, resolved by the route from server records
 *  + live levers and handed to the Chef engines. The engines never see
 *  a client claim: the route builds this, the applier re-validates
 *  selection + qualification + charge before spending the pool. */
export interface ActionSkillFirePlan {
  tree: SkillTreeType;
  /** Sim effect for Gunslinger / Demolition (built per-target). */
  simEffect?: ActionSkillSimEffect;
  /** Overclock: the quality multiplier for this attempt's belt. */
  qualityMultiplier?: number;
  /** Cache Surge: extra rolls + rarity weights (victory only). */
  surgeRolls?: number;
  surgeWeights?: Partial<Record<Rarity, number>>;
}

/** Build the sim effect for the two sim-native signatures against a
 *  concrete target (boss def or endless encounter def). Scavenger and
 *  Fixer return undefined — their fires live outside the sim input. */
export function buildActionSkillSimEffect(
  tree: SkillTreeType,
  target: { health: number; shield: number; armor: number },
  leversInput?: Partial<ActionSkillLeverValues> | null,
): ActionSkillSimEffect | undefined {
  const levers = resolveActionSkillLevers(leversInput);
  if (tree === SkillTreeType.Gunslinger) {
    return {
      tree,
      flatDamage: Math.round(levers.gunslingerBurstBossHpShare * Math.max(0, target.health)),
    };
  }
  if (tree === SkillTreeType.Demolition) {
    return {
      tree,
      flatDamage: Math.round(levers.demolitionSaturationBossHpShare * Math.max(0, target.health)),
      shieldBreakBonus: Math.round(levers.demolitionSaturationBreakShare * Math.max(0, target.shield)),
      armorBreakBonus: Math.round(levers.demolitionSaturationBreakShare * Math.max(0, target.armor)),
      staggerUptime: levers.demolitionSaturationStaggerUptime,
      staggerMitigation: levers.demolitionSaturationStaggerMitigation,
    };
  }
  return undefined;
}

/**
 * Cache Surge rarity weights: the shipped base drop weights with the
 * Epic and Legendary entries multiplied by the clamped lever factors.
 * The surge rolls ride the normal generator pipeline with these
 * zoneWeights — the same mechanism as endless milestone drops.
 */
export function surgeRarityWeights(
  leversInput?: Partial<ActionSkillLeverValues> | null,
): Partial<Record<Rarity, number>> {
  const levers = resolveActionSkillLevers(leversInput);
  return {
    [Rarity.Common]: RARITIES[Rarity.Common].dropWeight,
    [Rarity.Uncommon]: RARITIES[Rarity.Uncommon].dropWeight,
    [Rarity.Rare]: RARITIES[Rarity.Rare].dropWeight,
    [Rarity.Epic]: RARITIES[Rarity.Epic].dropWeight * levers.scavengerSurgeEpicWeightMult,
    [Rarity.Legendary]: RARITIES[Rarity.Legendary].dropWeight * levers.scavengerSurgeLegendaryWeightMult,
  };
}

/** The full fire plan for a combat fire of `tree` against `target`. */
export function buildActionSkillFirePlan(
  tree: SkillTreeType,
  target: { health: number; shield: number; armor: number },
  leversInput?: Partial<ActionSkillLeverValues> | null,
): ActionSkillFirePlan {
  const levers = resolveActionSkillLevers(leversInput);
  const plan: ActionSkillFirePlan = { tree };
  const simEffect = buildActionSkillSimEffect(tree, target, levers);
  if (simEffect) plan.simEffect = simEffect;
  if (tree === SkillTreeType.Fixer) plan.qualityMultiplier = levers.overclockQualityMultiplier;
  if (tree === SkillTreeType.Scavenger) {
    plan.surgeRolls = levers.scavengerSurgeBonusRolls;
    plan.surgeWeights = surgeRarityWeights(levers);
  }
  return plan;
}

/** Scale a per-type consumable quality map by a multiplier (Overclock
 *  combat fire). Absent map = flat 100 everywhere (the shipped sim
 *  default), so an empty belt still scales to an explicit map. Only
 *  types present in `types` are written. */
export function scaleConsumableQuality(
  quality: Record<string, number> | undefined,
  types: Iterable<string>,
  multiplier: number,
): Record<string, number> {
  const out: Record<string, number> = { ...(quality ?? {}) };
  for (const type of types) {
    out[type] = (out[type] ?? 100) * multiplier;
  }
  return out;
}

/** Charge after a non-firing resolution: accrued, capped at the pool max. */
export function accrueActionSkillCharge(current: number, amount: number): number {
  const base = Number.isFinite(current) ? Math.max(0, current) : 0;
  const add = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  return Math.min(ACTION_SKILL_CHARGE_MAX, base + add);
}

// ─── Player-facing state view (intel-law clean: own data only) ──────

export interface ActionSkillSignatureView {
  tree: SkillTreeType;
  name: string;
  keystoneNodeId: string;
  summary: string;
  description: string;
  sigil: PxIconName;
  color: string;
  accentColor: string;
  qualified: boolean;
  selected: boolean;
}

export interface ActionSkillStateView {
  /** Current charge in the one pool (0..ACTION_SKILL_CHARGE_MAX). */
  charge: number;
  chargeMax: number;
  /** True when the pool is full and the selected signature can fire. */
  charged: boolean;
  /** The recorded selection (raw profile value), or null. */
  selection: SkillTreeType | null;
  /** The ACTIVE signature (selection ∩ qualification), or null. */
  selected: SkillTreeType | null;
  qualified: SkillTreeType[];
  signatures: ActionSkillSignatureView[];
  /** Plain statement for the no-keystone state (UI shows it verbatim). */
  noKeystoneNote: string | null;
}

export const NO_KEYSTONE_NOTE =
  'No action skill yet — own any skill tree’s keystone to unlock its signature ability.';

export function actionSkillStateView(input: {
  spent: Record<string, number>;
  classModBoosts: ClassModBoosts;
  selection: string | null | undefined;
  charge: number;
}): ActionSkillStateView {
  const { qualified, selected } = resolveActionSkill(input.spent, input.classModBoosts, input.selection);
  const charge = Math.min(
    ACTION_SKILL_CHARGE_MAX,
    Math.max(0, Number.isFinite(input.charge) ? input.charge : 0),
  );
  const signatures = ACTION_SKILL_TREES.map((tree) => {
    const def = ACTION_SKILL_DEFS[tree];
    const visual = SKILL_TREE_VISUALS[tree];
    return {
      tree,
      name: def.name,
      keystoneNodeId: def.keystoneNodeId,
      summary: def.summary,
      description: def.description,
      sigil: visual.sigil,
      color: visual.color,
      accentColor: visual.accentColor,
      qualified: qualified.includes(tree),
      selected: selected === tree,
    };
  });
  return {
    charge,
    chargeMax: ACTION_SKILL_CHARGE_MAX,
    charged: charge >= ACTION_SKILL_CHARGE_MAX && selected !== null,
    selection: isActionSkillTree(input.selection) ? input.selection : null,
    selected,
    qualified,
    signatures,
    noKeystoneNote: qualified.length === 0 ? NO_KEYSTONE_NOTE : null,
  };
}
