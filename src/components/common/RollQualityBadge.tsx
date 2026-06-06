import React from 'react';

interface RollQualityBadgeProps {
  quality: number;
  size?: 'sm' | 'md';
}

export const RollQualityBadge: React.FC<RollQualityBadgeProps> = ({ quality, size = 'sm' }) => {
  let color = 'text-text-muted';
  let bg = 'bg-surface-raised border-border';
  if (quality >= 96) { color = 'text-amber-glow'; bg = 'bg-amber/10 border-amber'; }
  else if (quality >= 81) { color = 'text-green'; bg = 'bg-green/10 border-green/30'; }
  else if (quality >= 61) { color = 'text-blue'; bg = 'bg-blue/10 border-blue/30'; }
  else if (quality >= 41) { color = 'text-text-secondary'; bg = 'bg-surface-raised border-border'; }
  else if (quality >= 21) { color = 'text-text-muted'; bg = 'bg-surface-raised border-border'; }

  const label = quality >= 96 ? 'God' : quality >= 81 ? 'Exc' : quality >= 61 ? 'Strong' : quality >= 41 ? 'Std' : quality >= 21 ? 'Low' : 'Poor';

  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold border ${bg} ${color} ${size === 'md' ? 'text-xs px-2 py-1' : ''}`}>
      {quality} {label}
    </span>
  );
};
