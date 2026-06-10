import { Rarity } from '@/types/game';

export interface ClassModSilhouette {
  id: string;
  label: string;
  /** Chip/module body */
  body: string;
  /** Central processor core */
  core: string;
  /** Edge contacts / connector pins */
  contacts?: string;
}

export interface ClassModVisualSpec {
  id: string;
  seed: number;
  rarity: Rarity | string;
  treeBonus: string;
  silhouette: ClassModSilhouette;
  rarityFrame: typeof import('@/constants/weaponVisuals').RARITY_FRAME_STYLES[Rarity.Common];
  decals: import('@/lib/weaponArt/buildWeaponVisualSpec').WeaponVisualDecal[];
  texture: string;
  nodeCount: number;
}

/** 3 class mod module shapes, one per skill tree archetype */
export const CLASS_MOD_SILHOUETTES: Record<string, ClassModSilhouette> = {
  chip: {
    id: 'chip',
    label: 'Skill Chip',
    body: 'M80 26 L160 26 L180 56 L160 94 L80 94 L60 56 Z',
    core: 'M100 42 L140 42 L152 60 L140 80 L100 80 L88 60 Z',
    contacts: 'M70 90 L170 90',
  },
  drive: {
    id: 'drive',
    label: 'Tactical Drive',
    body: 'M70 34 L170 34 L170 86 L70 86 Z',
    core: 'M90 44 L150 44 L150 76 L90 76 Z',
    contacts: 'M70 50 L70 70 M170 50 L170 70',
  },
  core: {
    id: 'core',
    label: 'Combat Core',
    body: 'M120 14 L180 56 L160 106 L80 106 L60 56 Z',
    core: 'M120 38 L152 60 L140 88 L100 88 L88 60 Z',
    contacts: 'M72 100 L168 100',
  },
};

export const DEFAULT_CLASSMOD_SILHOUETTE = CLASS_MOD_SILHOUETTES.chip;

/**
 * Pick a class mod silhouette based on tree bonus string.
 */
export function pickClassModSilhouette(treeBonus: string): ClassModSilhouette {
  const lower = treeBonus.toLowerCase();
  if (lower.includes('gun') || lower.includes('slinger')) return CLASS_MOD_SILHOUETTES.core;
  if (lower.includes('demo') || lower.includes('blast')) return CLASS_MOD_SILHOUETTES.drive;
  if (lower.includes('scav') || lower.includes('surv')) return CLASS_MOD_SILHOUETTES.chip;
  return DEFAULT_CLASSMOD_SILHOUETTE;
}
