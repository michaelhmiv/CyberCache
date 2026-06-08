import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type TabId = 'dashboard' | 'fight' | 'inventory' | 'mastery' | 'profile';

interface ScreenWrapperProps {
  activeTab: TabId;
  children: React.ReactNode;
}

export const ScreenWrapper: React.FC<ScreenWrapperProps> = ({ activeTab, children }) => {
  return (
    <div className="relative flex-1 overflow-y-auto overflow-x-hidden bg-bg">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgba(255,144,0,0.09),transparent_34%),radial-gradient(circle_at_90%_26%,rgba(255,75,92,0.06),transparent_28%)]" />
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -18 }}
          transition={{ duration: 0.18 }}
          className="relative h-full min-h-full"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
