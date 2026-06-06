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
  rarityColor = '#2A2F3A',
  glow = false,
}) => {
  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`relative rounded-xl p-3 bg-surface border border-border overflow-hidden ${className}`}
      style={{
        borderLeftColor: rarityColor,
        borderLeftWidth: 4,
        boxShadow: glow ? `0 0 12px ${rarityColor}40` : undefined,
      }}
    >
      {children}
    </motion.div>
  );
};
