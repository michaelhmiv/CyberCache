import React, { useCallback, useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence } from 'framer-motion';
import {
  Clock,
} from 'lucide-react';
import {
  useActivityStore,
  useBossStore,
  useIdleStore,
  useInventoryStore,
  useLoadoutStore,
  useMarketStore,
  usePlayerStore,
  useSalvageFeedStore,
  useSkillStore,
  useSurvivalStore,
  useWorkshopStore,
} from '@/store';
import { BossEncounterPanel } from '@/components/fight/BossEncounterPanel';
import { EndlessPanel } from '@/components/fight/EndlessPanel';
import { ExtractionPanel } from '@/components/fight/ExtractionPanel';
import { BossPickerList } from '@/components/fight/BossPickerList';
import { AreaPickerList } from '@/components/common/AreaPicker';
import { MobileCard } from '@/components/layout/MobileCard';
import {
  ActionFeed,
  ContextualPickerSheet,
  RewardIntelPanel,
  type ActionFeedEntry,
} from '@/components/action/ActionWorkspace';
import { LiveTurfDiorama } from '@/components/dashboard/LiveTurfDiorama';
import { VehicleStatusLine } from '@/components/gear/VehicleStatusLine';
import { ActionLoadout } from '@/components/action/ActionLoadout';
import { ActivityModifierPanel } from '@/components/action/ActivityModifierPanel';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { CRAFTING_RECIPES } from '@/constants/craftingRecipes';
import {
  getRoamingArea,
  type RoamingAreaDef,
} from '@/constants/roamingAreas';
import {
  buildBossFightActivity,
  buildCraftingActivity,
  buildRoamingLootActivity,
} from '@/lib/activity/activityBuilders';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { salvageScrap } from '@/lib/skills/salvageBonuses';
import { CACHE_FRAGMENT_CHANCE, GEAR_DROP_CHANCE, MATERIAL_FIND_CHANCE } from '@/content/roamingRates';
import { isClassMod, isOrdnance, isRelic, isShield, isWeapon } from '@/lib/gear/gearCardSummary';
import { canStartCraft } from '@/lib/craftingEngine';
import type { WorkshopJobView } from '@/store/slices/workshopSlice';
import { makeRunEvent, type RunVisualEvent } from '@/lib/run/runEvents';
import { useTickFeedStore } from '@/store/slices/tickSlice';

import { getActivityVisual } from '@/constants/activityVisuals';
import type { ActivityKind, StartActivityInput } from '@/types/activity';
import type { GearItem, Weapon } from '@/types/items';
import type { BossDef } from '@/types/boss';
import { computeMedKitBuffer } from '@/lib/combat/damageContract';
import { selectEquippedWeapons } from '@/lib/loadout/equippedWeaponTruth';
import { buildLoadoutRows, countEquippedLoadoutSlots } from '@/lib/loadout/loadoutReadModel';
import { ActionTickTimer } from '@/components/action/ActionTickTimer';
import { ClaimSyncStatusLine } from '@/components/action/ClaimSyncStatusLine';
import { HomeModeRail, type HomeModeRailStop } from '@/components/action/HomeModeRail';
import { ConsumableBelt } from '@/components/dashboard/ConsumableBelt';
import { ResearchChip, ResearchCompletionCard } from '@/components/dashboard/ResearchChip';

const TICK_SECONDS = 3;
const LOG_LIMIT = 10;
const MAX_SWITCH_ROWS = 8;

const panelClip = { clipPath: 'polygon(12px 0,100% 0,100% calc(100% - 12px),calc(100% - 12px) 100%,0 100%,0 12px)' };
const smallClip = { clipPath: 'polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%)' };

/** Renders an activity-kind glyph as a styled span (replaces lucide activity icons). */
const ActivityGlyph: React.FC<{ kind: ActivityKind; size?: number; className?: string }> = ({ kind, size = 15, className = '' }) => {
  const visual = getActivityVisual(kind);
  const pxSize = size <= 14 ? 13 : size <= 21 ? 17 : size <= 33 ? 26 : 40;
  return <span className={`shrink-0 inline-flex items-center justify-center ${className}`} style={{ color: visual.color }}><PxIcon name={visual.icon} size={pxSize} /></span>;
};

const idleEvent: RunVisualEvent = {
  id: 'idle-loop-ready',
  label: 'ACTION READY',
  detail: 'Choose a hunter action. The workspace below changes to the current action.',
  tone: 'patrol',
  eventType: 'idle',
};

const formatDuration = (ms: number) => {
  const mins = Math.floor(ms / 60000);
  if (mins >= 60) return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  if (mins >= 1) return `${mins}m`;
  return `${Math.max(1, Math.ceil(ms / 1000))}s`;
};

const Section: React.FC<{ title: string; eyebrow?: string; children: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode }> = ({ title, eyebrow, children, icon, action }) => (
  <MobileCard className="relative overflow-hidden space-y-3 border-border/90 bg-surface/95">
    <div className="absolute -right-8 -top-8 h-24 w-24 rotate-12 border-[14px] border-amber/5" />
    <div className="relative flex items-start justify-between gap-3">
      <div>
        {eyebrow && <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">{eyebrow}</div>}
        <div className="flex items-center gap-2 text-sm font-black text-text-primary">
          {icon && <span className="text-amber">{icon}</span>}
          {title}
        </div>
      </div>
      {action}
    </div>
    <div className="relative">{children}</div>
  </MobileCard>
);

/**
 * The slot an item equips into, resolved with the same type-guard
 * chain GearHub uses (flow-fix F11): weapons take the first empty
 * weapon slot, falling back to primary. Null = no slot fits the item.
 */
const resolveEquipSlot = (item: GearItem, slots: Record<string, unknown>): string | null => {
  if (isShield(item)) return 'shield';
  if (isClassMod(item)) return 'classMod';
  if (isOrdnance(item)) return 'ordnance';
  if (isRelic(item)) return 'relic';
  if (isWeapon(item)) {
    const weaponSlots = ['primary', 'secondary', 'heavy'];
    return weaponSlots.find((s) => !slots[s]) ?? 'primary';
  }
  return null;
};

type CommonPanelProps = {
  playerLevel: number;
  selectedArea: RoamingAreaDef;
  setSelectedArea: (id: string) => void;
  startRoam: (area?: RoamingAreaDef) => void;
  startPrep: (boss?: BossDef) => void;
  startBossFight: (boss?: BossDef) => void;
  openBoss: () => void;
  startCrafting: () => void;
  startSalvage: (item?: GearItem) => void;
  onNavigate?: (screen: string) => void;
};

const CraftingPanel: React.FC<CommonPanelProps & { playerMaterials: Record<string, number>; playerEssences: Record<string, number>; benchesFree: number; jobs: WorkshopJobView[] }> = ({ playerLevel, playerMaterials, playerEssences, benchesFree, jobs, startCrafting, onNavigate }) => {
  const craftable = CRAFTING_RECIPES.map((recipe) => ({ recipe, check: canStartCraft(recipe.id, playerMaterials, playerEssences, playerLevel) }));
  const canNow = craftable.filter(({ check }) => check.can);
  const activeJobs = jobs.filter((j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused');
  return (
    <div className="space-y-3">
      <RewardIntelPanel title="Bench output forecast" eyebrow="crafting intel" stats={[{ label: 'Free', value: benchesFree, tone: benchesFree ? 'green' : 'red' }, { label: 'Jobs', value: activeJobs.length }, { label: 'Craftable', value: canNow.length, tone: 'amber' }, { label: 'Recipes', value: CRAFTING_RECIPES.length }, { label: 'Blocked', value: Math.max(0, CRAFTING_RECIPES.length - canNow.length), tone: 'red' }]}>Recipes are chosen in the Workshop — crafting has one home. Jobs are server state: they progress only while Crafting holds the action slot, and this page reads their settled status.</RewardIntelPanel>
      {activeJobs.length > 0 && <Section title="Bench Jobs" eyebrow="machine deck" icon={<Clock size={15} />}><div className="space-y-2">{activeJobs.map((job) => <div key={job.id} className="border border-border bg-bg/70 p-2"><div className="flex justify-between gap-2 text-xs"><span className="font-black text-text-primary">Bench {job.bench}: {job.name}</span><span className="text-amber">{job.state === 'paused' ? 'Paused' : `${formatDuration(job.remainingMs)} left`}</span></div><div className="text-[10px] text-text-muted">{job.unitsCompleted}/{job.unitsTotal} units · {job.xpAwarded} XP banked{job.state === 'paused' ? ' · switch back to Crafting to resume' : ''}</div></div>)}</div></Section>}
      <Section title="Recipe Control" eyebrow="workshop owns recipes" icon={<ActivityGlyph kind="crafting" />}><button type="button" onClick={() => onNavigate?.('workshop')} className="bl-primary w-full py-2 text-xs font-black">Open Workshop</button><button type="button" onClick={startCrafting} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber">Set Crafting As Current Action</button></Section>
    </div>
  );
};

const SalvagePanel: React.FC<CommonPanelProps & { items: GearItem[]; onSalvagePicker: () => void }> = ({ items, startSalvage, onNavigate, onSalvagePicker }) => {
  const candidates = items.filter((item) => !item.isLocked).slice(0, 8);
  const top = candidates[0];
  return (
    <div className="space-y-3">
      <RewardIntelPanel title="Breakdown estimate" eyebrow="salvage intel" stats={[{ label: 'Candidates', value: candidates.length }, { label: 'Base scrap', value: top ? salvageScrap(top.rarity, top.level) : 0, tone: 'green' }, { label: 'Settles', value: 'Instant', tone: 'amber' }]}>Top candidate: {top?.name ?? 'None'}. The estimate is the base scrap award from the shared salvage rules — the server adds your salvage skill bonuses (and legendary cores on Legendaries) when it settles, and the feed reports the real award. Salvage executes immediately and never occupies your action slot.</RewardIntelPanel>
      <Section title="Salvage Control" eyebrow="item selector" icon={<ActivityGlyph kind="salvaging" />}><button type="button" onClick={onSalvagePicker} className="bl-primary w-full py-2 text-xs font-black">Choose Item To Salvage</button><button type="button" onClick={() => { if (top) startSalvage(top); }} disabled={!top} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber disabled:opacity-50">Salvage Top Candidate Now</button><button type="button" onClick={() => onNavigate?.('gear')} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber">Open Gear</button></Section>
    </div>
  );
};


const _IdlePanel: React.FC<Partial<CommonPanelProps>> = ({ startRoam, startPrep, startCrafting, startSalvage, onNavigate, selectedArea }) => (
  <div className="space-y-3">
    <Section title="Recommended Dispatch" eyebrow="no action active" icon={<ActivityGlyph kind="idle_standby" />}>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => startRoam?.()} className="border-2 border-amber/40 bg-amber/10 p-3 text-left" style={panelClip}><ActivityGlyph kind="roaming_loot" size={17} /><div className="mt-2 text-sm font-black text-text-primary">Start Roam</div><div className="text-[10px] text-text-muted">{selectedArea?.name ?? 'Default area'}</div></button>
        <button type="button" onClick={() => startPrep?.()} className="border-2 border-border bg-bg/70 p-3 text-left" style={panelClip}><ActivityGlyph kind="boss_fight" size={17} /><div className="mt-2 text-sm font-black text-text-primary">Prep Boss</div><div className="text-[10px] text-text-muted">Check counters first</div></button>
        <button type="button" onClick={() => startCrafting?.()} className="border-2 border-border bg-bg/70 p-3 text-left" style={panelClip}><ActivityGlyph kind="crafting" size={17} /><div className="mt-2 text-sm font-black text-text-primary">Craft</div><div className="text-[10px] text-text-muted">Recipes and benches</div></button>
        <button type="button" onClick={() => startSalvage?.()} className="border-2 border-border bg-bg/70 p-3 text-left" style={panelClip}><ActivityGlyph kind="salvaging" size={17} /><div className="mt-2 text-sm font-black text-text-primary">Salvage</div><div className="text-[10px] text-text-muted">Break down low gear</div></button>
      </div>
      <button type="button" onClick={() => onNavigate?.('chest')} className="mt-3 bl-secondary w-full py-2 text-xs font-black text-amber">Open Caches</button>
    </Section>
  </div>
);

export const ActionScreenContextual: React.FC<{ onOpenBossSelect: () => void; onNavigate?: (screen: string) => void }> = ({ onOpenBossSelect, onNavigate }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const loadoutStore = useLoadoutStore();
  const idle = useIdleStore();
  const activity = useActivityStore();
  const workshop = useWorkshopStore();
  const market = useMarketStore();
  const skillStore = useSkillStore();
  const survival = useSurvivalStore();
  const skillBonuses = skillStore.getBonuses();
  const [showSwitch, setShowSwitch] = useState(false);
  const [showAreaSelect, setShowAreaSelect] = useState(false);
  const [showBossPicker, setShowBossPicker] = useState(false);
  const [showSalvagePicker, setShowSalvagePicker] = useState(false);
  const [showEndless, setShowEndless] = useState(false);
  const [showExtraction, setShowExtraction] = useState(false);
  const [feedActionBusy, setFeedActionBusy] = useState(false);
  const [feedActionError, setFeedActionError] = useState<string | null>(null);
  const [salvagePendingIds, setSalvagePendingIds] = useState<ReadonlySet<string>>(new Set());
  // Tick feed events from the canonical ticker — the single source of truth
  // for roaming rewards. The Action screen is a consumer, not an engine.
  const tickEvents = useTickFeedStore((s) => s.events);
  const [feed, setFeed] = useState<RunVisualEvent[]>([idleEvent]);

  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const currentKind = activity.current.kind;
  // Craft jobs are server state (0024): refresh the workshop mirror
  // when this screen mounts and whenever the action slot changes, so
  // the Crafting panel shows settled progress / paused reasons.
  const refreshWorkshop = workshop.refresh;
  useEffect(() => {
    void refreshWorkshop();
  }, [refreshWorkshop, currentKind]);
  const bossPhase = activity.current.bossPhase;
  const isBossPrep = currentKind === 'boss_fight' && bossPhase === 'prep';
  const isBossFight = currentKind === 'boss_fight' && bossPhase === 'fight';
  // CONS-03: a resolved encounter keeps the boss panel mounted (the
  // result lives there) without claiming a fight is in progress.
  const isBossResolved = currentKind === 'boss_fight' && bossPhase === 'resolved';
  // CONS-04: gear-equipped counts the 7 gear slots only, via the one
  // read model every surface shares — the loadout store's raw slot map
  // also holds the vehicle slot, which is reported separately.
  const equippedCount = countEquippedLoadoutSlots(buildLoadoutRows(loadoutStore.slots, inventory.items));
  const currentBoss = bossStore.currentBossId ? REGION_1_BOSSES.find((b) => b.id === bossStore.currentBossId) : null;
  const prepBossTarget = currentBoss ?? REGION_1_BOSSES.find((b) => bossStore.unlockedBossIds.includes(b.id) && !bossStore.defeatedBossIds.includes(b.id)) ?? REGION_1_BOSSES[0];
  const equippedWeapons = selectEquippedWeapons(loadoutStore);
  const activityWeapon: Weapon | undefined = equippedWeapons[0];
  const isRoaming = currentKind === 'roaming_loot';
  const activeRoamingAreaId = activity.current.targetType === 'roaming_area' ? activity.current.targetId : null;
  const canTick = isRoaming && activeRoamingAreaId === selectedArea.id && !activity.pending;

  // Display-only timer. The 1-second increment lives inside the
  // ActionTickTimer child (its own useElapsedSeconds subscription) so the
  // rest of the screen does not re-render every second — eliminating the
  // vertical reflow that the layout-thrash bug was caused by. The actual
  // reward tick is handled by the singleton ticker in idleTickerSlice.
  // Fractional like scrap (migration 0010): the server accrues the raw
  // rate and banks the fraction, so preview the raw rate, not a rounding.
  const creditsPerTick = parseFloat(((selectedArea.idleCreditsPerMinute / 20) * (1 + (skillBonuses.offlineEarnings || 0))).toFixed(2));
  // Fractional: scrap accrues unrounded on the server and banks across
  // claims (migration 0009), so the honest preview is the raw rate.
  const scrapPerTick = parseFloat(((selectedArea.idleScrapPerMinute / 20) * (1 + (skillBonuses.scrapYield || 0))).toFixed(2));
  // Merge tick-feed events (from the canonical ticker) with lifecycle events
  // (action start/stop, cache open). The ticker is the single source of truth
  // for roaming rewards; the Action screen is a consumer, not an engine.
  // Filter by both selectedArea AND the active activity targetId — either
  // must match, so events show regardless of which path started the activity.
  const roamingTargetId = activity.current.targetId;
  const tickDisplayEvents: Array<{ id: string; label: string; detail: string; tone: string; eventType?: string; value?: number; areaId?: string }> = tickEvents
    .filter((e) => !e.areaId || e.areaId === selectedArea.id || e.areaId === roamingTargetId)
    .slice(0, LOG_LIMIT);
  // Audit UX-03: the merged feed renders in EVERY activity state.
  // The old code switched to the local lifecycle list alone when
  // idle, and stopAction reset that list to the empty placeholder —
  // together they wiped the session's reward record the moment the
  // player stopped roaming. Now the tick events (the earnings
  // record) stay merged across stop, stopping adds a divider line
  // instead of a wipe, and the placeholder shows only when there is
  // genuinely nothing to show yet.
  const mergedFeed = [...tickDisplayEvents, ...feed.filter((event) => event.id !== 'idle-loop-ready')].slice(0, LOG_LIMIT);
  const visualFeed = mergedFeed.length > 0 ? mergedFeed : feed;
  const workshopJobs = workshop.server?.jobs ?? [];
  const benchesFree = Math.max(0, (workshop.server?.benches ?? 1) - new Set(workshopJobs.filter((j) => j.state === 'running' || j.state === 'queued' || j.state === 'paused').map((j) => j.bench)).size);
  const salvageCandidates = inventory.items.filter((item) => !item.isLocked).slice(0, 12);
  const craftable = CRAFTING_RECIPES.map((recipe) => ({ recipe, check: canStartCraft(recipe.id, player.materials, player.essences, player.level) }));

  const pushEvents = useCallback((events: RunVisualEvent[]) => {
    setFeed((current) => [...events, ...current.filter((event) => event.id !== 'idle-loop-ready')].slice(0, LOG_LIMIT));
  }, []);

  const startAction = useCallback(async (input: StartActivityInput, event: RunVisualEvent) => {
    try {
      await activity.start(input);
      idle.setFarming(input.kind === 'roaming_loot');
      setShowSwitch(false);
      // QC B2: starting any real activity supersedes the Endless /
      // Extraction prep panels. Those panels render off local flags
      // that outrank every activity in the workspace chain, so a
      // stale flag left the panel pinned over the new mode (and the
      // rail's lit stop disagreeing with it) — clear both here, the
      // one funnel every mode start (rail, switch sheet, diorama)
      // passes through.
      setShowEndless(false);
      setShowExtraction(false);
      setShowAreaSelect(false);
      setShowBossPicker(false);
      setShowSalvagePicker(false);
      pushEvents([event]);
    } catch (error) {
      pushEvents([makeRunEvent('ACTION FAILED', error instanceof Error ? error.message : 'The action service rejected the transition.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  const startRoam = useCallback((area?: RoamingAreaDef) => {
    const target = area ?? selectedArea;
    idle.setSelectedRoamingArea(target.id);
    // Roaming start activates survival consumables proactively —
    // this lived on the Board's diorama start before the merge
    // (Wave B): Med Kit sets the HP buffer (stacked from inventory
    // count), Nano Swarm starts its per-tick regen. Home's stage is
    // the one start door now, so the behavior rides it.
    const survivalStore = useSurvivalStore.getState();
    const playerState = usePlayerStore.getState();
    const medKitCount = playerState.consumables['MedKit'] ?? 0;
    if (medKitCount > 0) {
      survivalStore.setMedKitBuffer(medKitCount * computeMedKitBuffer('MedKit'));
    }
    if ((playerState.consumables['NanoSwarm'] ?? 0) > 0) {
      survivalStore.startNanoSwarm(30); // 30 ticks × 10 HP = 300 HP
    }
    startAction(buildRoamingLootActivity(target, activityWeapon), makeRunEvent('ROAMING AREA', `Hunter is roaming ${target.name}.`, 'patrol', 'run_started'));
  }, [activityWeapon, idle, selectedArea, startAction]);

  const startPrep = useCallback((boss?: BossDef) => {
    const target = boss ?? prepBossTarget;
    if (!target) return;
    bossStore.setCurrentBoss(target.id);
    startAction(buildBossFightActivity(target, activityWeapon, 'prep'), makeRunEvent('BOSS PREP', `Prep started for ${target.name}.`, 'patrol', 'boss_fight'));
  }, [activityWeapon, bossStore, prepBossTarget, startAction]);

  const startBossFight = useCallback((boss?: BossDef) => {
    const target = boss ?? prepBossTarget;
    if (!target) return;
    bossStore.setCurrentBoss(target.id);
    startAction(buildBossFightActivity(target, activityWeapon, 'fight'), makeRunEvent('BOSS FIGHT', `Encounter started against ${target.name}.`, 'xp', 'boss_fight'));
  }, [activityWeapon, bossStore, prepBossTarget, startAction]);

  const startCrafting = useCallback((recipe = craftable.find(({ check }) => check.can)?.recipe ?? CRAFTING_RECIPES[0]) => {
    if (!recipe) return;
    startAction(buildCraftingActivity(recipe, null), makeRunEvent('CRAFTING', `Bench focus set to ${recipe.name}.`, 'patrol', 'crafting'));
  }, [craftable, startAction]);

  // Salvage (flow-fix F5): the Action tab used to stage a `salvaging`
  // activity that no server system consumed — the item was never
  // recycled, no payout or error ever arrived, and the fake activity
  // occupied the action slot, halting roaming. Salvage now executes
  // immediately through the same verified recycle path the Gear home
  // uses (server-settled, skill bonuses included) and reports the
  // server's real award in the feed.
  const executeSalvage = useCallback(async (item: GearItem): Promise<boolean> => {
    if (salvagePendingIds.has(item.id)) return false;
    setSalvagePendingIds((prev) => new Set(prev).add(item.id));
    try {
      const result = await verifiedOps.recycleItem(item.id);
      const award = Number(result.scrap_award ?? 0);
      const cores = Number(result.cores_award ?? 0);
      const bonusMaterial = typeof result.bonus_material === 'string' ? result.bonus_material : null;
      useSalvageFeedStore.getState().push(item, {
        scrapValue: award,
        scrapAlloy: 0,
        ballisticParts: 0,
        reactiveComponents: 0,
        techFragments: 0,
        voidDust: 0,
        essences: {},
      });
      pushEvents([makeRunEvent(
        'SALVAGED',
        `${item.name} recycled for +${award} scrap${cores > 0 ? ` · +${cores} legendary core${cores === 1 ? '' : 's'}` : ''}${bonusMaterial ? ` · +1 ${bonusMaterial}` : ''}.`,
        'cash',
        'salvaging',
      )]);
      return true;
    } catch (error) {
      pushEvents([makeRunEvent('SALVAGE FAILED', error instanceof Error ? error.message : 'The recycle service rejected the item.', 'patrol', 'run_stopped')]);
      return false;
    } finally {
      setSalvagePendingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }, [pushEvents, salvagePendingIds]);

  const startSalvage = useCallback((item?: GearItem) => {
    if (item) {
      void executeSalvage(item);
      return;
    }
    if (salvageCandidates.length > 0) {
      setShowSalvagePicker(true);
      return;
    }
    pushEvents([makeRunEvent('NOTHING TO SALVAGE', 'No unlocked items to break down. Roam or crack a cache to find gear.', 'patrol', 'run_stopped')]);
  }, [executeSalvage, pushEvents, salvageCandidates]);

  // Feed inspect actions (flow-fix F11): a dropped item can be
  // equipped or salvaged from the loot feed's inspect sheet, through
  // the same verified ops the item surfaces use. Returning true lets
  // the sheet close; failures keep it open with the error inline.
  const handleFeedEquip = useCallback(async (item: GearItem): Promise<boolean> => {
    const slot = resolveEquipSlot(item, loadoutStore.slots as Record<string, unknown>);
    if (!slot) {
      setFeedActionError(`No equip slot fits ${item.name}.`);
      return false;
    }
    setFeedActionBusy(true);
    setFeedActionError(null);
    try {
      await verifiedOps.equipItem(item.id, slot);
      pushEvents([makeRunEvent('EQUIPPED', `${item.name} equipped (${slot}).`, 'loot', 'gear_drop')]);
      return true;
    } catch (error) {
      setFeedActionError(error instanceof Error ? error.message : 'Equip failed.');
      return false;
    } finally {
      setFeedActionBusy(false);
    }
  }, [loadoutStore.slots, pushEvents]);

  const handleFeedSalvage = useCallback(async (item: GearItem): Promise<boolean> => {
    if (salvagePendingIds.has(item.id)) return false;
    setFeedActionBusy(true);
    setFeedActionError(null);
    try {
      const done = await executeSalvage(item);
      if (!done) setFeedActionError('Salvage failed — see the feed for the server response.');
      return done;
    } finally {
      setFeedActionBusy(false);
    }
  }, [executeSalvage, salvagePendingIds]);

  const stopAction = useCallback(async () => {
    try {
      await activity.clear();
      idle.setFarming(false);
      // Audit UX-03: a stop divider in the feed, never a reset — the
      // session's earnings record above the line stays visible.
      pushEvents([makeRunEvent('ACTION STOPPED', 'Session ended. The record above is this run\'s history — rewards are already banked on your profile.', 'patrol', 'run_stopped')]);
    } catch (error) {
      pushEvents([makeRunEvent('STOP FAILED', error instanceof Error ? error.message : 'The action service rejected the stop request.', 'patrol', 'run_stopped')]);
    }
  }, [activity, idle, pushEvents]);

  useEffect(() => {
    // market.seeded / market.seedMarket are not on the current MarketState type;
    // guard until the market store is wired. Pre-existing issue — not introduced here.
    const marketStore = market as unknown as { seeded?: boolean; seedMarket?: () => void };
    if (marketStore.seeded === false && typeof marketStore.seedMarket === 'function') {
      marketStore.seedMarket();
    }
  }, [market]);

  useEffect(() => {
    if (!canTick) return undefined;
    const iv = window.setInterval(() => { activity.heartbeat().catch((error) => console.warn('Action heartbeat skipped:', error)); }, 60000);
    return () => window.clearInterval(iv);
  }, [activity, canTick]);

  const feedEntries: ActionFeedEntry[] = visualFeed.map((event) => ({
    ...event,
    gear: (event as { gear?: GearItem }).gear,
  }));

  const commonProps: CommonPanelProps = { playerLevel: player.level, selectedArea, setSelectedArea: idle.setSelectedRoamingArea, startRoam, startPrep, startBossFight, openBoss: onOpenBossSelect, startCrafting, startSalvage, onNavigate };

  const workspace = (() => {
    // Endless (0028): the Chamber owns the workspace while a run
    // holds the slot, and opens in prep mode from the switch grid —
    // entering (the fee, the belt burn, the slot) is the panel's own
    // server call, never a client-side activity staging.
    if (currentKind === 'endless_run' || showEndless) {
      return <EndlessPanel onLeave={() => setShowEndless(false)} />;
    }

    // Extraction (0033): the panel owns the occupation surface
    // while it holds the slot, and opens from the switch grid —
    // claiming the site is the panel's own server call.
    if (currentKind === 'extraction' || showExtraction) {
      return <ExtractionPanel onLeave={() => setShowExtraction(false)} />;
    }

    // Idle/standby: the Roam panel (drift-fix F2, the approved
    // mock's anatomy) — the ONE primary action bar lives here in
    // the workspace, not on the stage: area facts, the full-width
    // Start Roam, and the secondary ghost row (Change Area ·
    // Loadout n/7). Before F2 the only Start Roam door was a
    // button bar printed over the stage art, beside a duplicate
    // door to the Switch Action sheet.
    if (currentKind === 'idle_standby' || currentKind === 'none') {
      return (
        <div data-testid="home-standby-panel" className="relative overflow-hidden border-2 border-border bg-surface/95 p-3 shadow-[0_4px_14px_rgba(0,0,0,0.5)]" style={panelClip}>
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <PxIcon name="pin" size={17} className="shrink-0 text-amber" />
              <div className="text-sm font-black text-text-primary">Roam — {selectedArea.name}</div>
            </div>
            <div className="shrink-0 text-[11px] font-bold text-text-muted">Lv {selectedArea.unlockLevel}+ · {selectedArea.dangerRating} danger</div>
          </div>
          {/* F2 fix: Hostiles gets the wide final track so its list
              wraps into fewer lines at the same 11px floor, and every
              cell centers its label/value group — the shorter facts
              no longer sit top-weighted in boxes stretched by the
              longest cell. */}
          <div data-testid="home-standby-facts" className="relative mt-2 grid grid-cols-[minmax(0,0.74fr)_minmax(0,0.74fr)_minmax(0,0.92fr)_minmax(0,1.6fr)] gap-1.5 text-[11px]">
            <div className="flex min-w-0 flex-col items-center justify-center border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Credits</div>
              <div className="font-black text-cyan">+{selectedArea.idleCreditsPerMinute}/min</div>
            </div>
            <div className="flex min-w-0 flex-col items-center justify-center border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Scrap</div>
              <div className="font-black text-green">+{selectedArea.idleScrapPerMinute}/min</div>
            </div>
            <div className="flex min-w-0 flex-col items-center justify-center border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Pays</div>
              <div className="font-black text-amber">XP · gear</div>
            </div>
            <div className="flex min-w-0 flex-col items-center justify-center border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Hostiles</div>
              <div className="font-black leading-[1.15] text-text-primary [text-wrap:balance]">{selectedArea.enemyType}</div>
            </div>
          </div>
          <button type="button" onClick={() => startRoam()} className="bl-primary relative mt-3 w-full py-3 text-sm font-black">
            Start Roam
          </button>
          <div className="relative mt-2 flex gap-2">
            <button type="button" onClick={() => setShowAreaSelect(true)} className="bl-secondary min-h-[44px] flex-1 px-3 py-2 text-[11px] font-black text-amber">
              Change Area
            </button>
            <button type="button" onClick={() => onNavigate?.('loadout')} className="bl-secondary min-h-[44px] flex-1 px-3 py-2 text-[11px] font-black text-amber">
              Loadout · {equippedCount}/7
            </button>
          </div>
        </div>
      );
    }

    // Roaming: compact route status panel with key stats at a glance
    if (currentKind === 'roaming_loot') {
      return (
        <div className="relative overflow-hidden border-2 border-amber/40 bg-amber/[0.06] p-3 shadow-[0_4px_14px_rgba(0,0,0,0.5)]" style={panelClip}>
          <div className="absolute -right-6 -top-6 h-20 w-20 rotate-12 border-[10px] border-amber/5" />
          <div className="relative flex items-start justify-between gap-3">
            <div>
              <div className="text-[9px] font-black uppercase tracking-[0.22em] text-amber">Active Area</div>
              <div className="flex items-center gap-2 mt-0.5">
                <PxIcon name="signal" size={17} className="shrink-0 text-amber" />
                <div>
                  <div className="text-sm font-black text-text-primary">{selectedArea.name}</div>
                  <div className="text-[10px] text-text-muted">{selectedArea.enemyType} · Lv.{selectedArea.unlockLevel} · {selectedArea.dangerRating}</div>
                </div>
              </div>
            </div>
            <button type="button" onClick={() => setShowAreaSelect(true)} className="bl-secondary shrink-0 px-2 py-1 text-[9px] font-black text-amber">
              Change Area
            </button>
          </div>
          <div className="relative mt-2 grid grid-cols-4 gap-1.5 text-[9px]">
            <div className="border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Credits</div>
              <div className="font-black text-cyan">+{creditsPerTick}/tick</div>
            </div>
            <div className="border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Scrap</div>
              <div className="font-black text-green">+{scrapPerTick}/tick</div>
            </div>
            <div className="border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Gear</div>
              <div className="font-black text-amber">{Math.round(GEAR_DROP_CHANCE * 100)}%/tick</div>
            </div>
            <div className="border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Frag</div>
              <div className="font-black text-cyan">{Math.round(CACHE_FRAGMENT_CHANCE * 100)}%/tick</div>
            </div>
          </div>
          <div className="relative mt-2 pt-2 border-t border-border/40 text-[9px] text-text-muted">
            {selectedArea.gameplayIdentity} · <ActionTickTimer key={`tick-${selectedArea.id}-${currentKind}`} tickSeconds={TICK_SECONDS} enabled={canTick} variant="active" className="text-amber" /> · {equippedCount}/7 gear equipped
          </div>
        </div>
      );
    }

    // Boss encounter (prep or fight phase): ONE panel owns the whole
    // loop — boss intel + prep, the single Chef attempt, the outcome
    // animation, and the result. Same component for both phases so a
    // phase flip never remounts it mid-attempt.
    if (isBossPrep || isBossFight || isBossResolved) {
      if (!prepBossTarget) return (
        <div className="border-2 border-border bg-surface/95 p-3" style={panelClip}>
          <div className="text-[9px] font-black uppercase tracking-[0.22em] text-red">Boss Encounter</div>
          <div className="text-xs text-text-muted mt-1">No boss selected. Tap Choose Boss to pick a target.</div>
          <button type="button" onClick={onOpenBossSelect} className="mt-2 bl-secondary w-full py-2 text-xs font-black text-amber">Choose Boss</button>
        </div>
      );
      return <BossEncounterPanel key={prepBossTarget.id} boss={prepBossTarget} onChangeBoss={() => setShowBossPicker(true)} onLeave={stopAction} />;
    }

    if (currentKind === 'crafting') return <CraftingPanel {...commonProps} playerMaterials={player.materials} playerEssences={player.essences} benchesFree={benchesFree} jobs={workshopJobs} />;
    if (currentKind === 'salvaging') return <SalvagePanel {...commonProps} items={inventory.items} onSalvagePicker={() => setShowSalvagePicker(true)} />;
    if (currentKind === 'workshop_service') return <Section title="Workshop relocated" eyebrow="gear owns benches" icon={<ActivityGlyph kind="workshop_service" />}><div className="space-y-2 text-xs text-text-muted"><div>Workshop now lives on the Gear tab.</div><button type="button" onClick={() => onNavigate?.('gear')} className="bl-primary w-full py-2 text-xs font-black">Open Gear</button></div></Section>;
    if (currentKind === 'market_listing') return <Section title="Market relocated" eyebrow="market owns listings" icon={<ActivityGlyph kind="market_listing" />}><div className="space-y-2 text-xs text-text-muted"><div>Trading now lives on the Market tab.</div><button type="button" onClick={() => onNavigate?.('market')} className="bl-primary w-full py-2 text-xs font-black">Open Market</button></div></Section>;
    return null; // fallback: no workspace panel needed
  })();

  // The two prep panels are mutually exclusive (QC B2): opening one
  // replaces the other, so the workspace and the rail's lit stop
  // always agree on which mode is open.
  const openEndless = useCallback(() => {
    setShowExtraction(false);
    setShowEndless(true);
    setShowSwitch(false);
  }, []);

  const openExtraction = useCallback(() => {
    setShowEndless(false);
    setShowExtraction(true);
    setShowSwitch(false);
  }, []);

  // Mode rail (redesign Wave C, DESIGN.md §2/§4): the stage's
  // six stops — Area · Roam · Boss · Endless · Extract · Craft.
  // Endless / Extract / Craft were promoted here from the mode
  // sheet (2 taps → 1); the sheet (switchActions below) keeps
  // every path it had, Salvage included — the rail ADDS the
  // first-class doors, it does not remove the sheet's.
  const railActiveStop: Exclude<HomeModeRailStop, 'area'> | null =
    isRoaming ? 'roam'
    : (isBossPrep || isBossFight || isBossResolved) ? 'boss'
    : (currentKind === 'endless_run' || showEndless) ? 'endless'
    : (currentKind === 'extraction' || showExtraction) ? 'extract'
    : currentKind === 'crafting' ? 'craft'
    : null;

  const handleRailSelect = useCallback((stop: HomeModeRailStop) => {
    switch (stop) {
      case 'area': setShowAreaSelect(true); break;
      case 'roam': startRoam(); break;
      case 'boss': setShowBossPicker(true); break;
      case 'endless': openEndless(); break;
      case 'extract': openExtraction(); break;
      case 'craft': startCrafting(); break;
    }
  }, [startRoam, startCrafting, openEndless, openExtraction]);

  const switchActions = [
    { label: 'Roam', detail: selectedArea.name, icon: <ActivityGlyph kind="roaming_loot" size={16} /> as React.ReactNode, run: () => startRoam() },
    { label: 'Boss Prep', detail: prepBossTarget?.name ?? 'Choose target', icon: <ActivityGlyph kind="boss_fight" size={16} /> as React.ReactNode, run: () => startPrep() },
    { label: 'Boss Fight', detail: prepBossTarget?.name ?? 'Choose target', icon: <PxIcon name="crosshair" size={17} className="text-amber" /> as React.ReactNode, run: () => startBossFight() },
    { label: 'Endless', detail: 'Chaos Chamber', icon: <ActivityGlyph kind="endless_run" size={16} /> as React.ReactNode, run: openEndless },
    { label: 'Extract', detail: selectedArea.name, icon: <ActivityGlyph kind="extraction" size={16} /> as React.ReactNode, run: openExtraction },
    { label: 'Craft', detail: `${CRAFTING_RECIPES.length} recipes`, icon: <ActivityGlyph kind="crafting" size={16} /> as React.ReactNode, run: () => startCrafting() },
    { label: 'Salvage', detail: `${inventory.items.length} items`, icon: <ActivityGlyph kind="salvaging" size={16} /> as React.ReactNode, run: () => startSalvage() },
  ].slice(0, MAX_SWITCH_ROWS);

  return (
    <div className="bl-page relative overflow-hidden space-y-3 p-3 pb-20">
      {/* Ambient glow blobs — matching Dashboard */}
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute left-5 top-20 h-48 w-48 rounded-full bg-amber/10 blur-3xl" />
        <div className="absolute right-2 top-72 h-48 w-48 rounded-full bg-red/10 blur-3xl" />
      </div>

      {/* Legendary drops get the full P3 loot moment in the diorama
          below (dim + gold pillar + risen weapon) — it supersedes the
          old LegendaryDropFlash overlay, which was retired in P3. */}

      {/* Home owns the Strip now (Wave B merge): the ResourceBar
          renders once at the top of the Home screen, not per-stage. */}

      {/* §4: nothing but the Strip and claim chips sits above the
          Stage. The Switch/Stop controls row that used to lead
          this screen now sits under the mode rail (the workspace
          header zone), and the claim-sync line moved down to the
          session feed it describes. The one chip that remains in
          this zone is the research chip (#239: the education track
          runs beside the action) — the current-area bar that used
          to share this row is gone (drift-fix F2): the area
          affordance is the stage's own area plate now (DESIGN.md
          §1), one slim plate on the art instead of a full-width
          dropdown bar above it. */}
      <ResearchChip />
      {/* Research (0038): the one-time course-complete card —
          appears on the first open after a course settles
          (renders null otherwise). */}
      <ResearchCompletionCard />

      {/* 1. Diorama — dashboard animation at top */}
      <LiveTurfDiorama
        area={selectedArea}
        weapon={activityWeapon}
        bossName={prepBossTarget?.name}
        boss={currentKind === 'boss_fight' ? (currentBoss ?? prepBossTarget) : undefined}
        playerLevel={player.level}
        equippedCount={equippedCount}
        activityKind={currentKind}
        onTitleClick={() => setShowAreaSelect(true)}
      />

      {/* 1b. Mode rail (§2/§4) — the stage's six stops under the
          diorama. This replaces the old compact action selector
          grid: Endless, Extract, and Craft are first-class rail
          stops now (1 tap), and the Switch Action sheet below
          keeps every path it had, Salvage included. */}
      <div className="relative">
        <HomeModeRail activeStop={railActiveStop} onSelect={handleRailSelect} />
      </div>

      {/* Controls row — Switch / Stop, in the workspace header
          zone under the rail (§4: above the Stage, only the Strip
          and claim chips may sit). */}
      <div className="relative flex items-start justify-end gap-3">
        <div className="flex gap-2">
          <button type="button" onClick={() => setShowSwitch(true)} className="bl-secondary flex min-h-[44px] items-center px-3 py-2 text-[11px] font-black text-amber">Switch Action</button>
          <button type="button" onClick={stopAction} disabled={activity.pending || currentKind === 'idle_standby' || currentKind === 'none'} className="bl-secondary flex min-h-[44px] items-center px-3 py-2 text-[11px] font-black text-red disabled:opacity-50">Stop</button>
        </div>
      </div>

      {/* 2. Action-specific panel — the lit workspace */}
      {workspace}

      {/* Vehicle status (0021): yield bonus, fuel, condition, inactive reason.
          The Garage door (audit UX-06) deep-links to the labeled Garage
          section of the Loadout tab. */}
      <VehicleStatusLine onOpenGarage={() => onNavigate?.('garage')} />

      {/* 2c. Consumable belt (§4 step 5) — above the fold, directly
          under the lit workspace; it lived in the deck before
          Wave C. */}
      <ConsumableBelt />

      {/* 3. Loadout — star-pattern gear constellation. Read-only here:
          the Fight tab displays the loadout; the gear home (Inventory)
          is the one place it is managed. */}
      <ActionLoadout readOnly onManageLoadout={() => onNavigate?.('loadout')} />

      {/* 2b. Activity modifiers — procedural gear bonuses for current action */}
      <ActivityModifierPanel activityKind={currentKind} />

      {/* 3. Compact status strip — HP (with buffer/shield/nano) / Keys / Tick */}
      <div className="flex gap-2 text-[10px]">
        <div className="flex-1 border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
          <span className="text-text-muted">HP </span>
          <span className={`font-black ${survival.currentHp < survival.maxHp * 0.3 ? 'text-red' : survival.currentHp < survival.maxHp * 0.6 ? 'text-amber' : 'text-green'}`}>
            {Math.round(survival.currentHp)}/{Math.round(survival.maxHp)}
          </span>
          {survival.shieldHp > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 font-black text-cyan"><PxIcon name="shield" size={13} /> {Math.round(survival.shieldHp)}</span>
          )}
          {survival.medKitBuffer > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 font-black text-green"><PxIcon name="cross" size={13} /> {Math.round(survival.medKitBuffer)}</span>
          )}
          {survival.nanoSwarmTicksRemaining > 0 && (
            <span className="ml-1 inline-flex items-center gap-0.5 font-black text-purple"><PxIcon name="star" size={13} /> {survival.nanoSwarmTicksRemaining}t</span>
          )}
        </div>
        <div className="flex-1 border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
          <span className="text-text-muted">Keys </span>
          <span className="font-black text-cyan">{player.cacheKeys} +{player.cacheKeyFragments}/5</span>
        </div>
        <div className="flex-1 border-2 border-border bg-bg/70 px-2 py-1.5" style={smallClip}>
          <span className="text-text-muted">Tick </span>
          <span className="inline-flex font-black">
            <ActionTickTimer key={`tick-${selectedArea.id}-${currentKind}`} tickSeconds={TICK_SECONDS} enabled={canTick} variant="compact" className={canTick ? 'text-green' : 'text-text-muted'} />
          </span>
        </div>
      </div>

      {/* Claim sync stall: visible when roaming claims stop landing
          (ticker-exposed flag) — rewards are paused, not silently
          lost. It prints in the session zone above the feed it
          describes (v2 composition), not above the Stage. */}
      <ClaimSyncStatusLine />

      {/* 6. Feed — loot log below the decision panels. Dropped items
          are actionable from their inspect sheet (F11). */}
      <ActionFeed entries={feedEntries} onGearEquip={handleFeedEquip} onGearSalvage={handleFeedSalvage} gearActionBusy={feedActionBusy} gearActionError={feedActionError} />

      {/* Drawers — unchanged */}
      <AnimatePresence>
        <ContextualPickerSheet open={showSwitch} title="Switch Action" detail="Broad action changes live in this drawer instead of crowding the Action tab." onClose={() => setShowSwitch(false)}>
          {switchActions.map(({ label, detail: rowDetail, icon, run }) => <button key={label} type="button" onClick={run} className="w-full border-2 border-border bg-surface p-3 text-left" style={smallClip}><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center border-2 border-border bg-bg text-amber">{icon}</div><div className="min-w-0 flex-1"><div className="text-sm font-black text-text-primary">{label}</div><div className="truncate text-[10px] text-text-muted">{rowDetail}</div></div></div></button>)}
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showAreaSelect} title="Choose Area" detail={isRoaming ? `${selectedArea.name} · ${selectedArea.enemyType} · Loot bias: ${selectedArea.lootBias.slice(0,2).join(', ')}` : 'Tap the scene title to switch areas.'} onClose={() => setShowAreaSelect(false)}>
          {/* Compact area stats strip — replaces the removed Roaming Intel card */}
          {isRoaming && (
            <div className="mb-3 grid grid-cols-3 gap-1.5 text-[9px]">
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Credits</span><div className="font-black text-cyan">+{creditsPerTick}/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Scrap</span><div className="font-black text-green">+{scrapPerTick}/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Gear</span><div className="font-black text-amber">{Math.round(GEAR_DROP_CHANCE * 100)}%/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Cache Frag</span><div className="font-black text-cyan">{Math.round(CACHE_FRAGMENT_CHANCE * 100)}%/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Materials</span><div className="font-black text-green">{Math.round(MATERIAL_FIND_CHANCE * 100)}%/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Enemy</span><div className="font-black text-text-primary">{selectedArea.enemyType.split(' ')[0]}</div></div>
            </div>
          )}
          <AreaPickerList onSelect={(area) => idle.setSelectedRoamingArea(area.id)} onStart={(area) => startRoam(area)} />
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showBossPicker} title="Choose Boss Target" detail="Pick your mark — check its intel and weaknesses, then prep the fight." onClose={() => setShowBossPicker(false)}>
          <BossPickerList onSelect={(boss) => startPrep(boss)} />
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showSalvagePicker} title="Choose Salvage Item" detail="Select any unlocked item to break down — salvage settles instantly. Estimates are the base scrap award; the server adds skill bonuses." onClose={() => setShowSalvagePicker(false)}>
          {salvageCandidates.map((item) => <button key={item.id} type="button" onClick={() => { setShowSalvagePicker(false); startSalvage(item); }} className="w-full border-2 border-border bg-surface p-3 text-left" style={smallClip}><div className="flex justify-between gap-2"><span className="truncate text-sm font-black text-text-primary">{item.name}</span><span className="text-[9px] text-amber">{item.rarity}</span></div><div className="mt-1 text-[10px] text-text-muted">Base ≈{salvageScrap(item.rarity, item.level)} scrap · higher rarity = more scrap</div></button>)}
        </ContextualPickerSheet>
      </AnimatePresence>
    </div>
  );
};
