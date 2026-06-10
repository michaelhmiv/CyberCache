import { Rarity } from '@/types/game';

/**
 * Class Mod silhouettes modeled as physical tech chips with discrete
 * electronic / mechanical components.
 *
 * Every class mod has:
 *   board      — main PCB / substrate (like weapon body)
 *   processor  — central die / chip (like weapon chamber)
 *   contacts   — edge connector pins (like weapon grip)
 *   heatsink   — top cooling plate (like weapon sight)
 *   traces     — circuit trace lines (like weapon barrel)
 *   bracket    — mounting frame / clip (like weapon stock)
 *   capacitors — side power components (like magazine)
 */
export interface ClassModSilhouette {
  id: string;
  label: string;
  board: string;
  processor: string;
  contacts: string;
  heatsink: string;
  traces?: string;
  bracket: string;
  capacitors: string;
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

export const CLASS_MOD_SILHOUETTES: Record<string, ClassModSilhouette> = {
  /** ===== SKILL CHIP — scavenger / survival tree ===== */
  chip: {
    id: 'chip',
    label: 'Skill Chip',
    board: 'M72 22 L168 22 L188 54 L168 98 L72 98 L52 54 Z',
    processor: 'M96 38 L144 38 L158 56 L144 82 L96 82 L82 56 Z',
    contacts: 'M56 44 L70 42 L66 80 L52 82 Z M56 50 L70 48 L66 76 L52 78 Z M174 44 L158 42 L162 80 L176 82 Z M174 50 L158 48 L162 76 L176 78 Z',
    heatsink: 'M84 18 L156 18 L152 26 L88 26 Z M92 12 L148 12 L146 18 L94 18 Z',
    bracket: 'M80 94 L160 94 L156 104 L84 104 Z',
    traces: 'M96 48 L140 48 M96 56 L140 56 M96 64 L140 64 M96 72 L140 72',
    capacitors: 'M62 62 L54 62 L54 74 L62 74 Z M178 62 L186 62 L186 74 L178 74 Z',
  },

  /** ===== TACTICAL DRIVE — demolition / blast tree ===== */
  drive: {
    id: 'drive',
    label: 'Tactical Drive',
    board: 'M62 30 L178 30 L178 90 L62 90 Z',
    processor: 'M84 42 L156 42 L156 78 L84 78 Z',
    contacts: 'M62 46 L62 54 M62 66 L62 74 M178 46 L178 54 M178 66 L178 74',
    heatsink: 'M76 24 L164 24 L160 32 L80 32 Z M84 18 L156 18 L154 24 L86 24 Z',
    bracket: 'M70 88 L170 88 L166 96 L74 96 Z',
    traces: 'M84 52 L148 52 M84 60 L148 60 M84 68 L148 68',
    capacitors: 'M54 58 L62 54 L58 70 L50 74 Z M186 58 L178 54 L182 70 L190 74 Z',
  },

  /** ===== COMBAT CORE — gunslinger tree ===== */
  core: {
    id: 'core',
    label: 'Combat Core',
    board: 'M120 10 L186 48 L164 112 L76 112 L54 48 Z',
    processor: 'M120 32 L158 52 L146 88 L94 88 L82 52 Z',
    contacts: 'M60 56 L68 56 M56 70 L64 70 M180 56 L172 56 M176 70 L168 70',
    heatsink: 'M96 14 L144 14 L142 22 L98 22 Z M104 8 L136 8 L134 14 L106 14 Z',
    bracket: 'M82 108 L158 108 L154 116 L86 116 Z',
    traces: 'M120 42 L120 78 M100 52 L140 52 M100 72 L140 72',
    capacitors: 'M60 88 L52 88 L52 100 L60 100 Z M180 88 L188 88 L188 100 L180 100 Z',
  },
};

export const DEFAULT_CLASSMOD_SILHOUETTE = CLASS_MOD_SILHOUETTES.chip;

export function pickClassModSilhouette(treeBonus: string): ClassModSilhouette {
  const lower = treeBonus.toLowerCase();
  if (lower.includes('gun') || lower.includes('slinger')) return CLASS_MOD_SILHOUETTES.core;
  if (lower.includes('demo') || lower.includes('blast')) return CLASS_MOD_SILHOUETTES.drive;
  if (lower.includes('scav') || lower.includes('surv')) return CLASS_MOD_SILHOUETTES.chip;
  return DEFAULT_CLASSMOD_SILHOUETTE;
}
