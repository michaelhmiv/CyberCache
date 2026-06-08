import React from 'react';
import { getMaterialVisual } from '@/constants/visualAssets';

interface MaterialBadgeProps {
  id: string;
  count?: number;
  required?: number;
  compact?: boolean;
  className?: string;
}

export const MaterialBadge: React.FC<MaterialBadgeProps> = ({ id, count, required, compact = false, className = '' }) => {
  const visual = getMaterialVisual(id);
  const value = required === undefined ? count : `${count ?? 0}/${required}`;
  return (
    <span
      className={`inline-flex items-center gap-1 border-2 border-border bg-bg font-black uppercase shadow-[2px_2px_0_rgba(0,0,0,0.55)] ${compact ? 'px-1 py-0.5 text-[8px]' : 'px-1.5 py-1 text-[9px]'} ${className}`}
      style={{ borderLeftColor: visual.color, borderLeftWidth: 4, clipPath: 'polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)' }}
      title={visual.label}
    >
      <span className="inline-flex h-4 min-w-4 items-center justify-center border border-border leading-none" style={{ color: visual.color, backgroundColor: `${visual.color}18` }}>
        {visual.mark}
      </span>
      {!compact && <span className="text-text-secondary">{visual.shortLabel}</span>}
      {value !== undefined && <span className="text-text-primary">{value}</span>}
    </span>
  );
};
