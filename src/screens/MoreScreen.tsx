import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Box, Zap, FlaskConical, ShoppingBag, Settings, HelpCircle, User } from 'lucide-react';

interface MoreScreenProps {
  onNavigate: (screen: string) => void;
}

export const MoreScreen: React.FC<MoreScreenProps> = ({ onNavigate }) => {
  const items = [
    { id: 'chest', label: 'Data Cache', desc: 'Open encrypted caches', icon: Box, color: '#F59E0B' },
    { id: 'skills', label: 'Skill Trees', desc: 'Gunslinger, Demolition, Scavenger', icon: Zap, color: '#EF4444' },
    { id: 'fusion', label: 'Fusion Lab', desc: 'Upgrade cache quality', icon: FlaskConical, color: '#A855F7' },
    { id: 'vendor', label: 'Consumable Vendor', desc: 'Buy grenades, medkits, boosters', icon: ShoppingBag, color: '#22C55E' },
    { id: 'profile', label: 'Profile', desc: 'Stats and achievements', icon: User, color: '#3B82F6' },
    { id: 'settings', label: 'Settings', desc: 'Audio, notifications, data', icon: Settings, color: '#9CA3AF' },
    { id: 'help', label: 'Guide', desc: 'How to play and tips', icon: HelpCircle, color: '#06B6D4' },
  ];

  return (
    <div className="p-4 space-y-3 pb-20">
      <div className="text-lg font-black text-text-primary">More</div>
      <div className="space-y-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface border border-border active:scale-[0.98] transition-transform text-left"
          >
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${item.color}15` }}
            >
              <item.icon size={20} style={{ color: item.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-text-primary">{item.label}</div>
              <div className="text-[10px] text-text-muted">{item.desc}</div>
            </div>
            <ChevronRight size={16} className="text-text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
};
