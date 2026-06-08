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
  rarityColor = '#FF9000',
  glow = false,
}) => {
  return (
    <motion.div
      whileTap={onClick ? { scale: 0.98, rotate: -0.25 } : undefined}
      onClick={onClick}
      className={`bl-card relative p-3 ${onClick ? 'cursor-pointer active:brightness-110' : ''} ${className}`}
      style={{
        borderLeftColor: rarityColor,
        borderLeftWidth: 5,
        boxShadow: glow
          ? `0 0 16px ${rarityColor}66, 5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 1px rgba(255,255,255,0.06)`
          : undefined,
      }}
    >
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
};
