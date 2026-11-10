import { MOVEMENT, classifyTickBeat, type ActorPlacement, type CombatBeat } from './movement';
import { EASE, sampleTrack } from './pixiChoreography';
import { PART_POSES, type PartsPoseName } from './parts';
import { ENEMY_POSES, enemyRig, type RigDef, type RigPose } from './rig';
import { layoutPartSet, type PartSetLayout } from './partsCompositor';
import { partsAnchorPoint, partsWeaponFractionsFor } from './partsStage';
import { actorAnchorPoint } from './movement';
import { getMonster } from '@/constants/monsters';
import { areaVisuals, type AreaVisualIdentity } from '@/content/areaPalettes';
import { elementDialect, shotCadence, type ElementDialect, type ShotCadence } from './elementFx';
import { getPixelSprite, pixelEnemySpriteForArchetype, requirePixelSprite, type PixelSprite } from './manifest';
import { pixelWeaponInputFromWeapon } from './weaponCompositor';
import { gearDropFromEvent, lootRiseVisualForEvent, type LootRiseVisual } from './lootMoment';
import { Rarity } from '@/types/game';
import type { PartSetDef } from './parts';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { GearItem, Weapon } from '@/types/items';

/**
 * Roam choreography — the pure half of the Pixi roam stage (Motion
 * Reboot M2, 2026-11-07). Everything the DOM PixelSceneLayer derives
 * for mode 'roaming' is derived here from the same inputs, so the
 * Pixi renderer and its tests consume ONE derivation:
 *
 *  - the tick beat (classifyTickBeat — movement.ts, unmodified),
 *  - the hunter's pose for the beat and his parts layout,
 *  - the enemy: segmented band rig (current shipped art) with its
 *    ENEMY_POSES pose, or the area's bespoke elite flat,
 *  - FX anchors from the same layout/anchor math the DOM uses,
 *  - the element dialect + shot cadence for the beat FX,
 *  - the loot facts (rise visual / gear drop) — the rises and the
 *    LootMoment themselves STAY DOM (the pilot's split: the canvas
 *    carries actors + combat FX; loot ceremony is DOM), so this
 *    module only reports them for the overlay + tests.
 *
 * Beat tracks below are the DOM stage's own keyframe tables,
 * transcribed value-for-value (framer `animate` objects in
 * PixelSceneLayer / PixelStage / PixelFx): where the DOM reads a
 * MOVEMENT constant the sampler reads the same constant; where the
 * DOM uses a bare literal (the 220 ms shot settle, the 0.5 s kill
 * collapse, the 1.6 s loot rise) the literal is carried as the
 * DOM's value, named as such. Nothing here retimes anything.
 *
 * Presentation only — beats derive from tick events the Chef
 * already decided; nothing here produces gameplay outcomes.
 */

/** Roam placements — PixelSceneLayer's own constants. */
export const ROAM_HUNTER_PLACEMENT = { xPct: 22, heightPct: 57 } as const;
export const ROAM_ENEMY_PLACEMENT = { xPct: 66, heightPct: 66 } as const;

/**
 * Roam approach staging (animation fix iteration, 2026-11-10 —
 * the brief's Q3 item). The settle point above is where the enemy
 * ENDS its walk-in: 66% of stage width, moved in from the shipped
 * 74% so the fight's framing tightens (the hunter stands at 22%).
 * The walk-in itself starts off-frame right and travels the rest:
 * at walk progress p the enemy's live x offset from its settle
 * point is the approach below, eased by the renderers with the
 * same easeOut the walk-in has always used — the 850ms window
 * (MOVEMENT.WALK_IN_MS) and every Sample B timing are untouched;
 * only the staging geometry changed.
 *
 * Data, like every choreography tenant: spawnOffsetXPct is how far
 * right of the settle point the walk-in begins (stage-width %);
 * at p = 0 the enemy's feet anchor sits at xPct + spawnOffsetXPct
 * (66 + 24 = 90% — its body, ~41% of stage width at roam height,
 * reaches past the right edge: it enters FROM off-frame); at p = 1
 * the offset is 0, exactly the settle point.
 */
export const ROAM_APPROACH = { spawnOffsetXPct: 24 } as const;

/** The enemy's walk-in x offset at progress `p` (0..1), in
 *  stage-width %: the approach distance remaining. One derivation
 *  for both renderers (Pixi samples the eased offset per frame;
 *  the DOM rig wrapper animates between the same two endpoints)
 *  and for the walk-in tests. */
export function approachOffsetXPct(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return ROAM_APPROACH.spawnOffsetXPct * (1 - t);
}
/** Elite-event enemies stand taller (PixelSceneLayer: rig 72 / flat 74). */
export const ROAM_ELITE_RIG_HEIGHT_PCT = 72;
export const ROAM_ELITE_FLAT_HEIGHT_PCT = 74;

export interface RoamSceneInput {
  backgroundId: string;
  areaId: string;
  weapon?: Weapon;
  event?: TickEvent;
  targetMaxHp: number;
  currentTargetId?: string;
  hunterSet: PartSetDef;
}

export interface RoamSceneModel {
  groundY: number;
  beat: CombatBeat | null;
  isEliteEvent: boolean;
  eventPropId?: string;
  visuals: AreaVisualIdentity;
  dialect: ElementDialect;
  cadence: ShotCadence;
  hunterPoseName: PartsPoseName;
  hunterLayout: PartSetLayout;
  hunterPlacement: ActorPlacement;
  enemyPlacement: ActorPlacement;
  /** Segmented rig path (the standard roaming enemy). */
  rig?: RigDef;
  rigPose: RigPose;
  /** Flat path (elite-event areas with a bespoke elite sprite). */
  flatSpriteId?: string;
  enemySprite: PixelSprite;
  enemySpriteId: string;
  muzzle: { xPct: number; yPct: number };
  grip: { xPct: number; yPct: number };
  hunterMass: { xPct: number; yPct: number };
  enemyMass: { xPct: number; yPct: number };
  enemyFeet: { xPct: number; yPct: number };
  enemyLoot: { xPct: number; yPct: number };
  /** Loot facts for the DOM overlay (rises + LootMoment stay DOM). */
  lootRise: LootRiseVisual | null;
  dropItem: GearItem | null;
  shake?: { key: string; intensity: number; durationMs: number };
}

/** Derive the roam scene model — PixelSceneLayer's roaming
 *  derivations, line for line. */
export function deriveRoamScene(input: RoamSceneInput): RoamSceneModel {
  const background = getPixelSprite(input.backgroundId);
  const groundY = background?.anchors.groundLine?.y ?? 0.86;
  const beat = classifyTickBeat(input.event, input.targetMaxHp);
  const visuals = areaVisuals(input.areaId);
  const isEliteEvent =
    !!input.event &&
    (input.event.tone === 'event' || input.event.tone === 'event_major') &&
    input.event.family === 'elite';
  const eventProp =
    input.event && (input.event.tone === 'event' || input.event.tone === 'event_major') && input.event.propId
      ? getPixelSprite(input.event.propId)
      : undefined;
  const hunterPoseName: PartsPoseName =
    beat?.kind === 'shot' || beat?.kind === 'crit'
      ? 'recoil'
      : beat?.kind === 'playerHit'
        ? 'hit'
        : beat?.kind === 'kill'
          ? 'celebrate'
          : input.weapon
            ? 'aim'
            : 'relaxed';
  const hunterLayout = layoutPartSet(
    input.hunterSet,
    PART_POSES[hunterPoseName],
    input.weapon ? partsWeaponFractionsFor(pixelWeaponInputFromWeapon(input.weapon)) : undefined,
  );
  const targetArchetype = input.currentTargetId ? getMonster(input.currentTargetId)?.archetype : undefined;
  const flatSpriteId = isEliteEvent && visuals.eliteSpriteId ? visuals.eliteSpriteId : undefined;
  const enemySpriteId =
    (flatSpriteId ?? pixelEnemySpriteForArchetype(targetArchetype)) ?? 'brute';
  const enemySprite = getPixelSprite(enemySpriteId) ?? requirePixelSprite('brute');
  const hunterPlacement: ActorPlacement = { ...ROAM_HUNTER_PLACEMENT, groundY };
  const enemyPlacement: ActorPlacement = {
    ...ROAM_ENEMY_PLACEMENT,
    heightPct: flatSpriteId
      ? ROAM_ELITE_FLAT_HEIGHT_PCT
      : isEliteEvent
        ? ROAM_ELITE_RIG_HEIGHT_PCT
        : ROAM_ENEMY_PLACEMENT.heightPct,
    groundY,
  };
  const rigPose = isEliteEvent
    ? ENEMY_POSES.idle
    : beat?.kind === 'playerHit'
      ? ENEMY_POSES.lunge
      : beat?.kind === 'shot' || beat?.kind === 'crit'
        ? ENEMY_POSES.hit
        : beat?.kind === 'kill'
          ? ENEMY_POSES.death
          : ENEMY_POSES.idle;
  return {
    groundY,
    beat,
    isEliteEvent,
    eventPropId: eventProp?.id,
    visuals,
    dialect: elementDialect(input.weapon?.element),
    cadence: shotCadence(input.weapon?.weaponType, input.weapon?.attackSpeed),
    hunterPoseName,
    hunterLayout,
    hunterPlacement,
    enemyPlacement,
    rig: flatSpriteId ? undefined : enemyRig(isEliteEvent ? 'elite' : (targetArchetype ?? 'brute')),
    rigPose,
    flatSpriteId,
    enemySprite,
    enemySpriteId,
    muzzle: partsAnchorPoint(hunterLayout.joints.muzzle ?? hunterLayout.joints.grip, hunterPlacement),
    grip: partsAnchorPoint(hunterLayout.joints.grip, hunterPlacement),
    hunterMass: partsAnchorPoint(hunterLayout.joints.mass, hunterPlacement),
    enemyMass: actorAnchorPoint(enemySprite, 'centerMass', enemyPlacement),
    enemyFeet: actorAnchorPoint(enemySprite, 'feet', enemyPlacement),
    enemyLoot: actorAnchorPoint(enemySprite, 'lootPoint', enemyPlacement),
    lootRise: lootRiseVisualForEvent(input.event),
    dropItem: gearDropFromEvent(input.event),
    shake:
      beat && (beat.kind === 'shot' || beat.kind === 'crit' || beat.kind === 'kill') && input.event
        ? {
            key: input.event.id,
            intensity: beat.kind === 'crit' ? 7 : beat.kind === 'kill' ? 5 : 3,
            durationMs: beat.kind === 'crit' ? MOVEMENT.CRIT_SHAKE_MS : MOVEMENT.SHAKE_MS + 140,
          }
        : undefined,
  };
}

// ── Beat tracks (the DOM stage's keyframe tables, sampled) ──────────

export interface RoamBeatSample {
  /** Hunter wrapper (stage px offsets; scaleY unitless). */
  hunter: { x: number; y: number; scaleY: number };
  /** Enemy lunge wrapper x (stage px). */
  enemyLungeX: number;
  /** Enemy hit wrapper. */
  enemyHit: { scale: number; x: number; y: number; opacity: number };
}

/** The DOM's framer `ease` default for control-driven tracks. */
const FRAMER_EASE = EASE.ease;

/**
 * Sample the roam beat at beat-local time `tMs` — the exact tracks
 * PixelSceneLayer's animation controls run per beat kind:
 *
 *  - playerHit: hunter x [0,0,-26,-20,0] + scaleY [1,1,0.9,0.97,1]
 *    over TELEGRAPH+LUNGE+120 with times [0,.45,.6,.78,1]; enemy
 *    lunge x [0,0,-92,-72,0] over TELEGRAPH+LUNGE+140, times
 *    [0,.45,.62,.8,1] (framer px values ARE stage px here: the DOM
 *    wrappers are full-stage boxes, so 1 framer px = 1 stage px at
 *    any stage size — the values are NOT rescaled).
 *  - shot/crit: hunter x [0,-4,0] over 220ms (DOM literal); enemy
 *    scale [1,0.93,1.03,1] + x [0,9,-3,0] over HIT_REACTION_MS.
 *  - kill: hunter y [0,-9,0] over 420ms (DOM literal); enemy
 *    opacity [1,1,0], scale [1,1.05,0.5], y [0,0,24] over 500ms
 *    (DOM literal) easeIn.
 *  - loot: legendary → hunter y [0,-11,0] over LOOT_HOP_MS easeOut;
 *    otherwise everything settles to rest over 200ms (the caller
 *    eases from the previous sample — see sampleRoamBeat's
 *    `from` handling in the stage).
 *  - none/other: rest.
 */
export function sampleRoamBeat(beat: CombatBeat | null, tMs: number, event?: TickEvent): RoamBeatSample {
  const rest: RoamBeatSample = {
    hunter: { x: 0, y: 0, scaleY: 1 },
    enemyLungeX: 0,
    enemyHit: { scale: 1, x: 0, y: 0, opacity: 1 },
  };
  if (!beat) return rest;
  switch (beat.kind) {
    case 'playerHit': {
      const hunterSpec = {
        durationMs: MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 120,
        times: [0, 0.45, 0.6, 0.78, 1],
        ease: FRAMER_EASE,
      };
      const lungeSpec = {
        durationMs: MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 140,
        times: [0, 0.45, 0.62, 0.8, 1],
        ease: FRAMER_EASE,
      };
      return {
        hunter: {
          x: sampleTrack(tMs, { ...hunterSpec, keys: [0, 0, -26, -20, 0] }),
          y: 0,
          scaleY: sampleTrack(tMs, { ...hunterSpec, keys: [1, 1, 0.9, 0.97, 1] }),
        },
        enemyLungeX: sampleTrack(tMs, { ...lungeSpec, keys: [0, 0, -92, -72, 0] }),
        enemyHit: rest.enemyHit,
      };
    }
    case 'shot':
    case 'crit':
      return {
        hunter: { x: sampleTrack(tMs, { keys: [0, -4, 0], durationMs: 220, ease: FRAMER_EASE }), y: 0, scaleY: 1 },
        enemyLungeX: 0,
        enemyHit: {
          scale: sampleTrack(tMs, { keys: [1, 0.93, 1.03, 1], durationMs: MOVEMENT.HIT_REACTION_MS, ease: FRAMER_EASE }),
          x: sampleTrack(tMs, { keys: [0, 9, -3, 0], durationMs: MOVEMENT.HIT_REACTION_MS, ease: FRAMER_EASE }),
          y: 0,
          opacity: 1,
        },
      };
    case 'kill':
      return {
        hunter: {
          x: 0,
          y: sampleTrack(tMs, { keys: [0, -9, 0], durationMs: 420, ease: FRAMER_EASE }),
          scaleY: 1,
        },
        enemyLungeX: 0,
        enemyHit: {
          scale: sampleTrack(tMs, { keys: [1, 1.05, 0.5], durationMs: 500, ease: EASE.easeIn }),
          x: 0,
          y: sampleTrack(tMs, { keys: [0, 0, 24], durationMs: 500, ease: EASE.easeIn }),
          opacity: sampleTrack(tMs, { keys: [1, 1, 0], durationMs: 500, ease: EASE.easeIn }),
        },
      };
    case 'loot':
      if (event?.gear?.rarity === Rarity.Legendary) {
        return {
          hunter: {
            x: 0,
            y: sampleTrack(tMs, { keys: [0, -11, 0], durationMs: MOVEMENT.LOOT_HOP_MS, ease: EASE.easeOut }),
            scaleY: 1,
          },
          enemyLungeX: 0,
          enemyHit: rest.enemyHit,
        };
      }
      return rest;
    default:
      return rest;
  }
}

/** The longest any beat track runs — after this the stage is at
 *  rest until the next event. (playerHit's lunge tail is longest.) */
export const ROAM_BEAT_MAX_MS = MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 140;

/** Pre-allocated FX pools of the roam stage (nothing spawns). */
export const ROAM_POOL_CAPS = {
  /** Impact sparks per burst (the DOM kit's fan size). */
  sparks: 6,
  /** Tracers — the widest cadence (SMG) fires 4. */
  tracers: 4,
  /** Ambient embers (movement law EMBER_COUNT). */
  embers: MOVEMENT.EMBER_COUNT,
  /** One-shot FX sprites: muzzle, casing, hit flash, telegraph,
   *  red flash, dust ring, status overlay. */
  oneShots: 7,
} as const;

/**
 * Animated-node accounting for the roam scene, on the pilot's
 * formula (pixiAnimatedNodeCount: actor sprites + pooled FX;
 * containers and static sprites — vista plates, the vehicle, the
 * event prop — are not animated nodes). HONEST RESULT: the roam
 * scene counts HIGHER than the boss fight's 40 (53 at full dress:
 * 11 parts + weapon + 6 gear mounts + 4 rig segments against
 * 6+4+14+7 pooled FX) — because the DOM scene it replaces animates
 * at least as many framer-driven elements (14 embers, 11 part
 * layers, gear layers, rig segments, the whole FX kit as separate
 * DOM nodes). The Pixi scene is one canvas with pooled sprites and
 * no per-frame allocation; the count is reported, not trimmed —
 * trimming it would mean dropping scene elements the DOM shows,
 * which is a behavior change, not an optimization.
 */
export function roamAnimatedNodeCount(opts: { partCount: number; gearCount: number; armed: boolean; enemySegments: number; vista?: boolean }): number {
  const actors = opts.partCount + (opts.armed ? 1 : 0) + opts.gearCount + opts.enemySegments;
  // V1 vista scenes: the procedural ember pool stands down (the
  // authored ambient sets carry the ember life) and the four
  // ambient canvas sprites join the count; the band wrap pairs are
  // vista dressing like the plates they replace. Full dress on a
  // vista scene: 22 actors + 6 + 4 + 0 + 7 + 4 = 43 (vs 53 for the
  // painting stack) — reported, not trimmed, same as ever.
  const embers = opts.vista ? 0 : ROAM_POOL_CAPS.embers;
  const vistaAmbient = opts.vista ? 4 : 0;
  return actors + ROAM_POOL_CAPS.sparks + ROAM_POOL_CAPS.tracers + embers + ROAM_POOL_CAPS.oneShots + vistaAmbient;
}
