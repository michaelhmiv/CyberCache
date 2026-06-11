/**
 * LegendaryDropFlash — golden screen flash overlay triggered on Legendary loot drops.
 *
 * Watches the tick feed store for tone:'loot' events where the detail includes 'Legendary'.
 * Renders an animated radial gradient flash that fades out over 600ms.
 */
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTickFeedStore } from '@/store/slices/tickSlice';

export const LegendaryDropFlash: React.FC = () => {
  const events = useTickFeedStore((s) => s.events);
  const [trigger, setTrigger] = useState<string | null>(null);

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (latest.tone === 'loot' && latest.detail?.includes('Legendary')) {
      setTrigger(latest.id);
      const timer = setTimeout(() => setTrigger(null), 800);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [events]);

  return (
    <AnimatePresence>
      {trigger && (
        <motion.div
          key={trigger}
          className="pointer-events-none fixed inset-0 z-[100]"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.35, 0.12, 0] }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          {/* Radial golden gradient from center */}
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(255,234,58,0.6) 0%, rgba(255,144,0,0.2) 40%, transparent 70%)',
            }}
          />
          {/* Edge pulse ring */}
          <div
            className="absolute inset-4 rounded-[40%]"
            style={{
              boxShadow: '0 0 80px 20px rgba(255,234,58,0.3), inset 0 0 60px 10px rgba(255,144,0,0.15)',
              border: '2px solid rgba(255,234,58,0.2)',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
