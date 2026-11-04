/**
 * Salvage yield — the display shape for what a recycle pays, in its
 * two honest forms:
 *
 *   - SETTLED: `salvageYieldFromRecycleResult` maps the LIVE verified
 *     recycle result (cc_recycle_item via verifiedOps.recycleItem)
 *     into display fields. It names exactly what was paid.
 *
 *   - PROJECTED: `projectSalvageYield` quotes, BEFORE the fact, what
 *     cc_recycle_item will settle for the same item in the same
 *     player's hands. It is a pure composition of the server's own
 *     shared pieces — salvageScrap (the cc_salvage_scrap twin),
 *     applySalvageSkillBonuses (the composition both server twins
 *     run), legendaryCoreYieldFor (the cores formula) — fed the
 *     player's own bonuses from the one computeSkillBonuses
 *     derivation, so a previewed salvage equals the settled salvage
 *     to the unit. The only non-deterministic term in the real award
 *     is the King of Scrap bonus-material ROLL; the projection
 *     therefore never promises the material — it carries the kind
 *     and the chance as a note (bonusMaterialId / bonusMaterialChance)
 *     and leaves the fixed material fields at zero.
 *
 * What the server actually pays (migration 0053, the latest
 * restatement): Scrap on every recycle; legendary cores when a
 * Legendary is salvaged; and ONE bonus material — only for Common
 * items, only with King of Scrap keystone points, on a
 * 0.25 × points chance. It does NOT pay the broad material/essence
 * yield of the retired local salvage formula (that formula belonged
 * to the retired local scrapItem path, which UI salvage must not
 * use — AGENTS.md — and its file is deleted; previews quote this
 * module instead).
 */
import {
  SALVAGE_FALLBACK_MATERIAL,
  SALVAGE_MATERIAL_BY_KIND,
  applySalvageSkillBonuses,
  salvageScrap,
} from '@/lib/skills/salvageBonuses';
import { legendaryCoreYieldFor } from '@/content/collections';
import type { GearItem, Weapon } from '@/types/items';

export interface SalvageYield {
  scrapValue: number;
  scrapAlloy: number;
  ballisticParts: number;
  reactiveComponents: number;
  techFragments: number;
  voidDust: number;
  essences: Record<string, number>;
  /**
   * Legendary cores the server paid on this recycle (Legendary
   * salvage only). Set from the verified result by
   * salvageYieldFromRecycleResult, and quoted exactly by
   * projectSalvageYield (the cores formula is deterministic).
   */
  legendaryCores?: number;
  /**
   * Preview only: the crafting material a King of Scrap Common
   * salvage CAN yield (+1 of it). Set by projectSalvageYield when
   * the keystone chance is live; the settled mapper never sets it
   * (a settled bonus material appears in its fixed field instead).
   */
  bonusMaterialId?: string;
  /** Preview only: the chance (0–1) of the bonus material above. */
  bonusMaterialChance?: number;
}

/** Bonus-material id → the fixed yield field that prints it. */
const BONUS_FIELD: Record<string, 'scrapAlloy' | 'ballisticParts' | 'reactiveComponents' | 'techFragments'> = {
  Scrap: 'scrapAlloy',
  BallisticParts: 'ballisticParts',
  ReactiveComponents: 'reactiveComponents',
  TechFragments: 'techFragments',
};

export function salvageYieldFromRecycleResult(result: Record<string, unknown>): SalvageYield {
  const bonusMaterial = typeof result.bonus_material === 'string' ? result.bonus_material : null;
  const field = bonusMaterial ? BONUS_FIELD[bonusMaterial] : undefined;
  const y: SalvageYield = {
    scrapValue: Number(result.scrap_award ?? 0) || 0,
    scrapAlloy: 0,
    ballisticParts: 0,
    reactiveComponents: 0,
    techFragments: 0,
    voidDust: 0,
    essences: {},
    legendaryCores: Number(result.cores_award ?? 0) || 0,
  };
  if (field) y[field] = 1;
  return y;
}

/**
 * The server item-kind string for a client gear item — the key the
 * King of Scrap material map (SALVAGE_MATERIAL_BY_KIND) is keyed by,
 * matching item_instances.kind for the five salvageable gear kinds.
 */
export function salvageKindOf(item: GearItem): string {
  if ('weaponType' in item) return 'weapon';
  if ('treeBonus' in item) return 'classMod';
  if ('hp' in item) return 'shield';
  if ('damage' in item && 'effect' in item) return 'ordnance';
  return 'relic';
}

/**
 * projectSalvageYield — what cc_recycle_item will pay for `item`
 * when salvaged by a player whose skill bonuses are `bonuses` (the
 * computeSkillBonuses record — the same derivation the server twins
 * feed applySalvageSkillBonuses from the player's own records).
 *
 * Composition order mirrors cc_recycle_item (0053) and both
 * in-memory twins exactly: base award → Market Crash ×4 → skill
 * multipliers composed by applySalvageSkillBonuses with the twins'
 * own no-grant roll sentinel (materialRoll 1 — the scrap award never
 * depends on the roll) → cores from legendaryCoreYieldFor, unscaled.
 */
export function projectSalvageYield(item: GearItem, bonuses: Record<string, number>): SalvageYield {
  const kind = salvageKindOf(item);
  const base = salvageScrap(item.rarity, item.level ?? 1);
  // Legendary Honesty (0008): Market Crash — this weapon's scrap
  // value is 4x normal when recycled, applied before skill bonuses.
  const crashed = (item as Weapon).legendaryEffectId === 'market_crash' ? base * 4 : base;
  const { award } = applySalvageSkillBonuses({
    baseAward: crashed,
    rarity: item.rarity,
    kind,
    bonuses,
    materialRoll: 1,
  });
  const y: SalvageYield = {
    scrapValue: award,
    scrapAlloy: 0,
    ballisticParts: 0,
    reactiveComponents: 0,
    techFragments: 0,
    voidDust: 0,
    essences: {},
    legendaryCores: legendaryCoreYieldFor(item),
  };
  // King of Scrap: a salvaged Common CAN yield +1 bonus material.
  // The roll is the server's alone, so the projection quotes the
  // kind and the chance — never the material itself.
  const chance = bonuses.commonMaterialChance || 0;
  if (item.rarity === 'Common' && chance > 0) {
    y.bonusMaterialId = SALVAGE_MATERIAL_BY_KIND[kind] ?? SALVAGE_FALLBACK_MATERIAL;
    y.bonusMaterialChance = chance;
  }
  return y;
}
