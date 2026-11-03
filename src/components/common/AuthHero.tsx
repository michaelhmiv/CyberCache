/**
 * AuthHero — pixel-art landscape banner for the auth/login screen.
 *
 * A wasteland vista in the game's own pixel language: banded rust dusk,
 * mesas and a ruined skyline, and a cache crate cracked open with gold
 * light beaming out — the game's mark, in its bronze-and-amber palette
 * (DESIGN.md §5). Authored on a native 170×50 grid and scaled ×4 with
 * nearest-neighbor to 680×200, so texels stay honest 4px blocks at DPR 2
 * in the 340×100 slot. Replaces the old procedural gradient SVG, whose
 * purple void and glow-core read off-brand next to the shipped pixel art.
 *
 * Asset: src/assets/auth-banner.png (3.9 KB — smaller than the SVG
 * component it replaces; it lives outside the pixel sprite manifest and
 * does not count against the sprite payload ceiling).
 */
import React from 'react';
import authBannerUrl from '@/assets/auth-banner.png';

interface AuthHeroProps {
  className?: string;
  height?: number;
}

export const AuthHero: React.FC<AuthHeroProps> = ({
  className = '',
  height = 120,
}) => (
  <img
    src={authBannerUrl}
    alt="CyberCache"
    draggable={false}
    className={className}
    style={{ width: '100%', height, objectFit: 'cover', imageRendering: 'pixelated' }}
  />
);
