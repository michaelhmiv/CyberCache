/**
 * Skill Tree Visual Registry — sigils and visual identity for skill trees.
 *
 * Used by SkillTreeScreen tab headers and DashboardScreen skill summary.
 */
import { SkillTreeType } from '@/types/game';

export interface SkillTreeVisual {
  id: SkillTreeType;
  sigil: string;
  color: string;
  accentColor: string;
  label: string;
  description: string;
}

export const SKILL_TREE_VISUALS: Record<SkillTreeType, SkillTreeVisual> = {
  [SkillTreeType.Gunslinger]: {
    id: SkillTreeType.Gunslinger,
    sigil: '⊙',
    color: '#FF4B5C',
    accentColor: '#FFEA3A',
    label: 'Gunslinger',
    description: 'Weapon damage, crits, and attack speed.',
  },
  [SkillTreeType.Demolition]: {
    id: SkillTreeType.Demolition,
    sigil: '◈',
    color: '#FF9000',
    accentColor: '#FFEA3A',
    label: 'Demolition',
    description: 'Explosives, armor break, and stagger.',
  },
  [SkillTreeType.Scavenger]: {
    id: SkillTreeType.Scavenger,
    sigil: '♻',
    color: '#7CFC00',
    accentColor: '#B2FF59',
    label: 'Scavenger',
    description: 'Idle, loot, and economy boosts.',
  },
  [SkillTreeType.Fixer]: {
    id: SkillTreeType.Fixer,
    sigil: '⚒',
    color: '#2EC4B6',
    accentColor: '#FFD166',
    label: 'Fixer',
    description: 'Crafting, repair, vehicles, and trade.',
  },
};

export function getSkillTreeVisual(tree: SkillTreeType): SkillTreeVisual {
  return SKILL_TREE_VISUALS[tree] ?? {
    id: tree,
    sigil: '?',
    color: '#B8B0A8',
    accentColor: '#34303A',
    label: String(tree),
    description: 'Unknown skill tree.',
  };
}
