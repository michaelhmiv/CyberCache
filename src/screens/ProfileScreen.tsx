import React from 'react';
import { TrendingUp, Target, Box, Award } from 'lucide-react';
import { usePlayerStore, useInventoryStore, useBossStore } from '@/store';
import { MobileCard } from '@/components/layout/MobileCard';
import { REGION_1_BOSSES } from '@/constants/bosses';

export const ProfileScreen: React.FC = () => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const bossStore = useBossStore();

  const weapons = inventory.getWeapons();
  const totalItems = inventory.items.length;
  const xpToNext = player.level * 100;
  const xpProgress = Math.round((player.xp / xpToNext) * 100);

  // Favorite weapon type
  const typeCounts: Record<string, number> = {};
  weapons.forEach((w) => { typeCounts[w.weaponType] = (typeCounts[w.weaponType] || 0) + 1; });
  const favoriteType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="p-4 space-y-4 pb-20">
      <div className="text-lg font-black text-text-primary">Profile</div>

      {/* Player Card */}
      <MobileCard className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-16 h-16 rounded-full bg-amber/10 flex items-center justify-center text-amber font-black text-xl border-2 border-amber/30">
            {player.level}
          </div>
          <div className="flex-1">
            <div className="text-lg font-black text-text-primary">{player.name}</div>
            <div className="text-xs text-text-muted">Level {player.level} Gunrunner</div>
            {/* XP Bar */}
            <div className="h-1.5 bg-surface-raised rounded-full mt-1.5 overflow-hidden">
              <div className="h-full bg-amber rounded-full transition-all" style={{ width: `${xpProgress}%` }} />
            </div>
            <div className="text-[10px] text-text-muted mt-0.5">{player.xp} / {xpToNext} XP ({xpProgress}%)</div>
          </div>
        </div>
      </MobileCard>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-2">
        <MobileCard className="space-y-1">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-amber" />
            <div className="text-xs font-bold text-text-primary">Credits</div>
          </div>
          <div className="text-lg font-black text-text-primary">{player.credits.toLocaleString()}</div>
        </MobileCard>
        <MobileCard className="space-y-1">
          <div className="flex items-center gap-2">
            <Box size={16} className="text-purple" />
            <div className="text-xs font-bold text-text-primary">Scrap</div>
          </div>
          <div className="text-lg font-black text-text-primary">{player.scrap.toLocaleString()}</div>
        </MobileCard>
        <MobileCard className="space-y-1">
          <div className="flex items-center gap-2">
            <Target size={16} className="text-red" />
            <div className="text-xs font-bold text-text-primary">Bosses Defeated</div>
          </div>
          <div className="text-lg font-black text-text-primary">
            {bossStore.defeatedBossIds.length} / {REGION_1_BOSSES.length}
          </div>
        </MobileCard>
        <MobileCard className="space-y-1">
          <div className="flex items-center gap-2">
            <Award size={16} className="text-green" />
            <div className="text-xs font-bold text-text-primary">Total Items</div>
          </div>
          <div className="text-lg font-black text-text-primary">{totalItems}</div>
        </MobileCard>
      </div>

      {/* Details */}
      <MobileCard className="space-y-2">
        <div className="text-xs font-bold text-text-muted uppercase">Loadout Details</div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between"><span>Cache Keys</span><span className="text-amber font-bold">{player.cacheKeys}</span></div>
          <div className="flex justify-between"><span>Cache Key Fragments</span><span className="text-text-primary">{player.cacheKeyFragments || 0} / 5</span></div>
          <div className="flex justify-between"><span>Offline Cap</span><span className="text-text-primary">{player.offlineCapHours}h</span></div>
          <div className="flex justify-between"><span>Death Fee Insurance</span><span className={player.deathFeeInsurance ? 'text-green' : 'text-text-muted'}>{player.deathFeeInsurance ? 'Active' : 'None'}</span></div>
        </div>
      </MobileCard>

      {/* Favorites */}
      <MobileCard className="space-y-2">
        <div className="text-xs font-bold text-text-muted uppercase">Collection</div>
        <div className="space-y-1 text-xs text-text-secondary">
          <div className="flex justify-between"><span>Weapons</span><span className="text-text-primary">{weapons.length}</span></div>
          <div className="flex justify-between"><span>Favorite Type</span><span className="text-amber font-bold">{favoriteType ? favoriteType[0] : 'None'}</span></div>
          <div className="flex justify-between"><span>Legendary Items</span><span className="text-amber font-bold">{weapons.filter((w) => w.rarity === 'Legendary').length}</span></div>
          <div className="flex justify-between"><span>Unique Affixes</span><span className="text-text-primary">{new Set(weapons.flatMap((w) => w.affixes.map((a) => a.id))).size}</span></div>
        </div>
      </MobileCard>
    </div>
  );
};
