import type { PaletteSpec } from '@/lib/pixel/paletteSwap';

/** The seven roaming area ids (roamingAreas.ts keys them as strings;
 *  this union is the visual layer's typed view of the same set). */
export type RoamingAreaId =
  | 'dustwaste_frontier'
  | 'redline_circuit'
  | 'ironwood_bastion'
  | 'blastforge_yards'
  | 'prismatek_reactor'
  | 'throwtech_dumpnet'
  | 'helixworks_labyrinth';

/**
 * Per-area visual identity (visual overhaul brief §4.4/§4.5) — the one
 * table the stage, the enemy palette swaps, and the golden scenes all
 * read: sky tint, weather system, animated props, the enemy palette
 * (archetype art re-hued to the area + one signature part overlay),
 * and the area's named elite (Q5: bespoke sprite only in Dustwaste;
 * the rest are palette-variant elites under these names).
 */
export interface AreaVisualIdentity {
  areaId: RoamingAreaId;
  /** CSS color multiplied over the sky band of the stage. */
  skyTint: string;
  weather: 'dust' | 'heat' | 'spores' | 'sparks' | 'shimmer' | 'static' | 'drift';
  /** Animated prop sprite ids drifting on the stage (≤2 per scene). */
  animatedProps: string[];
  enemyPalette: PaletteSpec;
  /** Small signature-part overlay sprite worn by the area's enemies. */
  signaturePartId: string;
  eliteName: string;
  /** Bespoke elite sprite where one exists (Dustwaste, Q5). */
  eliteSpriteId?: string;
}

export const AREA_VISUALS: Record<RoamingAreaId, AreaVisualIdentity> = {
  dustwaste_frontier: {
    areaId: 'dustwaste_frontier',
    skyTint: '#f2c063',
    weather: 'dust',
    animatedProps: ['aprop-dust-sheet', 'aprop-tumbleweed'],
    enemyPalette: { hueShiftDeg: 18, saturationScale: 1.1, accent: [217, 164, 65], accentBlend: 0.3 },
    signaturePartId: 'aprop-tumbleweed',
    eliteName: 'Silt Marshal',
    eliteSpriteId: 'elite-silt-marshal',
  },
  redline_circuit: {
    areaId: 'redline_circuit',
    skyTint: '#e2483d',
    weather: 'heat',
    animatedProps: ['aprop-light-trail', 'aprop-exhaust-plume'],
    enemyPalette: { hueShiftDeg: -38, saturationScale: 1.15, accent: [226, 72, 61], accentBlend: 0.35 },
    signaturePartId: 'aprop-light-trail',
    eliteName: 'Pursuit Prime',
  },
  ironwood_bastion: {
    areaId: 'ironwood_bastion',
    skyTint: '#7fb069',
    weather: 'spores',
    animatedProps: ['aprop-spore-mote', 'aprop-searchlight'],
    enemyPalette: { hueShiftDeg: 62, saturationScale: 1.05, accent: [127, 176, 105], accentBlend: 0.3 },
    signaturePartId: 'aprop-spore-mote',
    eliteName: 'Thornwarden',
  },
  blastforge_yards: {
    areaId: 'blastforge_yards',
    skyTint: '#ff7a1a',
    weather: 'sparks',
    animatedProps: ['aprop-forge-glow', 'aprop-spark-fountain'],
    enemyPalette: { hueShiftDeg: -12, saturationScale: 1.2, accent: [255, 122, 26], accentBlend: 0.4 },
    signaturePartId: 'aprop-spark-fountain',
    eliteName: 'Slag Herald',
  },
  prismatek_reactor: {
    areaId: 'prismatek_reactor',
    skyTint: '#39d0d8',
    weather: 'shimmer',
    animatedProps: ['aprop-prism-shard', 'aprop-core-glow'],
    enemyPalette: { hueShiftDeg: 168, saturationScale: 1.1, accent: [57, 208, 216], accentBlend: 0.35 },
    signaturePartId: 'aprop-prism-shard',
    eliteName: 'Phase Revenant',
  },
  throwtech_dumpnet: {
    areaId: 'throwtech_dumpnet',
    skyTint: '#9be15d',
    weather: 'static',
    animatedProps: ['aprop-drone', 'aprop-signal-blink'],
    enemyPalette: { hueShiftDeg: 84, saturationScale: 0.95, accent: [155, 225, 93], accentBlend: 0.3 },
    signaturePartId: 'aprop-drone',
    eliteName: 'Heap Warden',
  },
  helixworks_labyrinth: {
    areaId: 'helixworks_labyrinth',
    skyTint: '#b18cff',
    weather: 'drift',
    animatedProps: ['aprop-pod-bubbles', 'aprop-holo-diagram'],
    enemyPalette: { hueShiftDeg: 238, saturationScale: 1.05, accent: [177, 140, 255], accentBlend: 0.35 },
    signaturePartId: 'aprop-holo-diagram',
    eliteName: 'Specimen Zero',
  },
};

export function areaVisuals(areaId: string): AreaVisualIdentity {
  return AREA_VISUALS[areaId as RoamingAreaId] ?? AREA_VISUALS.dustwaste_frontier;
}

/** Unique boss arenas (Q3 ruling): every boss fights in its own arena;
 *  the home area informs palette only. Kills BossFightStage's old
 *  hard-coded Dustwaste background. */
export const PIXEL_BOSS_ARENAS: Record<string, { backgroundId: string; propId: string }> = {
  dune_tyrant: { backgroundId: 'arena-dune-tyrant', propId: 'arena-prop-monolith' },
  siltstalker: { backgroundId: 'arena-siltstalker', propId: 'arena-prop-skimmer-wreck' },
  heap_guard: { backgroundId: 'arena-heap-guard', propId: 'arena-prop-compactor-jaw' },
  ashgut: { backgroundId: 'arena-ashgut', propId: 'arena-prop-furnace-gate' },
  mirage_duster: { backgroundId: 'arena-mirage-duster', propId: 'arena-prop-toll-gantry' },
  rust_prophet: { backgroundId: 'arena-rust-prophet', propId: 'arena-prop-heartwood-gate' },
  scrap_bishop: { backgroundId: 'arena-scrap-bishop', propId: 'arena-prop-holo-dais' },
  spinneret_widow: { backgroundId: 'arena-spinneret-widow', propId: 'arena-prop-web-anchor' },
  mnemosyne_mirror: { backgroundId: 'arena-mnemosyne-mirror', propId: 'arena-prop-prism-spire' },
  static_choir: { backgroundId: 'arena-static-choir', propId: 'arena-prop-dish-array' },
  verdant_maw: { backgroundId: 'arena-verdant-maw', propId: 'arena-prop-ember-heart' },
  sister_null: { backgroundId: 'arena-sister-null', propId: 'arena-prop-rift-shard' },
  vaultkeeper_omega: { backgroundId: 'arena-vaultkeeper-omega', propId: 'arena-prop-vault-wheel' },
};

export function bossArena(bossId: string | undefined): { backgroundId: string; propId: string } {
  if (bossId && PIXEL_BOSS_ARENAS[bossId]) return PIXEL_BOSS_ARENAS[bossId];
  return PIXEL_BOSS_ARENAS.dune_tyrant;
}
