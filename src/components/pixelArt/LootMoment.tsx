import React, { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { GearItem, Weapon } from '@/types/items';
import { getPixelSprite } from '@/lib/pixel/manifest';
import { MOVEMENT } from '@/lib/pixel/movement';
import {
  initialLootMomentState,
  lootDeckData,
  lootDeckSchedule,
  lootMomentMode,
  lootMomentReducer,
  planLootMoment,
  type LootCardData,
  type LootMomentMode,
  type LootMomentStep,
} from '@/lib/pixel/lootMoment';
import { GodRays, LootBeam, ShockwaveRing, Twinkles } from './PixelFx';
import { PixelWeapon } from './PixelWeapon';
import { GearIllustration } from '@/components/gearArt/GearIllustration';

/**
 * LootMoment — the loot celebration, wired to real drop data. Given
 * the items a Chef result / tick event already awarded, it plays the
 * rarity ladder inside the EXISTING beat timings (movement.ts is law).
 *
 * The item-moment reveal (owner-approved exploration, 2026-11-03)
 * governs the stage presentation: the ITEM is the moment. On stage
 * surfaces the drop itself rises hero-scale through a radiating
 * stepped rarity light (PixelFx paints it on the texel grid — no
 * gradients), and its stats land staged in the reveal deck beneath it:
 * the effective value at hero size, affix percentages vivid, an
 * activity module in its own strip, roll quality read honestly. The
 * cache (cache reveals only) is demoted to a prop at the beam base
 * that ghosts away as the item rises. Escalation is scale only — beam
 * width, glow radius, fan, deck depth, step duration — and the
 * legendary surplus (world dim, god rays, shockwave, twinkles from
 * Epic up) is unchanged in kind.
 *
 * Presentation only: the items were awarded before this component
 * ever mounted (Chef claim / boss attempt / cache open already synced
 * them), and nothing here can delay, alter, or lose a drop — skipping
 * or closing the moment touches only this component's playback state.
 *
 * Modes (lootMomentMode escalation):
 * - 'full' — the whole celebration incl. dim + tap-to-skip (after the
 *   first-ever view). Stage surfaces get the deck presentation; feed
 *   surfaces (a legendary roaming drop) keep the in-scene treatment.
 * - 'light' — in-scene beam + compact card, pointer-transparent, never
 *   blocks idle flow. Used for ordinary roaming/feed drops.
 *
 * Reduced motion: beam and cards render statically (no rise, rays
 * spin, shockwave, twinkles, or shine), all names/stats stay readable,
 * and the ladder still advances and ends on the same schedule.
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
  /** Cache reveals: show the cache crate as the ignition prop at the
   *  beam base (it ghosts away as the item rises). Boss fiction stays
   *  clean — no crate on the boss stage. */
  propCache?: boolean;
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

// ── The reveal deck (stage presentation) ───────────────────────────────

/** The deck's palette — DESIGN.md §5 tokens as the approved sheets
 *  used them: warm near-black panel, parchment ink, vivid gain green,
 *  the legendary flavor cream. */
const DECK = {
  panel: 'rgba(36, 26, 16, 0.96)',
  raised: '#2E2113',
  ink: '#F5ECDA',
  mut: '#C2B096',
  dim: '#9A8A6E',
  line: '#4A3823',
  green: '#5FD95F',
  flavor: '#FFEFC4',
} as const;

/** One deck row landing on the schedule: invisible (but laid out — the
 *  panel is at final geometry from its first frame) until its beat. */
const DeckRow: React.FC<{
  delayMs: number;
  instant: boolean;
  className?: string;
  children: React.ReactNode;
}> = ({ delayMs, instant, className, children }) => (
  <motion.div
    className={className}
    initial={instant ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
    animate={{ opacity: 1, y: 0 }}
    transition={instant ? { duration: 0 } : { duration: 0.28, delay: delayMs / 1000, ease: 'easeOut' }}
  >
    {children}
  </motion.div>
);

const DeckAffixText: React.FC<{ figure: string; rest: string; size: number; color: string }> = ({ figure, rest, size, color }) => (
  <span style={{ fontSize: size, color }}>
    {figure && (
      <span className="font-bold" style={{ color: DECK.green }}>
        {figure}
      </span>
    )}
    {rest}
  </span>
);

/**
 * The reveal deck — the current step's full read, staged per the
 * approved exploration: effect banner (legendary), poster name in
 * rarity color, the stamp line, the hero figure with its supports,
 * affix rows (two-column at Legendary), the module strip, the quality
 * chip, and the flavor line last. Every row derives from the item's
 * own fields via lootDeckData; landing times via lootDeckSchedule.
 */
const LootDeck: React.FC<{ step: LootMomentStep; reduced: boolean; staticIn: boolean }> = ({ step, reduced, staticIn }) => {
  const deck = useMemo(() => lootDeckData(step.item), [step.item]);
  const schedule = useMemo(
    () => lootDeckSchedule(step.card.rarity, { affixCount: deck.affixes.length, hasModule: !!deck.module }),
    [step.card.rarity, deck],
  );
  const instant = reduced || staticIn;
  const legendary = step.card.rarity === 'Legendary';
  return (
    <motion.div
      data-testid="loot-card-hero"
      data-rarity={step.card.rarity}
      className="relative overflow-hidden border-2 px-4 py-3 text-left shadow-[4px_4px_0_rgba(0,0,0,0.65)]"
      style={{
        ...clipCard,
        width: 'min(340px, calc(100vw - 32px))',
        background: DECK.panel,
        borderColor: legendary ? deck.color : '#000',
        borderLeft: `5px solid ${deck.color}`,
      }}
      initial={instant ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={instant ? { duration: 0 } : { duration: 0.3, delay: schedule.panelMs / 1000, ease: 'easeOut' }}
    >
      {deck.effect && (
        <>
          <DeckRow delayMs={schedule.bannerMs} instant={instant}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex items-center gap-2">
                <span aria-hidden style={{ width: 4, height: 14, background: deck.color }} />
                <span className="text-[15px] font-bold uppercase leading-tight" style={{ color: deck.color }}>
                  {deck.effect.name}
                </span>
              </div>
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: DECK.dim }}>
                Legendary effect
              </span>
            </div>
          </DeckRow>
          <DeckRow delayMs={schedule.heroMs} instant={instant}>
            <p className="mt-1 text-[12px] leading-[16px]" style={{ color: DECK.mut }}>
              {deck.effect.description}
            </p>
          </DeckRow>
        </>
      )}
      <DeckRow delayMs={schedule.nameMs} instant={instant}>
        <div className="text-[23px] font-black uppercase leading-[28px]" style={{ color: deck.color }}>
          {deck.name}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: DECK.dim }}>
          {deck.stamp}
        </div>
      </DeckRow>
      {deck.hero && (
        <DeckRow delayMs={schedule.heroMs} instant={instant}>
          <div className="mt-1.5 flex items-end justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: DECK.dim }}>
                {deck.hero.label}
              </div>
              <div className="text-[44px] font-black leading-[46px]" style={{ color: DECK.ink }}>
                {deck.hero.value}
              </div>
            </div>
            <div className="flex gap-[22px] pb-1">
              {deck.supports.map((support) => (
                <div key={support.label} className="text-right">
                  <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: DECK.dim }}>
                    {support.label}
                  </div>
                  <div className="text-[23px] font-semibold leading-[28px]" style={{ color: DECK.ink }}>
                    {support.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DeckRow>
      )}
      {deck.hero && (deck.affixes.length > 0 || deck.module) && (
        <div aria-hidden className="mt-2 border-t" style={{ borderColor: DECK.line }} />
      )}
      {deck.affixes.length > 0 && (
        <div className={`mt-1.5 ${legendary && deck.affixes.length > 1 ? 'grid grid-cols-2 gap-x-4' : ''}`}>
          {deck.affixes.map((line, i) => (
            <DeckRow key={i} delayMs={schedule.affixStartMs + schedule.affixStaggerMs * i} instant={instant}>
              <div className="leading-[20px]">
                <DeckAffixText figure={line.figure} rest={line.rest} size={13} color={DECK.ink} />
              </div>
            </DeckRow>
          ))}
        </div>
      )}
      {deck.module && (
        <DeckRow delayMs={schedule.moduleMs} instant={instant}>
          <div className="mt-2 px-2 py-1.5" style={{ background: DECK.raised }}>
            <div className="text-[13px] font-semibold uppercase leading-[18px]" style={{ color: DECK.ink }}>
              {deck.module.title}
            </div>
            {deck.module.lines.map((line, i) => (
              <div key={i} className="leading-[15px]">
                <DeckAffixText figure={line.figure} rest={line.rest} size={12} color={DECK.mut} />
              </div>
            ))}
          </div>
        </DeckRow>
      )}
      {(deck.quality || deck.flavor) && (
        <div className="mt-2.5 flex items-end justify-between gap-3">
          {deck.quality ? (
            <DeckRow delayMs={schedule.qualityMs} instant={instant}>
              <div className="inline-flex items-baseline gap-1.5 px-2.5 py-1" style={{ background: DECK.raised }}>
                <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: DECK.dim }}>
                  Quality
                </span>
                <span className="text-[15px] font-bold" style={{ color: DECK.ink }}>
                  {deck.quality.value}
                </span>
                <span className="text-[11px] font-semibold uppercase" style={{ color: DECK.mut }}>
                  · {deck.quality.label}
                </span>
              </div>
            </DeckRow>
          ) : (
            <span />
          )}
          {deck.flavor && (
            <DeckRow delayMs={schedule.flavorMs} instant={instant} className="text-right">
              <span className="text-[13px] italic leading-snug" style={{ color: DECK.flavor }}>
                “{deck.flavor}”
              </span>
            </DeckRow>
          )}
        </div>
      )}
    </motion.div>
  );
};

// ── The risen item ─────────────────────────────────────────────────────

/** Hero staging widths from the approved sheets (412 CSS px frame):
 *  weapons ~360 (340 at Legendary), the shield plate 330, other gear
 *  plates 300. The in-scene (feed) staging keeps the incumbent 216. */
function risenWidthPx(step: LootMomentStep, scene: boolean): number {
  if (scene) return 216;
  if (step.card.isWeapon) return step.card.rarity === 'Legendary' ? 340 : 360;
  if (step.card.kindLabel === 'SHIELD') return 330;
  return 300;
}

/** Rendered height estimate from the plate aspects (weapons 240×88,
 *  shield/relic plates 240×140, class mod/ordnance 240×120) — used to
 *  center the glow field on the risen item. */
function risenHeightPx(step: LootMomentStep): number {
  const width = risenWidthPx(step, false);
  if (step.card.isWeapon) return (width * 88) / 240;
  if (step.card.kindLabel === 'CLASS MOD' || step.card.kindLabel === 'ORDNANCE') return (width * 120) / 240;
  return (width * 140) / 240;
}

/** The risen item's own render: the actual instance — PixelWeapon for
 *  weapons (bespoke legendary sprite resolution included), the real
 *  gear plate via GearIllustration for every other kind. The pre-redesign
 *  stand-in (a glossy crate for all non-weapons) is gone: gear rises as
 *  itself. */
const RisenVisual: React.FC<{ step: LootMomentStep; width: number }> = ({ step, width }) => (
  <div style={{ width }} className="mx-auto">
    {step.card.isWeapon ? (
      <PixelWeapon weapon={step.item as Weapon} fluid testId="loot-risen-weapon" density="card" />
    ) : (
      <div data-testid="loot-risen-gear">
        <GearIllustration item={step.item} size={width} />
      </div>
    )}
  </div>
);

const FloatBob: React.FC<{ still: boolean; children: React.ReactNode }> = ({ still, children }) => (
  <motion.div
    animate={still ? undefined : { y: [0, -7, 0] }}
    transition={still ? undefined : { duration: MOVEMENT.LOOT_FLOAT_MS / 1000, repeat: Infinity, ease: 'easeInOut', delay: MOVEMENT.LOOT_RISE_MS / 1000 }}
  >
    {children}
  </motion.div>
);

/** Stage staging: the item rises from the beam base (starting shifted
 *  down its own height-plus, passing behind the deck as the deck
 *  lands) to its hover above the deck, inside the step's rise budget. */
const RisenItemStage: React.FC<{ step: LootMomentStep; reduced: boolean; staticIn: boolean }> = ({ step, reduced, staticIn }) => {
  const still = reduced || staticIn;
  const width = risenWidthPx(step, false);
  const riseBudgetMs = Math.max(300, Math.min(MOVEMENT.LOOT_RISE_MS, step.celebration.durationMs - 300));
  return (
    <motion.div
      data-testid="loot-risen-item"
      className="relative"
      style={{ width }}
      initial={still ? { opacity: 1, y: 0 } : { opacity: 0, y: '112%' }}
      animate={still ? { opacity: 1, y: 0 } : { opacity: 1, y: ['112%', '0%', '-2.5%', '0%'] }}
      transition={
        still
          ? { duration: 0 }
          : {
              opacity: { duration: 0.32, delay: 0.12, ease: 'easeOut' },
              y: { duration: (riseBudgetMs + 200) / 1000, times: [0, 0.78, 0.92, 1], ease: 'easeOut', delay: 0.12 },
            }
      }
    >
      <FloatBob still={still}>
        <RisenVisual step={step} width={width} />
      </FloatBob>
    </motion.div>
  );
};

/** In-scene staging (feed surfaces): the incumbent hop above the loot
 *  point — the diorama's stage is short, the deck presentation is not
 *  attempted there. */
const RisenItemScene: React.FC<{ step: LootMomentStep; xPct: number; groundYPct: number; reduced: boolean; staticIn: boolean }> = ({ step, xPct, groundYPct, reduced, staticIn }) => {
  const still = reduced || staticIn;
  const width = risenWidthPx(step, true);
  return (
    <motion.div
      data-testid="loot-risen-item"
      className="absolute z-30"
      style={{ left: `${xPct}%`, bottom: `${100 - groundYPct + 15}%`, width, marginLeft: -width / 2, filter: `drop-shadow(0 0 16px ${step.card.color}B3)` }}
      initial={still ? { opacity: 1, y: -34 } : { opacity: 0, y: 44, scale: 0.82 }}
      animate={{ opacity: 1, y: still ? -34 : [44, -40, -32], scale: 1 }}
      transition={
        still
          ? { duration: 0 }
          : {
              opacity: { duration: 0.45, ease: 'easeOut' },
              scale: { duration: MOVEMENT.LOOT_RISE_MS / 1000, ease: 'easeOut' },
              y: { duration: (MOVEMENT.LOOT_RISE_MS + 350) / 1000, times: [0, 0.72, 1], ease: 'easeOut' },
            }
      }
    >
      <FloatBob still={still}>
        <RisenVisual step={step} width={width} />
      </FloatBob>
    </motion.div>
  );
};

/**
 * The cache, demoted to packaging: the shipped cache-crate prop at
 * the beam base — a little bigger than the exploration's first pass
 * (128 CSS px; it read small next to the full-size risen item) — that
 * ghosts away across the rise and is gone by the peak frame.
 */
const CACHE_PROP_PX = 128;

const CacheProp: React.FC<{ xPct: number; groundYPct: number; riseBudgetMs: number }> = ({ xPct, groundYPct, riseBudgetMs }) => {
  const sprite = getPixelSprite('prop-cache-crate');
  if (!sprite) return null;
  return (
    <div
      className="absolute z-20"
      style={{ left: `${xPct}%`, bottom: `${100 - groundYPct}%`, width: CACHE_PROP_PX, marginLeft: -CACHE_PROP_PX / 2 }}
    >
      <div aria-hidden className="absolute rounded-[50%] bg-black/50" style={{ left: 6, right: 6, bottom: -7, height: 15 }} />
      <motion.img
        src={sprite.url}
        alt=""
        draggable={false}
        data-testid="loot-cache-prop"
        style={{ width: CACHE_PROP_PX, imageRendering: 'pixelated' }}
        initial={{ opacity: 0, scale: 0.92, y: 6 }}
        animate={{ opacity: [0, 1, 1, 0], scale: [0.92, 1, 1, 0.95], y: [6, 0, 0, -4] }}
        transition={{ duration: (riseBudgetMs + 350) / 1000, times: [0, 0.1, 0.55, 1], ease: 'easeOut' }}
      />
    </div>
  );
};

// ── The moment ─────────────────────────────────────────────────────────

export const LootMoment: React.FC<LootMomentProps> = ({
  items,
  mode: modeProp,
  surface = 'stage',
  reduced = false,
  anchorXPct = 50,
  groundYPct = 84,
  propCache = false,
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
  // Twinkles join at Epic (exploration escalation: Epic takes twinkles;
  // Legendary adds dim/rays/shockwave on top).
  const twinkleShowing = !!currentStep && (currentStep.celebration.tier === 'grand' || legendaryShowing);

  const full = mode === 'full';
  /** The deck presentation: full celebrations on stage surfaces (the
   *  deliberate-trigger moments — cache reveal, boss result — both
   *  full-screen hosts). Feed-full keeps the in-scene staging. */
  const stageDeck = full && surface === 'stage';

  // Host + deck measurements — the stepped glow field centers on the
  // risen item's actual hover point, which the deck's height decides.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const deckWrapRef = useRef<HTMLDivElement | null>(null);
  const [hostH, setHostH] = useState(0);
  const [deckH, setDeckH] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const measure = () => setHostH(el.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    setDeckH(deckWrapRef.current?.offsetHeight ?? 0);
  }, [currentStep?.card.itemId, state.status, stageDeck]);

  const stageGlowYPct = useMemo(() => {
    if (!stageDeck || !currentStep || hostH <= 0) return undefined;
    const groundFromBottomPx = hostH * (1 - groundYPct / 100);
    const itemCenterFromBottomPx = groundFromBottomPx + 10 + deckH + 6 + risenHeightPx(currentStep) / 2;
    return 100 - (itemCenterFromBottomPx / hostH) * 100;
  }, [stageDeck, currentStep, hostH, deckH, groundYPct]);
  const raysYPct = stageDeck ? stageGlowYPct ?? groundYPct - 26 : groundYPct - 26;
  const twinklesYPct = stageDeck ? stageGlowYPct ?? groundYPct - 24 : groundYPct - 24;

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

  const visibleCards = state.status === 'settled' ? plan.steps : plan.steps.slice(0, state.stepIndex + 1);
  const miniSteps = state.status === 'settled' ? plan.steps.filter((step) => step !== plan.finale) : plan.steps.slice(0, state.stepIndex);
  const beamStep = currentStep;
  const riseBudgetMs = Math.max(300, Math.min(MOVEMENT.LOOT_RISE_MS, currentStep.celebration.durationMs - 300));

  return (
    <div
      ref={rootRef}
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

      {/* God rays behind the risen item (legendary step) */}
      {legendaryShowing && (
        <GodRays xPct={anchorXPct} yPct={raysYPct} size={full ? 380 : 300} reduced={reduced} />
      )}

      {/* The current step's rarity light at the loot point — stepped
          beam, radiating fan, glow field, ground flare (PixelFx). */}
      <LootBeam
        key={`beam-${beamStep.card.itemId}-${state.status}`}
        xPct={anchorXPct}
        groundYPct={groundYPct}
        color={beamStep.celebration.color}
        widthPx={full ? beamStep.celebration.beamWidthPx : Math.round(beamStep.celebration.beamWidthPx * 0.7)}
        flareScale={beamStep.celebration.flareScale}
        reduced={reduced}
        durationMs={beamStep.celebration.durationMs}
        glowYPct={stageDeck ? stageGlowYPct : undefined}
        radiant={full}
      />

      {/* Shockwave on the legendary step (once per step mount) */}
      {legendaryShowing && !reduced && state.status === 'playing' && (
        <ShockwaveRing key={`wave-${beamStep.card.itemId}`} xPct={anchorXPct} groundYPct={groundYPct} color={beamStep.celebration.color} />
      )}

      {/* Twinkles around the risen item — Epic and Legendary steps,
          full celebrations only (light mode stays beam + card). */}
      {full && twinkleShowing && !reduced && state.status === 'playing' && (
        <Twinkles xPct={anchorXPct} yPct={twinklesYPct} seed={currentStep.card.itemId} />
      )}

      {stageDeck ? (
        <>
          {/* The cache prop at the beam base — ignition packaging that
              ghosts away as the item rises (cache reveals only). */}
          {propCache && state.status === 'playing' && (
            <CacheProp key={`prop-${beamStep.card.itemId}`} xPct={anchorXPct} groundYPct={groundYPct} riseBudgetMs={riseBudgetMs} />
          )}

          {/* The stack wrapper carries the deck AND the ladder history,
              so the completed stack reads as one surface. */}
          <div data-testid="loot-card-stack" className="pointer-events-none absolute inset-0 z-40">
            {/* Stage column: risen item over the deck, the deck's
                bottom edge held just above the ground line so the
                flare stays visible beneath it. */}
            <div
              className="absolute inset-x-0 top-0 flex flex-col items-center justify-end"
              style={{ bottom: `${100 - groundYPct}%` }}
            >
              <div className="flex w-full flex-1 items-end justify-center pb-1.5">
                <RisenItemStage
                  key={`risen-${currentStep.card.itemId}`}
                  step={currentStep}
                  reduced={reduced}
                  staticIn={state.status === 'settled'}
                />
              </div>
              <div ref={deckWrapRef} className="relative z-40">
                <LootDeck key={`deck-${currentStep.card.itemId}`} step={currentStep} reduced={reduced} staticIn={state.status === 'settled'} />
              </div>
              <div aria-hidden style={{ height: 10 }} />
            </div>
            {/* Ladder history — earlier drops as compact cards. */}
            <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
              {miniSteps.map((step) => (
                <LootCard key={step.card.itemId} card={step.card} hero={false} reduced={reduced} staticIn={state.status === 'settled'} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* In-scene risen item + card stack (feed-full and light). */}
          {legendaryShowing && (
            <RisenItemScene step={currentStep} xPct={anchorXPct} groundYPct={groundYPct} reduced={reduced} staticIn={state.status === 'settled'} />
          )}
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
        </>
      )}

      {/* Skip hint — only once skipping is actually armed (seen before) */}
      {full && state.status === 'playing' && (
        <div
          className={`pointer-events-none absolute left-0 right-0 text-center text-[11px] font-black uppercase tracking-[0.22em] text-white/45 ${stageDeck ? 'top-2' : 'bottom-2'}`}
        >
          {hasSeenLootMoment() ? 'Tap to skip' : 'Loot secured'}
        </div>
      )}
    </div>
  );
};
