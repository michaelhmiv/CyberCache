/**
 * Vista scenes — Full Visual Program V1 landing.
 *
 * The eight authored vista sets (7 roaming areas + camp) as DATA:
 * band sprite ids, pan speeds per layer, and ambient element rows
 * (vistaAmbientData.ts, generated from the sets' ambient-motion.json
 * contracts). Per the Flexibility Law, a future scene plugs in by
 * adding a spec row here plus its ambient rows — the renderers
 * (PixelStage DOM, RoamPixiStage) read only this module.
 *
 * Band geometry: authored bands are 1440 design-px wide (1.5x the
 * 960 stage) and tile seamlessly on x. The stage displays them
 * height-fit into the PixelStage layer slots (far/mid/near) and the
 * roam scene pans across the band field; at pan 0 the band's center
 * crop shows, matching the old object-cover framing the sets were
 * composed for.
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
  /** Which paint pass draws it: its band layer, or 'stage' (free
   *  stage space, drawn over the actors). */
  layer: VistaPaintLayer;
  /** 'stage': x/y are stage design px. 'band': x/y live in the
   *  band's native 1440-wide design space and ride the pan. */
  anchorSpace: 'stage' | 'band';
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
  backgroundId: string;
  layers: Record<VistaLayerId, string>;
  /** Pan speed per layer, design px per second of roaming. The
   *  0.25 / 0.55 / 1.0 parallax ratios are the sets' proven pan
   *  model; the absolute scale is data so a scene can retune. */
  panPxS: Record<VistaLayerId, number>;
  ambient: VistaAmbientElement[];
}

export const VISTA_STAGE_W = 960;
export const VISTA_STAGE_H = 640;
/** Authored band width in design px (1.5x the stage width). */
export const VISTA_BAND_W = 1440;

/** Layer slots, matching the PixelStage strips and the sets' proof
 *  stack exactly: top/height as fractions of stage height, plus the
 *  band's native design height (band file px x texel). */
export const VISTA_LAYER_SLOTS: Record<VistaLayerId, { topFrac: number; heightFrac: number; bandH: number }> = {
  far: { topFrac: 0, heightFrac: 0.62, bandH: 288 },
  mid: { topFrac: 0.36, heightFrac: 0.52, bandH: 280 },
  near: { topFrac: 0.7, heightFrac: 0.32, bandH: 180 },
};

const DEFAULT_PAN: Record<VistaLayerId, number> = { far: 2.5, mid: 5.5, near: 10 };
const NO_PAN: Record<VistaLayerId, number> = { far: 0, mid: 0, near: 0 };

function areaScene(areaId: string, slug: string): VistaSceneSpec {
  return {
    id: areaId,
    backgroundId: `zone-${slug}-bg`,
    layers: { far: `zone-${slug}-far`, mid: `zone-${slug}-mid`, near: `zone-${slug}-near` },
    panPxS: { ...DEFAULT_PAN },
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
 *  area. It never pans. */
export const CAMP_VISTA_SCENE: VistaSceneSpec = {
  id: 'camp',
  backgroundId: 'camp-bg',
  layers: { far: 'camp-far', mid: 'camp-mid', near: 'camp-near' },
  panPxS: { ...NO_PAN },
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

/** Display scale of a band in its slot: slot height / native height. */
export function vistaBandDisplayScale(layer: VistaLayerId): number {
  const slot = VISTA_LAYER_SLOTS[layer];
  return (VISTA_STAGE_H * slot.heightFrac) / slot.bandH;
}

/** Displayed band width in stage design px. */
export function vistaBandDisplayW(layer: VistaLayerId): number {
  return VISTA_BAND_W * vistaBandDisplayScale(layer);
}

/** Pan offset (design px) at which the band's center crop shows —
 *  the rest framing every set was composed for. */
export function vistaBandRestOffset(layer: VistaLayerId): number {
  return (vistaBandDisplayW(layer) - VISTA_STAGE_W) / 2;
}

/** Unbounded pan offset for a layer after panMs of roaming. The
 *  renderers wrap it by the displayed band width. */
export function vistaPanOffsetPx(scene: VistaSceneSpec, layer: VistaLayerId, panMs: number): number {
  return vistaBandRestOffset(layer) + (scene.panPxS[layer] * panMs) / 1000;
}

export function vistaPanOffsets(scene: VistaSceneSpec, panMs: number): Record<VistaLayerId, number> {
  return {
    far: vistaPanOffsetPx(scene, 'far', panMs),
    mid: vistaPanOffsetPx(scene, 'mid', panMs),
    near: vistaPanOffsetPx(scene, 'near', panMs),
  };
}
