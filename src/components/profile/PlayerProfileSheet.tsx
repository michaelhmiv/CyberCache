import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence, motion } from 'framer-motion';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { PublicProfileStats, PublicShowcase } from './PublicProfilePanel';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import { useHunterLooks } from '@/lib/pixel/useHunterLooks';
import type { PlayerPublicProfile } from '@/lib/api/publicProfileService';

/**
 * The full player profile (0058) — the destination the Standings
 * pop-up's door opens. Before this sheet there was NO route to
 * another hunter's profile at all: the pop-up was the whole
 * surface. Here the hunter gets the stage they get on their own
 * Hunter tab — the worn look at stage size, the Trophy Shelf with
 * its hand-pinned headliners, the brag chips, and the complete
 * public stat record. Read-only by construction: the surface
 * renders the public projection (GET
 * /api/players/:id/public-profile) and offers no action but Close;
 * guests see it in full (Guest Visibility Law — seeing is free,
 * nothing here transacts).
 */

const monthYear = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export const PlayerProfileSheet: React.FC<{
  open: boolean;
  profile: PlayerPublicProfile | null;
  onClose: () => void;
}> = ({ open, profile, onClose }) => {
  const looks = useHunterLooks(profile ? [profile.player_id] : []);
  const look = profile ? looks[profile.player_id] : undefined;
  const name = profile?.username ?? profile?.display_name ?? 'Vault Runner';
  return (
    <AnimatePresence>
      {open && profile && (
        <motion.div
          className="fixed inset-0 z-[80] overflow-y-auto bg-bg"
          initial={{ opacity: 0, x: 32 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 32 }}
          transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          data-testid="player-profile-sheet"
        >
          <div className="mx-auto w-full max-w-[480px] space-y-3 p-3 pb-10">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-amber">Hunter Profile</div>
              <button
                type="button"
                onClick={onClose}
                data-testid="player-profile-close"
                className="bl-secondary min-h-[44px] px-3 py-2 text-[11px] font-black uppercase tracking-wide text-text-primary"
              >
                Close
              </button>
            </div>

            {/* The stage: the hunter's actual worn look, stage size —
                the same parts render their own Hunter tab uses. */}
            <div className="border-2 border-border bg-surface" data-testid="player-profile-stage">
              {look ? (
                <HunterPortrait look={resolveLookView(look)} className="h-60" testId="player-profile-portrait" />
              ) : (
                <div className="flex h-60 items-center justify-center">
                  <PxIcon name="person" size={34} className="text-amber" />
                </div>
              )}
            </div>

            <div>
              <div className="bl-title break-words text-2xl leading-tight text-text-primary">{name}</div>
              <div className="mt-1 text-xs font-bold text-text-muted">
                Level {profile.level} hunter · Hunting since {monthYear(profile.joined_at)} · Last active{' '}
                {shortDay(profile.last_active_at)}
              </div>
            </div>

            {profile.showcase && <PublicShowcase showcase={profile.showcase} />}

            <PublicProfileStats profile={profile} />

            <div className="text-[11px] text-text-muted">
              Read-only — this is {name}&apos;s public record: the shelf they pinned, the look they wear, and the
              stats the game keeps for everyone to see.
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PlayerProfileSheet;
