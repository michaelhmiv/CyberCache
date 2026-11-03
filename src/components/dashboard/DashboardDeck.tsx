import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  useActivityStore,
  useBossStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useTickFeedStore,
  useActiveBuffsStore,
} from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { buildLoadoutRows, countEquippedLoadoutSlots } from '@/lib/loadout/loadoutReadModel';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { MANUFACTURERS } from '@/constants/manufacturers';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { Rarity, type Manufacturer } from '@/types/game';
import { CharacterStatBarBody } from '@/components/stats/CharacterStatBar';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import { WeeklyClaimablesPanel } from '@/components/dashboard/WeeklyClaimables';
import { WorldPulseFeed } from '@/components/profile/WorldPulseFeed';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import { useNow } from '@/hooks/useNow';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { getActivityVisual } from '@/constants/activityVisuals';
import { getResourceVisual } from '@/constants/visualAssets';
import type { TickEvent, TickEventTone } from '@/store/slices/tickSlice';
import type { ActivityKind } from '@/types/activity';
import type { Weapon } from '@/types/items';
// DisplayGainEvent + gainFeed are still needed by GainToast (the floating
// fixed-position toasts at the bottom of the screen).

/**
 * DashboardDeck — Home's deck, in the FIXED order DESIGN.md §4
 * fixes for everything below the fold (redesign Wave C):
 *
 *   1. Launcher deck — Dispatch and Crack Cache first (the
 *      Board orphans with no other low-tap door), then Slots,
 *      then the Loadout shortcut (rendered only while a loadout
 *      is incomplete, §3). The old Action Board's other rows are
 *      gone BY DESIGN, not by accident: roaming is the stage
 *      itself, skills live on the Hunter rail, the Workshop is
 *      the Gear rail's bench (and the Craft panel's door), and
 *      Market is a tab.
 *   2. Weekly claimables — the Parts Crate + Signature Order
 *      panel; renders only in its claimable states (§4).
 *   3. Now — the single merged feed (World Pulse + the latest
 *      player activity). One panel, one header, no duplicates.
 *   4. Hunter Totals — one header (this panel's label) with its
 *      one Sources disclosure (this panel's button); the stat
 *      body renders embedded so its own title never repeats.
 *
 * What LEFT the deck in Wave C: the consumable belt (now above
 * the fold, under the lit workspace), the area/research chip row
 * (now beside the stage, where the #239 pairing puts research
 * next to the area), the Choose Area panel and Hunter Notes
 * (their doors are the stage's Area rail stop / mode sheet and
 * the Hunter Totals panel). The gain toasts stay — they are a
 * floating overlay, not a deck block. Settings is NOT a deck
 * row (DESIGN.md §3: Hunter → Account; the Strip gear icon is
 * the shortcut).
 */
interface DashboardDeckProps {
  onNavigate: (screen: string) => void;
}

type Tone = 'amber' | 'green' | 'blue' | 'red' | 'purple' | 'cyan';
type DisplayGainTone = TickEventTone | 'unknown';

type DisplayGainEvent = Pick<TickEvent, 'id' | 'label' | 'detail' | 'manufacturer' | 'gear'> & {
  tone?: string;
};

const HUD_ACTIVITY_CYCLE: ActivityKind[] = ['roaming_loot', 'crafting', 'salvaging', 'market_listing', 'workshop_service'];

const panelClip = {
  clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)',
};

const signClip = {
  clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)',
};

const toneClass: Record<Tone, { text: string; border: string; bg: string; fill: string }> = {
  amber: { text: 'text-amber', border: 'border-amber/55', bg: 'bg-amber/10', fill: 'bg-amber' },
  green: { text: 'text-green', border: 'border-green/50', bg: 'bg-green/10', fill: 'bg-green' },
  blue: { text: 'text-blue', border: 'border-blue/45', bg: 'bg-blue/10', fill: 'bg-blue' },
  red: { text: 'text-red', border: 'border-red/55', bg: 'bg-red/10', fill: 'bg-red' },
  purple: { text: 'text-purple', border: 'border-purple/50', bg: 'bg-purple/10', fill: 'bg-purple' },
  cyan: { text: 'text-cyan', border: 'border-cyan/45', bg: 'bg-cyan/10', fill: 'bg-cyan' },
};

const gainToneClass: Record<DisplayGainTone, { text: string; bg: string; border: string; fill: string }> = {
  xp: { text: 'text-green', bg: 'bg-green/10', border: 'border-green/70', fill: 'bg-green' },
  loot: { text: 'text-amber', bg: 'bg-amber/10', border: 'border-amber/70', fill: 'bg-amber' },
  cash: { text: 'text-cyan', bg: 'bg-cyan/10', border: 'border-cyan/70', fill: 'bg-cyan' },
  cache: { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-400/70', fill: 'bg-blue-400' },
  level: { text: 'text-red', bg: 'bg-red/10', border: 'border-red/70', fill: 'bg-red' },
  kill: { text: 'text-text-secondary', bg: 'bg-surface-raised', border: 'border-border', fill: 'bg-text-muted' },
  material: { text: 'text-amber', bg: 'bg-amber/10', border: 'border-amber/70', fill: 'bg-amber' },
  essence: { text: 'text-purple', bg: 'bg-purple/10', border: 'border-purple/70', fill: 'bg-purple' },
  fragment: { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-400/70', fill: 'bg-blue-400' },
  damage: { text: 'text-red', bg: 'bg-red/10', border: 'border-red/70', fill: 'bg-red' },
  heal: { text: 'text-green', bg: 'bg-green/10', border: 'border-green/70', fill: 'bg-green' },
  death: { text: 'text-red', bg: 'bg-red/15', border: 'border-red/80', fill: 'bg-red' },
  consumable: { text: 'text-amber', bg: 'bg-amber/10', border: 'border-amber/70', fill: 'bg-amber' },
  event: { text: 'text-cyan', bg: 'bg-cyan/10', border: 'border-cyan/70', fill: 'bg-cyan' },
  event_major: { text: 'text-purple', bg: 'bg-purple/15', border: 'border-purple/80', fill: 'bg-purple' },
  // Standing gains render in the manufacturer's own color when the
  // event carries one (inline style at the render site); this is the
  // fallback for a standing event without one.
  standing: { text: 'text-text-secondary', bg: 'bg-surface-raised', border: 'border-border', fill: 'bg-text-muted' },
  unknown: { text: 'text-text-secondary', bg: 'bg-surface-raised', border: 'border-border', fill: 'bg-text-muted' },
};

const getGainToneClass = (tone?: string) => gainToneClass[(tone ?? 'unknown') as DisplayGainTone] ?? gainToneClass.unknown;

const Panel: React.FC<React.PropsWithChildren<{
  label?: string;
  className?: string;
  /** Trailing affordance slot — rendered inside the label row, right-aligned. */
  headerActions?: React.ReactNode;
}>> = ({ label, className = '', headerActions, children }) => (
  <section className={`relative overflow-hidden border-2 border-border bg-surface/95 p-2 shadow-[0_8px_18px_rgba(0,0,0,0.55)] ${className}`} style={panelClip}>
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,144,0,0.12)_0,transparent_34%,rgba(255,75,92,0.08)_100%)]" />
    <div className="pointer-events-none absolute -left-10 top-3 h-3 w-32 -rotate-12 bg-amber/20" />
    {label && (
      <div className="relative mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-text-muted">
        <span className="h-px flex-1 bg-border-light" />
        <span>{label}</span>
        {headerActions && <span className="flex shrink-0 items-center gap-1.5">{headerActions}</span>}
        <span className="h-px flex-1 bg-border-light" />
      </div>
    )}
    <div className="relative">{children}</div>
  </section>
);

const RewardIcon: React.FC<{ tone?: string; compact?: boolean }> = ({ tone, compact = false }) => {
  const color = getGainToneClass(tone);
  // Map reward tones to game-entity resource visuals. The glyph + color
  // from the registry replaces the old lucide icon set so every reward
  // chip is visually consistent with the rest of the visual-asset system.
  const resourceId = tone === 'loot'
    ? 'loot'
    : tone === 'cache'
      ? 'cacheKey'
      : tone === 'fragment'
        ? 'cacheFragment'
        : tone === 'level' || tone === 'kill' || tone === 'death'
          ? 'xp'
          : tone === 'cash'
            ? 'credits'
            : null;
  const boxClass = compact ? 'h-6 w-6' : 'h-8 w-8';
  if (resourceId) {
    const visual = getResourceVisual(resourceId);
    return (
      <div className={`flex ${boxClass} shrink-0 items-center justify-center border-2 border-border ${color.bg}`}>
        <span className="shrink-0 font-black" style={{ color: visual.color, fontSize: compact ? '12px' : '15px' }}>{visual.mark}</span>
      </div>
    );
  }
  // Fallback: activity glyph for non-resource tones
  const actVisual = getActivityVisual('idle_standby');
  return (
    <div className={`flex ${boxClass} shrink-0 items-center justify-center border-2 border-border ${color.bg}`}>
      <PxIcon name={actVisual.icon} size={compact ? 13 : 17} style={{ color: color.text.includes('text-text-secondary') ? '#B8B0A8' : '#FF9000' }} />
    </div>
  );
};

/** How long a gain toast stays on screen once the deck first sees
 *  its event (owner ruling, 2026-11-02: pop-ups queue briefly, they
 *  do not park over the lower screen). */
const TOAST_WINDOW_MS = 7_000;

const GainToast: React.FC<{ event: DisplayGainEvent }> = ({ event }) => {
  const color = getGainToneClass(event.tone);
  // Standing gains wear the manufacturer's own color (brief §2.7).
  const manufacturerColor =
    event.tone === 'standing' && event.manufacturer
      ? MANUFACTURERS[event.manufacturer as Manufacturer]?.color
      : undefined;
  // Loot carve-out (owner ruling, 2026-11-02): Epic and Legendary drops
  // keep their full two-line toast — the stage LootMoment is their
  // amplified presentation and this card does not flatten for them.
  // Every other event compacts to its headline: the label already
  // carries the outcome ("+1 BallisticParts", "-12 HP", "+16 XP");
  // the narrative detail line restated what the player is watching
  // on the stage, so it no longer renders here. The full detail
  // stays in the Now rows below and in the workspace reward stream.
  const dropRarity = event.tone === 'loot' ? event.gear?.rarity : undefined;
  if (dropRarity === Rarity.Epic || dropRarity === Rarity.Legendary) {
    return (
      <motion.div data-testid="gain-toast" data-toast-variant="amplified" layout initial={{ opacity: 0, y: 6, scale: 0.9, rotate: -1 }} animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }} exit={{ opacity: 0, y: 6, scale: 0.92 }} transition={{ duration: 0.14 }} className={`pointer-events-none inline-flex min-w-[112px] items-center gap-2 border-2 ${color.border} bg-bg px-2 py-1.5 shadow-[0_10px_22px_rgba(0,0,0,0.85)]`} style={{ ...signClip, ...(manufacturerColor ? { borderColor: manufacturerColor } : {}) }}>
        <div className={`absolute left-0 top-0 h-full w-1.5 ${color.fill}`} style={manufacturerColor ? { backgroundColor: manufacturerColor } : undefined} />
        <RewardIcon tone={event.tone} />
        <div className="min-w-0 leading-none">
          <div className={`text-base font-black uppercase tracking-wide ${color.text}`} style={manufacturerColor ? { color: manufacturerColor } : undefined}>{event.label}</div>
          <div className="mt-0.5 text-[11px] font-black uppercase leading-snug tracking-[0.14em] text-text-muted">{event.detail}</div>
        </div>
      </motion.div>
    );
  }
  // Rare drops stay clearly visible inside the compact form: the
  // rarity stamp rides in front of the name, framed in rarity color.
  const rareStyle = dropRarity === Rarity.Rare ? RARITY_FRAME_STYLES[Rarity.Rare] : undefined;
  // The number is the hero (owner's numbers philosophy, 2026-11-02):
  // this is a numbers game, so in the compact headline each value
  // prints full-strength — gains in the game's gain-green, damage
  // taken in red — and the words beside it (unit, material name)
  // sit quieter: secondary color, lighter weight, floor-size type.
  // Emphasis comes from color and weight only; the card does not
  // grow. A label with no number anywhere (an item name, a kill
  // notice, Hunter Down) keeps the single full-strength headline.
  const headlineSegments = event.label.split(' · ').map((segment) => {
    const match = segment.match(/^([+-]?\d[\d.,]*)(.*)$/);
    return { segment, head: match?.[1], rest: match?.[2] ?? '' };
  });
  const heroClass = (head: string) =>
    head.startsWith('+')
      ? 'text-green'
      : event.tone === 'damage' || event.tone === 'death'
        ? 'text-red'
        : color.text;
  const headline = headlineSegments.every(({ head }) => head === undefined) ? (
    <div className={`min-w-0 text-sm font-black uppercase leading-tight tracking-wide ${color.text}`} style={manufacturerColor ? { color: manufacturerColor } : undefined}>{event.label}</div>
  ) : (
    <div className="min-w-0 text-sm uppercase leading-tight tracking-wide">
      {headlineSegments.map(({ segment, head, rest }, index) => (
        <React.Fragment key={index}>
          {index > 0 && <span className="text-text-muted"> · </span>}
          {head !== undefined ? (
            <>
              <span className={`font-black ${heroClass(head)}`}>{head}</span>
              {rest.trim() && (
                <span className="text-[11px] font-bold text-text-secondary" style={manufacturerColor ? { color: manufacturerColor } : undefined}>{rest.startsWith(' ') ? ' ' : ''}{rest.trim()}</span>
              )}
            </>
          ) : (
            <span className={`font-black ${color.text}`} style={manufacturerColor ? { color: manufacturerColor } : undefined}>{segment}</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
  return (
    <motion.div data-testid="gain-toast" data-toast-variant="compact" layout initial={{ opacity: 0, y: 6, scale: 0.9, rotate: -1 }} animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }} exit={{ opacity: 0, y: 6, scale: 0.92 }} transition={{ duration: 0.14 }} className={`pointer-events-none inline-flex max-w-full items-center gap-1.5 border-2 ${color.border} bg-bg px-2 py-1 shadow-[0_10px_22px_rgba(0,0,0,0.85)]`} style={{ ...signClip, ...(manufacturerColor ? { borderColor: manufacturerColor } : {}), ...(rareStyle ? { borderColor: rareStyle.color } : {}) }}>
      <div className={`absolute left-0 top-0 h-full w-1 ${color.fill}`} style={manufacturerColor ? { backgroundColor: manufacturerColor } : undefined} />
      <RewardIcon tone={event.tone} compact />
      {rareStyle && (
        <span className="shrink-0 text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: rareStyle.color }}>{rareStyle.stamp}</span>
      )}
      {headline}
    </motion.div>
  );
};

const ActionButton: React.FC<{ label: string; desc: string; stat?: string; icon: React.ReactNode; tone: Tone; primary?: boolean; onClick: () => void }> = ({ label, desc, stat, icon, tone, primary = false, onClick }) => {
  const color = toneClass[tone];
  return (
    <button type="button" onClick={onClick} className={`group relative overflow-hidden border-2 text-left transition-transform active:scale-[0.98] ${primary ? `${color.border} ${color.bg}` : 'border-border bg-bg/80'}`} style={panelClip}>
      <div className={`absolute left-0 top-0 h-full w-1.5 ${color.fill}`} />
      <div className="relative flex min-h-[56px] items-center gap-2 p-2 pl-3">
        <div className={`flex h-9 w-9 shrink-0 -rotate-2 items-center justify-center border-2 border-border ${color.bg}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><div className="text-xs font-black uppercase tracking-wide text-text-primary">{label}</div><ChevronRight size={14} className={`${color.text} opacity-75 transition-transform group-active:translate-x-0.5`} /></div>
          <div className="text-[11px] leading-snug text-text-muted">{desc}</div>
          {stat && <div className={`mt-0.5 text-[11px] font-black ${color.text}`}>{stat}</div>}
        </div>
      </div>
    </button>
  );
};

/** One player-activity row in the Now panel — the latest tick
 *  events, compact; the workspace's Loot Feed stays the full
 *  feed, this is the deck's glanceable merge (§4). */
const NowActivityRow: React.FC<{ event: TickEvent }> = ({ event }) => {
  const color = getGainToneClass(event.tone);
  return (
    <div className="flex items-center gap-2 border border-border bg-bg/60 px-2 py-1.5">
      <span className={`h-2 w-2 shrink-0 ${color.fill}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-xs font-black text-text-primary">{event.label}</span>
      {event.detail && <span className="max-w-[45%] truncate text-[11px] text-text-muted">{event.detail}</span>}
    </div>
  );
};

interface LauncherAction {
  id: string;
  label: string;
  desc: string;
  stat?: string;
  icon: React.ReactNode;
  tone: Tone;
  primary?: boolean;
  onClick: () => void;
}

export const DashboardDeck: React.FC<DashboardDeckProps> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const inventory = useInventoryStore();
  const skills = useSkillStore();
  const boss = useBossStore();
  const activity = useActivityStore();
  const tickEvents = useTickFeedStore((state) => state.events);
  // The toast lane skips folded events (foreground-resume slice):
  // gains earned during a brief app switch stay in the Now record
  // below but never pop as catch-up toasts on return.
  const gainFeed = useMemo<DisplayGainEvent[]>(() => tickEvents.filter((event) => !event.folded).slice(0, 5), [tickEvents]);
  const nowEvents = useMemo(() => tickEvents.slice(0, 3), [tickEvents]);

  const currentBoss = boss.currentBossId ? REGION_1_BOSSES.find((b) => b.id === boss.currentBossId) : null;
  // CONS-04: gear-equipped counts the 7 gear slots only, via the one
  // loadout read model — the raw slot map also holds the vehicle slot,
  // which inflated this count against its /7 denominator.
  const equippedCount = countEquippedLoadoutSlots(buildLoadoutRows(loadout.slots, inventory.items));
  const shieldHp = loadout.getShield()?.hp ?? 0;
  useSyncSurvivalMaxHp(player.level, shieldHp);
  const hunterCurrentHp = useSurvivalStore((state) => state.currentHp);
  const hunterMaxHp = useSurvivalStore((state) => state.maxHp);
  const survivalMedKitBuffer = useSurvivalStore((state) => state.medKitBuffer);
  const activeBuffsStore = useActiveBuffsStore();
  const [overrideActivity, setOverrideActivity] = useState<ActivityKind | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const cycleOverride = React.useCallback(() => {
    setOverrideActivity((current) => {
      const idx = current ? HUD_ACTIVITY_CYCLE.indexOf(current) : -1;
      return HUD_ACTIVITY_CYCLE[(idx + 1) % HUD_ACTIVITY_CYCLE.length];
    });
  }, []);
  // Stat weapons: mirror same logic as LiveTurfDiorama
  const primaryWeapon = loadout.getWeapon('primary');
  const secondaryWeapon = loadout.getWeapon('secondary');
  const heavyWeapon = loadout.getWeapon('heavy');
  const equippedWeapons = [primaryWeapon, secondaryWeapon, heavyWeapon].filter((w): w is Weapon => !!w);
  const statWeapons = equippedWeapons;
  const activeBuffsNow = useNow();
  const activeBuffs = useMemo(
    () => activeBuffsStore.buffs.filter((buff) => buff.expiresAt > activeBuffsNow),
    [activeBuffsStore.buffs, activeBuffsNow],
  );
  const consumableMods = useMemo(
    () => buildConsumableInventoryMods(player.consumables),
    [player.consumables],
  );
  // Pop-up transience (owner ruling, 2026-11-02): a gain toast is a
  // pop-up, not a fixture — each event shows for TOAST_WINDOW_MS from
  // when the deck first sees it, then clears; at most two are ever
  // visible, newest first. First-sight is the clock, not the event's
  // `at`: claim batches back-date `at` per tick, so an `at`-based
  // window could hide a settle's newest events the moment they land.
  // The stamps adjust during render (the React-docs replacement for
  // a set-state effect), keyed on the gainFeed ref and stamped with
  // the reactive useNow clock.
  const [toastFirstSeen, setToastFirstSeen] = useState<ReadonlyMap<string, number>>(new Map());
  const [toastStampedFeed, setToastStampedFeed] = useState<readonly DisplayGainEvent[] | null>(null);
  if (toastStampedFeed !== gainFeed) {
    setToastStampedFeed(gainFeed);
    setToastFirstSeen((prev) => {
      const liveIds = new Set(gainFeed.map((event) => event.id));
      let next: Map<string, number> | null = null;
      for (const event of gainFeed) {
        if (!prev.has(event.id)) {
          next ??= new Map(prev);
          next.set(event.id, activeBuffsNow);
        }
      }
      for (const id of prev.keys()) {
        if (!liveIds.has(id)) {
          next ??= new Map(prev);
          next.delete(id);
        }
      }
      return next ?? prev;
    });
  }
  const visibleGains = useMemo(
    () => gainFeed
      .filter((event) => {
        const seenAt = toastFirstSeen.get(event.id);
        return seenAt !== undefined && activeBuffsNow - seenAt < TOAST_WINDOW_MS;
      })
      .slice(0, 2),
    [gainFeed, toastFirstSeen, activeBuffsNow],
  );
  const computedStats = useMemo(
    () => buildCharacterStatSummary({
      player,
      weapons: statWeapons,
      shield: loadout.getShield(),
      classMod: loadout.getClassMod(),
      relic: loadout.getRelic(),
      ordnance: loadout.getOrdnance(),
      spentSkills: skills.spent,
      boss: currentBoss ?? undefined,
      activeBuffs,
      consumableMods,
      consumableInventory: player.consumables,
      medKitBuffer: survivalMedKitBuffer,
    }),
    [player, statWeapons, loadout, skills.spent, currentBoss, activeBuffs, consumableMods, survivalMedKitBuffer],
  );

  const actions: LauncherAction[] = [
    // §4 launcher deck, fixed order: Dispatch and Crack Cache
    // first — the two Board orphans with no other low-tap door.
    { id: 'dispatch', label: 'Dispatch', desc: 'Timed contracts for spare loadouts and spare vehicles.', icon: <PxIcon name="signal" size={17} className="text-cyan" />, tone: 'cyan' as Tone, stat: 'Contract board', primary: true, onClick: () => onNavigate('dispatch') },
    { id: 'chest', label: 'Crack Cache', desc: 'Spend keys for server-rolled gear.', icon: <span className="shrink-0 font-black" style={{ color: getResourceVisual('cacheKey').color, fontSize: '16px' }}>{getResourceVisual('cacheKey').mark}</span>, tone: 'green' as Tone, stat: `${player.cacheKeys} keys`, primary: true, onClick: () => onNavigate('chest') },
    // Slots' canonical home is the Market rail stop (§3); this
    // card is its ◦ launcher — it deep-links straight to the stop
    // ('market:slots', DESIGN.md §9's two-tap count).
    { id: 'slots', label: 'Slots', desc: 'Data Slots — the wheel lives at the Market rail stop.', icon: <PxIcon name="bolt" size={17} className="text-purple" />, tone: 'purple' as Tone, stat: 'At Market', onClick: () => onNavigate('market:slots') },
    // §3/R5: the Loadout shortcut renders ONLY while a loadout
    // is incomplete — a full 7/7 hunter does not need the door.
    ...(equippedCount < 7
      ? [{ id: 'inventory', label: 'Loadout Bench', desc: 'Equip, compare, and tune gear.', icon: <PxIcon name="diamondIn" size={17} className="text-amber" />, tone: 'amber' as Tone, stat: `${equippedCount}/7 equipped`, onClick: () => onNavigate('loadout') }]
      : []),
  ];

  return (
    <div className="relative">
      <AnimatePresence>
        {visibleGains.length > 0 && (
          // The gain-toast lane (QC A9): its own fixed lane ABOVE
          // the bottom nav, never over it. BottomNav is 66px tall
          // (border-box; its safe-area padding lives inside that
          // height), so the lane's bottom edge sits at 66px + a
          // 14px clear gap. The old 70px offset left a 4px sliver —
          // the toasts read as sitting ON the nav, and their entry
          // slide (y:14) dipped into it. The slide is now 6px, so
          // a toast never crosses the lane's bottom edge.
          <motion.div className="pointer-events-none fixed bottom-[calc(80px+env(safe-area-inset-bottom))] left-0 right-0 z-50 mx-auto flex max-w-[440px] justify-center gap-1.5 px-3" initial={false}>
            {visibleGains.map((event) => <GainToast key={event.id} event={event} />)}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="relative space-y-2">
        {/* 1 — Launcher deck (§4 fixed order) */}
        <Panel label="Launchers" className="space-y-2">
          <div className="grid grid-cols-1 gap-1.5">{actions.slice(0, 2).map((action) => <ActionButton key={action.id} {...action} />)}</div>
          {actions.length > 2 && <div className="grid grid-cols-2 gap-1.5">{actions.slice(2).map((action) => <ActionButton key={action.id} {...action} />)}</div>}
        </Panel>

        {/* 2 — Weekly claimables (renders only in claimable states) */}
        <WeeklyClaimablesPanel />

        {/* 3 — Now: the single merged feed */}
        <Panel label="Now">
          <div className="space-y-2">
            {nowEvents.length > 0 && (
              <div className="space-y-1.5">
                {nowEvents.map((event) => <NowActivityRow key={event.id} event={event} />)}
              </div>
            )}
            <WorldPulseFeed bare />
          </div>
        </Panel>

        {/* 4 — Hunter Totals: one header, one Sources disclosure */}
        <Panel
          label="Hunter Totals"
          headerActions={
            <button
              type="button"
              data-testid="hunter-totals-sources-button"
              onClick={() => setBreakdownOpen(true)}
              className="flex items-center gap-1 border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[11px] font-black uppercase tracking-wider text-amber transition-colors hover:bg-amber/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber"
              style={signClip}
              aria-label="Open source breakdown for all character stats"
            >
              Sources
              <ChevronDown size={11} />
            </button>
          }
        >
          <CharacterStatBarBody
            embedded
            summary={computedStats}
            currentHp={hunterCurrentHp}
            maxHp={hunterMaxHp}
            activityKind={activity.current.kind}
            overrideActivity={overrideActivity}
            onChangeOverride={setOverrideActivity}
            onCycleActivity={cycleOverride}
          />
        </Panel>
        {breakdownOpen && (
          <CharacterStatBreakdownModal
            summary={computedStats}
            open={breakdownOpen}
            onClose={() => setBreakdownOpen(false)}
            activityKind={activity.current.kind}
          />
        )}
      </div>
    </div>
  );
};
