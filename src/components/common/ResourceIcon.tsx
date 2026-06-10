/**
 * ResourceIcon — renders a small (18–24px) procedural SVG icon for any
 * game resource using the visualAssets registry + resourceSilhouettes shapes.
 *
 * Central source of truth: change a VisualAsset in constants/visualAssets.ts
 * or a silhouette in constants/resourceSilhouettes.ts and every ResourceIcon
 * across the site updates automatically.
 *
 * At small sizes (< 24px) SVG filters are skipped — they wash out color.
 * Instead we use bold solid fills with the mark letter for instant recognition.
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

/** Maps texture names from visualAssets to the SharedDefs filter IDs.
 *  Only used when size >= 24 — small icons skip filters for clarity. */
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

  const useFilters = size >= 24;
  const textureFilter = useFilters && asset.texture ? TEXTURE_FILTER[asset.texture] : undefined;
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
      {useFilters && (
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
      )}

      {/* Body — main silhouette filled with bold primary color */}
      <path
        d={silhouette.body}
        fill={asset.color}
        fillOpacity={0.92}
        stroke={useFilters ? asset.accentColor : 'rgba(0,0,0,0.3)'}
        strokeWidth={0.8}
        strokeOpacity={0.5}
        {...(useFilters && textureFilter ? { filter: textureFilter } : {})}
      />

      {/* Core — inner shape in brighter accent, gives the icon its identity */}
      {silhouette.core && (
        <path
          d={silhouette.core}
          fill={asset.accentColor}
          fillOpacity={0.4}
          stroke={asset.color}
          strokeWidth={0.4}
          strokeOpacity={0.3}
        />
      )}

      {/* Highlight — small bright detail for visual pop */}
      {silhouette.highlight && (
        <path
          d={silhouette.highlight}
          fill={asset.accentColor}
          fillOpacity={0.85}
          {...(useFilters ? { filter: `url(#glow-${id})` } : {})}
        />
      )}

      {/* Mark — single bold letter in the center for instant recognition */}
      {asset.mark && (
        <text
          x="12"
          y={size < 20 ? '16.5' : '17'}
          textAnchor="middle"
          fontSize={size < 20 ? '10' : '9'}
          fontWeight="bold"
          fill={asset.accentColor}
          fillOpacity={0.95}
          fontFamily="monospace"
          stroke="#000"
          strokeWidth="0.8"
          strokeOpacity={0.3}
        >
          {asset.mark}
        </text>
      )}
    </svg>
  );
};
