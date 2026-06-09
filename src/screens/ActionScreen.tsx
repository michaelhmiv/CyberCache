import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Activity,
  Boxes,
  ChevronRight,
  Clock,
  Crosshair,
  Hammer,
  MapPin,
  Package,
  Radar,
  Recycle,
  ShoppingCart,
  Skull,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import {
  useActivityStore,
  useBossStore,
  useIdleStore,
  useInventoryStore,
  useLoadoutStore,
  usePlayerStore,
  useSkillStore,
} from '@/store';
import { BossPrepModal } from '@/components/fight/BossPrepModal';
import { MobileCard } from '@/components/layout/MobileCard';
import { REGION_1_BOSSES } from '@/constants/bosses';
import {
  ROAMING_AREAS,
  buildAreaWeaponDropOptions,
  getRoamingArea,
  isRoamingAreaUnlocked,
  rollAreaDropKind,
  rollAreaMaterialFind,
} from '@/constants/roamingAreas';
import {
  buildBossPrepActivity,
  buildCraftingActivity,
  buildRoamingLootActivity,
  buildSalvagingActivity,
} from '@/lib/activity/activityBuilders';
import { makeRunEvent, sortRunEventsByVisualPriority, type RunVisualEvent } from '@/lib/run/runEvents';
import type { ActivityKind, StartActivityInput } from '@/types/activity';
import type { GearItem, Weapon } from '@/types/items';

const TICK_SECONDS = 3;
const LOG_LIMIT = 8;
const DROP_CHANCE_PER_TICK = 0.22;
const CACHE_FRAGMENT_CHANCE_PER_TICK = 0.03;
const MATERIAL_FIND_CHANCE_PER_TICK = 0.08;

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };

const actionCopy: Record<ActivityKind, { title: string; detail: string; scene: string }> = {
  none: { title: 'No Action', detail: 'Choose what the runner should do next.', scene: 'camp idle' },
  idle_standby: { title: 'Standby', detail: 'Runner is visible but not producing rewards.', scene: 'camp idle' },
  roaming_loot: { title: 'Roaming Loot', detail: 'Sweeping turf for XP, credits, scrap, gear, materials, and cache fragments.', scene: 'turf sweep' },
  boss_prep: { title: 'Boss Prep', detail: 'Checking weaknesses, counters, and loadout readiness before a discrete fight.', scene: 'prep board' },
  boss_fight: { title: 'Boss Fight', detail: 'Resolving a focused boss encounter instead of the passive roaming loop.', scene: 'boss arena' },
  crafting: { title: 'Crafting', detail: 'Working at the bench to build or modify gear.', scene: 'workbench' },
  salvaging: { title: 'Salvaging', detail: 'Breaking items into scrap, materials, or essences.', scene: 'scrap grinder' },
  workshop_service: { title: 'Workshop Service', detail: 'Maintaining machines, queues, and production outputs.', scene: 'service bay' },
  market_listing: { title: 'Market Listing', detail: 'Posting or managing gear at the trade kiosk.', scene: 'trade kiosk' },
};

const describeGear = (item: GearItem) => {
  if ('weaponType' in item) return `${item.rarity} ${item.weaponType}`;
  if ('hp' in item) return `${item.rarity} Shield`;
  if ('treeBonus' in item) return `${item.rarity} Class Mod`;
  if ('damage' in item) return `${item.rarity} Ordnance`;
  return `${item.rarity} Relic`;
};

const ActionStage: React.FC<{
  kind: ActivityKind;
  target: string;
  latest?: RunVisualEvent;
  active: boolean;
}> = ({ kind, target, latest, active }) => {
  const copy = actionCopy[kind];
  const combat = kind === 'roaming_loot' || kind === 'boss_fight';
  const bench = kind === 'crafting' || kind === 'salvaging' || kind === 'workshop_service';
  const market = kind === 'market_listing';
  const prep = kind === 'boss_prep';
  const pulseKey = latest?.id ?? kind;

  return (
    <section className="relative h-[238px] overflow-hidden border-2 border-border bg-bg shadow-[0_10px_22px_rgba(0,0,0,0.6)]" style={panelClip}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(255,208,64,0.2),transparent_28%),radial-gradient(circle_at_82%_10%,rgba(255,64,64,0.16),transparent_26%),linear-gradient(180deg,#1a1720_0%,#08090d_55%,#12100d_100%)]" />
      <div className="absolute left-4 right-4 top-4 z-10 flex items-start justify-between gap-3">
        <div className="min-w-0 border-2 border-border bg-surface/90 px-3 py-2 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={panelClip}>
          <div className="bl-title truncate text-2xl leading-none text-text-primary">{copy.title}</div>
          <div className="truncate text-[8px] font-black uppercase tracking-[0.18em] text-text-muted">{target}</div>
        </div>
        <div className="shrink-0 border-2 border-border bg-bg/85 px-2 py-1 text-right shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={panelClip}>
          <div className="text-[8px] font-black uppercase tracking-widest text-text-muted">Scene</div>
          <div className="text-[10px] font-black text-amber">{copy.scene}</div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[72px] border-t-2 border-border bg-[linear-gradient(90deg,#211916,#36271d,#171417)]" />
      <motion.div
        key={`runner-${pulseKey}`}
        className="absolute bottom-[52px] left-[72px] h-20 w-20 border-[5px] border-black bg-amber shadow-[7px_7px_0_rgba(0,0,0,0.58)]"
        style={{ clipPath: 'polygon(18% 0,82% 0,100% 30%,82% 100%,18% 100%,0 30%)' }}
        animate={active ? { y: [0, combat ? -7 : -3, 0], rotate: [0, combat ? -4 : 2, 0] } : { y: 0, rotate: 0 }}
        transition={{ duration: 0.55, ease: 'easeOut' }}
      >
        <div className="absolute left-4 top-3 h-3 w-11 bg-black" />
        <div className="absolute bottom-2 left-5 h-5 w-8 border-2 border-black bg-bg/70" />
      </motion.div>

      {combat && (
        <>
          <motion.div
            key={`target-${pulseKey}`}
            className="absolute bottom-[62px] right-[54px] h-24 w-24 border-[6px] border-black bg-red shadow-[7px_7px_0_rgba(0,0,0,0.58)]"
            style={{ clipPath: 'polygon(50% 0,86% 18%,100% 55%,76% 100%,24% 100%,0 55%,14% 18%)' }}
            animate={active ? { x: [0, 10, 0], scale: [1, 0.96, 1] } : { x: 0 }}
            transition={{ duration: 0.45 }}
          />
          {active && <motion.div className="absolute bottom-[122px] left-[145px] h-2 w-[128px] bg-amber shadow-[0_0_12px_rgba(255,208,64,0.8)]" initial={{ opacity: 0, x: -8 }} animate={{ opacity: [0, 1, 0], x: [0, 32, 60] }} transition={{ duration: 0.45 }} />}
        </>
      )}

      {prep && <motion.div key={`prep-${pulseKey}`} className="absolute bottom-[62px] right-[58px] h-28 w-32 border-[5px] border-black bg-surface shadow-[7px_7px_0_rgba(0,0,0,0.58)]" animate={active ? { opacity: [0.78, 1, 0.9] } : { opacity: 0.9 }}><div className="m-3 space-y-2"><div className="h-2 bg-red" /><div className="h-2 bg-green" /><div className="h-2 bg-amber" /><div className="h-2 bg-text-muted" /></div></motion.div>}
      {bench && <motion.div key={`bench-${pulseKey}`} className="absolute bottom-[58px] right-[64px] h-20 w-36 border-[5px] border-black bg-surface shadow-[7px_7px_0_rgba(0,0,0,0.58)]" animate={active ? { y: [0, -3, 0] } : { y: 0 }}><div className="absolute left-4 top-4 h-4 w-20 bg-amber/70" /><div className="absolute bottom-3 left-7 h-3 w-24 bg-black/60" />{active && <Sparkles className="absolute right-4 top-4 text-amber" size={22} />}</motion.div>}
      {market && <motion.div key={`market-${pulseKey}`} className="absolute bottom-[58px] right-[70px] h-28 w-28 border-[5px] border-black bg-cyan/80 shadow-[7px_7px_0_rgba(0,0,0,0.58)]" animate={active ? { scale: [1, 1.04, 1] } : { scale: 1 }}><div className="m-4 h-5 bg-bg" /><div className="mx-4 mt-3 h-3 bg-amber" /><div className="mx-4 mt-2 h-3 bg-bg/80" /></motion.div>}

      <div className="absolute bottom-3 left-3 right-3 z-10 grid grid-cols-[1fr_auto] gap-2">
        <div className="min-w-0 border-2 border-border bg-bg/88 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={panelClip}>
          <div className="truncate text-[9px] font-black uppercase tracking-wide text-text-primary">{latest?.label ?? 'Awaiting event'}</div>
          <div className="truncate text-[8px] text-text-muted">{latest?.detail ?? copy.detail}</div>
        </div>
        <div className="flex items-center gap-1.5 border-2 border-border bg-surface/90 px-2 py-1.5 shadow-[4px_4px_0_rgba(0,0,0,0.62)]" style={panelClip}>
          {active ? <Sparkles size={13} className="text-amber" /> : <Activity size={13} className="text-text-muted" />}
          <div>
            <div className="text-[8px] font-black uppercase tracking-wide text-text-muted">Status</div>
            <div className="max-w-[78px] truncate text-[9px] font-black text-red">{active ? 'Live beat' : 'Ready'}</div>
          </div>
        </div>
      </div>
    </section>
  );
};

const ActionCard: React.FC<{
  title: string;
  detail: string;
  active: boolean;
  disabled?: boolean;
  icon: React.ElementType;
  onClick: () => void;
}> = ({ title, detail, active, disabled, icon: Icon, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`min-h-[104px] border-2 p-3 text-left shadow-[4px_4px_0_rgba(0,0,0,0.45)] transition-transform active:scale-[0.98] disabled:opacity-50 ${active ? 'border-amber bg-amber/12' : 'border-border bg-surface'}`}
    style={panelClip}
  >
    <div className="flex items-start justify-between gap-2">
      <Icon size={18} className={active ? 'text-amber' : 'text-text-muted'} />
      <span className={`text-[8px] font-black uppercase tracking-widest ${active ? 'text-amber' : 'text-text-muted'}`}>{active ? 'Active' : disabled ? 'Blocked' : 'Switch'}</span>
    </div>
    <div className="mt-2 text-sm font-black text-text-primary">{title}</div>
    <div className="mt-1 text-[10px] leading-snug text-text-muted">{detail}</div>
  </button>
);

const FeedCard: React.FC<{ event: RunVisualEvent }> = ({ event }) => {
  const dot = event.tone === 'loot' ? 'bg-amber' : event.tone === 'cache' ? 'bg-blue-400' : event.tone === 'cash' ? 'bg-cyan' : event.tone === 'level' ? 'bg-red' : event.tone === 'xp' ? 'bg-green' : 'bg-text-muted';
  return (
    <div className="flex items-start gap-2 border border-border bg-surface-raised p-2">
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 ${dot}`} />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-black uppercase tracking-wide text-text-primary">{event.label}</div>
        <div className="text-[10px] leading-snug text-text-muted">{event.detail}</div>
      </div>
    </div>
  );
};

export const ActionScreen: React.FC<{ onOpenBossSelect: () => void; onNavigate?: (screen: string) => void }> = ({ onOpenBossSelect, onNavigate }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const loadoutStore = useLoadoutStore();
  const idle = useIdleStore();
  const activity = useActivityStore();
  const skillStore = useSkillStore();
  const skillBonuses = skillStore.getBonuses();
  const [showAreaSelect, setShowAreaSelect] = useState(false);
  const [prepBoss, setPrepBoss] = useState<(typeof REGION_1_BOSSES)[0] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [feed, setFeed] = useState<RunVisualEvent[]>([
    makeRunEvent('ACTION READY', 'Choose one current action. The scene shows what the runner is actually doing.', 'patrol', 'idle'),
  ]);
  const prevLevelRef = useRef(player.level);

  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const currentKind = activity.current.kind;
  const currentBossId = bossStore.currentBossId;
  const currentBoss = currentBossId ? REGION_1_BOSSES.find((b) => b.id === currentBossId) : null;
  const prepBossTarget = currentBoss ?? REGION_1_BOSSES.find((b) => bossStore.unlockedBossIds.includes(b.id) && !bossStore.defeatedBossIds.includes(b.id)) ?? null;
  const bestBossWeapon = useMemo(() => inventory.getWeapons().sort((a, b) => b.bossPower - a.bossPower)[0], [inventory]);
  const activityWeapon: Weapon | undefined = loadoutStore.getWeapon('primary') ?? loadoutStore.getWeapon('secondary') ?? loadoutStore.getWeapon('heavy') ?? bestBossWeapon;
  const firstSalvageItem = inventory.items[0];
  const isRoamingActivity = currentKind === 'roaming_loot';
  const activeRoamingAreaId = activity.current.targetType === 'roaming_area' ? activity.current.targetId : null;
  const canRunRoamingTick = isRoamingActivity && activeRoamingAreaId === selectedArea.id && !activity.pending;
  const activeMinutes = Math.floor((elapsed * TICK_SECONDS) / 60);
  const activeSeconds = (elapsed * TICK_SECONDS) % 60;
  const creditsPerTick = Math.round((selectedArea.idleCreditsPerMinute / 20) * (1 + (skillBonuses.offlineEarnings || 0)));
  const scrapPerTick = Math.round((selectedArea.idleScrapPerMinute / 20) * (1 + (skillBonuses.scrapYield || 0)));
  const targetLabel = activity.current.targetLabel ?? (currentKind === 'idle_standby' ? 'No target selected' : selectedArea.name);

  const pushEvents = useCallback((events: RunVisualEvent[]) => {
    setFeed((current) => [...sortRunEventsByVisualPriority(events), ...current].slice(0, LOG_LIMIT));
  }, []);

  const startActivity = useCallback(async (input: StartActivityInput, startedEvent: RunVisualEvent) => {
    try {
      await activity.start(input);
      idle.setFarming(input.kind === 'roaming_loot');
      setElapsed(0);
      pushEvents([startedEvent]);
    } catch (error) {
      pushEvents([makeRunEvent('ACTION FAILED', error instanceof Error ? error.message : 'The action service rejected the transition.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  const startRoam = useCallback(() => {
    startActivity(
      buildRoamingLootActivity(selectedArea, activityWeapon),
      makeRunEvent('ROAM STARTED', `${selectedArea.name} is now the current action.`, 'patrol', 'run_started'),
    );
  }, [activityWeapon, selectedArea, startActivity]);

  const startBossPrep = useCallback(() => {
    if (!prepBossTarget) {
      onOpenBossSelect();
      return;
    }
    startActivity(
      buildBossPrepActivity(prepBossTarget, activityWeapon),
      makeRunEvent('BOSS PREP', `${prepBossTarget.name} is now the current action.`, 'patrol', 'boss_prep'),
    );
    setPrepBoss(prepBossTarget);
  }, [activityWeapon, onOpenBossSelect, prepBossTarget, startActivity]);

  const startCraft = useCallback(() => {
    startActivity(
      buildCraftingActivity({ id: 'workshop-crafting', name: 'Workbench Crafting', category: 'gear' }, null),
      makeRunEvent('CRAFTING', 'Workbench crafting is now the visible character action.', 'patrol', 'crafting'),
    );
    onNavigate?.('workshop');
  }, [onNavigate, startActivity]);

  const startSalvage = useCallback(() => {
    if (!firstSalvageItem) {
      onNavigate?.('loot');
      pushEvents([makeRunEvent('NO GEAR', 'No gear is available to salvage yet. Open Loot after collecting drops.', 'patrol', 'idle')]);
      return;
    }
    startActivity(
      buildSalvagingActivity(firstSalvageItem),
      makeRunEvent('SALVAGING', `${firstSalvageItem.name} is now queued as the visible salvage action.`, 'patrol', 'salvaging'),
    );
  }, [firstSalvageItem, onNavigate, pushEvents, startActivity]);

  const startWorkshop = useCallback(() => {
    startActivity({
      kind: 'workshop_service',
      targetType: 'workshop_job',
      targetId: 'workshop-service',
      targetLabel: 'Workshop Service',
      sceneKey: 'workshop:service',
      notes: 'Servicing workshop queues',
      publicPayload: { activity_label: 'Servicing Workshop', target_label: 'Workshop Service', scene_key: 'workshop:service' },
      publicVisible: true,
    }, makeRunEvent('WORKSHOP SERVICE', 'Runner is servicing workshop machines and queues.', 'patrol', 'crafting'));
    onNavigate?.('workshop');
  }, [onNavigate, startActivity]);

  const startMarket = useCallback(() => {
    startActivity({
      kind: 'market_listing',
      targetType: 'market_listing',
      targetId: 'market-console',
      targetLabel: 'Trade Kiosk',
      sceneKey: 'market:kiosk',
      notes: 'Managing market listings',
      publicPayload: { activity_label: 'Managing Market Listings', target_label: 'Trade Kiosk', scene_key: 'market:kiosk' },
      publicVisible: true,
    }, makeRunEvent('MARKET LISTING', 'Runner is working the trade kiosk.', 'patrol', 'market_listing'));
    onNavigate?.('market');
  }, [onNavigate, startActivity]);

  const stopAction = useCallback(async () => {
    try {
      await activity.clear();
      idle.setFarming(false);
      pushEvents([makeRunEvent('ACTION STOPPED', 'Runner returned to standby. Productive action visuals are paused.', 'patrol', 'run_stopped')]);
    } catch (error) {
      pushEvents([makeRunEvent('STOP FAILED', error instanceof Error ? error.message : 'The action service rejected the stop request.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  const createRoamingDrop = useCallback(() => {
    const kind = rollAreaDropKind(selectedArea);
    let item: GearItem;
    if (kind === 'weapon') item = inventory.generateAndAdd(buildAreaWeaponDropOptions(selectedArea, player.level));
    else if (kind === 'shield') item = inventory.generateAndAddShield(player.level);
    else if (kind === 'classMod') item = inventory.generateAndAddClassMod(player.level);
    else if (kind === 'relic') item = inventory.generateAndAddRelic(player.level);
    else item = inventory.generateAndAddOrdnance(player.level);
    return item;
  }, [inventory, player.level, selectedArea]);

  useEffect(() => {
    if (player.level > prevLevelRef.current) {
      pushEvents([makeRunEvent(`LEVEL ${player.level}`, 'XP crossed the next level threshold.', 'level', 'level_up')]);
    }
    prevLevelRef.current = player.level;
  }, [player.level, pushEvents]);

  useEffect(() => {
    if (!canRunRoamingTick) return undefined;
    const iv = window.setInterval(() => {
      setElapsed((e) => e + 1);
      const events: RunVisualEvent[] = [];
      const dropped = Math.random() < DROP_CHANCE_PER_TICK ? createRoamingDrop() : null;
      const cacheFound = Math.random() < CACHE_FRAGMENT_CHANCE_PER_TICK;
      const materialFound = Math.random() < MATERIAL_FIND_CHANCE_PER_TICK;

      if (cacheFound) {
        player.addCacheKeyFragments(1);
        events.push(makeRunEvent('CACHE FRAGMENT', `${selectedArea.enemyType} patrol yielded a cache key fragment.`, 'cache', 'cache_fragment'));
      }
      if (dropped) {
        events.push(makeRunEvent('GEAR DROP', `${dropped.name} (${describeGear(dropped)}) dropped in ${selectedArea.name}.`, 'loot', 'gear_drop'));
      }
      if (!dropped && !cacheFound && materialFound) {
        const find = rollAreaMaterialFind(selectedArea);
        if (find?.kind === 'material') {
          player.addMaterial(find.type, 1);
          events.push(makeRunEvent('MATERIAL FIND', `${find.type} recovered while sweeping ${selectedArea.name}.`, 'loot', 'material_find'));
        }
        if (find?.kind === 'essence') {
          player.addEssence(find.type, 1);
          events.push(makeRunEvent('ESSENCE FIND', `${find.type} essence recovered while sweeping ${selectedArea.name}.`, 'loot', 'material_find'));
        }
      }
      player.addCredits(creditsPerTick);
      player.addScrap(scrapPerTick);
      player.addXP(1);
      if (!events.length) events.push(makeRunEvent('ENEMY SWEEP', `${selectedArea.enemyType} routed. +1 XP / +${creditsPerTick}cr / +${scrapPerTick} scrap.`, 'xp', 'enemy_sweep'));
      pushEvents(events);
    }, TICK_SECONDS * 1000);
    return () => window.clearInterval(iv);
  }, [canRunRoamingTick, createRoamingDrop, creditsPerTick, player, pushEvents, scrapPerTick, selectedArea]);

  useEffect(() => {
    if (!canRunRoamingTick) return undefined;
    const iv = window.setInterval(() => {
      activity.heartbeat().catch((error) => console.warn('Action heartbeat skipped:', error));
    }, 60000);
    return () => window.clearInterval(iv);
  }, [activity, canRunRoamingTick]);

  const detail = actionCopy[currentKind] ?? actionCopy.idle_standby;

  return (
    <div className="bl-page space-y-3 p-3 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Action</div>
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-text-muted">choose one current runner action</div>
        </div>
        <button type="button" onClick={stopAction} disabled={activity.pending || currentKind === 'idle_standby' || currentKind === 'none'} className="bl-secondary px-3 py-2 text-[10px] font-black text-red disabled:opacity-50">Stop</button>
      </div>

      <ActionStage kind={currentKind} target={targetLabel} latest={feed[0]} active={canRunRoamingTick || activity.pending} />

      <MobileCard className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-amber">Current Action</div>
            <div className="text-lg font-black text-text-primary">{detail.title}</div>
            <div className="text-xs leading-relaxed text-text-muted">{detail.detail}</div>
          </div>
          <div className="text-right text-[10px] text-text-muted"><Clock size={16} className="ml-auto" />{activeMinutes}m {activeSeconds}s</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
          <div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Target</div><div className="truncate font-bold text-text-primary">{targetLabel}</div></div>
          <div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Keys</div><div className="font-bold text-amber">{player.cacheKeys} +{player.cacheKeyFragments}/5</div></div>
          <div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Tick</div><div className="font-bold text-text-primary">{canRunRoamingTick ? `${TICK_SECONDS}s live` : 'paused'}</div></div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-black uppercase tracking-widest text-text-muted">Choose Action</div>
          <button type="button" onClick={() => setShowAreaSelect(true)} className="flex items-center gap-1 text-[10px] font-bold text-amber"><MapPin size={12} />Turf</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ActionCard title="Roam" detail={`${selectedArea.name}: loot, XP, scrap, credits, materials, and cache fragments.`} active={currentKind === 'roaming_loot'} icon={Radar} onClick={startRoam} />
          <ActionCard title="Boss Prep" detail={prepBossTarget ? `Prepare counters for ${prepBossTarget.name}.` : 'Choose a boss target first.'} active={currentKind === 'boss_prep'} icon={Skull} onClick={startBossPrep} />
          <ActionCard title="Boss Fight" detail="Open the boss resolver and replay the encounter beats." active={currentKind === 'boss_fight'} icon={Crosshair} onClick={() => { if (prepBossTarget) setPrepBoss(prepBossTarget); else onOpenBossSelect(); }} />
          <ActionCard title="Craft" detail="Move to the workbench and show crafting as the visible action." active={currentKind === 'crafting'} icon={Hammer} onClick={startCraft} />
          <ActionCard title="Salvage" detail="Break gear into scrap, materials, and essences." active={currentKind === 'salvaging'} icon={Recycle} onClick={startSalvage} />
          <ActionCard title="Workshop" detail="Service machines, jobs, and production queues." active={currentKind === 'workshop_service'} icon={Wrench} onClick={startWorkshop} />
          <ActionCard title="Market" detail="Manage listings at the trade kiosk." active={currentKind === 'market_listing'} icon={ShoppingCart} onClick={startMarket} />
          <ActionCard title="Caches" detail="Open cache keys without pretending it is combat." active={false} icon={Package} onClick={() => onNavigate?.('chest')} />
        </div>
      </MobileCard>

      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-text-muted"><Activity size={14} />Action Feed</div>
        <div className="space-y-2">{feed.map((event) => <FeedCard key={event.id} event={event} />)}</div>
      </MobileCard>

      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-text-muted"><Boxes size={14} />Action Detail</div>
        {currentKind === 'roaming_loot' && <div className="text-xs leading-relaxed text-text-muted">Roaming is the only passive reward producer here. It ticks every {TICK_SECONDS}s while the selected turf is active: +1 XP, +{creditsPerTick} credits, +{scrapPerTick} scrap, with independent chances for gear, cache fragments, materials, and essences.</div>}
        {currentKind === 'boss_prep' && <div className="text-xs leading-relaxed text-text-muted">Boss prep should look like planning, not attacking. Use this state to show weaknesses, counter gear, warnings, and readiness before resolving the actual boss fight.</div>}
        {currentKind === 'boss_fight' && <div className="text-xs leading-relaxed text-text-muted">Boss fight is a discrete encounter. It should replay phase beats and final victory/defeat instead of using the roaming tick loop.</div>}
        {currentKind === 'crafting' && <div className="text-xs leading-relaxed text-text-muted">Crafting uses bench visuals: materials in, sparks/tools, result out. Manage the actual recipe in the Workshop screen.</div>}
        {currentKind === 'salvaging' && <div className="text-xs leading-relaxed text-text-muted">Salvaging uses breakdown visuals: item in, grinder/cutter, scrap/materials/essences out. Auto-salvage from roaming should map to this same visual language.</div>}
        {currentKind === 'workshop_service' && <div className="text-xs leading-relaxed text-text-muted">Workshop service is machine maintenance and queue management. It should not look like crafting or combat.</div>}
        {currentKind === 'market_listing' && <div className="text-xs leading-relaxed text-text-muted">Market listing is a trade-kiosk action: scan item, stamp price, post listing, sale/expiry signal.</div>}
        {(currentKind === 'idle_standby' || currentKind === 'none') && <div className="text-xs leading-relaxed text-text-muted">No productive action is active. Pick one action above to make the character state visible across the game.</div>}
      </MobileCard>

      <AnimatePresence>{showAreaSelect && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 overflow-y-auto bg-bg/90 p-4 backdrop-blur-sm"><div className="mx-auto max-w-lg space-y-3 pb-10"><div className="sticky top-0 flex items-center justify-between bg-bg/95 py-2"><div><div className="text-xs font-bold uppercase tracking-wider text-amber">Select Roaming Area</div><div className="text-[10px] text-text-muted">Changing turf does not produce rewards until Roam is started or switched.</div></div><button onClick={() => setShowAreaSelect(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-raised text-text-primary" aria-label="Close area selector"><X size={16} /></button></div>{ROAMING_AREAS.map((area) => { const unlocked = isRoamingAreaUnlocked(area, player.level); const selected = area.id === selectedArea.id; return <button key={area.id} disabled={!unlocked} onClick={() => { if (!unlocked) return; idle.setSelectedRoamingArea(area.id); setShowAreaSelect(false); }} className={`w-full border p-3 text-left ${selected ? 'border-amber/40 bg-amber/10' : 'border-border bg-surface'} ${!unlocked ? 'opacity-60' : ''}`} style={panelClip}><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-text-primary">{area.name}</div><div className="text-[10px] text-text-muted">{area.manufacturerInfluence} / Lv.{area.unlockLevel} / {area.dangerRating}</div></div>{selected && <span className="text-[9px] font-black uppercase tracking-widest text-amber">Current</span>}</div><div className="mt-2 text-xs leading-relaxed text-text-secondary">{area.gameplayIdentity}</div><div className="mt-1 text-[10px] text-text-muted">Enemies: {area.enemyType}</div><div className="mt-1 text-[10px] text-amber">{unlocked ? area.selectionHint : `Locked until level ${area.unlockLevel}.`}</div></button>; })}</div></motion.div>)}</AnimatePresence>
      <AnimatePresence>{prepBoss && <BossPrepModal boss={prepBoss} onClose={() => setPrepBoss(null)} />}</AnimatePresence>
    </div>
  );
};
