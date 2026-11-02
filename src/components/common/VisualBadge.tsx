import React from 'react';
import { VisualAsset, VisualAssetKind, getVisualAsset } from '@/constants/visualAssets';
import { PxIcon } from '@/components/pixelArt/PxIcon';

interface VisualBadgeProps {
  kind?: VisualAssetKind;
  id?: string;
  asset?: VisualAsset;
  label?: boolean;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClass = {
  xs: { box: 'h-5 min-w-5 px-1 text-[8px]', mark: 'text-[9px]', label: 'text-[8px]' },
  sm: { box: 'h-7 min-w-7 px-1.5 text-[9px]', mark: 'text-[10px]', label: 'text-[9px]' },
  md: { box: 'h-9 min-w-9 px-2 text-[10px]', mark: 'text-xs', label: 'text-[10px]' },
  lg: { box: 'h-11 min-w-11 px-2.5 text-xs', mark: 'text-sm', label: 'text-[11px]' },
};

export const VisualBadge: React.FC<VisualBadgeProps> = ({
  kind,
  id,
  asset: providedAsset,
  label = false,
  size = 'sm',
  className = '',
}) => {
  const asset = providedAsset ?? (kind && id ? getVisualAsset(kind, id) : undefined);
  if (!asset) return null;
  const classes = sizeClass[size];

  return (
    <span
      className={`inline-flex items-center justify-center gap-1 border-2 border-border bg-bg font-black uppercase tracking-wide shadow-[2px_2px_0_rgba(0,0,0,0.65)] ${classes.box} ${className}`}
      style={{
        color: asset.color,
        borderLeftColor: asset.color,
        borderLeftWidth: 4,
        clipPath: 'polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%)',
      }}
      title={asset.label}
      aria-label={asset.label}
    >
      {asset.icon ? <PxIcon name={asset.icon} size={size === 'lg' ? 26 : size === 'md' ? 17 : 13} /> : <span className={`leading-none ${classes.mark}`}>{asset.mark}</span>}
      {label && <span className={`leading-none text-text-primary ${classes.label}`}>{asset.shortLabel}</span>}
    </span>
  );
};

export const AssetMark: React.FC<{ asset: VisualAsset; className?: string }> = ({ asset, className = '' }) => (
  <span
    className={`inline-flex h-8 w-8 items-center justify-center border-2 border-border bg-bg font-black ${className}`}
    style={{ color: asset.color, backgroundColor: `${asset.color}18`, clipPath: 'polygon(7px 0,100% 0,100% calc(100% - 7px),calc(100% - 7px) 100%,0 100%,0 7px)' }}
    title={asset.label}
  >
    {asset.icon ? <PxIcon name={asset.icon} size={17} /> : asset.mark}
  </span>
);
