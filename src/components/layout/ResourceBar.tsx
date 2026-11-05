/**
 * ResourceBar — THE STRIP (DESIGN.md §1; drift-fix F1, 2026-11-02).
 *
 * One single-row resource bar on every tab: credits · scrap ·
 * keys/fragments · cores · loot, the XP bar fused as a hairline on
 * the bottom edge, the level chip at the right, and the settings
 * gear as the Strip's one allowed resident beside the wallet
 * (DESIGN.md §1; Settings' canonical home stays Hunter → Account).
 * The wallet prints exactly once anywhere in the app.
 *
 * This replaces the six-card grid the fidelity audit found still
 * standing in for the Strip (FIDELITY-AUDIT.md finding #1): two
 * rows of skewed 46px chips consumed ~20–25% of every screen
 * before any content. The anatomy follows the approved v2 mocks
 * (m25-home / m39-buy / m36-hunter — the Strip reads identically
 * on every tab): small pixel icons + values on one line, the
 * fragment count as a micro directly after the key value, the
 * equipped fraction as a micro after the loot value, SCRAP
 * carrying the one visible text label (its icon is the least
 * distinct), LV + the level value closing the row.
 *
 * Phone-width contract (device feedback r2 — the values on this
 * bar were the original "85 cre…" truncation report): a value
 * NEVER truncates, clips, or shrinks. Values render at 13px,
 * micro counts and labels at the 11px floor (DESIGN.md §5),
 * every segment is shrink-0 with whitespace-nowrap, and the
 * formatter bounds every value to ≤6 glyphs
 * (src/lib/ui/formatValue.ts) so the row fits at the 412px
 * reference width with ordinary balances. If an extreme balance
 * set still cannot fit honestly, the row SCROLLS horizontally
 * (the owner's scroll-don't-shrink law, DESIGN.md §6) — the type
 * never drops below the floor to force a fit.
 *
 * Host-independence (F3 fix pass, 2026-11-02): the row's gap is
 * pinned as gap-1.5 (0.375rem) in the component, never gap-2.
 * The .bl-page density layer (index.css) remaps gap-2 to
 * --cc-gap-sm (0.375rem) on pages that carry .bl-page — which is
 * every Strip host except Market, whose root is not a .bl-page.
 * With gap-2 the row silently rendered 2px wider per gap on
 * Market (5 gaps = 10px), and together with Market's un-normalized
 * 16px page pad the row overflowed ~13px and the level digit
 * clipped at the bar's edge. The Strip is shared chrome: its
 * geometry must not depend on the host page's density layer.
 * 0.375rem is exactly what .bl-page renders today, so the
 * bl-page hosts are pixel-unchanged by the pin.
 *
 * Every segment carries an aria-label naming the resource and
 * its full state ("Keys — 15 keys, 3 of 5 fragments"), so the
 * resource names are always present even where the mock language
 * lets the icon speak alone. Audit DISP-01's labeled-micro rule
 * is honored in that pairing: each micro sits directly after the
 * value it qualifies, on the same baseline, named in its label.
 *
 * Assumption-gaps G4 (2026-11-02): the two fraction micros'
 * denominators are taught at the counters' destination
 * surfaces, NOT on the Strip. Visible FRAGS / SLOTS labels were
 * measured in this slice (fresh-guest fixture, 412×915): the
 * row's scrollWidth grew 384 → 455 against a 382 clientWidth,
 * pushing the LV segment — the row's closer — off-screen at
 * rest, the exact failure the F3 pass fixed. The one-line law
 * (§5/§6) leaves no honest room, so the teaching lives where
 * the counts are spent: the cache lane prints "5 fragments =
 * 1 Cache Key" under its {n} / 5 bar (ChestScreen), and the
 * Loadout header prints "{n}/7 Gear slots" over the seven-slot
 * constellation (ActionLoadout). The aria-labels above carry
 * the same names for non-sighted players.
 *
 * Audit UX-04: until the first server profile lands
 * (playerSlice.profileLoaded), the bar renders a skeleton strip
 * with the same geometry — never the store's placeholder numbers,
 * which read as a fresh account's false zeros.
 *
 * Eye-leading (2026-11-04): every counted value on the bar
 * pulses when it RISES — gain-green flash + pop + its own tint's
 * glow, tiered full/micro with a 900ms coalesce, silent on
 * decreases (the engine is src/lib/ui/stripPulse.ts; DESIGN.md
 * §10). The layout is untouched by the beat: it rides the
 * existing digits, transform + color + shadow only.
 *
 * Placement law (0037): this bar is display-only. The rewarded-ad
 * offer used to live on the Keys chip's plus button — it moved to
 * the cache surface (ChestScreen) with the cache box lane: no ads
 * on the play screen, ever. The level segment is likewise
 * display-only, exactly as the old LEVEL chip was; the tappable
 * level door lives in Home's claim row (DashboardTopBar).
 *
 * All icons are §7 pixel drawings via PixelWalletIcon (the
 * visualAssets registry carries their tints); the settings gear
 * is the §7 pixel icon `cog`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelWalletIcon } from '@/components/pixelArt/PixelWalletIcon';
import { compactResourceValue } from '@/lib/ui/formatValue';
import {
  createStripPulseTracker,
  GAIN_GREEN,
  STRIP_INK,
  type StripPulseMap,
  type StripPulseTracker,
  type ValuePulse,
} from '@/lib/ui/stripPulse';
import { buildLoadoutRows, countEquippedLoadoutSlots } from '@/lib/loadout/loadoutReadModel';
import { useInventoryStore, useLoadoutStore, usePlayerStore } from '@/store';
import {
  loginStreakAnnouncement,
  loginStreakGrantKey,
  useLoginStreakStore,
} from '@/store/slices/loginStreakSlice';
import { xpToNextLevel } from '@/content/simulation';

type StripResourceId = 'credits' | 'scrap' | 'cacheKey' | 'legendaryCore' | 'loot';

interface SegmentProps {
  resourceId: StripResourceId;
  value: string | number;
  /** Visible text label (only SCRAP in the mock language). */
  label?: string;
  /** Secondary count riding the value (fragments, equipped). */
  micro?: string;
  /** Full spoken state for the segment (names the resource and
   *  what the micro counts, in words). */
  ariaText: string;
  /** True while the wallet tick is counting this value up. */
  ticking?: boolean;
  /** The latest increase pulse for this segment, if one fired. */
  pulse?: ValuePulse;
}

/**
 * A Strip value's digits, with the pulse beat when one fires
 * (eye-leading pass, DESIGN.md §10). The beat HOLDS its peak for
 * the first ~30% before decaying — a pure ease-out spends the
 * pop in ~150ms, faster than an eye can be led (measured on the
 * design prototype; the hold is the fix). Full ≈ 0.6s, micro ≈
 * 0.4s; the reduced-motion variant keeps the hold in the tint
 * alone (no scale, nothing travels). Without a pulse this is
 * exactly the shipped static span — the layout never changes.
 */
const ValueDigits: React.FC<{
  testId: string;
  pulse?: ValuePulse;
  children: React.ReactNode;
}> = ({ testId, pulse, children }) => {
  if (!pulse) {
    return (
      <span
        data-testid={testId}
        className="whitespace-nowrap text-[13px] font-black tabular-nums leading-none text-text-primary"
      >
        {children}
      </span>
    );
  }
  const full = pulse.tier === 'full';
  const peakScale = full ? 1.22 : 1.1;
  return (
    <span className="relative inline-flex">
      <motion.span
        key={`glow-${pulse.token}`}
        aria-hidden
        className="pointer-events-none absolute inset-0"
        initial={{
          opacity: full ? 0.9 : 0.45,
          boxShadow: `0 0 12px ${pulse.tint}`,
        }}
        animate={{
          opacity: [full ? 0.9 : 0.45, full ? 0.9 : 0.45, 0],
          boxShadow: [
            `0 0 12px ${pulse.tint}`,
            `0 0 12px ${pulse.tint}`,
            `0 0 0 ${pulse.tint}`,
          ],
        }}
        transition={{ duration: full ? 0.7 : 0.45, times: [0, 0.3, 1], ease: 'easeOut' }}
      />
      <motion.span
        key={pulse.token}
        data-testid={testId}
        data-pulse={pulse.tier}
        className="relative whitespace-nowrap text-[13px] font-black tabular-nums leading-none"
        style={{ transformOrigin: 'left center' }}
        initial={
          pulse.still ? { color: GAIN_GREEN } : { scale: peakScale, color: GAIN_GREEN }
        }
        animate={
          pulse.still
            ? { color: [GAIN_GREEN, GAIN_GREEN, STRIP_INK] }
            : { scale: [peakScale, peakScale, 1], color: [GAIN_GREEN, GAIN_GREEN, STRIP_INK] }
        }
        transition={{
          duration: pulse.still ? 0.5 : full ? 0.6 : 0.4,
          times: [0, 0.32, 1],
          ease: 'easeOut',
        }}
      >
        {children}
      </motion.span>
    </span>
  );
};

const Segment: React.FC<SegmentProps> = ({ resourceId, value, label, micro, ariaText, ticking, pulse }) => (
  <span
    data-testid={`resource-chip-${resourceId}`}
    data-ticking={ticking ? 'true' : undefined}
    role="img"
    aria-label={ariaText}
    className="flex shrink-0 items-center gap-1 whitespace-nowrap"
  >
    <PixelWalletIcon id={resourceId} size={13} className="shrink-0" />
    <ValueDigits testId={`resource-value-${resourceId}`} pulse={pulse}>
      {value}
    </ValueDigits>
    {micro && (
      <span className="whitespace-nowrap text-[11px] font-bold tabular-nums leading-none text-text-muted">
        {micro}
      </span>
    )}
    {label && (
      <span className="whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-text-muted">
        {label}
      </span>
    )}
  </span>
);

/** Skeleton segment (audit UX-04): same geometry, no numbers. */
const SkeletonSegment: React.FC<{ resourceId: StripResourceId | 'level' }> = ({ resourceId }) => (
  <span
    data-testid={`resource-chip-${resourceId}-skeleton`}
    className="flex shrink-0 animate-pulse items-center gap-1.5"
    aria-hidden
  >
    <span className="h-[15px] w-[15px] bg-surface-raised" />
    <span className="h-[13px] w-8 bg-surface-raised" />
  </span>
);

interface ResourceBarProps {
  /** Optional extra class for the wrapper */
  className?: string;
  /** Opens Settings — the Strip's gear resident (DESIGN.md §1).
   *  When omitted, no gear renders. */
  onOpenSettings?: () => void;
}

export const ResourceBar: React.FC<ResourceBarProps> = ({ className = '', onOpenSettings }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();

  // CONS-04: gear slots only (7) via the shared loadout read model —
  // the vehicle slot in the raw map is not gear.
  const equippedCount = countEquippedLoadoutSlots(buildLoadoutRows(loadout.slots, inventory.items));

  // The XP hairline fused to the Strip's bottom edge (DESIGN.md
  // §1): the same shipped curve the claim row's level pill reads —
  // no second XP truth.
  const xpNeeded = xpToNextLevel(player.level);
  const xpProgress = xpNeeded > 0 ? Math.min(100, (player.xp / xpNeeded) * 100) : 100;

  // Wallet tick (streak poster plate — direction B's beat):
  // while a FRESH streak grant is announcing and it carried
  // credits, the credits number counts up from the pre-grant
  // balance to the balance the player store already holds — the
  // reward is seen landing, once, in the wallet it landed in.
  // The grant key is recorded in the streak store before the
  // first frame renders, so remounts, acknowledgement-order
  // races, already-claimed replays, and later balance changes
  // never re-tick it. Reduced motion snaps to the true balance.
  const streakResult = useLoginStreakStore((s) => s.result);
  const streakResultDay = useLoginStreakStore((s) => s.resultDay);
  const streakSeenGrantKey = useLoginStreakStore((s) => s.seenGrantKey);
  const markWalletTicked = useLoginStreakStore((s) => s.markWalletTicked);
  // Read through a ref: useReducedMotion resolves a beat after
  // first paint, and the tick effect must not re-run (cancelling
  // a tick mid-flight) when the preference lands.
  const reduceMotion = useReducedMotion();
  const reduceMotionRef = useRef(false);
  useEffect(() => {
    reduceMotionRef.current = Boolean(reduceMotion);
  }, [reduceMotion]);
  const [tickDisplay, setTickDisplay] = useState<number | null>(null);
  const tickRaf = useRef<number | null>(null);

  useEffect(() => {
    // Wait for the real balance: while the profile is unloaded
    // the store holds placeholder numbers, and consuming the
    // grant key against them would spend the beat on nothing.
    if (!streakResult || !player.profileLoaded) return;
    const key = loginStreakGrantKey(streakResult, streakResultDay);
    const awarded = streakResult.granted.creditsAwarded;
    if (
      !key ||
      awarded <= 0 ||
      // True claim (0079): a held, unpaid reward never ticks the
      // wallet — the count-up belongs to money that moved. When
      // the claim lands, its profile sync raises the balance and
      // the pulse-on-increase answers it.
      streakResult.granted.claimable ||
      !loginStreakAnnouncement(streakResult, streakResultDay, streakSeenGrantKey) ||
      useLoginStreakStore.getState().tickedGrantKey === key
    ) {
      return;
    }
    markWalletTicked(key);
    const target = usePlayerStore.getState().credits;
    const from = target - awarded;
    if (reduceMotionRef.current || from < 0 || target <= from) return;
    const durationMs = 700;
    // Elapsed time is measured on the frame clock itself (the
    // first frame's timestamp is the start) — mixing in
    // performance.now() assumes the two share an origin, which
    // is not guaranteed outside a real browser frame loop.
    let startedAt: number | null = null;
    const step = (now: number) => {
      if (startedAt === null) startedAt = now;
      const t = Math.min(1, Math.max(0, (now - startedAt) / durationMs));
      const eased = 1 - Math.pow(1 - t, 3);
      setTickDisplay(Math.round(from + (target - from) * eased));
      if (t < 1) {
        tickRaf.current = requestAnimationFrame(step);
      } else {
        tickRaf.current = null;
        setTickDisplay(null);
      }
    };
    tickRaf.current = requestAnimationFrame(step);
    return () => {
      if (tickRaf.current !== null) cancelAnimationFrame(tickRaf.current);
      tickRaf.current = null;
      setTickDisplay(null);
    };
  }, [streakResult, streakResultDay, streakSeenGrantKey, markWalletTicked, player.profileLoaded]);

  // ── Pulse-on-increase (eye-leading pass, DESIGN.md §10) ─────
  // The tracker (src/lib/ui/stripPulse.ts) watches every counted
  // value the Strip prints and fires a pulse when one RISES
  // between authoritative syncs. Decreases and same-value syncs
  // stay silent by the tracker's construction; the first loaded
  // balance is the baseline. Fragments ride the key segment
  // through the composite count (keys × 1000 + fragments).
  const pulseTrackerRef = useRef<StripPulseTracker | null>(null);
  if (pulseTrackerRef.current === null) pulseTrackerRef.current = createStripPulseTracker();
  const [pulses, setPulses] = useState<StripPulseMap>({});
  const lootCount = inventory.items.length;

  useEffect(() => {
    if (!player.profileLoaded) {
      pulseTrackerRef.current?.reset();
      return;
    }
    const fired = pulseTrackerRef.current?.observe(
      {
        credits: player.credits,
        scrap: player.scrap,
        cacheKey: player.cacheKeys * 1000 + player.cacheKeyFragments,
        legendaryCore: player.legendaryCores,
        loot: lootCount,
        level: player.level,
      },
      performance.now(),
      reduceMotionRef.current,
    );
    if (fired && Object.keys(fired).length > 0) {
      setPulses((p) => ({ ...p, ...fired }));
    }
  }, [
    player.profileLoaded,
    player.credits,
    player.scrap,
    player.cacheKeys,
    player.cacheKeyFragments,
    player.legendaryCores,
    player.level,
    lootCount,
  ]);

  const gear = onOpenSettings ? (
    <button
      type="button"
      data-testid="strip-settings-button"
      aria-label="Settings"
      onClick={onOpenSettings}
      className="flex h-9 w-9 shrink-0 items-center justify-center text-text-muted transition-transform active:scale-[0.96]"
    >
      <PxIcon name="cog" size={17} />
    </button>
  ) : null;

  const rightEnd = (children: React.ReactNode) => (
    <span className="ml-auto flex shrink-0 items-center gap-1 pl-1">
      {gear}
      {children}
    </span>
  );

  if (!player.profileLoaded) {
    // Audit UX-04: no profile yet — a skeleton strip, never the
    // store's placeholder numbers (which read as a new account's
    // false zeros). Same one-row geometry as the loaded Strip.
    return (
      <div data-testid="resource-bar-loading" className={`relative border-2 border-border bg-bg ${className}`}>
        <div data-testid="resource-bar-strip" className="flex items-center gap-1.5 overflow-hidden px-2 py-1">
          <SkeletonSegment resourceId="credits" />
          <SkeletonSegment resourceId="scrap" />
          <SkeletonSegment resourceId="cacheKey" />
          <SkeletonSegment resourceId="legendaryCore" />
          <SkeletonSegment resourceId="loot" />
          {rightEnd(<SkeletonSegment resourceId="level" />)}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="resource-bar" className={`relative border-2 border-border bg-bg ${className}`}>
      <div
        data-testid="resource-bar-strip"
        className="flex items-center gap-1.5 overflow-x-auto px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <Segment
          resourceId="credits"
          value={compactResourceValue(tickDisplay ?? player.credits)}
          ariaText={`Credits — ${player.credits}`}
          ticking={tickDisplay !== null}
          pulse={pulses.credits}
        />
        <Segment
          resourceId="scrap"
          value={compactResourceValue(player.scrap)}
          label="Scrap"
          ariaText={`Scrap — ${player.scrap}`}
          pulse={pulses.scrap}
        />
        <Segment
          resourceId="cacheKey"
          value={player.cacheKeys}
          micro={`${player.cacheKeyFragments}/5`}
          ariaText={`Keys — ${player.cacheKeys} keys, ${player.cacheKeyFragments} of 5 fragments`}
          pulse={pulses.cacheKey}
        />
        <Segment
          resourceId="legendaryCore"
          value={player.legendaryCores}
          ariaText={`Cores — ${player.legendaryCores} legendary cores`}
          pulse={pulses.legendaryCore}
        />
        <Segment
          resourceId="loot"
          value={inventory.items.length}
          micro={`${equippedCount}/7`}
          ariaText={`Loot — ${inventory.items.length} items, ${equippedCount} of 7 gear slots equipped`}
          pulse={pulses.loot}
        />
        {rightEnd(
          <span
            data-testid="resource-chip-level"
            role="img"
            aria-label={`Level — ${player.level}`}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap"
          >
            <span className="whitespace-nowrap text-[11px] font-black uppercase leading-none tracking-wider text-amber">
              LV
            </span>
            <ValueDigits testId="resource-value-level" pulse={pulses.level}>
              {player.level}
            </ValueDigits>
          </span>,
        )}
      </div>
      {/* The fused XP hairline: a faint full-width track with the
          amber fill riding the Strip's bottom edge. It tracks the
          bar's own width, not the scrolling row above it. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/10">
        <motion.div
          className="h-full bg-amber"
          initial={false}
          animate={{ width: `${xpProgress}%` }}
          transition={{ type: 'spring', damping: 20 }}
        />
      </div>
    </div>
  );
};
