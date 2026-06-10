import { Manufacturer, Rarity, WeaponType } from '@/types/game';

export interface ManufacturerWeaponStyle {
  id: Manufacturer;
  primary: string;
  dark: string;
  light: string;
  trim: string;
  mark: string;
  motif: 'slashes' | 'bolts' | 'vents' | 'crystals' | 'modules' | 'coils';
  frameD: string;
}

export interface RarityFrameStyle {
  id: Rarity;
  color: string;
  glow: string;
  strokeWidth: number;
  shineOpacity: number;
  stamp: string;
}

export interface WeaponTypeSilhouette {
  id: WeaponType;
  label: string;
  viewBox: string;
  anchor: { x: number; y: number };
  body: string;
  barrel: string;
  grip: string;
  stock?: string;
  magazine?: string;
  sight?: string;
  chamber?: string;
  muzzle?: string;
  mass: 'compact' | 'balanced' | 'long' | 'heavy' | 'energy';
  /** Thin seam / panel-gap lines rendered as strokes (no fill). */
  panelLines?: string;
  /** Raised plates, rail mounts, structural reinforcement shapes. */
  structural?: string;
}

export const MANUFACTURER_WEAPON_STYLES: Record<Manufacturer, ManufacturerWeaponStyle> = {
  [Manufacturer.Redline]: {
    id: Manufacturer.Redline,
    primary: '#EF4444',
    dark: '#7F1D1D',
    light: '#FCA5A5',
    trim: '#FFEA3A',
    mark: 'RL',
    motif: 'slashes',
    frameD: 'M24 28 L74 20 L138 31 L201 24 L219 43 L195 61 L70 64 L20 50 Z',
  },
  [Manufacturer.Ironwood]: {
    id: Manufacturer.Ironwood,
    primary: '#22C55E',
    dark: '#14532D',
    light: '#86EFAC',
    trim: '#B8B0A8',
    mark: 'IW',
    motif: 'bolts',
    frameD: 'M22 31 L67 24 L147 28 L210 34 L217 49 L196 60 L61 62 L18 50 Z',
  },
  [Manufacturer.BlastForge]: {
    id: Manufacturer.BlastForge,
    primary: '#FF9000',
    dark: '#78350F',
    light: '#FCD34D',
    trim: '#FFEA3A',
    mark: 'BF',
    motif: 'vents',
    frameD: 'M20 29 L70 20 L155 25 L222 31 L229 53 L190 65 L56 61 L15 50 Z',
  },
  [Manufacturer.Prismatek]: {
    id: Manufacturer.Prismatek,
    primary: '#A855F7',
    dark: '#581C87',
    light: '#D8B4FE',
    trim: '#FF9DF5',
    mark: 'PX',
    motif: 'crystals',
    frameD: 'M28 27 L83 18 L148 30 L208 23 L225 45 L198 65 L77 60 L17 52 Z',
  },
  [Manufacturer.ThrowTech]: {
    id: Manufacturer.ThrowTech,
    primary: '#06B6D4',
    dark: '#164E63',
    light: '#A5F3FC',
    trim: '#FFEA3A',
    mark: 'TT',
    motif: 'modules',
    frameD: 'M21 32 L81 24 L143 27 L201 31 L218 44 L205 57 L79 63 L17 51 Z',
  },
  [Manufacturer.HelixWorks]: {
    id: Manufacturer.HelixWorks,
    primary: '#3B82F6',
    dark: '#1E3A8A',
    light: '#93C5FD',
    trim: '#A5F3FC',
    mark: 'HX',
    motif: 'coils',
    frameD: 'M25 28 L76 22 L145 28 L207 26 L222 44 L203 61 L74 62 L19 49 Z',
  },
};

export const RARITY_FRAME_STYLES: Record<Rarity, RarityFrameStyle> = {
  [Rarity.Common]: { id: Rarity.Common, color: '#A5A7B5', glow: 'none', strokeWidth: 2, shineOpacity: 0.04, stamp: 'COMMON' },
  [Rarity.Uncommon]: { id: Rarity.Uncommon, color: '#7CFC00', glow: '0 0 8px rgba(124,252,0,0.30)', strokeWidth: 2, shineOpacity: 0.08, stamp: 'UNCOMMON' },
  [Rarity.Rare]: { id: Rarity.Rare, color: '#5AA7FF', glow: '0 0 10px rgba(90,167,255,0.40)', strokeWidth: 2.5, shineOpacity: 0.11, stamp: 'RARE' },
  [Rarity.Epic]: { id: Rarity.Epic, color: '#FF9DF5', glow: '0 0 12px rgba(255,157,245,0.46)', strokeWidth: 3, shineOpacity: 0.16, stamp: 'EPIC' },
  [Rarity.Legendary]: { id: Rarity.Legendary, color: '#FFEA3A', glow: '0 0 16px rgba(255,234,58,0.64)', strokeWidth: 3.5, shineOpacity: 0.22, stamp: 'LEGENDARY' },
};

export const WEAPON_SILHOUETTES: Record<WeaponType, WeaponTypeSilhouette> = {
  [WeaponType.Pistol]: {
    id: WeaponType.Pistol,
    label: 'Pistol',
    viewBox: '0 0 240 120',
    anchor: { x: 18, y: 28 },
    body: 'M64 44 L122 39 L143 49 L134 68 L71 70 L55 59 Z',
    barrel: 'M129 42 L194 43 L207 51 L194 58 L130 57 Z',
    grip: 'M69 64 L93 65 L86 101 L62 99 L58 78 Z',
    magazine: 'M101 63 L121 63 L116 89 L98 90 Z',
    sight: 'M91 36 L134 34 L143 40 L85 42 Z',
    chamber: 'M121 45 L145 48 L142 60 L118 61 Z',
    muzzle: 'M196 43 L219 45 L223 51 L216 58 L195 58 Z',
    mass: 'compact',
    panelLines: 'M68 47 L119 42 M77 57 L127 53 M91 38 L131 36 M104 65 L118 65 M122 46 L142 49 M70 78 L85 92 M99 68 L115 86',
    structural: 'M78 44 L115 40 L128 48 L121 61 L81 62 L72 53 Z',
  },
  [WeaponType.SMG]: {
    id: WeaponType.SMG,
    label: 'SMG',
    viewBox: '0 0 240 120',
    anchor: { x: 14, y: 30 },
    body: 'M53 43 L126 38 L153 49 L144 67 L61 69 L45 57 Z',
    barrel: 'M146 42 L206 41 L220 49 L207 57 L145 57 Z',
    grip: 'M64 64 L86 65 L80 102 L57 99 L53 77 Z',
    stock: 'M33 46 L56 43 L60 59 L36 67 L20 60 Z',
    magazine: 'M111 63 L137 63 L132 101 L106 100 Z',
    sight: 'M84 35 L142 34 L150 40 L78 42 Z',
    chamber: 'M129 45 L151 48 L147 61 L124 61 Z',
    muzzle: 'M205 42 L227 44 L230 50 L224 57 L205 57 Z',
    mass: 'balanced',
    panelLines: 'M57 45 L124 40 M71 58 L139 50 M84 37 L140 35 M113 65 L135 65 M132 46 L149 49 M57 68 L41 57 M67 82 L78 98 M34 46 L50 58',
    structural: 'M76 42 L120 38 L139 48 L130 62 L72 63 L65 53 Z M44 47 L55 46 L56 58 L46 61 Z',
  },
  [WeaponType.Shotgun]: {
    id: WeaponType.Shotgun,
    label: 'Shotgun',
    viewBox: '0 0 240 120',
    anchor: { x: 11, y: 30 },
    body: 'M50 44 L122 39 L151 51 L139 70 L57 70 L40 58 Z',
    barrel: 'M137 37 L211 38 L225 47 L212 58 L136 58 Z',
    grip: 'M62 65 L86 65 L77 104 L54 100 L50 77 Z',
    stock: 'M24 42 L55 44 L52 62 L21 72 L9 61 Z',
    magazine: 'M86 68 L139 68 L133 80 L83 80 Z',
    sight: 'M93 35 L127 34 L136 40 L87 42 Z',
    chamber: 'M116 45 L146 48 L142 62 L111 62 Z',
    muzzle: 'M205 37 L230 40 L234 48 L226 58 L205 58 Z',
    mass: 'heavy',
    panelLines: 'M53 47 L120 42 M70 60 L133 53 M93 37 L131 36 M92 69 L135 69 M117 48 L143 50 M57 68 L39 60 M56 83 L70 98 M25 42 L48 51 M124 72 L107 78 M86 72 L80 78',
    structural: 'M74 42 L118 38 L137 50 L127 64 L68 64 L60 53 Z M30 45 L52 45 L50 58 L25 66 Z',
  },
  [WeaponType.Sniper]: {
    id: WeaponType.Sniper,
    label: 'Sniper',
    viewBox: '0 0 240 120',
    anchor: { x: 9, y: 32 },
    body: 'M51 46 L117 41 L144 50 L135 65 L57 67 L41 57 Z',
    barrel: 'M137 43 L219 42 L232 49 L219 55 L137 56 Z',
    grip: 'M66 63 L87 64 L79 101 L57 98 L53 77 Z',
    stock: 'M17 43 L56 45 L50 62 L12 72 L3 61 Z',
    magazine: 'M103 64 L126 64 L121 92 L100 91 Z',
    sight: 'M78 28 L143 28 L158 38 L145 47 L81 45 L68 37 Z',
    chamber: 'M116 45 L145 49 L141 61 L112 61 Z',
    muzzle: 'M218 42 L238 44 L240 49 L236 55 L218 55 Z',
    mass: 'long',
    panelLines: 'M54 48 L115 43 M71 59 L131 52 M81 32 L137 31 M141 45 L217 44 M105 66 L124 66 M118 47 L143 50 M61 68 L42 58 M59 85 L74 97 M19 43 L52 47 M97 72 L91 88 M120 72 L105 89',
    structural: 'M74 43 L113 40 L133 50 L125 62 L68 63 L60 53 Z M26 44 L52 45 L48 57 L18 67 Z M84 30 L132 29 L145 36 L137 43 L81 43 Z',
  },
  [WeaponType.Launcher]: {
    id: WeaponType.Launcher,
    label: 'Launcher',
    viewBox: '0 0 240 120',
    anchor: { x: 10, y: 24 },
    body: 'M42 36 L156 31 L200 41 L190 71 L46 75 L24 60 Z',
    barrel: 'M143 28 L217 31 L238 45 L222 67 L146 66 Z',
    grip: 'M72 70 L98 70 L90 108 L64 104 L59 82 Z',
    stock: 'M17 41 L46 39 L43 67 L14 82 L1 67 Z',
    magazine: 'M112 70 L150 70 L143 103 L106 103 Z',
    sight: 'M76 26 L138 24 L150 32 L71 36 Z',
    chamber: 'M109 39 L154 42 L151 63 L105 64 Z',
    muzzle: 'M217 31 L239 37 L240 58 L219 67 Z',
    mass: 'heavy',
    panelLines: 'M49 40 L153 35 M75 57 L185 47 M80 29 L138 27 M118 70 L148 70 M113 42 L152 46 M53 72 L29 63 M80 84 L90 103 M21 42 L43 43 M106 77 L99 99 M150 34 L213 35 M150 33 L186 48 M133 70 L125 101',
    structural: 'M68 34 L148 30 L184 40 L175 63 L58 66 L40 54 Z M25 42 L44 40 L40 57 L20 70 Z',
  },
  [WeaponType.Beam]: {
    id: WeaponType.Beam,
    label: 'Beam',
    viewBox: '0 0 240 120',
    anchor: { x: 14, y: 29 },
    body: 'M53 45 L122 37 L154 49 L142 69 L60 70 L43 58 Z',
    barrel: 'M137 39 L197 34 L225 46 L199 59 L137 57 Z',
    grip: 'M65 65 L86 66 L80 101 L56 99 L52 78 Z',
    stock: 'M27 44 L55 43 L56 62 L28 72 L12 61 Z',
    magazine: 'M97 68 L131 68 L126 84 L100 84 Z',
    sight: 'M83 33 L132 29 L148 38 L78 42 Z',
    chamber: 'M114 42 L158 45 L151 65 L108 65 Z',
    muzzle: 'M195 33 L231 43 L234 49 L227 55 L195 60 Z',
    mass: 'energy',
    panelLines: 'M57 47 L120 40 M73 60 L137 51 M131 39 L164 44 M86 34 L130 31 M100 68 L128 68 M115 44 L156 50 M59 67 L45 60 M55 83 L70 96 M29 47 L52 47 M91 72 L85 82 M124 72 L112 82 M141 35 L197 35',
    structural: 'M76 43 L115 39 L138 48 L130 62 L72 63 L64 53 Z M35 46 L53 46 L53 58 L33 67 Z M118 43 L153 46 L148 60 L113 61 Z',
  },
};

export type PartSlot = 'Barrel' | 'Grip' | 'Core' | 'Magazine' | 'Sight' | 'Chamber';

export const PART_SLOT_LABELS: Record<PartSlot, string> = {
  Barrel: 'Barrel',
  Grip: 'Grip',
  Core: 'Core',
  Magazine: 'Magazine',
  Sight: 'Sight',
  Chamber: 'Chamber',
};

export const AFFIX_DECAL_COLORS: Record<string, string> = {
  combat: '#FF4B5C',
  elemental: '#A855F7',
  boss: '#FFEA3A',
  idle: '#7CFC00',
  skill: '#06B6D4',
};
