import React, { useEffect, useMemo, useState } from 'react';
import { motion, useAnimationControls } from 'framer-motion';
import { PixelStage, PixelActor } from './PixelStage';
import { PixelWeapon } from './PixelWeapon';
import {
  CritFlash,
  DamageNumber,
  DustPuff,
  DustRing,
  ImpactSparks,
  MuzzleFlash,
  PixelSway,
  ShellCasing,
  TelegraphGlow,
  Tracer,
} from './PixelFx';
import { getPixelSprite, pixelBossSpriteForBoss, requirePixelSprite } from '@/lib/pixel/manifest';
import { bossArena } from '@/content/areaPalettes';
import {
  MOVEMENT,
  actorAnchorPoint,
  derivePhaseBeats,
  type ActorPlacement,
  type PhaseBeat,
} from '@/lib/pixel/movement';
import type { FightTimeline } from '@/lib/animation/fightTimeline';
import type { PhaseAnalysis } from '@/types/boss';
import type { Weapon } from '@/types/items';

/**
 * BossFightStage (P2) — the pixel staging of a boss fight inside the
 * fight card. The boss sim (via the Chef) has already decided the whole
 * fight; the FightTimeline walks it phase by phase at Sample B pacing,
 * and this stage choreographs each phase from the timeline's own damage
 * log via derivePhaseBeats:
 *
 *   hunter shot (flash / tracer / casing / sparks / damage number)
 *   → boss hit reaction — or, on the killing phase, the death collapse
 *   → boss telegraph → lunge → hunter dodge (or the fatal hit)
 *
 * Victory ends on the collapsed boss + dust ring + banner; defeat ends
 * on the fallen hunter. Presentation only — it reads the timeline and
 * never touches outcomes, HP, or loot. Reduced motion renders the actors
 * statically with the banner; all state remains in the card's bars/log.
 */

const HUNTER_PLACEMENT: ActorPlacement = { xPct: 20, heightPct: 62, groundY: 0.86 };
const BOSS_PLACEMENT: ActorPlacement = { xPct: 76, heightPct: 80, groundY: 0.86 };

interface BossFightStageProps {
  timeline: FightTimeline;
  phases: PhaseAnalysis[];
  /** Boss def id (src/constants/bosses.ts) — selects the boss's bespoke
   *  pixel sprite (P4 wave 1). Absent or unshipped ids keep the brute. */
  bossId?: string;
  weapon?: Weapon;
  reduced?: boolean;
}

export const BossFightStage: React.FC<BossFightStageProps> = ({ timeline, phases, bossId, weapon, reduced = false }) => {
  // Unique arena per boss (Q3 ruling): the boss's own arena art + its
  // signature prop; the home area informs palette only.
  const arena = bossArena(bossId);
  const background = getPixelSprite(arena.backgroundId);
  const groundY = background?.anchors.groundLine?.y ?? HUNTER_PLACEMENT.groundY;
  const hunterPlacement = { ...HUNTER_PLACEMENT, groundY };
  const bossPlacement = { ...BOSS_PLACEMENT, groundY };

  const victory = timeline.outcome?.result.victory === true;
  const finished = timeline.finishedAt != null;
  const presentingIndex = Math.max(0, Math.min(timeline.currentPhaseIndex, phases.length - 1));
  const currentPhase = phases[presentingIndex];
  const isLastPhase = presentingIndex === phases.length - 1;

  // This phase's decided damage, from the timeline's own log.
  const { bossDamage, playerDamage } = useMemo(() => {
    if (!currentPhase) return { bossDamage: 0, playerDamage: 0 };
    const entries = timeline.damageLog.filter((e) => e.phaseName === currentPhase.phaseName);
    return {
      bossDamage: entries.filter((e) => e.target === 'boss').reduce((m, e) => Math.max(m, e.value), 0),
      playerDamage: entries.filter((e) => e.target === 'player').reduce((m, e) => Math.max(m, e.value), 0),
    };
  }, [timeline.damageLog, currentPhase]);

  const beats: PhaseBeat[] = useMemo(
    () =>
      finished || reduced
        ? []
        : derivePhaseBeats({
            bossDamage,
            playerDamage,
            bossMaxHp: timeline.bossHpMax,
            bossDies: victory && isLastPhase,
            playerDies: !victory && isLastPhase,
          }),
    [finished, reduced, bossDamage, playerDamage, timeline.bossHpMax, victory, isLastPhase],
  );
  const beat = (kind: PhaseBeat['kind']) => beats.find((b) => b.kind === kind);
  const shotBeat = beat('shot') ?? beat('crit');
  const isCrit = !!beat('crit');

  // Stage shake: derived from the phase's beats (crits and the death
  // beat shake hardest); the boss's drop-in landing is the fallback key.
  const [landed, setLanded] = useState(false);
  const beatShake = useMemo<{ key: string; intensity: number; durationMs: number } | undefined>(() => {
    if (reduced || finished) return undefined;
    if (beat('death')) return { key: `death-${presentingIndex}`, intensity: 6, durationMs: MOVEMENT.KILL_SHAKE_MS + 160 };
    if (isCrit) return { key: `crit-${presentingIndex}`, intensity: 7, durationMs: MOVEMENT.CRIT_SHAKE_MS };
    if (shotBeat) return { key: `shot-${presentingIndex}`, intensity: 3, durationMs: MOVEMENT.SHAKE_MS + 120 };
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats, presentingIndex, finished, reduced]);

  const hunterSprite = requirePixelSprite('hunter');
  const bossSprite = getPixelSprite(pixelBossSpriteForBoss(bossId) ?? 'brute') ?? requirePixelSprite('brute');
  const muzzle = actorAnchorPoint(hunterSprite, 'muzzle', hunterPlacement);
  const grip = actorAnchorPoint(hunterSprite, 'grip', hunterPlacement);
  const hunterMass = actorAnchorPoint(hunterSprite, 'centerMass', hunterPlacement);
  const bossMass = actorAnchorPoint(bossSprite, 'centerMass', bossPlacement);
  const bossFeet = actorAnchorPoint(bossSprite, 'feet', bossPlacement);

  const bossDown = finished && victory;
  const hunterDown = finished && !victory && timeline.outcome != null;

  // Actor reactions run through animation controls on PERSISTENT wrappers:
  // keying/remounting a wrapper per phase would restart the actors'
  // entrances every 1.15 s. One effect per phase (and one for the finish)
  // starts the beat sequences; framer delays sequence them in-phase.
  const hunterControls = useAnimationControls();
  const bossLungeControls = useAnimationControls();
  const bossHitControls = useAnimationControls();
  useEffect(() => {
    if (reduced) return;
    if (finished) {
      if (victory) {
        void bossHitControls.start({ scale: 0.45, y: 26, rotate: -10, opacity: 0.85, x: 0, transition: { duration: 0.3 } });
      } else if (timeline.outcome) {
        void hunterControls.start({ rotate: -68, y: 30, opacity: 0.7, x: 0, transition: { duration: 0.55, ease: 'easeIn' } });
      }
      return;
    }
    // Hunter: fatal hit > dodge > recoil > rest.
    if (beat('playerHit')) {
      void hunterControls.start({
        x: [0, -10, 4, 0],
        rotate: [0, -3, 1, 0],
        opacity: [1, 0.45, 1, 1],
        transition: { duration: MOVEMENT.DODGE_MS / 1000, delay: MOVEMENT.BEAT_LUNGE_AT_MS / 1000 },
      });
    } else if (beat('dodge')) {
      void hunterControls.start({
        x: [0, 0, -30, -26, 0],
        scaleY: [1, 1, 0.9, 0.96, 1],
        transition: { duration: MOVEMENT.DODGE_MS / 1000, delay: MOVEMENT.BEAT_LUNGE_AT_MS / 1000, times: [0, 0.35, 0.55, 0.75, 1] },
      });
    } else if (shotBeat) {
      void hunterControls.start({ x: [0, -4, 0], transition: { duration: 0.22 } });
    } else {
      void hunterControls.start({ x: 0, rotate: 0, opacity: 1, scaleY: 1, y: 0, transition: { duration: 0.2 } });
    }
    // Boss lunge.
    if (beat('lunge')) {
      void bossLungeControls.start({
        x: [0, 0, -112, -96, 0],
        transition: { duration: (MOVEMENT.LUNGE_MS + 260) / 1000, delay: MOVEMENT.BEAT_LUNGE_AT_MS / 1000, times: [0, 0.3, 0.52, 0.72, 1] },
      });
    } else {
      void bossLungeControls.start({ x: 0, transition: { duration: 0.2 } });
    }
    // Boss hit reaction / death.
    if (beat('death')) {
      void bossHitControls.start({
        scale: [1, 0.92, 0.45],
        y: [0, 4, 26],
        rotate: [0, -3, -10],
        opacity: [1, 1, 0.85],
        transition: { duration: MOVEMENT.DEATH_COLLAPSE_MS / 1000, delay: MOVEMENT.HIT_REACTION_MS / 1000, ease: 'easeIn' },
      });
    } else if (shotBeat) {
      void bossHitControls.start({
        scale: [1, 0.93, 1.03, 1],
        x: [0, 9, -3, 0],
        transition: { duration: MOVEMENT.HIT_REACTION_MS / 1000 },
      });
    } else {
      void bossHitControls.start({ scale: 1, x: 0, y: 0, rotate: 0, opacity: 1, transition: { duration: 0.25 } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beats, finished, victory, reduced]);

  return (
    <div
      className="relative h-[228px] w-full overflow-hidden border-2 border-border bg-bg"
      data-testid="boss-fight-stage"
      data-phase={presentingIndex}
      data-finished={finished}
    >
      <PixelStage
        backgroundId={arena.backgroundId}
        groundY={groundY}
        reduced={reduced}
        embers
        shakeKey={beatShake?.key ?? (landed && !reduced ? 'boss-land' : undefined)}
        shakeIntensity={beatShake?.intensity ?? 5}
        shakeDurationMs={beatShake?.durationMs}
        testId="boss-fight-pixel-stage"
      >
        {/* The arena's signature prop stands at the back of the pit. */}
        {getPixelSprite(arena.propId) && (
          <PixelActor spriteId={arena.propId} xPct={50} heightPct={30} groundY={groundY} reduced={reduced} breathe={false} testId="boss-arena-prop" />
        )}

        {/* Phase chip */}
        {currentPhase && (
          <div className="pointer-events-none absolute left-2 top-2 z-20 border-2 border-black bg-[#050608]/85 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide text-amber">
            {finished ? (victory ? 'Victory' : 'Defeat') : `Phase ${presentingIndex + 1} — ${currentPhase.phaseName}`}
          </div>
        )}

        {/* Hunter — recoil on his shot, dodge (or fatal hit) on the counter.
            Persistent wrapper; reactions run through hunterControls. */}
        <motion.div
          className="absolute inset-0"
          style={{
            transformOrigin: `${hunterPlacement.xPct}% ${groundY * 100}%`,
            ...(reduced && hunterDown ? { transform: 'rotate(-68deg) translateY(30px)', opacity: 0.7 } : {}),
          }}
          initial={false}
          animate={reduced ? undefined : hunterControls}
        >
          <PixelActor spriteId="hunter" {...hunterPlacement} reduced={reduced} entrance="walk" enterFrom="left" testId="boss-stage-hunter">
            {weapon && (
              <div className="pointer-events-none absolute" style={{ left: '24%', top: '26%', width: '78%', transform: 'rotate(-3deg)' }}>
                <PixelSway reduced={reduced}>
                  <PixelWeapon weapon={weapon} fluid testId="boss-stage-weapon" />
                </PixelSway>
              </div>
            )}
          </PixelActor>
        </motion.div>

        {/* Boss — drop-in landing, hit reaction, telegraphed lunge, death.
            Persistent wrappers; reactions run through controls. */}
        <motion.div
          className="absolute inset-0"
          style={{ transformOrigin: `${bossPlacement.xPct}% ${groundY * 100}%` }}
          initial={false}
          animate={reduced ? undefined : bossLungeControls}
        >
          <motion.div
            className="absolute inset-0"
            style={{
              transformOrigin: `${bossPlacement.xPct}% ${groundY * 100}%`,
              ...(reduced && bossDown ? { transform: 'scale(0.45) translateY(26px) rotate(-10deg)', opacity: 0.85 } : {}),
            }}
            initial={false}
            animate={reduced ? undefined : bossHitControls}
          >
            <PixelActor
              spriteId={bossSprite.id}
              {...bossPlacement}
              reduced={reduced}
              breatheDuration={3.1}
              entrance="drop"
              onLanded={() => setLanded(true)}
              testId="boss-stage-boss"
            />
          </motion.div>
        </motion.div>

        {/* Landing dust for the boss drop-in */}
        {landed && !reduced && <DustPuff xPct={bossFeet.xPct} yPct={bossFeet.yPct} width={110} />}

        {/* Beat FX layer — sequenced by framer delays inside the phase */}
        {!reduced && !finished && (
          <div key={`beats-${presentingIndex}`} className="absolute inset-0" data-testid="boss-fight-beats">
            {shotBeat && (
              <>
                <MuzzleFlash xPct={muzzle.xPct} yPct={muzzle.yPct} />
                <Tracer from={muzzle} to={bossMass} />
                <ShellCasing xPct={grip.xPct} yPct={grip.yPct} />
                <ImpactSparks xPct={bossMass.xPct} yPct={bossMass.yPct} seed={`boss-${presentingIndex}`} />
                {/* Hit flash over the boss's center-mass */}
                <motion.div
                  data-testid="fx-hit-flash"
                  className="pointer-events-none absolute z-20 rounded-full bg-white"
                  style={{ left: `${bossMass.xPct}%`, top: `${bossMass.yPct}%`, width: 120, height: 120, marginLeft: -60, marginTop: -60 }}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.5, 0] }}
                  transition={{ duration: MOVEMENT.HIT_REACTION_MS / 1000 }}
                />
                <DamageNumber xPct={bossMass.xPct} yPct={bossMass.yPct - 6} value={shotBeat.value ?? bossDamage} crit={isCrit} />
              </>
            )}
            {isCrit && <CritFlash />}
            {beat('telegraph') && <TelegraphGlow xPct={bossMass.xPct} yPct={bossMass.yPct} delayMs={MOVEMENT.BEAT_COUNTER_AT_MS} />}
            {beat('playerHit') && (
              <DamageNumber xPct={hunterMass.xPct} yPct={hunterMass.yPct - 6} value={beat('playerHit')?.value ?? playerDamage} tone="player" delayMs={MOVEMENT.BEAT_LUNGE_AT_MS} />
            )}
            {beat('death') && <DustRing xPct={bossFeet.xPct} yPct={bossFeet.yPct} delayMs={MOVEMENT.HIT_REACTION_MS + 120} />}
          </div>
        )}

        {/* End banner — springs in over the settled scene */}
        {finished && timeline.outcome && (
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-[38%] z-30 flex justify-center"
            initial={reduced ? false : { scale: 0.5, opacity: 0, y: 14 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 17 }}
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
      </PixelStage>
    </div>
  );
};
