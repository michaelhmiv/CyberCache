import React from 'react';
import { motion } from 'framer-motion';

interface MobileCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  rarityColor?: string;
  glow?: boolean;
}

export const MobileCard: React.FC<MobileCardProps> = ({
  children,
  className = '',
  onClick,
  rarityColor = '#000000',
  glow = false,
}) => {
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`relative rounded-xl p-3 bg-surface border-2 border-border overflow-hidden shadow-[0_4px_12px_rgba(0,0,0,0.5)] ${className}`}
      style={{
        borderLeftColor: rarityColor,
        borderLeftWidth: 4,
        boxShadow: glow ? `0 0 12px ${rarityColor}66, 0 4px 12px rgba(0,0,0,0.5)` : undefined,
      }}
    >
      {children}
    </motion.div>
  );
};
