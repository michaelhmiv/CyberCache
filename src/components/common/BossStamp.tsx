/**
 * BossStamp — the micro boss identity mark (picker rows 20px, fight
 * vitals line 14px). The boss's own alpha silhouette quantized to a
 * 14-column texel grid in two tones sampled from its own pixels
 * (DESIGN.md §8 detail level 0), generated into bossIdentityData by
 * scripts/generate-boss-identity.py and rasterized once to a cached
 * data URL. The boss's name always prints beside the mark — the
 * stamp's job is a creature-shaped color mark, not a portrait.
 */
import React from 'react';
import { bossIdentityData, bossStampUrl } from '@/lib/pixel/bossIdentity';

interface BossStampProps {
  bossId: string;
  /** Rendered width in px (height follows the grid's own aspect). */
  size?: number;
  className?: string;
}

export const BossStamp: React.FC<BossStampProps> = ({ bossId, size = 20, className = '' }) => {
  const data = bossIdentityData(bossId);
  const url = bossStampUrl(bossId);
  const height = Math.max(1, Math.round((size * data.stamp.rows) / data.stamp.cols));
  if (!url) {
    // Canvas unavailable (SSR/tests): hold the footprint, draw nothing.
    return <span aria-hidden="true" className={`inline-block shrink-0 ${className}`} style={{ width: size, height }} />;
  }
  return (
    <img
      src={url}
      width={size}
      height={height}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`inline-block shrink-0 ${className}`}
      style={{ imageRendering: 'pixelated' }}
    />
  );
};
