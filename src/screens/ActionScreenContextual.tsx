import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence } from 'framer-motion';
import {
  useActivityStore,
  useBossStore,
  useCombatStatsStore,
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
import { HeroRundown } from '@/components/dashboard/HeroRundown';
import { useOfflineCapHours } from '@/hooks/useOfflineCapHours';
import { useActionHeartbeat } from '@/components/activity/useActionHeartbeat';
import { REGION_1_BOSSES } from '@/constants/bosses';
import {
  getRoamingArea,
  type RoamingAreaDef,
} from '@/constants/roamingAreas';
import {
  buildBossFightActivity,
  buildRoamingLootActivity,
} from '@/lib/activity/activityBuilders';
import { verifiedOps } from '@/lib/api/verifiedOps';
import { trackScreen } from '@/lib/analytics/analytics';
import { salvageYieldFromRecycleResult } from '@/lib/gear/salvageAward';
import { getVisualAsset } from '@/constants/visualAssets';
import { salvageScrap } from '@/lib/skills/salvageBonuses';
import { GEAR_DROP_CHANCE, MATERIAL_FIND_CHANCE } from '@/content/roamingRates';
import { isClassMod, isOrdnance, isRelic, isShield, isWeapon } from '@/lib/gear/gearCardSummary';
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
import { HomeCraftBench } from '@/components/workshop/HomeCraftBench';

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
  startSalvage: (item?: GearItem) => void;
  onNavigate?: (screen: string) => void;
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


export const ActionScreenContextual: React.FC<{
  onOpenBossSelect: () => void;
  onNavigate?: (screen: string) => void;
  /**
   * Craft-bench intent (crafting consolidation, 2026-11-04): every
   * 'workshop' door in the app (the Gear status strip, the Garage
   * remedy doors) routes through App's alias to Home with this
   * seq-stamped intent, and the bench workspace opens on arrival —
   * the same intent pattern the Gear tab's tabIntent uses.
   */
  craftBenchIntent?: { seq: number } | null;
}> = ({ onOpenBossSelect, onNavigate, craftBenchIntent = null }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const loadoutStore = useLoadoutStore();
  const idle = useIdleStore();
  const activity = useActivityStore();
  const workshop = useWorkshopStore();
  const market = useMarketStore();
  const skillStore = useSkillStore();
  const skillBonuses = skillStore.getBonuses();
  // The standby panel's Away cell: the effective offline cap
  // (Home consolidation — the retired stats band's AFK entry
  // rehoused in the Roam panel's facts grid).
  const offlineCapHours = useOfflineCapHours();
  const [showSwitch, setShowSwitch] = useState(false);
  const [showAreaSelect, setShowAreaSelect] = useState(false);
  const [showBossPicker, setShowBossPicker] = useState(false);
  const [showSalvagePicker, setShowSalvagePicker] = useState(false);
  const [showEndless, setShowEndless] = useState(false);
  const [showExtraction, setShowExtraction] = useState(false);
  // The Craft bench as a view (consolidation, 2026-11-04): like the
  // Endless/Extraction prep panels, the bench workspace can open
  // WITHOUT claiming the action slot — looking at the bench never
  // switches the action; its own Work the Bench control does.
  const [showCraftBench, setShowCraftBench] = useState(false);
  // A fresh craft intent re-applies even while Home is mounted
  // (render-phase adjustment, the InventoryScreen tabIntent
  // pattern): the intent lands in the same commit as the
  // navigation that carried it.
  const [appliedCraftIntentSeq, setAppliedCraftIntentSeq] = useState<number | null>(null);
  if (craftBenchIntent && craftBenchIntent.seq !== appliedCraftIntentSeq) {
    setAppliedCraftIntentSeq(craftBenchIntent.seq);
    setShowCraftBench(true);
    setShowEndless(false);
    setShowExtraction(false);
    setShowSwitch(false);
  }
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
  // the Craft workspace shows settled progress / paused reasons.
  const refreshWorkshop = workshop.refresh;
  useEffect(() => {
    void refreshWorkshop();
  }, [refreshWorkshop, currentKind]);
  // Analytics: the Endless Chamber owns the workspace while a run
  // holds the slot or its prep is open from the switch grid — that
  // is a screen of its own in the GA4 table.
  const endlessVisible = currentKind === 'endless_run' || showEndless;
  useEffect(() => {
    if (endlessVisible) trackScreen('Endless');
  }, [endlessVisible]);
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
  const salvageCandidates = inventory.items.filter((item) => !item.isLocked).slice(0, 12);

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
      setShowCraftBench(false);
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
    return startAction(buildRoamingLootActivity(target, activityWeapon), makeRunEvent('ROAMING AREA', `Hunter is roaming ${target.name}.`, 'patrol', 'run_started'));
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
      // The toast names what the server actually paid (Scrap, cores,
      // and the narrow King-of-Scrap bonus material) — the one mapper.
      useSalvageFeedStore.getState().push(item, salvageYieldFromRecycleResult(result));
      pushEvents([makeRunEvent(
        'SALVAGED',
        `${item.name} recycled for +${award} scrap${cores > 0 ? ` · +${cores} legendary core${cores === 1 ? '' : 's'}` : ''}${bonusMaterial ? ` · +1 ${getVisualAsset('material', bonusMaterial).label}` : ''}.`,
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

  // Live-action sync: foreground heartbeat on the 3s game tick
  // (owner cadence, 2026-11-02) — see useActionHeartbeat for the
  // cadence constant and its in-flight / visibility / backoff guards.
  //
  // Active play time rides the same pulse (gear-truth slice):
  // combat stats' addPlaytime had NO caller anywhere, so
  // active_play_seconds stayed 0 and Profile's Active Time read
  // "0s" after any amount of play. Each beat credits the real
  // elapsed time since the previous beat — capped at two cadences
  // (6s) so a backgrounded stretch, which the hook's visibility
  // guard already skips, can never be credited — and the combat
  // stats row is persisted on a slow throttle so the accrual
  // reaches the server record the Profile stats summary reads.
  const lastBeatAtRef = useRef<number | null>(null);
  const lastPlaytimeSaveAtRef = useRef(0);
  const heartbeat = useCallback(() => {
    const now = Date.now();
    const last = lastBeatAtRef.current;
    lastBeatAtRef.current = now;
    if (last != null) {
      const elapsedSeconds = Math.min((now - last) / 1000, 6);
      if (elapsedSeconds > 0) {
        useCombatStatsStore.getState().addPlaytime(elapsedSeconds, 'active');
        if (now - lastPlaytimeSaveAtRef.current > 30_000) {
          lastPlaytimeSaveAtRef.current = now;
          const playerId = usePlayerStore.getState().id;
          if (playerId) {
            void import('@/store/combatStatsSupabaseSync')
              .then(({ saveCombatStats }) => saveCombatStats(playerId))
              .catch(() => undefined);
          }
        }
      }
    }
    return activity.heartbeat();
  }, [activity]);
  useActionHeartbeat(canTick, heartbeat);

  const feedEntries: ActionFeedEntry[] = visualFeed.map((event) => ({
    ...event,
    gear: (event as { gear?: GearItem }).gear,
  }));

  const commonProps: CommonPanelProps = { playerLevel: player.level, selectedArea, setSelectedArea: idle.setSelectedRoamingArea, startRoam, startPrep, startBossFight, openBoss: onOpenBossSelect, startSalvage, onNavigate };

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

    // The Workshop (crafting consolidation, owner ruling
    // 2026-11-04): Home's Craft workspace IS the bench — recipes,
    // queue, bench-time bank, and the Repairs & Service section.
    // It owns the workspace while Crafting or Workshop Service
    // holds the slot, and opens as a view from the rail's Craft
    // stop / a 'workshop' door without claiming the slot: the
    // bench prints its paused truth and its own Work the Bench
    // control claims the slot. No second animated scene — the
    // main stage above carries the activity scene (one-stage law).
    if (currentKind === 'crafting' || currentKind === 'workshop_service' || showCraftBench) {
      return (
        <HomeCraftBench
          onNavigate={onNavigate}
          onLeave={
            showCraftBench && currentKind !== 'crafting' && currentKind !== 'workshop_service'
              ? () => setShowCraftBench(false)
              : undefined
          }
        />
      );
    }

    // Idle/standby: the Roam panel (drift-fix F2, the approved
    // mock's anatomy) — the ONE primary action bar lives here in
    // the workspace, not on the stage: area facts, the full-width
    // Start Roam, and the full-width Change Area door. Before F2
    // the only Start Roam door was a button bar printed over the
    // stage art, beside a duplicate door to the Switch Action
    // sheet. Home consolidation (2026-11-03): the ghost row's
    // Loadout · n/7 door is gone — the count lives once, on the
    // stage's count plate — and the facts grid gains the Away
    // cell (the retired stats band's AFK entry): while you are
    // gone this area keeps paying at the rates above, up to the
    // effective offline cap.
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
              longest cell. The Away cell rides the same grammar. */}
          <div data-testid="home-standby-facts" className="relative mt-2 grid grid-cols-[minmax(0,0.72fr)_minmax(0,0.72fr)_minmax(0,0.84fr)_minmax(0,0.84fr)_minmax(0,1.5fr)] gap-1.5 text-[11px]">
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
              <div className="text-text-muted">Away</div>
              <div className="font-black text-text-primary">cap {offlineCapHours}h</div>
            </div>
            <div className="flex min-w-0 flex-col items-center justify-center border border-border bg-bg/70 p-1.5 text-center" style={smallClip}>
              <div className="text-text-muted">Hostiles</div>
              <div className="font-black leading-[1.15] text-text-primary [text-wrap:balance]">{selectedArea.enemyType}</div>
            </div>
          </div>
          <button type="button" onClick={() => startRoam()} className="bl-primary relative mt-3 w-full py-3 text-sm font-black">
            Start Roam
          </button>
          {/* Owner rework 2026-11-04: the Switch Action door
              lives in the workspace now — its swap-arrow chip
              left the stage (Stop took the corner), but the
              sheet it opens is still Salvage's door from Home,
              so the opener rides beside Change Area here and
              in the roaming panel. */}
          <div className="relative mt-2 flex gap-2">
            <button type="button" onClick={() => setShowAreaSelect(true)} className="bl-secondary min-h-[44px] flex-1 px-3 py-2 text-[11px] font-black text-amber">
              Change Area
            </button>
            <button type="button" onClick={() => setShowSwitch(true)} aria-label="Switch Action" className="bl-secondary flex h-11 w-11 shrink-0 items-center justify-center text-amber"><PxIcon name="swap" size={17} /></button>
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
            <div className="flex shrink-0 items-start gap-1.5">
              <button type="button" onClick={() => setShowAreaSelect(true)} className="bl-secondary px-2 py-1 text-[9px] font-black text-amber">
                Change Area
              </button>
              <button type="button" onClick={() => setShowSwitch(true)} aria-label="Switch Action" className="bl-secondary flex h-11 w-11 items-center justify-center text-amber"><PxIcon name="swap" size={17} /></button>
            </div>
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
              <div className="text-text-muted">Cache Key</div>
              <div className="font-black text-cyan">~1 per 7h</div>
            </div>
          </div>
          <div className="relative mt-2 pt-2 border-t border-border/40 text-[9px] text-text-muted">
            {selectedArea.gameplayIdentity} · <ActionTickTimer key={`tick-${selectedArea.id}-${currentKind}`} tickSeconds={TICK_SECONDS} enabled={canTick} variant="active" className="text-amber" />
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

    if (currentKind === 'salvaging') return <SalvagePanel {...commonProps} items={inventory.items} onSalvagePicker={() => setShowSalvagePicker(true)} />;
    if (currentKind === 'market_listing') return <Section title="Market relocated" eyebrow="market owns listings" icon={<ActivityGlyph kind="market_listing" />}><div className="space-y-2 text-xs text-text-muted"><div>Trading now lives on the Market tab.</div><button type="button" onClick={() => onNavigate?.('market')} className="bl-primary w-full py-2 text-xs font-black">Open Market</button></div></Section>;
    return null; // fallback: no workspace panel needed
  })();

  // The view panels are mutually exclusive (QC B2): opening one
  // replaces the others, so the workspace and the rail's lit stop
  // always agree on which mode is open.
  const openEndless = useCallback(() => {
    setShowExtraction(false);
    setShowCraftBench(false);
    setShowEndless(true);
    setShowSwitch(false);
  }, []);

  const openExtraction = useCallback(() => {
    setShowEndless(false);
    setShowCraftBench(false);
    setShowExtraction(true);
    setShowSwitch(false);
  }, []);

  // The bench opens as a VIEW (consolidation, 2026-11-04): the
  // action slot is untouched — the bench's own Work the Bench
  // control is the switch, so a paused bench can be inspected
  // (and its queue managed) without abandoning the current action.
  const openCraftBench = useCallback(() => {
    setShowEndless(false);
    setShowExtraction(false);
    setShowCraftBench(true);
    setShowSwitch(false);
  }, []);

  // Mode rail (redesign Wave C, DESIGN.md §2/§4): the stage's
  // five stops — Roam · Boss · Endless · Extract · Craft.
  // Endless / Extract / Craft were promoted here from the mode
  // sheet (2 taps → 1); the sheet (switchActions below) keeps
  // every path it had, Salvage included — the rail ADDS the
  // first-class doors, it does not remove the sheet's.
  const railActiveStop: HomeModeRailStop | null =
    isRoaming ? 'roam'
    : (isBossPrep || isBossFight || isBossResolved) ? 'boss'
    : (currentKind === 'endless_run' || showEndless) ? 'endless'
    : (currentKind === 'extraction' || showExtraction) ? 'extract'
    : (currentKind === 'crafting' || currentKind === 'workshop_service' || showCraftBench) ? 'craft'
    : null;

  const handleRailSelect = useCallback((stop: HomeModeRailStop) => {
    switch (stop) {
      // Roam is the area door (owner ruling, 2026-11-04 — the
      // rail's separate Area stop is gone). Entering roam from
      // any other activity starts the roam in the current/last
      // area AND auto-opens the area picker, so switching in
      // always surfaces the location options; tapping Roam
      // while already roaming opens the picker alone (picking
      // switches the roam target; dismissing leaves the roam
      // untouched). The picker opens AFTER the start settles:
      // startAction closes every sheet as its last step, so an
      // eager open here would be shut again by the start itself.
      case 'roam':
        if (isRoaming) {
          setShowAreaSelect(true);
        } else {
          void startRoam().then(() => setShowAreaSelect(true));
        }
        break;
      case 'boss': setShowBossPicker(true); break;
      case 'endless': openEndless(); break;
      case 'extract': openExtraction(); break;
      case 'craft': openCraftBench(); break;
    }
  }, [isRoaming, startRoam, openEndless, openExtraction, openCraftBench]);

  const switchActions = [
    { label: 'Roam', detail: selectedArea.name, icon: <ActivityGlyph kind="roaming_loot" size={16} /> as React.ReactNode, run: () => startRoam() },
    { label: 'Boss Prep', detail: prepBossTarget?.name ?? 'Choose target', icon: <ActivityGlyph kind="boss_fight" size={16} /> as React.ReactNode, run: () => startPrep() },
    { label: 'Boss Fight', detail: prepBossTarget?.name ?? 'Choose target', icon: <PxIcon name="crosshair" size={17} className="text-amber" /> as React.ReactNode, run: () => startBossFight() },
    { label: 'Endless', detail: 'Chaos Chamber', icon: <ActivityGlyph kind="endless_run" size={16} /> as React.ReactNode, run: openEndless },
    { label: 'Extract', detail: selectedArea.name, icon: <ActivityGlyph kind="extraction" size={16} /> as React.ReactNode, run: openExtraction },
    { label: 'Craft', detail: 'The bench — recipes, queue, repairs', icon: <ActivityGlyph kind="crafting" size={16} /> as React.ReactNode, run: openCraftBench },
    { label: 'Salvage', detail: `${inventory.items.length} items`, icon: <ActivityGlyph kind="salvaging" size={16} /> as React.ReactNode, run: () => startSalvage() },
  ].slice(0, MAX_SWITCH_ROWS);

  // Action controls (owner rulings 2026-11-02; ICON-ONLY
  // 2026-11-03; REWORKED by owner ruling 2026-11-04): Stop
  // floats ON the stage as a plate in the plates' language —
  // the stage places it top-left. Until this rework the corner
  // carried two chips: the Switch Action door (whose §7 swap
  // glyph is literally two opposing arrows) and Stop beside
  // it. The owner ordered the "arrows" off the stage and Stop
  // moved left into their place — so the stage now carries
  // Stop alone, leftmost, while an action runs; at standby
  // there is no Stop at all (it rendered disabled — a
  // permanent no-op chip on the art), so nothing functional
  // leaves the idle stage. The Switch sheet did NOT die with
  // its stage chip: it is still the door to Salvage, which has
  // no rail stop, so its opener moved into the standby and
  // roaming workspace panels (same aria-label, same sheet).
  // Stop stays an icon-only pixel glyph (stop from the §7
  // sheet) in a 44px square — the word lives in the aria-label.
  const actionRunning = currentKind !== 'idle_standby' && currentKind !== 'none';
  const stageControls = actionRunning ? (
    <button type="button" onClick={stopAction} disabled={activity.pending} aria-label="Stop" className="bl-secondary flex h-11 w-11 items-center justify-center text-red shadow-[4px_4px_0_rgba(0,0,0,0.62)] disabled:opacity-50"><PxIcon name="stop" size={17} /></button>
  ) : null;

  return (
    <div className="bl-page relative flex flex-col gap-3 overflow-hidden">
      {/* Section-gap law (owner, 2026-11-05): this block is a
          stack of Home sections (rail → stage → belt →
          workspace → feed) on the ONE 8px section gap
          (--cc-gap-md; gap-3 under .bl-page) — no nested page
          padding of its own (the p-3/pb-20 it carried as a
          once-standalone screen made its boundaries 30px and
          18px against 6–12px everywhere else). Home's own
          page pad frames the column; its pb-16 clears the
          BottomNav. */}
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

      {/* §4: above the Stage sit only the Strip, the claim chips,
          and — since the owner's device ruling of 2026-11-04 — the
          mode rail. The Stop control floats ON the stage (owner
          rulings 2026-11-02, icon-only 2026-11-03, reworked
          2026-11-04 — see stageControls below); the dedicated
          controls row that used to sit under the mode rail is
          gone, and the claim-sync line moved down to the session
          feed it describes. Home consolidation (2026-11-03): the
          research chip and the course-complete card left this
          zone too — the education track's state lives on
          Hunter → Research, and a finished course now arrives as
          a Next Move below the stage. The current-area bar that
          used to share this row is gone (drift-fix F2), and the
          stage's own area plate followed it (owner ruling
          2026-11-02): the area affordance is the mode rail's
          ROAM stop (Roam is the area door — owner ruling
          2026-11-04) plus the workspace panels' Change Area
          buttons, and the stage's top-left belongs to Stop
          alone. */}

      {/* 1. Mode rail (§2/§4) — the stage's five stops, ABOVE the
          diorama since the owner's device ruling of 2026-11-04:
          the mode vocabulary leads the screen, one tap from
          everything below it. This replaces the old compact
          action selector grid: Endless, Extract, and Craft are
          first-class rail stops now (1 tap), Roam carries area
          selection (the separate Area stop is gone, 2026-11-04),
          and the Switch Action sheet below keeps every path it
          had, Salvage included. */}
      <div className="relative">
        <HomeModeRail activeStop={railActiveStop} onSelect={handleRailSelect} />
      </div>

      {/* 2. Stage + hero rundown — the rundown attaches to the
          stage's foot (Home consolidation): the ribbon's mode
          word and its ~15-stat scroller are replaced by two
          rows of tappable heroes (DPS · Dmg/tick · Crit % ·
          Crit × over HP · Shield · Mit · Shield Break), each
          opening its source breakdown. The wrapper keeps the
          two flush — no composition gap between art and
          rundown. */}
      <div className="relative">
        <LiveTurfDiorama
          area={selectedArea}
          weapon={activityWeapon}
          bossName={prepBossTarget?.name}
          boss={currentKind === 'boss_fight' ? (currentBoss ?? prepBossTarget) : undefined}
          playerLevel={player.level}
          equippedCount={equippedCount}
          activityKind={currentKind}
          bossPhase={bossPhase}
          stageControls={stageControls}
        />
        <HeroRundown boss={currentKind === 'boss_fight' ? (currentBoss ?? prepBossTarget) : null} />
      </div>

      {/* 3. Consumable belt (§4) — in the mode rail's vacated
          position since the owner's device ruling of 2026-11-04:
          directly under the stage block, above the lit workspace,
          so the use-in-loop slots sit between the rundown and the
          mode's panel. It lived in the deck before Wave C and
          under the workspace until this swap — same component,
          relocated, mounted exactly once. Home consolidation
          (2026-11-03): the belt row also carries the vehicle chip
          now (owner correction — the bike gets no row of its own),
          and the blocks that used to stack under the workspace are
          gone from Home: the vehicle status line (its chip + the
          Garage's line carry the state), the read-only Loadout
          block (Gear → Loadout is the canonical surface), the
          Activity Modifiers panel (its glance folded into the
          rundown's buff line, its detail into the breakdown
          sheets), and the compact HP/Keys/Tick strip (HP → the HP
          plate + the hero rundown, Keys → the Strip, Tick → the
          workspace footer and the feed). */}
      <ConsumableBelt onNavigate={(target) => onNavigate?.(target)} />

      {/* 4. Action-specific panel — the lit workspace */}
      {workspace}

      {/* Claim sync stall: visible when roaming claims stop landing
          (ticker-exposed flag) — rewards are paused, not silently
          lost. It prints in the session zone above the feed it
          describes (v2 composition), not above the Stage. */}
      <ClaimSyncStatusLine />

      {/* 6. Feed — loot log below the decision panels. Dropped items
          are actionable from their inspect sheet (F11). */}
      <ActionFeed entries={feedEntries} onGearEquip={handleFeedEquip} onGearSalvage={handleFeedSalvage} gearActionBusy={feedActionBusy} gearActionError={feedActionError} onOpenFullLog={() => onNavigate?.('activity-log')} />

      {/* Drawers — unchanged */}
      <AnimatePresence>
        <ContextualPickerSheet open={showSwitch} title="Switch Action" detail="Broad action changes live in this drawer instead of crowding the Action tab." onClose={() => setShowSwitch(false)}>
          {switchActions.map(({ label, detail: rowDetail, icon, run }) => <button key={label} type="button" onClick={run} className="w-full border-2 border-border bg-surface p-3 text-left" style={smallClip}><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center border-2 border-border bg-bg text-amber">{icon}</div><div className="min-w-0 flex-1"><div className="text-sm font-black text-text-primary">{label}</div><div className="truncate text-[10px] text-text-muted">{rowDetail}</div></div></div></button>)}
        </ContextualPickerSheet>
        <ContextualPickerSheet open={showAreaSelect} title="Choose Area" detail={isRoaming ? `${selectedArea.name} · ${selectedArea.enemyType} · Loot bias: ${selectedArea.lootBias.slice(0,2).join(', ')}` : 'Pick where roaming happens — the stage follows the area you choose.'} onClose={() => setShowAreaSelect(false)}>
          {/* Compact area stats strip — replaces the removed Roaming Intel card */}
          {isRoaming && (
            <div className="mb-3 grid grid-cols-3 gap-1.5 text-[9px]">
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Credits</span><div className="font-black text-cyan">+{creditsPerTick}/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Scrap</span><div className="font-black text-green">+{scrapPerTick}/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Gear</span><div className="font-black text-amber">{Math.round(GEAR_DROP_CHANCE * 100)}%/tick</div></div>
              <div className="border border-border bg-bg/70 p-1.5" style={smallClip}><span className="text-text-muted">Cache Key</span><div className="font-black text-cyan">~1 per 7h</div></div>
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
