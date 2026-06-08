import React from 'react';
import { motion } from 'framer-motion';
import { Backpack, Crosshair, Gauge, Trophy, User } from 'lucide-react';

type TabId = 'dashboard' | 'fight' | 'inventory' | 'mastery' | 'profile';

interface BottomNavProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'dashboard', label: 'Board', icon: Gauge },
  { id: 'fight', label: 'Fight', icon: Crosshair },
  { id: 'inventory', label: 'Gear', icon: Backpack },
  { id: 'mastery', label: 'Trees', icon: Trophy },
  { id: 'profile', label: 'Hunter', icon: User },
];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChange }) => {
  return (
    <nav className="shrink-0 h-[72px] bg-bg border-t-[3px] border-border z-50 px-2 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-8px_18px_rgba(0,0,0,0.65)]">
      <div className="grid h-full grid-cols-5 gap-1.5">
        {tabs.map((t) => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={`relative flex min-w-0 flex-col items-center justify-center gap-0.5 border-2 border-border transition-transform active:scale-[0.96] ${
                isActive ? 'bg-amber text-bg' : 'bg-surface text-text-muted'
              }`}
              style={{ clipPath: 'polygon(7px 0,100% 0,calc(100% - 7px) 100%,0 100%)' }}
            >
              {isActive && (
                <motion.div
                  layoutId="activeTab"
                  className="absolute inset-0 bg-amber"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <t.icon className="relative z-10" size={20} strokeWidth={isActive ? 3 : 2.25} />
              <span className="relative z-10 truncate px-1 text-[9px] font-black uppercase tracking-wide">{t.label}</span>
              {isActive && <span className="absolute -top-1.5 left-1/2 z-20 h-2 w-2 -translate-x-1/2 rotate-45 border border-border bg-amber-glow" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
