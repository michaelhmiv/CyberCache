import React from 'react';
import { motion } from 'framer-motion';
import { Backpack, Gauge, Package, TrendingUp, Zap } from 'lucide-react';

type TabId = 'dashboard' | 'loadout' | 'skills' | 'loot' | 'market';

interface BottomNavProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Dash', icon: Gauge },
  { id: 'loadout', label: 'Loadout', icon: Backpack },
  { id: 'skills', label: 'Skills', icon: Zap },
  { id: 'loot', label: 'Loot', icon: Package },
  { id: 'market', label: 'Market', icon: TrendingUp },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChange }) => {
  return (
    <nav className="shrink-0 h-16 bg-surface border-t-2 border-border flex items-center justify-around z-50">
      {tabs.map((t) => {
        const isActive = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex flex-col items-center justify-center w-16 h-full relative transition-colors ${
              isActive ? 'text-amber-glow' : 'text-text-muted'
            }`}
          >
            <t.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
            <span className="text-[10px] mt-0.5 font-bold uppercase">{t.label}</span>
            {isActive && (
              <motion.div
                layoutId="activeTab"
                className="absolute -top-px left-0 right-0 h-0.5 bg-amber shadow-[0_0_10px_rgba(255,144,0,0.7)]"
              />
            )}
          </button>
        );
      })}
    </nav>
  );
};
