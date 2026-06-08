import React from 'react';
import {
  Activity,
  Backpack,
  Box,
  ChevronRight,
  Crosshair,
  Hammer,
  Menu,
  Radio,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import { useBossStore, useInventoryStore, useLoadoutStore, usePlayerStore, useSkillStore, useWorkshopStore } from '@/store';
import { REGION_1_BOSSES } from '@/constants/bosses';

interface DashboardScreenProps {
  onNavigate: (screen: string) => void;
}

type ActionCard = {
  id: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  tone: string;
  stat?: string;
  emphasis?: boolean;
};

const actionCards: ActionCard[] = [
  { id: 'fight', label: 'Roam', desc: 'Run field combat and boss prep', icon: Crosshair, tone: '#FF4B5C', emphasis: true },
  { id: 'chest', label: 'Data Cache', desc: 'Open encrypted gear rolls', icon: Box, tone: '#FFEA3A' },
  { id: 'skills', label: 'Skills', desc: 'Spend level points', icon: Zap, tone: '#FF9000', emphasis: true },
  { id: 'workshop', label: 'Workshop', desc: 'Craft, fuse, and queue jobs', icon: Hammer, tone: '#7CFC00' },
  { id: 'vendor', label: 'Vendor', desc: 'Buy consumable prep tools', icon: ShoppingBag, tone: '#5AA7FF' },
  { id: 'market', label: 'Market', desc: 'Trade with other players', icon: TrendingUp, tone: '#06B6D4' },
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

  const nextStep = (() => {
    if (inventory.items.length === 0) return { label: 'Open your first Data Cache', screen: 'chest', icon: Box };
    if (availableSkillPoints > 0) return { label: `Spend ${availableSkillPoints} skill point${availableSkillPoints === 1 ? '' : 's'}`, screen: 'skills', icon: Zap };
    if (!currentBoss) return { label: 'Choose a boss target', screen: 'fight', icon: Crosshair };
    if (openWorkshopJobs > 0) return { label: `${openWorkshopJobs} workshop queue${openWorkshopJobs === 1 ? '' : 's'} active`, screen: 'workshop', icon: Hammer };
    return { label: 'Continue roaming combat', screen: 'fight', icon: Radio };
  })();
  const NextIcon = nextStep.icon;

  return (
    <div className="bl-page p-4 space-y-4 pb-20">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Dashboard</div>
          <div className="text-xs text-text-muted mt-1">Command hub for build, loot, progression, and economy.</div>
        </div>
        <button
          onClick={() => onNavigate('more')}
          className="bl-well w-10 h-10 flex items-center justify-center text-amber shrink-0"
          aria-label="Open profile and settings"
        >
          <Menu size={20} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Level" value={player.level} sub={`${player.xp} XP`} />
        <StatTile label="Credits" value={player.credits.toLocaleString()} sub={`${player.scrap.toLocaleString()} scrap`} />
        <StatTile label="Keys" value={player.cacheKeys} sub={`${player.cacheKeyFragments}/5 parts`} />
      </div>

      <MobileCard className="space-y-3 border-amber/30 bg-amber/5">
        <div className="flex items-center gap-3">
          <div className="bl-well w-11 h-11 flex items-center justify-center text-amber shrink-0">
            <NextIcon size={21} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-amber font-black">Next Best Action</div>
            <div className="text-sm font-black text-text-primary truncate">{nextStep.label}</div>
            <div className="text-[10px] text-text-muted">Tap to jump directly into the relevant system.</div>
          </div>
          <button
            onClick={() => onNavigate(nextStep.screen)}
            className="rounded-xl bg-amber text-bg px-3 py-2 text-xs font-black active:scale-95 transition-transform"
          >
            Go
          </button>
        </div>
      </MobileCard>

      <div className="grid grid-cols-2 gap-2">
        {actionCards.map((action) => {
          const Icon = action.icon;
          const stat = action.id === 'skills'
            ? `${availableSkillPoints} pts`
            : action.id === 'chest'
              ? `${player.cacheKeys} keys`
              : action.id === 'workshop'
                ? `${openWorkshopJobs} active`
                : action.id === 'loadout'
                  ? `${equippedCount}/7`
                  : undefined;
          return (
            <button
              key={action.id}
              onClick={() => onNavigate(action.id)}
              className={`text-left rounded-xl border-2 p-3 bg-surface shadow-[0_4px_12px_rgba(0,0,0,0.45)] active:scale-[0.98] transition-transform ${action.emphasis ? 'border-amber/50' : 'border-border'}`}
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
            <div className="text-[10px] text-text-muted">A fast read on whether the player is ready to push.</div>
          </div>
          <Sparkles size={16} className="text-amber" />
        </div>
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Best weapon</div>
            <div className="text-text-primary font-bold truncate">{bestWeapon ? bestWeapon.name : 'None equipped'}</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Loadout slots</div>
            <div className="text-text-primary font-bold">{equippedCount}/7 filled</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Boss target</div>
            <div className="text-text-primary font-bold truncate">{currentBoss?.name ?? 'None selected'}</div>
          </div>
          <div className="rounded-lg bg-surface-raised border border-border p-2">
            <div className="text-text-muted">Inventory</div>
            <div className="text-text-primary font-bold">{inventory.items.length} items</div>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="space-y-2">
        <div className="flex items-center gap-2">
          <Activity size={15} className="text-green" />
          <div className="text-xs font-black text-text-primary">System Status</div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <button onClick={() => onNavigate('loadout')} className="rounded-lg bg-surface-raised border border-border p-2 active:scale-95 transition-transform">
            <Backpack size={15} className="mx-auto text-amber mb-1" />
            <div className="text-[10px] font-bold text-text-primary">Loadout</div>
          </button>
          <button onClick={() => onNavigate('loot')} className="rounded-lg bg-surface-raised border border-border p-2 active:scale-95 transition-transform">
            <Box size={15} className="mx-auto text-amber mb-1" />
            <div className="text-[10px] font-bold text-text-primary">Inventory</div>
          </button>
          <button onClick={() => onNavigate('profile')} className="rounded-lg bg-surface-raised border border-border p-2 active:scale-95 transition-transform">
            <ChevronRight size={15} className="mx-auto text-amber mb-1" />
            <div className="text-[10px] font-bold text-text-primary">Profile</div>
          </button>
        </div>
      </MobileCard>
    </div>
  );
};
