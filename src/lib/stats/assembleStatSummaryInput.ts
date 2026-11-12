/**
 * assembleStatSummaryInput — the ONE assembly of the character stat
 * summary / mechanics snapshot input from store-shaped state.
 *
 * Extracted (equip-comparison slice, 2026-11-04) because the assembly
 * existed in two hand-rolled copies (useCharacterStatSummary and
 * BossPickerList) and BOTH passed raw spent points as `spentSkills` —
 * so every client summary understated every skill-driven number
 * while a class mod was equipped. The engines never had the gap:
 * the Chef derives its skill record through computeSkillBonuses
 * over EFFECTIVE points (spends + the equipped mod's boosts, via
 * skillBonusesFromRecords), and the SQL twin is
 * cc_skill_effective_points. This helper folds
 * `effectiveSkillPoints(spent, classModBoosts)` once, here, so the
 * client summary, the boss picker projection, and the equip
 * comparison all price the build the Chef actually pays.
 *
 * An optional single-slot override prices a HYPOTHETICAL loadout:
 * the same state with one slot's item swapped (or cleared with
 * `item: null`). A classMod override re-derives the boosts from the
 * candidate mod (classModBoostsOf) — never the worn mod's boosts —
 * so a class-mod swap shows the skill change it actually makes.
 * Pure: no store reads, no mutation, no I/O.
 */
import type { PlayerProfile } from '@/types/player';
import type { BossDef } from '@/types/boss';
import type { ClassMod, GearItem, Ordnance, Relic, Shield, Weapon } from '@/types/items';
import type { ActiveBuff } from '@/lib/buffs/activeBuffs';
import {
  classModBoostsOf,
  computeSkillBonuses,
  effectiveSkillPoints,
  type ClassModBoosts,
} from '@/lib/skills/skillBonuses';
import { simulateBoss } from '@/lib/simulation/bossSimulator';
import { RiskSetting } from '@/types/game';
import type { CharacterStatSummaryInput } from '@/lib/stats/characterStats';

/** Gear slots a summary loadout carries (the vehicle slot never prices here). */
export type StatSummarySlot =
  | 'primary'
  | 'secondary'
  | 'heavy'
  | 'shield'
  | 'classMod'
  | 'relic'
  | 'ordnance';

export interface StatSummaryAssemblyState {
  player: PlayerProfile;
  /**
   * Equipped weapons in slot order (primary, secondary, heavy).
   * May contain holes (undefined) for empty slots — the builders
   * filter them exactly as they filtered the compacted array the
   * hook used to pass, and holes keep slot overrides slot-exact.
   */
  weapons: Array<Weapon | undefined>;
  shield?: Shield;
  classMod?: ClassMod;
  relic?: Relic;
  ordnance?: Ordnance;
  /** Raw spent skill points (the skill slice's `spent`). */
  spent: Record<string, number>;
  /** Boosts of the currently equipped class mod (the skill slice's `classModBoosts`). */
  classModBoosts: ClassModBoosts;
  activeBuffs?: ActiveBuff[];
  consumableMods?: Record<string, number>;
  consumableInventory?: Record<string, number>;
  medKitBuffer?: number;
  boss?: BossDef;
}

export interface StatSummaryOverride {
  slot: StatSummarySlot;
  /** The candidate item for the slot, or null to price the slot empty. */
  item: GearItem | null;
}

const WEAPON_SLOT_INDEX: Partial<Record<StatSummarySlot, number>> = {
  primary: 0,
  secondary: 1,
  heavy: 2,
};

export function assembleStatSummaryInput(
  state: StatSummaryAssemblyState,
  override?: StatSummaryOverride,
): CharacterStatSummaryInput {
  const weapons: Array<Weapon | undefined> = [...state.weapons];
  let shield = state.shield;
  let classMod = state.classMod;
  let relic = state.relic;
  let ordnance = state.ordnance;
  let boosts = state.classModBoosts;

  if (override) {
    const weaponIndex = WEAPON_SLOT_INDEX[override.slot];
    if (weaponIndex !== undefined) {
      while (weapons.length <= weaponIndex) weapons.push(undefined);
      weapons[weaponIndex] = (override.item as Weapon | null) ?? undefined;
    } else if (override.slot === 'shield') {
      shield = (override.item as Shield | null) ?? undefined;
    } else if (override.slot === 'classMod') {
      classMod = (override.item as ClassMod | null) ?? undefined;
      // The candidate mod's boosts — not the worn mod's — price the
      // hypothetical. This is the fold the raw assembly could never
      // express, and the reason class-mod swaps showed no skill
      // change at all before this helper existed.
      boosts = classModBoostsOf(classMod);
    } else if (override.slot === 'relic') {
      relic = (override.item as Relic | null) ?? undefined;
    } else if (override.slot === 'ordnance') {
      ordnance = (override.item as Ordnance | null) ?? undefined;
    }
  }

  const spentSkills = effectiveSkillPoints(state.spent, boosts);

  // Audit HTR-05: when a boss is in context, the snapshot's boss
  // metrics carry the boss SIM's own numbers through the bossSimDps /
  // bossSimShieldBreak overrides — never the snapshot's display-layer
  // approximation (which weights attackSpeed at ×1.0 where the sim's
  // composite uses ×0.3, and sums shield break over all weapons where
  // the sim weights the secondary at 0.3 with element matchups). The
  // sim runs on the post-override loadout, so an equip comparison
  // prices the candidate build. Balanced risk is the display
  // precedent (mechanicsBalanceReport). With no boss in context there
  // is no sim to run — the standing Totals keep the approximation,
  // unchanged from before this fix.
  let bossSimDps: number | undefined;
  let bossSimShieldBreak: number | undefined;
  if (state.boss) {
    const sim = simulateBoss({
      primary: weapons[0] ?? null,
      secondary: weapons[1] ?? null,
      heavy: weapons[2] ?? null,
      ordnance: ordnance ?? null,
      shield: shield ?? null,
      classMod: classMod ?? null,
      relic: relic ?? null,
      consumables: state.consumableInventory ?? {},
      risk: RiskSetting.Balanced,
      boss: state.boss,
      playerLevel: state.player.level,
      // computeSkillBonuses folds effective points itself (raw
      // spends + boosts) — the same derivation the Chef's
      // skillBonusesFromRecords performs for the settling sim.
      skillBonuses: computeSkillBonuses(state.spent, boosts),
    });
    bossSimDps = sim.effectiveDPS;
    bossSimShieldBreak = sim.shieldBreakValue;
  }

  return {
    player: state.player,
    weapons,
    shield,
    classMod,
    relic,
    ordnance,
    spentSkills,
    boss: state.boss,
    bossSimDps,
    bossSimShieldBreak,
    activeBuffs: state.activeBuffs,
    consumableMods: state.consumableMods,
    consumableInventory: state.consumableInventory,
    medKitBuffer: state.medKitBuffer,
  };
}
