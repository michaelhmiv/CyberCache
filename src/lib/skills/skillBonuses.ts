/**
 * skillBonuses — the ONE computation of skill-tree bonuses from spent
 * points + class mod boosts.
 *
 * Extracted verbatim from skillSlice.getBonuses() so the client store
 * and the server (offline settlement, which must rebuild the exact
 * bonuses a foreground claim would have used from the player's
 * server-side records — profiles.skill_spends + the equipped class mod
 * in item_instances) share a single implementation. Pure: no store,
 * no I/O.
 */
import { SKILL_NODES } from '../../constants/skillTrees';
import { SkillTreeType } from '../../types/game';

export interface ClassModBoosts {
  treeBonus?: string;
  nodeBoosts: Record<string, number>;
}

/** Map tree name to SkillTreeType for treeBonus resolution. */
const TREE_NAME_MAP: Record<string, SkillTreeType> = {
  Gunslinger: SkillTreeType.Gunslinger,
  Demolition: SkillTreeType.Demolition,
  Scavenger: SkillTreeType.Scavenger,
};

/**
 * Compute the flat skill-bonus record for a set of spent points.
 *
 * Class mod boosts merge Borderlands-style: nodeBoosts add directly
 * (can exceed maxPoints); treeBonus grants +1 to every node in the
 * named tree, capped at each node's maxPoints.
 */
export function computeSkillBonuses(
  spent: Record<string, number>,
  classModBoosts: ClassModBoosts = { nodeBoosts: {} },
): Record<string, number> {
  const bonuses: Record<string, number> = {};

  // Merge spent points with class mod boosts to get effective points per node.
  const effective: Record<string, number> = { ...spent };

  // nodeBoosts: add directly (Borderlands-style: can exceed maxPoints).
  for (const [nodeId, boost] of Object.entries(classModBoosts.nodeBoosts ?? {})) {
    effective[nodeId] = (effective[nodeId] || 0) + boost;
  }

  // treeBonus: +1 to every node in the tree, capped at maxPoints.
  if (classModBoosts.treeBonus) {
    const treeType = TREE_NAME_MAP[classModBoosts.treeBonus];
    if (treeType) {
      const treeNodes = SKILL_NODES.filter((n) => n.tree === treeType);
      for (const node of treeNodes) {
        const current = effective[node.id] || 0;
        effective[node.id] = Math.min(node.maxPoints, current + 1);
      }
    }
  }

  for (const [nodeId, points] of Object.entries(effective)) {
    const node = SKILL_NODES.find((n) => n.id === nodeId);
    if (!node || points <= 0) continue;
    for (const [effectKey, effectValue] of Object.entries(node.effects)) {
      bonuses[effectKey] = (bonuses[effectKey] || 0) + effectValue * points;
    }
  }
  // Composite keys for consumers.
  bonuses.dps = (bonuses.weaponDamage || 0) + (bonuses.critChance || 0) * 0.5 + (bonuses.critDamage || 0) * 0.5 + (bonuses.attackSpeed || 0) * 0.3;
  bonuses.survival = (bonuses.shieldCapacity || 0) * 0.3 + (bonuses.staggerChance || 0) * 0.2;
  bonuses.shieldBreak = (bonuses.shieldDamageMod || 0) + (bonuses.ordnanceShieldBreak || 0);
  bonuses.armorBreak = (bonuses.armorDamageMod || 0) + (bonuses.explosiveArmorBreak || 0);
  bonuses.staggerChance = bonuses.staggerChance || 0;
  // Wire ordnance + explosive damage into heavy attack bonus.
  bonuses.heavyDamageBonus = (bonuses.ordnanceDamage || 0) * 0.4 + (bonuses.explosiveDamage || 0) * 0.6;
  return bonuses;
}
