import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Activity, Boxes, Clock, Crosshair, Hammer, MapPin, Package, Radar, Recycle, ShoppingCart, Skull, Wrench, X } from 'lucide-react';
import { useActivityStore, useBossStore, useIdleStore, useInventoryStore, useLoadoutStore, usePlayerStore, useSkillStore } from '@/store';
import { BossPrepModal } from '@/components/fight/BossPrepModal';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { MobileCard } from '@/components/layout/MobileCard';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS, buildAreaWeaponDropOptions, getRoamingArea, isRoamingAreaUnlocked, rollAreaDropKind, rollAreaMaterialFind } from '@/constants/roamingAreas';
import { buildBossPrepActivity, buildCraftingActivity, buildRoamingLootActivity, buildSalvagingActivity } from '@/lib/activity/activityBuilders';
import { makeRunEvent, sortRunEventsByVisualPriority, type RunVisualEvent } from '@/lib/run/runEvents';
import type { ActivityKind, StartActivityInput } from '@/types/activity';
import type { GearItem, Weapon } from '@/types/items';

const TICK_SECONDS = 3;
const LOG_LIMIT = 8;
const DROP_CHANCE_PER_TICK = 0.22;
const CACHE_FRAGMENT_CHANCE_PER_TICK = 0.03;
const MATERIAL_FIND_CHANCE_PER_TICK = 0.08;
const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };

const copy: Record<ActivityKind, { title: string; detail: string }> = {
  none: { title: 'No Action', detail: 'Choose what the runner should do next.' },
  idle_standby: { title: 'Standby', detail: 'Runner is visible but not producing rewards.' },
  roaming_loot: { title: 'Roaming Loot', detail: 'Sweeping turf for XP, credits, scrap, gear, materials, and cache fragments.' },
  boss_prep: { title: 'Boss Prep', detail: 'Checking weaknesses, counters, and loadout readiness before a discrete encounter.' },
  boss_fight: { title: 'Boss Encounter', detail: 'Resolving a focused boss encounter instead of the roaming loop.' },
  crafting: { title: 'Crafting', detail: 'Working at the bench to build or modify gear.' },
  salvaging: { title: 'Salvaging', detail: 'Breaking items into scrap, materials, or essences.' },
  workshop_service: { title: 'Workshop Service', detail: 'Maintaining machines, queues, and production outputs.' },
  market_listing: { title: 'Market Listing', detail: 'Posting or managing gear at the trade kiosk.' },
};

const idleEvent: RunVisualEvent = {
  id: 'idle-loop-ready',
  label: 'ACTION READY',
  detail: 'Dashboard and Action now use the same live runner scene.',
  tone: 'patrol',
  eventType: 'idle',
};

const describeGear = (item: GearItem) => {
  if ('weaponType' in item) return `${item.rarity} ${item.weaponType}`;
  if ('hp' in item) return `${item.rarity} Shield`;
  if ('treeBonus' in item) return `${item.rarity} Class Mod`;
  if ('damage' in item) return `${item.rarity} Ordnance`;
  return `${item.rarity} Relic`;
};

const ActionCard: React.FC<{ title: string; detail: string; active: boolean; icon: React.ElementType; onClick: () => void }> = ({ title, detail, active, icon: Icon, onClick }) => (
  <button type="button" onClick={onClick} className={`min-h-[104px] border-2 p-3 text-left shadow-[4px_4px_0_rgba(0,0,0,0.45)] active:scale-[0.98] ${active ? 'border-amber bg-amber/12' : 'border-border bg-surface'}`} style={panelClip}>
    <div className="flex items-start justify-between gap-2"><Icon size={18} className={active ? 'text-amber' : 'text-text-muted'} /><span className={`text-[8px] font-black uppercase tracking-widest ${active ? 'text-amber' : 'text-text-muted'}`}>{active ? 'Active' : 'Switch'}</span></div>
    <div className="mt-2 text-sm font-black text-text-primary">{title}</div>
    <div className="mt-1 text-[10px] leading-snug text-text-muted">{detail}</div>
  </button>
);

const FeedCard: React.FC<{ event: RunVisualEvent }> = ({ event }) => {
  const dot = event.tone === 'loot' ? 'bg-amber' : event.tone === 'cache' ? 'bg-blue-400' : event.tone === 'cash' ? 'bg-cyan' : event.tone === 'level' ? 'bg-red' : event.tone === 'xp' ? 'bg-green' : 'bg-text-muted';
  return <div className="flex items-start gap-2 border border-border bg-surface-raised p-2"><span className={`mt-1 h-2.5 w-2.5 shrink-0 ${dot}`} /><div className="min-w-0"><div className="truncate text-[11px] font-black uppercase tracking-wide text-text-primary">{event.label}</div><div className="text-[10px] leading-snug text-text-muted">{event.detail}</div></div></div>;
};

export const ActionScreenUnified: React.FC<{ onOpenBossSelect: () => void; onNavigate?: (screen: string) => void }> = ({ onOpenBossSelect, onNavigate }) => {
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
  const [feed, setFeed] = useState<RunVisualEvent[]>([idleEvent]);
  const prevLevelRef = useRef(player.level);

  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const currentKind = activity.current.kind;
  const currentBoss = bossStore.currentBossId ? REGION_1_BOSSES.find((b) => b.id === bossStore.currentBossId) : null;
  const prepBossTarget = currentBoss ?? REGION_1_BOSSES.find((b) => bossStore.unlockedBossIds.includes(b.id) && !bossStore.defeatedBossIds.includes(b.id)) ?? null;
  const bestBossWeapon = useMemo(() => inventory.getWeapons().sort((a, b) => b.bossPower - a.bossPower)[0], [inventory]);
  const activityWeapon: Weapon | undefined = loadoutStore.getWeapon('primary') ?? loadoutStore.getWeapon('secondary') ?? loadoutStore.getWeapon('heavy') ?? bestBossWeapon;
  const equippedCount = Object.values(loadoutStore.slots).filter(Boolean).length;
  const firstSalvageItem = inventory.items[0];
  const isRoaming = currentKind === 'roaming_loot';
  const activeRoamingAreaId = activity.current.targetType === 'roaming_area' ? activity.current.targetId : null;
  const canTick = isRoaming && activeRoamingAreaId === selectedArea.id && !activity.pending;
  const activeMinutes = Math.floor((elapsed * TICK_SECONDS) / 60);
  const activeSeconds = (elapsed * TICK_SECONDS) % 60;
  const creditsPerTick = Math.round((selectedArea.idleCreditsPerMinute / 20) * (1 + (skillBonuses.offlineEarnings || 0)));
  const scrapPerTick = Math.round((selectedArea.idleScrapPerMinute / 20) * (1 + (skillBonuses.scrapYield || 0)));
  const targetLabel = activity.current.targetLabel ?? (currentKind === 'idle_standby' || currentKind === 'none' ? 'No target selected' : selectedArea.name);
  const detail = copy[currentKind] ?? copy.idle_standby;
  const visualBoss = currentKind === 'boss_prep' || currentKind === 'boss_fight' ? prepBossTarget : undefined;
  const visualFeed = currentKind === 'idle_standby' || currentKind === 'none' ? feed : feed.filter((event) => event.id !== 'idle-loop-ready');

  const pushEvents = useCallback((events: RunVisualEvent[]) => {
    setFeed((current) => [...sortRunEventsByVisualPriority(events), ...current.filter((event) => event.id !== 'idle-loop-ready')].slice(0, LOG_LIMIT));
  }, []);

  const startAction = useCallback(async (input: StartActivityInput, event: RunVisualEvent) => {
    try {
      await activity.start(input);
      idle.setFarming(input.kind === 'roaming_loot');
      setElapsed(0);
      pushEvents([event]);
    } catch (error) {
      pushEvents([makeRunEvent('ACTION FAILED', error instanceof Error ? error.message : 'The action service rejected the transition.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  const startRoam = useCallback(() => startAction(buildRoamingLootActivity(selectedArea, activityWeapon), makeRunEvent('ROAM STARTED', `${selectedArea.name} is now the current action.`, 'patrol', 'run_started')), [activityWeapon, selectedArea, startAction]);
  const startPrep = useCallback(() => {
    if (!prepBossTarget) { onOpenBossSelect(); return; }
    startAction(buildBossPrepActivity(prepBossTarget, activityWeapon), makeRunEvent('BOSS PREP', `${prepBossTarget.name} is now the current action.`, 'patrol', 'boss_prep'));
    setPrepBoss(prepBossTarget);
  }, [activityWeapon, onOpenBossSelect, prepBossTarget, startAction]);
  const startCraft = useCallback(() => {
    startAction(buildCraftingActivity({ id: 'workshop-crafting', name: 'Workbench Crafting', category: 'gear' }, null), makeRunEvent('CRAFTING', 'Workbench crafting is now the visible character action.', 'patrol', 'crafting'));
    onNavigate?.('workshop');
  }, [onNavigate, startAction]);
  const startSalvage = useCallback(() => {
    if (!firstSalvageItem) { onNavigate?.('loot'); pushEvents([makeRunEvent('NO GEAR', 'No gear is available to salvage yet.', 'patrol', 'idle')]); return; }
    startAction(buildSalvagingActivity(firstSalvageItem), makeRunEvent('SALVAGING', `${firstSalvageItem.name} is now the visible salvage action.`, 'patrol', 'salvaging'));
  }, [firstSalvageItem, onNavigate, pushEvents, startAction]);
  const startWorkshop = useCallback(() => {
    startAction({ kind: 'workshop_service', targetType: 'workshop_job', targetId: 'workshop-service', targetLabel: 'Workshop Service', sceneKey: 'workshop:service', notes: 'Servicing workshop queues', publicPayload: { activity_label: 'Servicing Workshop', target_label: 'Workshop Service', scene_key: 'workshop:service' }, publicVisible: true }, makeRunEvent('WORKSHOP SERVICE', 'Runner is servicing workshop machines and queues.', 'patrol', 'crafting'));
    onNavigate?.('workshop');
  }, [onNavigate, startAction]);
  const startMarket = useCallback(() => {
    startAction({ kind: 'market_listing', targetType: 'market_listing', targetId: 'market-console', targetLabel: 'Trade Kiosk', sceneKey: 'market:kiosk', notes: 'Managing market listings', publicPayload: { activity_label: 'Managing Market Listings', target_label: 'Trade Kiosk', scene_key: 'market:kiosk' }, publicVisible: true }, makeRunEvent('MARKET LISTING', 'Runner is working the trade kiosk.', 'patrol', 'market_listing'));
    onNavigate?.('market');
  }, [onNavigate, startAction]);
  const stopAction = useCallback(async () => {
    try {
      await activity.clear();
      idle.setFarming(false);
      setElapsed(0);
      setFeed([idleEvent]);
    } catch (error) {
      pushEvents([makeRunEvent('STOP FAILED', error instanceof Error ? error.message : 'The action service rejected the stop request.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  const createDrop = useCallback(() => {
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
    if (player.level > prevLevelRef.current) pushEvents([makeRunEvent(`LEVEL ${player.level}`, 'XP crossed the next level threshold.', 'level', 'level_up')]);
    prevLevelRef.current = player.level;
  }, [player.level, pushEvents]);

  useEffect(() => {
    if (!canTick) return undefined;
    const iv = window.setInterval(() => {
      setElapsed((e) => e + 1);
      const events: RunVisualEvent[] = [];
      const drop = Math.random() < DROP_CHANCE_PER_TICK ? createDrop() : null;
      const cacheFound = Math.random() < CACHE_FRAGMENT_CHANCE_PER_TICK;
      const materialFound = Math.random() < MATERIAL_FIND_CHANCE_PER_TICK;
      if (cacheFound) { player.addCacheKeyFragments(1); events.push(makeRunEvent('CACHE FRAGMENT', `${selectedArea.enemyType} patrol yielded a cache key fragment.`, 'cache', 'cache_fragment')); }
      if (drop) events.push(makeRunEvent('GEAR DROP', `${drop.name} (${describeGear(drop)}) dropped in ${selectedArea.name}.`, 'loot', 'gear_drop'));
      if (!drop && !cacheFound && materialFound) {
        const find = rollAreaMaterialFind(selectedArea);
        if (find?.kind === 'material') { player.addMaterial(find.type, 1); events.push(makeRunEvent('MATERIAL FIND', `${find.type} recovered while sweeping ${selectedArea.name}.`, 'loot', 'material_find')); }
        if (find?.kind === 'essence') { player.addEssence(find.type, 1); events.push(makeRunEvent('ESSENCE FIND', `${find.type} essence recovered while sweeping ${selectedArea.name}.`, 'loot', 'material_find')); }
      }
      player.addCredits(creditsPerTick);
      player.addScrap(scrapPerTick);
      player.addXP(1);
      if (!events.length) events.push(makeRunEvent('ENEMY SWEEP', `${selectedArea.enemyType} routed. +1 XP / +${creditsPerTick}cr / +${scrapPerTick} scrap.`, 'xp', 'enemy_sweep'));
      pushEvents(events);
    }, TICK_SECONDS * 1000);
    return () => window.clearInterval(iv);
  }, [canTick, createDrop, creditsPerTick, player, pushEvents, scrapPerTick, selectedArea]);

  useEffect(() => {
    if (!canTick) return undefined;
    const iv = window.setInterval(() => { activity.heartbeat().catch((error) => console.warn('Action heartbeat skipped:', error)); }, 60000);
    return () => window.clearInterval(iv);
  }, [activity, canTick]);

  return (
    <div className="bl-page space-y-3 p-3 pb-20">
      <div className="flex items-start justify-between gap-3"><div><div className="bl-title text-3xl leading-none text-text-primary">Action</div><div className="text-[9px] font-bold uppercase tracking-[0.2em] text-text-muted">same live runner scene as dashboard</div></div><button type="button" onClick={stopAction} disabled={activity.pending || currentKind === 'idle_standby' || currentKind === 'none'} className="bl-secondary px-3 py-2 text-[10px] font-black text-red disabled:opacity-50">Stop</button></div>
      <LiveTurfDiorama area={selectedArea} weapon={activityWeapon} bossName={visualBoss?.name} bossWeaknessCount={visualBoss?.weaknesses.length ?? 0} playerLevel={player.level} equippedCount={equippedCount} cacheKeys={player.cacheKeys} feedEvents={visualFeed} activityKind={currentKind} activityLabel={detail.title} activityTarget={targetLabel} onFight={startRoam} onSecondary={() => onNavigate?.('chest')} />
      <MobileCard className="space-y-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] font-black uppercase tracking-widest text-amber">Current Action</div><div className="text-lg font-black text-text-primary">{detail.title}</div><div className="text-xs leading-relaxed text-text-muted">{detail.detail}</div></div><div className="text-right text-[10px] text-text-muted"><Clock size={16} className="ml-auto" />{activeMinutes}m {activeSeconds}s</div></div><div className="grid grid-cols-3 gap-2 text-center text-[10px]"><div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Target</div><div className="truncate font-bold text-text-primary">{targetLabel}</div></div><div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Keys</div><div className="font-bold text-amber">{player.cacheKeys} +{player.cacheKeyFragments}/5</div></div><div className="border border-border bg-surface-raised p-2"><div className="text-text-muted">Tick</div><div className="font-bold text-text-primary">{canTick ? `${TICK_SECONDS}s live` : 'paused'}</div></div></div></MobileCard>
      <MobileCard className="space-y-2"><div className="flex items-center justify-between gap-2"><div className="text-xs font-black uppercase tracking-widest text-text-muted">Choose Action</div><button type="button" onClick={() => setShowAreaSelect(true)} className="flex items-center gap-1 text-[10px] font-bold text-amber"><MapPin size={12} />Turf</button></div><div className="grid grid-cols-2 gap-2"><ActionCard title="Roam" detail={`${selectedArea.name}: loot, XP, scrap, credits, materials, and cache fragments.`} active={currentKind === 'roaming_loot'} icon={Radar} onClick={startRoam} /><ActionCard title="Boss Prep" detail={prepBossTarget ? `Prepare counters for ${prepBossTarget.name}.` : 'Choose a boss target first.'} active={currentKind === 'boss_prep'} icon={Skull} onClick={startPrep} /><ActionCard title="Boss Encounter" detail="Open the boss resolver and replay the encounter beats." active={currentKind === 'boss_fight'} icon={Crosshair} onClick={() => { if (prepBossTarget) setPrepBoss(prepBossTarget); else onOpenBossSelect(); }} /><ActionCard title="Craft" detail="Move to the workbench and show crafting as the visible action." active={currentKind === 'crafting'} icon={Hammer} onClick={startCraft} /><ActionCard title="Salvage" detail="Break gear into scrap, materials, and essences." active={currentKind === 'salvaging'} icon={Recycle} onClick={startSalvage} /><ActionCard title="Workshop" detail="Service machines, jobs, and production queues." active={currentKind === 'workshop_service'} icon={Wrench} onClick={startWorkshop} /><ActionCard title="Market" detail="Manage listings at the trade kiosk." active={currentKind === 'market_listing'} icon={ShoppingCart} onClick={startMarket} /><ActionCard title="Caches" detail="Open cache keys without treating it like combat." active={false} icon={Package} onClick={() => onNavigate?.('chest')} /></div></MobileCard>
      <MobileCard className="space-y-2"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-text-muted"><Activity size={14} />Action Feed</div><div className="space-y-2">{feed.map((event) => <FeedCard key={event.id} event={event} />)}</div></MobileCard>
      <MobileCard className="space-y-2"><div className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-text-muted"><Boxes size={14} />Action Detail</div><div className="text-xs leading-relaxed text-text-muted">This tab no longer owns separate stage art. It uses the same live diorama component as Dashboard and only adds controls, feed, and detail beneath it.</div></MobileCard>
      <AnimatePresence>{showAreaSelect && (<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 overflow-y-auto bg-bg/90 p-4 backdrop-blur-sm"><div className="mx-auto max-w-lg space-y-3 pb-10"><div className="sticky top-0 flex items-center justify-between bg-bg/95 py-2"><div><div className="text-xs font-bold uppercase tracking-wider text-amber">Select Roaming Area</div><div className="text-[10px] text-text-muted">Changing turf does not produce rewards until Roam is started or switched.</div></div><button onClick={() => setShowAreaSelect(false)} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-surface-raised text-text-primary" aria-label="Close area selector"><X size={16} /></button></div>{ROAMING_AREAS.map((area) => { const unlocked = isRoamingAreaUnlocked(area, player.level); const selected = area.id === selectedArea.id; return <button key={area.id} disabled={!unlocked} onClick={() => { if (!unlocked) return; idle.setSelectedRoamingArea(area.id); setShowAreaSelect(false); }} className={`w-full border p-3 text-left ${selected ? 'border-amber/40 bg-amber/10' : 'border-border bg-surface'} ${!unlocked ? 'opacity-60' : ''}`} style={panelClip}><div className="flex items-start justify-between gap-3"><div><div className="text-sm font-black text-text-primary">{area.name}</div><div className="text-[10px] text-text-muted">{area.manufacturerInfluence} / Lv.{area.unlockLevel} / {area.dangerRating}</div></div>{selected && <span className="text-[9px] font-black uppercase tracking-widest text-amber">Current</span>}</div><div className="mt-2 text-xs leading-relaxed text-text-secondary">{area.gameplayIdentity}</div><div className="mt-1 text-[10px] text-text-muted">Enemies: {area.enemyType}</div><div className="mt-1 text-[10px] text-amber">{unlocked ? area.selectionHint : `Locked until level ${area.unlockLevel}.`}</div></button>; })}</div></motion.div>)}</AnimatePresence>
      <AnimatePresence>{prepBoss && <BossPrepModal boss={prepBoss} onClose={() => setPrepBoss(null)} />}</AnimatePresence>
    </div>
  );
};
