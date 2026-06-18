/**
 * SkillKeystoneArt — high-detail procedural SVG for skill tree nodes.
 *
 * Renders a 60×60 SVG with node-type-specific shapes (hexagon for minor,
 * octagon for major, 12-pointed star for keystone), connection stubs,
 * lock indicators, and animated glow for unlocked keystones.
 *
 * All colors derive from the SkillTreeVisual registry — nothing hardcoded.
 */
import React, { useId } from 'react';
import { getSkillTreeVisual } from '@/constants/skillTreeVisuals';
import type { SkillTreeType } from '@/types/game';

type NodeType = 'small' | 'major' | 'keystone';

interface SkillKeystoneArtProps {
  tree: SkillTreeType;
  nodeType?: NodeType;
  unlocked?: boolean;
  locked?: boolean;
  size?: number;
  className?: string;
  animate?: boolean;
}

// Node shape paths centered at (30,30) in a 60×60 viewBox
const NODE_SHAPES: Record<NodeType, string> = {
  // Hexagon (small)
  small: 'M30 10 L48 20 L48 40 L30 50 L12 40 L12 20 Z',
  // Octagon (major)
  major: 'M22 10 L38 10 L50 22 L50 38 L38 50 L22 50 L10 38 L10 22 Z',
  // 12-pointed star (keystone)
  keystone:
    'M30 6 L34 14 L42 12 L40 20 L48 24 L42 30 L48 36 L40 40 L42 48 L34 46 L30 54 L26 46 L18 48 L20 40 L12 36 L18 30 L12 24 L20 20 L18 12 L26 14 Z',
};

// Connection stub endpoints (4 directions from node edges)
const STUBS = [
  { x1: 30, y1: 10, x2: 30, y2: 4 },   // top
  { x1: 48, y1: 30, x2: 54, y2: 30 },   // right
  { x1: 30, y1: 50, x2: 30, y2: 56 },   // bottom
  { x1: 12, y1: 30, x2: 6, y2: 30 },    // left
];

export const SkillKeystoneArt: React.FC<SkillKeystoneArtProps> = ({
  tree,
  nodeType = 'small',
  unlocked = false,
  locked = !unlocked,
  size = 40,
  className = '',
  animate = false,
}) => {
  const visual = getSkillTreeVisual(tree);
  const uid = useId().replace(/[:]/g, '');
  const glowGradId = `skillGlow-${uid}`;
  const pulseName = `skillPulse-${uid}`;
  const shape = NODE_SHAPES[nodeType];
  const strokeWidth = nodeType === 'keystone' ? 2 : nodeType === 'major' ? 1.5 : 1;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      className={className}
      role="img"
      aria-label={`${visual.label} ${nodeType} node${unlocked ? ' (unlocked)' : ' (locked)'}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={glowGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={visual.accentColor} stopOpacity="0.7" />
          <stop offset="60%" stopColor={visual.accentColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={visual.accentColor} stopOpacity="0" />
        </radialGradient>
        {animate && unlocked && (
          <style>{`
            @keyframes ${pulseName} {
              0%, 100% { opacity: 0.4; transform: scale(1); }
              50% { opacity: 0.8; transform: scale(1.12); }
            }
          `}</style>
        )}
      </defs>

      {/* Glow background (unlocked only) */}
      {unlocked && (
        <circle
          cx="30"
          cy="30"
          r="26"
          fill={`url(#${glowGradId})`}
          style={
            animate
              ? { animation: `${pulseName} 2.5s ease-in-out infinite`, transformBox: 'fill-box', transformOrigin: 'center' }
              : undefined
          }
        />
      )}

      {/* Connection stubs */}
      {STUBS.map((s, i) => (
        <line
          key={i}
          x1={s.x1}
          y1={s.y1}
          x2={s.x2}
          y2={s.y2}
          stroke={unlocked ? visual.color : '#555'}
          strokeWidth="1.5"
          strokeOpacity={unlocked ? 0.6 : 0.3}
        />
      ))}

      {/* Node background shape */}
      <path
        d={shape}
        fill={unlocked ? visual.color : '#3a3a4e'}
        fillOpacity={unlocked ? 0.25 : 0.5}
        stroke={unlocked ? visual.color : '#666'}
        strokeWidth={strokeWidth}
        strokeOpacity={unlocked ? 0.9 : 0.5}
      />

      {/* Inner pattern by node type */}
      {nodeType === 'small' && (
        <circle cx="30" cy="30" r="3" fill={unlocked ? visual.accentColor : '#888'} fillOpacity="0.8" />
      )}

      {nodeType === 'major' && (
        <>
          <line x1="30" y1="22" x2="30" y2="38" stroke={unlocked ? visual.accentColor : '#888'} strokeWidth="2" strokeOpacity="0.8" />
          <line x1="22" y1="30" x2="38" y2="30" stroke={unlocked ? visual.accentColor : '#888'} strokeWidth="2" strokeOpacity="0.8" />
        </>
      )}

      {nodeType === 'keystone' && (
        <>
          {/* Tree sigil as SVG text */}
          <text
            x="30"
            y="34"
            textAnchor="middle"
            fontSize="14"
            fontWeight="900"
            fontFamily="monospace"
            fill={unlocked ? visual.accentColor : '#888'}
            fillOpacity="0.95"
          >
            {visual.sigil}
          </text>
          {/* Radiating lines */}
          <line x1="30" y1="10" x2="30" y2="6" stroke={unlocked ? visual.accentColor : '#888'} strokeWidth="1" strokeOpacity="0.6" />
          <line x1="30" y1="50" x2="30" y2="54" stroke={unlocked ? visual.accentColor : '#888'} strokeWidth="1" strokeOpacity="0.6" />
        </>
      )}

      {/* Lock indicator */}
      {locked && (
        <text
          x="30"
          y="35"
          textAnchor="middle"
          fontSize="12"
          fontWeight="900"
          fontFamily="monospace"
          fill="#999"
          fillOpacity="0.6"
        >
          ✕
        </text>
      )}
    </svg>
  );
};
