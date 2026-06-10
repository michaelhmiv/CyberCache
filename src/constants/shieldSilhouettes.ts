import { Element, Rarity } from '@/types/game';

/**
 * Shield silhouettes modeled as physical devices with discrete mechanical
 * components — same part density as weapon silhouettes (9+ named paths).
 *
 * Every shield has:
 *   housing     — outer chassis / frame (like weapon body)
 *   emitter     — the energy plate face (like weapon barrel)
 *   capLeft     — left capacitor bank (like weapon grip)
 *   capRight    — right capacitor bank
 *   heatsink    — cooling fin array along the top (like weapon sight)
 *   mountBase   — arm attachment bracket base (like weapon stock)
 *   fieldRing   — energy containment ring around the emitter (like weapon chamber)
 *   guardEdge   — outer protective lip / rim (like weapon muzzle)
 *   panelLines  — seam lines, cutouts, vents
 *   structural  — raised reinforcement plates
 */
export interface ShieldSilhouette {
  id: string;
  label: string;
  /** Main chassis / housing body */
  housing: string;
  /** Energy emitter plate — the glowing shield face */
  emitter: string;
  /** Left-side capacitor / power module */
  capLeft: string;
  /** Right-side capacitor / power module */
  capRight: string;
  /** Top cooling fin / heat sink array */
  heatsink: string;
  /** Arm-mount bracket base */
  mountBase: string;
  /** Energy containment ring around the emitter */
  fieldRing: string;
  /** Outer protective guard edge */
  guardEdge: string;
  /** Panel lines, seams, cutouts */
  panelLines?: string;
  /** Raised reinforcement plates */
  structural?: string;
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

/**
 * 5 shield physical variants. Each has the same 8-part structure, but
 * different geometry — rounded, angular, split-panel, compact, and
 * heavy-barrier shapes.
 */
export const SHIELD_SILHOUETTES: Record<string, ShieldSilhouette> = {
  /** ===== ROUNDED GUARD — classic curved energy shield ===== */
  rounded: {
    id: 'rounded',
    label: 'Rounded Guard',
    // Outer chassis — wide curved frame
    housing: 'M36 24 C68 10 172 10 204 24 C236 42 238 78 214 100 C180 128 60 128 26 100 C2 78 4 42 36 24 Z',
    // Emitter plate — the energy face itself
    emitter: 'M56 38 C82 26 158 26 184 38 C208 54 210 80 190 96 C162 116 78 116 50 96 C30 80 32 54 56 38 Z',
    // Left capacitor module
    capLeft: 'M20 52 L42 48 L38 82 L16 86 Z',
    // Right capacitor module
    capRight: 'M200 48 L222 52 L226 86 L204 82 Z',
    // Top heatsink fins
    heatsink: 'M80 18 L160 18 L155 28 L85 28 Z M90 11 L150 11 L148 17 L92 17 Z',
    // Arm mount bracket (bottom center)
    mountBase: 'M100 118 L140 118 L135 132 L105 132 Z',
    // Energy field ring — elliptical containment around the emitter
    fieldRing: 'M68 46 C96 34 144 34 172 46 C192 60 194 78 176 90 C150 106 90 106 64 90 C46 78 48 60 68 46 Z',
    // Protective guard lip
    guardEdge: 'M40 28 C70 16 170 16 200 28 C230 44 232 76 210 96 C178 122 62 122 30 96 C8 76 10 44 40 28 Z',
    panelLines: 'M56 50 C80 40 160 40 184 50 M50 74 C78 62 162 62 190 74 M120 40 L120 104 M70 44 L66 82 M170 44 L174 82',
    structural: 'M72 42 C98 32 142 32 168 42 L160 58 C140 50 100 50 80 58 Z',
  },

  /** ===== HEX PLATE — angular tech shield (Shock / Kinetic) ===== */
  hexPlate: {
    id: 'hexPlate',
    label: 'Hex Plate',
    housing: 'M120 10 L210 48 L210 104 L120 130 L30 104 L30 48 Z',
    emitter: 'M120 28 L186 54 L186 92 L120 112 L54 92 L54 54 Z',
    capLeft: 'M22 60 L40 54 L36 90 L18 96 Z',
    capRight: 'M200 54 L218 60 L222 96 L204 90 Z',
    heatsink: 'M86 14 L154 14 L150 22 L90 22 Z M96 8 L144 8 L142 14 L98 14 Z',
    mountBase: 'M104 124 L136 124 L132 136 L108 136 Z',
    fieldRing: 'M120 36 L172 60 L172 88 L120 106 L68 88 L68 60 Z',
    guardEdge: 'M120 14 L206 50 L206 100 L120 126 L34 100 L34 50 Z',
    panelLines: 'M120 34 L172 60 M120 34 L68 60 M120 108 L172 86 M120 108 L68 86 M120 46 L120 98 M82 60 L158 84',
    structural: 'M120 40 L164 62 L164 84 L120 100 L76 84 L76 62 Z',
  },

  /** ===== SPLIT PANEL — two-panel defensive barrier (Cryo / Void) ===== */
  splitPanel: {
    id: 'splitPanel',
    label: 'Split Panel',
    housing: 'M120 14 L198 34 L216 80 L180 118 L60 118 L24 80 L42 34 Z',
    emitter: 'M120 34 L176 50 L188 80 L164 102 L76 102 L52 80 L64 50 Z',
    capLeft: 'M16 72 L40 64 L36 98 L12 106 Z',
    capRight: 'M200 64 L224 72 L228 106 L204 98 Z',
    heatsink: 'M80 18 L160 18 L156 28 L84 28 Z M90 12 L150 12 L148 18 L92 18 Z',
    mountBase: 'M100 112 L140 112 L136 126 L104 126 Z',
    fieldRing: 'M120 42 L160 56 L168 80 L152 96 L88 96 L72 80 L80 56 Z',
    guardEdge: 'M120 18 L196 36 L212 80 L178 114 L62 114 L28 80 L44 36 Z',
    panelLines: 'M120 44 L120 96 M72 68 L168 68 M120 44 L80 80 M120 44 L160 80',
    structural: 'M108 48 L132 48 L142 64 L132 80 L108 80 L98 64 Z',
  },

  /** ===== BUCKLER — compact fast-recharge shield ===== */
  buckler: {
    id: 'buckler',
    label: 'Buckler',
    housing: 'M70 20 L170 20 L190 70 L170 110 L70 110 L50 70 Z',
    emitter: 'M84 36 L156 36 L170 70 L156 96 L84 96 L70 70 Z',
    capLeft: 'M44 62 L66 56 L62 88 L40 94 Z',
    capRight: 'M174 56 L196 62 L200 94 L178 88 Z',
    heatsink: 'M94 18 L146 18 L144 24 L96 24 Z',
    mountBase: 'M100 106 L140 106 L136 116 L104 116 Z',
    fieldRing: 'M92 46 L148 46 L158 70 L148 88 L92 88 L82 70 Z',
    guardEdge: 'M74 24 L166 24 L186 70 L166 106 L74 106 L54 70 Z',
    panelLines: 'M92 56 L148 56 M92 84 L148 84 M118 46 L118 88',
    structural: 'M100 50 L140 50 L148 66 L140 82 L100 82 L92 66 Z',
  },

  /** ===== BULWARK — heavy multi-layer barrier ===== */
  bulwark: {
    id: 'bulwark',
    label: 'Bulwark',
    housing: 'M30 28 C70 14 170 14 210 28 C242 50 244 90 216 112 C176 132 64 132 24 112 C-4 90 -2 50 30 28 Z',
    emitter: 'M50 44 C82 32 158 32 190 44 C212 62 214 84 192 100 C158 116 82 116 48 100 C26 84 28 62 50 44 Z',
    capLeft: 'M12 64 L36 58 L32 92 L8 98 Z',
    capRight: 'M204 58 L228 64 L232 98 L208 92 Z',
    heatsink: 'M74 16 L166 16 L162 26 L78 26 Z M86 10 L154 10 L152 16 L88 16 Z M94 4 L146 4 L144 10 L96 10 Z',
    mountBase: 'M100 124 L140 124 L136 136 L104 136 Z M108 130 L132 130 L130 140 L110 140 Z',
    fieldRing: 'M64 54 C94 42 146 42 176 54 C196 68 198 82 182 92 C154 106 86 106 58 92 C42 82 44 68 64 54 Z',
    guardEdge: 'M34 32 C72 20 168 20 206 32 C236 52 238 86 212 106 C174 124 66 124 28 106 C2 86 4 52 34 32 Z',
    panelLines: 'M60 58 C90 48 150 48 180 58 M54 80 C86 68 154 68 186 80 M120 48 L120 100 M80 50 L76 88 M160 50 L164 88',
    structural: 'M78 48 C106 38 134 38 162 48 L156 62 C136 54 104 54 84 62 Z M70 72 L98 66 L94 92 L66 98 Z M170 72 L142 66 L146 92 L174 98 Z',
  },
};

export const DEFAULT_SHIELD_SILHOUETTE = SHIELD_SILHOUETTES.rounded;

export function pickShieldSilhouette(element: Element, seed: number): ShieldSilhouette {
  switch (element) {
    case Element.Fire:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.rounded : SHIELD_SILHOUETTES.buckler;
    case Element.Corrosive:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.rounded : SHIELD_SILHOUETTES.bulwark;
    case Element.Shock:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.hexPlate : SHIELD_SILHOUETTES.buckler;
    case Element.Kinetic:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.hexPlate : SHIELD_SILHOUETTES.splitPanel;
    case Element.Cryo:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.splitPanel : SHIELD_SILHOUETTES.bulwark;
    case Element.Void:
      return seed % 2 === 0 ? SHIELD_SILHOUETTES.splitPanel : SHIELD_SILHOUETTES.rounded;
    default:
      return DEFAULT_SHIELD_SILHOUETTE;
  }
}
