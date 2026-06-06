import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Clock, Database, ChevronRight, Download } from 'lucide-react';
import { usePlayerStore, useInventoryStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { WeaponCard } from '@/components/common/WeaponCard';
import { WeaponCanvas } from '@/components/pixelArt/WeaponCanvas';
import { BossPrepModal } from '@/components/fight/BossPrepModal';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { useBossStore } from '@/store/slices/bossSlice';
import { useOfflineClaim } from '@/hooks/useIdleTicker';

export const FightScreen: React.FC = () => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();
  const [recentDrop, setRecentDrop] = useState<ReturnType<typeof inventory.generateAndAdd> | null>(null);
  const [prepBoss, setPrepBoss] = useState<typeof REGION_1_BOSSES[0] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [claimed, setClaimed] = useState(true);
  const offline = useOfflineClaim(player.lastClaimTime, 15, player.offlineCapHours);

  useEffect(() => {
    setClaimed(false);
  }, []);

  // Background farming tick
  useEffect(() => {
    const iv = setInterval(() => {
      setElapsed((e) => e + 1);
      if (Math.random() < 0.15) {
        const weapon = inventory.generateAndAdd({ source: 'World Drop', level: player.level });
        setRecentDrop(weapon);
      }
      player.addXP(1);
    }, 3000);
    return () => clearInterval(iv);
  }, [player.level]);

  const unlockedBosses = REGION_1_BOSSES.filter((b) => bossStore.unlockedBossIds.includes(b.id));
  const currentBoss = unlockedBosses[unlockedBosses.length - 1];

  return (
    <div className="p-4 space-y-4 pb-20">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber/10 flex items-center justify-center text-amber font-bold text-sm border border-amber/20">
            {player.level}
          </div>
          <div>
            <div className="text-xs text-text-muted">Credits</div>
            <div className="text-sm font-bold text-text-primary">{player.credits.toLocaleString()}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-text-muted">Cache Keys</div>
            <div className="text-sm font-bold text-amber">{player.cacheKeys}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-text-muted">Power</div>
            <div className="text-sm font-bold text-text-primary">
              {inventory.getWeapons()[0]?.bossPower || 0}
            </div>
          </div>
        </div>
      </div>

      {/* Zone Card */}
      <MobileCard className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-amber font-bold uppercase tracking-wider">Dustwaste Frontier</div>
            <div className="text-sm text-text-secondary">Stage 1 of 10</div>
          </div>
          <Database size={20} className="text-text-muted" />
        </div>
        <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
          <motion.div className="h-full bg-amber rounded-full" style={{ width: '35%' }} />
        </div>
        <div className="flex items-center justify-between text-[10px] text-text-muted">
          <span>Idle: 15/min</span>
          <span>Enemies: Scavenger Drones</span>
        </div>
      </MobileCard>

      {/* Farming Status */}
      <MobileCard className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-green/10 text-green flex items-center justify-center">
          <Zap size={20} />
        </div>
        <div className="flex-1">
          <div className="text-sm font-bold">Farming Active</div>
          <div className="text-[10px] text-text-muted">Auto-scrap enabled</div>
        </div>
        <Clock size={16} className="text-text-muted" />
      </MobileCard>

      {/* Offline Claim */}
      {offline.credits > 0 && !claimed && (
        <MobileCard className="flex items-center gap-3 cursor-pointer" onClick={() => {
          player.addCredits(offline.credits);
          player.addScrap(offline.scrap);
          player.setPlayer({ lastClaimTime: Date.now() });
          setClaimed(true);
        }}>
          <div className="w-10 h-10 rounded-full bg-amber/10 text-amber flex items-center justify-center">
            <Download size={20} />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-amber">Offline Earnings Ready</div>
            <div className="text-[10px] text-text-muted">
              +{offline.credits}cr • +{offline.scrap} scrap • {Math.floor(offline.seconds / 60)}m offline
            </div>
          </div>
        </MobileCard>
      )}

      {/* Boss Card */}
      {currentBoss && (
        <MobileCard className="space-y-2 cursor-pointer" onClick={() => setPrepBoss(currentBoss)}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-red font-bold uppercase tracking-wider">Current Target</div>
              <div className="text-lg font-black text-text-primary">{currentBoss.name}</div>
            </div>
            <ChevronRight size={20} className="text-text-muted" />
          </div>
          <div className="flex flex-wrap gap-2">
            {currentBoss.weaknesses.map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-green/10 text-green font-bold">{e}</span>
            ))}
            {currentBoss.resistances.map((e) => (
              <span key={e} className="text-[10px] px-1.5 py-0.5 rounded bg-red/10 text-red font-bold">{e}</span>
            ))}
          </div>
          <div className="text-[10px] text-amber">{currentBoss.mechanic.description}</div>
        </MobileCard>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-2">
        <button
          onClick={() => {
            const weapon = inventory.generateAndAdd({ source: 'World Drop', level: player.level });
            setRecentDrop(weapon);
            player.addXP(5);
          }}
          className="bg-surface-raised border border-border text-text-primary font-bold py-2.5 rounded-xl text-xs active:scale-95 transition-transform"
        >
          Quick Drop
        </button>
        <button
          onClick={() => currentBoss && setPrepBoss(currentBoss)}
          className="bg-amber text-bg font-bold py-2.5 rounded-xl text-xs active:scale-95 transition-transform"
        >
          Prepare Boss
        </button>
        <button className="bg-surface-raised border border-border text-text-primary font-bold py-2.5 rounded-xl text-xs active:scale-95 transition-transform">
          Data Cache
        </button>
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
            <WeaponCard weapon={recentDrop} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Recent Caches Strip */}
      <div>
        <div className="text-xs text-text-muted font-bold uppercase mb-2">Recent Caches</div>
        <div className="flex gap-2 overflow-x-auto pb-2">
          {inventory.getWeapons().slice(0, 10).map((w) => (
            <div key={w.id} className="shrink-0 w-14 h-14 rounded-lg bg-surface border border-border flex items-center justify-center overflow-hidden">
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
