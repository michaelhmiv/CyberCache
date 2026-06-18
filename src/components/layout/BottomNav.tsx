import React from 'react';
import { motion } from 'framer-motion';
import { getNavSigil } from '@/constants/navSigils';

type TabId = 'dashboard' | 'fight' | 'inventory' | 'market' | 'leaderboards' | 'profile';

interface BottomNavProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
}

const TAB_IDS: TabId[] = ['dashboard', 'fight', 'inventory', 'market', 'leaderboards', 'profile'];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChange }) => {
  return (
    <nav className="shrink-0 h-[66px] bg-bg border-t-[3px] border-border z-50 px-2 pt-1.5 pb-[calc(0.35rem+env(safe-area-inset-bottom))] shadow-[0_-8px_18px_rgba(0,0,0,0.65)]">
      <div className="grid h-full grid-cols-6 gap-1.5">
        {TAB_IDS.map((tabId) => {
          const isActive = activeTab === tabId;
          const sigil = getNavSigil(tabId);
          return (
            <button
              key={tabId}
              onClick={() => onChange(tabId)}
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
              <span
                className="relative z-10 font-black leading-none"
                style={{
                  fontSize: '18px',
                  color: isActive ? undefined : sigil.color,
                }}
              >
                {sigil.glyph}
              </span>
              <span className="relative z-10 truncate px-1 text-[8px] font-black uppercase tracking-wide">{sigil.label}</span>
              {isActive && <span className="absolute -top-1.5 left-1/2 z-20 h-2 w-2 -translate-x-1/2 rotate-45 border border-border bg-amber-glow" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
