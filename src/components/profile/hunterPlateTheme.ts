/**
 * The Arena Plates theme (owner pick A, 2026-11-05) — the shared
 * constants of the Hunter plate register: bone-white scrim ink,
 * steel, amber, the clipped-corner plate shell. Kept in a
 * component-free module so the plate components file can satisfy
 * the fast-refresh export rule; SkillTreeScreen and MasterySection
 * consume the same constants so the whole trees stop wears one
 * register.
 */
import type React from 'react';

export const BONE = '#F5EFE6';
export const BONE_MUTED = '#C9BBA6';
export const BONE_FAINT = '#968A78';
export const STEEL = '#6B6257';
export const AMBER = '#FF9000';
export const AMBER_GLOW = '#FFEA3A';

export const PLATE_CLIP =
  'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';

export const plateShell: React.CSSProperties = {
  clipPath: PLATE_CLIP,
  border: '2px solid #000',
  background: 'linear-gradient(158deg, #1D1811 0%, #12100C 58%, #0C0A08 100%)',
  boxShadow: '5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 1px rgba(163,152,134,0.28)',
};
