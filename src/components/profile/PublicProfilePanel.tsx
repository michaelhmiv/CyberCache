import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { MobileCard } from '@/components/layout/MobileCard';
import type { PlayerPublicProfile } from '@/lib/api/publicProfileService';

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };

interface PublicProfilePanelProps {
  open: boolean;
  onClose: () => void;
  profile: PlayerPublicProfile | null;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between gap-3 text-xs">
    <span className="text-text-muted">{label}</span>
    <span className="font-bold text-text-primary">{value}</span>
  </div>
);

export const PublicProfilePanel: React.FC<PublicProfilePanelProps> = ({ open, onClose, profile }) => {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/85"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 320 }}
            className="max-h-[92vh] w-full max-w-[480px] overflow-y-auto border-t-2 border-border bg-bg p-3 shadow-[0_-12px_32px_rgba(0,0,0,0.75)]"
            style={panelClip}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex justify-center"><div className="h-1.5 w-12 rounded-full bg-border" /></div>

            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center border-2 border-border bg-surface">
                  <PxIcon name="person" size={17} className="text-amber" />
                </div>
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.24em] text-amber">Public Profile</div>
                  <div className="bl-title text-xl leading-none text-text-primary">
                    {profile?.username ?? profile?.display_name ?? `Player ${profile?.player_id.slice(0, 6) ?? ''}`}
                  </div>
                </div>
              </div>
              <button type="button" onClick={onClose} className="bl-secondary shrink-0 p-2 text-text-muted"><X size={15} /></button>
            </div>

            {!profile ? (
              <div className="h-32 animate-pulse rounded bg-bg" />
            ) : (
              <div className="space-y-2">
                <MobileCard className="space-y-2" rarityColor="#FF9000">
                  <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Progression</div>
                  <Row label="Level" value={profile.level.toLocaleString()} />
                  <Row label="XP" value={profile.xp.toLocaleString()} />
                  <Row label="Mastery XP" value={profile.total_mastery_xp.toLocaleString()} />
                  <Row label="Highest Mastery" value={profile.highest_mastery_level} />
                </MobileCard>

                <MobileCard className="space-y-2" rarityColor="#FF4B5C">
                  <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Combat</div>
                  <Row label="Kills" value={profile.total_kills.toLocaleString()} />
                  <Row label="Deaths" value={profile.total_deaths.toLocaleString()} />
                  <Row label="K/D" value={profile.kill_death_ratio.toFixed(2)} />
                  <Row label="Highest Boss Tier" value={profile.highest_boss_tier} />
                </MobileCard>

                <MobileCard className="space-y-2" rarityColor="#7CFC00">
                  <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Economy</div>
                  <Row label="Net Worth" value={profile.net_worth.toLocaleString()} />
                </MobileCard>

                <MobileCard className="space-y-2" rarityColor="#FFEA3A">
                  <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">Collection</div>
                  <Row label="Total Items" value={profile.total_items} />
                  <Row label="Weapons" value={profile.weapons_owned} />
                  <Row label="Legendaries" value={profile.legendary_items} />
                  <Row label="Highest Item Level" value={profile.highest_item_level} />
                </MobileCard>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PublicProfilePanel;
