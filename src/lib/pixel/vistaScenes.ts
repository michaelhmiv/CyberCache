/**
 * Vista scenes — plain-background scenes (owner ruling 2026-11-11,
 * superseding the V1 band stack).
 *
 * The eight scenes (7 roaming areas + camp) as DATA: each scene's
 * background is ONE adopted master painting — the Top-Choice Wave
 * 9.75 raw masters at shipping shape (BlastForge carries its
 * plain-bg re-roll, a ground-bearing repaint) — plus its ambient
 * element rows (vistaAmbientData.ts, normalized from the sets'
 * ambient-motion.json contracts). The V1 far/mid/near BAND layers
 * and their pan machinery are RETIRED: a vista background is a
 * plain painting, drawn full-bleed with the stage's existing
 * subtle cover drift, and the ambient elements ride on top on
 * their own motion specs. Per the Flexibility Law, a future scene
 * plugs in by adding a spec row here plus its ambient rows — the
 * renderers (PixelStage DOM, RoamPixiStage) read only this module.
 *
 * Each element's `layer` is its PAINT layer: 'far'/'mid'/'near'
 * paint behind the actors in that relative order, 'stage' paints
 * over them. (Under the retired band stack the same field named
 * the band whose canvas the element rode; the paint order is
 * unchanged.)
 */
import { VISTA_AMBIENT } from './vistaAmbientData';

export type VistaLayerId = 'far' | 'mid' | 'near';
export type VistaPaintLayer = VistaLayerId | 'stage';

export type VistaMotion =
  | { kind: 'drift'; dirX: number; dirY: number; speedPxS: number; wrapMarginPx: number; verticalDriftPx?: number; verticalPeriodS?: number; spinPeriodS?: number; wanderRangePx?: number }
  | { kind: 'rise'; speedPxS: number; risePx?: number; swayPx?: number; swayPeriodS?: number; envelope?: number }
  | { kind: 'wander'; rangePx: number; periodS: number; scalePulse?: { min: number; max: number; periodS: number }; skewDeg?: number; verticalDriftPx?: number; verticalPeriodS?: number; opacityRange?: [number, number]; opacityPeriodS?: number }
  | { kind: 'pulse'; periodS: number; scaleRange?: [number, number]; scaleYRange?: [number, number]; opacityRange?: [number, number]; yPx?: number; risePx?: number }
  | { kind: 'blink'; periodS: number; duty: number; jitterPx?: number }
  | { kind: 'traverse'; fromX: number; toX: number; durationMs: number; fadeEnds?: boolean; intervalMs: [number, number] }
  | { kind: 'field-drift'; dxPx: number; dyPx: number; durationMs: number; swayPx?: number; opacityRange?: [number, number]; fadeEnds?: boolean }
  | { kind: 'fall'; dyPx: number; durationMs: number; swayPx: number; intervalMs: [number, number] }
  | { kind: 'fountain'; burstMs: number; intervalMs: [number, number] }
  | { kind: 'drip'; dyPx: number; durationMs: number; intervalMs: [number, number] }
  | { kind: 'sweep'; angleDeg: [number, number]; durationMs: number }
  | { kind: 'flicker'; periodS: number; scaleYRange: [number, number]; opacityRange: [number, number]; skewDeg: number };

export interface VistaAmbientElement {
  id: string;
  spriteId: string;
  variants?: string[];
  /** Which paint pass draws it: a behind-actors layer ('far',
   *  'mid', 'near' — back to front) or 'stage' (free stage space,
   *  drawn over the actors). */
  layer: VistaPaintLayer;
  /** Anchors are stage design px (960x640): x = center, y =
   *  bottom edge. (Rows converted from the retired band space by
   *  the plain-bg landing keep the positions the band stack
   *  showed them at — see vistaAmbientData.ts.) */
  anchorSpace: 'stage';
  /** Anchor: x = center, y = bottom edge (for 'sweep', y = center). */
  x: number;
  y: number;
  anchors?: { x: number; y: number }[];
  phases?: number[];
  field?: { count: number; xFrac: [number, number]; yFrac: [number, number] };
  pivot?: 'center-bottom' | 'left-center';
  scale: number;
  opacity: number;
  flipX?: boolean;
  motion: VistaMotion;
}

export interface VistaSceneSpec {
  /** Scene id: the area id, or 'camp'. */
  id: string;
  /** The scene's one background painting (a manifest sprite id). */
  backgroundId: string;
  ambient: VistaAmbientElement[];
}

export const VISTA_STAGE_W = 960;
export const VISTA_STAGE_H = 640;

function areaScene(areaId: string, slug: string): VistaSceneSpec {
  return {
    id: areaId,
    backgroundId: `zone-${slug}-bg`,
    ambient: VISTA_AMBIENT[areaId] ?? [],
  };
}

export const VISTA_SCENES: Record<string, VistaSceneSpec> = {
  dustwaste_frontier: areaScene('dustwaste_frontier', 'dustwaste'),
  redline_circuit: areaScene('redline_circuit', 'redline'),
  ironwood_bastion: areaScene('ironwood_bastion', 'ironwood'),
  blastforge_yards: areaScene('blastforge_yards', 'blastforge'),
  prismatek_reactor: areaScene('prismatek_reactor', 'prismatek'),
  throwtech_dumpnet: areaScene('throwtech_dumpnet', 'throwtech'),
  helixworks_labyrinth: areaScene('helixworks_labyrinth', 'helixworks'),
};

/** Camp is the home/idle backdrop (authored in the Vista Pass by
 *  owner ruling): the idle diorama shows camp, not the current
 *  area. */
export const CAMP_VISTA_SCENE: VistaSceneSpec = {
  id: 'camp',
  backgroundId: 'camp-bg',
  ambient: VISTA_AMBIENT.camp ?? [],
};

const SCENE_BY_BACKGROUND = new Map<string, VistaSceneSpec>(
  [...Object.values(VISTA_SCENES), CAMP_VISTA_SCENE].map((s) => [s.backgroundId, s]),
);

/** The vista scene serving a background sprite id, or null when the
 *  background is not a vista scene (boss arenas keep their own art). */
export function vistaSceneForBackground(backgroundId: string | null | undefined): VistaSceneSpec | null {
  if (!backgroundId) return null;
  return SCENE_BY_BACKGROUND.get(backgroundId) ?? null;
}

export function vistaSceneForArea(areaId: string | null | undefined): VistaSceneSpec | null {
  if (!areaId) return null;
  return VISTA_SCENES[areaId] ?? null;
}
