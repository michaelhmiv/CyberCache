import React, { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { PickerSheet } from '@/components/common/PickerSheet';
import {
  useActivityStore,
  useBossStore,
  useIdleStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useTickFeedStore,
  useWorkshopStore,
  useActiveBuffsStore,
} from '@/store';
import { useSurvivalStore } from '@/store/slices/survivalSlice';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { getRoamingArea } from '@/constants/roamingAreas';
import { AreaPickerList, CurrentAreaChip } from '@/components/common/AreaPicker';
import { useOfflineRecapStore } from '@/store/slices/offlineRecapSlice';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { LoginStreakPanel } from '@/components/dashboard/LoginStreakPanel';
import { CharacterStatBarBody } from '@/components/stats/CharacterStatBar';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import { ActiveBuffPills } from '@/components/stats/ActiveBuffPills';
import { ConsumableLedger } from '@/components/stats/ConsumableLedger';
import type { LoadoutConsumables } from '@/store/slices/loadoutSlice';
import { buildCharacterStatSummary } from '@/lib/stats/characterStats';
import { buildConsumableInventoryMods } from '@/lib/buffs/consumableModsAdapter';
import { useNow } from '@/hooks/useNow';
import { buildBossFightActivity, buildRoamingLootActivity } from '@/lib/activity/activityBuilders';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { computeMedKitBuffer } from '@/lib/combat/damageContract';
import { PRODUCTIVE_ACTIVITY_LABELS } from '@/types/activity';
import { xpToNextLevel } from '@/content/simulation';
import { getAreaVisual } from '@/constants/areaVisuals';
import { AreaBackground } from '@/components/common/AreaBackground';
import { getActivityVisual } from '@/constants/activityVisuals';
import { getResourceVisual } from '@/constants/visualAssets';
import type { TickEvent, TickEventTone } from '@/store/slices/tickSlice';
import type { ActivityKind } from '@/types/activity';
import type { Weapon } from '@/types/items';
// DisplayGainEvent + gainFeed are still needed by GainToast (the floating
// fixed-position toasts at the bottom of the screen). The "Numbers Up"
// panel used to render the same data as a static grid — gone now.

interface DashboardScreenProps {
  onNavigate: (screen: string) => void;
  /** Opens the App-level boss picker (flow-fix F16). Optional so
   *  existing mounts keep working; falls back to the Action tab. */
  onOpenBossSelect?: () => void;
}

type Tone = 'amber' | 'green' | 'blue' | 'red' | 'purple' | 'cyan';
type DisplayGainTone = TickEventTone | 'unknown';

type DisplayGainEvent = Pick<TickEvent, 'id' | 'label' | 'detail'> & {
  tone?: string;
};

const HUD_ACTIVITY_CYCLE: ActivityKind[] = ['roaming_loot', 'crafting', 'salvaging', 'market_listing', 'workshop_service'];

// NOTE: `TICK_SECONDS`, `FIELD_FIND_CHANCE`, `CACHE_FRAGMENT_CHANCE` removed —
// the Level Strip footer used them to render static, never-varying hints
// ("3.00s tick · 22% loot · 3% frag") that duplicated info already shown
// elsewhere (XP-per-tick on Choose Area cards, loot bias in Hunter Totals'
// Rare Find metric). The aggregate tick sources already flow through the
// tick slice / area defs and surface in the right place.

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
  unknown: { text: 'text-text-secondary', bg: 'bg-surface-raised', border: 'border-border', fill: 'bg-text-muted' },
};

const getGainToneClass = (tone?: string) => gainToneClass[(tone ?? 'unknown') as DisplayGainTone] ?? gainToneClass.unknown;

const safeText = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;

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
      <div className="relative mb-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-text-muted">
        <span className="h-px flex-1 bg-border-light" />
        <span>{label}</span>
        {headerActions && <span className="flex shrink-0 items-center gap-1.5">{headerActions}</span>}
        <span className="h-px flex-1 bg-border-light" />
      </div>
    )}
    <div className="relative">{children}</div>
  </section>
);

const AreaGlyph: React.FC<{ areaId: string; size?: number; className?: string }> = ({ areaId, size = 14, className = '' }) => {
  const visual = getAreaVisual(areaId);
  return <span className={`shrink-0 font-black inline-flex items-center justify-center ${className}`} style={{ color: visual.color, fontSize: `${size}px`, width: size, height: size }}>{visual.sigil}</span>;
};

const RewardIcon: React.FC<{ tone?: string }> = ({ tone }) => {
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
  if (resourceId) {
    const visual = getResourceVisual(resourceId);
    return (
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 border-border ${color.bg}`}>
        <span className="shrink-0 font-black" style={{ color: visual.color, fontSize: '15px' }}>{visual.mark}</span>
      </div>
    );
  }
  // Fallback: activity glyph for non-resource tones
  const actVisual = getActivityVisual('idle_standby');
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 border-border ${color.bg}`}>
      <span className="shrink-0 font-black" style={{ color: color.text.includes('text-text-secondary') ? '#B8B0A8' : '#FF9000', fontSize: '15px' }}>{actVisual.glyph}</span>
    </div>
  );
};

const GainToast: React.FC<{ event: DisplayGainEvent }> = ({ event }) => {
  const color = getGainToneClass(event.tone);
  return (
    <motion.div layout initial={{ opacity: 0, y: 14, scale: 0.9, rotate: -1 }} animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }} exit={{ opacity: 0, y: 14, scale: 0.92 }} transition={{ duration: 0.14 }} className={`pointer-events-none inline-flex min-w-[112px] items-center gap-2 border-2 ${color.border} bg-bg px-2 py-1.5 shadow-[0_10px_22px_rgba(0,0,0,0.85)]`} style={signClip}>
      <div className={`absolute left-0 top-0 h-full w-1.5 ${color.fill}`} />
      <RewardIcon tone={event.tone} />
      <div className="min-w-0 leading-none">
        <div className={`text-base font-black uppercase tracking-wide ${color.text}`}>{event.label}</div>
        <div className="mt-0.5 truncate text-[8px] font-black uppercase tracking-[0.14em] text-text-muted">{event.detail}</div>
      </div>
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
          <div className="text-[9px] leading-snug text-text-muted">{desc}</div>
          {stat && <div className={`mt-0.5 text-[9px] font-black ${color.text}`}>{stat}</div>}
        </div>
      </div>
    </button>
  );
};

const InfoGauge: React.FC<{ label: string; value: string | number; detail: string; icon: React.ReactNode; tone: Tone; onClick?: () => void }> = ({ label, value, detail, icon, tone, onClick }) => {
  const color = toneClass[tone];
  const isClickable = Boolean(onClick);
  return (
    <div onClick={onClick} className={`relative overflow-hidden border-2 border-border bg-bg/75 p-1.5 ${isClickable ? 'cursor-pointer transition-transform active:scale-[0.97] hover:border-amber' : ''}`} style={panelClip}>
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <div className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 border-border ${color.bg}`}>{icon}</div>
          <div className="min-w-0">
            <div className="text-[8px] uppercase tracking-wide text-text-muted">{label}</div>
            <div className="truncate text-xs font-black leading-tight text-text-primary">{value}</div>
          </div>
        </div>
        {isClickable && <ChevronDown size={10} className="shrink-0 text-text-muted" />}
      </div>
      <div className="mt-0.5 truncate text-[8px] text-text-muted">{detail}</div>
    </div>
  );
};

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigate, onOpenBossSelect }) => {
  const player = usePlayerStore();
  const loadout = useLoadoutStore();
  const skills = useSkillStore();
  const boss = useBossStore();
  const workshop = useWorkshopStore();
  const idle = useIdleStore();
  const activity = useActivityStore();
  const tickEvents = useTickFeedStore((state) => state.events);
  const lastSettlement = useOfflineRecapStore((s) => s.lastSettlement);
  const recapDismissed = useOfflineRecapStore((s) => s.dismissed);
  const reopenRecap = useOfflineRecapStore((s) => s.reopen);
  const gainFeed = useMemo<DisplayGainEvent[]>(() => tickEvents.slice(0, 5), [tickEvents]);
  const [activityError, setActivityError] = useState<string | null>(null);

  const currentBoss = boss.currentBossId ? REGION_1_BOSSES.find((b) => b.id === boss.currentBossId) : null;
  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const equippedCount = Object.values(loadout.slots).filter(Boolean).length;
  const spentSkillPoints = skills.getTotalSpent();
  const availableSkillPoints = Math.max(0, player.level - 1 - spentSkillPoints);
  const equippedWeapon = loadout.getWeapon('primary') ?? loadout.getWeapon('secondary') ?? loadout.getWeapon('heavy') ?? undefined;
  const shieldHp = loadout.getShield()?.hp ?? 0;
  useSyncSurvivalMaxHp(player.level, shieldHp);
  const hunterCurrentHp = useSurvivalStore((state) => state.currentHp);
  const hunterMaxHp = useSurvivalStore((state) => state.maxHp);
  const survivalMedKitBuffer = useSurvivalStore((state) => state.medKitBuffer);
  const activeBuffsStore = useActiveBuffsStore();
  const [overrideActivity, setOverrideActivity] = useState<ActivityKind | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [focusedSlot, setFocusedSlot] = useState<keyof LoadoutConsumables | null>(null);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [turfPickerOpen, setTurfPickerOpen] = useState(false);
  const cycleOverride = useCallback(() => {
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
  const openWorkshopJobs = (workshop.server?.jobs ?? []).filter(
    (j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused',
  ).length;
  const xpToNextLevelValue = xpToNextLevel(player.level);
  const xpProgress = Math.min(100, Math.max(0, (player.xp / xpToNextLevelValue) * 100));
  const xpRemaining = Math.max(0, xpToNextLevelValue - player.xp);
  const activePayload = activity.current.publicPayload;
  const activityLabel = safeText(activePayload.activity_label) ?? PRODUCTIVE_ACTIVITY_LABELS[activity.current.kind] ?? activity.current.kind;
  const activityTarget = activity.current.targetLabel ?? safeText(activePayload.target_label) ?? 'No target';
  const selectedRoamingActive = activity.current.kind === 'roaming_loot' && activity.current.targetType === 'roaming_area' && activity.current.targetId === selectedArea.id;
  const routeStat = selectedRoamingActive ? `active ${selectedArea.name}` : selectedArea.name;

  // Navigation on these handlers happens ONLY on success (flow-fix
  // F7): they used to navigate in a `finally`, so a failed start landed
  // the player on the Action tab while the error sat on the Dashboard
  // behind them, never seen. On failure the player now stays here,
  // where the activityError panel renders.
  const startSelectedRoaming = useCallback(async () => {
    setActivityError(null);
    try {
      // Activate survival consumables proactively on roaming start.
      const survivalStore = useSurvivalStore.getState();
      const playerState = usePlayerStore.getState();
      // Med Kit: set HP buffer (stacked from inventory count)
      const medKitCount = playerState.consumables['MedKit'] ?? 0;
      if (medKitCount > 0) {
        const bufferAmount = computeMedKitBuffer('MedKit');
        survivalStore.setMedKitBuffer(medKitCount * bufferAmount);
      }
      // Nano Swarm: start per-tick regen
      if ((playerState.consumables['NanoSwarm'] ?? 0) > 0) {
        survivalStore.startNanoSwarm(30); // 30 ticks × 10 HP = 300 HP
      }
      await activity.start(buildRoamingLootActivity(selectedArea, equippedWeapon));
      idle.setFarming(true);
      onNavigate('fight');
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : 'Unable to start roaming activity.');
    }
  }, [activity, equippedWeapon, idle, onNavigate, selectedArea]);

  const openBossPrep = useCallback(async () => {
    if (!currentBoss) {
      // "Choose Boss" must open a boss chooser (flow-fix F16): the
      // App-level BossSelectModal, not a bare tab switch into the
      // roaming workspace.
      if (onOpenBossSelect) {
        onOpenBossSelect();
      } else {
        onNavigate('fight');
      }
      return;
    }
    setActivityError(null);
    try {
      await activity.start(buildBossFightActivity(currentBoss, equippedWeapon, 'prep'));
      idle.setFarming(false);
      onNavigate('fight');
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : 'Unable to start boss prep activity.');
    }
  }, [activity, currentBoss, equippedWeapon, idle, onNavigate, onOpenBossSelect]);

  const actions = [
    // Audit NAV-01: the Action Board row is status + navigation, not
    // a rival start button. Roaming starts under ONE verb — the
    // diorama's "Start Roam" here and in the Action workspace — so
    // this row reports the run's state and opens the workspace.
    { id: 'fight', label: 'Roaming', desc: selectedRoamingActive ? 'Run live now — open the Action workspace to manage it.' : 'Open the Action workspace to start roaming.', icon: <span style={{ fontSize: 16 }} className="text-red">⚔</span>, tone: 'red' as Tone, stat: routeStat, primary: true, onClick: () => onNavigate('fight') },
    { id: 'inventory', label: 'Loadout Bench', desc: 'Equip, compare, and tune gear.', icon: <span style={{ fontSize: 16 }} className="text-amber">◈</span>, tone: 'amber' as Tone, stat: `${equippedCount}/7 equipped`, primary: true, onClick: () => onNavigate('loadout') },
    { id: 'chest', label: 'Crack Cache', desc: 'Spend keys for server-rolled gear.', icon: <span className="shrink-0 font-black" style={{ color: getResourceVisual('cacheKey').color, fontSize: '16px' }}>{getResourceVisual('cacheKey').mark}</span>, tone: 'green' as Tone, stat: `${player.cacheKeys} keys`, onClick: () => onNavigate('chest') },
    { id: 'skills', label: 'Skill Trees', desc: 'Spend points and build identity.', icon: <span style={{ fontSize: 16 }} className="text-purple">♕</span>, tone: 'purple' as Tone, stat: `${availableSkillPoints} pts ready`, onClick: () => onNavigate('skills') },
    { id: 'workshop', label: 'Workshop', desc: 'Bench jobs run while Crafting holds the action slot.', icon: <span style={{ fontSize: 16 }} className="text-blue">⚒</span>, tone: 'blue' as Tone, stat: `${openWorkshopJobs} jobs`, onClick: () => onNavigate('workshop') },
    { id: 'dispatch', label: 'Dispatch', desc: 'Timed contracts for spare loadouts and spare vehicles.', icon: <span style={{ fontSize: 16 }} className="text-cyan">➤</span>, tone: 'cyan' as Tone, stat: 'Contract board', onClick: () => onNavigate('dispatch') },
    { id: 'market', label: 'Market', desc: 'Browse listings and economy systems.', icon: <span style={{ fontSize: 16 }} className="text-cyan">$</span>, tone: 'cyan' as Tone, stat: 'Trade hub', onClick: () => onNavigate('market') },
  ];

  return (
    <div className="bl-page relative overflow-hidden p-2 pb-16">
      <AnimatePresence>
        {gainFeed.length > 0 && (
          <motion.div className="fixed bottom-[calc(70px+env(safe-area-inset-bottom))] left-0 right-0 z-50 mx-auto flex max-w-[440px] justify-center gap-1.5 px-3" initial={false}>
            {gainFeed.slice(0, 2).map((event) => <GainToast key={event.id} event={event} />)}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-0 opacity-70"><div className="absolute left-5 top-20 h-48 w-48 rounded-full bg-amber/10 blur-3xl" /><div className="absolute right-2 top-72 h-48 w-48 rounded-full bg-red/10 blur-3xl" /></div>
      <div className="relative space-y-2">
        <ResourceBar className="mb-2" />
        {/* Persistent current-area chip — tap opens the one area picker */}
        <div>
          <CurrentAreaChip onClick={() => setTurfPickerOpen(true)} />
        </div>
        {activityError && <Panel label="Action Error"><div className="text-xs font-bold text-red">{activityError}</div></Panel>}
        {/* Re-entry for the last offline summary after it was dismissed */}
        {lastSettlement && recapDismissed && (
          <Panel label="While You Were Away">
            <button
              type="button"
              data-testid="offline-recap-reopen"
              onClick={reopenRecap}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-black text-text-primary">
                  +{lastSettlement.rewards.creditsAwarded.toLocaleString()} credits · +{lastSettlement.rewards.xpAwarded.toLocaleString()} XP
                  {lastSettlement.items.length > 0 ? ` · ${lastSettlement.items.length} item${lastSettlement.items.length === 1 ? '' : 's'}` : ''}
                </span>
                <span className="block text-[9px] text-text-muted">Last offline summary — tap to view it again</span>
              </span>
              <ChevronRight size={14} className="shrink-0 text-amber" />
            </button>
          </Panel>
        )}
        {/* Daily login streak (0036): mounting the panel IS the
            daily check-in — the Chef records the day and grants
            the ladder reward server-side on first view. */}
        <LoginStreakPanel />
        <Panel label="Level Strip"><div className="flex items-center gap-2"><div className="relative flex h-16 w-16 shrink-0 -rotate-2 items-center justify-center border-4 border-border bg-amber/15 shadow-[5px_5px_0_rgba(0,0,0,0.75)]"><div className="absolute inset-1 border border-amber/40" /><div className="text-center"><div className="text-[8px] font-black uppercase tracking-widest text-text-muted">Level</div><div className="text-3xl font-black leading-none text-amber">{player.level}</div></div></div><div className="min-w-0 flex-1"><div className="flex items-end justify-between gap-2"><div><div className="text-sm font-black uppercase tracking-wide text-text-primary">Level Progress</div><div className="text-[9px] text-text-muted">{player.xp.toLocaleString()} / {xpToNextLevelValue.toLocaleString()} XP · {xpRemaining.toLocaleString()} left</div></div></div><div className="relative mt-1.5 h-4 overflow-hidden border-2 border-border bg-bg" style={signClip}><motion.div className="h-full bg-green shadow-[0_0_12px_rgba(124,252,0,0.25)]" initial={false} animate={{ width: `${xpProgress}%` }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} /><div className="absolute inset-0 grid grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <span key={index} className="border-l border-bg/70 first:border-l-0" />)}</div></div></div></div></Panel>
        <LiveTurfDiorama area={selectedArea} weapon={equippedWeapon} bossName={currentBoss?.name} bossWeaknessCount={currentBoss?.weaknesses.length} boss={currentBoss ?? undefined} playerLevel={player.level} equippedCount={equippedCount} cacheKeys={player.cacheKeys} activityKind={activity.current.kind} bossPhase={activity.current.bossPhase} activityLabel={activityLabel} activityTarget={activityTarget} statSummary={computedStats} onFight={startSelectedRoaming} onSecondary={openBossPrep} secondaryActionLabel={currentBoss ? 'Prep Boss' : 'Choose Boss'} secondaryActionDetail={currentBoss ? `${currentBoss.weaknesses.length} weakness tags` : 'Open Action target picker'} />
        <Panel
          label="Hunter Totals"
          headerActions={
            <button
              type="button"
              data-testid="hunter-totals-sources-button"
              onClick={() => setBreakdownOpen(true)}
              className="flex items-center gap-1 border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber transition-colors hover:bg-amber/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber"
              style={signClip}
              aria-label="Open source breakdown for all character stats"
            >
              Sources
              <ChevronDown size={9} />
            </button>
          }
        >
          <CharacterStatBarBody
            summary={computedStats}
            currentHp={hunterCurrentHp}
            maxHp={hunterMaxHp}
            activityKind={activity.current.kind}
            overrideActivity={overrideActivity}
            onChangeOverride={setOverrideActivity}
            onCycleActivity={cycleOverride}
          />
        </Panel>
        <Panel label="Consumables">
          <ActiveBuffPills consumables={loadout.consumables} inventory={player.consumables} onSlotClick={(slot) => { setFocusedSlot(slot); setLedgerOpen(true); }} />
        </Panel>
        {ledgerOpen && <ConsumableLedger consumables={loadout.consumables} inventory={player.consumables} focusedSlot={focusedSlot} onClose={() => { setLedgerOpen(false); setFocusedSlot(null); }} />}
        {breakdownOpen && (
          <CharacterStatBreakdownModal
            summary={computedStats}
            open={breakdownOpen}
            onClose={() => setBreakdownOpen(false)}
            activityKind={activity.current.kind}
          />
        )}
        {turfPickerOpen && (
          <PickerSheet
            title="Choose Area"
            subtitle={`Current area: ${selectedArea.name}. Tap an area to switch.`}
            onClose={() => setTurfPickerOpen(false)}
          >
            <div className="space-y-2 p-3">
              <AreaPickerList
                onSelect={(area) => {
                  idle.setSelectedRoamingArea(area.id);
                  setTurfPickerOpen(false);
                }}
              />
            </div>
          </PickerSheet>
        )}
        <Panel label="Action Board" className="space-y-2"><div className="grid grid-cols-1 gap-1.5">{actions.slice(0, 2).map((action) => <ActionButton key={action.id} {...action} />)}</div><div className="grid grid-cols-2 gap-1.5">{actions.slice(2).map((action) => <ActionButton key={action.id} {...action} />)}</div></Panel>
        <Panel label="Hunter Notes"><div className="grid grid-cols-2 gap-1.5"><InfoGauge label="Area" value={selectedArea.manufacturerInfluence} detail={`${selectedArea.dangerRating} · ${selectedArea.lootBias[0]}`} icon={<AreaGlyph areaId={selectedArea.id} size={14} />} tone="amber" onClick={() => setTurfPickerOpen(true)} /><InfoGauge
            label="Equipped"
            value={equippedWeapon?.name ?? 'None'}
            detail={equippedWeapon ? `${equippedWeapon.combatPower} combat power` : 'Open loadout bench'}
            icon={<span style={{ fontSize: 14 }} className="text-red">✦</span>}
            tone="red"
            onClick={() => onNavigate('inventory')}
          /></div></Panel>
        <Panel
          label="Choose Area"
          headerActions={
            <button
              type="button"
              data-testid="dashboard-turf-switch-button"
              onClick={() => setTurfPickerOpen(true)}
              className="flex items-center gap-1 border border-amber/40 bg-amber/10 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-amber transition-colors hover:bg-amber/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber"
              style={signClip}
              aria-label="Change area"
            >
              Change Area
              <ChevronDown size={9} />
            </button>
          }
        >
          <button
            type="button"
            onClick={() => setTurfPickerOpen(true)}
            className="relative w-full overflow-hidden border-2 border-border bg-bg/75 p-2 text-left transition-transform active:scale-[0.98] hover:border-amber"
            style={panelClip}
          >
            <AreaBackground areaId={selectedArea.id} opacity={0.14} />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2">
                <AreaGlyph areaId={selectedArea.id} size={16} className="shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-black text-text-primary">{selectedArea.name}</div>
                  <div className="text-[9px] uppercase tracking-wide text-text-muted">LV {selectedArea.unlockLevel} / {selectedArea.dangerRating}</div>
                </div>
              </div>
              <ChevronDown size={12} className="shrink-0 text-text-muted" />
            </div>
            <div className="relative mt-1 truncate text-[9px] text-amber">{selectedArea.lootBias[0]}</div>
            <div className="relative mt-1 text-[8px] uppercase tracking-[0.16em] text-text-muted">Tap to change area</div>
          </button>
        </Panel>
      </div>
    </div>
  );
};
