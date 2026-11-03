import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { AnimatePresence, motion } from 'framer-motion';
import { MobileCard } from '@/components/layout/MobileCard';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { ShowcaseWeaponRow } from './ShowcaseRows';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import { useHunterLooks } from '@/lib/pixel/useHunterLooks';
import { COLLECTION_TOTAL } from '@/content/collections';
import type { PlayerPublicProfile, PlayerShowcaseData } from '@/lib/api/publicProfileService';

/**
 * Public profile pop-up (redesigned 0058 through impeccable).
 *
 * The pre-0058 pop-up was a dead end: a flat stat dump at 9–10px
 * (below the DESIGN.md §5 floor), a Lucide close glyph (§7: icons
 * are the pixel sheet), no portrait, no showcase, and no way onward
 * — the owner tapped a hunter in Standings, got this, and could not
 * reach their profile. The redesign gives the pop-up one job — be
 * the DOOR to the full profile — and dresses it in the Sheet
 * grammar: the hunter's actual worn look up top, their Trophy
 * Shelf under it, the brag facts as chips, the full stat record
 * grouped below, and a primary View Full Profile action. Every
 * figure the old pop-up showed is still here; nothing transacts
 * (Guest Visibility Law: seeing is free).
 */

const panelClip = { clipPath: 'polygon(16px 0,100% 0,100% calc(100% - 16px),calc(100% - 16px) 100%,0 100%,0 16px)' };

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex justify-between gap-3 text-xs">
    <span className="text-text-muted">{label}</span>
    <span className="font-bold text-text-primary">{value}</span>
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-black uppercase tracking-wide text-text-muted">{children}</div>
);

/** The full public stat record, grouped — shared by the pop-up and
 * the full profile sheet so the numbers read identically in both. */
export const PublicProfileStats: React.FC<{ profile: PlayerPublicProfile }> = ({ profile }) => (
  <div className="space-y-2">
    <MobileCard className="space-y-2" rarityColor="#FF9000">
      <SectionTitle>Progression</SectionTitle>
      <Row label="Level" value={profile.level.toLocaleString()} />
      <Row label="XP" value={profile.xp.toLocaleString()} />
      <Row label="Mastery XP" value={profile.total_mastery_xp.toLocaleString()} />
      <Row label="Highest Mastery" value={profile.highest_mastery_level} />
    </MobileCard>

    <MobileCard className="space-y-2" rarityColor="#FF4B5C">
      <SectionTitle>Combat</SectionTitle>
      <Row label="Kills" value={profile.total_kills.toLocaleString()} />
      <Row label="Deaths" value={profile.total_deaths.toLocaleString()} />
      <Row label="K/D" value={profile.kill_death_ratio == null ? '—' : profile.kill_death_ratio.toFixed(2)} />
      <Row label="Highest Boss Tier" value={profile.highest_boss_tier} />
    </MobileCard>

    <MobileCard className="space-y-2" rarityColor="#7CFC00">
      <SectionTitle>Economy</SectionTitle>
      <Row label="Net Worth" value={profile.net_worth.toLocaleString()} />
    </MobileCard>

    <MobileCard className="space-y-2" rarityColor="#FFEA3A">
      <SectionTitle>Collection</SectionTitle>
      <Row label="Total Items" value={profile.total_items} />
      <Row label="Weapons" value={profile.weapons_owned} />
      <Row label="Legendaries" value={profile.legendary_items} />
      <Row label="Highest Item Level" value={profile.highest_item_level} />
    </MobileCard>
  </div>
);

const FactChip: React.FC<{ label: string; value: string; tone: string }> = ({ label, value, tone }) => (
  <div className="bl-card min-w-0 flex-1 px-2 py-2 text-center" style={{ borderTopColor: tone, borderTopWidth: 3 }}>
    <div className="break-words text-sm font-black leading-tight text-text-primary">{value}</div>
    <div className="text-[11px] font-bold uppercase leading-tight tracking-wide text-text-muted">{label}</div>
  </div>
);

/** The shelf's brag facts as chips — the same three the owner's own
 * Trophy Shelf carries (Best Depth / Cache Rank / Collections). */
export const ShowcaseFactChips: React.FC<{ showcase: PlayerShowcaseData }> = ({ showcase }) => (
  <div className="flex gap-2">
    <FactChip label="Best Depth" value={String(showcase.best_endless_depth)} tone="#FF4B5C" />
    <FactChip
      label="Cache Rank"
      value={`${showcase.cache_rank_total_ranks} ranks · ${showcase.cache_rank_tokens} tokens`}
      tone="#F2C063"
    />
    <FactChip label="Collections" value={`${showcase.collections_discovered} / ${COLLECTION_TOTAL}`} tone="#FF9800" />
  </div>
);

/** The hunter's shelf: pinned-first rows through the shared row. */
export const PublicShowcase: React.FC<{ showcase: PlayerShowcaseData }> = ({ showcase }) => (
  <div className="space-y-2">
    <div className="flex items-center gap-2">
      <PxIcon name="trophy" size={15} className="text-amber" />
      <div className="text-xs font-black uppercase tracking-wide text-text-primary">Trophy Shelf</div>
      {showcase.pinned_item_ids.length > 0 && (
        <div className="ml-auto text-[11px] text-text-muted">Hand-pinned by the hunter</div>
      )}
    </div>
    {showcase.top_weapons.length === 0 ? (
      <div className="text-[11px] text-text-muted">No trophies shelved yet.</div>
    ) : (
      showcase.top_weapons.map((item, index) => (
        <ShowcaseWeaponRow
          key={item.id}
          item={item}
          index={index}
          pinned={showcase.pinned_item_ids.includes(item.id)}
        />
      ))
    )}
    <ShowcaseFactChips showcase={showcase} />
  </div>
);

interface PublicProfilePanelProps {
  open: boolean;
  onClose: () => void;
  profile: PlayerPublicProfile | null;
  /** The door to the full profile sheet — the pop-up's main job. */
  onViewFull?: () => void;
}

export const PublicProfilePanel: React.FC<PublicProfilePanelProps> = ({ open, onClose, profile, onViewFull }) => {
  const looks = useHunterLooks(profile ? [profile.player_id] : []);
  const look = profile ? looks[profile.player_id] : undefined;
  const name = profile?.username ?? profile?.display_name ?? 'Vault Runner';
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
              <div className="flex min-w-0 items-center gap-3">
                {look ? (
                  <div className="w-14 shrink-0 border-2 border-border bg-surface" data-testid="public-profile-portrait">
                    <HunterPortrait look={resolveLookView(look)} className="h-16" />
                  </div>
                ) : (
                  <div className="flex h-16 w-14 shrink-0 items-center justify-center border-2 border-border bg-surface">
                    <PxIcon name="person" size={17} className="text-amber" />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-[11px] font-black uppercase tracking-[0.24em] text-amber">Public Profile</div>
                  <div className="bl-title break-words text-xl leading-tight text-text-primary">{name}</div>
                  {profile && (
                    <div className="text-[11px] font-bold text-text-muted">
                      Level {profile.level} hunter · {profile.weapons_owned} weapons
                    </div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                data-testid="public-profile-close"
                className="bl-secondary min-h-[44px] shrink-0 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-text-primary"
              >
                Close
              </button>
            </div>

            {!profile ? (
              <div className="h-32 animate-pulse rounded bg-bg" />
            ) : (
              <div className="space-y-3">
                {profile.showcase && <PublicShowcase showcase={profile.showcase} />}
                <PublicProfileStats profile={profile} />
                {onViewFull && (
                  <button
                    type="button"
                    onClick={onViewFull}
                    data-testid="public-profile-view-full"
                    className="bl-primary min-h-[44px] w-full px-4 py-3 text-xs font-black uppercase tracking-wide"
                  >
                    View Full Profile
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PublicProfilePanel;
