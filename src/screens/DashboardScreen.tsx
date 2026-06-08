import React from 'react';
import {
  Activity,
  Backpack,
  BarChart3,
  Box,
  Crosshair,
  Hammer,
  Map,
  ShoppingBag,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import { useBossStore, useInventoryStore, useLoadoutStore, usePlayerStore, useSkillStore, useWorkshopStore } from '@/store';
import { REGION_1_BOSSES } from '@/constants/bosses';

interface DashboardScreenProps {
  onNavigate: (screen: string) => void;
}

type SystemCard = {
  id: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  tone: string;
};

const systemCards: SystemCard[] = [
  { id: 'fight', label: 'Fight', desc: 'Roam regions and challenge bosses', icon: Crosshair, tone: '#FF4B5C' },
  { id: 'inventory', label: 'Inventory', desc: 'Gear, loadout, supply, workshop', icon: Backpack, tone: '#FF9000' },
  { id: 'mastery', label: 'Mastery', desc: 'Skills, action tracks, ranks', icon: Trophy, tone: '#FFEA3A' },
  { id: 'chest', label: 'Data Cache', desc: 'Open server-rolled gear caches', icon: Box, tone: '#7CFC00' },
  { id: 'workshop', label: 'Workshop', desc: 'Craft, fuse, repair, queue jobs', icon: Hammer, tone: '#5AA7FF' },
  { id: 'market', label: 'Market', desc: 'Browse listings and economy', icon: BarChart3, tone: '#06B6D4' },
];

const StatTile: React.FC<{ label: string; value: string | number; sub?: string }> = ({ label, value, sub }) => (
  <div className="rounded-xl border border-border bg-surface-raised p-3 min-w-0">
    <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
    <div className="text-lg font-black text-text-primary leading-tight truncate">{value}</div>
    {sub && <div className="text-[10px] text-text-muted truncate">{sub}</div>}
  </div>
);

export const DashboardScreen: React.FC<DashboardScreenProps> = ({ onNavigate }) => {
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const loadout = useLoadoutStore();
  const skills = useSkillStore();
  const boss = useBossStore();
  const workshop = useWorkshopStore();

  const currentBoss = boss.currentBossId ? REGION_1_BOSSES.find((b) => b.id === boss.currentBossId) : null;
  const equippedCount = Object.values(loadout.slots).filter(Boolean).length;
  const totalSkillPoints = Math.max(0, player.level - 1);
  const spentSkillPoints = skills.getTotalSpent();
  const availableSkillPoints = Math.max(0, totalSkillPoints - spentSkillPoints);
  const bestWeapon = inventory.getWeapons().sort((a, b) => b.combatPower - a.combatPower)[0];
  const openWorkshopJobs = workshop.activeQueues.length;
  const masteryScore = player.level * 100 + inventory.items.length * 5 + boss.defeatedBossIds.length * 50 + spentSkillPoints * 25;

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div>
        <div className="bl-title text-3xl leading-none text-text-primary">Dashboard</div>
        <div className="text-xs text-text-muted mt-1">Neutral command center for account state, systems, and recent progress.</div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Level" value={player.level} sub={`${player.xp} XP`} />
        <StatTile label="Credits" value={player.credits.toLocaleString()} sub={`${player.scrap.toLocaleString()} scrap`} />
        <StatTile label="Keys" value={player.cacheKeys} sub={`${player.cacheKeyFragments}/5 parts`} />
      </div>

      <MobileCard className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-black text-text-primary">Account Snapshot</div>
            <div className="text-[10px] text-text-muted">Status only. No guided next-step prompts.</div>
          </div>
          <Activity size={16} className="text-green" />
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Current boss</div>
            <div className="text-text-primary font-bold truncate">{currentBoss?.name ?? 'None selected'}</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Loadout</div>
            <div className="text-text-primary font-bold">{equippedCount}/7 slots filled</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Mastery score</div>
            <div className="text-text-primary font-bold">{masteryScore.toLocaleString()}</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Skill points</div>
            <div className="text-text-primary font-bold">{availableSkillPoints} available</div>
          </div>
        </div>
      </MobileCard>

      <div className="grid grid-cols-2 gap-2">
        {systemCards.map((action) => {
          const Icon = action.icon;
          const stat = action.id === 'mastery'
            ? `${availableSkillPoints} pts`
            : action.id === 'chest'
              ? `${player.cacheKeys} keys`
              : action.id === 'workshop'
                ? `${openWorkshopJobs} active`
                : action.id === 'inventory'
                  ? `${inventory.items.length} items`
                  : undefined;
          return (
            <button
              key={action.id}
              onClick={() => onNavigate(action.id)}
              className="text-left rounded-xl border-2 border-border p-3 bg-surface shadow-[0_4px_12px_rgba(0,0,0,0.45)] active:scale-[0.98] transition-transform"
              style={{ borderLeftColor: action.tone, borderLeftWidth: 5 }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="bl-well w-9 h-9 flex items-center justify-center shrink-0" style={{ backgroundColor: `${action.tone}18` }}>
                  <Icon size={18} style={{ color: action.tone }} />
                </div>
                {stat && <span className="text-[10px] text-amber font-black">{stat}</span>}
              </div>
              <div className="text-sm font-black text-text-primary mt-2">{action.label}</div>
              <div className="text-[10px] text-text-muted leading-snug">{action.desc}</div>
            </button>
          );
        })}
      </div>

      <MobileCard className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-black text-text-primary">Build Snapshot</div>
            <div className="text-[10px] text-text-muted">Owned gear and combat readiness at a glance.</div>
          </div>
          <Sparkles size={16} className="text-amber" />
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Best weapon</div>
            <div className="text-text-primary font-bold truncate">{bestWeapon ? bestWeapon.name : 'None owned'}</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Inventory</div>
            <div className="text-text-primary font-bold">{inventory.items.length} items</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Workshop</div>
            <div className="text-text-primary font-bold">{openWorkshopJobs} active queues</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Regions</div>
            <div className="text-text-primary font-bold flex items-center gap-1"><Map size={11} /> Dustwaste</div>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2">
          <ShoppingBag size={15} className="text-amber" />
          <div className="text-xs font-black text-text-primary">Economy Snapshot</div>
        </div>
        <div className="text-xs text-text-muted">
          Market, vendor supply, item services, and workshop actions are routed through Inventory and contextual item actions.
        </div>
      </MobileCard>
    </div>
  );
};
