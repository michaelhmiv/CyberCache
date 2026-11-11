import React from 'react';
import { NAV_SIGIL_MASTERS } from '@/lib/pixel/iconMasters';
import { motion } from 'framer-motion';
import { getNavSigil } from '@/constants/navSigils';

type TabId = 'home' | 'gear' | 'market' | 'hunter';

interface BottomNavProps {
  activeTab: TabId;
  onChange: (tab: TabId) => void;
}

const TAB_IDS: TabId[] = ['home', 'gear', 'market', 'hunter'];

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onChange }) => {
  return (
    <nav className="shrink-0 h-[66px] bg-bg border-t-[3px] border-border z-50 px-2 pt-1.5 pb-[calc(0.35rem+env(safe-area-inset-bottom))] shadow-[0_-8px_18px_rgba(0,0,0,0.65)]">
      <div className="grid h-full grid-cols-4 gap-1.5">
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
              {/* INT-9 — the sigil is the painted master now (Wave 13).
                  Tint verification: the old PxIcon rode the span's
                  color, which is the tab's FIXED identity color when
                  inactive and undefined (button text color) when
                  active — but the active state is carried by the
                  button's amber background (and the layoutId pill),
                  not by the icon, so the fixed-color master loses no
                  state signal. It ships in the tab's own identity
                  colorway (home orange, pack violet, tag gold, person
                  cyan). The span's old color style went with the
                  glyph; the label below still inherits the button's
                  classes, so active/inactive text treatment is
                  unchanged. */}
              <span className="relative z-10 leading-none">
                <img
                  src={NAV_SIGIL_MASTERS[sigil.icon]}
                  width={17}
                  height={17}
                  style={{ width: 17, height: 17 }}
                  alt=""
                  aria-hidden="true"
                  draggable={false}
                />
              </span>
              {/* DESIGN.md §5 type floor: labels render at 11px — the
                  four-tab bar has the width for honest sizes, so the
                  old 8px six-tab shrink does not carry over. */}
              <span className="relative z-10 truncate px-1 text-[11px] font-black uppercase tracking-wide">{sigil.label}</span>
              {isActive && <span className="absolute -top-1.5 left-1/2 z-20 h-2 w-2 -translate-x-1/2 rotate-45 border border-border bg-amber-glow" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
