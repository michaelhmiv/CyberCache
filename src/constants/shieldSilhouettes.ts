import { Element, Rarity } from '@/types/game';

export interface ShieldSilhouette {
  id: string;
  label: string;
  /** Outer shield plate body */
  body: string;
  /** Inner energy core or capacitor ring */
  core: string;
  /** Rim / edge reinforcement */
  rim: string;
  /** Panel lines for surface detail */
  panelLines?: string;
}

export interface ShieldVisualSpec {
  id: string;
  seed: number;
  rarity: Rarity | string;
  element: Element;
  hp: number;
  rechargeRate: number;
  silhouette: ShieldSilhouette;
  rarityFrame: typeof import('@/constants/weaponVisuals').RARITY_FRAME_STYLES[Rarity.Common];
  elementVisual: import('@/constants/visualAssets').VisualAsset;
  decals: import('@/lib/weaponArt/buildWeaponVisualSpec').WeaponVisualDecal[];
  texture: string;
}

/** 5 shield silhouette variants, one per element style */
export const SHIELD_SILHOUETTES: Record<string, ShieldSilhouette> = {
  /** Rounded energy plate — Fire, Corrosive */
  rounded: {
    id: 'rounded',
    label: 'Rounded Plate',
    body: 'M40 20 C75 8 165 8 200 20 C230 35 232 70 212 90 C182 114 58 114 28 90 C8 70 10 35 40 20 Z',
    core: 'M72 38 C100 28 140 28 168 38 C188 50 190 75 172 86 C140 100 100 100 68 86 C50 75 52 50 72 38 Z',
    rim: 'M44 24 C76 14 164 14 196 24 C224 38 226 68 208 86 C180 108 60 108 32 86 C14 68 16 38 44 24 Z',
    panelLines: 'M72 28 C100 20 140 20 168 28 M66 64 C94 56 146 56 174 64 M120 30 L120 82',
  },

  /** Hexagonal barrier — Shock, Kinetic */
  hexagonal: {
    id: 'hexagonal',
    label: 'Hex Barrier',
    body: 'M120 14 L210 52 L210 100 L120 126 L30 100 L30 52 Z',
    core: 'M120 34 L178 58 L178 90 L120 106 L62 90 L62 58 Z',
    rim: 'M120 16 L206 52 L206 98 L120 122 L34 98 L34 52 Z',
    panelLines: 'M120 30 L178 54 M120 30 L62 54 M120 110 L178 86 M120 110 L62 86 M120 44 L120 96 M78 64 L162 64',
  },

  /** Split-plate shield — Void, Cryo */
  split: {
    id: 'split',
    label: 'Split Plate',
    body: 'M120 18 L190 38 L208 80 L178 112 L62 112 L32 80 L50 38 Z',
    core: 'M120 38 L160 50 L170 78 L150 96 L90 96 L70 78 L80 50 Z',
    rim: 'M120 20 L188 40 L204 80 L176 108 L64 108 L36 80 L52 40 Z',
    panelLines: 'M120 38 L120 96 M80 50 L160 50 M70 78 L170 78',
  },

  /** Angular diamond — all-rounder */
  angular: {
    id: 'angular',
    label: 'Angular Diamond',
    body: 'M120 10 L198 50 L210 100 L120 130 L30 100 L42 50 Z',
    core: 'M120 34 L172 56 L180 90 L120 110 L60 90 L68 56 Z',
    rim: 'M120 14 L196 52 L206 98 L120 124 L34 98 L44 52 Z',
    panelLines: 'M120 30 L172 54 M120 114 L68 56 M120 40 L120 108 M78 62 L162 86 M78 86 L162 62',
  },

  /** Barrier ring — energy weapons mainly */
  ring: {
    id: 'ring',
    label: 'Barrier Ring',
    body: 'M78 33 C118 20 122 20 162 33 C182 58 182 82 162 107 C122 120 118 120 78 107 C58 82 58 58 78 33 Z',
    core: 'M120 50 L120 90 M78 70 L162 70',
    rim: 'M80 36 C118 24 122 24 160 36 C178 58 178 82 160 104 C122 116 118 116 80 104 C62 82 62 58 80 36 Z',
  },
};

export const DEFAULT_SHIELD_SILHOUETTE = SHIELD_SILHOUETTES.rounded;

/**
 * Pick a shield silhouette based on element and a seed.
 */
export function pickShieldSilhouette(element: Element, seed: number): ShieldSilhouette {
  switch (element) {
    case Element.Fire:
    case Element.Corrosive:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.rounded : SHIELD_SILHOUETTES.angular;
    case Element.Shock:
    case Element.Kinetic:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.hexagonal : SHIELD_SILHOUETTES.ring;
    case Element.Cryo:
    case Element.Void:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.split : SHIELD_SILHOUETTES.angular;
    default:
      return DEFAULT_SHIELD_SILHOUETTE;
  }
}
