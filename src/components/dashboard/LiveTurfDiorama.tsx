import React, { useEffect, useRef, useState } from 'react';
import { PresentationActiveContext, usePresentationActive, useStageVisible } from '@/hooks/usePresentationActive';
import { motion, useAnimationControls, useReducedMotion } from 'framer-motion';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import {
  attachResumeProbeDomLifecycle,
  buildHeartbeatData,
  exposeResumeProbeSurface,
  isResumeProbeEnabled,
  logResumeProbeEvent,
} from '@/lib/pixel/resumeProbe';

import { PixelStage, PixelActor } from '@/components/pixelArt/PixelStage';
import {
  CritFlash,
  DamageNumber,
  DustPuff,
  DustRing,
  GhostHpBar,
  ImpactSparks,
  LootBeam,
  MuzzleFlash,
  ShellCasing,
  TelegraphGlow,
  Tracer,
} from '@/components/pixelArt/PixelFx';
import { getPixelSprite, pixelBackgroundForArea, pixelBossSpriteForBoss, pixelEnemySpriteForArchetype, pixelHunterSpriteForHunter, requirePixelSprite } from '@/lib/pixel/manifest';
import { CAMP_VISTA_SCENE, vistaSceneForBackground } from '@/lib/pixel/vistaScenes';
import { MOVEMENT, actorAnchorPoint, classifyTickBeat, lootRiseTotalMs, type ActorPlacement, type CombatBeatKind } from '@/lib/pixel/movement';
import { dropAssetColor, dropRiseBeamColor, parseDropType } from '@/lib/pixel/dropColors';
import { StageRise, ROAM_DROP_LIFT_PX } from '@/components/pixelArt/StageRise';
import { ROAM_ELITE_FLAT_HEIGHT_PCT, ROAM_ELITE_RIG_HEIGHT_PCT, ROAM_ENEMY_PLACEMENT, ROAM_HUNTER_PLACEMENT, approachOffsetXPct, enemyDropHold, roamEnemyPlacementFor, sampleEnemyWalkPose, roamPoseRecoveryTimes, roamPosesAt } from '@/lib/pixel/roamChoreography';
import {
  TRAVEL_SPECS,
  createTravelRun,
  feedTravel,
  sampleTravel,
  travelStrideSpec,
  type TravelRunState,
} from '@/lib/pixel/travelChoreography';
import { PixelRigActor } from '@/components/pixelArt/PixelRigActor';
import { PixelPaintedHunterActor } from '@/components/pixelArt/PixelPaintedHunterActor';
import { RoamHunterVoice } from '@/components/pixelArt/HunterVoiceChip';
import { PixelMaterial } from '@/components/pixelArt/PixelMaterial';
import {
  EXTRACTION_RISE_STAGGER_MS,
  extractionBeatDurationMs,
  extractionRisesForPass,
  type ExtractionRise,
} from '@/lib/pixel/extractionRise';
import { extractionPassFeedId } from '@/store/slices/extractionFeedSlice';
import type { ChefExtractionPass } from '@/lib/chef/chefClient';
import { BenchFx } from '@/components/pixelArt/BenchFx';
import { BenchItemRender } from '@/components/pixelArt/BenchSeat';
import {
  benchRisePlanForEntry,
  benchSeatPlanForJob,
  salvageRisePlanForEntry,
  type BenchRisePlan,
} from '@/lib/pixel/benchSeat';
import { WORK_CYCLE_SPECS, WORK_CYCLE_SPEC_BY_MODE } from '@/lib/pixel/workCycle';
import { SET_SEATS, seatPointTopPct } from '@/lib/pixel/setSeats';
import { isServiceLaneJob } from '@/components/workshop/serviceLane';
import type { WorkshopCompletionView } from '@/store/slices/workshopSlice';
import { ENEMY_POSES, enemyRig, type RigPose } from '@/lib/pixel/rig';
import { useCosmeticsStore } from '@/store/slices/cosmeticsSlice';
import { paintedPlacement } from '@/lib/pixel/paintedStage';
import { areaVisuals, bossArena } from '@/content/areaPalettes';
import { isHotArea } from '@/content/hotArea';
import { elementDialect, shotCadence } from '@/lib/pixel/elementFx';
import { useLoadoutStore } from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { useVehicleStore } from '@/store/slices/vehicleSlice';


import { LootMoment } from '@/components/pixelArt/LootMoment';
import { detectWebGL } from '@/components/pixelArt/pixi/detectWebGL';
import type { RoamPixiStageProps } from '@/components/pixelArt/pixi/RoamPixiStage';

const RoamPixiStageLazy = React.lazy(() =>
  import('@/components/pixelArt/pixi/RoamPixiStage').then((m) => ({ default: m.RoamPixiStage })),
);
import { BossFightStage } from '@/components/pixelArt/BossFightStage';
import { gearDropFromEvent, lootRiseVisualForEvent } from '@/lib/pixel/lootMoment';
import { DROP_RISE_MASTERS, type DropRiseKind } from '@/lib/pixel/iconMasters';
import { tintedDropRiseCanvas } from '@/lib/pixel/iconTint';
import { getLiveTurfScene } from '@/constants/liveTurfVisuals';
import { useKillCycleStore, useTickFeedStore, useBossStore, useInventoryStore, useWorkshopStore, useSalvageFeedStore, useExtractionFeedStore, useSkillStore } from '@/store';
import { MONSTERS, getMonster } from '@/constants/monsters';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { Rarity } from '@/types/game';
/* MATERIAL_VISUALS / ESSENCE_VISUALS / RESOURCE_VISUALS moved with
 * dropAssetColor into '@/lib/pixel/dropColors'. */

import type { BossDef } from '@/types/boss';
import type { RoamingAreaDef } from '@/constants/roamingAreas';
import type { Weapon } from '@/types/items';
import type { ActivityKind, BossPhase } from '@/types/activity';
import type { CharacterStatSummary } from '@/lib/stats/characterStats';
import type { TickEvent } from '@/store/slices/tickSlice';

export type LiveTurfFeedEvent = TickEvent;

type DioramaMode = 'idle' | 'roaming' | 'bossPrep' | 'bossFight' | 'crafting' | 'salvaging' | 'workshopService' | 'marketListing' | 'extraction' | 'endless';

interface LiveTurfDioramaProps {
  area: RoamingAreaDef;
  weapon?: Weapon;
  bossName?: string;
  boss?: BossDef;
  playerLevel: number;
  equippedCount: number;
  activityKind?: ActivityKind;
  bossPhase?: BossPhase;
  /** Motion Reboot M3: the endless_run activity record's targetId —
   *  the server-pinned run id (migration 0028). The stage renders
   *  the panel's published endless fight/presence only when its
   *  run id matches this one, the #431 bossId guard's analogue. */
  endlessRunId?: string | null;
  statSummary?: CharacterStatSummary;
  /** Owner ruling 2026-11-02: the running action's control
   *  floats ON the stage as a chip in the plates' language —
   *  top-left since the same day's follow-up ruling removed the
   *  area plate from that corner — supplied by the screen,
   *  rendered by the stage. Owner ruling 2026-11-03: the chips
   *  are ICON-ONLY 44px squares (glyphs, aria-labels carry the
   *  words) — the text made them way larger than they needed
   *  to be. Owner rework 2026-11-04: the Switch Action chip
   *  (the swap "arrows") leaves the stage; Stop alone rides
   *  here, leftmost, and only while an action runs — at standby
   *  the screen passes nothing and the stage carries no
   *  controls overlay at all. */
  stageControls?: React.ReactNode;
}

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const signClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

const modeFromActivity = (kind?: ActivityKind, bossPhase?: BossPhase): DioramaMode => {
  if (kind === 'roaming_loot') return 'roaming';
  if (kind === 'boss_fight') return bossPhase === 'fight' ? 'bossFight' : 'bossPrep';
  if (kind === 'crafting') return 'crafting';
  if (kind === 'salvaging') return 'salvaging';
  if (kind === 'workshop_service') return 'workshopService';
  if (kind === 'market_listing') return 'marketListing';
  // Extraction (one-stage law, owner ruling 2026-11-04): the
  // stage carries the extraction scene while extraction holds
  // the action slot — the workspace panel no longer renders its
  // own animated scene. Before this mapping the kind fell
  // through to the idle camp vista while the panel duplicated
  // the scene below.
  if (kind === 'extraction') return 'extraction';
  // Endless (Motion Reboot M3): a run holding the action slot maps
  // to a real stage mode — the run's presence between fights, its
  // published fight during one. Before this mapping the kind fell
  // through to the idle camp vista for the run's whole duration
  // (the PR #384 follow-up) while the panel ran a second stage.
  if (kind === 'endless_run') return 'endless';
  return 'idle';
};

// ── Drop visual helpers ──────────────────────────────────────────────────────────

/* Drop color identity (parseDropType / dropAssetColor / dropRiseBeamColor)
 * lives in '@/lib/pixel/dropColors' — shared with the Pixi stage so the
 * DOM and Pixi rises always speak the same colors. */


/**
 * INT-9 — the drop rise's painted marker. The texel grids
 * (DROP_RISE_GRIDS) are replaced by the Wave 13 painted masters:
 * material/essence/fragment/scrap ship as grayscale luminance masters
 * re-tinted at runtime to the drop's own base hue through the
 * drop-rise palette ramp (iconTint.ts — the masters' form survives
 * because the mapping is monotone in luminance; the hue identity is
 * the drop's, exactly as the grids' palette made it). Credits and
 * crate ship in their fixed identity colorways, as they did on the
 * grids (fixed bases #FFD700 / the crate's grey fallback).
 */
export const DropRiseMasterIcon: React.FC<{ kind: DropRiseKind; base: string }> = ({ kind, base }) => {
  const retinted = kind === 'material' || kind === 'essence' || kind === 'fragment' || kind === 'scrap';
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    if (!retinted) return;
    // Paint the tinted master as soon as it exists — and KEEP
    // WAITING for it (fix round 1, 2026-11-13). The old code made
    // exactly one attempt plus a 60 ms re-render that never
    // re-ran this effect, so whenever the master had not decoded
    // on the first attempt (a cold tint cache — the first drop of
    // each kind per session, any slow decode) the canvas stayed
    // blank for the rise's whole life: the drop showed a beam and
    // no item. The poll re-attempts the draw itself until the
    // tint lands or the component unmounts.
    let cancelled = false;
    let timer: number | undefined;
    const draw = (): boolean => {
      const canvas = tintedDropRiseCanvas(DROP_RISE_MASTERS[kind], base);
      if (!canvas) return false;
      const host = ref.current;
      if (!host) return true;
      const ctx = host.getContext('2d');
      if (!ctx) return true;
      host.width = canvas.width;
      host.height = canvas.height;
      ctx.clearRect(0, 0, host.width, host.height);
      ctx.drawImage(canvas, 0, 0);
      return true;
    };
    if (!draw()) {
      timer = window.setInterval(() => {
        if (cancelled || draw()) window.clearInterval(timer);
      }, 100);
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [kind, base, retinted]);
  if (!retinted) {
    return (
      <img
        src={DROP_RISE_MASTERS[kind]}
        width={34}
        height={34}
        style={{ width: 34, height: 34 }}
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    );
  }
  return (
    <canvas
      ref={ref}
      width={60}
      height={60}
      style={{ width: 34, height: 34 }}
      aria-hidden="true"
      data-drop-rise-master={kind}
    />
  );
};

export const DropRiseIcon: React.FC<{ tone: string; label: string }> = ({ tone, label }) => {
  const isScrap = label.toLowerCase().includes('scrap');
  const kind: DropRiseKind =
    tone === 'material' || tone === 'essence' || tone === 'fragment'
      ? tone
      : tone === 'cash'
        ? isScrap
          ? 'scrap'
          : 'credits'
        : 'crate';
  const base =
    kind === 'fragment'
      ? '#2196F3'
      : kind === 'scrap'
        ? '#FF5722'
        : kind === 'credits'
          ? '#FFD700'
          : dropAssetColor(parseDropType(label));
  // The chip names what dropped, in full (fix round 1,
  // 2026-11-13): the item kinds carry the event's own label —
  // "+1 TechFragments", quantity and all — where the pre-fix chip
  // showed a 4-letter truncation ("TECH") or "FRAG" and the cash
  // kinds nothing. Cash rises stay icon-only: a payout is not an
  // item, and its amount already prints in the feed.
  const nameLine =
    kind === 'material' || kind === 'essence' || kind === 'fragment' ? label : null;
  return (
    <div className="flex h-full flex-col items-center" style={{ paddingTop: 9 }}>
      <DropRiseMasterIcon kind={kind} base={base} />
      {nameLine ? (
        <span
          style={{
            color: base,
            fontSize: 11,
            fontWeight: 900,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            textShadow: '1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000',
          }}
        >
          {nameLine}
        </span>
      ) : null}
    </div>
  );
};


/**
 * Target HP plate (owner rulings 2026-11-02, amended 2026-11-03):
 * the plate used to hang at the stage's top-right, across the
 * enemy's face; the 2026-11-02 fix parked it under the enemy on
 * the ground line — where on device it read as part of the stats
 * row below the animation, the wrong layer entirely. It now rides
 * IN the stage as a translucent overlay on the enemy's column
 * (the shared enemy placement, ROAM_ENEMY_PLACEMENT), its top edge lifted off
 * the ground line by the hunter plate's own lift (HP_PLATE_LIFT),
 * so the two plates read as a matched pair at the same height on
 * their respective sides. The lift was chosen off the enemy's
 * geometry, not the hunter's anchor copied blindly: roaming
 * enemies stand 58% of the stage tall on the ground line, so a
 * plate whose top edge sits 18.5 points above that line lands on
 * the enemy's lower body — face and head stay completely clear,
 * honoring the original no-plate-across-a-face ruling. The BOSS
 * plate does NOT share this lift (see BossHpOverlay): its
 * ground-line anchor was owner-ruled to stay.
 */
/** How far the in-stage HP plates ride ABOVE the ground line, as a
 *  fraction of stage height. The hunter's plate and the roaming
 *  target's plate share this one lift so the pair always reads
 *  level — one constant, so they can never drift apart. */
const HP_PLATE_LIFT = 0.185;

const TargetHpOverlay: React.FC<{ active: boolean; accentColor: string; groundYPct: number; reduced?: boolean }> = ({ active, accentColor, groundYPct, reduced = false }) => {
  const currentHp = useKillCycleStore((state) => state.currentTargetHp);
  const maxHp = useKillCycleStore((state) => state.currentTargetHpMax);
  const targetId = useKillCycleStore((state) => state.currentTargetId);

  if (!active || !targetId || maxHp <= 0) return null;

  const ratio = Math.max(0, Math.min(1, currentHp / maxHp));
  const targetMonster = MONSTERS.find((monster) => monster.id === targetId);
  const targetName = targetMonster?.name ?? 'Target';
  // The plate rides the enemy's column — the same per-archetype
  // settle the stage renders at (roamChoreography owns the mark).
  const plateXPct = roamEnemyPlacementFor(targetMonster?.archetype).xPct;

  return (
    <div
      className="pointer-events-none absolute z-30 w-[176px] border-2 border-border bg-bg/80 px-2 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.62)]"
      style={{ ...signClip, left: `${plateXPct}%`, top: `${(groundYPct - HP_PLATE_LIFT) * 100}%`, transform: 'translateX(-50%)' }}
      data-testid="primary-diorama-target-hp"
    >
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-black uppercase leading-tight tracking-wide text-text-muted">
        <span className="min-w-0 break-words">{targetName}</span>
        <span className="shrink-0 text-red">{Math.round(ratio * 100)}%</span>
      </div>
      <GhostHpBar pct={ratio * 100} color={accentColor} reduced={reduced} barClassName="h-[10px]" testId="diorama-target-hp-bar" />
    </div>
  );
};

/** Boss HP plate for live boss fights — same under-the-enemy
 *  anchoring as the roaming target plate (owner ruling
 *  2026-11-02: no HP plate across a face, boss included). The
 *  fill carries a ghost trail (P2 movement system): lost HP
 *  drains behind the real bar over ~480 ms. The end-of-fight
 *  status prints as a chip ABOVE the plate, so the plate never
 *  grows down past the stage's edge. */
const BossHpOverlay: React.FC<{ active: boolean; accentColor: string; groundYPct: number; reduced?: boolean }> = ({ active, accentColor, groundYPct, reduced = false }) => {
  const bossHp = useBossStore((state) => state.activeBossHp);
  const bossMaxHp = useBossStore((state) => state.activeBossMaxHp);
  const bossId = useBossStore((state) => state.activeBossId);
  const status = useBossStore((state) => state.activeStatus);

  if (!active || !bossId || bossMaxHp <= 0 || status === 'idle') return null;

  const ratio = Math.max(0, Math.min(1, bossHp / bossMaxHp));
  const bossDef = REGION_1_BOSSES.find((b) => b.id === bossId);
  const bossName = bossDef?.name ?? 'Boss';

  return (
    <div
      className="pointer-events-none absolute z-30 w-[176px] border-2 border-border bg-bg/90 px-2 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.72)]"
      style={{ ...signClip, left: '74%', top: `calc(${groundYPct * 100}% + 2px)`, transform: 'translateX(-50%)' }}
      data-testid="primary-diorama-boss-hp"
    >
      {status === 'victory' && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap border-2 border-border bg-bg px-2 py-0.5 text-[11px] font-black text-green shadow-[4px_4px_0_rgba(0,0,0,0.72)] animate-pulse" style={signClip}>VICTORY</div>
      )}
      {status === 'defeat' && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap border-2 border-border bg-bg px-2 py-0.5 text-[11px] font-black text-red shadow-[4px_4px_0_rgba(0,0,0,0.72)] animate-pulse" style={signClip}>DEFEATED</div>
      )}
      <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-black uppercase leading-tight tracking-wide text-text-muted">
        <span className="min-w-0 break-words">{bossName}</span>
        <span className="shrink-0 text-red">{Math.round(ratio * 100)}%</span>
      </div>
      <GhostHpBar pct={ratio * 100} color={accentColor} reduced={reduced} barClassName="h-[10px]" testId="diorama-boss-hp-bar" />
    </div>
  );
};

// ── Pixel Scene Layer (P1: converted zones render pixel sprites) ────────────────

/**
 * The stage scene: pixel sprites for areas listed in
 * PIXEL_AREA_BACKGROUNDS (P1: Dustwaste Frontier; P4 wave 1: every other
 * roaming zone — this layer is zone-agnostic, driven entirely by the
 * background id and the shared actor sprites). It replaced a vector
 * SVG scene whose dormant no-background fallback form was removed
 * outright on 2026-11-07 (owner ruling: total-SVG-ban game, one DOM
 * stage — there is no second scene to fall back to). The enemy actor resolves
 * from game data, never per-zone wiring: in boss fights the challenged
 * boss's bespoke sprite (passed in as bossSpriteId), otherwise the kill
 * cycle's current target monster's archetype sprite, with the brute as
 * the standing fallback. Sprites come from the pixel manifest and
 * are placed by their anchors on a PixelStage; the equipped weapon
 * renders through the parts-kit compositor at the hunter's hands.
 *
 * P2 movement system: the latest tick event is classified into a combat
 * beat (src/lib/pixel/movement.ts) and staged with the FX kit — walk-in /
 * drop-in entrances, muzzle flash + tracer + shell casing + impact
 * sparks, screen shake, crit flash, telegraphed enemy lunge answered by
 * a hunter dodge, and the kill collapse with a dust ring. All timings
 * come from MOVEMENT; all positions from manifest anchors. All chrome
 * (title, HP overlays, action bar) stays shared with the stage shell.
 * Presentation only — reads the same stores/events, produces no gameplay
 * outcomes. Reduced motion: static actors, no FX/shake/entrances.
 */
/** Identity of one settled unit in the workshop mirror — the
 *  completion beat fires once per key, never on first sight of
 *  the mirror (everything already in it predates the stage). */
const benchCompletionKey = (c: WorkshopCompletionView): string =>
  `${c.jobId}:${String(c.unit ?? '')}:${String(c.completedAtMs ?? '')}`;

/** The finished unit's picture for the completion rise, resolved
 *  by benchRisePlanForEntry (M4b): the consumable or material the
 *  bench produced, the cosmetic part itself, or the minted gear
 *  piece of ANY kind — weapons, shields, relics, class mods,
 *  ordnance all rise as themselves. (Pre-M4b only weapons did;
 *  every other gear kind and every cosmetic fell through to the
 *  disc despite the item being right there in the inventory.)
 *  Service work (a repaired vehicle, a flipped shield) still has
 *  no item picture — the rise runs as a glow beat over the set
 *  piece and the celebrate pose carries it. */
const BenchRiseIcon: React.FC<{ entry: WorkshopCompletionView }> = ({ entry }) => {
  const items = useInventoryStore((state) => state.items);
  return <BenchItemRender plan={benchRisePlanForEntry(entry, items)} testId="bench-rise-render" />;
};

/**
 * Resume probe, DOM half (DEVICE-PROBE-SPEC items 1 + 4): the
 * mirrored visibility lifecycle + Capacitor appStateChange rows,
 * and a rAF heartbeat — a counter over this renderer's own rAF
 * drivers' clock, sampled at 1s while visible — so a DOM-path
 * freeze is distinguishable from a Pixi-only one in the shared
 * ring buffer. Installed only when the probe gate is on; the
 * transient Suspense-fallback instance never installs (it is a
 * placeholder, discarded at the renderer swap).
 */
function useDomResumeProbe(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return undefined;
    let detachDom: () => void;
    try {
      exposeResumeProbeSurface();
      logResumeProbeEvent('probe-init', 'dom', {});
      detachDom = attachResumeProbeDomLifecycle('dom');
    } catch {
      /* a diagnostic probe must never fail the stage it observes */
      return undefined;
    }
    const pluginHandles: PluginListenerHandle[] = [];
    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        logResumeProbeEvent('appStateChange', 'dom', { isActive });
      })
        .then((handle) => {
          pluginHandles.push(handle);
        })
        .catch(() => {
          /* the DOM lifecycle rows remain the fallback record */
        });
    }
    let rafCount = 0;
    let lastRafAt: number | null = null;
    let raf = 0;
    const loop = (now: number) => {
      rafCount += 1;
      lastRafAt = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const sampler = setInterval(() => {
      if (document.hidden) return;
      logResumeProbeEvent(
        'dom-heartbeat',
        'dom',
        buildHeartbeatData({
          count: rafCount,
          lastAt: lastRafAt,
          now: performance.now(),
          extra: { hidden: document.hidden },
        }),
      );
    }, 1000);
    return () => {
      detachDom();
      cancelAnimationFrame(raf);
      clearInterval(sampler);
      for (const handle of pluginHandles) {
        try {
          void handle.remove();
        } catch {
          /* already removed */
        }
      }
    };
  }, [enabled]);
}

const PixelSceneLayerDom: React.FC<{
  backgroundId: string;
  /** Bespoke boss sprite id for boss fights (resolved by the parent from
   *  the challenged boss's def); roaming targets resolve by archetype. */
  bossSpriteId?: string;
  weapon?: Weapon;
  mode: DioramaMode;
  event?: LiveTurfFeedEvent;
  reduced: boolean;
  /** Overhaul: the roaming area this stage shows (parallax, palette,
   *  weather, hot-area treatment read from it). */
  areaId: string;
  hot?: boolean;
  /** True only for the transient instance PixelSceneLayer renders
   *  as the Suspense fallback while the Pixi chunk loads. Such an
   *  instance must not start per-frame state clocks (the walk-in
   *  articulation clock): it is discarded at the swap, and its churn
   *  starves the swap itself. */
  transientFallback?: boolean;
}> = ({ backgroundId, bossSpriteId, weapon, mode, event, reduced, areaId, hot = false, transientFallback = false }) => {
  // V1 vistas: idle IS camp — the authored camp scene (Vista Pass,
  // owner ruling) replaces the old "current area + lone crate" idle
  // backdrop. Every other mode keeps the area-keyed background; when
  // that background is a vista scene, the stage renders its authored
  // bands + ambient instead of the paintings' re-cuts.
  const idleCamp = mode === 'idle';
  const sceneBackgroundId = idleCamp ? CAMP_VISTA_SCENE.backgroundId : backgroundId;
  const background = getPixelSprite(sceneBackgroundId);
  const groundY = background?.anchors.groundLine?.y ?? 0.86;
  const vistaScene = idleCamp ? CAMP_VISTA_SCENE : vistaSceneForBackground(backgroundId);
  const showEnemy = mode === 'roaming' || mode === 'bossFight';
  const bossMode = mode === 'bossFight';
  // Boss prep (One-Stage Law, owner ruling 2026-11-06): the
  // challenged boss STANDS on the stage while the player preps —
  // presence without combat. Beats and HP plates stay keyed to
  // showEnemy; only the boss actor joins the scene. Endless
  // presence (Motion Reboot M3) takes the same treatment: the
  // run's next encounter stands on the stage between fights.
  const showBossPrep = (mode === 'bossPrep' || mode === 'endless') && !!bossSpriteId;
  const bossOnStage = bossMode || showBossPrep;
  const targetMaxHp = useKillCycleStore((state) => state.currentTargetHpMax);
  const currentTargetId = useKillCycleStore((state) => state.currentTargetId);
  const currentTargetHp = useKillCycleStore((state) => state.currentTargetHp);
  // Drop hold (Inkling R1, ported at the baseline reset): while a
  // drop event stands, the enemy slot holds empty — the drop plays
  // over the fallen enemy's spot, never over a standing figure.
  const dropHold = mode === 'roaming' ? enemyDropHold(event, currentTargetHp) : null;
  const beat = reduced ? null : classifyTickBeat(event, targetMaxHp);
  // Resume probe (diagnostic only; see useDomResumeProbe above).
  useDomResumeProbe(!transientFallback && isResumeProbeEnabled());

  // ── Travel beat (Motion Reboot M2b) ─────────────────────────
  // The DOM renderer's half of the shared travel tracker (the
  // Pixi stage feeds its own copy from the same observations —
  // travelChoreography owns the state machine, so the two can't
  // drift). While roaming with motion allowed, a rAF driver
  // feeds the tracker and binds the stride execution on the
  // hunter actor while the window is open. (The stride-synced
  // scenery pan the tracker also fed retired with the vista
  // bands, 2026-11-11 — the stride carries the beat.)
  // Leaving roaming (Stop, activity switch, a fight taking the
  // stage) cancels the run outright: the binding drops, the
  // actor's own ramp hands the pose back.
  // Reduced motion never engages it — the pre-M2b picture.
  const travelRunRef = useRef<TravelRunState | null>(null);
  if (travelRunRef.current === null) travelRunRef.current = createTravelRun();
  const [travelActive, setTravelActive] = useState(false);
  const presentationActive = usePresentationActive();
  const travelInputsRef = useRef<{
    engaged: boolean;
    targetKey: string | null;
    beatKind: CombatBeatKind | null;
    beatEventId: string | null;
  }>({ engaged: false, targetKey: null, beatKind: null, beatEventId: null });
  const travelBeatKind = beat?.kind ?? null;
  const travelBeatEventId = event?.id ?? null;
  useEffect(() => {
    travelInputsRef.current = {
      engaged: mode === 'roaming' && !reduced,
      targetKey: currentTargetId ?? null,
      beatKind: travelBeatKind,
      beatEventId: travelBeatEventId,
    };
  }, [mode, reduced, currentTargetId, travelBeatKind, travelBeatEventId]);
  const travelSceneId = vistaScene?.id ?? null;
  useEffect(() => {
    if (!presentationActive) return;
    if (mode !== 'roaming' || reduced) {
      // Cancel on the next frame (the M2a actor's deferred-reset
      // shape): the run clears and the stride binding drops —
      // no stuck stride past the interrupt.
      const id = requestAnimationFrame(() => {
        feedTravel(travelRunRef.current!, TRAVEL_SPECS.advance, {
          engaged: false,
          targetKey: null,
          beatKind: null,
          beatEventId: null,
          now: performance.now(),
        });
        setTravelActive(false);
      });
      return () => cancelAnimationFrame(id);
    }
    let raf = 0;
    const loop = (now: number) => {
      const run = travelRunRef.current!;
      feedTravel(run, TRAVEL_SPECS.advance, { ...travelInputsRef.current, now });
      const s = sampleTravel(run, TRAVEL_SPECS.advance, vistaScene, now);
      setTravelActive((prev) => (prev === s.active ? prev : s.active));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
    };
    // vistaScene identity follows its id (the spec objects are
    // module constants); the loop reads it through the closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reduced, travelSceneId, presentationActive]);
  // A real gear drop on the latest event gets the P3 loot moment (beam +
  // card at the enemy's loot point). Every other grant gets the rise
  // that pictures it via lootRiseVisualForEvent — the cache crate is
  // reserved for real cache grants, never lesser loot. Hit ticks share
  // tone 'loot' but carry no gear and get no rise at all.
  const dropItem = gearDropFromEvent(event);
  const lootRise = reduced ? null : lootRiseVisualForEvent(event);
  const crate = getPixelSprite('crate');
  const [enemyLanded, setEnemyLanded] = useState(false);

  // ── Overhaul stage state ──────────────────────────────────────────
  const visuals = areaVisuals(areaId);
  const dialect = elementDialect(weapon?.element);
  const cadence = shotCadence(weapon?.weaponType, weapon?.attackSpeed);
  const vehicle = useLoadoutStore((state) => state.getVehicle());
  const vehicleStatus = useVehicleStore((state) => state.lastClaimStatus);
  // Hunter HP for the on-stage HP plate (owner ruling 2026-11-02:
  // his HP used to read as a hairline at the hunter's feet — the
  // survival store is the source, the plate renders it raised).
  const hunterHp = useSurvivalStore((state) => state.currentHp);
  const hunterMaxHp = useSurvivalStore((state) => state.maxHp);
  const hunterHpRatio = hunterMaxHp > 0 ? Math.max(0, Math.min(1, hunterHp / hunterMaxHp)) : 1;
  const hunterHpColor = hunterHpRatio >= 0.6 ? '#4ADE80' : hunterHpRatio >= 0.3 ? '#FF9000' : '#F87171';
  const isEliteEvent = !!event && (event.tone === 'event' || event.tone === 'event_major') && event.family === 'elite';
  const [poseAge, setPoseAge] = useState({ eventId: '', elapsedMs: 0 });
  const poseEventId = event?.id ?? '';
  const poseBeatKind = beat?.kind ?? null;
  useEffect(() => {
    const timers = roamPoseRecoveryTimes(poseBeatKind ? { kind: poseBeatKind } : null)
      .map((elapsedMs) => setTimeout(() => setPoseAge({ eventId: poseEventId, elapsedMs }), elapsedMs));
    return () => timers.forEach(clearTimeout);
  }, [poseEventId, poseBeatKind]);
  // Post-kill advance guard: a beat names the target that was current
  // when its event arrived. The Chef settles a kill and the next spawn
  // in ONE claim, so a kill beat routinely stands next to the NEXT
  // enemy — the death pose and the dissolve belong to the enemy that
  // died, never to the one now standing. When the event changes, the
  // pre-beat target is snapshotted (a ref the beat effects below read
  // — they run after this effect in the same commit — plus a state
  // mirror for this render); the previous-target ref advances after
  // it (declaration order is the mechanism).
  const prevTargetIdRef = useRef<string | null>(null);
  const beatTargetIdRef = useRef<string | null>(null);
  const [beatTargetId, setBeatTargetId] = useState<string | null>(null);
  useEffect(() => {
    beatTargetIdRef.current = prevTargetIdRef.current;
    setBeatTargetId(prevTargetIdRef.current);
  }, [poseEventId]);
  useEffect(() => {
    prevTargetIdRef.current = currentTargetId ?? null;
  });
  const beatForCurrentTarget = beatTargetId === (currentTargetId ?? null);
  const actorPoses = roamPosesAt(beat, !!weapon, poseAge.eventId === poseEventId ? poseAge.elapsedMs : 0, {
    beatForCurrentTarget,
  });
  const eventProp = event && (event.tone === 'event' || event.tone === 'event_major') && event.propId
    ? getPixelSprite(event.propId)
    : undefined;
  const enemyPose = isEliteEvent
    ? ENEMY_POSES.idle
    : ENEMY_POSES[actorPoses.enemy];
  // ── Walk-in articulation clock (animation fix iteration) ────
  // While the current target is inside its walk-in window, the
  // rig wrapper's remount instant starts a rAF clock; the rig
  // pose handed to PixelRigActor is the beat pose COMPOSED with
  // the stride delta (roamChoreography's sampleEnemyWalkPose —
  // the same derivation the Pixi stage samples per frame), so
  // the DOM enemy articulates through its approach instead of
  // sliding rigidly. The clock clears itself at the window's end
  // and the plain beat pose resumes. Elite/flat entrances and
  // reduced motion never engage it.
  const walkKey = `${currentTargetId ?? 'none'}|${isEliteEvent ? 'elite' : 'std'}`;
  const [walkPoseState, setWalkPoseState] = useState<{ key: string; pose: RigPose; deltaX: number } | null>(null);
  useEffect(() => {
    // A transient Suspense-fallback instance never runs the clock:
    // it is a placeholder for the Pixi stage (which derives the
    // walk itself, per frame), and its ~60fps state churn delayed
    // the lazy swap past the renderer-selection test's window —
    // a real regression caught by CI on PR #470 (the swap landed
    // at ~4.2s with the clock live vs ~1.2s without; master passes
    // the same test solo). When DOM is the settled renderer the
    // scene mounts as its own instance without the flag — via the
    // switch above, or fresh after a Pixi failure — and the clock
    // engages there exactly as before.
    if (!presentationActive || transientFallback || reduced || mode !== 'roaming' || isEliteEvent || !currentTargetId) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = (now: number) => {
      const tMs = now - t0;
      if (tMs >= MOVEMENT.WALK_IN_MS) {
        setWalkPoseState((prev) => (prev?.key === walkKey ? null : prev));
        return;
      }
      const w = sampleEnemyWalkPose(tMs);
      setWalkPoseState({ key: walkKey, pose: w.poseDelta, deltaX: w.deltaX });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // walkKey carries target + elite identity; the loop re-arms
    // per spawn exactly like the wrapper's remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkKey, reduced, mode, transientFallback, presentationActive]);
  const walkDelta = walkPoseState?.key === walkKey ? walkPoseState : null;
  const enemyRigPose: RigPose = walkDelta
    ? Object.fromEntries(
        [...new Set([...Object.keys(enemyPose), ...Object.keys(walkDelta.pose)])].map((segId) => {
          const b = enemyPose[segId] ?? {};
          const d = walkDelta.pose[segId] ?? {};
          return [
            segId,
            {
              rotate: (b.rotate ?? 0) + (d.rotate ?? 0),
              x: (b.x ?? 0) + (d.x ?? 0) + (segId === 'base' ? walkDelta.deltaX : 0),
              y: (b.y ?? 0) + (d.y ?? 0),
              ...(b.opacity !== undefined ? { opacity: b.opacity } : {}),
            },
          ];
        }),
      )
    : enemyPose;
  // Every stage figure is the active hunter's painting (slice
  // (c); the bench / extraction / stall branches converted
  // 2026-11-17 — see the FX-point block for the seating law).
  // The cosmetics load stays: the worn-look store still feeds
  // surfaces off this stage.
  const loadCosmetics = useCosmeticsStore((s) => s.load);
  useEffect(() => { void loadCosmetics(); }, [loadCosmetics]);

  // ── Work cycle (Motion Reboot M1; extraction M4a) ────────────
  // Bench modes run the work cycle: the hunter WORKS the set piece
  // (pose 'work' + the mode's choreography spec executed by the
  // actor, set-piece FX at the work point) instead of standing at
  // idle holding his weapon in front of a static prop. The spec is
  // DATA (WORK_CYCLE_SPEC_BY_MODE → WORK_CYCLE_SPECS); "working"
  // reads the workshop mirror exactly as the bench strip does — a
  // RUNNING job in this mode's lane (the service-lane predicate is
  // the workshop's own). Salvaging has no job queue: the mode
  // holding the stage IS the work — each recycle is a verified op
  // performed under it.
  // Extraction (M4a) is a registry tenant too ('sift'), but the
  // bench machinery below — lane reads, the seat, completion
  // rises — belongs to the bench lanes only; extraction's spec is
  // derived separately and drives its own cycle + pass beats.
  // Market listing (M4c) is a registry tenant on the same pattern
  // ('stall'): its spec is derived separately and drives its own
  // low-amplitude cycle — no lane, no seat, no FX, no completion
  // beat (a listing settles in the Market, not on this stage).
  const cycleSpecId = WORK_CYCLE_SPEC_BY_MODE[mode];
  const cycleSpec = cycleSpecId ? WORK_CYCLE_SPECS[cycleSpecId] : undefined;
  const benchSpec = mode === 'extraction' || mode === 'marketListing' ? undefined : cycleSpec;
  const extractionSpec = mode === 'extraction' ? cycleSpec : undefined;
  const stallSpec = mode === 'marketListing' ? cycleSpec : undefined;
  const workshopJobs = useWorkshopStore((state) => state.server?.jobs);
  const recentCompletions = useWorkshopStore((state) => state.server?.recentCompletions);
  const benchServiceLane = mode === 'workshopService';
  const benchWorking = !benchSpec
    ? false
    : mode === 'salvaging'
      ? true
      : (workshopJobs ?? []).some(
          (job) => job.state === 'running' && isServiceLaneJob(job) === benchServiceLane,
        );
  // Completion beat (craft + service lanes): a unit settling in
  // this mode's lane while the stage watches earns the celebrate
  // pose and the finished unit rising off the bench on the law's
  // loot-rise duration. The seen-set initializes from the first
  // mirror view so pre-existing completions never replay; several
  // units settling in one refresh celebrate the latest only.
  const [benchCompletion, setBenchCompletion] = useState<WorkshopCompletionView | null>(null);
  const seenCompletionsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!benchSpec || mode === 'salvaging' || !recentCompletions) return;
    const jobsById = new Map((workshopJobs ?? []).map((j) => [j.id, j]));
    const laneEntries = recentCompletions.filter((c) => {
      const job = jobsById.get(c.jobId);
      return job ? isServiceLaneJob(job) === benchServiceLane : !benchServiceLane;
    });
    const keys = new Set(laneEntries.map(benchCompletionKey));
    if (seenCompletionsRef.current === null) {
      seenCompletionsRef.current = keys;
      return;
    }
    const fresh = laneEntries.filter((c) => !seenCompletionsRef.current!.has(benchCompletionKey(c)));
    seenCompletionsRef.current = keys;
    if (fresh.length === 0 || reduced) return;
    setBenchCompletion(fresh[fresh.length - 1]);
  }, [recentCompletions, workshopJobs, benchSpec, mode, benchServiceLane, reduced]);
  useEffect(() => {
    if (!benchCompletion) return;
    const timer = setTimeout(() => setBenchCompletion(null), lootRiseTotalMs());
    return () => clearTimeout(timer);
  }, [benchCompletion]);
  const activeBenchCompletion = mode === 'salvaging' ? null : benchCompletion;

  // ── Item on the bench (Motion M4b) ────────────────────────────
  // The running job in this mode's lane seats its truthful output
  // picture at the work point (benchSeat.ts): the real consumable
  // / material / part / relic-form render, the slot+rarity frame
  // for gear that does not exist yet, the service target itself.
  const benchLaneJob = benchSpec && mode !== 'salvaging'
    ? (workshopJobs ?? []).find(
        (job) => job.state === 'running' && isServiceLaneJob(job) === benchServiceLane,
      )
    : undefined;
  const seatPlan = benchSeatPlanForJob(benchLaneJob);
  // Work point (V2 set landing, 2026-11-08): the FX and the seated
  // item ride the set piece's own declared seat (setSeats.ts) in
  // the modes whose piece is a V2-authored piece — the crusher's
  // mouth rim for salvaging, the lift's deck for workshop service.
  // Both seats are horizontally centered on their piece's feet
  // anchor, so the shared xPct (60) stays exact; only the height
  // derives. The crafting lane's bench is #447's own build, not
  // the V2-authored bench, so its seat row does not describe the
  // shipped art. Its point is C1-01's measured anvil point
  // (rulings batch-3, 2026-11-15): the bench actor stands at
  // xPct 60 with feet anchor 0.4972, putting its left edge at
  // ≈45.0 and the anvil (centre ≈0.235 of the sprite's width)
  // at stage x ≈52; the anvil's top face sits ≈6 points above
  // the old fallback point, so the seat rides the slab instead
  // of floating off its front face (CP2's forge finding).
  const workSeatPieceId = mode === 'salvaging' ? 'set-refinery-crusher' : mode === 'workshopService' ? 'set-bay-lift' : null;
  const workSeat = workSeatPieceId ? SET_SEATS[workSeatPieceId]?.seat ?? null : null;
  const workSeatHeightPct = mode === 'salvaging' ? 34 : 36;
  const workPointYPct = workSeat
    ? seatPointTopPct(workSeat, workSeatHeightPct, groundY)
    : mode === 'crafting'
      ? (groundY - 0.23) * 100
      : (groundY - 0.17) * 100;
  const workPointXPct = mode === 'crafting' ? 52 : 60;
  // Salvage completion beat (M4b): salvaging has no workshop
  // mirror, so its completions arrive on the salvage feed — the
  // store every recycle result already pushes to. A fresh settled
  // recycle (or one batch summary) earns the same beat grammar as
  // a craft completion: celebrate pose + the yield rising off the
  // crusher. The seen-set initializes from the first feed view so
  // history never replays; a failed batch settled nothing and
  // earns no beat (salvageRisePlanForEntry returns null for it).
  const salvageEvents = useSalvageFeedStore((state) => state.events);
  const [salvageBeat, setSalvageBeat] = useState<{ key: string; plan: BenchRisePlan } | null>(null);
  const seenSalvageRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const keys = new Set(salvageEvents.map((e) => e.id));
    if (seenSalvageRef.current === null) {
      seenSalvageRef.current = keys;
      return;
    }
    const fresh = salvageEvents.filter((e) => !seenSalvageRef.current!.has(e.id));
    seenSalvageRef.current = keys;
    if (mode !== 'salvaging' || reduced || fresh.length === 0) return;
    const plan = salvageRisePlanForEntry(fresh[0]);
    if (plan) setSalvageBeat({ key: fresh[0].id, plan });
  }, [salvageEvents, mode, reduced]);
  useEffect(() => {
    if (!salvageBeat) return;
    const timer = setTimeout(() => setSalvageBeat(null), lootRiseTotalMs());
    return () => clearTimeout(timer);
  }, [salvageBeat]);

  // ── Extraction pass appearance (Motion M4a) ───────────────────
  // Settled passes arrive on the extraction feed — the panel is
  // the settle's only client recipient and republishes each pass
  // there (extractionFeedSlice). A pass that settles while
  // extraction holds the stage earns the bench lanes' beat
  // grammar: the hunter celebrates, the sift cycle holds, and the
  // pass's finds rise off the rig — one rise per material /
  // essence type at its settled count (extractionRise.ts); the
  // panel's "Just landed" card prints the same payload as the
  // record, so the two surfaces can never disagree. Seen-set
  // discipline matches the craft lanes: the feed's contents at
  // first view are history and never replay; a multi-pass settle
  // sequences one beat per pass, oldest first; passes settling
  // while another mode holds the stage are marked seen without a
  // beat; a pass with no finds earns no beat; reduced motion
  // silences the presentation entirely.
  const extractionFeedPasses = useExtractionFeedStore((state) => state.passes);
  const [extractionBeat, setExtractionBeat] = useState<{ key: string; rises: ExtractionRise[] } | null>(null);
  const extractionQueueRef = useRef<ChefExtractionPass[]>([]);
  const seenExtractionRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const keys = new Set(extractionFeedPasses.map((e) => e.id));
    if (seenExtractionRef.current === null) {
      seenExtractionRef.current = keys;
      return;
    }
    const fresh = extractionFeedPasses.filter((e) => !seenExtractionRef.current!.has(e.id));
    seenExtractionRef.current = keys;
    if (mode !== 'extraction' || reduced || fresh.length === 0) return;
    // The feed is newest-first; beats play in settlement order.
    for (const entry of [...fresh].reverse()) {
      if (extractionRisesForPass(entry.pass).length > 0) {
        extractionQueueRef.current.push(entry.pass);
      }
    }
  }, [extractionFeedPasses, mode, reduced]);
  // Leaving the mode retires the live beat on the spot — a
  // render-phase adjustment (React's sanctioned pattern for
  // prop-change resets; an effect would retire it a commit
  // late). Queued beats are dropped by the effect below (refs
  // only): their passes are already marked seen, so they never
  // replay on return.
  const [extractionBeatMode, setExtractionBeatMode] = useState(mode);
  if (mode !== extractionBeatMode) {
    setExtractionBeatMode(mode);
    setExtractionBeat(null);
  }
  useEffect(() => {
    if (mode !== 'extraction') extractionQueueRef.current = [];
  }, [mode]);
  // Beat driver: when no beat is live, the next queued pass plays.
  useEffect(() => {
    if (extractionBeat || mode !== 'extraction') return;
    const next = extractionQueueRef.current.shift();
    if (!next) return;
    setExtractionBeat({ key: extractionPassFeedId(next), rises: extractionRisesForPass(next) });
  }, [extractionBeat, mode, extractionFeedPasses]);
  useEffect(() => {
    if (!extractionBeat) return;
    const timer = setTimeout(
      () => setExtractionBeat(null),
      extractionBeatDurationMs(extractionBeat.rises.length),
    );
    return () => clearTimeout(timer);
  }, [extractionBeat]);
  /** A settled pass's beat is live: the hunter celebrates and the
   *  sift cycle + rig FX hold for the rises. */
  const extractionCelebrating = !!extractionBeat;

  /** Either lane's completion beat is live: the hunter celebrates
   *  and the work cycle + set-piece FX hold for the rise. */
  const benchCelebrating = !!activeBenchCompletion || !!salvageBeat;

  // Enemy sprite from data: the boss's bespoke sprite in boss fights,
  // else the current target monster's archetype sprite, else the brute.
  const targetArchetype = currentTargetId ? getMonster(currentTargetId)?.archetype : undefined;
  const enemySpriteId =
    (bossOnStage ? bossSpriteId : undefined) ?? pixelEnemySpriteForArchetype(targetArchetype) ?? 'brute';
  const enemySprite = getPixelSprite(enemySpriteId) ?? requirePixelSprite('brute');
  // At camp the hunter takes the authored fire seat (center-x 505
  // of 960 in the camp set's seat record); at a boss the shipped
  // 22% mark holds (boss staging is its own composition); roaming
  // reads ROAM_HUNTER_PLACEMENT — roamChoreography owns the mark.
  const hunterPlacement: ActorPlacement = {
    // Crafting holds its own mark (C1-01, rulings batch-3): at
    // the shared roam mark the working hand stopped ≈10 points
    // short of the bench; xPct 22 lands it at the anvil.
    xPct: idleCamp ? 52.6 : bossOnStage ? 22 : mode === 'crafting' ? 22 : ROAM_HUNTER_PLACEMENT.xPct,
    heightPct: ROAM_HUNTER_PLACEMENT.heightPct,
    groundY,
  };
  // Roam settle = the per-archetype mark (roamChoreography owns
  // it — the shared ROAM_ENEMY_PLACEMENT plus its archetype
  // overrides); boss encounters keep their own wider mark and
  // taller frame, and elite events keep the shared mark exactly,
  // mirroring the scene model's derivation. Elite heights mirror
  // the Pixi derivation's (rig 72 / bespoke flat 74) so the DOM
  // anchors — mass, feet, loot point — sit on the same frame the
  // actor renders at (the rig/flat actors restate those heights
  // at their own call sites below).
  const roamEnemy = roamEnemyPlacementFor(targetArchetype);
  const enemyPlacement: ActorPlacement = {
    xPct: bossOnStage ? 74 : isEliteEvent ? ROAM_ENEMY_PLACEMENT.xPct : roamEnemy.xPct,
    heightPct: bossOnStage
      ? bossSpriteId
        ? 80
        : 66
      : isEliteEvent
        ? visuals.eliteSpriteId
          ? ROAM_ELITE_FLAT_HEIGHT_PCT
          : ROAM_ELITE_RIG_HEIGHT_PCT
        : roamEnemy.heightPct,
    groundY,
  };
  // The painted hunter (Cache Hunters slice (c); owner ruling
  // 2026-11-15 — PAINTINGS ONLY ON STAGE): the active hunter's
  // Cast B painting is the stage figure, and the FX points resolve
  // from the PAINTING's manifest anchors at the width-law-fitted
  // placement — the same anchor discipline the enemy flat already
  // uses. The anchors are the production sidecars' declared values
  // (the muzzle/grip points are computed defaults, not measured
  // weapon geometry — the flash and casing read from the figure's
  // right edge / hand line, close enough for a 34px flash sprite;
  // recorded in DESIGN.md §12 with the ruling).
  const activeHunterId = useSkillStore((s) => s.activeHunterId);
  const hunterSprite = requirePixelSprite(pixelHunterSpriteForHunter(activeHunterId) ?? 'hunter-vesper-cole');
  const hunterStagePlacement = paintedPlacement(hunterSprite, hunterPlacement);
  const muzzle = actorAnchorPoint(hunterSprite, 'muzzle', hunterStagePlacement);
  const grip = actorAnchorPoint(hunterSprite, 'grip', hunterStagePlacement);
  const hunterMass = actorAnchorPoint(hunterSprite, 'centerMass', hunterStagePlacement);
  const enemyMass = actorAnchorPoint(enemySprite, 'centerMass', enemyPlacement);
  const enemyFeet = actorAnchorPoint(enemySprite, 'feet', enemyPlacement);
  /* (the enemy's above-the-head lootPoint anchor is no longer read here —
   * Stage Iteration R2: every drop presentation anchors at enemyFeet.) */

  const combatBeat = beat && showEnemy ? beat : null;
  const shakeKey =
    combatBeat && (combatBeat.kind === 'shot' || combatBeat.kind === 'crit' || combatBeat.kind === 'kill')
      ? event?.id
      : enemyLanded && bossOnStage && !reduced
        ? 'enemy-land'
        : undefined;
  const shakeIntensity = combatBeat?.kind === 'crit' ? 7 : combatBeat?.kind === 'kill' ? 5 : combatBeat?.kind === 'shot' ? 3 : 5;
  const shakeDurationMs = combatBeat?.kind === 'crit' ? MOVEMENT.CRIT_SHAKE_MS : MOVEMENT.SHAKE_MS + 140;

  // Actor reactions, driven per tick event through animation controls.
  const hunterControls = useAnimationControls();
  const enemyLungeControls = useAnimationControls();
  const enemyHitControls = useAnimationControls();
  const beatKind = combatBeat?.kind;
  const beatEventId = event?.id;
  useEffect(() => {
    if (reduced) return;
    switch (beatKind) {
      case 'playerHit':
        void hunterControls.start({
          x: [0, 0, -26, -20, 0],
          scaleY: [1, 1, 0.9, 0.97, 1],
          transition: { duration: (MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 120) / 1000, times: [0, 0.45, 0.6, 0.78, 1] },
        });
        void enemyLungeControls.start({
          x: [0, 0, -92, -72, 0],
          transition: { duration: (MOVEMENT.TELEGRAPH_MS + MOVEMENT.LUNGE_MS + 140) / 1000, times: [0, 0.45, 0.62, 0.8, 1] },
        });
        break;
      case 'shot':
        void hunterControls.start({ x: [0, -4, 0], transition: { duration: 0.22 } });
        void enemyHitControls.start({
          scale: [1, 0.93, 1.03, 1],
          x: [0, 9, -3, 0],
          transition: { duration: MOVEMENT.HIT_REACTION_MS / 1000 },
        });
        break;
      case 'crit':
        // The crit's equivalent weight (stage-iteration program):
        // the same windows as the shot, heavier keys — the exact
        // values sampleRoamBeat samples on the Pixi path, so the
        // two renderers carry one crit.
        void hunterControls.start({ x: [0, -6, 0], transition: { duration: 0.22 } });
        void enemyHitControls.start({
          scale: [1, 0.88, 1.05, 1],
          x: [0, 13, -4, 0],
          transition: { duration: MOVEMENT.HIT_REACTION_MS / 1000 },
        });
        break;
      case 'kill':
        void hunterControls.start({ y: [0, -9, 0], transition: { duration: 0.42 } });
        if (beatTargetIdRef.current === (currentTargetId ?? null)) {
          void enemyHitControls.start({
            opacity: [1, 1, 0],
            scale: [1, 1.05, 0.5],
            y: [0, 0, 24],
            transition: { duration: 0.5, ease: 'easeIn' },
          });
        } else {
          // The kill names a previous enemy; the one standing now did
          // not die — no dissolve on it (it walks in at rest).
          void enemyHitControls.start({ opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.2 } });
        }
        break;
      case 'loot':
        // A legendary drop is the celebration beat (P3): the hunter hops
        // as the LootMoment's gold pillar lands. Lesser drops settle.
        if (event?.gear?.rarity === Rarity.Legendary) {
          void hunterControls.start({ y: [0, -11, 0], transition: { duration: MOVEMENT.LOOT_HOP_MS / 1000, ease: 'easeOut' } });
        } else {
          void hunterControls.start({ x: 0, y: 0, scaleY: 1, transition: { duration: 0.2 } });
        }
        void enemyLungeControls.start({ x: 0, transition: { duration: 0.2 } });
        void enemyHitControls.start({ opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.2 } });
        break;
      default:
        // Quiet/loot event (or a fresh target): settle back to rest poses.
        void hunterControls.start({ x: 0, y: 0, scaleY: 1, transition: { duration: 0.2 } });
        void enemyLungeControls.start({ x: 0, transition: { duration: 0.2 } });
        void enemyHitControls.start({ opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.2 } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatEventId, beatKind, reduced]);

  // Post-kill advance: when the target changes under a standing kill
  // beat that names the PREVIOUS enemy, release any held dissolve so
  // the new enemy stays visible (the beat effect above does not
  // re-run on a target change alone).
  useEffect(() => {
    if (reduced) return;
    if (beatKind === 'kill' && beatTargetIdRef.current !== (currentTargetId ?? null)) {
      void enemyHitControls.start({ opacity: 1, scale: 1, x: 0, y: 0, transition: { duration: 0.2 } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTargetId]);

  return (
    <PixelStage
      backgroundId={sceneBackgroundId}
      groundY={groundY}
      reduced={reduced}
      embers
      shakeKey={shakeKey}
      shakeIntensity={shakeIntensity}
      shakeDurationMs={shakeDurationMs}
      testId="pixel-diorama-stage"
      areaId={areaId}
      hot={hot}
      vistaScene={vistaScene}
    >
      {/* No in-scene mode chip (QC papercut): the HTML title plate
          above already prints the activity label — the chip hung
          off the plate's bottom edge repeating the same word
          ("STANDBY" under "STANDBY"). The mode prints once, on
          the plate. */}

      {/* Set dressing in non-combat modes (grammar G-5): the system's
          set pieces behind the actor; the camp crate is the fallback. */}
      {!showEnemy && mode === 'crafting' && (
        <PixelActor spriteId="set-bench-forge" xPct={60} heightPct={34} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-bench-set" />
      )}
      {!showEnemy && mode === 'workshopService' && (
        <PixelActor spriteId="set-bay-lift" xPct={60} heightPct={36} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-bay-set" />
      )}
      {!showEnemy && mode === 'salvaging' && (
        <PixelActor spriteId="set-refinery-crusher" xPct={60} heightPct={34} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-refinery-set" />
      )}
      {!showEnemy && mode === 'marketListing' && (
        <PixelActor spriteId="set-vendor-stall" xPct={60} heightPct={34} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-vendor-set" />
      )}
      {/* Extraction set (grammar ACTION_SETS.extraction, in the
          arrangement the retired panel scene used): the stake
          line marks the claim, the sift rig does the sorting,
          the crates fill as passes land. */}
      {!showEnemy && mode === 'extraction' && (
        <>
          <PixelActor spriteId="set-extract-stakes" xPct={14} heightPct={26} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-extract-stakes" />
          <PixelActor spriteId="set-extract-rig" xPct={58} heightPct={36} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-extract-rig" />
          <PixelActor spriteId="set-extract-crates" xPct={86} heightPct={24} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-extract-crates" />
        </>
      )}
      {/* Camp set (V1): the authored camp props at their seat-record
          positions — fireglow under the pit, crate left, supply
          right; flame/smoke/embers are ambient-canvas life, not
          actors. Props stay separate sprites, never baked. */}
      {!showEnemy && !showBossPrep && idleCamp && (
        <>
          <PixelActor spriteId="camp-fireglow" xPct={65.8} heightPct={15.8} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-camp-fireglow" />
          <PixelActor spriteId="camp-crate" xPct={41.1} heightPct={28.1} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-crate-prop" />
          <PixelActor spriteId="camp-firepit" xPct={65.8} heightPct={9.4} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-camp-firepit" />
          <PixelActor spriteId="camp-supply" xPct={83.3} heightPct={15} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-camp-supply" />
        </>
      )}
      {!showEnemy && !showBossPrep && !idleCamp && mode !== 'crafting' && mode !== 'workshopService' && mode !== 'salvaging' && mode !== 'marketListing' && mode !== 'extraction' && mode !== 'endless' && (
        <PixelActor spriteId="crate" xPct={63} heightPct={21} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-crate-prop" />
      )}

      {/* Work-cycle set-piece FX (M1): glow / sparks / sweep at the
          bench's work point, executing the same spec the hunter's
          cycle runs — silent at rest and under reduced motion. */}
      {benchSpec && (
        <BenchFx
          spec={benchSpec}
          active={benchWorking && !benchCelebrating}
          reduced={reduced}
          xPct={workPointXPct}
          yPct={workPointYPct}
          testId="bench-fx"
        />
      )}
      {/* Extraction set-piece FX (M4a): the sift spec's lamp glow
          and grit burst at the rig's work point — the same spec
          the hunter's cycle executes, so FX and figure can never
          drift — silent while a pass beat celebrates and under
          reduced motion. */}
      {extractionSpec && (
        <BenchFx
          spec={extractionSpec}
          active={!extractionCelebrating}
          reduced={reduced}
          xPct={58}
          yPct={(groundY - 0.17) * 100}
          testId="extraction-fx"
        />
      )}
      {/* The item on the bench (M4b): the running job's output
          picture seated AT the work point — the same anchor the
          FX burst from, so the sparks land on the work itself.
          It clears while a completion beat lifts the finished
          unit off the bench. */}
      {benchSpec && seatPlan && !benchCelebrating && (
        <div
          data-testid="bench-seat"
          className="pointer-events-none absolute z-20 flex items-center justify-center"
          style={{ left: `${workPointXPct}%`, top: `${workPointYPct}%`, width: 48, height: 48, transform: 'translate(-50%, -50%)' }}
        >
          <BenchItemRender plan={seatPlan} testId="bench-seat-render" />
        </div>
      )}
      {/* Completion rise (M1): the finished unit lifts off the
          bench on the law's loot-rise duration while the hunter
          celebrates; the panel below carries the record. */}
      {benchSpec && activeBenchCompletion && (
        <StageRise
          key={benchCompletionKey(activeBenchCompletion)}
          testId="bench-completion-rise"
          xPct={workPointXPct}
          yPct={workPointYPct}
          width={46}
          height={46}
        >
          <BenchRiseIcon entry={activeBenchCompletion} />
        </StageRise>
      )}
      {/* Salvage completion rise (M4b): the recycle's yield lifts
          off the crusher on the same rise the craft lanes use,
          while the hunter celebrates — salvaging's beat was
          forced null before this slice. */}
      {benchSpec && salvageBeat && (
        <StageRise
          key={`salvage-rise-${salvageBeat.key}`}
          testId="salvage-completion-rise"
          xPct={60}
          yPct={workPointYPct}
          width={46}
          height={46}
        >
          <BenchItemRender plan={salvageBeat.plan} testId="salvage-rise-render" />
        </StageRise>
      )}
      {/* Extraction pass rises (M4a): the settled pass's finds lift
          off the sift rig — one PixelMaterial rise per material /
          essence type at its settled count, fanned across the rig
          on the law's loot-rise duration with a small stagger.
          The panel's "Just landed" card prints the same payload
          as the record. */}
      {extractionBeat && (
        <div
          key={extractionBeat.key}
          data-testid="extraction-pass-rises"
          data-pass-key={extractionBeat.key}
          className="pointer-events-none absolute inset-0 z-30"
        >
          {/* The rig's light for the beat (Stage Iteration R2):
              the BenchFx cycle is silenced while celebrating, so
              the pass's beam stands at the work point for the
              rises' whole readable window. */}
          <LootBeam
            xPct={58}
            groundYPct={(groundY - 0.17) * 100}
            color={dropAssetColor(extractionBeat.rises[0].id)}
            widthPx={14}
            flareScale={2.2}
            radiant={false}
            durationMs={extractionBeatDurationMs(extractionBeat.rises.length)}
            reduced={reduced}
          />
          {extractionBeat.rises.map((rise, i) => (
            <StageRise
              key={`${rise.kind}-${rise.id}`}
              testId="extraction-pass-rise"
              dataAttrs={{ 'rise-id': rise.id, 'rise-kind': rise.kind, 'rise-qty': rise.qty }}
              xPct={58 + (i - (extractionBeat.rises.length - 1) / 2) * 7}
              yPct={(groundY - 0.17) * 100}
              delayMs={i * EXTRACTION_RISE_STAGGER_MS}
            >
              <div className="flex h-full flex-col items-center" style={{ paddingTop: 9 }}>
                <PixelMaterial id={rise.id} size={30} />
                <span
                  style={{
                    color: dropAssetColor(rise.id),
                    fontSize: 11,
                    fontWeight: 900,
                    lineHeight: 1.4,
                    textShadow: '1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000',
                  }}
                >
                  ×{rise.qty}
                </span>
              </div>
            </StageRise>
          ))}
        </div>
      )}

      {/* Event prop on the loot stage (§3.4): the fired event's named
          prop stands mid-stage for its feed beat. */}
      {eventProp && event && (
        <PixelActor
          key={`event-prop-${event.id}`}
          spriteId={eventProp.id}
          xPct={52}
          heightPct={23}
          groundY={groundY}
          reduced={reduced}
          breathe={false}
          testId="pixel-event-prop"
        />
      )}
      {isEliteEvent && (
        <PixelActor spriteId="prop-elite-banner" xPct={88} heightPct={26} groundY={groundY} reduced={reduced} breathe={false} testId="pixel-elite-banner" />
      )}

      {/* The equipped vehicle, parked at the scene edge during fights
          (Q4 travel legs + encounter clusters): the actual instance —
          class profile, rolled affix overlays, condition wear — with
          its fuel/condition read from the last claim's status. Affix
          overlays are contained inside the class painting's box
          (h-full + object-contain, the rule PR #579 settled): the
          square scanner painting resolved at box width alone
          rendered ~2.4× the plate height and spilled down the
          stage (stage-artifacts REPORT §2b). */}
      {mode === 'roaming' && vehicle && (
        <div className="absolute" style={{ left: '1%', bottom: `${(1 - groundY) * 100 + 1}%`, width: '21%', zIndex: 5 }} data-testid="pixel-vehicle">
          <div className="relative overflow-hidden">
            <img
              src={getPixelSprite(`vehicle-${vehicle.vehicleClassId.replace(/_/g, '-')}`)?.url}
              alt=""
              draggable={false}
              className="w-full"
              style={{ imageRendering: 'pixelated' }}
            />
            {vehicle.affixes.some((a) => a.stat === 'vehicleCargoPct') && (
              <img src={getPixelSprite('vehicle-affix-cargo-rack')?.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ imageRendering: 'pixelated' }} />
            )}
            {vehicle.affixes.some((a) => a.stat === 'vehicleScannerPct') && (
              <img src={getPixelSprite('vehicle-affix-scanner-array')?.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ imageRendering: 'pixelated' }} />
            )}
            {vehicle.affixes.some((a) => a.stat === 'vehicleFramePct') && (
              <img src={getPixelSprite('vehicle-affix-reinforced-frame')?.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ imageRendering: 'pixelated' }} />
            )}
            {vehicle.conditionCurrent / Math.max(1, vehicle.conditionMax) < 0.35 && (
              <img src={getPixelSprite('vehicle-condition-scuff')?.url} alt="" draggable={false} className="absolute inset-0 h-full w-full object-contain" style={{ imageRendering: 'pixelated' }} />
            )}
          </div>
          {vehicleStatus && (
            <div className="mt-0.5 flex gap-1" data-testid="pixel-vehicle-status">
              <div className="h-1 flex-1 bg-black/60">
                <div className="h-full bg-amber-400" style={{ width: `${Math.min(100, (vehicleStatus.fuelUnitsRemaining / Math.max(1, vehicleStatus.fuelUnitsStart || vehicleStatus.fuelUnitsRemaining)) * 100)}%` }} />
              </div>
              <div className="h-1 flex-1 bg-black/60">
                <div className="h-full bg-emerald-400" style={{ width: `${(vehicleStatus.conditionCurrent / Math.max(1, vehicleStatus.conditionMax)) * 100}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hunter — walks in for combat; dodges the telegraphed lunge on
          damage beats, recoils on his own shots, hops on a kill.
          Persistent wrapper: reactions run through animation controls
          (a per-event remount would replay the walk-in on every tick). */}
      <motion.div
        className="absolute inset-0"
        style={{ transformOrigin: `${hunterPlacement.xPct}% ${groundY * 100}%` }}
        initial={false}
        animate={reduced ? undefined : hunterControls}
      >
        {showEnemy ? (
          /* Combat (slice (c), paintings only on stage): the active
             hunter's whole painting fights — no part layers, no held
             weapon, no mounted gear on the figure. The wrapper above
             still runs every beat reaction (dodge, recoil, hops);
             the travel stride survives as the painting's bob. */
          <PixelPaintedHunterActor
            sprite={hunterSprite}
            {...hunterPlacement}
            reduced={reduced}
            strideCycle={
              mode === 'roaming'
                ? { spec: travelStrideSpec(TRAVEL_SPECS.advance), active: travelActive }
                : undefined
            }
            testId="pixel-hunter"
          />
        ) : benchSpec ? (
          /* Bench modes (Motion Reboot M1; paintings conversion
             2026-11-17): the fielded hunter's PAINTING works the
             set piece — the work cycle survives as the painting's
             bob treatment on the mode's spec while a job runs in
             his lane, and BenchFx carries the strike read at the
             work point. Between jobs the painting stands at his
             station. A settling unit's celebration is the
             completion rise itself; the retired rig's pose system
             is not recreated (owner ruling 2026-11-17: no equipped
             weapon in hand, anywhere). */
          <PixelPaintedHunterActor
            sprite={hunterSprite}
            {...hunterPlacement}
            reduced={reduced}
            workCycle={{ spec: benchSpec, active: benchWorking && !benchCelebrating }}
            testId="pixel-hunter"
          />
        ) : extractionSpec ? (
          /* Extraction (one-stage law, 2026-11-04; Motion M4a;
             paintings conversion 2026-11-17): the painting WORKS
             the site on the stage — the sift cycle runs as the
             painting's bob while the occupation holds the stage:
             unlike the bench lanes there is no job mirror to
             read, so the mode holding the stage IS the work (the
             salvaging precedent). A pass settling mid-watch fires
             its finds rise; the cycle pauses for that beat.
             Reduced motion holds the painting at rest. */
          <PixelPaintedHunterActor
            sprite={hunterSprite}
            {...hunterPlacement}
            reduced={reduced}
            workCycle={{ spec: extractionSpec, active: !extractionCelebrating }}
            testId="pixel-hunter"
          />
        ) : stallSpec ? (
          /* Market listing (M4c; paintings conversion
             2026-11-17): the painting TENDS his stall — the
             stall's low-amplitude cycle running as the painting's
             bob while the listing holds the stage: unlike the
             bench lanes there is no job mirror to read, so the
             mode holding the stage IS the work (the salvaging
             precedent). No BenchFx — nothing is struck at a
             stall. Reduced motion holds the painting at rest. */
          <PixelPaintedHunterActor
            sprite={hunterSprite}
            {...hunterPlacement}
            reduced={reduced}
            workCycle={{ spec: stallSpec, active: true }}
            testId="pixel-hunter"
          />
        ) : (
          /* Standby / presence (camp idle, boss prep, endless):
             the painting stands at the mark. Armed and unarmed
             standby are the same picture now (paintings only on
             stage, ruling 2026-11-15) — the equipped weapon is not
             drawn on the stage figure in any mode; it keeps
             displaying on Gear, cards, and loadouts exactly as
             before. */
          <PixelPaintedHunterActor
            sprite={hunterSprite}
            {...hunterPlacement}
            reduced={reduced}
            testId="pixel-hunter"
          />
        )}
      </motion.div>

      {/* Hunter HP plate (owner ruling 2026-11-02): his HP, raised
          off the floor to lower-body height on the hunter's own
          column — a backed plate with the numbers whole and a
          thick bar, readable at a glance. It is a SIBLING of the
          hunter's animated wrapper, anchored to his placement
          (xPct · ground line), so beat reactions (dodge, recoil)
          never drag it around; face, torso, gun and arms stay
          clear above it. Combat modes only — at camp the art
          stays unobstructed and the strip below carries HP. */}
      {showEnemy && (
        <div
          data-testid="diorama-hunter-hp"
          className="pointer-events-none absolute z-20 w-[104px] border-2 border-border bg-bg/85 px-1.5 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.62)]"
          style={{ ...signClip, left: `${hunterPlacement.xPct}%`, top: `${(groundY - HP_PLATE_LIFT) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <div className="mb-0.5 flex items-baseline justify-between gap-1 text-[11px] font-black leading-none">
            <span className="text-text-muted">HP</span>
            <span style={{ color: hunterHpColor }}>{Math.round(hunterHp)}/{Math.round(hunterMaxHp)}</span>
          </div>
          <GhostHpBar pct={hunterHpRatio * 100} color={hunterHpColor} reduced={reduced} barClassName="h-[9px]" testId="diorama-hunter-hp-bar" />
        </div>
      )}

      {/* Hunter voice (slice (c), §2.6): the active hunter's line
          at its rare triggers — decided state only, one line per
          moment (hunterVoice.ts). Copy is the owner-approved v2
          set (2026-11-15). */}
      <RoamHunterVoice
        event={event}
        xPct={hunterPlacement.xPct}
        topPct={(groundY - hunterPlacement.heightPct / 100) * 100 - 4}
      />

      {/* Enemy — drops in for boss fights (dust + shake on landing),
          walks in roaming; lunges on damage beats; hit/kill reactions.
          In boss prep the boss already stands here (bossOnStage):
          the same drop-in, but no beats answer it — presence only.
          Drop hold: while a drop event stands the slot stays empty
          (see the dropHold derivation above). */}
      {(showEnemy || showBossPrep) && !dropHold && (
        <motion.div
          className="absolute inset-0"
          style={{ transformOrigin: `${enemyPlacement.xPct}% ${groundY * 100}%` }}
          initial={false}
          animate={reduced ? undefined : enemyLungeControls}
        >
          <motion.div
            className="absolute inset-0"
            initial={false}
            animate={reduced ? undefined : enemyHitControls}
            style={{ transformOrigin: `${enemyPlacement.xPct}% ${groundY * 100}%` }}
          >
            {bossOnStage || (isEliteEvent && visuals.eliteSpriteId) ? (
              <PixelActor
                spriteId={isEliteEvent && visuals.eliteSpriteId ? visuals.eliteSpriteId : enemySprite.id}
                {...enemyPlacement}
                heightPct={isEliteEvent ? 74 : enemyPlacement.heightPct}
                reduced={reduced}
                breatheDuration={3.1}
                entrance={bossOnStage ? 'drop' : 'walk'}
                enterFrom="right"
                onLanded={() => setEnemyLanded(true)}
                testId="pixel-enemy"
              />
            ) : (
              <motion.div
                key={`rig-target-${currentTargetId ?? 'none'}-${isEliteEvent ? 'elite' : 'std'}`}
                className="absolute inset-0"
                initial={reduced ? false : { x: `${approachOffsetXPct(0)}%`, opacity: 0 }}
                animate={{ x: '0%', opacity: 1 }}
                transition={{ duration: MOVEMENT.WALK_IN_MS / 1000, ease: 'easeOut' }}
              >
                <PixelRigActor
                  rig={enemyRig(isEliteEvent ? 'elite' : (targetArchetype ?? 'brute'))}
                  {...enemyPlacement}
                  heightPct={isEliteEvent ? 72 : enemyPlacement.heightPct}
                  feetX={enemySprite.anchors.feet?.x ?? 0.5}
                  reduced={reduced}
                  pose={enemyRigPose}
                  palette={{ paletteId: areaId, spec: visuals.enemyPalette }}
                  testId="pixel-enemy"
                >
                  {/* The area's signature part rides the enemy (§4.4). */}
                  {getPixelSprite(visuals.signaturePartId) && (
                    <img
                      src={getPixelSprite(visuals.signaturePartId)!.url}
                      alt=""
                      draggable={false}
                      data-testid="pixel-enemy-signature"
                      className="pointer-events-none absolute"
                      style={{ left: '38%', top: '26%', width: '18%', imageRendering: 'pixelated', zIndex: 5 }}
                    />
                  )}
                </PixelRigActor>
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}

      {/* Landing dust when the boss drops in */}
      {enemyLanded && bossOnStage && !reduced && <DustPuff xPct={enemyFeet.xPct} yPct={enemyFeet.yPct} width={96} />}

      {/* Combat beat FX — positioned from manifest anchors */}
      {combatBeat && event && (
        <div key={`beat-${event.id}`} className="absolute inset-0" data-testid="diorama-beat-fx">
          {(combatBeat.kind === 'shot' || combatBeat.kind === 'crit') && (
            <>
              <MuzzleFlash xPct={muzzle.xPct} yPct={muzzle.yPct} color={dialect.muzzleColor} size={34 * dialect.muzzleScale} />
              {/* Element dialect (§4.6): tracer color/dash from the
                  element, count/spread from the instance's cadence. */}
              {Array.from({ length: cadence.tracerCount }, (_, i) => {
                const offset = (i - (cadence.tracerCount - 1) / 2) * cadence.spreadPct;
                return (
                  <Tracer
                    key={`tracer-${i}`}
                    from={muzzle}
                    to={{ xPct: enemyMass.xPct, yPct: enemyMass.yPct + offset }}
                    color={dialect.tracerColor}
                    heightPx={dialect.tracerWidth}
                  />
                );
              })}
              <ShellCasing xPct={grip.xPct} yPct={grip.yPct} />
              <ImpactSparks xPct={enemyMass.xPct} yPct={enemyMass.yPct} seed={event.id} color={dialect.impactColor} />
              {getPixelSprite(dialect.statusSpriteId) && (
                <img
                  src={getPixelSprite(dialect.statusSpriteId)!.url}
                  alt=""
                  draggable={false}
                  data-testid="fx-status-overlay"
                  className="pointer-events-none absolute z-20"
                  style={{
                    left: `${enemyMass.xPct}%`,
                    top: `${enemyMass.yPct}%`,
                    width: 44,
                    marginLeft: -22,
                    marginTop: -22,
                    imageRendering: 'pixelated',
                    opacity: 0.9,
                  }}
                />
              )}
              <motion.div
                data-testid="fx-hit-flash"
                className="pointer-events-none absolute z-20 rounded-full bg-white"
                style={{ left: `${enemyMass.xPct}%`, top: `${enemyMass.yPct}%`, width: 96, height: 96, marginLeft: -48, marginTop: -48 }}
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0.45, 0] }}
                transition={{ duration: MOVEMENT.HIT_REACTION_MS / 1000 }}
              />
              <DamageNumber xPct={enemyMass.xPct} yPct={enemyMass.yPct - 6} value={combatBeat.value ?? 0} crit={combatBeat.kind === 'crit'} />
            </>
          )}
          {combatBeat.kind === 'crit' && <CritFlash />}
          {combatBeat.kind === 'playerHit' && (
            <>
              <TelegraphGlow xPct={enemyMass.xPct} yPct={enemyMass.yPct} />
              <DamageNumber xPct={hunterMass.xPct} yPct={hunterMass.yPct - 6} value={combatBeat.value ?? 0} tone="player" delayMs={MOVEMENT.TELEGRAPH_MS} />
              <motion.div
                className="pointer-events-none absolute inset-0 z-30 bg-[#FF0000]/12"
                initial={{ opacity: 0 }}
                animate={{ opacity: [0, 0, 1, 0] }}
                transition={{ duration: (MOVEMENT.TELEGRAPH_MS + 300) / 1000, times: [0, 0.55, 0.7, 1] }}
              />
            </>
          )}
          {combatBeat.kind === 'kill' && <DustRing xPct={enemyFeet.xPct} yPct={enemyFeet.yPct} delayMs={120} />}
        </div>
      )}

      {/* Loot rises (visual honesty): the rise at the fallen enemy's
          feet (Stage Iteration R2 — the manifest loot point floated
          the drop above the corpse's head, where it read as set
          dressing) pictures the grant the tick actually carried —
          key shard for a cache fragment, the material/essence icon
          for a find, a scrap rise for a kill payout — under a beam
          in the drop's own color at the corpse. Icons are the drop
          rise grids (DropRiseIcon). The cache crate below
          rises ONLY on a real cache grant (tone 'cache'); roaming ticks
          never carry one, so the crate no longer appears while roaming.
          Gear drops keep their LootMoment further down. */}
      {lootRise && lootRise !== 'crate' && event && (
        <React.Fragment key={`loot-rise-${event.id}`}>
          {/* The drop's own light at the corpse (Stage Iteration
              R2): the beam stands at the fallen enemy's feet for
              the rise's whole readable window. */}
          <LootBeam
            xPct={enemyFeet.xPct}
            groundYPct={enemyFeet.yPct}
            color={dropRiseBeamColor(lootRise, event.label)}
            widthPx={14}
            flareScale={2.2}
            radiant={false}
            durationMs={lootRiseTotalMs()}
            fadeTailMs={MOVEMENT.LOOT_RISE_FADE_MS}
            reduced={reduced}
          />
          <StageRise
            testId="diorama-loot-rise"
            dataAttrs={{ 'loot-visual': lootRise }}
            xPct={enemyFeet.xPct}
            yPct={enemyFeet.yPct}
            width={150}
            liftPx={ROAM_DROP_LIFT_PX}
          >
            <DropRiseIcon
              tone={lootRise === 'scrap' || lootRise === 'credits' ? 'cash' : lootRise}
              label={lootRise === 'scrap' ? 'scrap' : event.label}
            />
          </StageRise>
        </React.Fragment>
      )}
      {lootRise === 'crate' && crate && (
        <React.Fragment key={`loot-${event?.id}`}>
          <LootBeam
            xPct={enemyFeet.xPct}
            groundYPct={enemyFeet.yPct}
            color="#FFD700"
            widthPx={14}
            flareScale={2.2}
            radiant={false}
            durationMs={lootRiseTotalMs()}
            reduced={reduced}
          />
          <StageRise xPct={enemyFeet.xPct} yPct={enemyFeet.yPct} width={54} height={58} liftPx={ROAM_DROP_LIFT_PX}>
            <img
              data-testid="diorama-crate-rise"
              src={crate.url}
              alt=""
              draggable={false}
              style={{ width: 54, imageRendering: 'pixelated' }}
            />
          </StageRise>
        </React.Fragment>
      )}

      {/* P3 loot moment for real gear drops: rarity beam + drop card at
          the fallen enemy's feet (light for ordinary drops, the
          full legendary treatment when a legendary lands). The drop was
          already awarded by the Chef claim — this only celebrates it. */}
      {dropItem && event && (
        <LootMoment
          key={`loot-moment-${event.id}`}
          items={[dropItem]}
          surface="feed"
          reduced={reduced}
          anchorXPct={enemyFeet.xPct}
          groundYPct={enemyFeet.yPct}
          testId="diorama-loot-moment"
        />
      )}
    </PixelStage>
  );
};

// ── Scene renderer switch (Motion Reboot M2, 2026-11-07) ─────────────
// PixelSceneLayer is now a renderer switch on the BossFightStage
// pattern: when the mode is ROAMING, WebGL is available, and motion
// is not reduced, the Pixi stage (code-split, lazy-loaded on first
// roam) carries the scene; every other mode — and roaming under
// reduced motion, no WebGL context, or any Pixi init/texture
// failure — renders the DOM scene above, byte-identical to before
// M2. Both renderers consume the same stores, the same tick events,
// and the same movement.ts law; the M2 PR carries the A/B evidence.
/**
 * The Pixi takeover cover (stage-iteration B2, 2026-11-12): holds
 * the transient DOM scene over the Pixi stage until the stage
 * reports its first drawn frames (onSceneReady). Before this gate,
 * the Suspense fallback unmounted the moment the Pixi chunk
 * resolved and the canvas sat black for the entire scene build —
 * texture loads included — on every cold roam mount. The cover is
 * the same inert transient instance the Suspense fallback used (no
 * walk clock, no resume probe), now rendered OUTSIDE the Suspense
 * boundary so ONE instance spans both phases — chunk load and
 * scene build — instead of unmounting and remounting between them,
 * and it drops only when the swap can land on a live frame. A Pixi
 * failure still routes through onPixiError and the switch renders
 * the DOM scene permanently. The readiness state is mount-scoped:
 * leaving roaming and returning re-covers.
 */
const PixiSceneWithCover: React.FC<{
  pixiProps: RoamPixiStageProps;
  domProps: React.ComponentProps<typeof PixelSceneLayerDom>;
  /** Pixi-path DOM companions (the hunter HP plate): rendered only
   *  once the cover drops — the cover's own scene carries the
   *  identical plate in the identical spot until then, so the
   *  plate never doubles during the swap. */
  children?: React.ReactNode;
}> = ({ pixiProps, domProps, children }) => {
  const [pixiReady, setPixiReady] = useState(false);
  return (
    <>
      <React.Suspense fallback={null}>
        <RoamPixiStageLazy {...pixiProps} onSceneReady={() => setPixiReady(true)} />
      </React.Suspense>
      {!pixiReady && <PixelSceneLayerDom {...domProps} transientFallback />}
      {pixiReady && children}
    </>
  );
};

const PixelSceneLayer: React.FC<React.ComponentProps<typeof PixelSceneLayerDom>> = (props) => {
  const webgl = React.useMemo(() => detectWebGL(), []);
  const [pixiFailed, setPixiFailed] = useState(false);
  const targetMaxHp = useKillCycleStore((state) => state.currentTargetHpMax);
  const currentTargetId = useKillCycleStore((state) => state.currentTargetId);
  const currentTargetHp = useKillCycleStore((state) => state.currentTargetHp);
  if (props.mode !== 'roaming' || props.reduced || !webgl || pixiFailed) {
    return <PixelSceneLayerDom {...props} />;
  }
  const pixiProps: RoamPixiStageProps = {
    backgroundId: props.backgroundId,
    weapon: props.weapon,
    event: props.event,
    areaId: props.areaId,
    hot: props.hot,
    targetMaxHp,
    currentTargetId: currentTargetId ?? undefined,
    currentTargetHp,
    onPixiError: () => setPixiFailed(true),
  };
  return (
    <PixiSceneWithCover pixiProps={pixiProps} domProps={props}>
      {/* DOM companions the Pixi scene does not carry: the hunter
          HP plate (a sibling of the hunter wrapper in the DOM
          scene, anchored to his placement) — rendered here so it
          rides the Pixi path identically. It mounts with the
          cover drop: the cover's own scene carries the identical
          plate until the Pixi stage's first frames land. */}
      <RoamHunterHpPlate groundY={getPixelSprite(props.backgroundId)?.anchors.groundLine?.y ?? 0.86} />
    </PixiSceneWithCover>
  );
};

/** The hunter HP plate for the Pixi roam path — the identical
 *  plate PixelSceneLayer renders in the DOM scene (same placement,
 *  same lift, same store), as a sibling of the scene so canvas
 *  beats never drag it. */
const RoamHunterHpPlate: React.FC<{ groundY: number }> = ({ groundY }) => {
  const hunterHp = useSurvivalStore((state) => state.currentHp);
  const hunterMaxHp = useSurvivalStore((state) => state.maxHp);
  const hunterHpRatio = hunterMaxHp > 0 ? Math.max(0, Math.min(1, hunterHp / hunterMaxHp)) : 1;
  const hunterHpColor = hunterHpRatio >= 0.6 ? '#4ADE80' : hunterHpRatio >= 0.3 ? '#FF9000' : '#F87171';
  return (
    <div
      data-testid="diorama-hunter-hp"
      className="pointer-events-none absolute z-20 w-[104px] border-2 border-border bg-bg/85 px-1.5 py-1 shadow-[4px_4px_0_rgba(0,0,0,0.62)]"
      style={{ ...signClip, left: `${ROAM_HUNTER_PLACEMENT.xPct}%`, top: `${(groundY - HP_PLATE_LIFT) * 100}%`, transform: 'translateX(-50%)' }}
    >
      <div className="mb-0.5 flex items-baseline justify-between gap-1 text-[11px] font-black leading-none">
        <span className="text-text-muted">HP</span>
        <span style={{ color: hunterHpColor }}>{Math.round(hunterHp)}/{Math.round(hunterMaxHp)}</span>
      </div>
      <GhostHpBar pct={hunterHpRatio * 100} color={hunterHpColor} barClassName="h-[9px]" testId="diorama-hunter-hp-bar" />
    </div>
  );
};


// ── Main Diorama Component ───────────────────────────────────────────────────────

export const LiveTurfDiorama: React.FC<LiveTurfDioramaProps> = ({ area, weapon, bossName, boss, playerLevel: _playerLevel, equippedCount, activityKind = 'idle_standby', bossPhase, endlessRunId, stageControls }) => {
  const stageRef = useRef<HTMLElement | null>(null);
  const stageVisible = useStageVisible(stageRef);
  const reduced = !!useReducedMotion();
  const latestEvent = useTickFeedStore((state) => state.events[0]);
  // A new tick event re-renders this diorama so the stage can react.
  // Hunter Totals computation has been lifted to DashboardScreen.
  // statSummary prop is provided by the parent; diorama uses it directly.
  const scene = getLiveTurfScene(area);
  // SVG-closure (2026-11-07): the vector fallback scene is deleted —
  // every roaming area resolves a pixel background (CI-asserted in
  // pixelWave1.test); an unmapped id resolves to undefined and NO
  // scene renders — the stage shell and its overlays only (PR #446
  // semantics, pinned by pixelDiorama.test.tsx).
  const pixelBackgroundId = pixelBackgroundForArea(area.id);
  // The diorama identifies the challenged boss by name; resolve its
  // bespoke pixel sprite through the boss def id (P4 wave 1).
  const stageBossDef = bossName ? REGION_1_BOSSES.find((b) => b.name === bossName) : undefined;
  const stageBossSpriteId = pixelBossSpriteForBoss(stageBossDef?.id);
  const mode = modeFromActivity(activityKind, bossPhase);
  const stageTargetHp = useKillCycleStore((state) => state.currentTargetHp);
  // Drop hold (Inkling R1, ported at the baseline reset): the
  // target HP plate unmounts for the drop's whole window — the
  // plate belongs to the fallen enemy, and no figure stands
  // behind the drop for it to describe.
  const stageEnemyHold = mode === 'roaming' ? enemyDropHold(latestEvent, stageTargetHp) : null;
  // One-Stage Law (owner ruling 2026-11-06): while the encounter
  // panel plays back a Chef-decided attempt, it publishes the
  // fight presentation to the boss store and THIS stage renders
  // the animated fight from it — the panel mounts no fight stage
  // of its own, so exactly one animated fight exists. Guarded to
  // the challenged boss so a stale presentation can never wear
  // the wrong arena. (F5 closed: the phase reaches the mode here,
  // and the screen passes it — see ActionScreenContextual.)
  const fightPresentation = useBossStore((state) => state.fightPresentation);
  const showFightStage = mode === 'bossFight' && !!fightPresentation && !!boss && fightPresentation.bossId === boss.id;
  // Motion Reboot M3 — endless comes home (the #431 pattern): the
  // Endless panel publishes its fight walk and the run's presence
  // to the same store. The fight renders here only while the run
  // on the activity record IS the run that published it (the
  // record's targetId is the server-pinned run id, migration
  // 0028) — a stale presentation from a finished or abandoned run
  // can never wear the stage. Between fights the stage shows the
  // run's PRESENCE: the next encounter standing in its own arena
  // (the boss-prep treatment), never the camp vista.
  const endlessPresentation = useBossStore((state) => state.endlessPresentation);
  const endlessPresence = useBossStore((state) => state.endlessPresence);
  const showEndlessFightStage = mode === 'endless' && !!endlessPresentation && !!endlessRunId && endlessPresentation.runId === endlessRunId;
  const activeEndlessPresence = mode === 'endless' && !!endlessPresence && !!endlessRunId && endlessPresence.runId === endlessRunId
    ? endlessPresence
    : null;
  // The presence backdrop is the encounter's own ground — the
  // same derivation the fight stage uses (pack depths: their
  // rotation area's ground; boss depths: the kit's arena), so
  // presence and fight share one backdrop across the transition.
  const endlessPresenceBackgroundId = activeEndlessPresence
    ? activeEndlessPresence.encounterKind === 'pack'
      ? `zone-${activeEndlessPresence.areaId.split('_')[0]}-bg`
      : bossArena(activeEndlessPresence.encounterId).backgroundId
    : undefined;
  const endlessPresenceSpriteId = activeEndlessPresence
    ? (pixelBossSpriteForBoss(activeEndlessPresence.encounterId) ?? 'brute')
    : undefined;
  const sceneBackgroundId = endlessPresenceBackgroundId ?? pixelBackgroundId;
  // Stage furniture (DESIGN.md §1, drift-fix F2; owner rulings
  // 2026-11-02, 2026-11-03): the Stage carries the count plate
  // (top-right), the action-control chips (top-left — see
  // stageControls below), and the combat HP plates at the
  // actors' bases. There is NO area/target plate anymore: the
  // owner removed the "Area · …" banner from the scene outright
  // — area switching lives one tap away in the rail's AREA stop
  // and the workspace panels' Change Area buttons, and the
  // boss's name rides its HP plate. There is no headline title
  // either. And since the 2026-11-03 Home consolidation there is
  // NO status ribbon on the stage at all: the ribbon's mode word
  // ("ROAMING") died — the scene, the rail, and the workspace
  // already say it — and its effective-stats band was replaced
  // by the screen's hero rundown, attached to the stage's FOOT
  // (below the art, never over it, so the HP plates keep their
  // pairing with the actors). Events live in the feed cards.
  // The ground line the HP plates anchor to: the same anchor the
  // rendered scene uses — the pixel background's groundLine, or
  // the scene layer's own default (0.86) for an area with no
  // pixel background.
  const stageGroundYPct = pixelBackgroundId
    ? (getPixelSprite(pixelBackgroundId)?.anchors.groundLine?.y ?? 0.86)
    : 0.86;

  return (
    <PresentationActiveContext.Provider value={stageVisible}>
    <section ref={stageRef} className="relative h-[286px] overflow-hidden border-2 border-border bg-bg shadow-[0_10px_22px_rgba(0,0,0,0.6)]" style={panelClip}>
      {showFightStage && fightPresentation ? (
        /* The boss fight's animated home (One-Stage Law): the
           decided fight plays HERE, on the main stage, in place of
           the ambient scene — the encounter panel below keeps the
           readouts. The boss HP plate and the stage controls keep
           riding this section's overlay layer as always. */
        <div className="absolute inset-0" data-testid="diorama-boss-fight">
          <BossFightStage
            embedded
            timeline={fightPresentation.timeline}
            phases={fightPresentation.phases}
            bossId={fightPresentation.bossId}
            weapon={fightPresentation.weapon}
            reduced={reduced}
            signatureFire={fightPresentation.signatureFire ?? null}
          />
        </div>
      ) : showEndlessFightStage && endlessPresentation ? (
        /* The endless fight's animated home (Motion Reboot M3):
           the decided encounter plays HERE, on the main stage —
           the Chaos Chamber panel below keeps depth, banking,
           and result, and mounts no fight stage of its own. */
        <div className="absolute inset-0" data-testid="diorama-endless-fight">
          <BossFightStage
            embedded
            timeline={endlessPresentation.timeline}
            phases={endlessPresentation.phases}
            bossId={endlessPresentation.encounterId}
            backgroundId={endlessPresentation.backgroundId}
            depthBadge={{ depth: endlessPresentation.depth, band: endlessPresentation.band }}
            weapon={endlessPresentation.weapon}
            reduced={reduced}
            signatureFire={endlessPresentation.signatureFire ?? null}
          />
        </div>
      ) : sceneBackgroundId ? (
        <PixelSceneLayer backgroundId={sceneBackgroundId} bossSpriteId={mode === 'endless' ? endlessPresenceSpriteId : stageBossSpriteId} weapon={weapon} mode={mode} event={latestEvent} reduced={reduced} areaId={area.id} hot={isHotArea(area.id, new Date())} />
      ) : null}
      {/* No fallback scene (owner ruling 2026-11-07): the inline-SVG
          diorama that used to render for areas with no pixel
          background is killed — in a total-SVG-ban game the DOM
          pixel stage above is the only ambient stage. An area with
          no pixel background renders the stage shell and its
          overlays only. */}

      {/* Target / boss HP plates — the roaming target's plate
          rides IN the stage, lifted level with the hunter's plate
          over the enemy's lower body (owner ruling 2026-11-03);
          the boss plate stays anchored under the boss on the
          ground line (owner ruling 2026-11-02, reaffirmed
          2026-11-03). Neither ever sits across a face. */}
      <TargetHpOverlay active={activityKind === 'roaming_loot' && !stageEnemyHold} accentColor={scene.accent} groundYPct={stageGroundYPct} reduced={reduced} />
      <BossHpOverlay active={activityKind === 'boss_fight' && bossPhase === 'fight'} accentColor={scene.accent} groundYPct={stageGroundYPct} reduced={reduced} />
      {/* The count plate is the top row's only resident now
          (owner ruling 2026-11-02 removed the area/target plate
          from the top-left; the action controls took that
          corner). It rides at z-20 — above every sprite layer
          (the weapon illustration paints at z-10) — so its text
          is never clipped by sprites (Wave C alignment fix; the
          scene itself is untouched). */}
      <div className="absolute inset-x-2 top-2 z-20 flex items-start justify-end gap-2">
        <div className="pointer-events-none shrink-0 border-2 border-border bg-bg/85 px-2 py-1 text-right shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={signClip}><div className="text-xs font-black text-amber">{equippedCount}/7 gear</div></div>
      </div>
      {!weapon ? (
        <div
          className="pointer-events-none absolute left-[82px] top-[108px] z-10 -rotate-6 border-2 border-border bg-bg/85 px-2 py-1 text-[11px] font-black uppercase tracking-wide text-text-muted shadow-[4px_4px_0_rgba(0,0,0,0.62)]"
          data-testid="diorama-unarmed-state"
        >
          Unarmed
        </div>
      ) : null}
      {/* No status ribbon (Home consolidation, owner steer
          2026-11-03): the mode word and the stats band left the
          stage — the hero rundown attaches to the stage's foot
          in the screen's flow, below the art. The in-stage action
          bar and the floating weapon/event cards that used to
          cover the art are gone (drift-fix F2): the mode's
          actions live in the workspace directly under the stage,
          where the mode rail put them. */}
      {/* Action controls (owner rulings 2026-11-02, icon-only
          2026-11-03): Switch / Stop float on the scene in the
          TOP-LEFT corner the removed area plate vacated, so the
          scene's lower half (hunter, enemy, loot moment) carries
          no controls at all. The screen owns the buttons; the
          stage owns the placement. z-30 rides above every sprite
          layer; the count plate keeps the top-right. */}
      {stageControls ? (
        <div data-testid="diorama-stage-controls" className="absolute left-2 top-2 z-30 flex items-start gap-2">
          {stageControls}
        </div>
      ) : null}
    </section>
    </PresentationActiveContext.Provider>
  );
};
