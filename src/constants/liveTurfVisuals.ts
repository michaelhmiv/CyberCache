import { Element, Manufacturer } from '@/types/game';
import type { RoamingAreaDef } from '@/constants/roamingAreas';

export type LiveTurfSceneVisual = {
  id: string;
  skyTop: string;
  skyBottom: string;
  horizon: string;
  ground: string;
  groundDark: string;
  accent: string;
  enemyColor: string;
  enemyGlow: string;
  prop: 'scrap' | 'speedway' | 'bastion' | 'forge' | 'reactor' | 'dumpnet' | 'labyrinth';
  mood: string;
};

const DEFAULT_SCENE: LiveTurfSceneVisual = {
  id: 'dustwaste_frontier',
  skyTop: '#5B2E17',
  skyBottom: '#121017',
  horizon: '#FF9000',
  ground: '#8B5A2B',
  groundDark: '#2B1B14',
  accent: '#FFEA3A',
  enemyColor: '#D4A574', // warm tan — visible against brown ground (was #B8B0A8, clashed with Ironwood)
  enemyGlow: '#FF9000',
  prop: 'scrap',
  mood: 'open scrapland patrol',
};

export const LIVE_TURF_SCENES: Record<string, LiveTurfSceneVisual> = {
  dustwaste_frontier: DEFAULT_SCENE,
  redline_circuit: {
    id: 'redline_circuit',
    skyTop: '#551313',
    skyBottom: '#12070A',
    horizon: '#EF4444',
    ground: '#6D251D',
    groundDark: '#220B0B',
    accent: '#FFEA3A',
    enemyColor: '#EF4444',
    enemyGlow: '#FF4B5C',
    prop: 'speedway',
    mood: 'burned highway pursuit',
  },
  ironwood_bastion: {
    id: 'ironwood_bastion',
    skyTop: '#253819',
    skyBottom: '#080F09',
    horizon: '#22C55E',
    ground: '#50613A',
    groundDark: '#121A11',
    accent: '#B8B0A8',
    enemyColor: '#94A3B8', // cool slate — distinct from Dustwaste warm tan (was #A5A7B5)
    enemyGlow: '#22C55E',
    prop: 'bastion',
    mood: 'fortified ridge sightline',
  },
  blastforge_yards: {
    id: 'blastforge_yards',
    skyTop: '#682100',
    skyBottom: '#140A05',
    horizon: '#FF4B1F',
    ground: '#7A3A17',
    groundDark: '#241008',
    accent: '#FF9000',
    enemyColor: '#FF9000',
    enemyGlow: '#FFEA3A',
    prop: 'forge',
    mood: 'industrial breaker yard',
  },
  prismatek_reactor: {
    id: 'prismatek_reactor',
    skyTop: '#321B59',
    skyBottom: '#090914',
    horizon: '#A855F7',
    ground: '#3B2959',
    groundDark: '#130F20',
    accent: '#FF9DF5',
    enemyColor: '#A855F7',
    enemyGlow: '#06B6D4',
    prop: 'reactor',
    mood: 'unstable elemental leak',
  },
  throwtech_dumpnet: {
    id: 'throwtech_dumpnet',
    skyTop: '#0C4050',
    skyBottom: '#061017',
    horizon: '#06B6D4',
    ground: '#174558',
    groundDark: '#061921',
    accent: '#FFEA3A',
    enemyColor: '#06B6D4',
    enemyGlow: '#A5F3FC',
    prop: 'dumpnet',
    mood: 'hacked junk-grid signal trap',
  },
  helixworks_labyrinth: {
    id: 'helixworks_labyrinth',
    skyTop: '#123A67',
    skyBottom: '#060B18',
    horizon: '#3B82F6',
    ground: '#23385F',
    groundDark: '#081225',
    accent: '#A5F3FC',
    enemyColor: '#3B82F6',
    enemyGlow: '#8B5CF6',
    prop: 'labyrinth',
    mood: 'modular prototype maze',
  },
};

export const MANUFACTURER_SCENE_ACCENT: Record<Manufacturer, string> = {
  [Manufacturer.Redline]: '#EF4444',
  [Manufacturer.Ironwood]: '#22C55E',
  [Manufacturer.BlastForge]: '#FF9000',
  [Manufacturer.Prismatek]: '#A855F7',
  [Manufacturer.ThrowTech]: '#06B6D4',
  [Manufacturer.HelixWorks]: '#3B82F6',
};

export const ELEMENT_PROJECTILE: Record<Element, { color: string; glow: string; label: string }> = {
  [Element.Kinetic]: { color: '#F5F5F5', glow: '#B8B0A8', label: 'rounds' },
  [Element.Fire]: { color: '#FF4B1F', glow: '#FFEA3A', label: 'burn' },
  [Element.Shock]: { color: '#3B82F6', glow: '#A5F3FC', label: 'arc' },
  [Element.Corrosive]: { color: '#22C55E', glow: '#C4FF2F', label: 'acid' },
  [Element.Cryo]: { color: '#06B6D4', glow: '#E0F2FE', label: 'frost' },
  [Element.Void]: { color: '#8B5CF6', glow: '#FF9DF5', label: 'void' },
};

export function getLiveTurfScene(area: RoamingAreaDef): LiveTurfSceneVisual {
  const registered = LIVE_TURF_SCENES[area.id];
  if (registered) return registered;

  const manufacturerAccent = area.manufacturerInfluence !== 'Mixed'
    ? MANUFACTURER_SCENE_ACCENT[area.manufacturerInfluence]
    : DEFAULT_SCENE.accent;

  return {
    ...DEFAULT_SCENE,
    id: area.id,
    accent: manufacturerAccent,
    horizon: manufacturerAccent,
    mood: area.gameplayIdentity.toLowerCase(),
  };
}
