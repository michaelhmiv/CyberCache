/**
 * ResourceIcon — renders a small (24px default) procedural SVG icon for any
 * game resource using the visualAssets registry + resourceSilhouettes shapes.
 *
 * Central source of truth: change a VisualAsset in constants/visualAssets.ts
 * and every ResourceIcon across the site updates automatically.
 */
import React, { useMemo } from 'react';
import { getResourceVisual, type ResourceVisualId, type VisualAsset } from '@/constants/visualAssets';
import { pickResourceSilhouette, type ResourceSilhouetteId } from '@/constants/resourceSilhouettes';
import { SharedDefs } from '@/components/gearArt/SharedDefs';

interface ResourceIconProps {
  /** Resource ID from the visualAssets registry (e.g., 'credits', 'scrap') */
  id: ResourceVisualId;
  /** Icon size in pixels (default 24) */
  size?: number;
  /** Deterministic seed for silhouette variant selection */
  seed?: number;
  /** Custom class for the SVG wrapper */
  className?: string;
}

/** Maps texture names from visualAssets to the SharedDefs filter IDs */
const TEXTURE_FILTER: Record<string, string> = {
  metal: 'url(#surface-metal)',
  crystal: 'url(#surface-crystal)',
  energy: 'url(#surface-energy)',
  ordnance: 'url(#surface-ordnance)',
  data: 'url(#surface-data)',
  organic: 'url(#surface-organic)',
  liquid: 'url(#surface-liquid)',
};

export const ResourceIcon: React.FC<ResourceIconProps> = ({
  id,
  size = 24,
  seed = 0,
  className = '',
}) => {
  const asset: VisualAsset = useMemo(() => getResourceVisual(id), [id]);
  const silhouette = useMemo(
    () => pickResourceSilhouette(id as ResourceSilhouetteId, seed),
    [id, seed],
  );

  const textureFilter = asset.texture ? TEXTURE_FILTER[asset.texture] : undefined;
  const viewBox = '0 0 24 24';

  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      className={className}
      role="img"
      aria-label={asset.label}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <SharedDefs />
        {/* Inner glow for the highlight path */}
        <filter id={`glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Body — main silhouette filled with primary color + surface texture */}
      <path
        d={silhouette.body}
        fill={asset.color}
        fillOpacity={0.85}
        stroke={asset.accentColor}
        strokeWidth={0.6}
        strokeOpacity={0.6}
        filter={textureFilter}
      />

      {/* Detail — inner shape, slightly lighter */}
      {silhouette.detail && (
        <path
          d={silhouette.detail}
          fill={asset.accentColor}
          fillOpacity={0.25}
          stroke={asset.color}
          strokeWidth={0.4}
          strokeOpacity={0.4}
        />
      )}

      {/* Highlight — rendered in accent color with glow */}
      {silhouette.highlight && (
        <path
          d={silhouette.highlight}
          fill={asset.accentColor}
          fillOpacity={0.7}
          filter={`url(#glow-${id})`}
        />
      )}

      {/* Mark — single letter badge in the center when icon is large enough */}
      {size >= 20 && (
        <text
          x="12"
          y="17"
          textAnchor="middle"
          fontSize={size < 24 ? '8' : '9'}
          fontWeight="bold"
          fill={asset.accentColor}
          fillOpacity={0.9}
          fontFamily="monospace"
        >
          {asset.mark}
        </text>
      )}
    </svg>
  );
};
