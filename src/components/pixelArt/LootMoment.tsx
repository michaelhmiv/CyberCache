import React, { useEffect, useMemo, useReducer, useRef } from 'react';
import { motion } from 'framer-motion';
import type { GearItem, Weapon } from '@/types/items';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { MOVEMENT } from '@/lib/pixel/movement';
import {
  initialLootMomentState,
  lootMomentMode,
  lootMomentReducer,
  planLootMoment,
  type LootCardData,
  type LootMomentMode,
  type LootMomentStep,
} from '@/lib/pixel/lootMoment';
import { GodRays, LootBeam, ShockwaveRing, Twinkles } from './PixelFx';
import { PixelWeapon } from './PixelWeapon';

/**
 * LootMoment (P3) — the loot celebration from pixel-production-spec.md §5,
 * wired to real drop data. Given the items a Chef result / tick event
 * already awarded, it plays the rarity ladder: a ground beam in each
 * drop's rarity color with its drop card springing into a stack, and the
 * full legendary treatment for the finale when a legendary drops — the
 * world dims ~40%, a wide gold pillar lands with a shockwave ring, the
 * weapon rises out of the beam on rotating god rays and floats with
 * twinkles, and its gold card lands with flavor text and a stat line.
 *
 * Presentation only: the items were awarded before this component ever
 * mounted (Chef claim / boss attempt / cache open already synced them),
 * and nothing here can delay, alter, or lose a drop — skipping or
 * closing the moment touches only this component's playback state.
 *
 * Modes (lootMomentMode escalation):
 * - 'full' — the whole celebration incl. dim + tap-to-skip (after the
 *   first-ever view; spec §5). Used on stage surfaces (boss result,
 *   cache reveal) and for legendary feed drops.
 * - 'light' — in-scene beam + compact card, pointer-transparent, never
 *   blocks idle flow. Used for ordinary roaming/feed drops.
 *
 * Reduced motion: beam and cards render statically (no rise, rays spin,
 * shockwave, twinkles, or shine), all names/stats stay readable, and the
 * ladder still advances and ends on the same schedule.
 *
 * The seen-flag is a UI preference only (ARCHITECTURE.md §5 permits
 * localStorage for UI preferences) — it records that the player has
 * watched one full moment so later ones may be tap-skipped.
 */

const LOOT_MOMENT_SEEN_KEY = 'cybercache:loot-moment-seen';

function hasSeenLootMoment(): boolean {
  try {
    return globalThis.localStorage?.getItem(LOOT_MOMENT_SEEN_KEY) === '1';
  } catch {
    // Storage unavailable (private mode): treat as seen so a tap always
    // skips — the moment must never trap the player.
    return true;
  }
}

function markLootMomentSeen(): void {
  try {
    globalThis.localStorage?.setItem(LOOT_MOMENT_SEEN_KEY, '1');
  } catch {
    /* UI preference only — losing it just replays one unskippable moment */
  }
}

interface LootMomentProps {
  /** The already-awarded drops to celebrate, in any order (the ladder sorts). */
  items: GearItem[];
  /** Escalation override; default derives from `surface`. */
  mode?: LootMomentMode;
  /** 'stage' (boss/cache) defaults to full; 'feed' (roaming) to light. */
  surface?: 'feed' | 'stage';
  reduced?: boolean;
  /** Beam base X, % of the host (from a manifest loot-point anchor). */
  anchorXPct?: number;
  /** Beam base Y (ground), % of the host. */
  groundYPct?: number;
  /** Fired once when the moment finishes or is skipped through. */
  onDone?: () => void;
  testId?: string;
}

const clipCard = { clipPath: 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)' };

/** One card in the stack. Hero cards (the step currently celebrating)
 *  carry the stat line; the legendary hero is the big gold card with
 *  flavor text and a shine sweep, as in the approved proof. */
const LootCard: React.FC<{ card: LootCardData; hero: boolean; reduced: boolean; staticIn: boolean }> = ({ card, hero, reduced, staticIn }) => {
  const legendary = card.rarity === 'Legendary';
  return (
    <motion.div
      data-testid={hero ? 'loot-card-hero' : 'loot-card'}
      data-rarity={card.rarity}
      className="relative overflow-hidden border-2 border-black px-2.5 py-1.5 text-left shadow-[4px_4px_0_rgba(0,0,0,0.65)]"
      style={{
        ...clipCard,
        width: hero ? 218 : 178,
        background: legendary
          ? 'linear-gradient(160deg, rgba(58,44,4,0.96) 0%, rgba(16,13,4,0.97) 62%)'
          : 'rgba(7,8,12,0.94)',
        borderColor: legendary ? '#FFEA3A' : '#000',
        borderLeft: `5px solid ${card.color}`,
      }}
      initial={staticIn || reduced ? { opacity: 1, x: 0, scale: 1 } : { opacity: 0, x: 46, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={staticIn || reduced ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 27 }}
    >
      <div className={`truncate font-black uppercase leading-tight text-white ${hero ? 'text-[15px]' : 'text-[12px]'}`}>{card.name}</div>
      <div className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: card.color }}>
        {card.stamp}
      </div>
      {hero && card.flavor && (
        <div className="mt-1 text-[11px] font-semibold italic leading-snug text-[#FFEFC4]">“{card.flavor}”</div>
      )}
      {hero && <div className="mt-0.5 text-[10px] font-bold tracking-wide text-text-secondary">{card.statLine}</div>}
      {hero && legendary && !reduced && !staticIn && (
        <motion.div
          className="pointer-events-none absolute inset-y-0 w-16"
          style={{ background: 'linear-gradient(100deg, transparent, rgba(255,255,255,0.28), transparent)' }}
          initial={{ left: '-30%' }}
          animate={{ left: '115%' }}
          transition={{ duration: 0.9, delay: 0.25, ease: 'easeInOut' }}
        />
      )}
    </motion.div>
  );
};

/** The risen finale visual: the weapon itself (compositor or bespoke
 *  sprite) for weapons; the cache crate under a rarity glow for other
 *  gear kinds, which have no weapon render. */
const RisenItem: React.FC<{ step: LootMomentStep; xPct: number; groundYPct: number; reduced: boolean; staticIn: boolean }> = ({ step, xPct, groundYPct, reduced, staticIn }) => {
  const still = reduced || staticIn;
  const crate = getPixelSprite('crate');
  return (
    <motion.div
      data-testid="loot-risen-item"
      className="absolute z-30"
      style={{ left: `${xPct}%`, bottom: `${100 - groundYPct + 15}%`, width: 216, marginLeft: -108, filter: `drop-shadow(0 0 16px ${step.card.color}B3)` }}
      initial={still ? { opacity: 1, y: -34 } : { opacity: 0, y: 44, scale: 0.82 }}
      animate={{ opacity: 1, y: still ? -34 : [44, -40, -32], scale: 1 }}
      transition={
        still
          ? { duration: 0 }
          : {
              // Opacity lands fast; the rise itself takes LOOT_RISE_MS
              // with a small settle — the float bob (inner wrapper)
              // takes over from there.
              opacity: { duration: 0.45, ease: 'easeOut' },
              scale: { duration: MOVEMENT.LOOT_RISE_MS / 1000, ease: 'easeOut' },
              y: { duration: (MOVEMENT.LOOT_RISE_MS + 350) / 1000, times: [0, 0.72, 1], ease: 'easeOut' },
            }
      }
    >
      <motion.div
        animate={still ? undefined : { y: [0, -7, 0] }}
        transition={still ? undefined : { duration: MOVEMENT.LOOT_FLOAT_MS / 1000, repeat: Infinity, ease: 'easeInOut', delay: MOVEMENT.LOOT_RISE_MS / 1000 }}
      >
        {step.card.isWeapon ? (
          <PixelWeapon weapon={step.item as Weapon} fluid testId="loot-risen-weapon" />
        ) : crate ? (
          <img
            src={crate.url}
            alt={step.card.name}
            draggable={false}
            className="mx-auto"
            style={{ width: 92, imageRendering: 'pixelated', filter: `drop-shadow(0 0 14px ${step.card.color})` }}
            data-testid="loot-risen-crate"
          />
        ) : null}
      </motion.div>
    </motion.div>
  );
};

export const LootMoment: React.FC<LootMomentProps> = ({
  items,
  mode: modeProp,
  surface = 'stage',
  reduced = false,
  anchorXPct = 50,
  groundYPct = 84,
  onDone,
  testId,
}) => {
  const itemsKey = items.map((item) => `${item.id}:${item.rarity}`).join('|');
  // The plan is a pure function of the drop set; key the memo on the set
  // identity so inline arrays from hosts don't restart playback.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planLootMoment(items), [itemsKey]);
  const mode = modeProp ?? (plan ? lootMomentMode(items, surface) : null);
  const [state, dispatch] = useReducer(lootMomentReducer, initialLootMomentState);
  const doneFiredRef = useRef(false);

  const stepCount = plan?.steps.length ?? 0;
  const currentStep = plan && state.status !== 'settled' ? plan.steps[Math.min(state.stepIndex, stepCount - 1)] : plan?.finale;
  // A legendary step gets the full treatment wherever it sits in the
  // ladder (ascending order puts it last in practice; a double-legendary
  // boss roll celebrates each one).
  const legendaryShowing = !!currentStep && currentStep.celebration.tier === 'legendary';

  // Ladder playback — display pacing only (advances this component's own
  // state; the drops were awarded before the moment started).
  useEffect(() => {
    if (!plan) return;
    if (state.status === 'playing') {
      const step = plan.steps[state.stepIndex];
      const timer = setTimeout(() => dispatch({ type: 'advance', stepCount }), step.celebration.durationMs);
      return () => clearTimeout(timer);
    }
    if (state.status === 'settled') {
      const timer = setTimeout(() => dispatch({ type: 'settleDone' }), MOVEMENT.LOOT_SKIP_LINGER_MS);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [plan, state.status, state.stepIndex, stepCount]);

  useEffect(() => {
    if (state.status !== 'done' || doneFiredRef.current) return;
    doneFiredRef.current = true;
    markLootMomentSeen();
    onDone?.();
  }, [state.status, onDone]);

  if (!plan || !mode || !currentStep || state.status === 'done') return null;

  const full = mode === 'full';
  const visibleCards = state.status === 'settled' ? plan.steps : plan.steps.slice(0, state.stepIndex + 1);
  const beamStep = currentStep;

  return (
    <div
      data-testid={testId ?? 'loot-moment'}
      data-mode={mode}
      data-step={state.stepIndex}
      className={`absolute inset-0 z-40 ${full ? '' : 'pointer-events-none'}`}
      onPointerDown={full ? () => dispatch({ type: 'tap', seenBefore: hasSeenLootMoment() }) : undefined}
      role={full ? 'button' : undefined}
      aria-label={full ? 'Loot celebration — tap to skip' : undefined}
    >
      {/* World dim — legendary steps only (spec: ~40%) */}
      {full && (
        <motion.div
          data-testid="loot-dim"
          className="absolute inset-0 bg-black"
          initial={false}
          animate={{ opacity: legendaryShowing ? MOVEMENT.LOOT_DIM_OPACITY : 0 }}
          transition={{ duration: reduced ? 0 : 0.45 }}
        />
      )}

      {/* God rays behind the risen weapon (legendary step) */}
      {legendaryShowing && (
        <GodRays xPct={anchorXPct} yPct={groundYPct - 26} size={full ? 380 : 300} reduced={reduced} />
      )}

      {/* The current step's rarity beam at the loot point */}
      <LootBeam
        key={`beam-${beamStep.card.itemId}-${state.status}`}
        xPct={anchorXPct}
        groundYPct={groundYPct}
        color={beamStep.celebration.color}
        widthPx={full ? beamStep.celebration.beamWidthPx : Math.round(beamStep.celebration.beamWidthPx * 0.7)}
        flareScale={beamStep.celebration.flareScale}
        reduced={reduced}
      />

      {/* Shockwave on the legendary step (once per step mount) */}
      {legendaryShowing && !reduced && state.status === 'playing' && (
        <ShockwaveRing key={`wave-${beamStep.card.itemId}`} xPct={anchorXPct} groundYPct={groundYPct} color={beamStep.celebration.color} />
      )}

      {/* The risen weapon + twinkles on a legendary step */}
      {legendaryShowing && (
        <>
          <RisenItem step={currentStep} xPct={anchorXPct} groundYPct={groundYPct} reduced={reduced} staticIn={state.status === 'settled'} />
          {!reduced && state.status === 'playing' && <Twinkles xPct={anchorXPct} yPct={groundYPct - 24} seed={currentStep.card.itemId} />}
        </>
      )}

      {/* Card stack — accumulates up the ladder, best drop last. Above
          the beam/risen layers (proof layering: cards sit in front). */}
      <div className={`absolute z-40 flex flex-col items-end gap-1.5 ${full ? 'right-3 top-3' : 'right-2 top-2'}`} data-testid="loot-card-stack">
        {visibleCards.map((step, index) => (
          <LootCard
            key={step.card.itemId}
            card={step.card}
            hero={full && (state.status === 'settled' ? step === plan.finale : index === state.stepIndex)}
            reduced={reduced}
            staticIn={state.status === 'settled'}
          />
        ))}
      </div>

      {/* Skip hint — only once skipping is actually armed (seen before) */}
      {full && state.status === 'playing' && (
        <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[9px] font-black uppercase tracking-[0.22em] text-white/45">
          {hasSeenLootMoment() ? 'Tap to skip' : 'Loot secured'}
        </div>
      )}
    </div>
  );
};
