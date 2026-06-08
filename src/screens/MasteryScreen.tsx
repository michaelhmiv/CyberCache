import React, { useState } from 'react';
import { Award, BarChart3, Crosshair, Hammer, Map, Shield, Swords, Trophy, Zap } from 'lucide-react';
import { SkillTreeScreen } from './SkillTreeScreen';
import { useBossStore, useInventoryStore, usePlayerStore, useSkillStore } from '@/store';

type MasteryTab = 'overview' | 'skills';

const masteryCategories = [
  { id: 'combat', label: 'Combat', desc: 'Roaming, boss attempts, risk stance wins', icon: Crosshair, color: '#FF4B5C' },
  { id: 'weapons', label: 'Weapons', desc: 'Pistols, SMGs, shotguns, ordnance, elements', icon: Swords, color: '#FF9000' },
  { id: 'inventory', label: 'Inventory', desc: 'Scrapping, repairs, crafting, cache opens', icon: Shield, color: '#FFEA3A' },
  { id: 'locations', label: 'Locations', desc: 'Region activity and local mastery', icon: Map, color: '#7CFC00' },
  { id: 'economy', label: 'Economy', desc: 'Net worth, trades, listings, services', icon: BarChart3, color: '#06B6D4' },
  { id: 'services', label: 'Services', desc: 'Repair jobs, reputation, fulfilled work', icon: Hammer, color: '#A855F7' },
];

const RankTile: React.FC<{ label: string; value: string | number; sub: string }> = ({ label, value, sub }) => (
  <div className="rounded-xl border border-border bg-surface-raised p-3">
    <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
    <div className="text-lg font-black text-text-primary">{value}</div>
    <div className="text-[10px] text-text-muted">{sub}</div>
  </div>
);

export const MasteryScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<MasteryTab>('overview');
  const player = usePlayerStore();
  const inventory = useInventoryStore();
  const skills = useSkillStore();
  const boss = useBossStore();

  const spentSkillPoints = skills.getTotalSpent();
  const availableSkillPoints = Math.max(0, player.level - 1 - spentSkillPoints);
  const masteryScore = player.level * 100 + inventory.items.length * 5 + boss.defeatedBossIds.length * 50 + spentSkillPoints * 25;

  return (
    <div className="bl-page space-y-4 pb-20">
      <div className="p-4 pb-0 space-y-3">
        <div>
          <div className="bl-title text-3xl leading-none text-text-primary">Mastery</div>
          <div className="text-xs text-text-muted mt-1">
            Account-wide progression, skill trees, action mastery, and competitive ranks.
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <RankTile label="Score" value={masteryScore.toLocaleString()} sub="local estimate" />
          <RankTile label="Rank" value="Unranked" sub="server boards pending" />
          <RankTile label="Skill Pts" value={availableSkillPoints} sub={`${spentSkillPoints} spent`} />
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-surface-raised p-1.5">
          <button
            onClick={() => setActiveTab('overview')}
            className={`rounded-lg py-2 flex items-center justify-center gap-1 text-xs font-black transition-colors ${activeTab === 'overview' ? 'bg-amber text-bg' : 'text-text-muted'}`}
          >
            <Trophy size={14} /> Overview
          </button>
          <button
            onClick={() => setActiveTab('skills')}
            className={`rounded-lg py-2 flex items-center justify-center gap-1 text-xs font-black transition-colors ${activeTab === 'skills' ? 'bg-amber text-bg' : 'text-text-muted'}`}
          >
            <Zap size={14} /> Skill Trees
          </button>
        </div>
      </div>

      {activeTab === 'skills' ? (
        <SkillTreeScreen />
      ) : (
        <div className="px-4 space-y-4">
          <div className="rounded-2xl border-2 border-border bg-surface p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Award size={16} className="text-amber" />
              <div className="text-sm font-black text-text-primary">Mastery Philosophy</div>
            </div>
            <div className="text-xs text-text-secondary leading-relaxed">
              Every verified action should eventually feed mastery: scrapping, cache opens, boss defeats, repairs, weapon use, location activity, market activity, and service reputation. This page is the player-facing home for those numbers.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {masteryCategories.map((category) => {
              const Icon = category.icon;
              return (
                <button
                  key={category.id}
                  className="text-left rounded-xl border-2 border-border bg-surface p-3 active:scale-[0.98] transition-transform"
                  style={{ borderLeftColor: category.color, borderLeftWidth: 5 }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="bl-well w-9 h-9 flex items-center justify-center" style={{ backgroundColor: `${category.color}18` }}>
                      <Icon size={18} style={{ color: category.color }} />
                    </div>
                    <span className="text-[10px] text-text-muted font-bold">Coming</span>
                  </div>
                  <div className="text-sm font-black text-text-primary mt-2">{category.label}</div>
                  <div className="text-[10px] text-text-muted leading-snug">{category.desc}</div>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-border bg-surface-raised p-3">
            <div className="text-xs font-black text-text-primary mb-2">Rank Surfaces</div>
            <div className="grid grid-cols-2 gap-2 text-[10px] text-text-secondary">
              <div className="rounded-lg bg-surface border border-border p-2">Net worth rank</div>
              <div className="rounded-lg bg-surface border border-border p-2">Boss defeat rank</div>
              <div className="rounded-lg bg-surface border border-border p-2">Weapon mastery rank</div>
              <div className="rounded-lg bg-surface border border-border p-2">Repair reputation rank</div>
              <div className="rounded-lg bg-surface border border-border p-2">Location mastery rank</div>
              <div className="rounded-lg bg-surface border border-border p-2">Market activity rank</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
