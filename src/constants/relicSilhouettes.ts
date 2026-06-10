import { Rarity, DropSource } from '@/types/game';

export interface RelicSilhouette {
  id: string;
  label: string;
  /** Main artifact body */
  body: string;
  /** Inner core / glowing center */
  core: string;
  /** Rune markings */
  runes?: string;
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

/** 4 relic artifact shapes */
export const RELIC_SILHOUETTES: Record<string, RelicSilhouette> = {
  shard: {
    id: 'shard',
    label: 'Void Shard',
    body: 'M90 16 L150 16 L180 60 L150 104 L90 104 L60 60 Z',
    core: 'M100 34 L140 34 L158 64 L140 92 L100 92 L82 64 Z',
    runes: 'M110 44 L130 44 M98 62 L142 62 M110 80 L130 80',
  },
  prism: {
    id: 'prism',
    label: 'Echo Prism',
    body: 'M120 14 L176 46 L176 94 L120 126 L64 94 L64 46 Z',
    core: 'M120 38 L148 54 L148 86 L120 102 L92 86 L92 54 Z',
    runes: 'M120 52 L148 66 M120 88 L92 74',
  },
  totem: {
    id: 'totem',
    label: 'Boss Totem',
    body: 'M80 14 L160 38 L160 100 L120 130 L80 100 L80 38 Z',
    core: 'M100 44 L140 56 L140 90 L120 110 L100 90 L100 56 Z',
    runes: 'M120 56 L120 90',
  },
  chip: {
    id: 'chip',
    label: 'Data Chip',
    body: 'M60 42 L180 42 L180 98 L60 98 Z',
    core: 'M80 56 L160 56 L160 84 L80 84 Z',
    runes: 'M90 60 L150 60 M90 70 L150 70 M90 80 L150 80',
  },
};

export const DEFAULT_RELIC_SILHOUETTE = RELIC_SILHOUETTES.chip;

/**
 * Pick a relic silhouette based on sourceTag and seed.
 */
export function pickRelicSilhouette(sourceTag: DropSource, seed: number): RelicSilhouette {
  switch (sourceTag) {
    case DropSource.BossDrop: return RELIC_SILHOUETTES.totem;
    case DropSource.CacheForged: return RELIC_SILHOUETTES.chip;
    case DropSource.Event: return RELIC_SILHOUETTES.prism;
    case DropSource.WorldDrop:
    default: return seed % 2 === 0 ? RELIC_SILHOUETTES.shard : RELIC_SILHOUETTES.prism;
  }
}
