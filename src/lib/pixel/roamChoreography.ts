import { MOVEMENT, classifyTickBeat, type ActorPlacement, type CombatBeat } from './movement';
import { STRIDE_SPECS, sampleStride, type StrideSpec } from './strideCycle';
import { EASE, sampleTrack } from './pixiChoreography';
import { type PartsPoseName } from './parts';
import { ENEMY_POSES, enemyRig, type RigDef, type RigPose } from './rig';
import { actorAnchorPoint } from './movement';
import { paintedPlacement } from './paintedStage';
import { getMonster, type MonsterArchetype } from '@/constants/monsters';
import { areaVisuals, type AreaVisualIdentity } from '@/content/areaPalettes';
import { elementDialect, shotCadence, type ElementDialect, type ShotCadence } from './elementFx';
import { getPixelSprite, pixelEnemySpriteForArchetype, pixelHunterSpriteForHunter, requirePixelSprite, type PixelSprite } from './manifest';
import { gearDropFromEvent, lootRiseVisualForEvent, type LootRiseVisual } from './lootMoment';
import { Rarity } from '@/types/game';
import type { HunterId } from '@/lib/hunters/hunters';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { GearItem, Weapon } from '@/types/items';

/**
 * Roam choreography — the pure half of the Pixi roam stage (Motion
 * Reboot M2, 2026-11-07). Everything the DOM PixelSceneLayer derives
 * for mode 'roaming' is derived here from the same inputs, so the
 * Pixi renderer and its tests consume ONE derivation:
 *
 *  - the tick beat (classifyTickBeat — movement.ts, unmodified),
 *  - the hunter's figure: the active hunter's whole painting
 *    (Cache Hunters slice (c), paintings only on stage) seated at
 *    the roam mark, its FX anchors read from the painting's own
 *    manifest anchors,
 *  - the enemy: segmented band rig (current shipped art) with its
 *    ENEMY_POSES pose, or the area's bespoke elite flat,
 *  - FX anchors from the same anchor math the DOM uses,
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
 *  rest-air law; the −6 shift buys all of them +6 air at once.
 *  Slice (c) note (2026-11-15): the mark itself is unchanged, but
 *  its rationale is superseded — the painted figure's right edge
 *  is the painting's own edge (the widest, Vesper, reaches ≈24.8%
 *  of stage width from this mark), so the rest air to every
 *  archetype's front now measures ≈40%+, far past the law. The
 *  per-archetype enemy overrides below stay as shipped. */
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
 *
 * Round 3 (2026-11-14, post-merge audit re-verification on
 * master 80c604fe) re-measured rest air WEAPONS-INCLUSIVE — the
 * brief's text: rifle tip → the enemy's foremost point
 * including its own weapon, the same method the audit applies
 * to bosses. The body-method numbers above understate reach:
 * the fodder's extended pistol hand sits at 61.2% against the
 * 51.6% tip, so at the shared 78 mark its true air is only
 * 9.6% DOM / 10.0% Pixi — below the ≥12% law. The obvious lever,
 * moving fodder's mark right, is capped by the HP plate: the
 * plate is centered on the placement xPct and at the shared
 * mark the plate's % text already ends at 99.3% of stage
 * width — capture round inkr5space (fodder {82}) measured air
 * 14.2% DOM / 13.6% Pixi but the plate's % glyph ran off the
 * stage edge. So fodder's fix shortens its rest REACH instead:
 * height 58 → 46 scales the silhouette toward its anchor and
 * pulls the extended pistol arm back with it (hand ≈61.2% →
 * ≈64.7%, air ≈13%), while the mark — and the plate — stay
 * exactly where they shipped. The runner measured exactly
 * 12.0% — at the floor with zero margin; its head is its
 * foremost point and its sprite's right edge already sits at
 * ≈98%, so it cannot move right either. Its height steps
 * 44 → 42: the smaller frame pulls the leaning head ≈1 pt
 * toward its anchor (air ≈13%) and pulls the right edge in
 * with it. Sniper (14.0%) and brute (~16.7%) were re-measured
 * passing and stay untouched.
 */
export const ROAM_ARCHETYPE_PLACEMENT_OVERRIDES: Partial<
  Record<MonsterArchetype, { xPct?: number; heightPct?: number }>
> = {
  fodder: { heightPct: 46 },
  runner: { xPct: 84, heightPct: 42 },
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

export function roamPosesAt(
  beat: CombatBeat | null,
  armed: boolean,
  elapsedMs: number,
  options?: { beatForCurrentTarget?: boolean },
) {
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
    // The death pose belongs to the enemy the kill beat names. The
    // Chef settles a kill and the next spawn in ONE claim, so a kill
    // beat routinely stands next to the NEXT enemy — a target that
    // did not die must never inherit the death state (post-kill
    // invisibility defect, 2026-11-13). Renderers pass
    // beatForCurrentTarget=false for that composition and the new
    // enemy keeps its idle/walk poses; the hunter's celebrate on the
    // same beat is unaffected. Omitted/true keeps the corpse law:
    // the dead enemy is retained in the death pose until the target
    // advances (roamPoseRecovery's pinned behavior).
    if (options?.beatForCurrentTarget !== false) enemy = 'death';
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
  /** The active hunter (slice (c)): selects the Cast B painting
   *  that stands on the stage. Absent keeps the roster default
   *  (Vesper) — the same default the skill store seeds. */
  hunterId?: HunterId;
  /** Walk-in-local ms (0 at the target spawn) while the enemy is
   *  still walking in; undefined once settled. Supplied by the
   *  renderers from their own walk clocks (Pixi's walk state,
   *  the DOM diorama's rAF driver) — the model folds the stride
   *  articulation into the rig pose for exactly this span. */
  walkMs?: number;
  /** Local presentation age; omitted means the event's first frame. */
  beatElapsedMs?: number;
  /** Whether the standing beat names the CURRENT target. Renderers
   *  derive this from their own clocks (the target that was current
   *  when the beat's event arrived): a kill beat belongs to the enemy
   *  it killed, and the roster advances inside the same claim that
   *  delivers the kill event, so a kill beat paired with a freshly
   *  spawned target names the PREVIOUS enemy. False keeps that beat's
   *  death pose off the new enemy — its walk-in renders. */
  beatForCurrentTarget?: boolean;
}

export interface RoamSceneModel {
  groundY: number;
  beat: CombatBeat | null;
  isEliteEvent: boolean;
  eventPropId?: string;
  visuals: AreaVisualIdentity;
  dialect: ElementDialect;
  cadence: ShotCadence;
  poseKey: string;
  /** The painted hunter (slice (c)): the active hunter's whole
   *  painting + the width-law-fitted placement it renders at. */
  hunterSprite: PixelSprite;
  hunterSpriteId: string;
  hunterPlacement: ActorPlacement;
  hunterStagePlacement: ActorPlacement;
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
  const poses = roamPosesAt(beat, !!input.weapon, input.beatElapsedMs ?? 0, {
    beatForCurrentTarget: input.beatForCurrentTarget,
  });
  // The painted hunter (slice (c)): the active hunter's Cast B
  // painting, seated by its own anchors at the roam mark. The
  // beat's hunter pose name survives only inside poses.key (the
  // frame-cache discriminator) — a painting has no poses; the
  // wrapper beat tracks in sampleRoamBeat carry the reactions.
  const hunterSpriteId = pixelHunterSpriteForHunter(input.hunterId) ?? 'hunter-vesper-cole';
  const hunterSprite = getPixelSprite(hunterSpriteId) ?? requirePixelSprite('hunter-vesper-cole');
  const targetArchetype = input.currentTargetId ? getMonster(input.currentTargetId)?.archetype : undefined;
  const flatSpriteId = isEliteEvent && visuals.eliteSpriteId ? visuals.eliteSpriteId : undefined;
  const enemySpriteId =
    (flatSpriteId ?? pixelEnemySpriteForArchetype(targetArchetype)) ?? 'brute';
  const enemySprite = getPixelSprite(enemySpriteId) ?? requirePixelSprite('brute');
  const hunterPlacement: ActorPlacement = { ...ROAM_HUNTER_PLACEMENT, groundY };
  const hunterStagePlacement = paintedPlacement(hunterSprite, hunterPlacement);
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
    poseKey: poses.key,
    hunterSprite,
    hunterSpriteId,
    hunterPlacement,
    hunterStagePlacement,
    enemyPlacement,
    rig: flatSpriteId ? undefined : enemyRig(isEliteEvent ? 'elite' : (targetArchetype ?? 'brute')),
    rigPose: beatRigPose,
    enemyWalk: null,
    flatSpriteId,
    enemySprite,
    enemySpriteId,
    muzzle: actorAnchorPoint(hunterSprite, 'muzzle', hunterStagePlacement),
    grip: actorAnchorPoint(hunterSprite, 'grip', hunterStagePlacement),
    hunterMass: actorAnchorPoint(hunterSprite, 'centerMass', hunterStagePlacement),
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

/** Compose only the moving rig bands; reuse the cached hunter figure and FX geometry. */
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

// ── Drop-hold derivation (Stage Iteration R3) ───────────────────────
/** Why the enemy slot is held empty while a drop event stands. */
export type EnemyHold = 'gear' | 'material';

/**
 * The enemy hold for a standing drop event. Presentation only —
 * the kill-cycle store advances exactly as it does today; this
 * decides whether the stage draws a living enemy:
 *
 *  - a gear-drop event (gearDropFromEvent non-null, tone 'loot'
 *    with a gear payload) holds the slot EMPTY — the store has
 *    already advanced to the next target (full HP) inside the same
 *    claim, and a drop moment over a freshly spawned enemy reads
 *    as a second body appearing under the loot;
 *  - a non-crate rise (material / essence / fragment / scrap /
 *    credits) holds the slot only while the kill-cycle target's
 *    HP is 0 — the payout belongs to the corpse that just fell;
 *  - anything else (no drop event, a living target, a crate rise)
 *    renders the enemy exactly as before.
 */
export function enemyDropHold(
  event: TickEvent | undefined | null,
  targetHp: number | null | undefined,
): EnemyHold | null {
  if (!event) return null;
  if (gearDropFromEvent(event)) return 'gear';
  const rise = lootRiseVisualForEvent(event);
  if (rise && rise !== 'crate' && (targetHp ?? 0) <= 0) return 'material';
  return null;
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
 * scene counts HIGHER than the boss fight's count (36 at full
 * dress since slice (c): the ONE hunter painting + 4 rig segments
 * against 6+4+14+7 pooled FX; before slice (c) it was 53 — 11
 * parts + weapon + 6 gear mounts) — because the DOM scene it
 * replaces animates at least as many framer-driven elements
 * (14 embers, rig segments, the whole FX kit as separate DOM
 * nodes). The Pixi scene is one canvas with pooled sprites and
 * no per-frame allocation; the count is reported, not trimmed —
 * trimming it would mean dropping scene elements the DOM shows,
 * which is a behavior change, not an optimization.
 */
export function roamAnimatedNodeCount(opts: { enemySegments: number; vista?: boolean }): number {
  const actors = 1 + opts.enemySegments;
  // V1 vista scenes: the procedural ember pool stands down (the
  // authored ambient sets carry the ember life) and the four
  // ambient canvas sprites join the count; the band wrap pairs are
  // vista dressing like the plates they replace. Full dress on a
  // vista scene: 5 actors + 6 + 4 + 0 + 7 + 4 = 26 — reported, not
  // trimmed, same as ever.
  const embers = opts.vista ? 0 : ROAM_POOL_CAPS.embers;
  const vistaAmbient = opts.vista ? 4 : 0;
  return actors + ROAM_POOL_CAPS.sparks + ROAM_POOL_CAPS.tracers + embers + ROAM_POOL_CAPS.oneShots + vistaAmbient;
}
