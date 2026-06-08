import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type TabId = 'dashboard' | 'loadout' | 'skills' | 'loot' | 'market';

interface ScreenWrapperProps {
  activeTab: TabId;
  children: React.ReactNode;
}

export const ScreenWrapper: React.FC<ScreenWrapperProps> = ({ activeTab, children }) => {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden relative">
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="h-full"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
