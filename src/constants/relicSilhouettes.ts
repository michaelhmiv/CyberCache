import { Rarity, DropSource } from '@/types/game';

/**
 * Relic silhouettes modeled as physical ancient artifacts with discrete
 * mechanical / crystalline components.
 *
 * Every relic has:
 *   casing    — outer containment frame (like weapon body)
 *   crystal   — the artifact core / gem (like weapon chamber)
 *   prongs    — top clamp arms (like weapon sight)
 *   base      — bottom mounting plate (like weapon stock)
 *   ring      — energy containment ring around crystal (like weapon barrel)
 *   runes     — etched markings on the casing
 *   stands    — support struts / legs (like weapon grip)
 */
export interface RelicSilhouette {
  id: string;
  label: string;
  casing: string;
  crystal: string;
  prongs: string;
  base: string;
  ring: string;
  runes?: string;
  stands: string;
}

export interface RelicVisualSpec {
  id: string;
  seed: number;
  rarity: Rarity | string;
  sourceTag: DropSource;
  silhouette: RelicSilhouette;
  rarityFrame: typeof import('@/constants/weaponVisuals').RARITY_FRAME_STYLES[Rarity.Common];
  decals: import('@/lib/weaponArt/buildWeaponVisualSpec').WeaponVisualDecal[];
  texture: string;
}

export const RELIC_SILHOUETTES: Record<string, RelicSilhouette> = {
  /** ===== VOID SHARD — jagged crystal artifact ===== */
  shard: {
    id: 'shard',
    label: 'Void Shard',
    casing: 'M80 18 L160 18 L180 62 L160 98 L80 98 L60 62 Z',
    crystal: 'M100 34 L140 34 L156 64 L140 90 L100 90 L84 64 Z',
    prongs: 'M92 24 L148 24 L144 32 L96 32 Z M86 18 L154 18 L150 24 L90 24 Z',
    base: 'M84 94 L156 94 L150 106 L90 106 Z',
    ring: 'M108 44 L132 44 L144 62 L136 80 L104 80 L96 62 Z',
    stands: 'M76 96 L84 94 M76 100 L84 98 M164 96 L156 94 M164 100 L156 98',
    runes: 'M120 48 L120 78 M104 56 L136 56 M104 72 L136 72',
  },

  /** ===== ECHO PRISM — geometric crystal array ===== */
  prism: {
    id: 'prism',
    label: 'Echo Prism',
    casing: 'M120 12 L178 46 L178 98 L120 128 L62 98 L62 46 Z',
    crystal: 'M120 30 L158 52 L158 86 L120 108 L82 86 L82 52 Z',
    prongs: 'M120 20 L120 30 M104 38 L104 50 M136 38 L136 50',
    base: 'M70 92 L170 92 L164 102 L76 102 Z',
    ring: 'M120 42 L146 56 L146 82 L120 96 L94 82 L94 56 Z',
    stands: 'M70 100 L76 98 M72 106 L78 104 M170 100 L164 98 M168 106 L162 104',
    runes: 'M120 56 L148 72 M120 84 L92 72',
  },

  /** ===== BOSS TOTEM — heavy boss-drop trophy ===== */
  totem: {
    id: 'totem',
    label: 'Boss Totem',
    casing: 'M74 10 L166 34 L166 96 L120 130 L74 96 L74 34 Z',
    crystal: 'M98 40 L142 50 L142 84 L120 104 L98 84 L98 56 Z',
    prongs: 'M90 24 L150 34 L148 42 L92 32 Z M120 30 L120 40',
    base: 'M80 96 L160 96 L154 110 L86 110 Z',
    ring: 'M106 46 L134 54 L134 80 L120 96 L106 80 Z',
    stands: 'M80 102 L86 100 M82 112 L88 110 M160 102 L154 100 M158 112 L152 110',
    runes: 'M120 56 L120 82',
  },

  /** ===== DATA CHIP — tech-encoded relic ===== */
  chip: {
    id: 'chip',
    label: 'Data Chip',
    casing: 'M52 38 L188 38 L188 102 L52 102 Z',
    crystal: 'M76 52 L164 52 L164 88 L76 88 Z',
    prongs: 'M100 32 L140 32 L138 42 L102 42 Z M104 26 L136 26 L134 34 L106 34 Z',
    base: 'M60 98 L180 98 L176 108 L64 108 Z',
    ring: 'M88 56 L152 56 L152 84 L88 84 Z',
    stands: 'M60 106 L68 104 M62 114 L70 112 M180 106 L172 104 M178 114 L170 112',
    runes: 'M92 60 L148 60 M92 68 L148 68 M92 76 L148 76',
  },
};

export const DEFAULT_RELIC_SILHOUETTE = RELIC_SILHOUETTES.chip;

export function pickRelicSilhouette(sourceTag: DropSource, seed: number): RelicSilhouette {
  switch (sourceTag) {
    case DropSource.BossDrop: return RELIC_SILHOUETTES.totem;
    case DropSource.CacheForged: return RELIC_SILHOUETTES.chip;
    case DropSource.Event: return RELIC_SILHOUETTES.prism;
    case DropSource.WorldDrop:
    default: return seed % 2 === 0 ? RELIC_SILHOUETTES.shard : RELIC_SILHOUETTES.prism;
  }
}
