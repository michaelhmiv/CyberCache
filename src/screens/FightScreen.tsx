import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Clock, Database, ChevronRight, Download, Package, Crosshair, Hammer } from 'lucide-react';
import { usePlayerStore, useInventoryStore, useIdleStore, useLoadoutStore, useBossStore, useSkillStore } from '@/store';
import { DropSource } from '@/types/game';
import { MobileCard } from '@/components/layout/MobileCard';
import { WeaponCard } from '@/components/common/WeaponCard';
import { WeaponCanvas } from '@/components/pixelArt/WeaponCanvas';
import { BossPrepModal } from '@/components/fight/BossPrepModal';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { DUSTWASTE_ZONES } from '@/constants/zones';
import { useOfflineClaim } from '@/hooks/useIdleTicker';

export const FightScreen: React.FC<{ onOpenBossSelect: () => void; onNavigate?: (screen: string) => void }> = ({
  onOpenBossSelect,
  onNavigate,
}) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const loadoutStore = useLoadoutStore();
  const idle = useIdleStore();
  const skillStore = useSkillStore();
  const skillBonuses = skillStore.getBonuses();
  const [recentDrop, setRecentDrop] = useState<any>(null);
  const [prepBoss, setPrepBoss] = useState<(typeof REGION_1_BOSSES)[0] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [claimed, setClaimed] = useState(true);
  const [showLevelUp, setShowLevelUp] = useState(false);
  const prevLevelRef = useRef(player.level);

  // Zone info (computed early — used by hooks and effects below)
  const zoneIdx = Math.min(Math.floor((player.level - 1) / 5), 9);
  const currentZone = DUSTWASTE_ZONES[Math.min(zoneIdx, DUSTWASTE_ZONES.length - 1)];
  const zoneProgress = Math.min(100, ((player.level % 5) / 5) * 100 || 100);

  const offline = useOfflineClaim(
    player.lastClaimTime,
    currentZone.idleCreditsPerMinute,
    player.offlineCapHours,
    player.workshopQueues,
    player.lastWorkshopTick,
    skillBonuses,
  );

  useEffect(() => {
    setClaimed(false);
  }, []);

  // Level-up detection
  useEffect(() => {
    if (player.level > prevLevelRef.current) {
      setShowLevelUp(true);
      setTimeout(() => setShowLevelUp(false), 2500);
    }
    prevLevelRef.current = player.level;
  }, [player.level]);

  // Background farming tick
  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed((e) => e + 1);
      const roll = Math.random();

      if (roll < 0.12) {
        // Weapon drop
        const weapon = inventory.generateAndAdd({ source: DropSource.WorldDrop, level: player.level, zoneWeights: currentZone.dropPoolRarityWeights });
        handleAutoSalvage(weapon);
        setRecentDrop(weapon);
      } else if (roll < 0.16) {
        // Shield drop
        const shield = inventory.generateAndAddShield(player.level);
        handleAutoSalvage(shield);
        setRecentDrop(shield);
      } else if (roll < 0.18) {
        // Class mod drop
        const mod = inventory.generateAndAddClassMod(player.level);
        handleAutoSalvage(mod);
        setRecentDrop(mod);
      } else if (roll < 0.20) {
        // Relic drop
        const relic = inventory.generateAndAddRelic(player.level);
        handleAutoSalvage(relic);
        setRecentDrop(relic);
      } else if (roll < 0.22) {
        // Ordnance drop
        const ord = inventory.generateAndAddOrdnance(player.level);
        handleAutoSalvage(ord);
        setRecentDrop(ord);
      }

      // Cache key fragments (every tick, 3% chance)
      if (Math.random() < 0.03) {
        player.addCacheKeyFragments(1);
      }

      // Zone-based idle credits (3s tick = 20 ticks/min) — Scavenger offlineEarnings bonus
      player.addCredits(Math.round(currentZone.idleCreditsPerMinute / 20 * (1 + (skillBonuses.offlineEarnings || 0))));
      // Zone-based idle scrap — Scavenger scrapYield bonus
      player.addScrap(Math.round(currentZone.idleScrapPerMinute / 20 * (1 + (skillBonuses.scrapYield || 0))));

      player.addXP(1);
    }, 3000);
    return () => clearInterval(iv);
  }, [player.level]);

  const handleAutoSalvage = (item: any) => {
    const rarityIndex = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'].indexOf(item.rarity);
    const thresholdIndex = ['Common', 'Uncommon', 'Rare', 'Epic'].indexOf(idle.autoSalvageRarity);
    if (rarityIndex <= thresholdIndex && (item.rollQuality || 0) <= idle.autoSalvageQuality) {
      const { scrapValue, materials, essences } = inventory.scrapItem(item.id);
      // Scavenger scrapYield bonus
      const bonusScrap = Math.round(scrapValue * (skillBonuses.scrapYield || 0));
      player.addScrap(scrapValue + bonusScrap);
      Object.entries(materials).forEach(([type, count]) => {
        if (count > 0) player.addMaterial(type, count);
      });
      Object.entries(essences).forEach(([type, count]) => {
        if (count > 0) player.addEssence(type, count);
      });
    }
  };

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
    inventory
      .getWeapons()
      .sort((a, b) => b.bossPower - a.bossPower)[0]
      ?.bossPower ||
    0;

  const isNewPlayer = inventory.items.length === 0;

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
            🎯 LEVEL UP! — Level {player.level}
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
            Loot drops every 3 seconds while farming is active. Equip your best gear in the{' '}
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

      {/* Zone Card */}
      <MobileCard className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-amber font-bold uppercase tracking-wider">
              {currentZone.regionName}
            </div>
            <div className="text-sm text-text-secondary">
              Stage {currentZone.stage} of {DUSTWASTE_ZONES.length}
            </div>
          </div>
          <Database size={20} className="text-text-muted" />
        </div>
        <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-amber rounded-full"
            style={{ width: `${zoneProgress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span>Idle: {currentZone.idleCreditsPerMinute} cr/min</span>
          <span>Enemies: {currentZone.enemyType}</span>
        </div>
        <div className="text-[10px] text-text-muted text-center">New zone every 5 levels</div>
      </MobileCard>

      {/* Farming Status */}
      <MobileCard className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-green/10 text-green flex items-center justify-center">
          <Zap size={20} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold">Farming Active</div>
          <div className="text-[10px] text-text-muted">
            Auto-scrap: {idle.autoSalvageRarity} / Q{idle.autoSalvageQuality}+ | Keys:{' '}
            {player.cacheKeys} (+{player.cacheKeyFragments}/5 frags)
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            XP: 1/tick (3s) | Drops: ~22%/tick | Key Frags: 3%/tick
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-text-muted">Cr/min</div>
          <div className="text-xs font-bold text-amber">{currentZone.idleCreditsPerMinute}</div>
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
                .filter(([_, c]) => c > 0)
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
            setClaimed(true);
          }}
        >
          <div className="w-10 h-10 rounded-full bg-amber/10 text-amber flex items-center justify-center">
            <Download size={20} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-amber">Offline Earnings Ready</div>
            <div className="text-[10px] text-text-muted">
              +{offline.credits}cr • +{offline.scrap} scrap • {Math.floor(offline.seconds / 60)}m
              offline
            </div>
          </div>
        </MobileCard>
      )}

      {/* Boss Card — shows currently selected boss */}
      {currentBoss ? (
        <MobileCard className="space-y-2 cursor-pointer" onClick={onOpenBossSelect}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-red font-bold uppercase tracking-wider">
                {isDefeated ? 'Defeated' : 'Current Target'}
              </div>
              <div className="text-lg font-black text-text-primary">{currentBoss.name}</div>
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
          <div className="text-[10px] text-text-muted text-right">Tap to change target</div>
        </MobileCard>
      ) : (
        <MobileCard className="space-y-3">
          <div className="text-sm font-bold text-text-primary">No Target Selected</div>
          <div className="text-xs text-text-muted">
            Select a boss to hunt from the boss list.
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
        {/* Quick Loot */}
        <button
          onClick={() => {
            const weapon = inventory.generateAndAdd({ source: DropSource.WorldDrop, level: player.level, zoneWeights: currentZone.dropPoolRarityWeights });
            setRecentDrop(weapon);
            player.addXP(5);
          }}
          className="bg-surface-raised border border-border text-text-primary font-bold py-2.5 rounded-xl text-xs active:scale-95 transition-transform flex flex-col items-center justify-center gap-0.5"
        >
          <span>Quick Loot</span>
          <span className="text-[9px] text-text-muted font-normal">
            Manual drop (bypasses timer)
          </span>
        </button>

        {/* Prepare Boss */}
        <button
          onClick={() => prepBossTarget && setPrepBoss(prepBossTarget)}
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

      {/* Quick Loot explanation */}
      <div className="text-[10px] text-text-muted text-center -mt-2">
        Quick Loot: Instant loot. Dev testing tool.
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
              Recent Cache Drop
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

      {/* Recent Caches Strip */}
      <div>
        <div className="text-xs text-text-muted font-bold uppercase mb-2">Recent Caches</div>
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

      {/* Boss Prep Modal */}
      <AnimatePresence>
        {prepBoss && (
          <BossPrepModal boss={prepBoss} onClose={() => setPrepBoss(null)} />
        )}
      </AnimatePresence>
    </div>
  );
};
