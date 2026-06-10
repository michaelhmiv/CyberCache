import { Element, Rarity } from '@/types/game';

export interface OrdnanceSilhouette {
  id: string;
  label: string;
  /** Main payload body */
  body: string;
  /** Fuse / detonator cap */
  cap: string;
  /** Payload indicator markings */
  markings?: string;
}

export interface OrdnanceVisualSpec {
  id: string;
  seed: number;
  rarity: Rarity | string;
  element: Element;
  damage: number;
  effect: string;
  silhouette: OrdnanceSilhouette;
  rarityFrame: typeof import('@/constants/weaponVisuals').RARITY_FRAME_STYLES[Rarity.Common];
  elementVisual: import('@/constants/visualAssets').VisualAsset;
  decals: import('@/lib/weaponArt/buildWeaponVisualSpec').WeaponVisualDecal[];
  texture: string;
}

/** 4 ordnance payload shapes */
export const ORDNANCE_SILHOUETTES: Record<string, OrdnanceSilhouette> = {
  spike: {
    id: 'spike',
    label: 'Spike Grenade',
    body: 'M100 20 L140 20 L160 50 L140 80 Q120 100 100 80 L80 50 Z',
    cap: 'M108 24 L132 24 L140 44 L100 44 Z',
    markings: 'M100 44 L140 44 M110 56 L130 56 M105 68 L95 76 M135 68 L145 76',
  },
  cylinder: {
    id: 'cylinder',
    label: 'Cylinder Charge',
    body: 'M60 38 L180 38 L180 82 L60 82 Z',
    cap: 'M70 38 L170 38 L170 50 L70 50 Z',
    markings: 'M80 38 L80 82 M120 38 L120 82 M160 38 L160 82 M70 60 L170 60',
  },
  disc: {
    id: 'disc',
    label: 'Disc Mine',
    body: 'M70 46 L170 46 C190 60 190 80 170 94 L70 94 C50 80 50 60 70 46 Z',
    cap: 'M100 46 L140 46 L140 60 L100 60 Z',
    markings: 'M90 56 L150 56 M90 84 L150 84 M120 46 L120 94',
  },
  canister: {
    id: 'canister',
    label: 'Payload Canister',
    body: 'M80 28 L160 28 L180 50 L160 92 L80 92 L60 50 Z',
    cap: 'M88 28 L152 28 L152 42 L88 42 Z',
    markings: 'M80 50 L160 50 M76 65 L164 65 M80 78 L160 78',
  },
};

export const DEFAULT_ORDNANCE_SILHOUETTE = ORDNANCE_SILHOUETTES.cylinder;

/**
 * Pick an ordnance silhouette based on effect string and seed.
 */
export function pickOrdnanceSilhouette(effect: string, seed: number): OrdnanceSilhouette {
  const keys = Object.keys(ORDNANCE_SILHOUETTES);
  const hash = effect.split('').reduce((s, c) => s + c.charCodeAt(0), 0) + seed;
  return ORDNANCE_SILHOUETTES[keys[hash % keys.length]] ?? DEFAULT_ORDNANCE_SILHOUETTE;
}
