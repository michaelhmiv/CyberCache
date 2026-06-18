/**
 * Area Visual Registry — sigils and visual identity for roaming areas.
 *
 * Derives from each area's manufacturer influence, element bias, and
 * weapon bias to produce a distinctive sigil. Used by DashboardScreen
 * area cards and ActionScreenContextual area selectors.
 */
import type { RoamingAreaDef } from '@/constants/roamingAreas';
import { Element, Manufacturer, WeaponType } from '@/types/game';

export interface AreaVisual {
  id: string;
  sigil: string;
  color: string;
  accentColor: string;
  description: string;
}

/** Manufacturer → area color */
const MANUFACTURER_COLOR: Record<Manufacturer, string> = {
  [Manufacturer.Redline]: '#EF4444',
  [Manufacturer.Ironwood]: '#22C55E',
  [Manufacturer.BlastForge]: '#FF9000',
  [Manufacturer.Prismatek]: '#A855F7',
  [Manufacturer.ThrowTech]: '#06B6D4',
  [Manufacturer.HelixWorks]: '#3B82F6',
};

/** Element → accent */
const ELEMENT_ACCENT: Partial<Record<Element, string>> = {
  [Element.Fire]: '#FFEA3A',
  [Element.Shock]: '#A5F3FC',
  [Element.Corrosive]: '#C4FF2F',
  [Element.Cryo]: '#E0F2FE',
  [Element.Void]: '#FF9DF5',
  [Element.Kinetic]: '#F5F5F5',
};

function deriveAreaSigil(name: string): string {
  const words = name.split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase();
}

export const AREA_VISUALS: Record<string, AreaVisual> = {
  dustwaste_frontier: { id: 'dustwaste_frontier', sigil: 'DF', color: '#FF9000', accentColor: '#F5F5F5', description: 'Open scrapland. Balanced starter territory.' },
  redline_circuit: { id: 'redline_circuit', sigil: 'RC', color: '#EF4444', accentColor: '#FFEA3A', description: 'Burned highway loops. Speed and density.' },
  ironwood_bastion: { id: 'ironwood_bastion', sigil: 'IB', color: '#22C55E', accentColor: '#F5F5F5', description: 'Fortified ridge. Precision and elites.' },
  blastforge_yards: { id: 'blastforge_yards', sigil: 'BY', color: '#FF9000', accentColor: '#FFEA3A', description: 'Industrial breaker yards. Armor break and ordnance.' },
  prismatek_reactor: { id: 'prismatek_reactor', sigil: 'PR', color: '#A855F7', accentColor: '#FF9DF5', description: 'Leaking reactor. Elemental specialization.' },
  throwtech_dumpnet: { id: 'throwtech_dumpnet', sigil: 'TD', color: '#06B6D4', accentColor: '#A5F3FC', description: 'Hacked junk-grid. Utility and deployables.' },
  helixworks_labyrinth: { id: 'helixworks_labyrinth', sigil: 'HL', color: '#3B82F6', accentColor: '#FF9DF5', description: 'Shifting prototype complex. Modular gear and void.' },
};

export function getAreaVisual(areaId: string): AreaVisual {
  return AREA_VISUALS[areaId] ?? {
    id: areaId,
    sigil: deriveAreaSigil(areaId),
    color: '#B8B0A8',
    accentColor: '#34303A',
    description: 'Unknown territory.',
  };
}

/** Derive a visual from a RoamingAreaDef at runtime (for dynamic areas) */
export function deriveAreaVisual(area: RoamingAreaDef): AreaVisual {
  const existing = AREA_VISUALS[area.id];
  if (existing) return existing;

  const color = area.manufacturerInfluence !== 'Mixed'
    ? (MANUFACTURER_COLOR[area.manufacturerInfluence] ?? '#FF9000')
    : '#FF9000';
  const accentColor = area.elementBias && area.elementBias.length > 0
    ? (ELEMENT_ACCENT[area.elementBias[0]] ?? '#F5F5F5')
    : '#F5F5F5';

  return {
    id: area.id,
    sigil: deriveAreaSigil(area.name),
    color,
    accentColor,
    description: area.shortDescription,
  };
}
