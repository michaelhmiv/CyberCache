import { MOVEMENT, classifyTickBeat, type ActorPlacement, type CombatBeat } from './movement';
import { STRIDE_SPECS, sampleStride, type StrideSpec } from './strideCycle';
import { EASE, sampleTrack } from './pixiChoreography';
import { PART_POSES, type PartsPoseName } from './parts';
import { ENEMY_POSES, enemyRig, type RigDef, type RigPose } from './rig';
import { layoutPartSet, type PartSetLayout } from './partsCompositor';
import { partsAnchorPoint, partsWeaponFractionsFor } from './partsStage';
import { actorAnchorPoint } from './movement';
import { getMonster, type MonsterArchetype } from '@/constants/monsters';
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

/** Roam placements — PixelSceneLayer's own constants. The hunter
 *  sits at 12% since capture-pass round 2 (2026-11-13): the
 *  hunter's extended rifle tip measures 57.6% of stage width from
 *  the 18% mark, which left every archetype short of the ≥12%
 *  rest-air law; the −6 shift buys all of them +6 air at once. */
export const ROAM_HUNTER_PLACEMENT = { xPct: 12, heightPct: 57 } as const;
export const ROAM_ENEMY_PLACEMENT = { xPct: 78, heightPct: 58 } as const;

/**
 * Per-archetype settle overrides (stage-iteration capture pass,
 * 2026-11-13). Measured on the capture rig (darkness-scan band
 * scans + grounding, cross-checked against sprite alpha math;
 * track logs arch-runner / arch-sniper): the hunter's rifle tip
 * is a stage constant at 57.6% from the old 18% hunter mark.
 * At the shared 78/58 settle the fodder front measures 65.2%
 * (air 7.6%) and the brute front 68.0% (air 10.4%) — both short
 * of the ≥12% law — the runner's forward-leaning rig puts its
 * head at ≈51%, and the sniper's own rifle muzzle reaches ≈67%
 * (crossed rifles). Round 1 (runner {82, 50}, sniper {86})
 * captured: sniper front 74.6–75.7% → air ≈17% PASS; runner
 * front only 58.8–59.7% — its sprite is 47.4% of stage wide at
 * h58 with 43.4% of that width right of its feet anchor, so no
 * in-stage placement of the runner alone reaches the law.
 * Round 2 therefore pairs the hunter shift above (tip → ≈51.6%)
 * with a runner settle of {84, 44} (predicted front ≈64%, air
 * ≈12.4%, right edge ≈99.6%). Every other archetype keeps the
 * shared mark, the elite staging (rig 72 / flat 74) is
 * untouched, and no timing changes anywhere.
 */
export const ROAM_ARCHETYPE_PLACEMENT_OVERRIDES: Partial<
  Record<MonsterArchetype, { xPct?: number; heightPct?: number }>
> = {
  runner: { xPct: 84, heightPct: 44 },
  sniper: { xPct: 86 },
};

/** The effective roam settle for an archetype: the shared mark
 *  with any per-archetype override applied. One derivation — the
 *  scene model, the DOM diorama and the target HP plate all read
 *  it, so the renderers cannot drift apart on a re-stage. */
export function roamEnemyPlacementFor(
  archetype: MonsterArchetype | undefined,
): { xPct: number; heightPct: number } {
  const override = archetype ? ROAM_ARCHETYPE_PLACEMENT_OVERRIDES[archetype] : undefined;
  return {
    xPct: override?.xPct ?? ROAM_ENEMY_PLACEMENT.xPct,
    heightPct: override?.heightPct ?? ROAM_ENEMY_PLACEMENT.heightPct,
  };
}

/**
 * Roam approach staging. The settle point above is where the enemy
 * ENDS its walk-in. History: the fight originally settled at 74%;
 * the 2026-11-10 animation fix iteration moved the settle in to
 * 66% (hunter at 22%) so the framing tightened on both ends. The
 * 2026-11-12 stage-iteration program supersedes that staging on
 * the owner's directive: measured on captures, at 66% the hunter's
 * extended weapon crossed INTO the enemy silhouette at rest and
 * the figures read face-to-face. The settle now stands at 78% with
 * the enemy frame at 58% height and the hunter at 18%, restoring
 * clear air between the silhouettes at rest (the program's ≥12%
 * rest-gap criterion, measured per archetype in its iteration
 * logs). The walk-in itself still starts off-frame right and
 * travels the rest: at walk progress p the enemy's live x offset
 * from its settle point is the approach below, eased by the
 * renderers with the same easeOut the walk-in has always used —
 * the 850ms window (MOVEMENT.WALK_IN_MS) and every Sample B
 * timing are untouched; only the staging geometry changed.
 *
 * Data, like every choreography tenant: spawnOffsetXPct is how far
 * right of the settle point the walk-in begins (stage-width %);
 * at p = 0 the enemy's feet anchor sits at xPct + spawnOffsetXPct
 * (78 + 24 = 102% — past the right edge: it enters FROM off-frame);
 * at p = 1 the offset is 0, exactly the settle point.
 */
export const ROAM_APPROACH = {
  spawnOffsetXPct: 24,
  /** How strongly the stride's channels drive the enemy rig's
   *  bands during the walk (the rig's bands are coarse body
   *  segments; the hunter's 6.5° thigh swing reads subtler
   *  through them, so the walk carries the swing at 1.6×). */
  rigStrideScale: 1.6,
} as const;

/** The enemy's walk-in x offset at progress `p` (0..1), in
 *  stage-width %: the approach distance remaining. One derivation
 *  for both renderers (Pixi samples the eased offset per frame;
 *  the DOM rig wrapper animates between the same two endpoints)
 *  and for the walk-in tests. */
export function approachOffsetXPct(p: number): number {
  const t = Math.max(0, Math.min(1, p));
  return ROAM_APPROACH.spawnOffsetXPct * (1 - t);
}

/**
 * Sample the enemy's presentation at walk-local time `tMs` —
 * the ONE walk-in derivation both renderers consume (animation
 * fix iteration, 2026-11-10). Pixi samples it per rAF frame; the
 * DOM rig wrapper's keyframes and the flat entrance are built
 * from the same numbers at their keyframe instants.
 *
 * Channels:
 *  - offsetXPct: the approach slide — eased (easeOut, the walk's
 *    shipped ease) from the spawn offset to 0 across the window.
 *  - deltaX: a whole-body sway in rig-frame px, phase-locked
 *    opposite the leg swing — weight shifting over the planted
 *    foot; the strongest interior-motion cue of the three.
 *  - poseDelta: the rig's segments articulate through the walk
 *    on the stride's phase clock — the SAME channels the hunter's
 *    stride composes (thigh/shin swing + lift + bob from
 *    sampleStride), keyed to the rig's segment ids and scaled by
 *    ROAM_APPROACH.rigStrideScale (the enemy rig's segments are
 *    body bands, not the hunter's skeleton slots, so the mapping
 *    is by shape: legs swing, body bobs — the base/body bands
 *    carry the swing, the arm band counter-swings lightly, the
 *    head band steadies). Amplitude is the approach envelope
 *    itself: full through the travel, released as the slide
 *    settles — at progress 1 the delta is EXACTLY rest, so the
 *    arrival pose is the beat system's pose, untouched.
 */
export function sampleEnemyWalkPose(
  tMs: number,
  strideSpec: StrideSpec = STRIDE_SPECS.stride,
): { offsetXPct: number; deltaX: number; poseDelta: RigPose } {
  const p = Math.max(0, Math.min(1, tMs / MOVEMENT.WALK_IN_MS));
  const eased = EASE.easeOut(p);
  const frame = sampleStride(strideSpec, Math.max(0, tMs), 1);
  const fade = 1 - EASE.easeOut(Math.max(0, (p - 0.8) / 0.2));
  const k = ROAM_APPROACH.rigStrideScale * fade;
  const d = frame.poseDelta;
  const thighF = (d.thighF?.rotate ?? 0) * k;
  const thighB = (d.thighB?.rotate ?? 0) * k;
  const liftF = (d.lowerLegF?.y ?? 0) * k;
  const liftB = (d.lowerLegB?.y ?? 0) * k;
  const bobY = (d.torso?.y ?? 0) * k;
  const swing = (thighF - thighB) / 2;
  return {
    offsetXPct: approachOffsetXPct(eased),
    deltaX: swing * 0.6,
    poseDelta: {
      base: { rotate: swing, y: bobY + Math.min(liftF, liftB) },
      body: { rotate: swing * 0.7, y: bobY },
      arm: { rotate: -swing * 0.5, y: bobY * 0.6 },
      head: { rotate: -swing * 0.25 },
    },
  };
}
/** Elite-event enemies stand taller (PixelSceneLayer: rig 72 / flat 74). */
export const ROAM_ELITE_RIG_HEIGHT_PCT = 72;
export const ROAM_ELITE_FLAT_HEIGHT_PCT = 74;

const PLAYER_HIT_POSE_MS = MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 140;

/** Actor recovery uses the existing motion law; reward/FX clocks are unchanged. */
export function roamPoseRecoveryTimes(beat: CombatBeat | null): number[] {
  if (beat?.kind === 'shot' || beat?.kind === 'crit') {
    return [MOVEMENT.SEGMENT.RECOIL_RECOVER_MS, MOVEMENT.HIT_REACTION_MS];
  }
  if (beat?.kind === 'playerHit') return [PLAYER_HIT_POSE_MS];
  if (beat?.kind === 'kill') return [MOVEMENT.HIT_REACTION_MS];
  return [];
}

export function roamPosesAt(beat: CombatBeat | null, armed: boolean, elapsedMs: number) {
  const ready: PartsPoseName = armed ? 'aim' : 'relaxed';
  let hunter: PartsPoseName = ready;
  let enemy: keyof typeof ENEMY_POSES = 'idle';
  if (beat?.kind === 'shot' || beat?.kind === 'crit') {
    if (elapsedMs < MOVEMENT.SEGMENT.RECOIL_RECOVER_MS) hunter = 'recoil';
    if (elapsedMs < MOVEMENT.HIT_REACTION_MS) enemy = 'hit';
  } else if (beat?.kind === 'playerHit' && elapsedMs < PLAYER_HIT_POSE_MS) {
    hunter = 'hit';
    enemy = 'lunge';
  } else if (beat?.kind === 'kill') {
    if (elapsedMs < MOVEMENT.HIT_REACTION_MS) hunter = 'celebrate';
    enemy = 'death';
  }
  return { hunter, enemy, key: `${hunter}|${enemy}` };
}

export interface RoamSceneInput {
  backgroundId: string;
  areaId: string;
  weapon?: Weapon;
  event?: TickEvent;
  targetMaxHp: number;
  currentTargetId?: string;
  hunterSet: PartSetDef;
  /** Walk-in-local ms (0 at the target spawn) while the enemy is
   *  still walking in; undefined once settled. Supplied by the
   *  renderers from their own walk clocks (Pixi's walk state,
   *  the DOM diorama's rAF driver) — the model folds the stride
   *  articulation into the rig pose for exactly this span. */
  walkMs?: number;
  /** Local presentation age; omitted means the event's first frame. */
  beatElapsedMs?: number;
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
  poseKey: string;
  hunterLayout: PartSetLayout;
  hunterPlacement: ActorPlacement;
  enemyPlacement: ActorPlacement;
  /** Segmented rig path (the standard roaming enemy). */
  rig?: RigDef;
  rigPose: RigPose;
  /** The live walk state the pose was derived with: the walk-in's
   *  offset (stage-width %) and sway at derivation time — the
   *  renderers place the walk wrapper from the same sample, so
   *  pose and position can never disagree. Null once settled. */
  enemyWalk: { offsetXPct: number; deltaX: number } | null;
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
  const poses = roamPosesAt(beat, !!input.weapon, input.beatElapsedMs ?? 0);
  const hunterPoseName = poses.hunter;
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
  // Elite staging keeps the shared mark exactly (its heights
  // below); the plain path reads the per-archetype settle.
  const enemyBase = isEliteEvent ? ROAM_ENEMY_PLACEMENT : roamEnemyPlacementFor(targetArchetype);
  const enemyPlacement: ActorPlacement = {
    ...enemyBase,
    heightPct: flatSpriteId
      ? ROAM_ELITE_FLAT_HEIGHT_PCT
      : isEliteEvent
        ? ROAM_ELITE_RIG_HEIGHT_PCT
        : enemyBase.heightPct,
    groundY,
  };
  const beatRigPose = isEliteEvent ? ENEMY_POSES.idle : ENEMY_POSES[poses.enemy];
  // Walk-articulation blend (sampleEnemyWalkPose): while the
  // walk-in runs, the stride delta composes ONTO the beat pose
  // (rotations/offsets sum, the pose system's own semantics) —
  // a beat landing mid-walk plays its pose THROUGH the gait
  // instead of freezing it. Elite events keep the plain pose
  // (their entrance is the drop/flat path's own).
  return withRoamWalkFrame({
    groundY,
    beat,
    isEliteEvent,
    eventPropId: eventProp?.id,
    visuals,
    dialect: elementDialect(input.weapon?.element),
    cadence: shotCadence(input.weapon?.weaponType, input.weapon?.attackSpeed),
    hunterPoseName,
    poseKey: poses.key,
    hunterLayout,
    hunterPlacement,
    enemyPlacement,
    rig: flatSpriteId ? undefined : enemyRig(isEliteEvent ? 'elite' : (targetArchetype ?? 'brute')),
    rigPose: beatRigPose,
    enemyWalk: null,
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
  }, input.walkMs);
}

/** Compose only the moving rig bands; reuse the cached hunter layout and FX geometry. */
export function withRoamWalkFrame(model: RoamSceneModel, walkMs?: number): RoamSceneModel {
  if (model.isEliteEvent || model.flatSpriteId || walkMs === undefined || walkMs >= MOVEMENT.WALK_IN_MS) return model;
  const walk = sampleEnemyWalkPose(walkMs);
  const rigPose = Object.fromEntries(
    [...new Set([...Object.keys(model.rigPose), ...Object.keys(walk.poseDelta)])].map((segId) => {
      const b = model.rigPose[segId] ?? {};
      const d = walk.poseDelta[segId] ?? {};
      return [segId, {
        rotate: (b.rotate ?? 0) + (d.rotate ?? 0),
        x: (b.x ?? 0) + (d.x ?? 0) + (segId === 'base' ? walk.deltaX : 0),
        y: (b.y ?? 0) + (d.y ?? 0),
        ...(b.opacity !== undefined ? { opacity: b.opacity } : {}),
      }];
    }),
  );
  return { ...model, rigPose, enemyWalk: { offsetXPct: walk.offsetXPct, deltaX: walk.deltaX } };
}

/** One target's walk-in clock: which target key the clock belongs
 *  to and when (renderer wall-clock ms) its approach began. */
export interface RoamWalkState {
  targetKey: string;
  startMs: number;
}

/**
 * Resolve one frame of the enemy walk-in from STATE — the seam
 * that keeps the enemy's presence a function of the current
 * target, not of having witnessed a transition:
 *
 *  - a target key that differs from the clock's (a fresh spawn,
 *    or the stage's very first frame for a target that was
 *    already active when the stage mounted) starts a new clock
 *    at `now` — the enemy walks in even if the encounter began
 *    before the stage existed;
 *  - inside the window, `walkMs` is the live walk-local time the
 *    model is derived with;
 *  - at/after the window — including after an arbitrarily long
 *    gap (tab hidden, ticker paused) — `walkMs` is `undefined`:
 *    the SETTLED derivation (`enemyWalk: null`, offset 0, alpha
 *    1). The walk never restarts for the same target and the
 *    spawn frame is never a resting state. That is the DOM
 *    stage's semantics (its framer wrapper holds the animate end
 *    state, x 0% / opacity 1, after the walk-in completes).
 *
 * Pure: the renderers own the clock storage, this owns the rule.
 */
export function resolveRoamWalkFrame(
  prev: RoamWalkState | null,
  targetKey: string,
  now: number,
): { walk: RoamWalkState; walkMs: number | undefined } {
  const walk = prev && prev.targetKey === targetKey ? prev : { targetKey, startMs: now };
  const elapsedMs = now - walk.startMs;
  return { walk, walkMs: elapsedMs < MOVEMENT.WALK_IN_MS ? Math.max(0, elapsedMs) : undefined };
}

/** The walk wrapper's alpha for a derived model: fully opaque
 *  once settled (`enemyWalk: null`), fading in with the approach
 *  while walking. The one derivation both the stage and its
 *  tests read, so a settled enemy can never compute alpha 0. */
export function enemyWalkAlpha(model: RoamSceneModel): number {
  const offsetXPct = model.enemyWalk?.offsetXPct ?? 0;
  return 1 - offsetXPct / ROAM_APPROACH.spawnOffsetXPct;
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
 *  - shot: hunter x [0,-4,0] over 220ms (DOM literal); enemy
 *    scale [1,0.93,1.03,1] + x [0,9,-3,0] over HIT_REACTION_MS.
 *  - crit: the same windows with heavier keys (hunter x [0,-6,0];
 *    enemy scale [1,0.88,1.05,1] + x [0,13,-4,0]) — equivalent
 *    weight inside the reaction window, never a clock freeze
 *    (DESIGN.md §10: the absorbed hit-stop is boss-scoped; roam
 *    carries none, so the crit's weight is depth, not time).
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
        durationMs: PLAYER_HIT_POSE_MS,
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
    case 'crit':
      return {
        hunter: { x: sampleTrack(tMs, { keys: [0, -6, 0], durationMs: 220, ease: FRAMER_EASE }), y: 0, scaleY: 1 },
        enemyLungeX: 0,
        enemyHit: {
          scale: sampleTrack(tMs, { keys: [1, 0.88, 1.05, 1], durationMs: MOVEMENT.HIT_REACTION_MS, ease: FRAMER_EASE }),
          x: sampleTrack(tMs, { keys: [0, 13, -4, 0], durationMs: MOVEMENT.HIT_REACTION_MS, ease: FRAMER_EASE }),
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
