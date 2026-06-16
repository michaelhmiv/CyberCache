import React, { useCallback, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Backpack,
  BarChart3,
  Box,
  ChevronRight,
  Crosshair,
  Hammer,
  Lock,
  Map,
  PackageSearch,
  Sparkles,
  Trophy,
} from 'lucide-react';
import {
  useActivityStore,
  useBossStore,
  useIdleStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useTickFeedStore,
  useWorkshopStore,
} from '@/store';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS, getRoamingArea, isRoamingAreaUnlocked } from '@/constants/roamingAreas';
import { ResourceBar } from '@/components/layout/ResourceBar';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { buildBossPrepActivity, buildRoamingLootActivity } from '@/lib/activity/activityBuilders';
import { useSyncSurvivalMaxHp } from '@/hooks/useSyncSurvivalMaxHp';
import { PRODUCTIVE_ACTIVITY_LABELS } from '@/types/activity';
import { xpToNextLevel } from '@/content/simulation';
import type { TickEvent, TickEventTone } from '@/store/slices/tickSlice';

interface DashboardScreenProps {
  onNavigate: (screen: string) => void;
}

type Tone = 'amber' | 'green' | 'blue' | 'red' | 'purple' | 'cyan';
type DisplayGainTone = TickEventTone | 'unknown';

type DisplayGainEvent = Pick<TickEvent, 'id' | 'label' | 'detail'> & {
  tone?: string;
};

const TICK_SECONDS = 3;
const FIELD_FIND_CHANCE = 22;
const CACHE_FRAGMENT_CHANCE = 3;

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
  unknown: { text: 'text-text-secondary', bg: 'bg-surface-raised', border: 'border-border', fill: 'bg-text-muted' },
};

const getGainToneClass = (tone?: string) => gainToneClass[(tone ?? 'unknown') as DisplayGainTone] ?? gainToneClass.unknown;

const idleGainHint: DisplayGainEvent = {
  id: 'idle-loop-ready',
  label: '+0',
  detail: 'activity gated',
  tone: 'xp',
};

const safeText = (value: unknown): string | null => typeof value === 'string' && value.trim().length > 0 ? value : null;

const Panel: React.FC<React.PropsWithChildren<{ label?: string; className?: string }>> = ({ label, className = '', children }) => (
  <section className={`relative overflow-hidden border-2 border-border bg-surface/95 p-2 shadow-[0_8px_18px_rgba(0,0,0,0.55)] ${className}`} style={panelClip}>
    <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(145deg,rgba(255,144,0,0.12)_0,transparent_34%,rgba(255,75,92,0.08)_100%)]" />
    <div className="pointer-events-none absolute -left-10 top-3 h-3 w-32 -rotate-12 bg-amber/20" />
    {label && (
      <div className="relative mb-1 flex items-center gap-2 text-[9px] font-black uppercase tracking-[0.16em] text-text-muted">
        <span className="h-px flex-1 bg-border-light" />
        <span>{label}</span>
        <span className="h-px flex-1 bg-border-light" />
      </div>
    )}
    <div className="relative">{children}</div>
  </section>
);

const RewardIcon: React.FC<{ tone?: string }> = ({ tone }) => {
  const color = getGainToneClass(tone);
  const Icon = tone === 'loot'
    ? PackageSearch
    : tone === 'cache' || tone === 'fragment'
      ? Box
      : tone === 'level' || tone === 'kill' || tone === 'death'
        ? Trophy
        : tone === 'cash'
          ? Sparkles
          : Activity;
  return <div className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 border-border ${color.bg}`}><Icon size={17} className={color.text} /></div>;
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

const ActionButton: React.FC<{ label: string; desc: string; stat?: string; icon: React.ElementType; tone: Tone; primary?: boolean; onClick: () => void }> = ({ label, desc, stat, icon: Icon, tone, primary = false, onClick }) => {
  const color = toneClass[tone];
  return (
    <button type="button" onClick={onClick} className={`group relative overflow-hidden border-2 text-left transition-transform active:scale-[0.98] ${primary ? `${color.border} ${color.bg}` : 'border-border bg-bg/80'}`} style={panelClip}>
      <div className={`absolute left-0 top-0 h-full w-1.5 ${color.fill}`} />
      <div className="relative flex min-h-[56px] items-center gap-2 p-2 pl-3">
        <div className={`flex h-9 w-9 shrink-0 -rotate-2 items-center justify-center border-2 border-border ${color.bg}`}><Icon size={16} className={color.text} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><div className="text-xs font-black uppercase tracking-wide text-text-primary">{label}</div><ChevronRight size={14} className={`${color.text} opacity-75 transition-transform group-active:translate-x-0.5`} /></div>
          <div className="text-[9px] leading-snug text-text-muted">{desc}</div>
          {stat && <div className={`mt-0.5 text-[9px] font-black ${color.text}`}>{stat}</div>}
        </div>
      </div>
    </button>
  );
};

const InfoGauge: React.FC<{ label: string; value: string | number; detail: string; icon: React.ElementType; tone: Tone; onClick?: () => void }> = ({ label, value, detail, icon: Icon, tone, onClick }) => {
  const color = toneClass[tone];
  const isClickable = Boolean(onClick);
  return (
    <div onClick={onClick} className={`relative overflow-hidden border-2 border-border bg-bg/75 p-1.5 ${isClickable ? 'cursor-pointer transition-transform active:scale-[0.97] hover:border-amber' : ''}`} style={panelClip}>
      <div className="flex items-center gap-1.5"><div className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 border-border ${color.bg}`}><Icon size={14} className={color.text} /></div><div className="min-w-0"><div className="text-[8px] uppercase tracking-wide text-text-muted">{label}</div><div className="truncate text-xs font-black leading-tight text-text-primary">{value}</div></div></div>
      <div className="mt-0.5 truncate text-[8px] text-text-muted">{detail}</div>
    </div>
  );
};

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const skills = useSkillStore();
  const boss = useBossStore();
  const workshop = useWorkshopStore();
  const idle = useIdleStore();
  const activity = useActivityStore();
  const tickEvents = useTickFeedStore((state) => state.events);
  const gainFeed = useMemo<DisplayGainEvent[]>(() => tickEvents.slice(0, 5), [tickEvents]);
  const [activityError, setActivityError] = useState<string | null>(null);

  const currentBoss = boss.currentBossId ? REGION_1_BOSSES.find((b) => b.id === boss.currentBossId) : null;
  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const equippedCount = Object.values(loadout.slots).filter(Boolean).length;
  const spentSkillPoints = skills.getTotalSpent();
  const availableSkillPoints = Math.max(0, player.level - 1 - spentSkillPoints);
  const bestWeapon = [...inventory.getWeapons()].sort((a, b) => b.combatPower - a.combatPower)[0];
  const equippedWeapon = loadout.getWeapon('primary') ?? loadout.getWeapon('secondary') ?? loadout.getWeapon('heavy') ?? bestWeapon;
  const shieldHp = loadout.getShield()?.hp ?? 0;
  useSyncSurvivalMaxHp(player.level, shieldHp);
  const openWorkshopJobs = workshop.activeQueues.length;
  const xpToNextLevelValue = xpToNextLevel(player.level);
  const xpProgress = Math.min(100, Math.max(0, (player.xp / xpToNextLevelValue) * 100));
  const xpRemaining = Math.max(0, xpToNextLevelValue - player.xp);
  const nextArea = ROAMING_AREAS.find((area) => !isRoamingAreaUnlocked(area, player.level));
  const masteryScore = player.level * 100 + inventory.items.length * 5 + boss.defeatedBossIds.length * 50 + spentSkillPoints * 25;
  const activePayload = activity.current.publicPayload;
  const activityLabel = safeText(activePayload.activity_label) ?? PRODUCTIVE_ACTIVITY_LABELS[activity.current.kind] ?? activity.current.kind;
  const activityTarget = activity.current.targetLabel ?? safeText(activePayload.target_label) ?? 'No target';
  const selectedRoamingActive = activity.current.kind === 'roaming_loot' && activity.current.targetType === 'roaming_area' && activity.current.targetId === selectedArea.id;
  const productiveTickLabel = selectedRoamingActive ? `+${selectedArea.idleXpPerTick}/tick` : 'gated';
  const routeStat = selectedRoamingActive ? `active ${selectedArea.name}` : `start ${selectedArea.name}`;

  const startSelectedRoaming = useCallback(async () => {
    setActivityError(null);
    try {
      await activity.start(buildRoamingLootActivity(selectedArea, equippedWeapon));
      idle.setFarming(true);
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : 'Unable to start roaming activity.');
    } finally {
      onNavigate('fight');
    }
  }, [activity, equippedWeapon, idle, onNavigate, selectedArea]);

  const openBossPrep = useCallback(async () => {
    if (!currentBoss) {
      onNavigate('chest');
      return;
    }
    setActivityError(null);
    try {
      await activity.start(buildBossPrepActivity(currentBoss, equippedWeapon));
      idle.setFarming(false);
    } catch (error) {
      setActivityError(error instanceof Error ? error.message : 'Unable to start boss prep activity.');
    } finally {
      onNavigate('fight');
    }
  }, [activity, currentBoss, equippedWeapon, idle, onNavigate]);

  const actions = [
    { id: 'fight', label: selectedRoamingActive ? 'Enter Active Run' : 'Start Wastes Run', desc: 'Sync selected turf as the active route, then enter combat.', icon: Crosshair, tone: 'red' as Tone, stat: routeStat, primary: true, onClick: startSelectedRoaming },
    { id: 'inventory', label: 'Loadout Bench', desc: 'Equip, compare, and tune gear.', icon: Backpack, tone: 'amber' as Tone, stat: `${equippedCount}/7 equipped`, primary: true, onClick: () => onNavigate('inventory') },
    { id: 'chest', label: 'Crack Cache', desc: 'Spend keys for server-rolled gear.', icon: Box, tone: 'green' as Tone, stat: `${player.cacheKeys} keys`, onClick: () => onNavigate('chest') },
    { id: 'skills', label: 'Skill Trees', desc: 'Spend points and build identity.', icon: Trophy, tone: 'purple' as Tone, stat: `${availableSkillPoints} pts ready`, onClick: () => onNavigate('skills') },
    { id: 'workshop', label: 'Workshop', desc: 'Craft dispatch uses activity; bench timers stay passive.', icon: Hammer, tone: 'blue' as Tone, stat: `${openWorkshopJobs} queues`, onClick: () => onNavigate('workshop') },
    { id: 'market', label: 'Market', desc: 'Browse listings and economy systems.', icon: BarChart3, tone: 'cyan' as Tone, stat: 'Trade hub', onClick: () => onNavigate('market') },
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
        {activityError && <Panel label="Action Error"><div className="text-xs font-bold text-red">{activityError}</div></Panel>}
        <Panel label="Level Strip"><div className="flex items-center gap-2"><div className="relative flex h-16 w-16 shrink-0 -rotate-2 items-center justify-center border-4 border-border bg-amber/15 shadow-[5px_5px_0_rgba(0,0,0,0.75)]"><div className="absolute inset-1 border border-amber/40" /><div className="text-center"><div className="text-[8px] font-black uppercase tracking-widest text-text-muted">Level</div><div className="text-3xl font-black leading-none text-amber">{player.level}</div></div></div><div className="min-w-0 flex-1"><div className="flex items-end justify-between gap-2"><div><div className="text-sm font-black uppercase tracking-wide text-text-primary">XP Chalk Mark</div><div className="text-[9px] text-text-muted">{player.xp.toLocaleString()} / {xpToNextLevelValue.toLocaleString()} XP · {xpRemaining.toLocaleString()} left</div></div><div className={`text-right text-[9px] font-black ${selectedRoamingActive ? 'text-green' : 'text-text-muted'}`}>{productiveTickLabel}</div></div><div className="relative mt-1.5 h-4 overflow-hidden border-2 border-border bg-bg" style={signClip}><motion.div className="h-full bg-green shadow-[0_0_12px_rgba(124,252,0,0.25)]" initial={false} animate={{ width: `${xpProgress}%` }} transition={{ type: 'spring', stiffness: 90, damping: 18 }} /><div className="absolute inset-0 grid grid-cols-5">{Array.from({ length: 5 }).map((_, index) => <span key={index} className="border-l border-bg/70 first:border-l-0" />)}</div></div><div className="mt-1 flex items-center justify-between gap-2 text-[8px] uppercase tracking-wide text-text-muted"><span>{selectedRoamingActive ? `${TICK_SECONDS}.00s tick` : 'activity required'}</span><span>{FIELD_FIND_CHANCE}% loot</span><span>{CACHE_FRAGMENT_CHANCE}% frag</span></div></div></div></Panel>
        <LiveTurfDiorama area={selectedArea} weapon={equippedWeapon} bossName={currentBoss?.name} bossWeaknessCount={currentBoss?.weaknesses.length} boss={currentBoss ?? undefined} playerLevel={player.level} equippedCount={equippedCount} cacheKeys={player.cacheKeys} activityKind={activity.current.kind} activityLabel={activityLabel} activityTarget={activityTarget} onFight={startSelectedRoaming} onSecondary={openBossPrep} />
        <Panel label="Action Board" className="space-y-2"><div className="grid grid-cols-1 gap-1.5">{actions.slice(0, 2).map((action) => <ActionButton key={action.id} {...action} />)}</div><div className="grid grid-cols-2 gap-1.5">{actions.slice(2).map((action) => <ActionButton key={action.id} {...action} />)}</div></Panel>
        <Panel label="Hunter Notes"><div className="grid grid-cols-2 gap-1.5"><InfoGauge label="Turf" value={selectedArea.manufacturerInfluence} detail={selectedArea.dangerRating} icon={Map} tone="amber" /><InfoGauge label="Mastery" value={masteryScore.toLocaleString()} detail={`${availableSkillPoints} unspent points`} icon={Trophy} tone="purple" /><InfoGauge label="Best Gun" value={bestWeapon?.name ?? 'None'} detail={bestWeapon ? `${bestWeapon.combatPower} combat power` : 'Find gear in combat'} icon={Sparkles} tone="red" /><InfoGauge label="Workshop" value={openWorkshopJobs} detail={openWorkshopJobs > 0 ? `${openWorkshopJobs} passive queue${openWorkshopJobs === 1 ? '' : 's'} — tap` : 'open craft bench'} icon={Hammer} tone="green" onClick={() => onNavigate('workshop')} /></div>{nextArea && <div className="mt-2 flex items-center gap-2 border-2 border-border bg-bg/75 p-1.5" style={panelClip}><div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-border bg-surface-raised"><Lock size={14} className="text-text-muted" /></div><div className="min-w-0 flex-1"><div className="text-[9px] font-black uppercase tracking-wide text-text-muted">Next turf unlock</div><div className="truncate text-xs font-black text-text-primary">{nextArea.name}</div></div><div className="text-right text-[9px] font-black text-amber">Reach LV {nextArea.unlockLevel}</div></div>}</Panel>
        <Panel label="Numbers Up"><div className="grid grid-cols-2 gap-1.5">{(gainFeed.length ? gainFeed : [idleGainHint]).slice(0, 4).map((event) => { const color = getGainToneClass(event.tone); return <div key={event.id} className="flex items-center gap-1.5 border-2 border-border bg-bg/75 p-1.5" style={signClip}><span className={`h-2 w-2 rounded-full ${color.fill}`} /><div className="min-w-0 flex-1"><div className={`truncate text-[9px] font-black uppercase tracking-wide ${color.text}`}>{event.label}</div><div className="truncate text-[8px] text-text-muted">{event.detail}</div></div><Activity size={11} className="text-text-muted" /></div>; })}</div></Panel>
        <Panel label="Choose Turf"><div className="flex gap-1.5 overflow-x-auto pb-0.5">{ROAMING_AREAS.map((area) => { const unlocked = isRoamingAreaUnlocked(area, player.level); const selected = area.id === selectedArea.id; return <button type="button" key={area.id} disabled={!unlocked} onClick={() => idle.setSelectedRoamingArea(area.id)} className={`relative min-w-[116px] overflow-hidden border-2 px-2 py-1.5 text-left transition-transform active:scale-[0.98] ${selected ? 'border-amber/70 bg-amber/10' : 'border-border bg-bg/70'} ${!unlocked ? 'opacity-50' : ''}`} style={panelClip}><div className="flex items-start justify-between gap-1.5"><div className="min-w-0"><div className="truncate text-[11px] font-black text-text-primary">{area.name}</div><div className="text-[8px] uppercase tracking-wide text-text-muted">LV {area.unlockLevel} / {area.dangerRating}</div></div>{!unlocked && <Lock size={11} className="shrink-0 text-text-muted" />}{selected && <span className="h-2 w-2 shrink-0 rounded-full bg-amber animate-pulse" />}</div><div className="mt-0.5 truncate text-[8px] text-amber">{area.lootBias[0]}</div></button>; })}</div></Panel>
      </div>
    </div>
  );
};
