/**
 * The Next Unlock derivation for the icon skill tree (owner-approved
 * 2026-11-18): the nearest major/keystone (tier, then board index)
 * the player has not bought whose prerequisites are all met — with
 * how many points they are short. When no milestone's prerequisites
 * are met, it falls back to the tree's keystone with its unmet
 * prerequisites named as blockers. Derived from the same spent map
 * + node defs the board renders; no new data.
 *
 * Pure logic (no components) so the board file can stay
 * component-only for fast refresh.
 */
import { SKILL_NODES } from '@/constants/skillTrees';
import type { SkillNode } from '@/types/skill';

export interface NextUnlock {
  node: SkillNode;
  /** Points the player lacks for it (0 = buyable now). */
  short: number;
  /** Unmet prerequisite names, when the keystone fallback fired. */
  blockers?: string[];
}

export function nextUnlock(nodes: SkillNode[], spent: Record<string, number>, pointsAvailable: number): NextUnlock | null {
  const met = (n: SkillNode) => !n.requires || n.requires.every((r) => (spent[r] || 0) > 0);
  const owned = (n: SkillNode) => (spent[n.id] || 0) >= n.maxPoints;
  const ready = nodes
    .filter((n) => (n.type === 'major' || n.type === 'keystone') && !owned(n) && met(n))
    .sort((a, b) => a.tier - b.tier || a.index - b.index);
  if (ready.length > 0) {
    const node = ready[0];
    return { node, short: Math.max(0, node.cost - pointsAvailable) };
  }
  const ks = nodes.find((n) => n.type === 'keystone');
  if (ks && !owned(ks)) {
    const blockers = (ks.requires ?? [])
      .filter((r) => (spent[r] || 0) === 0)
      .map((r) => SKILL_NODES.find((n) => n.id === r)?.name ?? r);
    return { node: ks, short: Math.max(0, ks.cost - pointsAvailable), blockers };
  }
  return null;
}
