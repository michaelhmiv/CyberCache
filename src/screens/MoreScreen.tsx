import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight, Box, Zap, ShoppingBag, Settings, HelpCircle, User, Hammer } from 'lucide-react';
import { useWorkshopStore } from '@/store';

interface MoreScreenProps {
  onNavigate: (screen: string) => void;
}

export const MoreScreen: React.FC<MoreScreenProps> = ({ onNavigate }) => {
  const workshop = useWorkshopStore();

  const items = [
    { id: 'chest', label: 'Data Cache', desc: 'Open encrypted caches', icon: Box, color: '#FFEA3A' },
    { id: 'skills', label: 'Skill Trees', desc: 'Gunslinger, Demolition, Scavenger', icon: Zap, color: '#FF4B5C' },
    {
      id: 'workshop',
      label: 'Workshop',
      desc: 'Craft consumables and fuse gear',
      icon: Hammer,
      color: '#FF9000',
      badge: workshop.activeQueues.length > 0 ? workshop.activeQueues.length : null,
    },
    { id: 'vendor', label: 'Consumable Vendor', desc: 'Buy grenades, medkits, boosters', icon: ShoppingBag, color: '#7CFC00' },
    { id: 'profile', label: 'Profile', desc: 'Stats and achievements', icon: User, color: '#5AA7FF' },
    { id: 'settings', label: 'Settings', desc: 'Audio, notifications, data', icon: Settings, color: '#9CA3AF' },
    { id: 'help', label: 'Guide', desc: 'How to play and tips', icon: HelpCircle, color: '#06B6D4' },
  ];

  return (
    <div className="bl-page p-4 space-y-3 pb-20">
      <div className="bl-title text-3xl leading-none text-text-primary">More</div>
      <div className="space-y-2">
        {items.map((item) => (
          <motion.button
            key={item.id}
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate(item.id)}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-surface border-2 border-border shadow-[0_4px_12px_rgba(0,0,0,0.5)] active:scale-[0.98] transition-transform text-left"
            style={{ borderLeftColor: item.color, borderLeftWidth: 5 }}
          >
            <div
              className="bl-well w-10 h-10 flex items-center justify-center shrink-0 relative"
              style={{ backgroundColor: `${item.color}18` }}
            >
              <item.icon size={20} style={{ color: item.color }} />
              {item.badge && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-amber text-bg text-[9px] font-bold flex items-center justify-center">
                  {item.badge}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-text-primary">{item.label}</div>
              <div className="text-[10px] text-text-muted">{item.desc}</div>
            </div>
            <ChevronRight size={16} className="text-text-muted" />
          </motion.button>
        ))}
      </div>
    </div>
  );
};
