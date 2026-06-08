import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronRight,
  Clock,
  Crosshair,
  Download,
  Hammer,
  Lock,
  MapPin,
  Package,
  PackageSearch,
  Radar,
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
import { GearItem, Weapon } from '@/types/items';
import { MobileCard } from '@/components/layout/MobileCard';
import { WeaponCard } from '@/components/common/WeaponCard';
import { WeaponCanvas } from '@/components/pixelArt/WeaponCanvas';
import { BossPrepModal } from '@/components/fight/BossPrepModal';
import { REGION_1_BOSSES } from '@/constants/bosses';
import {
  ROAMING_AREAS,
  buildAreaWeaponDropOptions,
  getRoamingArea,
  isRoamingAreaUnlocked,
  rollAreaDropKind,
  rollAreaMaterialFind,
} from '@/constants/roamingAreas';
import { buildBossPrepActivity, buildRoamingLootActivity } from '@/lib/activity/activityBuilders';
import { useOfflineClaim } from '@/hooks/useIdleTicker';

type CombatLogEntry = {
  id: string;
  label: string;
  detail: string;
  tone: 'loot' | 'xp' | 'cache' | 'patrol';
};

const TICK_SECONDS = 3;
const LOG_LIMIT = 5;
const DROP_CHANCE_PER_TICK = 0.22;
const CACHE_FRAGMENT_CHANCE_PER_TICK = 0.03;

const describeGear = (item: GearItem) => {
  if ('weaponType' in item) return `${item.rarity} ${item.weaponType}`;
  if ('hp' in item) return `${item.rarity} Shield`;
  if ('treeBonus' in item) return `${item.rarity} Class Mod`;
  if ('damage' in item) return `${item.rarity} Ordnance`;
  return `${item.rarity} Relic`;
};

export const FightScreen: React.FC<{ onOpenBossSelect: () => void; onNavigate?: (screen: string) => void }> = ({
  onOpenBossSelect,
  onNavigate,
}) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const loadoutStore = useLoadoutStore();
  const idle = useIdleStore();
  const activity = useActivityStore();
  const skillStore = useSkillStore();
  const skillBonuses = skillStore.getBonuses();
  const [recentDrop, setRecentDrop] = useState<GearItem | null>(null);
  const [prepBoss, setPrepBoss] = useState<(typeof REGION_1_BOSSES)[0] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [claimed, setClaimed] = useState(false);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [showAreaSelect, setShowAreaSelect] = useState(false);
  const [combatLog, setCombatLog] = useState<CombatLogEntry[]>([
    {
      id: 'initial-roam',
      label: 'Activity gate armed',
      detail: 'Roaming rewards require an active server-backed roaming route.',
      tone: 'patrol',
    },
  ]);
  const prevLevelRef = useRef(player.level);

  const selectedArea = getRoamingArea(idle.selectedRoamingAreaId);
  const areaCreditsPerMinute = selectedArea.idleCreditsPerMinute;
  const areaScrapPerMinute = selectedArea.idleScrapPerMinute;
  const offlineEarningsBonus = skillBonuses.offlineEarnings || 0;
  const scrapYieldBonus = skillBonuses.scrapYield || 0;
  const bestBossWeapon = inventory
    .getWeapons()
    .sort((a, b) => b.bossPower - a.bossPower)[0];
  const activityWeapon: Weapon | undefined = loadoutStore.getWeapon('primary') ?? loadoutStore.getWeapon('secondary') ?? loadoutStore.getWeapon('heavy') ?? bestBossWeapon;
  const isRoamingActivity = activity.current.kind === 'roaming_loot';
  const activeRoamingAreaId = activity.current.targetType === 'roaming_area' ? activity.current.targetId : null;
  const roamingMatchesSelectedArea = isRoamingActivity && activeRoamingAreaId === selectedArea.id;
  const canRunRoamingTick = roamingMatchesSelectedArea && !activity.pending;
  const activityStatusLabel = canRunRoamingTick
    ? 'Roaming Active'
    : isRoamingActivity
      ? 'Roaming Paused'
      : 'Roaming Idle';
  const activityStatusDetail = canRunRoamingTick
    ? 'Server-backed route is active. Rewards may tick.'
    : isRoamingActivity
      ? `Active route is ${activity.current.targetLabel ?? activeRoamingAreaId}; switch back or start this turf.`
      : 'Start a roaming activity before this screen can generate rewards.';
  const rarityFocus = Object.entries(selectedArea.dropPoolRarityWeights)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([rarity, weight]) => `${rarity} ${weight}%`)
    .join(' / ');
  const dangerTone =
    selectedArea.dangerRating === 'Low'
      ? 'text-green bg-green/10 border-green/20'
      : selectedArea.dangerRating === 'Medium'
        ? 'text-amber bg-amber/10 border-amber/20'
        : 'text-red bg-red/10 border-red/20';

  const offline = useOfflineClaim(
    player.lastClaimTime,
    areaCreditsPerMinute,
    player.offlineCapHours,
    player.workshopQueues,
    player.lastWorkshopTick,
    skillBonuses,
  );

  const addCombatLog = useCallback((entry: Omit<CombatLogEntry, 'id'>) => {
    setCombatLog((current) => [
      {
        ...entry,
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      },
      ...current,
    ].slice(0, LOG_LIMIT));
  }, []);

  const startRoamingActivity = useCallback(async () => {
    try {
      const next = await activity.start(buildRoamingLootActivity(selectedArea, activityWeapon));
      idle.setFarming(true);
      setElapsed(0);
      addCombatLog({
        label: 'Roaming activity started',
        detail: `${next.targetLabel ?? selectedArea.name} is now the active route of record.`,
        tone: 'patrol',
      });
    } catch (error) {
      addCombatLog({
        label: 'Roaming start failed',
        detail: error instanceof Error ? error.message : 'Activity RPC rejected the transition.',
        tone: 'patrol',
      });
    }
  }, [activity, activityWeapon, addCombatLog, idle, selectedArea]);

  const stopActiveActivity = useCallback(async () => {
    try {
      await activity.clear();
      idle.setFarming(false);
      addCombatLog({
        label: 'Activity cleared',
        detail: 'Gunrunner returned to idle standby. Productive rewards are paused.',
        tone: 'patrol',
      });
    } catch (error) {
      addCombatLog({
        label: 'Activity clear failed',
        detail: error instanceof Error ? error.message : 'Activity RPC rejected the transition.',
        tone: 'patrol',
      });
    }
  }, [activity, addCombatLog, idle]);

  const startBossPrep = useCallback(async () => {
    if (!prepBossTarget) return;
    try {
      await activity.start(buildBossPrepActivity(prepBossTarget, activityWeapon));
      idle.setFarming(false);
      addCombatLog({
        label: 'Boss prep started',
        detail: `${prepBossTarget.name} is now the active activity. Roaming rewards are paused.`,
        tone: 'patrol',
      });
      setPrepBoss(prepBossTarget);
    } catch (error) {
      addCombatLog({
        label: 'Boss prep failed',
        detail: error instanceof Error ? error.message : 'Activity RPC rejected the transition.',
        tone: 'patrol',
      });
    }
  }, [activity, activityWeapon, addCombatLog, idle, prepBossTarget]);

  const handleAutoSalvage = useCallback((item: GearItem) => {
    const rarityIndex = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].indexOf(item.rarity);
    const thresholdIndex = ['Common', 'Uncommon', 'Rare', 'Epic'].indexOf(idle.autoSalvageRarity);
    const rollQuality = 'rollQuality' in item ? item.rollQuality : 0;
    if (rarityIndex <= thresholdIndex && rollQuality <= idle.autoSalvageQuality) {
      const { scrapValue, materials, essences } = inventory.scrapItem(item.id);
      const bonusScrap = Math.round(scrapValue * scrapYieldBonus);
      player.addScrap(scrapValue + bonusScrap);
      Object.entries(materials).forEach(([type, count]) => {
        if (count > 0) player.addMaterial(type, count);
      });
      Object.entries(essences).forEach(([type, count]) => {
        if (count > 0) player.addEssence(type, count);
      });
    }
  }, [idle.autoSalvageQuality, idle.autoSalvageRarity, inventory, player, scrapYieldBonus]);

  const createRoamingDrop = useCallback((autoSalvage = true) => {
    const kind = rollAreaDropKind(selectedArea);
    let item: GearItem;

    if (kind === 'weapon') {
      item = inventory.generateAndAdd(buildAreaWeaponDropOptions(selectedArea, player.level));
    } else if (kind === 'shield') {
      item = inventory.generateAndAddShield(player.level);
    } else if (kind === 'classMod') {
      item = inventory.generateAndAddClassMod(player.level);
    } else if (kind === 'relic') {
      item = inventory.generateAndAddRelic(player.level);
    } else {
      item = inventory.generateAndAddOrdnance(player.level);
    }

    if (autoSalvage) handleAutoSalvage(item);
    setRecentDrop(item);
    return item;
  }, [handleAutoSalvage, inventory, player.level, selectedArea]);

  // Level-up detection
  useEffect(() => {
    if (player.level > prevLevelRef.current) {
      setShowLevelUp(true);
      setTimeout(() => setShowLevelUp(false), 2500);
    }
    prevLevelRef.current = player.level;
  }, [player.level]);

  // Server-backed roaming tick. No active activity row means no rewards.
  useEffect(() => {
    if (!canRunRoamingTick) return undefined;

    const iv = setInterval(() => {
      setElapsed((e) => e + 1);
      let fieldDrop: GearItem | null = null;

      if (Math.random() < DROP_CHANCE_PER_TICK) {
        fieldDrop = createRoamingDrop(true);
      }

      if (Math.random() < CACHE_FRAGMENT_CHANCE_PER_TICK) {
        player.addCacheKeyFragments(1);
        addCombatLog({
          label: 'Cache fragment found',
          detail: `${selectedArea.enemyType} patrol yielded a cache key fragment.`,
          tone: 'cache',
        });
      } else if (fieldDrop) {
        addCombatLog({
          label: 'Field gear recovered',
          detail: `${fieldDrop.name} (${describeGear(fieldDrop)}) dropped in ${selectedArea.name}.`,
          tone: 'loot',
        });
      } else {
        addCombatLog({
          label: 'Enemy sweep cleared',
          detail: `${selectedArea.enemyType} routed. Credits, scrap, and XP recovered.`,
          tone: 'xp',
        });
      }

      if (Math.random() < 0.08) {
        const find = rollAreaMaterialFind(selectedArea);
        if (find?.kind === 'material') player.addMaterial(find.type, 1);
        if (find?.kind === 'essence') player.addEssence(find.type, 1);
      }

      player.addCredits(Math.round((areaCreditsPerMinute / 20) * (1 + offlineEarningsBonus)));
      player.addScrap(Math.round((areaScrapPerMinute / 20) * (1 + scrapYieldBonus)));
      player.addXP(1);
    }, 3000);

    return () => clearInterval(iv);
  }, [
    addCombatLog,
    areaCreditsPerMinute,
    areaScrapPerMinute,
    canRunRoamingTick,
    createRoamingDrop,
    offlineEarningsBonus,
    player,
    scrapYieldBonus,
    selectedArea,
  ]);

  useEffect(() => {
    if (!canRunRoamingTick) return undefined;
    const iv = setInterval(() => {
      activity.heartbeat().catch((error) => console.warn('Activity heartbeat skipped:', error));
    }, 60000);
    return () => clearInterval(iv);
  }, [activity, canRunRoamingTick]);

  // Boss targeting
  const currentBossId = bossStore.currentBossId;
  const currentBoss = currentBossId ? REGION_1_BOSSES.find((b) => b.id === currentBossId) : null;
  const isDefeated = currentBossId ? bossStore.defeatedBossIds.includes(currentBossId) : false;

  // Prepare Boss target: currentBossId first, fallback to first undefeated unlocked boss
  const prepBossTarget = (() => {
    if (currentBoss) return currentBoss;
    const fallback = REGION_1_BOSSES.find(
      (b) => bossStore.unlockedBossIds.includes(b.id) && !bossStore.defeatedBossIds.includes(b.id)
    );
    return fallback || null;
  })();

  // Power: equipped primary, or best weapon, or 0
  const fightPower =
    loadoutStore.getWeapon('primary')?.bossPower ||
    bestBossWeapon?.bossPower ||
    0;

  const isNewPlayer = inventory.items.length === 0;
  const activeMinutes = Math.floor((elapsed * TICK_SECONDS) / 60);
  const activeSeconds = (elapsed * TICK_SECONDS) % 60;
  const killsPerMinute = canRunRoamingTick ? Math.round((60 / TICK_SECONDS) * 0.75) : 0;
  const fieldFindsPerMinute = canRunRoamingTick ? Math.round((60 / TICK_SECONDS) * DROP_CHANCE_PER_TICK) : 0;

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Level Up Toast */}
      <AnimatePresence>
        {showLevelUp && (
          <motion.div
            initial={{ opacity: 0, y: -40, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -40 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-amber text-bg font-black text-lg px-6 py-3 rounded-2xl shadow-lg shadow-amber/30"
          >
            LEVEL UP - Level {player.level}
          </motion.div>
        )}
      </AnimatePresence>

      {/* First Time Player Hint */}
      {isNewPlayer && (
        <MobileCard className="space-y-2 border-amber/30 bg-amber/5">
          <div className="flex items-center gap-2">
            <Crosshair size={18} className="text-amber" />
            <div className="text-sm font-bold text-amber">Welcome, Gunrunner!</div>
          </div>
          <div className="text-xs text-text-secondary leading-relaxed">
            Roaming combat must be started as an active activity before rewards tick.
            Field enemies can drop gear, cache fragments, credits, scrap, materials, and XP.
            Equip your best gear in the{' '}
            <span className="text-text-primary font-bold">Loadout</span> tab, then hunt your first
            boss.
          </div>
        </MobileCard>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber/10 flex items-center justify-center text-amber font-bold text-sm border border-amber/20">
            {player.level}
          </div>
          <div>
            <div className="text-xs text-text-muted">Credits</div>
            <div className="text-sm font-bold text-text-primary">
              {player.credits.toLocaleString()}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-text-muted">Cache Keys</div>
            <div className="text-sm font-bold text-amber">{player.cacheKeys}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-muted">Power</div>
            <div className="text-sm font-bold text-text-primary">{fightPower}</div>
          </div>
        </div>
      </div>

      <MobileCard className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-xs text-amber font-bold uppercase tracking-wider">
                Roaming Command
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${dangerTone}`}>
                {selectedArea.dangerRating}
              </span>
            </div>
            <div className="text-lg font-black text-text-primary mt-1">{selectedArea.name}</div>
            <div className="text-xs text-text-secondary leading-relaxed">
              {selectedArea.shortDescription}
            </div>
          </div>
          <button
            onClick={() => setShowAreaSelect(true)}
            className="shrink-0 w-10 h-10 rounded-xl bg-surface-raised border border-border text-amber flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Change roaming area"
            title="Change roaming area"
          >
            <MapPin size={18} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Manufacturer</div>
            <div className="text-text-primary font-bold">{selectedArea.manufacturerInfluence}</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Rates</div>
            <div className="text-text-primary font-bold">
              {areaCreditsPerMinute} cr / {areaScrapPerMinute} scrap
            </div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Enemies</div>
            <div className="text-text-primary font-bold">{selectedArea.enemyType}</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Rarity Lean</div>
            <div className="text-text-primary font-bold">{rarityFocus}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-[10px] text-text-muted uppercase">Patrol Rate</div>
            <div className="text-xs font-bold text-text-primary">~{killsPerMinute} kills/min</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-[10px] text-text-muted uppercase">Field Finds</div>
            <div className="text-xs font-bold text-text-primary">~{fieldFindsPerMinute}/min</div>
          </div>
        </div>
        <div className="space-y-1 text-[10px] text-text-muted">
          <div>
            <span className="text-text-secondary font-bold">Loot: </span>
            {selectedArea.lootBias.join(' / ')}
          </div>
          <div>
            <span className="text-text-secondary font-bold">Materials: </span>
            {[...selectedArea.materialBias, ...selectedArea.essenceBias].join(' / ') || 'Balanced'}
          </div>
          <div className="text-amber">{selectedArea.selectionHint}</div>
        </div>
      </MobileCard>

      {/* Roaming Status */}
      <MobileCard className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${canRunRoamingTick ? 'bg-green/10 text-green' : 'bg-surface-raised text-text-muted'}`}>
          <Radar size={20} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold">{activityStatusLabel}</div>
          <div className="text-[10px] text-text-muted">
            {activityStatusDetail}
          </div>
          <div className="text-[10px] text-text-muted">
            Auto-scrap: {idle.autoSalvageRarity} / Q{idle.autoSalvageQuality}+ | Keys:{' '}
            {player.cacheKeys} (+{player.cacheKeyFragments}/5 frags)
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            XP: {canRunRoamingTick ? '1/tick (3s)' : 'paused'} | Field Finds: {canRunRoamingTick ? '~22%/tick' : 'paused'} | Key Frags: {canRunRoamingTick ? '3%/tick' : 'paused'}
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={startRoamingActivity}
              disabled={activity.pending || canRunRoamingTick}
              className="rounded-lg border border-green/30 bg-green/10 px-2 py-1 text-[10px] font-bold text-green disabled:opacity-50"
            >
              {canRunRoamingTick ? 'Active' : 'Start Roaming'}
            </button>
            <button
              type="button"
              onClick={stopActiveActivity}
              disabled={activity.pending || !isRoamingActivity}
              className="rounded-lg border border-border bg-surface-raised px-2 py-1 text-[10px] font-bold text-text-secondary disabled:opacity-50"
            >
              Stop
            </button>
          </div>
        </div>
        <div className="text-right">
          <Clock size={16} className="text-text-muted ml-auto" />
          <div className="text-[10px] text-text-muted mt-1">{activeMinutes}m {activeSeconds}s</div>
        </div>
      </MobileCard>

      {/* Material Summary */}
      {(Object.values(player.materials).some(c => c > 0) || Object.values(player.essences).some(c => c > 0)) && (
        <MobileCard className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber/10 border border-amber/30 flex items-center justify-center shrink-0">
            <Hammer size={14} className="text-amber" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="text-[10px] font-bold text-amber">Materials & Essences</div>
              <button
                onClick={() => onNavigate?.('workshop')}
                className="text-[9px] px-1.5 py-0.5 rounded bg-amber/10 border border-amber/30 text-amber font-bold active:scale-95 transition-transform"
              >
                Workshop →
              </button>
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">
              {Object.entries({ ...player.materials, ...player.essences })
                .filter(([, c]) => c > 0)
                .slice(0, 4)
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ')}
              {(Object.values({ ...player.materials, ...player.essences }).filter(c => c > 0).length > 4) ? ' · ...' : ''}
            </div>
          </div>
        </MobileCard>
      )}

      {/* Offline Claim */}
      {offline.credits > 0 && !claimed && (
        <MobileCard
          className="flex items-center gap-3 cursor-pointer"
          onClick={() => {
            player.addCredits(offline.credits);
            player.addScrap(offline.scrap);
            player.setPlayer({ lastClaimTime: Date.now() });
            addCombatLog({
              label: 'Field cache retrieved',
              detail: `Offline roaming brought back ${offline.credits} credits and ${offline.scrap} scrap.`,
              tone: 'loot',
            });
            setClaimed(true);
          }}
        >
          <div className="w-10 h-10 rounded-full bg-amber/10 text-amber flex items-center justify-center">
            <Download size={20} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-amber">Offline Earnings Ready</div>
            <div className="text-[10px] text-text-muted">
              +{offline.credits}cr / +{offline.scrap} scrap / {Math.floor(offline.seconds / 60)}m
              offline
            </div>
          </div>
        </MobileCard>
      )}

      {/* Boss Card - shows currently selected boss */}
      {currentBoss ? (
        <MobileCard className="space-y-2 cursor-pointer" onClick={onOpenBossSelect}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-red font-bold uppercase tracking-wider">
                {isDefeated ? 'Defeated Boss' : 'Prepare Boss Fight'}
              </div>
              <div className="text-lg font-black text-text-primary">{currentBoss.name}</div>
              <div className="text-[10px] text-text-muted">
                Intentional encounter. Tune loadout and consumables before engaging.
              </div>
            </div>
            <ChevronRight size={20} className="text-text-muted" />
          </div>
          <div className="flex flex-wrap gap-2">
            {currentBoss.weaknesses.map((e) => (
              <span
                key={e}
                className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green font-bold"
              >
                {e}
              </span>
            ))}
            {currentBoss.resistances.map((e) => (
              <span
                key={e}
                className="text-[10px] px-1.5 py-0.5 rounded bg-red/10 text-red font-bold"
              >
                {e}
              </span>
            ))}
          </div>
          <div className="text-[10px] text-amber">{currentBoss.mechanic.description}</div>
          <div className="text-[10px] text-text-muted text-right">Tap to change boss target</div>
        </MobileCard>
      ) : (
        <MobileCard className="space-y-3">
          <div className="text-sm font-bold text-text-primary">No Target Selected</div>
          <div className="text-xs text-text-muted">
            Bosses are separate prep encounters. Select one when you are ready to plan a loadout.
          </div>
          <button
            onClick={onOpenBossSelect}
            className="w-full bg-amber/10 border border-amber/20 text-amber font-bold py-2 rounded-xl text-xs active:scale-95 transition-transform"
          >
            Choose Boss Target
          </button>
        </MobileCard>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-2">
        {/* Manual Field Sweep */}
        <button
          disabled={!canRunRoamingTick}
          onClick={() => {
            if (!canRunRoamingTick) return;
            const drop = createRoamingDrop(false);
            player.addXP(5);
            addCombatLog({
              label: 'Manual field sweep',
              detail: `${drop.name} dropped during an active sweep of ${selectedArea.name}.`,
              tone: 'loot',
            });
          }}
          className="bg-surface-raised border border-border text-text-primary font-bold py-2.5 rounded-xl text-xs active:scale-95 transition-transform flex flex-col items-center justify-center gap-0.5 disabled:opacity-50"
        >
          <span>Field Sweep</span>
          <span className="text-[9px] text-text-muted font-normal">
            Requires active route
          </span>
        </button>

        {/* Prepare Boss */}
        <button
          onClick={startBossPrep}
          className={`font-bold py-2.5 rounded-xl text-xs active:scale-95 transition-transform ${
            prepBossTarget
              ? 'bg-amber text-bg'
              : 'bg-surface-raised border border-border text-text-muted'
          }`}
        >
          {prepBossTarget ? 'Prepare Boss' : 'No Target'}
        </button>

        {/* Open Caches */}
        <button
          onClick={() => onNavigate?.('chest')}
          className="bg-surface-raised border border-border text-text-primary font-bold py-2.5 rounded-xl text-xs active:scale-95 transition-transform flex flex-col items-center justify-center gap-0.5"
        >
          <div className="flex items-center gap-1">
            <Package size={11} />
            <span>Open Caches</span>
          </div>
          <span className="text-[9px] text-text-muted font-normal">
            Use Cache Keys for Rare+ gear
          </span>
        </button>
      </div>

      {/* Field Sweep explanation */}
      <div className="text-[10px] text-text-muted text-center -mt-2">
        Field Sweep: Instant result is disabled unless the selected turf is the active activity.
      </div>

      {/* Recent Drop */}
      <AnimatePresence>
        {recentDrop && (
          <motion.div
            key={recentDrop.id}
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            <div className="text-xs text-text-muted font-bold uppercase flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber animate-pulse" />
              Recent Field Find
            </div>
            {'weaponType' in recentDrop ? (
              <WeaponCard weapon={recentDrop} />
            ) : (
              <MobileCard className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-surface-raised border border-border flex items-center justify-center text-text-muted text-[10px]">
                  {recentDrop.rarity || 'Gear'}
                </div>
                <div>
                  <div className="text-xs font-bold text-text-primary">
                    {recentDrop.name || 'Item'}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    Lv.{recentDrop.level} · {recentDrop.rarity}
                  </div>
                </div>
              </MobileCard>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Combat Log */}
      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-text-muted font-bold uppercase">
          <Crosshair size={14} />
          Combat Log
        </div>
        <div className="space-y-2">
          {combatLog.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 rounded-lg bg-surface-raised border border-border p-2">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                entry.tone === 'loot' ? 'bg-amber' : entry.tone === 'cache' ? 'bg-blue-400' : entry.tone === 'xp' ? 'bg-green' : 'bg-text-muted'
              }`} />
              <div>
                <div className="text-xs font-bold text-text-primary">{entry.label}</div>
                <div className="text-[10px] text-text-muted">{entry.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </MobileCard>

      {/* Recent Field Finds Strip */}
      <div>
        <div className="text-xs text-text-muted font-bold uppercase mb-2 flex items-center gap-2">
          <PackageSearch size={14} />
          Recent Field Finds
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {inventory
            .getWeapons()
            .slice(0, 10)
            .map((w) => (
              <div
                key={w.id}
                className="shrink-0 w-14 h-14 rounded-lg bg-surface border border-border flex items-center justify-center overflow-hidden"
              >
                <WeaponCanvas
                  type={w.weaponType}
                  manufacturer={w.manufacturer}
                  element={w.element}
                  rarity={w.rarity}
                  size={48}
                />
              </div>
            ))}
        </div>
      </div>

      <AnimatePresence>
        {showAreaSelect && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-bg/90 backdrop-blur-sm p-4 overflow-y-auto"
          >
            <div className="mx-auto max-w-lg space-y-3 pb-10">
              <div className="flex items-center justify-between sticky top-0 bg-bg/95 py-2">
                <div>
                  <div className="text-xs text-amber font-bold uppercase tracking-wider">
                    Select Roaming Area
                  </div>
                  <div className="text-[10px] text-text-muted">
                    Areas shape roaming rewards. Switching turf does not start rewards until activity is updated.
                  </div>
                </div>
                <button
                  onClick={() => setShowAreaSelect(false)}
                  className="w-9 h-9 rounded-xl bg-surface-raised border border-border text-text-primary flex items-center justify-center"
                  aria-label="Close area selector"
                  title="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {ROAMING_AREAS.map((area) => {
                const unlocked = isRoamingAreaUnlocked(area, player.level);
                const selected = area.id === selectedArea.id;
                const areaDangerTone =
                  area.dangerRating === 'Low'
                    ? 'text-green border-green/20 bg-green/10'
                    : area.dangerRating === 'Medium'
                      ? 'text-amber border-amber/20 bg-amber/10'
                      : 'text-red border-red/20 bg-red/10';

                return (
                  <button
                    key={area.id}
                    disabled={!unlocked}
                    onClick={() => {
                      if (!unlocked) return;
                      idle.setSelectedRoamingArea(area.id);
                      setShowAreaSelect(false);
                    }}
                    className={`w-full text-left rounded-xl border p-3 transition-colors ${
                      selected
                        ? 'bg-amber/10 border-amber/40'
                        : 'bg-surface border-border active:bg-surface-raised'
                    } ${!unlocked ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="text-sm font-black text-text-primary">{area.name}</div>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-bold ${areaDangerTone}`}>
                            {area.dangerRating}
                          </span>
                          {selected && <span className="text-[9px] text-amber font-bold">Current</span>}
                        </div>
                        <div className="text-[10px] text-text-muted mt-0.5">
                          {area.manufacturerInfluence} / Lv.{area.unlockLevel}
                        </div>
                      </div>
                      {!unlocked && <Lock size={14} className="text-text-muted shrink-0 mt-1" />}
                    </div>
                    <div className="text-xs text-text-secondary leading-relaxed mt-2">
                      {area.gameplayIdentity}
                    </div>
                    <div className="text-[10px] text-text-muted mt-2">
                      Enemies: {area.enemyType}
                    </div>
                    <div className="text-[10px] text-text-muted">
                      Focus: {area.lootBias.join(' / ')}
                    </div>
                    <div className="text-[10px] text-amber mt-1">
                      {unlocked ? area.selectionHint : `Locked until level ${area.unlockLevel}.`}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {prepBoss && (
          <BossPrepModal boss={prepBoss} onClose={() => setPrepBoss(null)} />
        )}
      </AnimatePresence>
    </div>
  );
};
