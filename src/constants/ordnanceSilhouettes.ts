import { Element, Rarity } from '@/types/game';

/**
 * Ordnance silhouettes modeled as physical explosive devices with
 * discrete mechanical components.
 *
 * Every ordnance has:
 *   body       — main payload casing (like weapon body)
 *   fuse       — detonator / arming assembly (like weapon chamber)
 *   trigger    — safety pin + spoon / arming lever (like weapon grip)
 *   payload    — explosive / elemental charge indicator (like weapon barrel)
 *   fragRing   — fragmentation grooves or banding (like weapon sight)
 *   base       — bottom plate / stabilizer (like weapon stock)
 *   emitter    — element-specific discharge port (like weapon muzzle)
 *   markings   — hazard stripes, payload indicators
 */
export interface OrdnanceSilhouette {
  id: string;
  label: string;
  body: string;
  fuse: string;
  trigger: string;
  payload: string;
  fragRing: string;
  base: string;
  emitter: string;
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

export const ORDNANCE_SILHOUETTES: Record<string, OrdnanceSilhouette> = {
  /** ===== SPIKE GRENADE — fragmentation grenade with spiked casing ===== */
  spike: {
    id: 'spike',
    label: 'Spike Grenade',
    body: 'M92 22 L148 22 L166 52 L148 82 Q120 104 92 82 L74 52 Z',
    fuse: 'M102 14 L138 14 L132 28 L108 28 Z',
    trigger: 'M106 16 L110 6 L114 6 L118 16 Z M114 14 L126 14',
    payload: 'M100 34 L140 34 L152 56 L140 78 Q120 92 100 78 L88 56 Z',
    fragRing: 'M86 50 L154 50 M82 62 L158 62 M86 74 L154 74',
    base: 'M96 92 L144 92 Q120 102 96 92 Z',
    emitter: 'M112 88 L128 88 Q120 96 112 88 Z',
    markings: 'M100 44 L140 44 M120 50 L120 78',
  },

  /** ===== CYLINDER CHARGE — demolition charge ===== */
  cylinder: {
    id: 'cylinder',
    label: 'Cylinder Charge',
    body: 'M56 36 L184 36 L184 84 L56 84 Z',
    fuse: 'M100 24 L140 24 L140 36 L100 36 Z',
    trigger: 'M108 26 L112 14 L116 14 L120 26 Z M120 30 L132 30',
    payload: 'M70 46 L170 46 L170 74 L70 74 Z',
    fragRing: 'M70 46 L170 46 M70 56 L170 56 M70 66 L170 66 M70 74 L170 74',
    base: 'M64 82 L176 82 L176 90 L64 90 Z',
    emitter: 'M108 86 L132 86 L132 94 L108 94 Z',
    markings: 'M76 46 L76 74 M120 46 L120 74 M164 46 L164 74',
  },

  /** ===== DISC MINE — proximity mine ===== */
  disc: {
    id: 'disc',
    label: 'Disc Mine',
    body: 'M64 44 L176 44 C198 60 198 84 176 100 L64 100 C42 84 42 60 64 44 Z',
    fuse: 'M104 36 L136 36 L136 48 L104 48 Z',
    trigger: 'M110 38 L114 26 L118 26 L122 38 Z M120 42 L130 42',
    payload: 'M80 52 L160 52 C174 64 174 80 160 92 L80 92 C66 80 66 64 80 52 Z',
    fragRing: 'M86 52 L154 52 M82 64 L158 64 M82 80 L158 80 M86 92 L154 92',
    base: 'M72 96 L168 96 C164 104 76 104 72 96 Z',
    emitter: 'M114 94 L126 94 C120 100 114 94 114 94 Z',
    markings: 'M96 56 L144 56 M96 88 L144 88 M120 60 L120 84',
  },

  /** ===== CANISTER — payload canister / gas charge ===== */
  canister: {
    id: 'canister',
    label: 'Payload Canister',
    body: 'M76 28 L164 28 L184 52 L164 96 L76 96 L56 52 Z',
    fuse: 'M104 18 L136 18 L136 32 L104 32 Z',
    trigger: 'M110 20 L114 8 L118 8 L122 20 Z M120 26 L130 26',
    payload: 'M90 40 L150 40 L166 56 L150 84 L90 84 L74 56 Z',
    fragRing: 'M80 48 L160 48 M78 62 L162 62 M80 76 L160 76',
    base: 'M80 92 L160 92 L156 100 L84 100 Z',
    emitter: 'M112 94 L128 94 L124 102 L116 102 Z',
    markings: 'M90 48 L90 76 M120 48 L120 76 M150 48 L150 76',
  },
};

export const DEFAULT_ORDNANCE_SILHOUETTE = ORDNANCE_SILHOUETTES.cylinder;

export function pickOrdnanceSilhouette(effect: string, seed: number): OrdnanceSilhouette {
  const keys = Object.keys(ORDNANCE_SILHOUETTES);
  const hash = effect.split('').reduce((s, c) => s + c.charCodeAt(0), 0) + seed;
  return ORDNANCE_SILHOUETTES[keys[hash % keys.length]] ?? DEFAULT_ORDNANCE_SILHOUETTE;
}
