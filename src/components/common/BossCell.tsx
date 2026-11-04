/**
 * BossCell — the encounter-size boss identity (fight header 48px,
 * defeat mark 38px). A square detail crop of the boss's own sprite —
 * the window is the ONE deterministic rule in the generated identity
 * data (densest upper mass of the sprite's alpha), never hand-placed —
 * over a darkened slice of its own arena, in the plate frame language
 * (warm near-black border, clipped corners, weakness-element strip at
 * the foot). Composed live from already-shipped sprite/arena bytes via
 * background cropping: zero new image assets.
 */
import React from 'react';
import {
  arenaCellSlice,
  bgCropStyle,
  bossArt,
  bossElementVisual,
  bossIdentityData,
  BOSS_PLATE_FRAME,
} from '@/lib/pixel/bossIdentity';

interface BossCellProps {
  bossId: string;
  /** Rendered size in px (square). */
  size?: number;
  className?: string;
}

export const BossCell: React.FC<BossCellProps> = ({ bossId, size = 48, className = '' }) => {
  const art = bossArt(bossId);
  const data = bossIdentityData(bossId);
  const element = bossElementVisual(bossId);
  const strip = Math.max(2, Math.round(size / 16));
  const cut = Math.max(3, Math.round(size / 10));
  const border = Math.max(2, Math.round(size / 16));
  const [wx, wy, side] = data.window;

  return (
    <div
      className={`relative shrink-0 overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        border: `${border}px solid ${BOSS_PLATE_FRAME}`,
        clipPath: `polygon(${cut}px 0, 100% 0, 100% calc(100% - ${cut}px), calc(100% - ${cut}px) 100%, 0 100%, 0 ${cut}px)`,
        backgroundColor: '#0A0705',
      }}
      role="img"
      aria-label={`Boss: ${bossId}`}
      data-testid="boss-cell"
    >
      {art && (
        <>
          <div
            className="absolute inset-0"
            style={{
              ...bgCropStyle(art.arenaUrl, art.arenaWidth, art.arenaHeight, arenaCellSlice(art.arenaWidth, art.arenaHeight)),
              filter: 'brightness(0.5) saturate(0.85)',
            }}
          />
          {/* The sprite as a positioned img, not a background crop:
              the window rule can run past the sprite's edge for tall,
              narrow sprites (the Mirror: 268px window in a 239px-wide
              sprite) — the exploration renderer pads that region
              transparent and the arena shows through, and so does an
              img clipped by the frame. Scale = cell px per file px. */}
          <img
            src={art.spriteUrl}
            alt=""
            aria-hidden="true"
            draggable={false}
            className="absolute"
            style={{
              width: art.spriteWidth * (size / side),
              height: art.spriteHeight * (size / side),
              left: -wx * (size / side),
              top: -wy * (size / side),
              maxWidth: 'none',
              imageRendering: 'pixelated',
            }}
          />
        </>
      )}
      <div className="absolute inset-x-0 bottom-0" style={{ height: strip, backgroundColor: element.color }} />
    </div>
  );
};
