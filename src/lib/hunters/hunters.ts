/**
 * hunters — the Cache Hunters roster and the per-hunter derivations
 * (character reshape slice (a), owner-ruled 2026-11-14; brief §2/§4).
 *
 * The reshape partitions exactly two things: skill spends (per-hunter
 * point pools over the shared level−1 budget) and loadout assignments.
 * Everything else — level, wallet, arsenal, materials, vehicles,
 * Cache Rank, Mastery, Research, boss state — stays in one shared
 * account pool, exactly as shipped.
 *
 * This module is the ONE owner of:
 *  - the hunter roster (id ↔ tree ↔ signature),
 *  - the base perks (the BL4 Trait slot: innate, no points, expressed
 *    in already-consumed effect keys as hunter-level constants),
 *  - the spend-subset filter (a hunter's pool = the spends whose node
 *    belongs to that hunter's tree; node ids never change),
 *  - the hunter-aware skill derivation every engine reads
 *    (computeHunterSkillBonuses — the TS twin of the SQL derivations
 *    restated by migration 0097),
 *  - the per-hunter loadout assignment shape stored on the profile
 *    (profiles.hunter_loadouts, migration 0097),
 *  - the class-mod binding rule (a mod equips only on the hunter
 *    whose tree it boosts; every refusal carries its reason),
 *  - the Dispatch "spare" test across ALL hunters' loadouts.
 *
 * Pure: no store, no I/O. Server and client both read from here.
 */
import { SKILL_NODES } from '../../constants/skillTrees';
import { SkillTreeType } from '../../types/game';
import {
  computeSkillBonuses,
  effectiveSkillPoints,
  type ClassModBoosts,
  type SkillBonuses,
} from '../skills/skillBonuses';

// ─── Roster ──────────────────────────────────────────────────────────

export type HunterId = 'vesper' | 'silas' | 'josie' | 'doc';

export interface HunterDef {
  id: HunterId;
  name: string;
  /** The hunter's one specialized tree (brief §2.1). */
  tree: SkillTreeType;
  /** Base perk display name (the innate Trait-slot passive). */
  basePerkName: string;
  /**
   * Base perk constants, in already-consumed effect keys (zero-dead-
   * keys law, brief §3.9). These enter the same derivation that reads
   * skill spends, as hunter-level constants — they are NOT spends and
   * never enter the budget ledger.
   */
  basePerkEffects: Record<string, number>;
  /**
   * Keys applied as a FLOOR instead of an addition: the derived value
   * is max(computed, floor). Silas's stagger stance is a floor by the
   * brief's own wording ("innate stagger-chance floor").
   */
  basePerkFloors: Record<string, number>;
}

export const HUNTERS: HunterDef[] = [
  {
    id: 'vesper',
    name: 'Vesper Cole',
    tree: SkillTreeType.Gunslinger,
    basePerkName: 'Weakspot Eye',
    // One point of Steady Hand's crit + half a point of Target
    // Priority's boss lean — a lean, not a build.
    basePerkEffects: { critChance: 0.03, bossDamageMod: 0.05 },
    basePerkFloors: {},
  },
  {
    id: 'silas',
    name: 'Silas Boone',
    tree: SkillTreeType.Demolition,
    basePerkName: "Demolitionist's Stance",
    basePerkEffects: {},
    // Half the Harmonic Shroud stagger gate (0.20) natively — he
    // approaches the roster's stagger gates without renting gear.
    basePerkFloors: { staggerChance: 0.1 },
  },
  {
    id: 'josie',
    name: 'Josie Lode',
    tree: SkillTreeType.Scavenger,
    basePerkName: 'Sixth Sense for Scrap',
    // One point of Bulk Transfer's loot-quantity lean; lootQuantity
    // already applies per extraction find as well as in roaming.
    basePerkEffects: { lootQuantity: 0.1 },
    basePerkFloors: {},
  },
  {
    id: 'doc',
    name: 'Doc Sutter',
    tree: SkillTreeType.Fixer,
    basePerkName: "Master's Hands",
    // One point each of Assembly Rhythm / Calibrated Eye — sprinkle
    // size, per the brief.
    basePerkEffects: { craftSpeedBonus: 0.025, craftQualityBonus: 1 },
    basePerkFloors: {},
  },
];

export const HUNTER_IDS: HunterId[] = HUNTERS.map((h) => h.id);

export const DEFAULT_HUNTER_ID: HunterId = 'vesper';

export function isHunterId(value: unknown): value is HunterId {
  return typeof value === 'string' && (HUNTER_IDS as string[]).includes(value);
}

export function hunterById(id: HunterId): HunterDef {
  return HUNTERS.find((h) => h.id === id) ?? HUNTERS[0];
}

export function hunterForTree(tree: SkillTreeType): HunterDef {
  return HUNTERS.find((h) => h.tree === tree) ?? HUNTERS[0];
}

/** Concise player-facing mechanical summary of a hunter's innate Base Perk. */
export function hunterBasePerkSummary(hunter: HunterDef): string {
  const parts: string[] = [];
  if (hunter.basePerkEffects.critChance) {
    parts.push(`+${Math.round(hunter.basePerkEffects.critChance * 100)}% Crit`);
  }
  if (hunter.basePerkEffects.bossDamageMod) {
    parts.push(`+${Math.round(hunter.basePerkEffects.bossDamageMod * 100)}% Boss DMG`);
  }
  if (hunter.basePerkFloors.staggerChance) {
    parts.push(`${Math.round(hunter.basePerkFloors.staggerChance * 100)}% Min Stagger`);
  }
  if (hunter.basePerkEffects.lootQuantity) {
    parts.push(`+${Math.round(hunter.basePerkEffects.lootQuantity * 100)}% Loot Qty`);
  }
  if (hunter.basePerkEffects.craftSpeedBonus) {
    parts.push(`+${(hunter.basePerkEffects.craftSpeedBonus * 100).toFixed(1).replace(/\.0$/, '')}% Craft Speed`);
  }
  if (hunter.basePerkEffects.craftQualityBonus) {
    parts.push(`+${hunter.basePerkEffects.craftQualityBonus} Craft Quality`);
  }
  return parts.join(' · ');
}

export function treeForHunter(id: HunterId): SkillTreeType {
  return hunterById(id).tree;
}

/**
 * The default active hunter for an existing account: the account's
 * current action_skill_selection names its default hunter (brief
 * §2.2 conversion). An absent/unqualified selection falls back to
 * Vesper Cole (the Gunslinger — the roster's first hunter).
 */
export function defaultHunterForSelection(selection: string | null | undefined): HunterId {
  if (selection) {
    const match = HUNTERS.find((h) => h.tree === selection);
    if (match) return match.id;
  }
  return DEFAULT_HUNTER_ID;
}

export function activeHunterId(
  profile: { active_hunter_id?: string | null; action_skill_selection?: string | null } | null | undefined,
): HunterId {
  if (profile && isHunterId(profile.active_hunter_id)) return profile.active_hunter_id;
  return defaultHunterForSelection(profile?.action_skill_selection);
}

// ─── Spend subsets (per-hunter pools) ────────────────────────────────

const NODE_TREE: Map<string, SkillTreeType> = new Map(SKILL_NODES.map((n) => [n.id, n.tree]));

export function treeOfNode(nodeId: string): SkillTreeType | undefined {
  return NODE_TREE.get(nodeId);
}

/** The subset of a spend map that belongs to one tree — the pool. */
export function spendsForTree(
  spent: Record<string, number>,
  tree: SkillTreeType,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [nodeId, points] of Object.entries(spent ?? {})) {
    if (NODE_TREE.get(nodeId) === tree && typeof points === 'number' && points > 0) {
      out[nodeId] = points;
    }
  }
  return out;
}

export function spendsForHunter(
  spent: Record<string, number>,
  hunterId: HunterId,
): Record<string, number> {
  return spendsForTree(spent, treeForHunter(hunterId));
}

/** Every hunter's pool, keyed by hunter id (conversion view, A1). */
export function splitSpendsByHunter(
  spent: Record<string, number>,
): Record<HunterId, Record<string, number>> {
  const out = {} as Record<HunterId, Record<string, number>>;
  for (const hunter of HUNTERS) out[hunter.id] = spendsForTree(spent, hunter.tree);
  return out;
}

/** Total raw points across every pool (conversion conservation, A1). */
export function totalSpendPoints(spent: Record<string, number>): number {
  return Object.values(spent ?? {}).reduce(
    (sum, v) => sum + (typeof v === 'number' && Number.isFinite(v) ? v : 0),
    0,
  );
}

// ─── Class-mod binding ───────────────────────────────────────────────

/**
 * Class-mod boosts scoped to one hunter: node boosts for nodes
 * outside the hunter's tree are dropped, and a treeBonus for another
 * tree is dropped — a mismatched mod contributes NOTHING to this
 * hunter's derivation (it stays in the shared pool, usable the
 * moment its own hunter is fielded; brief §2.3).
 */
export function classModBoostsForHunter(
  boosts: ClassModBoosts,
  hunterId: HunterId,
): ClassModBoosts {
  const tree = treeForHunter(hunterId);
  const nodeBoosts: Record<string, number> = {};
  for (const [nodeId, boost] of Object.entries(boosts.nodeBoosts ?? {})) {
    if (NODE_TREE.get(nodeId) === tree) nodeBoosts[nodeId] = boost;
  }
  const treeBonus =
    boosts.treeBonus && hunterForTreeName(boosts.treeBonus) === tree ? boosts.treeBonus : undefined;
  return treeBonus ? { treeBonus, nodeBoosts } : { nodeBoosts };
}

function hunterForTreeName(treeName: string): SkillTreeType | undefined {
  return (Object.values(SkillTreeType) as string[]).includes(treeName)
    ? (treeName as SkillTreeType)
    : undefined;
}

export interface ClassModBindingCheck {
  ok: boolean;
  /** The refusal reason, printed on the surface (A5). Null when ok. */
  reason: string | null;
}

/**
 * The binding label (reshape slice (d)): what class-mod listings
 * and the inspect sheet print so the binding speaks before the
 * equip refusal has to — the owning hunter's name + tree, e.g.
 * "Vesper Cole · Gunslinger". Null when the mod carries no tree
 * identity (unbound legacy mods stay unlabeled, as they equip
 * anywhere the check lets them).
 */
export function classModBindingLabel(
  mod: { treeBonus?: string | null } | null | undefined,
): string | null {
  const modTree = mod?.treeBonus ? hunterForTreeName(mod.treeBonus) : undefined;
  if (!modTree) return null;
  const owner = hunterForTree(modTree);
  return `${owner.name} · ${modTree}`;
}

/**
 * The binding rule (brief §2.3): a class mod equips only on the
 * hunter whose tree it boosts. The check reads the mod's own tree
 * identity (its treeBonus names the tree it boosts).
 */
export function checkClassModBinding(
  mod: { treeBonus?: string | null } | null | undefined,
  hunterId: HunterId,
): ClassModBindingCheck {
  if (!mod) return { ok: true, reason: null };
  const hunter = hunterById(hunterId);
  const modTree = mod.treeBonus ? hunterForTreeName(mod.treeBonus) : undefined;
  if (!modTree) return { ok: true, reason: null };
  if (modTree === hunter.tree) return { ok: true, reason: null };
  const owner = hunterForTree(modTree);
  return {
    ok: false,
    reason: `Bound to ${owner.name} (${modTree}) only — field ${owner.name} to equip it; ${hunter.name} cannot use it.`,
  };
}

// ─── The hunter derivation ───────────────────────────────────────────

/**
 * Effective points for the ACTIVE hunter: the hunter's spend subset
 * merged with the hunter-scoped class-mod boosts. Keystone ownership
 * for the signature gate reads this (brief §2.1: keystones stay the
 * signature gate).
 */
export function effectivePointsForHunter(
  spent: Record<string, number>,
  classModBoosts: ClassModBoosts,
  hunterId: HunterId,
): Record<string, number> {
  return effectiveSkillPoints(
    spendsForHunter(spent, hunterId),
    classModBoostsForHunter(classModBoosts, hunterId),
  );
}

/**
 * THE hunter-aware skill derivation (brief §4 slice (a)): bonuses
 * from the active hunter's spend subset + hunter-scoped class-mod
 * boosts + the hunter's base-perk constants. Composite keys are
 * recomputed after the base perk lands so consumers reading the
 * composites (dps / shieldBreak / armorBreak / heavyDamageBonus)
 * price the perk identically to node effects.
 */
export function computeHunterSkillBonuses(
  spent: Record<string, number>,
  classModBoosts: ClassModBoosts = { nodeBoosts: {} },
  hunterId: HunterId,
): SkillBonuses {
  const hunter = hunterById(hunterId);
  const bonuses = computeSkillBonuses(
    spendsForHunter(spent, hunterId),
    classModBoostsForHunter(classModBoosts, hunterId),
  );
  for (const [key, value] of Object.entries(hunter.basePerkEffects)) {
    bonuses[key] = (bonuses[key] || 0) + value;
  }
  for (const [key, floor] of Object.entries(hunter.basePerkFloors)) {
    bonuses[key] = Math.max(bonuses[key] || 0, floor);
  }
  // Recompute the composites over the perk-inclusive values (the same
  // formulas computeSkillBonuses uses — one owner of the shapes).
  bonuses.dps =
    (bonuses.weaponDamage || 0) +
    (bonuses.critChance || 0) * 0.5 +
    (bonuses.critDamage || 0) * 0.5 +
    (bonuses.attackSpeed || 0) * 0.3;
  bonuses.survival = (bonuses.shieldCapacity || 0) * 0.3 + (bonuses.staggerChance || 0) * 0.2;
  bonuses.shieldBreak = (bonuses.shieldDamageMod || 0) + (bonuses.ordnanceShieldBreak || 0);
  bonuses.armorBreak = (bonuses.armorDamageMod || 0) + (bonuses.explosiveArmorBreak || 0);
  bonuses.heavyDamageBonus = (bonuses.ordnanceDamage || 0) * 0.4 + (bonuses.explosiveDamage || 0) * 0.6;
  return bonuses;
}

/**
 * The active hunter's signature tree when the hunter owns their
 * keystone at effective points >= 1 — the collapsed selection
 * (brief §2.5): the selection IS the active hunter's signature,
 * keystone-qualified exactly as actionSkills.ts implements it.
 */
export function activeHunterSignature(
  spent: Record<string, number>,
  classModBoosts: ClassModBoosts,
  hunterId: HunterId,
): SkillTreeType | null {
  const tree = treeForHunter(hunterId);
  const keystone = SKILL_NODES.find((n) => n.tree === tree && n.type === 'keystone');
  if (!keystone) return null;
  const effective = effectivePointsForHunter(spent, classModBoosts, hunterId);
  return (effective[keystone.id] ?? 0) >= 1 ? tree : null;
}

// ─── Per-hunter loadout assignments ──────────────────────────────────

/** Gear slots a hunter's loadout assignment names (vehicle separate:
 *  vehicles equip through the Garage and never appear in inventories). */
export type HunterGearSlot =
  | 'primary'
  | 'secondary'
  | 'heavy'
  | 'ordnance'
  | 'shield'
  | 'classMod'
  | 'relic';

export const HUNTER_GEAR_SLOTS: HunterGearSlot[] = [
  'primary',
  'secondary',
  'heavy',
  'ordnance',
  'shield',
  'classMod',
  'relic',
];

export interface HunterLoadout {
  primary: string | null;
  secondary: string | null;
  heavy: string | null;
  ordnance: string | null;
  shield: string | null;
  classMod: string | null;
  relic: string | null;
  /** The equipped-vehicle CHOICE for this hunter (fleet is shared). */
  vehicle: string | null;
  /** Belt picks over the shared consumable stockpile. */
  belt: { PreFight: string | null; MidFight: string | null; Emergency: string | null };
}

export function emptyHunterLoadout(): HunterLoadout {
  return {
    primary: null,
    secondary: null,
    heavy: null,
    ordnance: null,
    shield: null,
    classMod: null,
    relic: null,
    vehicle: null,
    belt: { PreFight: null, MidFight: null, Emergency: null },
  };
}

export type HunterLoadouts = Partial<Record<HunterId, HunterLoadout>>;

/** Read one hunter's assignment from the stored map (tolerant parse:
 *  unknown hunters/slots are ignored, missing fields read as null). */
export function loadoutForHunter(
  loadouts: HunterLoadouts | null | undefined,
  hunterId: HunterId,
): HunterLoadout {
  const out = emptyHunterLoadout();
  const raw = loadouts?.[hunterId];
  if (!raw || typeof raw !== 'object') return out;
  for (const slot of [...HUNTER_GEAR_SLOTS, 'vehicle'] as const) {
    const value = (raw as unknown as Record<string, unknown>)[slot];
    out[slot] = typeof value === 'string' && value.length > 0 ? value : null;
  }
  const belt = (raw as { belt?: Record<string, unknown> }).belt;
  if (belt && typeof belt === 'object') {
    for (const key of ['PreFight', 'MidFight', 'Emergency'] as const) {
      const value = belt[key];
      out.belt[key] = typeof value === 'string' && value.length > 0 ? value : null;
    }
  }
  return out;
}

/** Every item id assigned to ANY hunter's loadout (Dispatch spare
 *  test, brief §4: spare means spare across ALL hunters' loadouts). */
export function itemsAssignedToAnyHunter(loadouts: HunterLoadouts | null | undefined): Set<string> {
  const assigned = new Set<string>();
  if (!loadouts || typeof loadouts !== 'object') return assigned;
  for (const hunterId of HUNTER_IDS) {
    const loadout = loadoutForHunter(loadouts, hunterId);
    for (const slot of [...HUNTER_GEAR_SLOTS, 'vehicle'] as const) {
      const id = loadout[slot];
      if (id) assigned.add(id);
    }
  }
  return assigned;
}

/**
 * The Dispatch spare test: an item is spare only when it is not
 * equipped, not in service, and not assigned to any hunter's loadout.
 * An in_service item is escrowed — it can never be re-committed
 * through another hunter's assignment either (the cross-hunter
 * conflict refusal reads this same predicate).
 */
export function isSpareForDispatch(
  item: { id: string; runtime_state?: string | null; equipped_slot?: string | null },
  loadouts: HunterLoadouts | null | undefined,
): boolean {
  if (item.runtime_state === 'in_service') return false;
  if (item.equipped_slot) return false;
  if (item.runtime_state && item.runtime_state !== 'available') return false;
  return !itemsAssignedToAnyHunter(loadouts).has(item.id);
}
