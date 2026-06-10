import React from 'react';
import type { WeaponVisualDecal } from '@/lib/weaponArt/buildWeaponVisualSpec';

/** Shared decal renderer used by all gear illustration components. */
export const Decal: React.FC<{ decal: WeaponVisualDecal }> = ({ decal }) => {
  const transform = `translate(${decal.x} ${decal.y}) rotate(${decal.rotate})`;
  if (decal.shape === 'tag') {
    return (
      <g transform={transform}>
        <path d="M-10 -7 L8 -7 L13 0 L8 7 L-10 7 Z" fill={decal.color} stroke="#000" strokeWidth="2" />
        <text x="0" y="4" textAnchor="middle" fontSize="9" fontWeight="900" fill="#000">{decal.label}</text>
      </g>
    );
  }
  if (decal.shape === 'diamond') return <rect x={decal.x - 6} y={decal.y - 6} width="12" height="12" transform={`rotate(45 ${decal.x} ${decal.y})`} fill={decal.color} stroke="#000" strokeWidth="2" />;
  if (decal.shape === 'triangle') return <path d={`M${decal.x} ${decal.y - 7} L${decal.x + 8} ${decal.y + 7} L${decal.x - 8} ${decal.y + 7} Z`} fill={decal.color} stroke="#000" strokeWidth="2" />;
  if (decal.shape === 'slash') return <path d={`M${decal.x - 8} ${decal.y + 8} L${decal.x + 8} ${decal.y - 8}`} stroke={decal.color} strokeWidth="5" strokeLinecap="round" />;
  return <circle cx={decal.x} cy={decal.y} r="5" fill={decal.color} stroke="#000" strokeWidth="2" />;
};
