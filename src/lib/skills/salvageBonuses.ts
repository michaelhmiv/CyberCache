/**
 * salvageBonuses — the Scavenger salvage wiring (Phase 2d).
 *
 * Three skill effects live on the salvage path and nowhere else:
 *   - Hoarder's Instinct (scav_major_1): `salvageBonus` — every
 *     salvage pays bonus scrap.
 *   - King of Scrap (scav_keystone): `lowRarityScrapBonus` — Common
 *     and Uncommon gear salvages for more; `commonMaterialChance` —
 *     salvaging a Common can yield a bonus crafting material.
 *
 * The authoritative salvage engine is cc_recycle_item (Postgres);
 * migration 0022 mirrors this module's math inside that function,
 * deriving the bonuses from the player's own skill_spends + equipped
 * class mod exactly as 0017 does for the market fee. The in-memory
 * store twins call this module directly with bonuses from
 * computeSkillBonuses — one derivation (skillBonuses.ts), one set of
 * salvage rules (here), two runtimes kept in parity by tests.
 */

/** Bonus crafting material by salvaged item kind — the same
 *  type→material convention as calculateSalvageYield in
 *  src/constants/salvageRules.ts (weapons yield BallisticParts,
 *  shields/ordnance ReactiveComponents, class mods/relics
 *  TechFragments). Kinds outside the map yield the generic material. */
export const SALVAGE_MATERIAL_BY_KIND: Record<string, string> = {
  weapon: 'BallisticParts',
  shield: 'ReactiveComponents',
  ordnance: 'ReactiveComponents',
  classMod: 'TechFragments',
  relic: 'TechFragments',
};

export const SALVAGE_FALLBACK_MATERIAL = 'ScrapAlloy';

/** Rarities the King of Scrap treats as "low-rarity". */
export function isLowRarity(rarity: string): boolean {
  return rarity === 'Common' || rarity === 'Uncommon';
}

export interface SalvageSkillAward {
  /** Final scrap award: base (post-legendary) × skill multipliers, rounded. */
  award: number;
  /** Bonus crafting material granted by King of Scrap, if the roll hit. */
  bonusMaterial: string | null;
}

/**
 * Apply the salvage skill bonuses to a base scrap award.
 *
 * `baseAward` is the standard salvage value AFTER item-side
 * multipliers (e.g. Market Crash's 4×) — skill multipliers stack on
 * top, rounded once at the end (cc_salvage_scrap's own rounding
 * convention). `materialRoll` is a uniform draw in [0, 1) consumed
 * only when a Common is salvaged with the keystone owned; callers
 * pass their runtime's RNG (SQL uses random()).
 */
export function applySalvageSkillBonuses(input: {
  baseAward: number;
  rarity: string;
  kind?: string | null;
  bonuses: Record<string, number>;
  materialRoll: number;
}): SalvageSkillAward {
  const { baseAward, rarity, kind, bonuses, materialRoll } = input;

  let multiplier = 1 + (bonuses.salvageBonus || 0);
  if (isLowRarity(rarity)) {
    multiplier *= 1 + (bonuses.lowRarityScrapBonus || 0);
  }
  const award = Math.round(baseAward * multiplier);

  let bonusMaterial: string | null = null;
  const materialChance = bonuses.commonMaterialChance || 0;
  if (rarity === 'Common' && materialChance > 0 && materialRoll < materialChance) {
    bonusMaterial = SALVAGE_MATERIAL_BY_KIND[kind ?? ''] ?? SALVAGE_FALLBACK_MATERIAL;
  }

  return { award, bonusMaterial };
}
