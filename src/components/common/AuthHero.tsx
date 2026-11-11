/**
 * AuthHero — landscape banner for the auth/login screen.
 *
 * Top-Choice Wave 14 (adopted 2026-11-11): the painterly master of the
 * same scene the old pixel strip showed — banded rust dusk, mesas and a
 * ruined skyline, and the adopted logo's cache crate (charcoal shell,
 * brass latches, cyan status lights, lid cracked in two halves) beaming
 * gold light into the sky. The master is authored at 2720×800 (exact
 * 17:5, the slot's own proportions); the shipped file is its palette-256
 * cut at 680×200 for the 340×100 CSS px slot at DPR 2, so it renders
 * smooth — no pixelated upscale. `objectFit: cover` needs no crop.
 *
 * Asset: src/assets/auth-banner.png (51,509 B palette-256; it lives
 * outside the pixel sprite manifest and does not count against the
 * sprite payload ceiling).
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
    style={{ width: '100%', height, objectFit: 'cover' }}
  />
);
