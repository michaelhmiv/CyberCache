import {
  CraftedConsumableType,
  DropSource,
  Element,
  EssenceType,
  Manufacturer,
  MaterialType,
  WeaponType,
  ConsumableType,
} from '@/types/game';
import { CONSUMABLES, type ConsumableVisual } from './consumables';

export type VisualAssetKind =
  | 'element'
  | 'manufacturer'
  | 'weaponType'
  | 'material'
  | 'essence'
  | 'gear'
  | 'resource'
  | 'dropSource'
  | 'consumable';

export type GearVisualId = 'weapon' | 'shield' | 'classMod' | 'relic' | 'ordnance';
export type ResourceVisualId = 'credits' | 'scrap' | 'cacheKey' | 'cacheFragment' | 'xp' | 'level' | 'masteryPoint' | 'loot' | 'legendaryCore';

export interface VisualAsset {
  id: string;
  kind: VisualAssetKind;
  label: string;
  shortLabel: string;
  mark: string;
  color: string;
  accentColor: string;
  description: string;
  texture?: 'metal' | 'liquid' | 'crystal' | 'energy' | 'organic' | 'data' | 'ordnance';
}

const UNKNOWN_VISUAL: VisualAsset = {
  id: 'unknown',
  kind: 'resource',
  label: 'Unknown',
  shortLabel: 'UNK',
  mark: '?',
  color: '#B8B0A8',
  accentColor: '#34303A',
  description: 'Unregistered visual asset.',
};

export const ELEMENT_VISUALS = {
  [Element.Kinetic]: {
    id: Element.Kinetic,
    kind: 'element',
    label: 'Kinetic',
    shortLabel: 'KIN',
    mark: 'K',
    color: '#B8B0A8',
    accentColor: '#F5F5F5',
    description: 'Raw ballistic force. Metallic, practical, and unglamorous.',
    texture: 'metal',
  },
  [Element.Fire]: {
    id: Element.Fire,
    kind: 'element',
    label: 'Fire',
    shortLabel: 'FIR',
    mark: 'F',
    color: '#FF4B1F',
    accentColor: '#FFEA3A',
    description: 'Heat vents, burn scoring, and orange muzzle flare.',
    texture: 'liquid',
  },
  [Element.Shock]: {
    id: Element.Shock,
    kind: 'element',
    label: 'Shock',
    shortLabel: 'SHK',
    mark: 'S',
    color: '#3B82F6',
    accentColor: '#A5F3FC',
    description: 'Charged coils, blue arcs, and circuit slashes.',
    texture: 'energy',
  },
  [Element.Corrosive]: {
    id: Element.Corrosive,
    kind: 'element',
    label: 'Corrosive',
    shortLabel: 'COR',
    mark: 'C',
    color: '#22C55E',
    accentColor: '#C4FF2F',
    description: 'Acid tanks, toxic drips, and chemical hazard marks.',
    texture: 'liquid',
  },
  [Element.Cryo]: {
    id: Element.Cryo,
    kind: 'element',
    label: 'Cryo',
    shortLabel: 'CRY',
    mark: 'Y',
    color: '#06B6D4',
    accentColor: '#E0F2FE',
    description: 'Frosted metal, ice chips, and cyan crystal caps.',
    texture: 'crystal',
  },
  [Element.Void]: {
    id: Element.Void,
    kind: 'element',
    label: 'Void',
    shortLabel: 'VOI',
    mark: 'V',
    color: '#8B5CF6',
    accentColor: '#FF9DF5',
    description: 'Unstable purple cores, glitch scars, and delayed burst marks.',
    texture: 'energy',
  },
} satisfies Record<Element, VisualAsset>;

export const MANUFACTURER_VISUALS = {
  [Manufacturer.Redline]: {
    id: Manufacturer.Redline,
    kind: 'manufacturer',
    label: 'Redline',
    shortLabel: 'RDL',
    mark: 'RL',
    color: '#EF4444',
    accentColor: '#FFEA3A',
    description: 'Aggressive red-black weapons with speed slashes and hard angles.',
    texture: 'ordnance',
  },
  [Manufacturer.Ironwood]: {
    id: Manufacturer.Ironwood,
    kind: 'manufacturer',
    label: 'Ironwood',
    shortLabel: 'IRN',
    mark: 'IW',
    color: '#22C55E',
    accentColor: '#B8B0A8',
    description: 'Bolted survivor hardware: plated, rugged, and field-repairable.',
    texture: 'metal',
  },
  [Manufacturer.BlastForge]: {
    id: Manufacturer.BlastForge,
    kind: 'manufacturer',
    label: 'BlastForge',
    shortLabel: 'BLF',
    mark: 'BF',
    color: '#FF9000',
    accentColor: '#FFEA3A',
    description: 'Heavy industrial bodies with heat vents and explosive trim.',
    texture: 'ordnance',
  },
  [Manufacturer.Prismatek]: {
    id: Manufacturer.Prismatek,
    kind: 'manufacturer',
    label: 'Prismatek',
    shortLabel: 'PRI',
    mark: 'PX',
    color: '#A855F7',
    accentColor: '#FF9DF5',
    description: 'Crystalline tech, angled plates, and refracted energy channels.',
    texture: 'crystal',
  },
  [Manufacturer.ThrowTech]: {
    id: Manufacturer.ThrowTech,
    kind: 'manufacturer',
    label: 'ThrowTech',
    shortLabel: 'THR',
    mark: 'TT',
    color: '#06B6D4',
    accentColor: '#FFEA3A',
    description: 'Compact modular gadgetry with exposed modules and snap-on cells.',
    texture: 'data',
  },
  [Manufacturer.HelixWorks]: {
    id: Manufacturer.HelixWorks,
    kind: 'manufacturer',
    label: 'HelixWorks',
    shortLabel: 'HLX',
    mark: 'HX',
    color: '#3B82F6',
    accentColor: '#A5F3FC',
    description: 'Coils, ring assemblies, and cleaner high-tech weapon frames.',
    texture: 'energy',
  },
} satisfies Record<Manufacturer, VisualAsset>;

export const WEAPON_TYPE_VISUALS = {
  [WeaponType.Pistol]: { id: WeaponType.Pistol, kind: 'weaponType', label: 'Pistol', shortLabel: 'PST', mark: 'P', color: '#FF9000', accentColor: '#F5F5F5', description: 'Compact sidearm silhouette.', texture: 'ordnance' },
  [WeaponType.SMG]: { id: WeaponType.SMG, kind: 'weaponType', label: 'SMG', shortLabel: 'SMG', mark: 'S', color: '#FF4B5C', accentColor: '#F5F5F5', description: 'Longer fast-fire silhouette.', texture: 'ordnance' },
  [WeaponType.Shotgun]: { id: WeaponType.Shotgun, kind: 'weaponType', label: 'Shotgun', shortLabel: 'SHG', mark: 'G', color: '#FFEA3A', accentColor: '#000000', description: 'Chunky close-range silhouette.', texture: 'ordnance' },
  [WeaponType.Sniper]: { id: WeaponType.Sniper, kind: 'weaponType', label: 'Sniper', shortLabel: 'SNP', mark: 'N', color: '#5AA7FF', accentColor: '#F5F5F5', description: 'Long precision silhouette.', texture: 'ordnance' },
  [WeaponType.Launcher]: { id: WeaponType.Launcher, kind: 'weaponType', label: 'Launcher', shortLabel: 'LCH', mark: 'L', color: '#FF4B1F', accentColor: '#FFEA3A', description: 'Oversized explosive tube silhouette.', texture: 'ordnance' },
  [WeaponType.Beam]: { id: WeaponType.Beam, kind: 'weaponType', label: 'Beam', shortLabel: 'BEM', mark: 'B', color: '#A855F7', accentColor: '#A5F3FC', description: 'Split energy barrel silhouette.', texture: 'energy' },
} satisfies Record<WeaponType, VisualAsset>;

export const MATERIAL_VISUALS = {
  [MaterialType.ScrapAlloy]: { id: MaterialType.ScrapAlloy, kind: 'material', label: 'Scrap Alloy', shortLabel: 'ALY', mark: 'A', color: '#A5A7B5', accentColor: '#F5F5F5', description: 'Bolts, plates, and rough salvage metal.', texture: 'metal' },
  [MaterialType.BallisticParts]: { id: MaterialType.BallisticParts, kind: 'material', label: 'Ballistic Parts', shortLabel: 'BAL', mark: 'B', color: '#FF4B5C', accentColor: '#FFEA3A', description: 'Barrels, chambers, triggers, and shell hardware.', texture: 'ordnance' },
  [MaterialType.ReactiveComponents]: { id: MaterialType.ReactiveComponents, kind: 'material', label: 'Reactive Components', shortLabel: 'REA', mark: 'R', color: '#3B82F6', accentColor: '#A5F3FC', description: 'Capacitors, shield nodes, and charged regulators.', texture: 'energy' },
  [MaterialType.TechFragments]: { id: MaterialType.TechFragments, kind: 'material', label: 'Tech Fragments', shortLabel: 'TEC', mark: 'T', color: '#A855F7', accentColor: '#FF9DF5', description: 'Broken chips, data shards, and machine logic.', texture: 'data' },
  [MaterialType.VoidDust]: { id: MaterialType.VoidDust, kind: 'material', label: 'Void Dust', shortLabel: 'VOI', mark: 'V', color: '#8B5CF6', accentColor: '#FF9DF5', description: 'Purple unstable residue from anomalous loot.', texture: 'energy' },
  [MaterialType.Siltglass]: { id: MaterialType.Siltglass, kind: 'material', label: 'Siltglass', shortLabel: 'SIL', mark: 'S', color: '#E8D44D', accentColor: '#FFF7AE', description: 'Dustwaste signature: silt fused to glass in the storm heat. Tier-2 input for sights and refining catalysts.', texture: 'crystal' },
  [MaterialType.NitrocellGel]: { id: MaterialType.NitrocellGel, kind: 'material', label: 'Nitrocell Gel', shortLabel: 'NIT', mark: 'N', color: '#FF7A1A', accentColor: '#FFEA3A', description: 'Redline signature: volatile gel bled from overrun fuel lines. Tier-2 input for overcharge fuel and speed ammo.', texture: 'liquid' },
  [MaterialType.HeartwoodResin]: { id: MaterialType.HeartwoodResin, kind: 'material', label: 'Heartwood Resin', shortLabel: 'HEA', mark: 'H', color: '#7CB342', accentColor: '#DCE775', description: 'Ironwood signature: resin from the bastion heartwood. Tier-2 input for patch kits, shields, and armor work.', texture: 'liquid' },
  [MaterialType.ForgeheartIngots]: { id: MaterialType.ForgeheartIngots, kind: 'material', label: 'Forgeheart Ingots', shortLabel: 'FOR', mark: 'F', color: '#FF5722', accentColor: '#FFCCBC', description: 'BlastForge signature: ingots poured at the forge heart. Tier-2 input for weapon parts and ordnance.', texture: 'metal' },
  [MaterialType.PrismShards]: { id: MaterialType.PrismShards, kind: 'material', label: 'Prism Shards', shortLabel: 'PRI', mark: 'P', color: '#4DD0E1', accentColor: '#E0F7FA', description: 'Prismatek signature: reactor-grown prism crystal. Tier-2 input for beam parts, optics, class mods, and scanners.', texture: 'crystal' },
  [MaterialType.MagnetiteCores]: { id: MaterialType.MagnetiteCores, kind: 'material', label: 'Magnetite Cores', shortLabel: 'MAG', mark: 'M', color: '#90A4AE', accentColor: '#CFD8DC', description: 'ThrowTech signature: magnetic cores pulled from the dumpnet grid. Tier-2 input for cargo racks and salvage gear.', texture: 'metal' },
  [MaterialType.MycoSteelFiber]: { id: MaterialType.MycoSteelFiber, kind: 'material', label: 'Myco-Steel Fiber', shortLabel: 'MYC', mark: 'Y', color: '#26A69A', accentColor: '#B2DFDB', description: 'HelixWorks signature: fungal fiber with a steel weave. Tier-2 input for top survival consumables and relics.', texture: 'data' },
} satisfies Record<MaterialType, VisualAsset>;

export const ESSENCE_VISUALS = {
  [EssenceType.IgnitionFluid]: { id: EssenceType.IgnitionFluid, kind: 'essence', label: 'Ignition Fluid', shortLabel: 'IGN', mark: 'F', color: '#FF4B1F', accentColor: '#FFEA3A', description: 'Hot fuel for incendiary payloads.', texture: 'liquid' },
  [EssenceType.ConduitWire]: { id: EssenceType.ConduitWire, kind: 'essence', label: 'Conduit Wire', shortLabel: 'CON', mark: 'S', color: '#3B82F6', accentColor: '#A5F3FC', description: 'Blue wire bundles that carry shock charge.', texture: 'energy' },
  [EssenceType.AcidCompound]: { id: EssenceType.AcidCompound, kind: 'essence', label: 'Acid Compound', shortLabel: 'ACD', mark: 'C', color: '#22C55E', accentColor: '#C4FF2F', description: 'Toxic reagent for corrosive effects.', texture: 'liquid' },
  [EssenceType.CryoGel]: { id: EssenceType.CryoGel, kind: 'essence', label: 'Cryo Gel', shortLabel: 'CRY', mark: 'Y', color: '#06B6D4', accentColor: '#E0F2FE', description: 'Cold gel used for freeze modules.', texture: 'crystal' },
  [EssenceType.VoidEssence]: { id: EssenceType.VoidEssence, kind: 'essence', label: 'Void Essence', shortLabel: 'VOI', mark: 'V', color: '#8B5CF6', accentColor: '#FF9DF5', description: 'Condensed anomaly charge for unstable gear.', texture: 'energy' },
} satisfies Record<EssenceType, VisualAsset>;

export const GEAR_VISUALS: Record<GearVisualId, VisualAsset> = {
  weapon: { id: 'weapon', kind: 'gear', label: 'Weapon', shortLabel: 'WPN', mark: 'W', color: '#FF9000', accentColor: '#FFEA3A', description: 'Procedural weapon illustration.', texture: 'ordnance' },
  shield: { id: 'shield', kind: 'gear', label: 'Shield', shortLabel: 'SHD', mark: 'S', color: '#3B82F6', accentColor: '#A5F3FC', description: 'Defensive energy plate.', texture: 'energy' },
  classMod: { id: 'classMod', kind: 'gear', label: 'Class Mod', shortLabel: 'MOD', mark: 'M', color: '#A855F7', accentColor: '#FF9DF5', description: 'Skill-tree module.', texture: 'data' },
  relic: { id: 'relic', kind: 'gear', label: 'Relic', shortLabel: 'RLC', mark: 'R', color: '#FFEA3A', accentColor: '#FF9000', description: 'Anomalous trophy piece.', texture: 'crystal' },
  ordnance: { id: 'ordnance', kind: 'gear', label: 'Ordnance', shortLabel: 'ORD', mark: 'O', color: '#FF4B1F', accentColor: '#FFEA3A', description: 'Grenade or heavy payload.', texture: 'ordnance' },
};

export const RESOURCE_VISUALS: Record<ResourceVisualId, VisualAsset> = {
  // ── ResourceBar chips: maximally distinct colors so the 5 icons never blend ──
  credits: { id: 'credits', kind: 'resource', label: 'Credits', shortLabel: 'CR', mark: '$', color: '#FFD700', accentColor: '#FFA000', description: 'Spendable currency.', texture: 'metal' },
  scrap: { id: 'scrap', kind: 'resource', label: 'Scrap', shortLabel: 'SCR', mark: 'S', color: '#FF5722', accentColor: '#FF8A65', description: 'Workbench salvage.', texture: 'metal' },
  cacheKey: { id: 'cacheKey', kind: 'resource', label: 'Cache Key', shortLabel: 'KEY', mark: 'K', color: '#00BCD4', accentColor: '#80DEEA', description: 'Opens a Data Cache.', texture: 'data' },
  cacheFragment: { id: 'cacheFragment', kind: 'resource', label: 'Cache Fragment', shortLabel: 'FRG', mark: 'F', color: '#2196F3', accentColor: '#90CAF9', description: 'Five fragments become one cache key.', texture: 'data' },
  xp: { id: 'xp', kind: 'resource', label: 'XP', shortLabel: 'XP', mark: 'XP', color: '#7CFC00', accentColor: '#C4FF2F', description: 'Level progress.', texture: 'energy' },
  level: { id: 'level', kind: 'resource', label: 'Level', shortLabel: 'LV', mark: 'LV', color: '#E040FB', accentColor: '#EA80FC', description: 'Hunter level.', texture: 'metal' },
  masteryPoint: { id: 'masteryPoint', kind: 'resource', label: 'Mastery Point', shortLabel: 'MP', mark: 'M', color: '#A855F7', accentColor: '#FF9DF5', description: 'Skill tree currency.', texture: 'data' },
  loot: { id: 'loot', kind: 'resource', label: 'Loot', shortLabel: 'LOOT', mark: 'L', color: '#76FF03', accentColor: '#B2FF59', description: 'Gear reward.', texture: 'ordnance' },
  legendaryCore: { id: 'legendaryCore', kind: 'resource', label: 'Legendary Core', shortLabel: 'CORE', mark: 'C', color: '#FF9800', accentColor: '#FFCC80', description: 'Salvaged from Legendary gear. Powers core-catalyzed crafting and high-end rerolls.', texture: 'crystal' },
};

export const DROP_SOURCE_VISUALS = {
  [DropSource.WorldDrop]: { id: DropSource.WorldDrop, kind: 'dropSource', label: 'World Drop', shortLabel: 'WRLD', mark: 'W', color: '#B8B0A8', accentColor: '#FF9000', description: 'Dropped from roaming badlands enemies.', texture: 'metal' },
  [DropSource.BossDrop]: { id: DropSource.BossDrop, kind: 'dropSource', label: 'Boss Drop', shortLabel: 'BOSS', mark: 'B', color: '#FF4B5C', accentColor: '#FFEA3A', description: 'Earned from a boss target.', texture: 'ordnance' },
  [DropSource.CacheForged]: { id: DropSource.CacheForged, kind: 'dropSource', label: 'Cache-Forged', shortLabel: 'CACH', mark: 'C', color: '#7CFC00', accentColor: '#A5F3FC', description: 'Pulled from a Data Cache.', texture: 'data' },
  [DropSource.Crafted]: { id: DropSource.Crafted, kind: 'dropSource', label: 'Crafted', shortLabel: 'CRFT', mark: 'F', color: '#FF9000', accentColor: '#FFEA3A', description: 'Built at the workbench.', texture: 'metal' },
  [DropSource.Event]: { id: DropSource.Event, kind: 'dropSource', label: 'Event', shortLabel: 'EVT', mark: 'E', color: '#A855F7', accentColor: '#FF9DF5', description: 'Limited event loot.', texture: 'energy' },
  [DropSource.Marketplace]: { id: DropSource.Marketplace, kind: 'dropSource', label: 'Marketplace', shortLabel: 'MKT', mark: '$', color: '#F7D20B', accentColor: '#FF9000', description: 'Acquired from the vendor yard.', texture: 'metal' },
} satisfies Record<DropSource, VisualAsset>;

export function getElementVisual(id: Element | string): VisualAsset {
  return (ELEMENT_VISUALS as Record<string, VisualAsset>)[id] ?? UNKNOWN_VISUAL;
}

export function getManufacturerVisual(id: Manufacturer | string): VisualAsset {
  return (MANUFACTURER_VISUALS as Record<string, VisualAsset>)[id] ?? UNKNOWN_VISUAL;
}

export function getWeaponTypeVisual(id: WeaponType | string): VisualAsset {
  return (WEAPON_TYPE_VISUALS as Record<string, VisualAsset>)[id] ?? UNKNOWN_VISUAL;
}

export function getMaterialVisual(id: MaterialType | EssenceType | string): VisualAsset {
  return (MATERIAL_VISUALS as Record<string, VisualAsset>)[id] ?? (ESSENCE_VISUALS as Record<string, VisualAsset>)[id] ?? UNKNOWN_VISUAL;
}

export function getGearVisual(id: GearVisualId | string): VisualAsset {
  return (GEAR_VISUALS as Record<string, VisualAsset>)[id] ?? UNKNOWN_VISUAL;
}

export function getResourceVisual(id: ResourceVisualId | string): VisualAsset {
  return (RESOURCE_VISUALS as Record<string, VisualAsset>)[id] ?? UNKNOWN_VISUAL;
}

export function getDropSourceVisual(id: DropSource | string): VisualAsset {
  return (DROP_SOURCE_VISUALS as Record<string, VisualAsset>)[id] ?? UNKNOWN_VISUAL;
}

/**
 * `consumables.ts` is the canonical source for consumable visuals. These tables
 * translate its richer `ConsumableVisual` shape (glyph + accent + silhouette)
 * into the flat `VisualAsset` contract consumed by the rest of the UI.
 */
const CONSUMABLE_ACCENT_COLOR: Record<ConsumableVisual['accent'], string> = {
  green: '#7CFC00',
  red: '#FF4B5C',
  orange: '#FF9000',
  cyan: '#00E5FF',
  amber: '#FFB300',
  purple: '#B66BFF',
  blue: '#5AA7FF',
};

const CONSUMABLE_TEXTURE: Record<ConsumableVisual['silhouette'], NonNullable<VisualAsset['texture']>> = {
  vial: 'liquid',
  cell: 'energy',
  swarm: 'organic',
  syringe: 'liquid',
  magazine: 'ordnance',
  rounds: 'ordnance',
  grenade: 'ordnance',
  scanner: 'data',
  beacon: 'data',
  contract: 'data',
  ticket: 'metal',
};

export function getConsumableVisual(id: ConsumableType | CraftedConsumableType | string): VisualAsset {
  const def = CONSUMABLES[id];
  if (def) {
    const color = CONSUMABLE_ACCENT_COLOR[def.visual.accent];
    return {
      id: String(id),
      kind: 'consumable',
      label: def.name,
      shortLabel: def.name.slice(0, 3).toUpperCase(),
      mark: def.visual.glyph,
      color,
      accentColor: color,
      description: def.shortDescription,
      texture: CONSUMABLE_TEXTURE[def.visual.silhouette],
    };
  }
  return {
    ...UNKNOWN_VISUAL,
    id: String(id),
    kind: 'consumable',
    label: String(id).replace(/([A-Z])/g, ' $1').trim(),
    shortLabel: String(id).slice(0, 3).toUpperCase(),
    mark: String(id).slice(0, 1).toUpperCase(),
  };
}

export function getVisualAsset(kind: VisualAssetKind, id: string): VisualAsset {
  switch (kind) {
    case 'element': return getElementVisual(id);
    case 'manufacturer': return getManufacturerVisual(id);
    case 'weaponType': return getWeaponTypeVisual(id);
    case 'material':
    case 'essence': return getMaterialVisual(id);
    case 'gear': return getGearVisual(id);
    case 'resource': return getResourceVisual(id);
    case 'dropSource': return getDropSourceVisual(id);
    case 'consumable': return getConsumableVisual(id);
    default: return UNKNOWN_VISUAL;
  }
}
