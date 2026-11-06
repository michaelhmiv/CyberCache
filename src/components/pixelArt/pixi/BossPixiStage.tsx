import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Application, Assets, Container, Sprite, Texture } from 'pixi.js';
import { motion } from 'framer-motion';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { CritFlash, DamageNumber } from '../PixelFx';
import { PART_POSES, PART_SLOTS, PARTS_FEET_X, PRIMARY_ANCHOR, SKELETON, type PartsPoseName } from '@/lib/pixel/parts';

const PAINT_ORDER = new Map(PART_SLOTS.map((s) => [s.slot, s.paintOrder]));
import { useOwnLookWithLoad } from '@/store/slices/cosmeticsSlice';
import { layoutPartSet, type PartSetLayout } from '@/lib/pixel/partsCompositor';
import {
  armedActorExtents,
  fitArmedActorHeight,
  partsAnchorPoint,
  partsWeaponFractionsFor,
} from '@/lib/pixel/partsStage';
import {
  bespokeSpriteIdForWeapon,
  getPixelSprite,
  pixelBossSpriteForBoss,
  requirePixelSprite,
  type PixelSprite,
} from '@/lib/pixel/manifest';
import { paletteSpriteUrl } from '@/lib/pixel/paletteSwap';
import {
  composePixelWeaponCached,
  paintPixelWeapon,
  pixelWeaponInputFromWeapon,
} from '@/lib/pixel/weaponCompositor';
import { bossArena, endlessBandTint } from '@/content/areaPalettes';
import {
  MOVEMENT,
  actorAnchorPoint,
  derivePhaseBeats,
  particleField,
  shakeKeyframes,
  type ActorPlacement,
  type PhaseBeat,
} from '@/lib/pixel/movement';
import {
  EASE,
  effectiveTime,
  hitStopWindows,
  pixiAnimatedNodeCount,
  sampleTrack,
  easeOutBack,
  type HitStopWindow,
} from '@/lib/pixel/pixiChoreography';
import type { BossFightStageProps } from '../BossFightStage';
import { ACTION_SKILL_DEFS } from '@/content/actionSkills';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';

/**
 * BossPixiStage — the PixiJS v8 renderer for the boss fight stage
 * (motion pilot, owner-approved brief 2026-11-06). It consumes the
 * SAME decided FightTimeline, the SAME sprites/compositor output,
 * and the SAME movement.ts law as the DOM stage it pilots alongside:
 *
 *  - imperative Pixi inside a React host (not @pixi/react): the
 *    stage is one self-contained scene graph driven by a single
 *    rAF clock; React only owns the pane, the DOM overlays (phase
 *    chip, damage numbers, banner — the identical components the
 *    DOM stage renders), and the props feed.
 *  - choreography is sampled per frame from movement.ts track
 *    tables (see pixiChoreography.ts): pose rotations tween on the
 *    SEGMENT durations, the recoil entry overshoots and settles,
 *    the boss anticipates inside the telegraph window, and
 *    hit-stop freezes the phase clock briefly at impact — absorbed
 *    inside the 1150 ms phase, so the fight's total duration and
 *    FIGHT_TOTAL_BUDGET_MS are unchanged.
 *  - particles are pre-allocated pools (sparks / embers / one-shot
 *    FX sprites); nothing spawns per frame. The live animated-node
 *    count stays under MOVEMENT.SEGMENT.MAX_ANIMATED_NODES.
 *  - rendering is resolution-pinned at 1.0 with nearest-neighbour
 *    sampling throughout: the texel grid stays hard-edged, the
 *    same art the DOM stage shows, unsmearing (see
 *    STAGE_RESOLUTION for the half-res experiment's evidence).
 *
 * Presentation only — it reads the timeline and never touches
 * outcomes, HP, or loot. Any init/texture failure reports through
 * onPixiError and the wrapper falls back to the DOM stage.
 */

const HUNTER_PLACEMENT: ActorPlacement = { xPct: 20, heightPct: 62, groundY: 0.86 };
const BOSS_PLACEMENT: ActorPlacement = { xPct: 76, heightPct: 80, groundY: 0.86 };
const DEG = Math.PI / 180;

/** Stage resolution pin: 1.0, nearest-sampled — the same rendering
 *  contract the DOM stage's pixelated <img>s use. A half-resolution
 *  backing store was tried first (integer 2× upscale), but Chromium
 *  bilinear-upscales WebGL canvases regardless of
 *  `image-rendering: pixelated`, smearing the texel grid (A/B
 *  captures in the pilot evidence dir); at 1.0 with nearest
 *  filtering the render is texel-identical to the DOM stage. */
const STAGE_RESOLUTION = 1;

interface PhaseModel {
  presentingIndex: number;
  finished: boolean;
  victory: boolean;
  beats: PhaseBeat[];
  isCrit: boolean;
  shotBeat?: PhaseBeat;
  poseName: PartsPoseName;
  layout: PartSetLayout;
  muzzle: { xPct: number; yPct: number };
  grip: { xPct: number; yPct: number };
  hunterMass: { xPct: number; yPct: number };
  bossMass: { xPct: number; yPct: number };
  bossFeet: { xPct: number; yPct: number };
  bossDamage: number;
  playerDamage: number;
  hitStops: HitStopWindow[];
  shake?: { key: string; intensity: number; durationMs: number };
}

interface PartNode {
  slot: string;
  container: Container;
  sprite: Sprite;
  anchorStage: { x: number; y: number };
  primaryLocal: { x: number; y: number };
  width: number;
  height: number;
  rotationDeg: number;
  tween?: { from: number; to: number; startMs: number; durationMs: number; overshoot: boolean };
}

interface Scene {
  app: Application;
  bg: Sprite;
  tintSprite?: Sprite;
  prop?: Sprite;
  hunterRoot: Container;
  hunterFrame: Container;
  parts: PartNode[];
  weaponRoot?: Container;
  weaponSway?: Container;
  bossLunge: Container;
  bossHit: Container;
  bossBody: Container;
  bossSprite: Sprite;
  muzzle: Sprite;
  tracer: Sprite;
  casing: Sprite;
  hitFlash: Sprite;
  telegraph: Sprite;
  dustPuff: Sprite;
  dustRing: Sprite;
  sparks: Sprite[];
  sparkSpecs: { angle: number; dist: number }[];
  embers: Sprite[];
  emberSpecs: ReturnType<typeof particleField>;
  bossSpriteDef: PixelSprite;
  readyAt: number;
}

function nearest(tex: Texture): Texture {
  // Nearest on every filter path + no mipmaps: the sprites are
  // minified into the half-resolution stage, and v8's default
  // linear/mipmap minification is what would soften the texel grid.
  tex.source.scaleMode = 'nearest';
  tex.source.magFilter = 'nearest';
  tex.source.minFilter = 'nearest';
  tex.source.mipmapFilter = 'nearest';
  tex.source.autoGenerateMipmaps = false;
  return tex;
}

async function loadTexture(src: string): Promise<Texture> {
  if (src.startsWith('data:')) {
    const img = new Image();
    img.src = src;
    await img.decode();
    return nearest(Texture.from(img));
  }
  return nearest(await Assets.load<Texture>(src));
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx, w, h);
  return nearest(Texture.from(canvas));
}

/** The muzzle star, drawn from the DOM kit's STAR_CLIP polygon. */
function starTexture(): Texture {
  const pts: [number, number][] = [
    [50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35],
  ];
  return canvasTexture((ctx, w, h) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo((x / 100) * w, (y / 100) * h);
      else ctx.lineTo((x / 100) * w, (y / 100) * h);
    });
    ctx.closePath();
    ctx.fillStyle = '#FFE9A8';
    ctx.fill();
  }, 68, 68);
}

function radialTexture(): Texture {
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,75,92,0.4)');
    g.addColorStop(0.7, 'rgba(255,75,92,0)');
    g.addColorStop(1, 'rgba(255,75,92,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 110, 110);
}

function ellipseTexture(color: string): Texture {
  return canvasTexture((ctx, w, h) => {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, 128, 41);
}

function ringTexture(): Texture {
  return canvasTexture((ctx, w, h) => {
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2 - 2, h / 2 - 2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#D8B988';
    ctx.lineWidth = 4;
    ctx.stroke();
  }, 30, 12);
}

function circleTexture(color: string): Texture {
  return canvasTexture((ctx, w, h) => {
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w / 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, 32, 32);
}

function tracerTexture(): Texture {
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,215,106,0)');
    g.addColorStop(0.55, '#FFD76A');
    g.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 64, 3);
}

function solidTexture(color: string): Texture {
  return canvasTexture((ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }, 4, 4);
}

/** The held weapon's texture: the bespoke manifest sprite, or the
 *  parts-kit compositor's own render painted to a canvas — the same
 *  pixels PixelWeapon shows. */
async function weaponTexture(props: BossFightStageProps): Promise<Texture | null> {
  if (!props.weapon) return null;
  const input = pixelWeaponInputFromWeapon(props.weapon);
  const bespokeId = bespokeSpriteIdForWeapon(input);
  if (bespokeId) {
    const sprite = getPixelSprite(bespokeId);
    if (sprite) return loadTexture(sprite.url);
  }
  const render = composePixelWeaponCached(input);
  const canvas = document.createElement('canvas');
  canvas.width = render.width;
  canvas.height = render.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paintPixelWeapon(ctx, render, 1);
  return nearest(Texture.from(canvas));
}

interface StageModel {
  arena: { backgroundId: string; propId: string };
  effectiveBackgroundId: string;
  groundY: number;
  hunterPlacement: ActorPlacement;
  bossPlacement: ActorPlacement;
  bossSprite: PixelSprite;
}

/** Static per-fight derivation — the same arena/ground/placement
 *  resolution the DOM stage performs. */
function deriveStageModel(props: BossFightStageProps): StageModel {
  const arena = bossArena(props.bossId);
  const effectiveBackgroundId = props.backgroundId ?? arena.backgroundId;
  const background = getPixelSprite(effectiveBackgroundId);
  const groundY = background?.anchors.groundLine?.y ?? HUNTER_PLACEMENT.groundY;
  return {
    arena,
    effectiveBackgroundId,
    groundY,
    hunterPlacement: { ...HUNTER_PLACEMENT, groundY },
    bossPlacement: { ...BOSS_PLACEMENT, groundY },
    bossSprite: getPixelSprite(pixelBossSpriteForBoss(props.bossId) ?? 'brute') ?? requirePixelSprite('brute'),
  };
}

/** Per-phase derivation — beats, pose, layout, and FX anchors,
 *  mirroring BossFightStage's render math line for line. */
function derivePhaseModel(
  props: BossFightStageProps,
  stage: StageModel,
  hunterSet: Parameters<typeof layoutPartSet>[0],
): PhaseModel {
  const { timeline, phases } = props;
  const victory = timeline.outcome?.result.victory === true;
  const finished = timeline.finishedAt != null;
  const presentingIndex = Math.max(0, Math.min(timeline.currentPhaseIndex, phases.length - 1));
  const currentPhase = phases[presentingIndex];
  const isLastPhase = presentingIndex === phases.length - 1;
  const entries = currentPhase ? timeline.damageLog.filter((e) => e.phaseName === currentPhase.phaseName) : [];
  const bossDamage = entries.filter((e) => e.target === 'boss').reduce((m, e) => Math.max(m, e.value), 0);
  const playerDamage = entries.filter((e) => e.target === 'player').reduce((m, e) => Math.max(m, e.value), 0);
  const beats: PhaseBeat[] =
    finished || props.reduced
      ? []
      : derivePhaseBeats({
          bossDamage,
          playerDamage,
          bossMaxHp: timeline.bossHpMax,
          bossDies: victory && isLastPhase,
          playerDies: !victory && isLastPhase,
        });
  const beat = (kind: PhaseBeat['kind']) => beats.find((b) => b.kind === kind);
  const shotBeat = beat('shot') ?? beat('crit');
  const isCrit = !!beat('crit');
  const poseName: PartsPoseName = !props.weapon
    ? 'relaxed'
    : beat('playerHit')
      ? 'hit'
      : shotBeat
        ? 'recoil'
        : 'aim';
  const layout = layoutPartSet(
    hunterSet,
    PART_POSES[poseName],
    props.weapon ? partsWeaponFractionsFor(pixelWeaponInputFromWeapon(props.weapon)) : undefined,
  );
  const shake = finished
    ? undefined
    : beat('death')
      ? { key: `death-${presentingIndex}`, intensity: 6, durationMs: MOVEMENT.KILL_SHAKE_MS + 160 }
      : isCrit
        ? { key: `crit-${presentingIndex}`, intensity: 7, durationMs: MOVEMENT.CRIT_SHAKE_MS }
        : shotBeat
          ? { key: `shot-${presentingIndex}`, intensity: 3, durationMs: MOVEMENT.SHAKE_MS + 120 }
          : undefined;
  return {
    presentingIndex,
    finished,
    victory,
    beats,
    isCrit,
    shotBeat,
    poseName,
    layout,
    muzzle: partsAnchorPoint(layout.joints.muzzle ?? layout.joints.grip, stage.hunterPlacement),
    grip: partsAnchorPoint(layout.joints.grip, stage.hunterPlacement),
    hunterMass: partsAnchorPoint(layout.joints.mass, stage.hunterPlacement),
    bossMass: actorAnchorPoint(stage.bossSprite, 'centerMass', stage.bossPlacement),
    bossFeet: actorAnchorPoint(stage.bossSprite, 'feet', stage.bossPlacement),
    bossDamage,
    playerDamage,
    hitStops: hitStopWindows(beats),
    shake,
  };
}

function slotTweenDurationMs(slot: string): number {
  if (slot === 'armUpperN' || slot === 'armForeN' || slot === 'armFar') return MOVEMENT.SEGMENT.ARM_RAISE_MS;
  if (slot === 'head') return MOVEMENT.SEGMENT.HEAD_TRACK_MS;
  return MOVEMENT.SEGMENT.STEP_BOB_MS;
}


// ── Stage runtime: the mutable scene state, owned outside React ────
// The Pixi scene graph is imperative by design (it is a game stage,
// not a view tree): all per-frame state lives in this one runtime
// object, created once per mounted stage, and the module-level
// tick below is the only writer. React owns the pane, the props
// feed (through the env snapshot), and the DOM overlays.

interface StageRuntime {
  scene: Scene | null;
  size: { w: number; h: number };
  phase: { key: string; startMs: number; model: PhaseModel } | null;
  finish: {
    startMs: number;
    bossFrom: { scale: number; x: number; y: number; rotate: number; opacity: number };
    hunterFrom: { x: number; y: number; rotate: number; opacity: number; scaleY: number };
  } | null;
  current: {
    boss: { scale: number; x: number; y: number; rotate: number; opacity: number };
    hunter: { x: number; y: number; rotate: number; opacity: number; scaleY: number };
  };
  shake: { key: string; startMs: number; intensity: number; durationMs: number } | null;
  landed: { landed: boolean; atMs: number };
  fps: { lastMs: number; deltas: number[] };
}

function createStageRuntime(): StageRuntime {
  return {
    scene: null,
    size: { w: 420, h: 228 },
    phase: null,
    finish: null,
    current: {
      boss: { scale: 1, x: 0, y: 0, rotate: 0, opacity: 1 },
      hunter: { x: 0, y: 0, rotate: 0, opacity: 1, scaleY: 1 },
    },
    shake: null,
    landed: { landed: false, atMs: 0 },
    fps: { lastMs: 0, deltas: [] },
  };
}

interface TickEnv {
  props: BossPixiStageProps;
  hunterSet: Parameters<typeof layoutPartSet>[0];
  partPalettes: ReturnType<typeof useOwnLookWithLoad>['partPalettes'];
  stage: StageModel;
  shakeWrap: HTMLDivElement | null;
}

/** Apply a phase's pose: part positions snap from the new layout
 *  (as the DOM actor's do); rotations tween on the SEGMENT slot
 *  durations, with an easeOutBack overshoot on the arm chain when
 *  the recoil pose lands. */
function applyPose(rt: StageRuntime, model: PhaseModel, now: number): void {
  const scene = rt.scene;
  if (!scene) return;
  for (const node of scene.parts) {
    const placement = model.layout.placements[node.slot as keyof typeof model.layout.placements];
    if (!placement) continue;
    node.anchorStage = placement.anchorStage;
    node.primaryLocal = placement.part.anchors[PRIMARY_ANCHOR[node.slot as keyof typeof PRIMARY_ANCHOR]];
    node.width = placement.part.width;
    node.height = placement.part.height;
    const isArm = node.slot === 'armUpperN' || node.slot === 'armForeN' || node.slot === 'armFar';
    node.tween = {
      from: node.rotationDeg,
      to: placement.rotationDeg,
      startMs: now,
      durationMs: slotTweenDurationMs(node.slot),
      overshoot: model.poseName === 'recoil' && isArm,
    };
  }
}

/** One frame of the Pixi stage. Pure sampling: every transform is a
 *  function of (law constants, phase-local effective time) — see
 *  pixiChoreography.ts. Ambient systems (background drift, embers,
 *  weapon sway, boss breathe) run on the raw clock; fight
 *  choreography runs on the hit-stop-adjusted effective clock. */
function tickStage(rt: StageRuntime, env: TickEnv, now: number): void {
  const scene = rt.scene;
  if (!scene) return;
  const { props, stage } = env;
  const { w: W, h: H } = rt.size;
  const fps = rt.fps;
  if (fps.lastMs > 0) {
    fps.deltas.push(now - fps.lastMs);
    if (fps.deltas.length > 900) fps.deltas.shift();
  }
  fps.lastMs = now;

  const timeline = props.timeline;
  const finished = timeline.finishedAt != null;
  const presentingIndex = Math.max(0, Math.min(timeline.currentPhaseIndex, props.phases.length - 1));
  const phaseKey = `${presentingIndex}|${finished}|${props.weapon?.id ?? ''}|${props.bossId ?? ''}`;
  let phase = rt.phase;
  if (!phase || phase.key !== phaseKey) {
    const model = derivePhaseModel(props, stage, env.hunterSet);
    phase = { key: phaseKey, startMs: now, model };
    rt.phase = phase;
    applyPose(rt, model, now);
    if (!finished) rt.finish = null;
    // Sparks fan is seeded per phase (DOM: seed `boss-${index}`).
    scene.sparkSpecs = particleField(`sparks-boss-${presentingIndex}`, 6).map((s, i) => ({
      angle: (i / 6) * Math.PI * 1.5 - Math.PI * 0.9,
      dist: 16 + s.swayPx + 18,
    }));
  }
  const model = phase.model;
  const rawMs = now - phase.startMs;
  const te = effectiveTime(rawMs, model.hitStops);
  const beat = (kind: PhaseBeat['kind']) => model.beats.find((b) => b.kind === kind);
  const groundYPx = stage.groundY * H;
  const px = (p: { xPct: number; yPct: number }) => ({ x: (p.xPct / 100) * W, y: (p.yPct / 100) * H });

  // ── Background: cover-fit + the drift law (raw clock) ──
  const bgTex = scene.bg.texture;
  const cover = Math.max(W / bgTex.width, H / bgTex.height);
  const drift = 1.04 + 0.06 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (now % (MOVEMENT.BG_DRIFT_HALF_MS * 2))) / (MOVEMENT.BG_DRIFT_HALF_MS * 2)));
  scene.bg.position.set(W / 2, H / 2);
  scene.bg.width = bgTex.width * cover * drift;
  scene.bg.height = bgTex.height * cover * drift;
  if (scene.tintSprite) {
    scene.tintSprite.width = W;
    scene.tintSprite.height = H;
  }
  // ── Arena prop: feet-anchored, static ──
  if (scene.prop) {
    const propDef = getPixelSprite(stage.arena.propId);
    if (propDef) {
      const propH = 0.3 * H;
      const propW = propH * (propDef.width / propDef.height);
      const feet = propDef.anchors.feet ?? { x: 0.5, y: 1 };
      scene.prop.width = propW;
      scene.prop.height = propH;
      scene.prop.position.set(0.5 * W - feet.x * propW, groundYPx - feet.y * propH);
    }
  }

  // ── Hunter wrapper tracks ──
  const hunter = { x: 0, y: 0, rotate: 0, opacity: 1, scaleY: 1 };
  if (!finished) {
    if (beat('playerHit')) {
      const spec = { durationMs: MOVEMENT.DODGE_MS, delayMs: MOVEMENT.BEAT_LUNGE_AT_MS };
      hunter.x = sampleTrack(te, { ...spec, keys: [0, -10, 4, 0] });
      hunter.rotate = sampleTrack(te, { ...spec, keys: [0, -3, 1, 0] });
      hunter.opacity = sampleTrack(te, { ...spec, keys: [1, 0.45, 1, 1] });
    } else if (beat('dodge')) {
      const spec = { durationMs: MOVEMENT.DODGE_MS, delayMs: MOVEMENT.BEAT_LUNGE_AT_MS, times: [0, 0.35, 0.55, 0.75, 1] };
      hunter.x = sampleTrack(te, { ...spec, keys: [0, 0, -30, -26, 0] });
      hunter.scaleY = sampleTrack(te, { ...spec, keys: [1, 1, 0.9, 0.96, 1] });
    } else if (model.shotBeat) {
      hunter.x = sampleTrack(te, { keys: [0, -4, 0], durationMs: 220 });
    }
  }
  // ── Boss wrapper tracks ──
  const boss = { scale: 1, x: 0, y: 0, rotate: 0, opacity: 1 };
  let lungeX = 0;
  let crouch = 0;
  if (!finished) {
    if (beat('lunge')) {
      lungeX = sampleTrack(te, {
        keys: [0, 0, -112, -96, 0],
        times: [0, 0.3, 0.52, 0.72, 1],
        durationMs: MOVEMENT.LUNGE_MS + 260,
        delayMs: MOVEMENT.BEAT_LUNGE_AT_MS,
      });
    }
    if (beat('death')) {
      const spec = { durationMs: MOVEMENT.DEATH_COLLAPSE_MS, delayMs: MOVEMENT.HIT_REACTION_MS, ease: EASE.easeIn };
      boss.scale = sampleTrack(te, { ...spec, keys: [1, 0.92, 0.45] });
      boss.y = sampleTrack(te, { ...spec, keys: [0, 4, 26] });
      boss.rotate = sampleTrack(te, { ...spec, keys: [0, -3, -10] });
      boss.opacity = sampleTrack(te, { ...spec, keys: [1, 1, 0.85] });
    } else if (model.shotBeat) {
      boss.scale = sampleTrack(te, { keys: [1, 0.93, 1.03, 1], durationMs: MOVEMENT.HIT_REACTION_MS });
      boss.x = sampleTrack(te, { keys: [0, 9, -3, 0], durationMs: MOVEMENT.HIT_REACTION_MS });
    }
    // Anticipation (brief §5.2): inside the telegraph window the
    // boss coils before the lunge — a 4% crouch that releases as
    // the lunge fires. The DOM stage holds still here; this is
    // the pilot's motion upgrade, inside the law's window.
    if (beat('telegraph') && beat('lunge') && !beat('death')) {
      if (te >= MOVEMENT.BEAT_COUNTER_AT_MS && te < MOVEMENT.BEAT_LUNGE_AT_MS) {
        crouch = EASE.easeInOut((te - MOVEMENT.BEAT_COUNTER_AT_MS) / MOVEMENT.TELEGRAPH_MS);
      } else if (te >= MOVEMENT.BEAT_LUNGE_AT_MS) {
        crouch = Math.max(0, 1 - (te - MOVEMENT.BEAT_LUNGE_AT_MS) / 120);
      }
    }
  }
  // ── Finish settle ──
  if (finished) {
    if (!rt.finish) {
      rt.finish = {
        startMs: now,
        bossFrom: { ...rt.current.boss },
        hunterFrom: { ...rt.current.hunter },
      };
    }
    const f = rt.finish;
    const ft = now - f.startMs;
    if (model.victory) {
      const p = EASE.ease(Math.max(0, Math.min(1, ft / 300)));
      boss.scale = f.bossFrom.scale + (0.45 - f.bossFrom.scale) * p;
      boss.y = f.bossFrom.y + (26 - f.bossFrom.y) * p;
      boss.rotate = f.bossFrom.rotate + (-10 - f.bossFrom.rotate) * p;
      boss.opacity = f.bossFrom.opacity + (0.85 - f.bossFrom.opacity) * p;
      boss.x = f.bossFrom.x * (1 - p);
    } else if (timeline.outcome) {
      const p = EASE.easeIn(Math.max(0, Math.min(1, ft / 550)));
      hunter.rotate = f.hunterFrom.rotate + (-68 - f.hunterFrom.rotate) * p;
      hunter.y = f.hunterFrom.y + (30 - f.hunterFrom.y) * p;
      hunter.opacity = f.hunterFrom.opacity + (0.7 - f.hunterFrom.opacity) * p;
      hunter.x = f.hunterFrom.x * (1 - p);
    }
  }
  rt.current = { boss: { ...boss }, hunter: { ...hunter } };

  // ── Apply hunter ──
  scene.hunterRoot.position.set((stage.hunterPlacement.xPct / 100) * W + hunter.x, groundYPx + hunter.y);
  scene.hunterRoot.rotation = hunter.rotate * DEG;
  scene.hunterRoot.scale.set(1, hunter.scaleY);
  scene.hunterRoot.alpha = hunter.opacity;
  const nominalFrameH = (stage.hunterPlacement.heightPct / 100) * H;
  let frameH = nominalFrameH;
  let frameTop = groundYPx - nominalFrameH;
  if (props.weapon && model.layout.weapon) {
    const fit = fitArmedActorHeight({
      containerW: W,
      containerH: H,
      heightPct: stage.hunterPlacement.heightPct,
      xPct: stage.hunterPlacement.xPct,
      groundY: stage.groundY,
      extents: armedActorExtents(model.layout),
    });
    if (fit.constrained) {
      frameH = fit.heightPx;
      frameTop = fit.topPx;
    }
  }
  const frameW = frameH * (SKELETON.frameWidth / SKELETON.frameHeight);
  const s = frameH / SKELETON.frameHeight;
  scene.hunterFrame.position.set(-PARTS_FEET_X * frameW, frameTop - groundYPx);
  for (const node of scene.parts) {
    if (node.tween) {
      const p = Math.max(0, Math.min(1, (now - node.tween.startMs) / node.tween.durationMs));
      const eased = node.tween.overshoot ? easeOutBack(p) : EASE.easeOut(p);
      node.rotationDeg = node.tween.from + (node.tween.to - node.tween.from) * eased;
      if (p >= 1) node.tween = undefined;
    }
    node.container.position.set(node.anchorStage.x * s, node.anchorStage.y * s);
    node.container.rotation = node.rotationDeg * DEG;
    node.sprite.position.set(-node.primaryLocal.x * s, -node.primaryLocal.y * s);
    node.sprite.width = node.width * s;
    node.sprite.height = node.height * s;
  }
  if (scene.weaponRoot && scene.weaponSway) {
    const wgeo = model.layout.weapon;
    scene.weaponRoot.visible = !!wgeo;
    if (wgeo) {
      const boxW = wgeo.targetW * s;
      const boxH = wgeo.targetH * s;
      scene.weaponRoot.position.set(
        (wgeo.gripStage.x - wgeo.gripFrac.x * wgeo.targetW) * s,
        (wgeo.gripStage.y - wgeo.gripFrac.y * wgeo.targetH) * s,
      );
      scene.weaponRoot.rotation = -3 * DEG;
      const swayDeg = -1.1 * Math.cos((2 * Math.PI * (now % 3400)) / 3400);
      scene.weaponSway.position.set(0.18 * boxW, 0.6 * boxH);
      scene.weaponSway.rotation = swayDeg * DEG;
      const weaponSprite = scene.weaponSway.children[0] as Sprite;
      weaponSprite.position.set(-0.18 * boxW, -0.6 * boxH);
      weaponSprite.width = boxW;
      weaponSprite.height = boxH;
    }
  }

  // ── Apply boss ──
  const bossDef = scene.bossSpriteDef;
  const bossH = (stage.bossPlacement.heightPct / 100) * H;
  const bossW = bossH * (bossDef.width / bossDef.height);
  const bossFeetPx = px(model.bossFeet);
  scene.bossLunge.position.set((stage.bossPlacement.xPct / 100) * W + lungeX, groundYPx);
  scene.bossHit.position.set(boss.x, boss.y + 3 * crouch);
  scene.bossHit.scale.set(boss.scale, boss.scale * (1 - 0.04 * crouch));
  scene.bossHit.rotation = boss.rotate * DEG;
  scene.bossHit.alpha = boss.opacity;
  const sinceReady = now - scene.readyAt;
  let entY = 0;
  let entA = 1;
  if (sinceReady < MOVEMENT.DROP_IN_MS) {
    const e = EASE.easeIn(Math.max(0, sinceReady / MOVEMENT.DROP_IN_MS));
    entY = -0.55 * bossH * (1 - e);
    entA = e;
  } else if (!rt.landed.landed) {
    rt.landed = { landed: true, atMs: now };
  }
  scene.bossBody.position.set(0, entY);
  scene.bossBody.alpha = entA;
  scene.bossBody.scale.set(1, 1 + 0.015 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (now % 3100)) / 3100)));
  const feet = bossDef.anchors.feet ?? { x: 0.5, y: 1 };
  scene.bossSprite.position.set(-feet.x * bossW, -feet.y * bossH);
  scene.bossSprite.width = bossW;
  scene.bossSprite.height = bossH;

  // ── FX (phase-clock sampled) ──
  const showShot = !!model.shotBeat && !finished;
  const muzzlePx = px(model.muzzle);
  const gripPx = px(model.grip);
  const bossMassPx = px(model.bossMass);
  scene.muzzle.visible = showShot && te < MOVEMENT.MUZZLE_FLASH_MS;
  if (scene.muzzle.visible) {
    const spec = { durationMs: MOVEMENT.MUZZLE_FLASH_MS, ease: EASE.easeOut };
    const sc = sampleTrack(te, { ...spec, keys: [0.4, 1.15, 0.8] });
    scene.muzzle.position.set(muzzlePx.x, muzzlePx.y);
    scene.muzzle.width = 34 * sc;
    scene.muzzle.height = 34 * sc;
    scene.muzzle.rotation = sampleTrack(te, { ...spec, keys: [-12, 8, 20] }) * DEG;
    scene.muzzle.alpha = sampleTrack(te, { ...spec, keys: [0, 1, 0] });
  }
  scene.tracer.visible = showShot && te < MOVEMENT.TRACER_MS;
  if (scene.tracer.visible) {
    const dx = bossMassPx.x - muzzlePx.x;
    const dy = bossMassPx.y - muzzlePx.y;
    scene.tracer.position.set(muzzlePx.x, muzzlePx.y);
    scene.tracer.width = Math.hypot(dx, dy);
    scene.tracer.height = 3;
    scene.tracer.rotation = Math.atan2(dy, dx);
    scene.tracer.alpha = sampleTrack(te, { keys: [0, 1, 0], durationMs: MOVEMENT.TRACER_MS, ease: EASE.linear });
  }
  scene.casing.visible = showShot && te < MOVEMENT.SHELL_CASING_MS;
  if (scene.casing.visible) {
    const spec = { durationMs: MOVEMENT.SHELL_CASING_MS, times: [0, 0.45, 1], ease: EASE.easeOut };
    scene.casing.position.set(
      gripPx.x + sampleTrack(te, { ...spec, keys: [-2, -14, -22] }),
      gripPx.y + sampleTrack(te, { ...spec, keys: [-6, 2, 16] }),
    );
    scene.casing.rotation = sampleTrack(te, { ...spec, keys: [0, -140, -260] }) * DEG;
    scene.casing.alpha = sampleTrack(te, { ...spec, keys: [1, 1, 0] });
  }
  const sparksActive = showShot && te < MOVEMENT.IMPACT_SPARKS_MS;
  scene.sparks.forEach((spark, i) => {
    spark.visible = sparksActive;
    if (!sparksActive) return;
    const spec = scene.sparkSpecs[i];
    const e = EASE.easeOut(Math.max(0, Math.min(1, te / MOVEMENT.IMPACT_SPARKS_MS)));
    spark.position.set(bossMassPx.x + Math.cos(spec.angle) * spec.dist * e, bossMassPx.y + Math.sin(spec.angle) * spec.dist * e + 6 * e);
    spark.rotation = spec.angle;
    spark.alpha = 1 - e;
  });
  scene.hitFlash.visible = showShot && te < MOVEMENT.HIT_REACTION_MS;
  if (scene.hitFlash.visible) {
    scene.hitFlash.position.set(bossMassPx.x, bossMassPx.y);
    scene.hitFlash.width = 120;
    scene.hitFlash.height = 120;
    scene.hitFlash.alpha = sampleTrack(te, { keys: [0, 0.5, 0], durationMs: MOVEMENT.HIT_REACTION_MS });
  }
  scene.telegraph.visible = !!beat('telegraph') && !finished;
  if (scene.telegraph.visible) {
    const spec = { durationMs: MOVEMENT.TELEGRAPH_MS, delayMs: MOVEMENT.BEAT_COUNTER_AT_MS, ease: EASE.easeInOut };
    const sc = sampleTrack(te, { ...spec, keys: [0.7, 1.05, 0.95, 1.15] });
    scene.telegraph.position.set(bossMassPx.x, bossMassPx.y);
    scene.telegraph.width = 110 * sc;
    scene.telegraph.height = 110 * sc;
    scene.telegraph.alpha = sampleTrack(te, { ...spec, keys: [0, 0.9, 0.55, 1] });
  }
  scene.dustRing.visible = !!beat('death') && !finished;
  if (scene.dustRing.visible) {
    const spec = { durationMs: MOVEMENT.DUST_RING_MS, delayMs: MOVEMENT.HIT_REACTION_MS + 120, ease: EASE.easeOut };
    const sc = sampleTrack(te, { ...spec, keys: [0.3, 2.6, 3.6] });
    scene.dustRing.position.set(bossFeetPx.x, bossFeetPx.y);
    scene.dustRing.width = 30 * sc;
    scene.dustRing.height = 12 * sc;
    scene.dustRing.alpha = sampleTrack(te, { ...spec, keys: [0, 0.75, 0] });
  }
  const puffLocal = rt.landed.landed ? now - rt.landed.atMs : Number.POSITIVE_INFINITY;
  scene.dustPuff.visible = puffLocal < MOVEMENT.DUST_PUFF_MS;
  if (scene.dustPuff.visible) {
    const spec = { durationMs: MOVEMENT.DUST_PUFF_MS, ease: EASE.easeOut };
    const sc = sampleTrack(puffLocal, { ...spec, keys: [0.4, 1.15, 1.45] });
    scene.dustPuff.position.set(bossFeetPx.x, bossFeetPx.y);
    scene.dustPuff.width = 110 * sc;
    scene.dustPuff.height = 110 * 0.32 * sc;
    scene.dustPuff.alpha = sampleTrack(puffLocal, { ...spec, keys: [0, 0.4, 0] });
  }
  // ── Embers (ambient, raw clock) ──
  scene.embers.forEach((ember, i) => {
    const spec = scene.emberSpecs[i];
    const t01 = ((now + spec.delayMs) % spec.durationMs) / spec.durationMs;
    ember.position.set((spec.xPct / 100) * W + spec.swayPx * t01, H + 6 - 320 * t01 - spec.size);
    ember.alpha = sampleTrack(t01 * 1000, { keys: [0, spec.opacity, 0], times: [0, 0.25, 1], durationMs: 1000, ease: EASE.linear });
  });

  // ── Shake on the stage container (DOM wrapper transform) ──
  const desiredShake = finished
    ? undefined
    : (model.shake ?? (rt.landed.landed ? { key: 'boss-land', intensity: 5, durationMs: MOVEMENT.SHAKE_MS + 140 } : undefined));
  const shakeWrap = env.shakeWrap;
  if (shakeWrap) {
    if (desiredShake && rt.shake?.key !== desiredShake.key) {
      rt.shake = { key: desiredShake.key, startMs: now, intensity: desiredShake.intensity, durationMs: desiredShake.durationMs };
      if (import.meta.env.DEV) {
        const w = window as unknown as { __pixiShakeEvents?: { key: string; atMs: number; durationMs: number }[] };
        w.__pixiShakeEvents = [...(w.__pixiShakeEvents ?? []), { key: desiredShake.key, atMs: now, durationMs: desiredShake.durationMs }];
      }
    }
    const st = rt.shake;
    if (st && desiredShake) {
      const elapsed = now - st.startMs;
      if (elapsed < st.durationMs) {
        const frames = shakeKeyframes(st.key, st.intensity);
        const sx = sampleTrack(elapsed, { keys: frames.x, durationMs: st.durationMs, ease: EASE.easeOut });
        const sy = sampleTrack(elapsed, { keys: frames.y, durationMs: st.durationMs, ease: EASE.easeOut });
        shakeWrap.style.transform = `translate(${sx}px, ${sy}px)`;
      } else {
        shakeWrap.style.transform = '';
      }
    } else {
      shakeWrap.style.transform = '';
    }
  }

  // ── Dev probe surface (harness timing/fps sampling) ──
  if (import.meta.env.DEV) {
    const deltas = rt.fps.deltas;
    const avg = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    const w = window as unknown as { __cybercachePixiStage?: unknown };
    w.__cybercachePixiStage = {
      phaseIndex: presentingIndex,
      finished,
      rawMs,
      effMs: te,
      bossScaleX: boss.scale,
      bossX: lungeX + boss.x,
      shakeKey: rt.shake?.key ?? null,
      nodeCount: pixiAnimatedNodeCount(scene.parts.length, !!scene.weaponRoot),
      fpsAvg: avg > 0 ? 1000 / avg : 0,
      frameDeltas: [...deltas],
    };
  }
}

interface BossPixiStageProps extends BossFightStageProps {
  /** Init/texture failure seam: the wrapper swaps to the DOM stage. */
  onPixiError?: () => void;
}

export const BossPixiStage: React.FC<BossPixiStageProps> = (props) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shakeWrapRef = useRef<HTMLDivElement | null>(null);
  const look = useOwnLookWithLoad();
  const runtimeRef = useRef<StageRuntime | null>(null);
  const envRef = useRef<TickEnv | null>(null);
  const [failed, setFailed] = useState(false);
  // The beat overlay (damage numbers / crit flash) starts its
  // framer clock at mount, but the canvas phase clock starts when
  // the scene becomes ready — gate the overlay on readiness so the
  // numbers land on the same beat as the canvas FX they punctuate.
  const [sceneReady, setSceneReady] = useState(false);
  const stageModel = useMemo(() => deriveStageModel(props), [props.bossId, props.backgroundId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the tick's env snapshot current (props feed + look + the
  // shake wrapper element). Effects run after render; the ticker
  // only starts once the async scene build completes.
  useEffect(() => {
    envRef.current = {
      props,
      hunterSet: look.set,
      partPalettes: look.partPalettes,
      stage: stageModel,
      shakeWrap: shakeWrapRef.current,
    };
  });

  useEffect(() => {
    if (failed) envRef.current?.props.onPixiError?.();
  }, [failed]);

  useEffect(() => {
    let cancelled = false;
    let app: Application | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const runtime = (runtimeRef.current ??= createStageRuntime());
    const init = async () => {
      const host = hostRef.current;
      const env = envRef.current;
      if (!host || !env) return;
      const initialProps = env.props;
      const stage = env.stage;
      const set = env.hunterSet;
      const firstModel = derivePhaseModel(initialProps, stage, set);
      const w = host.clientWidth || 420;
      const h = host.clientHeight || 228;
      runtime.size = { w, h };

      const background = requirePixelSprite(stage.effectiveBackgroundId);
      const propSprite = getPixelSprite(stage.arena.propId);
      const [bgTex, propTex, bossTex, weaponTex] = await Promise.all([
        loadTexture(background.url),
        propSprite ? loadTexture(propSprite.url) : Promise.resolve(null),
        loadTexture(stage.bossSprite.url),
        weaponTexture(initialProps),
      ]);
      // Part textures for the pilot pose layout (the set is fixed for
      // the fight's duration; palettes resolve exactly as the DOM
      // actor resolves them on first paint).
      const partTexEntries = await Promise.all(
        Object.values(firstModel.layout.placements)
          .filter((p): p is NonNullable<typeof p> => !!p)
          .map(async (placement) => {
            const sprite = requirePixelSprite(placement.part.spriteId);
            const slotPalette = env.partPalettes?.[placement.part.slot];
            const src = slotPalette
              ? paletteSpriteUrl(placement.part.spriteId, sprite.url, slotPalette.paletteId, slotPalette.spec)
              : sprite.url;
            return { slot: placement.part.slot, tex: await loadTexture(src) };
          }),
      );
      if (cancelled) return;
      const partTex = new Map(partTexEntries.map((e) => [e.slot, e.tex]));

      app = new Application();
      await app.init({
        width: w,
        height: h,
        resolution: STAGE_RESOLUTION,
        antialias: false,
        backgroundAlpha: 0,
        roundPixels: true,
      });
      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }
      app.canvas.style.width = '100%';
      app.canvas.style.height = '100%';
      app.canvas.style.imageRendering = 'pixelated';
      app.canvas.style.display = 'block';
      host.appendChild(app.canvas);

      const world = new Container();
      app.stage.addChild(world);
      const bg = new Sprite(bgTex);
      bg.anchor.set(0.5, 0.5);
      world.addChild(bg);
      // Endless band wash: in the DOM stage the tint covers only the
      // background plate (actors render above it), so the wash lives
      // here in the canvas, directly over the bg sprite. The depth
      // CHIP stays a DOM overlay.
      let tintSprite: Sprite | undefined;
      if (initialProps.depthBadge) {
        const tint = endlessBandTint(initialProps.depthBadge.band);
        tintSprite = new Sprite(solidTexture('#FFFFFF'));
        tintSprite.tint = tint.color;
        tintSprite.alpha = tint.alpha;
        world.addChild(tintSprite);
      }
      let prop: Sprite | undefined;
      if (propTex && propSprite) {
        prop = new Sprite(propTex);
        world.addChild(prop);
      }
      // Hunter: root at the ground anchor point (wrapper tracks land
      // here, pivot = the DOM wrapper's transformOrigin), frame
      // container inside it.
      const hunterRoot = new Container();
      const hunterFrame = new Container();
      hunterRoot.addChild(hunterFrame);
      world.addChild(hunterRoot);
      const parts: PartNode[] = [];
      const placements = Object.values(firstModel.layout.placements)
        .filter((p): p is NonNullable<typeof p> => !!p)
        .sort((a, b) => (PAINT_ORDER.get(a.part.slot) ?? 0) - (PAINT_ORDER.get(b.part.slot) ?? 0));
      for (const placement of placements) {
        const tex = partTex.get(placement.part.slot);
        if (!tex) continue;
        const container = new Container();
        const sprite = new Sprite(tex);
        container.addChild(sprite);
        hunterFrame.addChild(container);
        parts.push({
          slot: placement.part.slot,
          container,
          sprite,
          anchorStage: placement.anchorStage,
          primaryLocal: placement.part.anchors[PRIMARY_ANCHOR[placement.part.slot]],
          width: placement.part.width,
          height: placement.part.height,
          rotationDeg: placement.rotationDeg,
        });
      }
      let weaponRoot: Container | undefined;
      let weaponSway: Container | undefined;
      if (weaponTex && firstModel.layout.weapon) {
        weaponRoot = new Container();
        weaponSway = new Container();
        const weaponSprite = new Sprite(weaponTex);
        weaponSprite.name = 'weaponSprite';
        weaponSway.addChild(weaponSprite);
        weaponRoot.addChild(weaponSway);
        hunterFrame.addChild(weaponRoot);
      }
      // Boss: lunge wrapper → hit wrapper → body (entrance + breathe)
      // → sprite, all pivoting at the feet anchor point.
      const bossLunge = new Container();
      const bossHit = new Container();
      const bossBody = new Container();
      const bossSpriteNode = new Sprite(bossTex);
      bossBody.addChild(bossSpriteNode);
      bossHit.addChild(bossBody);
      bossLunge.addChild(bossHit);
      world.addChild(bossLunge);
      // FX layer.
      const fx = new Container();
      world.addChild(fx);
      const mkSprite = (tex: Texture, anchorX = 0.5, anchorY = 0.5) => {
        const s = new Sprite(tex);
        s.anchor.set(anchorX, anchorY);
        s.visible = false;
        fx.addChild(s);
        return s;
      };
      const telegraph = mkSprite(radialTexture());
      const dustRing = mkSprite(ringTexture());
      const dustPuff = mkSprite(ellipseTexture('#C9A876'));
      const hitFlash = mkSprite(circleTexture('#FFFFFF'));
      const muzzle = mkSprite(starTexture());
      const tracer = mkSprite(tracerTexture(), 0, 0.5);
      const casing = mkSprite(solidTexture('#E8B33C'));
      casing.width = 5;
      casing.height = 8;
      const sparkTex = solidTexture('#FFC65C');
      const sparks = Array.from({ length: 6 }, () => {
        const s = mkSprite(sparkTex);
        s.width = 7;
        s.height = 2.5;
        return s;
      });
      // Embers ride on top, as in the DOM stage's stacking.
      const emberTex = circleTexture('#FFB35C');
      const emberSpecs = particleField(`embers-${stage.effectiveBackgroundId}`, MOVEMENT.EMBER_COUNT);
      const embers: Sprite[] = emberSpecs.map((spec) => {
        const s = new Sprite(emberTex);
        s.width = spec.size;
        s.height = spec.size;
        world.addChild(s);
        return s;
      });

      const scene: Scene = {
        app,
        bg,
        tintSprite,
        prop,
        hunterRoot,
        hunterFrame,
        parts,
        weaponRoot,
        weaponSway,
        bossLunge,
        bossHit,
        bossBody,
        bossSprite: bossSpriteNode,
        muzzle,
        tracer,
        casing,
        hitFlash,
        telegraph,
        dustPuff,
        dustRing,
        sparks,
        sparkSpecs: particleField(`sparks-boss-0`, 6).map((s, i) => ({
          angle: (i / 6) * Math.PI * 1.5 - Math.PI * 0.9,
          dist: 16 + s.swayPx + 18,
        })),
        embers,
        emberSpecs,
        bossSpriteDef: stage.bossSprite,
        readyAt: performance.now(),
      };
      runtime.scene = scene;
      setSceneReady(true);
      app.ticker.add(() => {
        const tickEnv = envRef.current;
        if (tickEnv) tickStage(runtime, tickEnv, performance.now());
      });
      resizeObserver = new ResizeObserver(() => {
        const nw = host.clientWidth;
        const nh = host.clientHeight;
        if (nw > 0 && nh > 0 && app) {
          runtime.size = { w: nw, h: nh };
          app.renderer.resize(nw, nh);
        }
      });
      resizeObserver.observe(host);
    };
    init().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
      runtime.scene = null;
    };
  }, []);

  // ── DOM overlays: the identical chrome the DOM stage renders
  // (phase chip, depth chip, signature treatment, damage numbers,
  // crit flash, end banner) — React keeps these pixels; the canvas
  // underneath carries actors and particle FX only.
  const overlay = useMemo(
    () => derivePhaseModel(props, stageModel, look.set),
    [props, stageModel, look.set],
  );
  if (failed) return null;
  const { timeline, phases } = props;
  const finished = timeline.finishedAt != null;
  const victory = overlay.victory;
  const presentingIndex = overlay.presentingIndex;
  const currentPhase = phases[presentingIndex];
  const bandTint = props.depthBadge ? endlessBandTint(props.depthBadge.band) : null;
  const playerHitBeat = overlay.beats.find((b) => b.kind === 'playerHit');

  return (
    <div
      className={props.embedded
        ? 'relative h-full w-full overflow-hidden bg-bg'
        : 'relative h-[228px] w-full overflow-hidden border-2 border-border bg-bg'}
      data-testid="boss-fight-stage"
      data-phase={presentingIndex}
      data-finished={finished}
    >
      <div ref={shakeWrapRef} className="absolute inset-0">
        <div ref={hostRef} className="absolute inset-0" data-testid="boss-fight-pixel-stage" data-renderer="pixi" />
        {props.depthBadge && bandTint && (
          <div
            className="pointer-events-none absolute right-2 top-2 z-20 border-2 border-black bg-[#050608]/85 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-fuchsia-300"
            data-testid="endless-depth-chip"
          >
            Depth {props.depthBadge.depth} · Band {props.depthBadge.band + 1}
          </div>
        )}
        {currentPhase && (
          <div className={`pointer-events-none absolute left-2 ${props.embedded ? 'top-[60px]' : 'top-2'} z-20 border-2 border-black bg-[#050608]/85 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber`}>
            {finished ? (victory ? 'Victory' : 'Defeat') : `Phase ${presentingIndex + 1} — ${currentPhase.phaseName}`}
          </div>
        )}
        {props.signatureFire && (
          <>
            <motion.div
              className="pointer-events-none absolute inset-x-0 top-9 z-20 h-[3px]"
              style={{ backgroundColor: getSkillTreeVisual(props.signatureFire).color, boxShadow: `0 0 12px ${getSkillTreeVisual(props.signatureFire).color}` }}
              initial={{ scaleX: 0, opacity: 0 }}
              animate={{ scaleX: 1, opacity: [1, 1, 0.35] }}
              transition={{ duration: 1.6, times: [0, 0.7, 1], ease: 'easeOut' }}
              data-testid="boss-signature-beam"
            />
            <div
              className={`pointer-events-none absolute left-2 ${props.embedded ? 'top-[92px]' : 'top-11'} z-20 flex items-center gap-1.5 border-2 bg-[#050608]/85 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide`}
              style={{ borderColor: getSkillTreeVisual(props.signatureFire).color, color: getSkillTreeVisual(props.signatureFire).color }}
              data-testid="boss-signature-fire"
            >
              <PxIcon name={getSkillTreeVisual(props.signatureFire).sigil} size={13} />
              {ACTION_SKILL_DEFS[props.signatureFire].name} fired
            </div>
          </>
        )}
        {!finished && sceneReady && (overlay.shotBeat || overlay.isCrit || playerHitBeat) && (
          <div key={`beats-${presentingIndex}`} className="absolute inset-0" data-testid="boss-fight-beats">
            {overlay.shotBeat && (
              <DamageNumber
                xPct={overlay.bossMass.xPct}
                yPct={overlay.bossMass.yPct - 6}
                value={overlay.shotBeat.value ?? overlay.bossDamage}
                crit={overlay.isCrit}
              />
            )}
            {overlay.isCrit && <CritFlash />}
            {playerHitBeat && (
              <DamageNumber
                xPct={overlay.hunterMass.xPct}
                yPct={overlay.hunterMass.yPct - 6}
                value={playerHitBeat.value ?? overlay.playerDamage}
                tone="player"
                delayMs={MOVEMENT.BEAT_LUNGE_AT_MS}
              />
            )}
          </div>
        )}
        {finished && timeline.outcome && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-[38%] z-30 flex justify-center"
            initial={{ scale: 0.5, opacity: 0, y: 14 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 17 }}
            data-testid="boss-fight-banner"
          >
            <div
              className={`border-4 px-5 py-1.5 text-3xl font-black uppercase tracking-widest ${
                victory ? 'border-amber bg-black/80 text-amber' : 'border-red bg-black/80 text-red'
              }`}
              style={{ textShadow: '0 0 14px rgba(0,0,0,0.9)' }}
            >
              {victory ? 'Victory' : 'Defeated'}
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
};
