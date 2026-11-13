import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePresentationActive } from '@/hooks/usePresentationActive';
import { motion } from 'framer-motion';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Application, Container, Sprite, Texture } from 'pixi.js';
import {
  attachResumeProbeDomLifecycle,
  buildHeartbeatData,
  exposeResumeProbeSurface,
  isResumeProbeEnabled,
  logResumeProbeEvent,
} from '@/lib/pixel/resumeProbe';
import { installWebglContextRecovery } from '@/lib/pixel/webglContextRecovery';
import { CritFlash, DamageNumber } from '../PixelFx';
import { DropRiseIcon } from '@/components/dashboard/LiveTurfDiorama';
import { LootMoment } from '../LootMoment';
import { PARTS_FEET_X, PART_POSES, SKELETON, type PartSetDef } from '@/lib/pixel/parts';
import { layoutPartSet, type PartSetLayout, type PartsWeaponFractions } from '@/lib/pixel/partsCompositor';
import { composeStridePose, sampleStride } from '@/lib/pixel/strideCycle';
import {
  TRAVEL_SPECS,
  createTravelRun,
  feedTravel,
  sampleTravel,
  travelStrideSpec,
  type TravelRunState,
  type TravelSample,
} from '@/lib/pixel/travelChoreography';
import {
  DEG,
  STAGE_RESOLUTION,
  applyPartPose,
  applyPartPoseInstant,
  canvasTexture,
  circleTexture,
  createPartNodes,
  loadTexture,
  nearest,
  radialTexture,
  ringTexture,
  solidTexture,
  starTexture,
  tickPartNodes,
  tracerTexture,
  weaponTextureForWeapon,
  type PartNode,
} from './stageCore';
import { useOwnLookWithLoad } from '@/store/slices/cosmeticsSlice';
import { useLoadoutStore } from '@/store';
import { useVehicleStore } from '@/store/slices/vehicleSlice';
import { resolveGearMount, GEAR_PAINT_ORDER, type MountedGearItem } from '@/lib/pixel/gearMounts';
import { armedActorExtents, fitArmedActorHeight, partsWeaponFractionsFor } from '@/lib/pixel/partsStage';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { getPixelSprite, requirePixelSprite } from '@/lib/pixel/manifest';
import { paletteSpriteUrl, type PaletteSpec } from '@/lib/pixel/paletteSwap';
import {
  MOVEMENT,
  particleField,
  shakeKeyframes,
  type ParticleSpec,
} from '@/lib/pixel/movement';
import { EASE, sampleTrack } from '@/lib/pixel/pixiChoreography';
import {
  deriveRoamScene,
  enemyWalkAlpha,
  resolveRoamWalkFrame,
  roamPosesAt,
  withRoamWalkFrame,
  roamAnimatedNodeCount,
  sampleRoamBeat,
  type RoamSceneModel,
} from '@/lib/pixel/roamChoreography';
import type { PixelSprite } from '@/lib/pixel/manifest';
import {
  VISTA_STAGE_H,
  VISTA_STAGE_W,
  vistaSceneForBackground,
  type VistaPaintLayer,
  type VistaSceneSpec,
} from '@/lib/pixel/vistaScenes';
import {
  expandVistaAmbient,
  paintVistaAmbientLayer,
  type VistaAmbientInstance,
  type VistaClock,
} from '@/lib/pixel/vistaAmbient';
import { vistaImageMapFor } from '@/lib/pixel/vistaImages';
import type { TickEvent } from '@/store/slices/tickSlice';
import type { Weapon } from '@/types/items';

/**
 * RoamPixiStage — the PixiJS v8 renderer for the Home ROAM scene
 * (Motion Reboot M2, 2026-11-07), built on the boss pilot's
 * patterns and its shared stage core (stageCore.ts). It renders
 * the SAME scene PixelSceneLayer renders for mode 'roaming' —
 * same vista stack, same actors, same beats, same law — executed
 * continuously on one rAF clock instead of through DOM layers:
 *
 *  - the vista: one master background painting (cover + the DOM
 *    stage's own drift track sampled per frame) with the scene's
 *    ambient elements painted over it by the shared vista painter;
 *  - the hunter as a part set (layoutPartSet, the same layouts the
 *    DOM actor uses) with pose blending INCLUDING position — the
 *    M2 brief's upgrade over the pilot's rotation-only tweens —
 *    on the SEGMENT slot durations; mounted gear rides its mount
 *    part's transform; the held weapon is the One Grammar held
 *    render, swaying on PixelSway's own 3.4 s track;
 *  - the enemy as the CURRENT shipped art: the segmented band rig
 *    with ENEMY_POSES transforms sampled per frame and the area
 *    palette wash applied to its textures (the same paletteSwap
 *    data URLs PixelRigActor loads), or the area's bespoke elite
 *    flat with PixelActor's breathe;
 *  - tick beats executed through the pure samplers in
 *    roamChoreography.ts — the DOM stage's keyframe tables,
 *    value-for-value; combat FX pooled (sparks / tracers / embers
 *    / one-shots), nothing spawns per frame;
 *  - continuous life between ticks: vista drift, embers, weapon
 *    sway, the elite flat's breathe — the DOM roam hunter/rig have
 *    NO between-tick idle motion (PixelPartsActor/PixelRigActor
 *    breathe nowhere), so none is invented here.
 *
 * The pilot's DOM split holds: damage numbers and the crit flash
 * stay DOM (identical components), and ALL loot stays DOM and
 * untouched — the rises and the LootMoment render over the canvas
 * exactly as they render over the DOM stage, on their own clocks.
 * The vehicle status bars stay DOM (live store text); the vehicle
 * plates ride the canvas as static sprites.
 *
 * Presentation only — reads the same stores/events the DOM scene
 * reads, produces no gameplay outcomes. Any init/texture failure
 * reports through onPixiError and PixelSceneLayer swaps back to
 * the DOM scene.
 */

export interface RoamPixiStageProps {
  backgroundId: string;
  weapon?: Weapon;
  event?: TickEvent;
  areaId: string;
  hot?: boolean;
  targetMaxHp: number;
  currentTargetId?: string;
  /** The DOM scene's mounted-gear inputs (resolved by the seam
   *  from the same stores PixelSceneLayer reads). */
  mountedGear: MountedGearItem[];
  /** Init/texture failure seam: the wrapper swaps to the DOM scene. */
  onPixiError?: () => void;
}

// ── Roam-specific procedural textures ───────────────────────────────

/** The weather tint: skyTint at the DOM's alpha fading to
 *  transparent at the band's bottom edge. */
function tintTexture(hex: string, alphaHex: string): Texture {
  return canvasTexture((ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `${hex}${alphaHex}`);
    g.addColorStop(1, `${hex}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }, 4, 64);
}

// ── Scene graph ─────────────────────────────────────────────────────

interface GearNode {
  item: MountedGearItem;
  sprite: Sprite;
  slot: string;
  anchorStage: { x: number; y: number };
  rotationDeg: number;
  targetW: number;
  targetH: number;
}

interface RigNode {
  segId: string;
  sprite: Sprite;
  frameX: number;
  frameY: number;
  width: number;
  height: number;
  pivot: { x: number; y: number };
  z: number;
}

/** One vista ambient paint surface: an offscreen canvas painted by
 *  the shared vista painter each frame, bound to a Pixi canvas
 *  texture — the Pixi twin of the DOM stage's ambient canvases. */
interface VistaAmbientNode {
  layer: VistaPaintLayer;
  sprite: Sprite;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  texture: Texture;
}

interface Scene {
  app: Application;
  world: Container;
  vistaBase: Sprite;
  vistaAmbientNodes?: VistaAmbientNode[];
  aprops: { sprite: Sprite; index: number }[];
  hunterRoot: Container;
  hunterFrame: Container;
  parts: PartNode[];
  gear: GearNode[];
  weaponRoot?: Container;
  weaponSway?: Container;
  enemyLunge: Container;
  enemyHit: Container;
  enemyWalk: Container;
  rigRoot?: Container;
  rigSegs: RigNode[];
  flatSprite?: Sprite;
  signatureSprite?: Sprite;
  eventPropSprite?: Sprite;
  vehicleSprites: Sprite[];
  muzzle: Sprite;
  tracers: Sprite[];
  casing: Sprite;
  hitFlash: Sprite;
  telegraph: Sprite;
  redFlash: Sprite;
  dustRing: Sprite;
  statusSprite?: Sprite;
  sparks: Sprite[];
  sparkSpecs: { angle: number; dist: number }[];
  embers: Sprite[];
  emberSpecs: ParticleSpec[];
  enemySpriteDef: PixelSprite;
  /** Enemy presentation identity the stage art was built for
   *  (F6): the tick swaps the rig/flat nodes whenever the live
   *  model's key no longer matches this one. */
  enemyRigKey: string;
  readyAt: number;
}

interface RigPoseVals {
  rotate: number;
  x: number;
  y: number;
  opacity: number;
}

interface RoamRuntime {
  scene: Scene | null;
  size: { w: number; h: number };
  /** Vista clock: wall time drives the ambient life. */
  vistaClock: VistaClock;
  poseKey: string;
  /** F6: the enemy art key whose swap build is in flight (the
   *  generation guard — a superseded build is discarded). */
  pendingRigKey: string | null;
  rigPoseKey: string;
  rigCurrent: Record<string, RigPoseVals>;
  rigTweens: Record<string, { from: RigPoseVals; to: RigPoseVals; startMs: number; durationMs: number }>;
  beat: { eventId: string; startMs: number; targetKey: string | null } | null;
  walk: { targetKey: string; startMs: number } | null;
  /** The walk-in's eased approach offset, stage-width % (DEV probe
   *  surface: the anim-replay loop grades the approach from the
   *  exact staging math, not the noisy frame mask). */
  walkOffsetXPct: number;
  shake: { key: string; startMs: number; intensity: number; durationMs: number } | null;
  /** Travel beat (Motion M2b): the shared tracker run + whether
   *  the stride drove the last frame (the falling edge re-applies
   *  the beat pose — the arrival settle). */
  travel: TravelRunState;
  travelDriving: boolean;
  travelSample: TravelSample | null;
  /** The stride layout's weapon geometry while the stride drives
   *  (the held weapon rides the striding grip, not the held
   *  beat-pose layout). */
  strideWeapon: PartSetLayout['weapon'];
  fps: { lastMs: number; deltas: number[] };
  /** Resume probe heartbeat state (DEVICE-PROBE-SPEC item 3):
   *  advanced by the ticker callback only while the probe is
   *  enabled; read by the probe's 1s sampler. Diagnostic only. */
  probeTick: { lastTickAt: number | null; tickCount: number };
}

function createRoamRuntime(): RoamRuntime {
  return {
    scene: null,
    size: { w: 420, h: 286 },
    vistaClock: { wallMs: 0 },
    poseKey: '',
    pendingRigKey: null,
    rigPoseKey: '',
    rigCurrent: {},
    rigTweens: {},
    beat: null,
    walk: null,
    walkOffsetXPct: 0,
    shake: null,
    travel: createTravelRun(),
    travelDriving: false,
    travelSample: null,
    strideWeapon: undefined,
    fps: { lastMs: 0, deltas: [] },
    probeTick: { lastTickAt: null, tickCount: 0 },
  };
}

/**
 * Resume probe install (DEVICE-PROBE-SPEC items 1–3 + 5's Pixi
 * half): visibility lifecycle, Capacitor appStateChange, WebGL
 * context lost/restored on the Pixi canvas, and the 1s ticker
 * heartbeat sampler. Installed ONLY when the probe gate is on
 * (DEV build, ?resumeProbe=1, or the on-device storage flag);
 * returns the teardown that removes every listener and timer it
 * created. Diagnostic only — the contextlost preventDefault is
 * the spec's probe-only exercise of the restore path; nothing here
 * changes rendering behavior.
 */
function installRoamResumeProbe(app: Application, runtime: RoamRuntime): () => void {
  exposeResumeProbeSurface();
  const canvas = app.canvas;
  const sizeSnapshot = () => ({
    rendererW: app.renderer.width,
    rendererH: app.renderer.height,
    clientW: canvas.clientWidth,
    clientH: canvas.clientHeight,
  });
  logResumeProbeEvent('probe-init', 'pixi', sizeSnapshot());
  const detachDom = attachResumeProbeDomLifecycle('pixi');
  const onContextLost = (event: Event) => {
    // Probe ONLY (spec item 2): preventDefault asks the browser to
    // offer the restore path so the probe can observe whether it
    // ever completes on-device.
    event.preventDefault();
    logResumeProbeEvent('webglcontextlost', 'pixi', sizeSnapshot());
  };
  const onContextRestored = () => {
    logResumeProbeEvent('webglcontextrestored', 'pixi', sizeSnapshot());
  };
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  const pluginHandles: PluginListenerHandle[] = [];
  if (Capacitor.isNativePlatform()) {
    void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      logResumeProbeEvent('appStateChange', 'pixi', { isActive });
    })
      .then((handle) => {
        pluginHandles.push(handle);
      })
      .catch(() => {
        /* the DOM lifecycle rows remain the fallback record */
      });
  }
  const sampler = setInterval(() => {
    if (document.hidden) return;
    logResumeProbeEvent(
      'pixi-heartbeat',
      'pixi',
      buildHeartbeatData({
        count: runtime.probeTick.tickCount,
        lastAt: runtime.probeTick.lastTickAt,
        now: performance.now(),
        extra: { tickerStarted: app.ticker.started, hidden: document.hidden },
      }),
    );
  }, 1000);
  return () => {
    detachDom();
    canvas.removeEventListener('webglcontextlost', onContextLost);
    canvas.removeEventListener('webglcontextrestored', onContextRestored);
    clearInterval(sampler);
    for (const handle of pluginHandles) {
      try {
        void handle.remove();
      } catch {
        /* already removed */
      }
    }
  };
}

interface TickEnv {
  props: RoamPixiStageProps;
  model: RoamSceneModel;
  /** Cache each actor pose once per event; compose only the moving
   * rig bands during walk-in. No per-frame hunter-layout rebuild. */
  deriveModelAt: (walkMs: number | undefined, beatMs: number, beatForCurrentTarget?: boolean) => RoamSceneModel;
  /** The hunter's part set + held-weapon fractions (Motion M2b:
   *  the travel stride composes layouts per frame from the same
   *  inputs deriveRoamScene consumes). */
  hunterSet: PartSetDef;
  weaponFractions?: PartsWeaponFractions;
  shakeWrap: HTMLDivElement | null;
  /** V1: the authored vista scene for the current background (null
   *  for non-vista backgrounds) + its expanded ambient instances. */
  vistaScene: VistaSceneSpec | null;
  vistaInstances: VistaAmbientInstance[];
}

/** Enemy presentation identity: which art the stage must show for
 *  a model — `rig:<rigDefId>` for the segmented band rig,
 *  `flat:<spriteId>` for the bespoke flat. Derived from the model's
 *  own rig/flat resolution, so any target change that alters the
 *  art (archetype, elite-vs-standard) changes the key; a same-
 *  archetype target change leaves it alone. */
// eslint-disable-next-line react-refresh/only-export-components -- F6 seam: the tick and its regression tests share this one derivation; the stage component stays the file's default export surface
export function enemyArtKeyFor(model: RoamSceneModel): string {
  return model.rig ? `rig:${model.rig.id}` : `flat:${model.enemySpriteId}`;
}

export interface EnemyRigNodes {
  rigRoot?: Container;
  rigSegs: RigNode[];
  flatSprite?: Sprite;
  signatureSprite?: Sprite;
}

/** Build the enemy presentation nodes for a model — the scene
 *  init's enemy build, factored out so the F6 rig swap rebuilds
 *  through the exact same code (one build path, no fork): washed
 *  rig segments (the area palette wash, same as PixelRigActor
 *  loads) plus the area signature part, or the bespoke flat. The
 *  caller attaches rigRoot/flatSprite under the walk wrapper. */
async function buildEnemyNodes(args: {
  model: RoamSceneModel;
  areaId: string;
}): Promise<EnemyRigNodes> {
  const { model } = args;
  const visuals = model.visuals;
  const rigSegs: RigNode[] = [];
  if (model.rig) {
    const signatureDef = getPixelSprite(visuals.signaturePartId);
    const sigTex = signatureDef ? await loadTexture(signatureDef.url) : null;
    for (const seg of model.rig.segments) {
      const sprite = requirePixelSprite(seg.spriteId);
      const src = paletteSpriteUrl(seg.spriteId, sprite.url, args.areaId, visuals.enemyPalette);
      const tex = await loadTexture(src);
      const node: RigNode = {
        segId: seg.id,
        sprite: new Sprite(tex),
        frameX: seg.frameX,
        frameY: seg.frameY,
        width: seg.width,
        height: seg.height,
        pivot: sprite.anchors.pivot ?? { x: 0.5, y: 0.5 },
        z: seg.z,
      };
      node.sprite.anchor.set(node.pivot.x, node.pivot.y);
      node.sprite.position.set(
        node.frameX + node.pivot.x * node.width,
        node.frameY + node.pivot.y * node.height,
      );
      rigSegs.push(node);
    }
    const rigRoot = new Container();
    const sorted = [...rigSegs].sort((a, b) => a.z - b.z);
    for (const seg of sorted) rigRoot.addChild(seg.sprite);
    let signatureSprite: Sprite | undefined;
    if (sigTex) {
      signatureSprite = new Sprite(sigTex);
      signatureSprite.zIndex = 5;
      rigRoot.addChild(signatureSprite);
      rigRoot.sortableChildren = true;
    }
    return { rigRoot, rigSegs, signatureSprite };
  }
  const flatSprite = new Sprite(await loadTexture(model.enemySprite.url));
  const feet = model.enemySprite.anchors.feet ?? { x: 0.5, y: 1 };
  flatSprite.anchor.set(feet.x, feet.y);
  return { rigSegs, flatSprite };
}

/** Remove + destroy the enemy nodes being replaced. Textures are
 *  NOT destroyed: they belong to the shared Assets cache the next
 *  build loads from — destroying display objects only keeps the
 *  scene's node count flat across any number of swaps. */
function disposeEnemyNodes(nodes: EnemyRigNodes): void {
  nodes.rigRoot?.destroy({ children: true });
  nodes.flatSprite?.destroy();
}

/** F6 (2026-11-08): keep the stage's enemy art married to the
 *  CURRENT target. The scene build happens once at mount; the
 *  target does not — the rig was built for the mount's first
 *  target and every later target wore its painting while the
 *  plate named the new one (M2b evidence: "RUSTED DRONE" over a
 *  raider). When the model's art key no longer matches the built
 *  key, rebuild the enemy nodes through the same builder and swap
 *  them under the walk wrapper; texture loads are generation-
 *  guarded, so a swap superseded mid-load (A→B→A) discards its
 *  build instead of landing stale art. The DOM stage never had
 *  the defect: its rig wrapper is keyed by target id (remount). */
function syncEnemyArt(rt: RoamRuntime, env: TickEnv): void {
  const scene = rt.scene;
  if (!scene) return;
  const key = enemyArtKeyFor(env.model);
  if (scene.enemyRigKey === key) {
    rt.pendingRigKey = null;
    return;
  }
  if (rt.pendingRigKey === key) return; // this swap is already loading
  rt.pendingRigKey = key;
  const model = env.model;
  void buildEnemyNodes({ model, areaId: env.props.areaId })
    .then((nodes) => {
      if (rt.scene !== scene || rt.pendingRigKey !== key) {
        // Superseded (or the stage unmounted) while loading:
        // discard the build rather than landing stale art.
        disposeEnemyNodes(nodes);
        return;
      }
      rt.pendingRigKey = null;
      const old: EnemyRigNodes = {
        rigRoot: scene.rigRoot,
        rigSegs: scene.rigSegs,
        flatSprite: scene.flatSprite,
        signatureSprite: scene.signatureSprite,
      };
      if (nodes.rigRoot) scene.enemyWalk.addChild(nodes.rigRoot);
      if (nodes.flatSprite) scene.enemyWalk.addChild(nodes.flatSprite);
      scene.rigRoot = nodes.rigRoot;
      scene.rigSegs = nodes.rigSegs;
      scene.flatSprite = nodes.flatSprite;
      scene.signatureSprite = nodes.signatureSprite;
      scene.enemySpriteDef = model.enemySprite;
      scene.enemyRigKey = key;
      disposeEnemyNodes(old);
      // Segment pose state belongs to the retired rig: force the
      // pose block to re-derive it against the new rig rather
      // than tweening segments that no longer exist.
      rt.rigPoseKey = '';
      rt.rigCurrent = {};
      rt.rigTweens = {};
    })
    .catch(() => {
      // A texture failure mid-swap keeps the current art rather
      // than blanking the enemy; the next target change retries.
      if (rt.pendingRigKey === key) rt.pendingRigKey = null;
    });
}

/** One frame of the roam stage. Pure sampling: every transform is
 *  a function of (law constants, the DOM stage's own track tables,
 *  beat-local or raw time). */
function tickStage(rt: RoamRuntime, env: TickEnv, now: number): void {
  const scene = rt.scene;
  if (!scene) return;
  const { props } = env;
  // Walk-articulation: the walk frame is resolved FIRST, from
  // state (resolveRoamWalkFrame) — a target the stage has no
  // clock for (a fresh spawn, or one already active when the
  // stage mounted) starts its walk-in on this very frame; inside
  // the window the model is re-derived per frame with the walk
  // clock so the rig pose carries the stride delta; at/after the
  // window the frame is the SETTLED model (env.model), so the
  // enemy stays present at alpha 1 for the rest of the target's
  // life — the DOM stage's hold-at-end semantics. (The defect
  // this replaces: the resting model was the spawn instant's,
  // walkMs 0, so arrival snapped the enemy back to alpha 0.)
  // The target standing BEFORE this frame's walk state advances —
  // the target a beat starting this frame names (post-kill guard:
  // the roster may already have advanced past the enemy a kill beat
  // belongs to, inside the same claim that delivered the event).
  const prevWalkTargetKey = rt.walk?.targetKey ?? null;
  const walkTargetKey = `${props.currentTargetId ?? 'none'}|${env.model.isEliteEvent ? 'elite' : 'std'}`;
  const walkFrame = resolveRoamWalkFrame(rt.walk, walkTargetKey, now);
  rt.walk = walkFrame.walk;
  // F6: the enemy art follows the current target, not the mount's.
  syncEnemyArt(rt, env);
  const { w: W, h: H } = rt.size;
  const fps = rt.fps;
  const frameDtMs = fps.lastMs > 0 ? Math.min(100, now - fps.lastMs) : 0;
  if (fps.lastMs > 0) {
    fps.deltas.push(now - fps.lastMs);
    if (fps.deltas.length > 900) fps.deltas.shift();
  }
  fps.lastMs = now;
  const groundYPx = env.model.groundY * H;
  const px = (p: { xPct: number; yPct: number }) => ({ x: (p.xPct / 100) * W, y: (p.yPct / 100) * H });

  // ── Beat clock: a fresh event id starts its beat ──
  const eventId = props.event?.id;
  if (eventId && eventId !== 'idle-loop-ready' && rt.beat?.eventId !== eventId) {
    rt.beat = { eventId, startMs: now, targetKey: prevWalkTargetKey };
    if (env.model.beat && (env.model.beat.kind === 'shot' || env.model.beat.kind === 'crit')) {
      scene.sparkSpecs = particleField(`sparks-${eventId}`, 6).map((s, i) => ({
        angle: (i / 6) * Math.PI * 1.5 - Math.PI * 0.9,
        dist: 16 + s.swayPx + 18,
      }));
    }
  }
  const beatMs = rt.beat ? now - rt.beat.startMs : Number.POSITIVE_INFINITY;
  // Post-kill guard: the standing beat names the target that was
  // current when its event arrived. When the roster has advanced
  // past that target, the beat's enemy channels (the death pose, the
  // kill dissolve) must not land on the enemy now standing — a target
  // that did not die never inherits the death state.
  const beatForCurrentTarget = !rt.beat || rt.beat.targetKey === walkTargetKey;
  const model = env.deriveModelAt(walkFrame.walkMs, beatMs, beatForCurrentTarget);
  const beatSample = sampleRoamBeat(model.beat, Math.min(beatMs, 60_000), props.event);
  const enemyHitSample =
    model.beat?.kind === 'kill' && !beatForCurrentTarget
      ? { scale: 1, x: 0, y: 0, opacity: 1 }
      : beatSample.enemyHit;

  // Gear mounts re-resolve against a layout (DOM: the gear
  // layers re-derive and tween rotation on SEGMENT timing;
  // positions snap with the layout there — mirrored here). One
  // resolver for the pose block, the travel stride, and the
  // arrival settle, so the mounts can never disagree.
  const resolveGearFrom = (layout: PartSetLayout) => {
    for (const g of scene.gear) {
      const mount = resolveGearMount(layout, g.item);
      if (!mount) {
        g.sprite.visible = false;
        continue;
      }
      g.sprite.visible = true;
      g.slot = mount.slot;
      g.anchorStage = mount.stage;
      g.rotationDeg = mount.rotationDeg;
    }
  };

  // ── Pose: a changed pose re-applies (position blend is M2's) ──
  const poseKey = `${model.hunterPoseName}|${props.weapon?.id ?? ''}|${props.currentTargetId ?? ''}|${eventId ?? ''}`;
  if (rt.poseKey !== poseKey) {
    rt.poseKey = poseKey;
    applyPartPose(scene.parts, model.hunterLayout, now, { poseName: model.hunterPoseName, blendPositions: true });
    resolveGearFrom(model.hunterLayout);
    // The enemy walk-in clock is NOT keyed here anymore: it is
    // resolved from state at the top of the tick
    // (resolveRoamWalkFrame), so a target change starts the walk
    // on the same frame even when this pose block does not run.
  }

  // ── Travel beat (Motion Reboot M2b): the shared tracker, fed
  // this stage's own observations. This stage only mounts for
  // roaming with motion allowed, so engaged is constant-true;
  // unmount IS the cancel. The sample drives the pan rate in the
  // vista block below and the stride in the hunter block.
  feedTravel(rt.travel, TRAVEL_SPECS.advance, {
    engaged: true,
    targetKey: props.currentTargetId ?? null,
    beatKind: model.beat?.kind ?? null,
    beatEventId: props.event?.id ?? null,
    now,
  });
  const travel = sampleTravel(rt.travel, TRAVEL_SPECS.advance, env.vistaScene, now);
  rt.travelSample = travel;

  // ── Vista: cover base + drift law; parallax tracks sampled ──
  const baseTex = scene.vistaBase.texture;
  const cover = Math.max(W / baseTex.width, H / baseTex.height);
  const drift = 1.04 + 0.06 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (now % (MOVEMENT.BG_DRIFT_HALF_MS * 2))) / (MOVEMENT.BG_DRIFT_HALF_MS * 2)));
  scene.vistaBase.position.set(W / 2, H / 2);
  scene.vistaBase.width = baseTex.width * cover * drift;
  scene.vistaBase.height = baseTex.height * cover * drift;
  if (env.vistaScene) {
    // ── Vista (plain-bg): the background is one master painting
    // (cover + drift above); the ambient canvases repaint from
    // the scene data through the SHARED painter (DOM parity is
    // structural).
    rt.vistaClock.wallMs += frameDtMs;
    if (scene.vistaAmbientNodes && env.vistaInstances.length > 0) {
      const images = vistaImageMapFor(env.vistaInstances);
      for (const node of scene.vistaAmbientNodes) {
        if (!node.ctx) continue;
        if (node.canvas.width !== Math.max(2, Math.round(W)) || node.canvas.height !== Math.max(2, Math.round(H))) {
          node.canvas.width = Math.max(2, Math.round(W));
          node.canvas.height = Math.max(2, Math.round(H));
        }
        const ctx = node.ctx;
        ctx.setTransform(W / VISTA_STAGE_W, 0, 0, H / VISTA_STAGE_H, 0, 0);
        ctx.clearRect(0, 0, VISTA_STAGE_W, VISTA_STAGE_H);
        ctx.imageSmoothingEnabled = false;
        paintVistaAmbientLayer({ ctx, instances: env.vistaInstances, layer: node.layer, images, clock: rt.vistaClock });
        (node.texture.source as unknown as { update?: () => void }).update?.();
        node.sprite.width = W;
        node.sprite.height = H;
        node.sprite.position.set(0, 0);
      }
    }
  }
  // Animated props: linear left -8% → 104% over 34+17i s, delay 9i.
  // (Empty on vista scenes — the authored ambient sets supersede
  // the aprop drift system.)
  for (const ap of scene.aprops) {
    const period = (34 + ap.index * 17) * 1000;
    const delay = ap.index * 9 * 1000;
    const t = now + delay;
    const p = ((t % period) + period) % period / period;
    const tex = ap.sprite.texture;
    const pw = 44;
    const ph = pw * (tex.height / tex.width);
    ap.sprite.width = pw;
    ap.sprite.height = ph;
    ap.sprite.position.set((-0.08 + 1.12 * p) * W, ((18 + ap.index * 16) / 100) * H);
    ap.sprite.alpha = 0.85;
  }

  // ── Hunter ──
  scene.hunterRoot.position.set(
    (model.hunterPlacement.xPct / 100) * W + beatSample.hunter.x,
    groundYPx + beatSample.hunter.y,
  );
  scene.hunterRoot.scale.set(1, beatSample.hunter.scaleY);
  const nominalFrameH = (model.hunterPlacement.heightPct / 100) * H;
  let frameH = nominalFrameH;
  let frameTop = groundYPx - nominalFrameH;
  if (props.weapon && model.hunterLayout.weapon) {
    const fit = fitArmedActorHeight({
      containerW: W,
      containerH: H,
      heightPct: model.hunterPlacement.heightPct,
      xPct: model.hunterPlacement.xPct,
      groundY: model.groundY,
      extents: armedActorExtents(model.hunterLayout),
    });
    if (fit.constrained) {
      frameH = fit.heightPx;
      frameTop = fit.topPx;
    }
  }
  const frameW = frameH * (SKELETON.frameWidth / SKELETON.frameHeight);
  const s = frameH / SKELETON.frameHeight;
  scene.hunterFrame.position.set(-PARTS_FEET_X * frameW, frameTop - groundYPx);
  // ── Travel stride execution (Motion M2b) ──
  // While the beat drives, the stride layout — the M2a spec
  // sampled this frame, composed onto the 'roam' stance the beat
  // departs from — is written to the part nodes DIRECTLY (no
  // tween: the sampled pose is followed, the DOM actor's
  // duration-0-while-a-cycle-drives semantics). The frame fit
  // above stays on the held layout so the frame box never
  // breathes with the gait. When the envelope lands back at 0,
  // the beat pose re-applies through the SEGMENT blend — the
  // arrival settle onto exactly the layout the beat system holds.
  if (travel.driving) {
    rt.travelDriving = true;
    // Base pose, mirroring the DOM actor's composition exactly:
    // while the window is open the stride rides the 'roam'
    // stance the beat departs from; while it settles (a combat
    // beat preempted it) the stride decays over the CURRENT beat
    // pose, as the actor composes its ramp-out onto the pose it
    // is handed.
    const basePose = travel.active ? PART_POSES.roam : PART_POSES[model.hunterPoseName];
    const strideLayout = layoutPartSet(
      env.hunterSet,
      composeStridePose(
        sampleStride(travelStrideSpec(TRAVEL_SPECS.advance), travel.phaseMs, travel.amplitude),
        basePose,
      ),
      env.weaponFractions,
    );
    applyPartPoseInstant(scene.parts, strideLayout);
    resolveGearFrom(strideLayout);
    rt.strideWeapon = strideLayout.weapon;
  } else if (rt.travelDriving) {
    rt.travelDriving = false;
    rt.strideWeapon = undefined;
    applyPartPose(scene.parts, model.hunterLayout, now, { poseName: model.hunterPoseName, blendPositions: true });
    resolveGearFrom(model.hunterLayout);
  }
  tickPartNodes(scene.parts, now, s);
  // Gear rides its mount part's CURRENT transform (the DOM gear
  // layer is a motion.img INSIDE the actor frame with its own
  // rotate tween on the mount's rotationDeg — the layout rotation
  // of the carrying part. Here the gear sprite is a frame child:
  // its position is the mount's stage point, rotated around the
  // frame origin exactly as the part containers' transforms place
  // it, and its rotation follows the carrying part's live
  // container rotation (which tweens to the same rotationDeg).
  for (const g of scene.gear) {
    if (!g.sprite.visible) continue;
    const node = scene.parts.find((n) => n.slot === g.slot);
    if (!node) {
      g.sprite.visible = false;
      continue;
    }
    const tw = g.targetW * s;
    const th = g.targetH * s;
    g.sprite.width = tw;
    g.sprite.height = th;
    // The sprite's Pixi anchor is the item's own anchor (set at
    // build), so position = the mount's stage point; rotation =
    // the carrying part's live rotation (the DOM gear img tweens
    // its own rotate to the same rotationDeg on the same SEGMENT
    // duration — following the part's sampled value keeps them
    // locked, as they are in the DOM frame).
    g.sprite.position.set(g.anchorStage.x * s, g.anchorStage.y * s);
    g.sprite.rotation = node.container.rotation;
  }
  if (scene.weaponRoot && scene.weaponSway) {
    // While the travel stride drives, the weapon rides the
    // striding grip (the stride layout's geometry); otherwise the
    // held beat-pose layout's, as before M2b.
    const wgeo = rt.travelDriving ? rt.strideWeapon : model.hunterLayout.weapon;
    scene.weaponRoot.visible = !!wgeo;
    if (wgeo) {
      const boxW = wgeo.targetW * s;
      const boxH = wgeo.targetH * s;
      scene.weaponRoot.position.set(
        (wgeo.gripStage.x - wgeo.gripFrac.x * wgeo.targetW) * s,
        (wgeo.gripStage.y - wgeo.gripFrac.y * wgeo.targetH) * s,
      );
      scene.weaponRoot.rotation = -3 * DEG;
      // PixelSway: rotate [-1.1, 1.1, -1.1] over 3.4 s easeInOut.
      const swayDeg = -1.1 * Math.cos((2 * Math.PI * (now % 3400)) / 3400);
      scene.weaponSway.position.set(0.18 * boxW, 0.6 * boxH);
      scene.weaponSway.rotation = swayDeg * DEG;
      const weaponSprite = scene.weaponSway.children[0] as Sprite;
      weaponSprite.position.set(-0.18 * boxW, -0.6 * boxH);
      weaponSprite.width = boxW;
      weaponSprite.height = boxH;
    }
  }

  // ── Enemy ──
  // Approach staging (roamChoreography sampleEnemyWalkPose): the
  // walk wrapper rides the sampled offset — the enemy enters
  // from off-frame right and travels the full approach to its
  // settle point inside the movement law's WALK_IN_MS window.
  const walkOffsetXPct = model.enemyWalk?.offsetXPct ?? 0;
  rt.walkOffsetXPct = walkOffsetXPct;
  scene.enemyLunge.position.set((model.enemyPlacement.xPct / 100) * W + beatSample.enemyLungeX, groundYPx);
  scene.enemyHit.scale.set(enemyHitSample.scale, enemyHitSample.scale);
  scene.enemyHit.position.set(enemyHitSample.x, enemyHitSample.y);
  scene.enemyHit.alpha = enemyHitSample.opacity;
  scene.enemyWalk.position.set((walkOffsetXPct / 100) * W, 0);
  scene.enemyWalk.alpha = enemyWalkAlpha(model);
  const enemyH = (model.enemyPlacement.heightPct / 100) * H;
  if (scene.rigRoot && model.rig) {
    const rig = model.rig;
    const rigW = enemyH * (rig.frameWidth / rig.frameHeight);
    const feetX = scene.enemySpriteDef.anchors.feet?.x ?? 0.5;
    scene.rigRoot.position.set(-feetX * rigW, -enemyH);
    scene.rigRoot.scale.set(rigW / rig.frameWidth, enemyH / rig.frameHeight);
    // A changed rig pose starts per-segment tweens on the SEGMENT
    // slot durations (PixelRigActor's framer tweens, easeOut).
    const rigPoseKey = `${props.currentTargetId ?? ''}|${model.isEliteEvent}|${model.poseKey}|${eventId ?? ''}`;
    if (rt.rigPoseKey !== rigPoseKey) {
      rt.rigPoseKey = rigPoseKey;
      for (const seg of scene.rigSegs) {
        const to = model.rigPose[seg.segId] ?? {};
        const from = rt.rigCurrent[seg.segId] ?? { rotate: 0, x: 0, y: 0, opacity: 1 };
        rt.rigTweens[seg.segId] = {
          from,
          to: { rotate: to.rotate ?? 0, x: to.x ?? 0, y: to.y ?? 0, opacity: to.opacity ?? 1 },
          startMs: now,
          durationMs: seg.segId.startsWith('arm')
            ? MOVEMENT.SEGMENT.ARM_RAISE_MS
            : seg.segId === 'head'
              ? MOVEMENT.SEGMENT.HEAD_TRACK_MS
              : MOVEMENT.SEGMENT.STEP_BOB_MS,
        };
      }
    }
    for (const seg of scene.rigSegs) {
      const tween = rt.rigTweens[seg.segId];
      let vals = rt.rigCurrent[seg.segId] ?? { rotate: 0, x: 0, y: 0, opacity: 1 };
      if (tween) {
        const p = Math.max(0, Math.min(1, (now - tween.startMs) / tween.durationMs));
        const e = EASE.easeOut(p);
        vals = {
          rotate: tween.from.rotate + (tween.to.rotate - tween.from.rotate) * e,
          x: tween.from.x + (tween.to.x - tween.from.x) * e,
          y: tween.from.y + (tween.to.y - tween.from.y) * e,
          opacity: tween.from.opacity + (tween.to.opacity - tween.from.opacity) * e,
        };
        if (p >= 1) delete rt.rigTweens[seg.segId];
      }
      rt.rigCurrent[seg.segId] = vals;
      // The sprite's Pixi anchor is its manifest pivot: position =
      // the pivot's frame point + the pose offset; rotation around
      // it — PixelRigActor's exact transform shape.
      seg.sprite.position.set(
        seg.frameX + seg.pivot.x * seg.width + vals.x,
        seg.frameY + seg.pivot.y * seg.height + vals.y,
      );
      seg.sprite.rotation = vals.rotate * DEG;
      seg.sprite.alpha = vals.opacity;
      seg.sprite.width = seg.width;
      seg.sprite.height = seg.height;
    }
    if (scene.signatureSprite) {
      scene.signatureSprite.position.set(0.38 * rig.frameWidth, 0.26 * rig.frameHeight);
      const sigW = 0.18 * rig.frameWidth;
      scene.signatureSprite.width = sigW;
      scene.signatureSprite.height = sigW * (scene.signatureSprite.texture.height / scene.signatureSprite.texture.width);
    }
  }
  if (scene.flatSprite) {
    const def = scene.enemySpriteDef;
    const fw = enemyH * (def.width / def.height);
    // Breathe (PixelActor): scaleY 1↔1.015 over breatheDuration
    // (3.1 s for boss/elite flats) around the feet anchor — the
    // sprite's Pixi anchor IS its feet anchor, so scaling keeps
    // ground contact exactly as the DOM wrapper does.
    const breathe = 1 + 0.015 * (0.5 - 0.5 * Math.cos((2 * Math.PI * (now % 3100)) / 3100));
    scene.flatSprite.width = fw;
    scene.flatSprite.height = enemyH;
    scene.flatSprite.scale.set(1, breathe);
    scene.flatSprite.position.set(0, 0);
  }

  // ── Combat FX (beat-clock sampled) ──
  const beat = model.beat;
  const muzzlePx = px(model.muzzle);
  const gripPx = px(model.grip);
  const enemyMassPx = px(model.enemyMass);
  const enemyFeetPx = px(model.enemyFeet);
  const showShot = !!beat && (beat.kind === 'shot' || beat.kind === 'crit') && beatMs < MOVEMENT.IMPACT_SPARKS_MS + 400;
  scene.muzzle.visible = showShot && beatMs < MOVEMENT.MUZZLE_FLASH_MS;
  if (scene.muzzle.visible) {
    const spec = { durationMs: MOVEMENT.MUZZLE_FLASH_MS, ease: EASE.easeOut };
    const size = 34 * model.dialect.muzzleScale;
    const sc = sampleTrack(beatMs, { ...spec, keys: [0.4, 1.15, 0.8] });
    scene.muzzle.position.set(muzzlePx.x, muzzlePx.y);
    scene.muzzle.width = size * sc;
    scene.muzzle.height = size * sc;
    scene.muzzle.rotation = sampleTrack(beatMs, { ...spec, keys: [-12, 8, 20] }) * DEG;
    scene.muzzle.alpha = sampleTrack(beatMs, { ...spec, keys: [0, 1, 0] });
    scene.muzzle.tint = model.dialect.muzzleColor;
  }
  scene.tracers.forEach((tracer, i) => {
    const active = showShot && i < model.cadence.tracerCount && beatMs < MOVEMENT.TRACER_MS;
    tracer.visible = active;
    if (!active) return;
    const offset = (i - (model.cadence.tracerCount - 1) / 2) * model.cadence.spreadPct;
    const toY = enemyMassPx.y + (offset / 100) * H;
    const dx = enemyMassPx.x - muzzlePx.x;
    const dy = toY - muzzlePx.y;
    tracer.position.set(muzzlePx.x, muzzlePx.y);
    tracer.width = Math.hypot(dx, dy);
    tracer.height = model.dialect.tracerWidth;
    tracer.rotation = Math.atan2(dy, dx);
    tracer.alpha = sampleTrack(beatMs, { keys: [0, 1, 0], durationMs: MOVEMENT.TRACER_MS, ease: EASE.linear });
    tracer.tint = model.dialect.tracerColor;
  });
  scene.casing.visible = showShot && beatMs < MOVEMENT.SHELL_CASING_MS;
  if (scene.casing.visible) {
    const spec = { durationMs: MOVEMENT.SHELL_CASING_MS, times: [0, 0.45, 1], ease: EASE.easeOut };
    scene.casing.position.set(
      gripPx.x + sampleTrack(beatMs, { ...spec, keys: [-2, -14, -22] }),
      gripPx.y + sampleTrack(beatMs, { ...spec, keys: [-6, 2, 16] }),
    );
    scene.casing.rotation = sampleTrack(beatMs, { ...spec, keys: [0, -140, -260] }) * DEG;
    scene.casing.alpha = sampleTrack(beatMs, { ...spec, keys: [1, 1, 0] });
  }
  const sparksActive = showShot && beatMs < MOVEMENT.IMPACT_SPARKS_MS;
  scene.sparks.forEach((spark, i) => {
    spark.visible = sparksActive;
    if (!sparksActive) return;
    const spec = scene.sparkSpecs[i];
    const e = EASE.easeOut(Math.max(0, Math.min(1, beatMs / MOVEMENT.IMPACT_SPARKS_MS)));
    spark.position.set(enemyMassPx.x + Math.cos(spec.angle) * spec.dist * e, enemyMassPx.y + Math.sin(spec.angle) * spec.dist * e + 6 * e);
    spark.rotation = spec.angle;
    spark.alpha = 1 - e;
    spark.tint = model.dialect.impactColor;
  });
  scene.hitFlash.visible = showShot && beatMs < MOVEMENT.HIT_REACTION_MS;
  if (scene.hitFlash.visible) {
    scene.hitFlash.position.set(enemyMassPx.x, enemyMassPx.y);
    scene.hitFlash.width = 96;
    scene.hitFlash.height = 96;
    scene.hitFlash.alpha = sampleTrack(beatMs, { keys: [0, 0.45, 0], durationMs: MOVEMENT.HIT_REACTION_MS });
  }
  if (scene.statusSprite) {
    // The DOM status overlay is a static img inside the beat div:
    // it does NOT fade — it stays on the enemy's center mass for
    // as long as the shot/crit beat is the current beat (until
    // the next tick event replaces it). Matched exactly.
    scene.statusSprite.visible = !!beat && (beat.kind === 'shot' || beat.kind === 'crit');
    if (scene.statusSprite.visible) {
      scene.statusSprite.position.set(enemyMassPx.x - 22, enemyMassPx.y - 22);
      scene.statusSprite.width = 44;
      scene.statusSprite.height = 44;
      scene.statusSprite.alpha = 0.9;
    }
  }
  scene.telegraph.visible = !!beat && beat.kind === 'playerHit' && beatMs < MOVEMENT.TELEGRAPH_MS;
  if (scene.telegraph.visible) {
    const spec = { durationMs: MOVEMENT.TELEGRAPH_MS, ease: EASE.easeInOut };
    const sc = sampleTrack(beatMs, { ...spec, keys: [0.7, 1.05, 0.95, 1.15] });
    scene.telegraph.position.set(enemyMassPx.x, enemyMassPx.y);
    scene.telegraph.width = 110 * sc;
    scene.telegraph.height = 110 * sc;
    scene.telegraph.alpha = sampleTrack(beatMs, { ...spec, keys: [0, 0.9, 0.55, 1] });
  }
  // Red stage flash (playerHit): opacity [0,0,1,0] over
  // TELEGRAPH+300 with times [0,.55,.7,1], color #FF0000 at 12%.
  scene.redFlash.visible = !!beat && beat.kind === 'playerHit' && beatMs < MOVEMENT.TELEGRAPH_MS + 300;
  if (scene.redFlash.visible) {
    scene.redFlash.width = W;
    scene.redFlash.height = H;
    scene.redFlash.alpha =
      0.12 * sampleTrack(beatMs, { keys: [0, 0, 1, 0], times: [0, 0.55, 0.7, 1], durationMs: MOVEMENT.TELEGRAPH_MS + 300, ease: EASE.ease });
  }
  scene.dustRing.visible = !!beat && beat.kind === 'kill' && beatMs >= 120 && beatMs < 120 + MOVEMENT.DUST_RING_MS;
  if (scene.dustRing.visible) {
    const local = beatMs - 120;
    const spec = { durationMs: MOVEMENT.DUST_RING_MS, ease: EASE.easeOut };
    const sc = sampleTrack(local, { ...spec, keys: [0.3, 2.6, 3.6] });
    scene.dustRing.position.set(enemyFeetPx.x, enemyFeetPx.y);
    scene.dustRing.width = 30 * sc;
    scene.dustRing.height = 12 * sc;
    scene.dustRing.alpha = sampleTrack(local, { ...spec, keys: [0, 0.75, 0] });
  }
  // ── Embers (ambient, raw clock) ──
  scene.embers.forEach((ember, i) => {
    const spec = scene.emberSpecs[i];
    const t01 = ((now + spec.delayMs) % spec.durationMs) / spec.durationMs;
    ember.position.set((spec.xPct / 100) * W + spec.swayPx * t01, H + 6 - 320 * t01 - spec.size);
    ember.alpha = sampleTrack(t01 * 1000, { keys: [0, spec.opacity, 0], times: [0, 0.25, 1], durationMs: 1000, ease: EASE.linear });
  });

  // ── Shake on the stage container (DOM wrapper transform) ──
  const shakeWrap = env.shakeWrap;
  if (shakeWrap) {
    const desired = model.shake;
    if (desired && rt.shake?.key !== desired.key) {
      rt.shake = { key: desired.key, startMs: now, intensity: desired.intensity, durationMs: desired.durationMs };
      if (import.meta.env.DEV) {
        const w = window as unknown as { __roamPixiShakeEvents?: { key: string; atMs: number; durationMs: number }[] };
        w.__roamPixiShakeEvents = [...(w.__roamPixiShakeEvents ?? []), { key: desired.key, atMs: now, durationMs: desired.durationMs }];
      }
    }
    const st = rt.shake;
    if (st && desired) {
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
    const w = window as unknown as { __cybercacheRoamPixiStage?: unknown };
    w.__cybercacheRoamPixiStage = {
      mode: 'roaming',
      beatKind: model.beat?.kind ?? null,
      eventId: props.event?.id ?? null,
      beatMs: Number.isFinite(beatMs) ? Math.round(beatMs) : null,
      pose: model.hunterPoseName,
      /** F6: the enemy art key the stage currently SHOWS (the
       *  regression probe: it must follow the target's key). */
      enemyRig: scene.enemyRigKey,
      /** Approach staging: the enemy's live placement (settle
       *  point + walk-in offset) — the anim-replay loop's exact
       *  approach measure. */
      enemyXPct: Number((model.enemyPlacement.xPct + rt.walkOffsetXPct).toFixed(2)),
      walkOffsetXPct: Number(rt.walkOffsetXPct.toFixed(2)),
      travel: rt.travelSample
        ? {
            active: rt.travelSample.active,
            driving: rt.travelSample.driving,
            amplitude: Number(rt.travelSample.amplitude.toFixed(3)),
            phaseMs: Math.round(rt.travelSample.phaseMs),
            panRate: Number(rt.travelSample.panRate.toFixed(2)),
          }
        : null,
      nodeCount: roamAnimatedNodeCount({
        partCount: scene.parts.length,
        gearCount: scene.gear.length,
        armed: !!scene.weaponRoot,
        enemySegments: scene.rigSegs.length || 1,
        vista: !!env.vistaScene,
      }),
      fpsAvg: avg > 0 ? 1000 / avg : 0,
      frameDeltas: [...deltas],
    };
  }
}

/**
 * Palette warm-up: paletteSpriteUrl computes its wash ASYNC (the
 * first call returns the base art; the data URL lands in cache for
 * the next mount — PixelRigActor/PixelPartsActor preload and
 * re-render into the converged state). The Pixi stage bakes
 * textures once, so it waits for the cache to converge BEFORE
 * loading: the stage shows the same washed art the DOM stage
 * settles into, from its first frame. Falls back to the base art
 * URL if the compute never lands (the DOM's first-paint state).
 */
async function warmPaletteUrl(spriteId: string, sourceUrl: string, paletteId: string, spec: PaletteSpec): Promise<string> {
  let url = paletteSpriteUrl(spriteId, sourceUrl, paletteId, spec);
  for (let i = 0; i < 120 && !url.startsWith('data:'); i += 1) {
    await new Promise((r) => setTimeout(r, 25));
    url = paletteSpriteUrl(spriteId, sourceUrl, paletteId, spec);
  }
  return url;
}

export const RoamPixiStage: React.FC<RoamPixiStageProps> = (props) => {
  const presentationActive = usePresentationActive();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const shakeWrapRef = useRef<HTMLDivElement | null>(null);
  const look = useOwnLookWithLoad();
  const runtimeRef = useRef<RoamRuntime | null>(null);
  const envRef = useRef<TickEnv | null>(null);
  const [failed, setFailed] = useState(false);
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    const app = runtimeRef.current?.scene?.app;
    if (!app) return;
    if (presentationActive) app.start();
    else app.stop();
  }, [presentationActive, sceneReady]);

  const model = useMemo(
    () =>
      deriveRoamScene({
        backgroundId: props.backgroundId,
        areaId: props.areaId,
        weapon: props.weapon,
        event: props.event,
        targetMaxHp: props.targetMaxHp,
        currentTargetId: props.currentTargetId,
        hunterSet: look.set,
        // The walk clock lives in the stage runtime (per-frame);
        // the model handed to the seed build — and the tick's
        // resting frame — is the SETTLED model (no walkMs): the
        // enemy at its settle point, alpha 1. Each tick re-derives
        // with the live walkMs only inside the walk-in window
        // (resolveRoamWalkFrame). A spawn-instant model here
        // (walkMs 0) made arrival snap the enemy back to alpha 0.
      }),
    [props.backgroundId, props.areaId, props.weapon, props.event, props.targetMaxHp, props.currentTargetId, look.set],
  );

  const vistaScene = useMemo(() => vistaSceneForBackground(props.backgroundId), [props.backgroundId]);
  const vistaInstances = useMemo(
    () => (vistaScene ? expandVistaAmbient(vistaScene) : []),
    [vistaScene],
  );

  useEffect(() => {
    const poseModels = new Map([[model.poseKey, model]]);
    envRef.current = {
      props,
      model,
      deriveModelAt: (walkMs, beatMs, beatForCurrentTarget) => {
        const key = roamPosesAt(model.beat, !!props.weapon, beatMs, { beatForCurrentTarget }).key;
        let frame = poseModels.get(key);
        if (!frame) {
          frame = deriveRoamScene({
          backgroundId: props.backgroundId,
          areaId: props.areaId,
          weapon: props.weapon,
          event: props.event,
          targetMaxHp: props.targetMaxHp,
          currentTargetId: props.currentTargetId,
          hunterSet: look.set,
            beatElapsedMs: beatMs,
            beatForCurrentTarget,
          });
          poseModels.set(key, frame);
        }
        return withRoamWalkFrame(frame, walkMs);
      },
      hunterSet: look.set,
      weaponFractions: props.weapon
        ? partsWeaponFractionsFor(pixelWeaponInputFromWeapon(props.weapon))
        : undefined,
      shakeWrap: shakeWrapRef.current,
      vistaScene,
      vistaInstances,
    };
  });

  useEffect(() => {
    if (failed) props.onPixiError?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);

  useEffect(() => {
    let cancelled = false;
    let app: Application | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let probeCleanup: (() => void) | null = null;
    let contextRecoveryCleanup: (() => void) | null = null;
    const probeEnabled = isResumeProbeEnabled();
    const runtime = (runtimeRef.current ??= createRoamRuntime());
    const init = async () => {
      const host = hostRef.current;
      const env = envRef.current;
      if (!host || !env) return;
      const initialProps = env.props;
      const initialModel = env.model;
      const w = host.clientWidth || 420;
      const h = host.clientHeight || 286;
      runtime.size = { w, h };

      const background = requirePixelSprite(initialProps.backgroundId);
      const visuals = initialModel.visuals;
      // V1: an authored vista scene supersedes the aprop drift
      // system (its ambient sets carry the aprops' successors).
      const vistaScene = vistaSceneForBackground(initialProps.backgroundId);
      const apropDefs = vistaScene
        ? []
        : visuals.animatedProps
            .map((id) => getPixelSprite(id))
            .filter((d): d is PixelSprite => !!d);
      const pennantDef = initialProps.hot ? getPixelSprite('prop-hot-pennant') : undefined;
      const vehicle = useLoadoutStore.getState().getVehicle();
      const vehicleDef = vehicle ? getPixelSprite(`vehicle-${vehicle.vehicleClassId.replace(/_/g, '-')}`) : undefined;
      const vehicleAffixDefs = vehicle
        ? [
            vehicle.affixes.some((a) => a.stat === 'vehicleCargoPct') ? getPixelSprite('vehicle-affix-cargo-rack') : undefined,
            vehicle.affixes.some((a) => a.stat === 'vehicleScannerPct') ? getPixelSprite('vehicle-affix-scanner-array') : undefined,
            vehicle.affixes.some((a) => a.stat === 'vehicleFramePct') ? getPixelSprite('vehicle-affix-reinforced-frame') : undefined,
            vehicle.conditionCurrent / Math.max(1, vehicle.conditionMax) < 0.35 ? getPixelSprite('vehicle-condition-scuff') : undefined,
          ].filter((d): d is PixelSprite => !!d)
        : [];
      const eventPropDef = initialModel.eventPropId ? getPixelSprite(initialModel.eventPropId) : undefined;
      const statusDef = getPixelSprite(initialModel.dialect.statusSpriteId);

      const [bgTex, weaponTex] = await Promise.all([
        loadTexture(background.url),
        weaponTextureForWeapon(initialProps.weapon),
      ]);
      // Warm the palette cache (part tints, gear tints, the enemy
      // wash) so every texture below loads the converged art.
      const warmJobs: Promise<string>[] = [];
      if (look.partPalettes) {
        for (const slot of Object.keys(look.partPalettes) as (keyof typeof look.partPalettes)[]) {
          const pp = look.partPalettes[slot];
          const spriteId = initialModel.hunterLayout.placements[slot as keyof typeof initialModel.hunterLayout.placements]?.part.spriteId;
          if (pp && spriteId) {
            warmJobs.push(warmPaletteUrl(spriteId, requirePixelSprite(spriteId).url, pp.paletteId, pp.spec));
          }
        }
      }
      for (const item of initialProps.mountedGear) {
        if (item.tint && item.tintKey) {
          warmJobs.push(warmPaletteUrl(item.spriteId, requirePixelSprite(item.spriteId).url, item.tintKey, item.tint));
        }
      }
      if (initialModel.rig) {
        for (const seg of initialModel.rig.segments) {
          warmJobs.push(warmPaletteUrl(seg.spriteId, requirePixelSprite(seg.spriteId).url, initialProps.areaId, visuals.enemyPalette));
        }
      }
      await Promise.all(warmJobs);
      if (cancelled) return;
      const partNodes = await createPartNodes({ layout: initialModel.hunterLayout, partPalettes: look.partPalettes });
      // Gear textures (tinted via the same palette cache the DOM uses).
      const gearNodes: GearNode[] = [];
      for (const item of initialProps.mountedGear) {
        const sprite = requirePixelSprite(item.spriteId);
        const src = item.tint
          ? paletteSpriteUrl(item.spriteId, sprite.url, item.tintKey!, item.tint)
          : sprite.url;
        const tex = await loadTexture(src);
        const mount = resolveGearMount(initialModel.hunterLayout, item);
        if (!mount) continue;
        const gearSprite = new Sprite(tex);
        gearSprite.anchor.set(item.anchor.x, item.anchor.y);
        gearNodes.push({
          item,
          sprite: gearSprite,
          slot: mount.slot,
          anchorStage: mount.stage,
          rotationDeg: mount.rotationDeg,
          targetW: item.width,
          targetH: (item.width * sprite.height) / sprite.width,
        });
      }
      // Enemy nodes: washed rig segments or the flat — built by
      // the shared builder the F6 target swap also uses.
      const enemyNodes = await buildEnemyNodes({ model: initialModel, areaId: initialProps.areaId });
      const [statusTex, eventPropTex, pennantTex] = await Promise.all([
        statusDef ? loadTexture(statusDef.url) : Promise.resolve(null),
        eventPropDef ? loadTexture(eventPropDef.url) : Promise.resolve(null),
        pennantDef ? loadTexture(pennantDef.url) : Promise.resolve(null),
      ]);
      const apropTex = await Promise.all(apropDefs.map((d) => loadTexture(d.url)));
      const vehicleTex = vehicleDef ? await loadTexture(vehicleDef.url) : null;
      const vehicleAffixTex = await Promise.all(vehicleAffixDefs.map((d) => loadTexture(d.url)));
      if (cancelled) return;

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
      // X-01/A-07: a lost WebGL context must not freeze the stage —
      // route to the DOM fallback (same as an init failure). Wired
      // unconditionally; the resume probe's own handler is separate
      // and probe-gated.
      contextRecoveryCleanup = installWebglContextRecovery(app.canvas, {
        onContextLost: () => {
          if (!cancelled) setFailed(true);
        },
      });

      const world = new Container();
      app.stage.addChild(world);
      const vistaBase = new Sprite(bgTex);
      vistaBase.anchor.set(0.5, 0.5);
      world.addChild(vistaBase);
      const vistaAmbientNodes: VistaAmbientNode[] = [];
      const mkAmbientNode = (layerId: VistaPaintLayer): VistaAmbientNode => {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.round(w));
        canvas.height = Math.max(2, Math.round(h));
        const texture = nearest(Texture.from(canvas));
        const sprite = new Sprite(texture);
        sprite.width = w;
        sprite.height = h;
        return { layer: layerId, sprite, canvas, ctx: canvas.getContext('2d'), texture };
      };
      if (vistaScene) {
        // One ambient canvas per behind-actors paint layer, in
        // world order over the base painting.
        for (const layerId of ['far', 'mid', 'near'] as VistaPaintLayer[]) {
          const node = mkAmbientNode(layerId);
          world.addChild(node.sprite);
          vistaAmbientNodes.push(node);
        }
      }
      // Weather tint band (top 46%).
      const tint = new Sprite(tintTexture(visuals.skyTint, initialProps.hot ? '55' : '2e'));
      tint.width = w;
      tint.height = 0.46 * h;
      world.addChild(tint);
      const aprops = apropTex.map((tex, i) => {
        const sp = new Sprite(tex);
        sp.alpha = 0.85;
        world.addChild(sp);
        return { sprite: sp, index: i };
      });
      if (pennantTex) {
        const pen = new Sprite(pennantTex);
        pen.width = 40;
        pen.height = 40 * (pennantTex.height / pennantTex.width);
        pen.position.set(w - 8 - 40, 8);
        world.addChild(pen);
      }
      // Vehicle plates (static; status bars stay DOM).
      const vehicleSprites: Sprite[] = [];
      if (vehicleTex && vehicleDef) {
        const vw = 0.21 * w;
        const vh = vw * (vehicleDef.height / vehicleDef.width);
        const vy = h - (1 - initialModel.groundY) * h - 0.01 * h - vh;
        const vsp = new Sprite(vehicleTex);
        vsp.width = vw;
        vsp.height = vh;
        vsp.position.set(0.01 * w, vy);
        world.addChild(vsp);
        vehicleSprites.push(vsp);
        for (const atex of vehicleAffixTex) {
          const asp = new Sprite(atex);
          asp.width = vw;
          asp.height = vh;
          asp.position.set(0.01 * w, vy);
          world.addChild(asp);
          vehicleSprites.push(asp);
        }
      }
      // Event prop (mid-stage, PixelActor placement x52 h23).
      let eventPropSprite: Sprite | undefined;
      if (eventPropTex && eventPropDef) {
        eventPropSprite = new Sprite(eventPropTex);
        const ph = 0.23 * h;
        const pw = ph * (eventPropDef.width / eventPropDef.height);
        const feet = eventPropDef.anchors.feet ?? { x: 0.5, y: 1 };
        eventPropSprite.width = pw;
        eventPropSprite.height = ph;
        eventPropSprite.position.set(0.52 * w - feet.x * pw, initialModel.groundY * h - feet.y * ph);
        world.addChild(eventPropSprite);
      }
      if (initialModel.isEliteEvent) {
        const bannerDef = getPixelSprite('prop-elite-banner');
        if (bannerDef) {
          const btex = await loadTexture(bannerDef.url);
          if (!cancelled) {
            const bsp = new Sprite(btex);
            const bh = 0.26 * h;
            const bw = bh * (bannerDef.width / bannerDef.height);
            const feet = bannerDef.anchors.feet ?? { x: 0.5, y: 1 };
            bsp.width = bw;
            bsp.height = bh;
            bsp.position.set(0.88 * w - feet.x * bw, initialModel.groundY * h - feet.y * bh);
            world.addChild(bsp);
          }
        }
      }
      // Hunter.
      const hunterRoot = new Container();
      const hunterFrame = new Container();
      hunterRoot.addChild(hunterFrame);
      world.addChild(hunterRoot);
      for (const node of partNodes) hunterFrame.addChild(node.container);
      for (const g of gearNodes) {
        g.sprite.zIndex = GEAR_PAINT_ORDER;
        hunterFrame.addChild(g.sprite);
      }
      hunterFrame.sortableChildren = true;
      let weaponRoot: Container | undefined;
      let weaponSway: Container | undefined;
      if (weaponTex && initialModel.hunterLayout.weapon) {
        weaponRoot = new Container();
        weaponRoot.zIndex = 10; // WEAPON_PAINT_ORDER
        weaponSway = new Container();
        const weaponSprite = new Sprite(weaponTex);
        weaponSprite.name = 'weaponSprite';
        weaponSway.addChild(weaponSprite);
        weaponRoot.addChild(weaponSway);
        hunterFrame.addChild(weaponRoot);
      }
      // Enemy: lunge → hit → walk-in → rig root (frame space) or flat.
      const enemyLunge = new Container();
      const enemyHit = new Container();
      const enemyWalk = new Container();
      enemyHit.addChild(enemyWalk);
      enemyLunge.addChild(enemyHit);
      world.addChild(enemyLunge);
      const { rigRoot, flatSprite, signatureSprite } = enemyNodes;
      if (rigRoot) enemyWalk.addChild(rigRoot);
      if (flatSprite) enemyWalk.addChild(flatSprite);
      // FX layer.
      const fx = new Container();
      world.addChild(fx);
      const mkSprite = (tex: Texture, anchorX = 0.5, anchorY = 0.5) => {
        const sp = new Sprite(tex);
        sp.anchor.set(anchorX, anchorY);
        sp.visible = false;
        fx.addChild(sp);
        return sp;
      };
      const telegraph = mkSprite(radialTexture());
      const redFlash = new Sprite(solidTexture('#FF0000'));
      redFlash.visible = false;
      world.addChild(redFlash);
      const dustRing = mkSprite(ringTexture());
      const hitFlash = mkSprite(circleTexture('#FFFFFF'));
      const muzzle = mkSprite(starTexture());
      muzzle.tint = initialModel.dialect.muzzleColor;
      const tracers = Array.from({ length: 4 }, () => {
        const t = mkSprite(tracerTexture(), 0, 0.5);
        t.tint = initialModel.dialect.tracerColor;
        return t;
      });
      const casing = mkSprite(solidTexture('#E8B33C'));
      casing.width = 5;
      casing.height = 8;
      const sparkTex = solidTexture('#FFFFFF');
      const sparks = Array.from({ length: 6 }, () => {
        const sp = mkSprite(sparkTex);
        sp.width = 7;
        sp.height = 2.5;
        sp.tint = initialModel.dialect.impactColor;
        return sp;
      });
      let statusSprite: Sprite | undefined;
      if (statusTex) {
        statusSprite = new Sprite(statusTex);
        statusSprite.visible = false;
        fx.addChild(statusSprite);
      }
      const emberTex = circleTexture('#FFB35C');
      // On vista scenes the authored ambient sets carry the ember
      // life (the dustwaste ember row IS the PixelEmbers spec), so
      // the procedural pool stands down.
      const emberSpecs = vistaScene ? [] : particleField(`embers-${initialProps.backgroundId}`, MOVEMENT.EMBER_COUNT);
      const embers: Sprite[] = emberSpecs.map((spec) => {
        const sp = new Sprite(emberTex);
        sp.width = spec.size;
        sp.height = spec.size;
        world.addChild(sp);
        return sp;
      });
      // The vista stage-space ambient canvas rides over everything
      // (foreground particles), as on the DOM stage.
      if (vistaScene) {
        const node = mkAmbientNode('stage');
        world.addChild(node.sprite);
        vistaAmbientNodes.push(node);
      }

      const scene: Scene = {
        app,
        world,
        vistaBase,
        vistaAmbientNodes: vistaScene ? vistaAmbientNodes : undefined,
        aprops,
        hunterRoot,
        hunterFrame,
        parts: partNodes,
        gear: gearNodes,
        weaponRoot,
        weaponSway,
        enemyLunge,
        enemyHit,
        enemyWalk,
        rigRoot,
        rigSegs: enemyNodes.rigSegs,
        flatSprite,
        signatureSprite,
        eventPropSprite,
        vehicleSprites,
        muzzle,
        tracers,
        casing,
        hitFlash,
        telegraph,
        redFlash,
        dustRing,
        statusSprite,
        sparks,
        sparkSpecs: particleField(`sparks-${initialProps.event?.id ?? 'none'}`, 6).map((s, i) => ({
          angle: (i / 6) * Math.PI * 1.5 - Math.PI * 0.9,
          dist: 16 + s.swayPx + 18,
        })),
        embers,
        emberSpecs,
        enemySpriteDef: initialModel.enemySprite,
        enemyRigKey: enemyArtKeyFor(initialModel),
        readyAt: performance.now(),
      };
      runtime.scene = scene;
      runtime.poseKey = '';
      setSceneReady(true);
      app.ticker.add(() => {
        const now = performance.now();
        if (probeEnabled) {
          runtime.probeTick.tickCount += 1;
          runtime.probeTick.lastTickAt = now;
        }
        const tickEnv = envRef.current;
        if (tickEnv) tickStage(runtime, tickEnv, now);
      });
      if (probeEnabled && app) {
        try {
          probeCleanup = installRoamResumeProbe(app, runtime);
        } catch {
          // A diagnostic probe must never fail the stage it
          // observes: a broken install means no probe, not a
          // fallback renderer.
          probeCleanup = null;
        }
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(() => {
          const nw = host.clientWidth;
          const nh = host.clientHeight;
          if (probeEnabled) {
            // Spec item 5: every observer fire is a row, zeros
            // included — a resume that resizes without the
            // observer firing is visible as a gap in this series.
            logResumeProbeEvent('resize', 'pixi', { w: nw, h: nh });
          }
          if (nw > 0 && nh > 0 && app) {
            runtime.size = { w: nw, h: nh };
            app.renderer.resize(nw, nh);
          }
        });
        resizeObserver.observe(host);
      }
    };
    init().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      contextRecoveryCleanup?.();
      probeCleanup?.();
      resizeObserver?.disconnect();
      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
      runtime.scene = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (failed) return null;
  const lootRise = sceneReady ? model.lootRise : null;
  const dropItem = sceneReady ? model.dropItem : null;
  const beat = model.beat;
  const showBeatOverlay = sceneReady && !!beat && (beat.kind === 'shot' || beat.kind === 'crit' || beat.kind === 'playerHit');
  return (
    <div className="absolute inset-0 overflow-hidden" data-testid="roam-pixi-stage" data-renderer="pixi">
      <div ref={shakeWrapRef} className="absolute inset-0">
        <div ref={hostRef} className="absolute inset-0" data-testid="pixel-diorama-stage" data-ground-y={model.groundY} />
        {/* Vehicle status bars (DOM: live store text over the
            canvas's static vehicle plates). */}
        <RoamVehicleStatusBar groundY={model.groundY} />
        {/* Beat overlay: damage numbers + crit flash — the
            identical DOM components the DOM stage renders, gated
            on scene readiness so numbers land on the canvas beat. */}
        {showBeatOverlay && props.event && (
          <div key={`beat-${props.event.id}`} className="absolute inset-0" data-testid="diorama-beat-fx">
            {(beat.kind === 'shot' || beat.kind === 'crit') && (
              <DamageNumber xPct={model.enemyMass.xPct} yPct={model.enemyMass.yPct - 6} value={beat.value ?? 0} crit={beat.kind === 'crit'} />
            )}
            {beat.kind === 'crit' && <CritFlash />}
            {beat.kind === 'playerHit' && (
              <DamageNumber xPct={model.hunterMass.xPct} yPct={model.hunterMass.yPct - 6} value={beat.value ?? 0} tone="player" delayMs={MOVEMENT.TELEGRAPH_MS} />
            )}
          </div>
        )}
        {/* Loot — ALL DOM, untouched: the rises and the LootMoment
            render over the canvas on their own clocks, exactly as
            over the DOM stage. Gated on scene readiness so a rise
            never plays over the fallback-blank canvas. */}
        {lootRise && lootRise !== 'crate' && props.event && (
          <motion.div
            key={`loot-rise-${props.event.id}`}
            data-testid="diorama-loot-rise"
            data-loot-visual={lootRise}
            className="pointer-events-none absolute z-20"
            style={{
              left: `${model.enemyLoot.xPct}%`,
              top: `${model.enemyLoot.yPct}%`,
              width: 46,
              height: 58,
              marginLeft: -23,
              marginTop: -40,
            }}
            initial={{ y: 6, opacity: 0, scale: 0.6 }}
            animate={{ y: -30, opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }}
            transition={{ duration: 1.6, ease: 'easeOut', times: [0, 0.2, 0.7, 1] }}
          >
            <DropRiseIcon tone={lootRise === 'scrap' || lootRise === 'credits' ? 'cash' : lootRise} label={lootRise === 'scrap' ? 'scrap' : props.event.label} />
          </motion.div>
        )}
        {lootRise === 'crate' && props.event && (
          <CrateRise key={`loot-${props.event.id}`} lootPoint={model.enemyLoot} />
        )}
        {dropItem && props.event && (
          <LootMoment
            key={`loot-moment-${props.event.id}`}
            items={[dropItem]}
            surface="feed"
            reduced={false}
            anchorXPct={model.enemyLoot.xPct}
            groundYPct={model.enemyFeet.yPct}
            testId="diorama-loot-moment"
          />
        )}
      </div>
    </div>
  );
};


const CrateRise: React.FC<{ lootPoint: { xPct: number; yPct: number } }> = () => {
  const crate = getPixelSprite('crate');
  if (!crate) return null;
  return (
    <motion.img
      data-testid="diorama-crate-rise"
      src={crate.url}
      alt=""
      draggable={false}
      className="pointer-events-none absolute z-20"
      style={{ left: '64%', bottom: '12%', width: 54, imageRendering: 'pixelated' }}
      initial={{ y: 6, opacity: 0, scale: 0.6 }}
      animate={{ y: -30, opacity: [0, 1, 1, 0], scale: [0.6, 1.05, 1, 0.8] }}
      transition={{ duration: 1.6, ease: 'easeOut', times: [0, 0.2, 0.7, 1] }}
    />
  );
};

/** The vehicle's fuel/condition bars — DOM in both renderers
 *  (PixelSceneLayer renders the identical block when a vehicle is
 *  equipped and a claim status exists). */
const RoamVehicleStatusBar: React.FC<{ groundY: number }> = ({ groundY }) => {
  const vehicleStatus = useVehicleStore((state) => state.lastClaimStatus);
  const vehicle = useLoadoutStore((state) => state.getVehicle());
  if (!vehicle || !vehicleStatus) return null;
  return (
    <div className="absolute" style={{ left: '1%', bottom: `${(1 - groundY) * 100 + 1}%`, width: '21%', zIndex: 5 }} data-testid="pixel-vehicle">
      <div className="relative" style={{ visibility: 'hidden' }}>
        <img src={getPixelSprite(`vehicle-${vehicle.vehicleClassId.replace(/_/g, '-')}`)?.url} alt="" draggable={false} className="w-full" style={{ imageRendering: 'pixelated' }} />
      </div>
      <div className="mt-0.5 flex gap-1" data-testid="pixel-vehicle-status">
        <div className="h-1 flex-1 bg-black/60">
          <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, (vehicleStatus.fuelUnitsRemaining / Math.max(1, vehicleStatus.fuelUnitsStart || vehicleStatus.fuelUnitsRemaining)) * 100)}%` }} />
        </div>
        <div className="h-1 flex-1 bg-black/60">
          <div className="h-full bg-emerald-400" style={{ width: `${(vehicleStatus.conditionCurrent / Math.max(1, vehicleStatus.conditionMax)) * 100}%` }} />
        </div>
      </div>
    </div>
  );
};


