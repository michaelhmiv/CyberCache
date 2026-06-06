import { SkillTreeType } from './game';

export interface SkillNode {
  id: string;
  tree: SkillTreeType;
  tier: number; // visual row
  index: number; // visual column
  name: string;
  description: string;
  type: 'small' | 'major' | 'keystone';
  maxPoints: number;
  cost: number;
  effects: Record<string, number>;
  requires?: string[]; // prerequisite node IDs
}

export interface SkillTree {
  type: SkillTreeType;
  nodes: SkillNode[];
}
