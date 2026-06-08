import React, { useEffect, useRef, useState } from 'react';
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
  useBossStore,
  useIdleStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
  useWorkshopStore,
} from '@/store';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS, getRoamingArea, isRoamingAreaUnlocked } from '@/constants/roamingAreas';

interface DashboardScreenProps {
  onNavigate: (screen: string) => void;
}

type Tone = 'amber' | 'green' | 'blue' | 'red' | 'purple' | 'cyan';
type GainTone = 'xp' | 'loot' | 'cash' | 'cache' | 'level';

type GainEvent = {
  id: string;
  label: string;
  detail: string;
  tone: GainTone;
};

type Snapshot = {
  level: number;
  xp: number;
  credits: number;
  scrap: number;
  cacheKeys: number;
  cacheKeyFragments: number;
  itemCount: number;
};

const TICK_SECONDS = 3;
const XP_PER_TICK = 1;
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

const gainToneClass: Record<GainTone, { text: string; bg: string; border: string; fill: string }> = {
  xp: { text: 'text-green', bg: 'bg-green/10', border: 'border-green/70', fill: 'bg-green' },
  loot: { text: 'text-amber', bg: 'bg-amber/10', border: 'border-amber/70', fill: 'bg-amber' },
  cash: { text: 'text-cyan', bg: 'bg-cyan/10', border: 'border-cyan/70', fill: 'bg-cyan' },
  cache: { text: 'text-blue-300', bg: 'bg-blue-500/10', border: 'border-blue-400/70', fill: 'bg-blue-400' },
  level: { text: 'text-red', bg: 'bg-red/10', border: 'border-red/70', fill: 'bg-red' },
};

const idleGainHint: GainEvent = {
  id: 'idle-loop-ready',
  label: '+0',
  detail: 'ready',
  tone: 'xp',
};

const compact = (value: number) => new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(value);

const makeGain = (label: string, detail: string, tone: GainTone): GainEvent => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  label,
  detail,
  tone,
});

const getXpDelta = (previous: Snapshot, current: Snapshot) => {
  if (current.level < previous.level) return 0;
  if (current.level === previous.level) return current.xp - previous.xp;

  let delta = previous.level * 100 - previous.xp;
  for (let level = previous.level + 1; level < current.level; level += 1) delta += level * 100;
  return delta + current.xp;
};

const Panel: React.FC<React.PropsWithChildren<{ label?: string; className?: string }>> = ({ label, className = '', children }) => (
  <section
    className={`relative overflow-hidden border-2 border-border bg-surface/95 p-2 shadow-[0_8px_18px_rgba(0,0,0,0.55)] ${className}`}
    style={panelClip}
  >
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

const HudChip: React.FC<{ label: string; value: string | number; detail: string; tone: Tone }> = ({ label, value, detail, tone }) => {
  const color = toneClass[tone];
  return (
    <div className="relative min-w-[82px] flex-1 overflow-hidden border-2 border-border bg-bg px-2 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={signClip}>
      <div className={`absolute left-0 top-0 h-full w-1.5 ${color.fill}`} />
      <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">{label}</div>
      <div className={`text-base font-black leading-none ${color.text}`}>{value}</div>
      <div className="truncate text-[8px] text-text-muted">{detail}</div>
    </div>
  );
};

const RewardIcon: React.FC<{ tone: GainTone }> = ({ tone }) => {
  const color = gainToneClass[tone];
  const Icon = tone === 'loot'
    ? PackageSearch
    : tone === 'cache'
      ? Box
      : tone === 'level'
        ? Trophy
        : tone === 'cash'
          ? Sparkles
          : Activity;

  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center border-2 border-border ${color.bg}`}>
      <Icon size={17} className={color.text} />
    </div>
  );
};

const GainToast: React.FC<{ event: GainEvent }> = ({ event }) => {
  const color = gainToneClass[event.tone];
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 14, scale: 0.9, rotate: -1 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
      exit={{ opacity: 0, y: 14, scale: 0.92 }}
      transition={{ duration: 0.14 }}
      className={`pointer-events-none inline-flex min-w-[112px] items-center gap-2 border-2 ${color.border} bg-bg px-2 py-1.5 shadow-[0_10px_22px_rgba(0,0,0,0.85)]`}
      style={signClip}
    >
      <div className={`absolute left-0 top-0 h-full w-1.5 ${color.fill}`} />
      <RewardIcon tone={event.tone} />
      <div className="min-w-0 leading-none">
        <div className={`text-base font-black uppercase tracking-wide ${color.text}`}>{event.label}</div>
        <div className="mt-0.5 truncate text-[8px] font-black uppercase tracking-[0.14em] text-text-muted">{event.detail}</div>
      </div>
    </motion.div>
  );
};

const ActionButton: React.FC<{
  label: string;
  desc: string;
  stat?: string;
  icon: React.ElementType;
  tone: Tone;
  primary?: boolean;
  onClick: () => void;
}> = ({ label, desc, stat, icon: Icon, tone, primary = false, onClick }) => {
  const color = toneClass[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative overflow-hidden border-2 text-left active:scale-[0.98] transition-transform ${
        primary ? `${color.border} ${color.bg}` : 'border-border bg-bg/80'
      }`}
      style={panelClip}
    >
      <div className={`absolute left-0 top-0 h-full w-1.5 ${color.fill}`} />
      <div className="relative flex min-h-[56px] items-center gap-2 p-2 pl-3">
        <div className={`flex h-9 w-9 shrink-0 -rotate-2 items-center justify-center border-2 border-border ${color.bg}`}>
          <Icon size={16} className={color.text} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-black uppercase tracking-wide text-text-primary">{label}</div>
            <ChevronRight size={14} className={`${color.text} opacity-75 group-active:translate-x-0.5 transition-transform`} />
          </div>
          <div className="text-[9px] leading-snug text-text-muted">{desc}</div>
          {stat && <div className={`mt-0.5 text-[9px] font-black ${color.text}`}>{stat}</div>}
        </div>
      </div>
    </button>
  );
};

const InfoGauge: React.FC<{ label: string; value: string | number; detail: string; icon: React.ElementType; tone: Tone }> = ({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}) => {
  const color = toneClass[tone];
  return (
    <div className="relative overflow-hidden border-2 border-border bg-bg/75 p-1.5" style={panelClip}>
      <div className="flex items-center gap-1.5">
        <div className={`flex h-7 w-7 shrink-0 items-center justify-center border-2 border-border ${color.bg}`}>
          <Icon size={14} className={color.text} />
        </div>
        <div className="min-w-0">
          <div className="text-[8px] uppercase tracking-wide text-text-muted">{label}</div>
          <div className="truncate text-xs font-black leading-tight text-text-primary">{value}</div>
        </div>
      </div>
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

  const [gainFeed, setGainFeed] = useState<GainEvent[]>([]);
  const previousSnapshotRef = useRef<Snapshot | null>(null);

  const currentBoss = boss.currentBossId ? REGION_1_BOSSES.find((b) => b.id === boss.currentBossId) : null;
  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const equippedCount = Object.values(loadout.slots).filter(Boolean).length;
  const spentSkillPoints = skills.getTotalSpent();
  const availableSkillPoints = Math.max(0, player.level - 1 - spentSkillPoints);
  const bestWeapon = [...inventory.getWeapons()].sort((a, b) => b.combatPower - a.combatPower)[0];
  const openWorkshopJobs = workshop.activeQueues.length;
  const xpToNextLevel = player.level * 100;
  const xpProgress = Math.min(100, Math.max(0, (player.xp / xpToNextLevel) * 100));
  const xpRemaining = Math.max(0, xpToNextLevel - player.xp);
  const nextArea = ROAMING_AREAS.find((area) => !isRoamingAreaUnlocked(area, player.level));
  const masteryScore = player.level * 100 + inventory.items.length * 5 + boss.defeatedBossIds.length * 50 + spentSkillPoints * 25;

  useEffect(() => {
    const snapshot: Snapshot = {
      level: player.level,
      xp: player.xp,
      credits: player.credits,
      scrap: player.scrap,
      cacheKeys: player.cacheKeys,
      cacheKeyFragments: player.cacheKeyFragments,
      itemCount: inventory.items.length,
    };
    const previous = previousSnapshotRef.current;
    previousSnapshotRef.current = snapshot;
    if (!previous) return;

    const events: GainEvent[] = [];
    const xpGain = getXpDelta(previous, snapshot);
    const creditsGain = snapshot.credits - previous.credits;
    const scrapGain = snapshot.scrap - previous.scrap;
    const keyGain = snapshot.cacheKeys - previous.cacheKeys;
    const fragmentGain = snapshot.cacheKeyFragments - previous.cacheKeyFragments;
    const lootGain = snapshot.itemCount - previous.itemCount;

    if (snapshot.level > previous.level) events.push(makeGain(`LV ${snapshot.level}`, 'level', 'level'));
    if (xpGain > 0) events.push(makeGain(`+${compact(xpGain)}`, 'XP', 'xp'));
    if (lootGain > 0) events.push(makeGain(`+${lootGain}`, 'gear', 'loot'));
    if (creditsGain > 0) events.push(makeGain(`+${compact(creditsGain)}`, 'credits', 'cash'));
    if (scrapGain > 0) events.push(makeGain(`+${compact(scrapGain)}`, 'scrap', 'cash'));
    if (keyGain > 0) events.push(makeGain(`+${keyGain}`, 'keys', 'cache'));
    if (fragmentGain > 0) events.push(makeGain(`+${fragmentGain}`, 'frags', 'cache'));

    if (!events.length) return;
    const eventIds = events.map((event) => event.id);
    setGainFeed((current) => [...events, ...current].slice(0, 5));

    const timeout = window.setTimeout(() => {
      setGainFeed((current) => current.filter((event) => !eventIds.includes(event.id)));
    }, 1050);

    return () => window.clearTimeout(timeout);
  }, [
    inventory.items.length,
    player.cacheKeyFragments,
    player.cacheKeys,
    player.credits,
    player.level,
    player.scrap,
    player.xp,
  ]);

  const actions = [
    { id: 'fight', label: 'Hit The Wastes', desc: 'Jump into the active badlands run.', icon: Crosshair, tone: 'red' as Tone, stat: `+${XP_PER_TICK} XP / ${TICK_SECONDS}s`, primary: true },
    { id: 'inventory', label: 'Loadout Bench', desc: 'Equip, compare, and tune gear.', icon: Backpack, tone: 'amber' as Tone, stat: `${equippedCount}/7 equipped`, primary: true },
    { id: 'chest', label: 'Crack Cache', desc: 'Spend keys for server-rolled gear.', icon: Box, tone: 'green' as Tone, stat: `${player.cacheKeys} keys` },
    { id: 'mastery', label: 'Mastery', desc: 'Spend points and build identity.', icon: Trophy, tone: 'purple' as Tone, stat: `${availableSkillPoints} pts ready` },
    { id: 'workshop', label: 'Workshop', desc: 'Craft, fuse, repair, and queue jobs.', icon: Hammer, tone: 'blue' as Tone, stat: `${openWorkshopJobs} active` },
    { id: 'market', label: 'Market', desc: 'Browse listings and economy systems.', icon: BarChart3, tone: 'cyan' as Tone, stat: 'Trade hub' },
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

      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute left-5 top-20 h-48 w-48 rounded-full bg-amber/10 blur-3xl" />
        <div className="absolute right-2 top-72 h-48 w-48 rounded-full bg-red/10 blur-3xl" />
      </div>

      <div className="relative space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="bl-title text-3xl leading-none text-text-primary">Bounty Board</div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-text-muted">Badlands run / loot pops / level climb</div>
          </div>
          <div className="flex h-10 w-10 shrink-0 -rotate-2 items-center justify-center border-2 border-border bg-amber/15 shadow-[4px_4px_0_rgba(0,0,0,0.7)]">
            <Crosshair size={20} className="text-amber" />
          </div>
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          <HudChip label="Cash" value={compact(player.credits)} detail="credits" tone="cyan" />
          <HudChip label="Scrap" value={compact(player.scrap)} detail="bench" tone="amber" />
          <HudChip label="Keys" value={player.cacheKeys} detail={`${player.cacheKeyFragments}/5 frags`} tone="green" />
          <HudChip label="Loot" value={inventory.items.length} detail={`${equippedCount}/7 equip`} tone="red" />
        </div>

        <Panel label="Level Strip">
          <div className="flex items-center gap-2">
            <div className="relative flex h-16 w-16 shrink-0 -rotate-2 items-center justify-center border-4 border-border bg-amber/15 shadow-[5px_5px_0_rgba(0,0,0,0.75)]">
              <div className="absolute inset-1 border border-amber/40" />
              <div className="text-center">
                <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">Level</div>
                <div className="text-3xl font-black leading-none text-amber">{player.level}</div>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-sm font-black uppercase tracking-wide text-text-primary">XP Chalk Mark</div>
                  <div className="text-[9px] text-text-muted">
                    {player.xp.toLocaleString()} / {xpToNextLevel.toLocaleString()} XP · {xpRemaining.toLocaleString()} left
                  </div>
                </div>
                <div className="text-right text-[9px] font-black text-green">+{XP_PER_TICK}/tick</div>
              </div>
              <div className="relative mt-1.5 h-4 overflow-hidden border-2 border-border bg-bg" style={signClip}>
                <motion.div
                  className="h-full bg-green shadow-[0_0_12px_rgba(124,252,0,0.25)]"
                  initial={false}
                  animate={{ width: `${xpProgress}%` }}
                  transition={{ type: 'spring', stiffness: 90, damping: 18 }}
                />
                <div className="absolute inset-0 grid grid-cols-5">
                  {Array.from({ length: 5 }).map((_, index) => <span key={index} className="border-l border-bg/70 first:border-l-0" />)}
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-[8px] uppercase tracking-wide text-text-muted">
                <span>{TICK_SECONDS}.00s tick</span>
                <span>{FIELD_FIND_CHANCE}% loot</span>
                <span>{CACHE_FRAGMENT_CHANCE}% frag</span>
              </div>
            </div>
          </div>
        </Panel>

        <div className="relative h-[218px] overflow-hidden border-2 border-border bg-bg shadow-[0_10px_22px_rgba(0,0,0,0.6)]" style={panelClip}>
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(160deg,rgba(255,144,0,0.23),rgba(108,45,16,0.7) 38%,rgba(5,6,8,0.96) 100%)',
            }}
          />
          <div className="absolute left-0 right-0 top-0 h-5 border-b-2 border-border bg-red/35" />
          <div className="absolute bottom-8 left-0 right-0 h-8 -rotate-2 bg-amber/15" />
          <div className="relative flex h-full flex-col">
            <div className="border-b-2 border-border bg-surface/85 px-3 py-2 text-center">
              <div className="bl-title text-3xl leading-none text-text-primary">{currentBoss?.name ?? selectedArea.name}</div>
              <div className="text-[9px] uppercase tracking-[0.2em] text-text-muted">{currentBoss ? 'Marked boss' : 'Current turf'}</div>
            </div>
            <div className="flex flex-1 items-center justify-center">
              <motion.div className="relative flex h-24 w-28 -rotate-2 items-center justify-center" animate={{ y: [0, -3, 0] }} transition={{ repeat: Infinity, duration: 2.6, ease: 'easeInOut' }}>
                <div className="absolute h-20 w-24 rotate-3 border-4 border-border bg-surface shadow-[6px_6px_0_rgba(0,0,0,0.7)]" />
                <div className="absolute h-14 w-18 -rotate-6 border-2 border-amber/50 bg-bg/80" />
                <PackageSearch size={32} className="relative text-amber" />
              </motion.div>
            </div>
            <div className="grid grid-cols-2 border-t-2 border-border bg-surface/90 text-[9px]">
              <button type="button" onClick={() => onNavigate('fight')} className="border-r border-border px-3 py-2 text-left active:bg-red/10">
                <div className="font-black uppercase tracking-wide text-red">Start run</div>
                <div className="text-text-muted">{selectedArea.enemyType}</div>
              </button>
              <button type="button" onClick={() => onNavigate(currentBoss ? 'fight' : 'chest')} className="px-3 py-2 text-left active:bg-amber/10">
                <div className="font-black uppercase tracking-wide text-amber">{currentBoss ? 'Prep boss' : 'Open cache'}</div>
                <div className="text-text-muted">{currentBoss ? `${currentBoss.weaknesses.length} weakness tags` : `${player.cacheKeys} keys ready`}</div>
              </button>
            </div>
          </div>
        </div>

        <Panel label="Action Board" className="space-y-2">
          <div className="grid grid-cols-1 gap-1.5">
            {actions.slice(0, 2).map((action) => <ActionButton key={action.id} {...action} onClick={() => onNavigate(action.id)} />)}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {actions.slice(2).map((action) => <ActionButton key={action.id} {...action} onClick={() => onNavigate(action.id)} />)}
          </div>
        </Panel>

        <Panel label="Hunter Notes">
          <div className="grid grid-cols-2 gap-1.5">
            <InfoGauge label="Turf" value={selectedArea.manufacturerInfluence} detail={selectedArea.dangerRating} icon={Map} tone="amber" />
            <InfoGauge label="Mastery" value={masteryScore.toLocaleString()} detail={`${availableSkillPoints} unspent points`} icon={Trophy} tone="purple" />
            <InfoGauge label="Best Gun" value={bestWeapon?.name ?? 'None'} detail={bestWeapon ? `${bestWeapon.combatPower} combat power` : 'Find gear in combat'} icon={Sparkles} tone="red" />
            <InfoGauge label="Workshop" value={openWorkshopJobs} detail="active queues" icon={Hammer} tone="green" />
          </div>

          {nextArea && (
            <div className="mt-2 flex items-center gap-2 border-2 border-border bg-bg/75 p-1.5" style={panelClip}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-border bg-surface-raised">
                <Lock size={14} className="text-text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-black uppercase tracking-wide text-text-muted">Next turf unlock</div>
                <div className="truncate text-xs font-black text-text-primary">{nextArea.name}</div>
              </div>
              <div className="text-right text-[9px] font-black text-amber">Reach LV {nextArea.unlockLevel}</div>
            </div>
          )}
        </Panel>

        <Panel label="Numbers Up">
          <div className="grid grid-cols-2 gap-1.5">
            {(gainFeed.length ? gainFeed : [idleGainHint]).slice(0, 4).map((event) => {
              const color = gainToneClass[event.tone];
              return (
                <div key={event.id} className="flex items-center gap-1.5 border-2 border-border bg-bg/75 p-1.5" style={signClip}>
                  <span className={`h-2 w-2 rounded-full ${color.fill}`} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-[9px] font-black uppercase tracking-wide ${color.text}`}>{event.label}</div>
                    <div className="truncate text-[8px] text-text-muted">{event.detail}</div>
                  </div>
                  <Activity size={11} className="text-text-muted" />
                </div>
              );
            })}
          </div>
        </Panel>

        <Panel label="Choose Turf">
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {ROAMING_AREAS.map((area) => {
              const unlocked = isRoamingAreaUnlocked(area, player.level);
              const selected = area.id === selectedArea.id;
              return (
                <button
                  type="button"
                  key={area.id}
                  disabled={!unlocked}
                  onClick={() => idle.setSelectedRoamingArea(area.id)}
                  className={`relative min-w-[116px] overflow-hidden border-2 px-2 py-1.5 text-left active:scale-[0.98] transition-transform ${selected ? 'border-amber/70 bg-amber/10' : 'border-border bg-bg/70'} ${!unlocked ? 'opacity-50' : ''}`}
                  style={panelClip}
                >
                  <div className="flex items-start justify-between gap-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-black text-text-primary">{area.name}</div>
                      <div className="text-[8px] uppercase tracking-wide text-text-muted">LV {area.unlockLevel} / {area.dangerRating}</div>
                    </div>
                    {!unlocked && <Lock size={11} className="shrink-0 text-text-muted" />}
                    {selected && <span className="h-2 w-2 shrink-0 rounded-full bg-amber animate-pulse" />}
                  </div>
                  <div className="mt-0.5 truncate text-[8px] text-amber">{area.lootBias[0]}</div>
                </button>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
};
