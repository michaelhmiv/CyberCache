/**
 * CacheRankGalleryPage — PROTOTYPE (design/hunter-subpages-rank-c,
 * 2026-11-05). NOT shipped UI. Variant C, "Showcase": Cache Rank
 * hung as a gallery wall — the medals and milestones as exhibited
 * pieces, art carrying the page, chrome reduced to picture frames
 * and museum captions.
 *
 * Impeccable pass (skill named per the standing rule): full design
 * authority exercised WITHIN the Showcase register. The deliberate
 * breaks from variant A's Arena Plates grammar are the point of
 * the variant: no machined plates, no corner bolts, no foot
 * strips, no segment ladders, no gauge wells, no rotated stamps,
 * no hard offset shadows. Progress is a hairline and a row of
 * pips; state is a caption sentence; pieces hang in thin frames
 * on a near-black wall with soft offset shadows.
 *
 * Content truth: everything derives from the cacheRankStateView
 * the harness supplies (the game's own derivation). Milestone
 * grants are automatic server-side — the wall says so; there is
 * no claim button anywhere on this page, because the system has
 * none. Spend controls carry the real cost curve.
 */
import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { PxIcon, PxIconGlyph } from '@/components/pixelArt/PxIcon';
import { getPixelSprite } from '@/lib/pixel/manifest';
import {
  formatCacheRankPct,
  type CacheRankMilestoneView,
  type CacheRankStateView,
  type CacheRankTrackView,
} from '@/content/cacheRank';

/* ─── Gallery palette ────────────────────────────────────────────── */

const WALL = '#0A0806';
const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
const BONE_FAINT = '#A2957F';
const GOLD = '#F2C063';
const AMBER = '#FF9000';
const FRAME_LINE = 'rgba(245,239,230,0.16)';
const PIECE_BG = 'linear-gradient(180deg, #151009 0%, #0D0A07 100%)';
const PIECE_SHADOW = '0 18px 34px rgba(0,0,0,0.5)';

const display: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.05em',
  fontWeight: 400,
};

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.18em',
};

/* ─── Small gallery furniture ────────────────────────────────────── */

/** A hung piece: thin picture frame, mat, soft shadow. */
const Piece: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={`relative ${className}`}
    style={{ border: `1px solid ${FRAME_LINE}`, background: PIECE_BG, boxShadow: PIECE_SHADOW }}
  >
    {children}
  </div>
);

const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="mb-4 mt-10 flex items-baseline gap-3 px-4">
    <h2 style={{ ...display, fontSize: 23, color: BONE }}>{children}</h2>
    <span aria-hidden="true" className="h-px flex-1" style={{ backgroundColor: FRAME_LINE }} />
  </div>
);

/** Rank pips — the gallery's progress mark (dots, never segments). */
const Pips: React.FC<{ filled: number; total: number; color: string; size?: number }> = ({
  filled,
  total,
  color,
  size = 8,
}) => (
  <div className="flex items-center justify-center gap-[6px]" role="img" aria-label={`${filled} of ${total} ranks`}>
    {Array.from({ length: total }, (_, i) => (
      <span
        key={i}
        aria-hidden="true"
        className="rounded-full"
        style={{
          width: size,
          height: size,
          backgroundColor: i < filled ? color : 'rgba(245,239,230,0.14)',
        }}
      />
    ))}
  </div>
);

/** The medallion itself — a round object, drawn as one. */
const Medallion: React.FC<{ track: CacheRankTrackView; size: number }> = ({ track, size }) => {
  const iconSize = Math.round(size * 0.44);
  return (
    <div
      aria-hidden="true"
      className="relative flex items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 50% 34%, #241C12 0%, #120E09 62%, #0A0806 100%)`,
        boxShadow: `inset 0 0 0 3px ${track.color}, inset 0 0 0 6px rgba(0,0,0,0.65), inset 0 0 0 7px rgba(245,239,230,0.14), 0 14px 28px rgba(0,0,0,0.55)`,
      }}
    >
      {/* The glyph at gallery scale rides PxIconGlyph — the sheet's
          own sanctioned path for embedding an icon inside larger art
          (PxIcon's size prop is token-locked to 13/17/26/40). */}
      <svg
        viewBox="0 0 16 16"
        width={iconSize}
        height={iconSize}
        shapeRendering="crispEdges"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        <PxIconGlyph name={track.icon} color={track.color} />
      </svg>
    </div>
  );
};

/** The spend control in its three honest states. */
const SpendControl: React.FC<{
  track: CacheRankTrackView;
  tokens: number;
  busy: boolean;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ track, tokens, busy, onSpend }) => {
  if (track.maxed) {
    return (
      <div className="flex min-h-[48px] items-center justify-center" style={{ ...label, color: BONE_FAINT }}>
        In the collection
      </div>
    );
  }
  const cost = track.nextCost ?? 0;
  const short = cost - tokens;
  if (short > 0) {
    return (
      <button
        type="button"
        disabled
        className="min-h-[48px] w-full cursor-not-allowed"
        style={{ ...label, border: `1px solid ${FRAME_LINE}`, color: BONE_FAINT, backgroundColor: 'transparent' }}
      >
        Need {short} more {short === 1 ? 'token' : 'tokens'}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onSpend(track)}
      className="min-h-[48px] w-full transition-transform active:scale-[0.99]"
      style={{
        ...label,
        color: '#0A0806',
        backgroundColor: busy ? BONE_FAINT : AMBER,
        boxShadow: '0 10px 22px rgba(0,0,0,0.45)',
      }}
    >
      {busy ? 'Spending…' : `Spend ${cost} ${cost === 1 ? 'token' : 'tokens'} — rank ${track.ranks + 1}`}
    </button>
  );
};

/* ─── The hero: the centerpiece ──────────────────────────────────── */

const Hero: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const crate = getPixelSprite('crate');
  const pct =
    state.xpForLevel > 0 ? Math.min(100, Math.round((state.xpIntoLevel / state.xpForLevel) * 100)) : 100;
  return (
    <header>
      {/* The centerpiece — full-bleed, lit like a gallery piece. */}
      <div
        className="relative flex items-end justify-center overflow-hidden"
        style={{
          minHeight: 252,
          background:
            'radial-gradient(ellipse 95% 70% at 50% 30%, rgba(242,192,99,0.17) 0%, rgba(242,192,99,0.05) 46%, rgba(10,8,6,0) 72%), linear-gradient(180deg, #100C07 0%, #0A0806 100%)',
        }}
      >
        {crate && (
          <img
            src={crate.url}
            alt="The cache — a cracked-open supply crate with gold light beaming out"
            draggable={false}
            style={{ width: 246, imageRendering: 'pixelated', marginBottom: 26 }}
          />
        )}
        {/* The plinth line the piece stands on. */}
        <span
          aria-hidden="true"
          className="absolute inset-x-10 bottom-[22px] h-px"
          style={{ backgroundColor: 'rgba(245,239,230,0.22)' }}
        />
      </div>

      {/* The caption plaque — the museum label under the piece. */}
      <div className="px-4">
        <h1 style={{ ...display, fontSize: 38, lineHeight: 1, color: BONE }}>Cache Rank</h1>
        <p className="mt-2 text-[13px] leading-relaxed" style={{ color: BONE_MUTED }}>
          Level {state.level} · {state.tokensEarned} tokens earned ·{' '}
          <span style={{ color: GOLD, fontWeight: 800 }}>{state.tokens} in hand</span>
        </p>
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: BONE_FAINT }}>
          Permanent bonuses, bought with tokens your levels pay you. Nothing here is claimed —
          tokens land on their own as you level; spending them is the only decision.
        </p>

        {/* Next-token progress: one hairline, the fraction in full. */}
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span style={{ ...label, color: BONE_FAINT }}>
              {state.nextTokenLevel ? `Next token at Level ${state.nextTokenLevel}` : 'Every token earned'}
            </span>
            <span className="text-[11px] font-bold" style={{ color: BONE_MUTED }}>
              {state.xpForLevel > 0
                ? `${state.xpIntoLevel.toLocaleString()} / ${state.xpForLevel.toLocaleString()} XP · ${pct}%`
                : 'Level cap'}
            </span>
          </div>
          <div
            className="mt-2 h-[3px] w-full"
            role="img"
            aria-label={`Next token progress ${pct}%`}
            style={{ backgroundColor: 'rgba(245,239,230,0.12)' }}
          >
            <div className="h-full" style={{ width: `${pct}%`, backgroundColor: GOLD }} />
          </div>
        </div>
      </div>
    </header>
  );
};

/* ─── The milestone wall ─────────────────────────────────────────── */

/** One exhibited guardian per bundle door — the game's boss art. */
const MILESTONE_ART: Record<number, string> = {
  10: 'boss-heap-guard',
  25: 'boss-mirage-duster',
  50: 'boss-rust-prophet',
  75: 'boss-dune-tyrant',
  100: 'boss-vaultkeeper-omega',
};

const MilestonePiece: React.FC<{
  milestone: CacheRankMilestoneView;
  state: CacheRankStateView;
  index: number;
}> = ({ milestone, state, index }) => {
  const sprite = getPixelSprite(MILESTONE_ART[milestone.level]);
  const isNext = !milestone.claimed && state.milestones.find((m) => !m.claimed)?.level === milestone.level;
  const flip = index % 2 === 1;
  const caption = milestone.claimed
    ? `Granted — paid on its own when you reached Level ${milestone.level}.`
    : isNext
      ? `Next — ${milestone.level - state.level} ${milestone.level - state.level === 1 ? 'level' : 'levels'} to go.`
      : `Pays on its own at Level ${milestone.level}.`;
  return (
    <Piece className="mx-4 mb-4">
      <div className={`flex items-center gap-4 px-5 py-5 ${flip ? 'flex-row-reverse text-right' : ''}`}>
        {sprite && (
          <img
            src={sprite.url}
            alt=""
            draggable={false}
            style={{
              height: 148,
              imageRendering: 'pixelated',
              opacity: milestone.claimed || isNext ? 1 : 0.38,
            }}
          />
        )}
        <div className="min-w-0 flex-1">
          <div style={{ ...label, color: BONE_FAINT }}>Level {milestone.level}</div>
          <div
            style={{
              ...display,
              fontSize: 62,
              lineHeight: 0.95,
              color: milestone.claimed ? GOLD : isNext ? BONE : 'rgba(245,239,230,0.4)',
            }}
          >
            +{milestone.bundle}
          </div>
          <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>
            {milestone.bundle === 1 ? 'Token' : 'Tokens'}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
            {caption}
          </p>
        </div>
      </div>
    </Piece>
  );
};

/* ─── The medal gallery ──────────────────────────────────────────── */

const MedalPiece: React.FC<{
  track: CacheRankTrackView;
  tokens: number;
  busy: boolean;
  onSpend: (track: CacheRankTrackView) => void;
  onOpen: (track: CacheRankTrackView) => void;
}> = ({ track, tokens, busy, onSpend, onOpen }) => (
  <Piece className="mx-4 mb-4">
    <div className="flex flex-col items-center px-5 pb-5 pt-6">
      <button
        type="button"
        onClick={() => onOpen(track)}
        aria-label={`${track.name} — view the piece`}
        className="flex min-h-[44px] items-center justify-center"
      >
        <Medallion track={track} size={128} />
      </button>
      <div className="mt-4" style={{ ...display, fontSize: 44, lineHeight: 1, color: track.color }}>
        {formatCacheRankPct(track.effect)}
      </div>
      <div className="mt-1" style={{ ...display, fontSize: 21, color: BONE }}>
        {track.name}
      </div>
      <p className="mt-1 max-w-[270px] text-center text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
        {track.summary}
      </p>
      <div className="mt-3">
        <Pips filled={track.ranks} total={track.maxRanks} color={track.color} />
      </div>
      <div className="mt-2" style={{ ...label, color: BONE_FAINT }}>
        Rank {track.ranks} of {track.maxRanks}
        {track.nextCost !== null && ` · next ${formatCacheRankPct(track.perRank)}`}
      </div>
      <div className="mt-4 w-full">
        <SpendControl track={track} tokens={tokens} busy={busy} onSpend={onSpend} />
      </div>
    </div>
  </Piece>
);

/* ─── The exhibition sheet (detail) ──────────────────────────────── */

const SHORT_TOTALS: Record<string, string> = {
  credits: 'credits',
  xp: 'XP',
  scrap: 'scrap',
  damage: 'damage',
  maxHp: 'max HP',
  cacheQuality: 'cache quality',
  marketProceeds: 'market proceeds',
};

const DetailSheet: React.FC<{
  track: CacheRankTrackView | null;
  tokens: number;
  busyTrack: string | null;
  onSpend: (track: CacheRankTrackView) => void;
  onClose: () => void;
}> = ({ track, tokens, busyTrack, onSpend, onClose }) => (
  <AnimatePresence>
    {track && (
      <motion.div
        className="fixed inset-0 z-[90] flex items-end justify-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{ backgroundColor: 'rgba(4,3,2,0.82)' }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 30, stiffness: 320 }}
          className="max-h-[86vh] w-full max-w-[430px] overflow-y-auto px-5 pb-6 pt-5"
          style={{ backgroundColor: '#100C08', borderTop: `1px solid ${FRAME_LINE}`, boxShadow: '0 -18px 40px rgba(0,0,0,0.6)' }}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label={`${track.name} detail`}
        >
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center"
              style={{ color: BONE_FAINT, border: `1px solid ${FRAME_LINE}` }}
            >
              <PxIcon name="x" size={17} />
            </button>
          </div>
          <div className="flex flex-col items-center">
            <Medallion track={track} size={168} />
            <div className="mt-4" style={{ ...display, fontSize: 30, color: BONE }}>
              {track.name}
            </div>
            <p className="mt-1 max-w-[280px] text-center text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
              {track.summary}
            </p>
            <div className="mt-3" style={{ ...display, fontSize: 52, lineHeight: 1, color: track.color }}>
              {formatCacheRankPct(track.effect)}
            </div>
            <div className="mt-1" style={{ ...label, color: BONE_FAINT }}>
              Now · every rank adds {formatCacheRankPct(track.perRank)}
            </div>
            <div className="mt-4">
              <Pips filled={track.ranks} total={track.maxRanks} color={track.color} size={11} />
            </div>
            <div className="mt-3 text-center text-[12px] leading-relaxed" style={{ color: BONE_MUTED }}>
              {track.maxed
                ? `Rank ${track.maxRanks} of ${track.maxRanks} — the piece is complete.`
                : `Rank ${track.ranks} of ${track.maxRanks} — rank ${track.ranks + 1} reads ${formatCacheRankPct(
                    track.effect + track.perRank,
                  )}.`}
            </div>
            <div className="mt-2 text-[12px]" style={{ color: BONE_FAINT }}>
              {tokens} {tokens === 1 ? 'token' : 'tokens'} in hand
            </div>
            <div className="mt-4 w-full">
              <SpendControl track={track} tokens={tokens} busy={busyTrack === track.id} onSpend={onSpend} />
            </div>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

/* ─── The page ───────────────────────────────────────────────────── */

export const CacheRankGalleryPage: React.FC<{
  state: CacheRankStateView;
  busyTrack: string | null;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ state, busyTrack, onSpend }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const openTrack = state.tracks.find((t) => t.id === openId) ?? null;
  const totals = state.tracks
    .map((t) => `${formatCacheRankPct(t.perRank * t.maxRanks)} ${SHORT_TOTALS[t.id] ?? t.name}`)
    .join(' · ');
  return (
    <div style={{ backgroundColor: WALL }}>
      <Hero state={state} />

      <SectionHeading>The Milestone Wall</SectionHeading>
      <div>
        {state.milestones.map((milestone, i) => (
          <MilestonePiece key={milestone.level} milestone={milestone} state={state} index={i} />
        ))}
      </div>

      <SectionHeading>The Medals</SectionHeading>
      <div>
        {state.tracks.map((track) => (
          <MedalPiece
            key={track.id}
            track={track}
            tokens={state.tokens}
            busy={busyTrack === track.id}
            onSpend={onSpend}
            onOpen={(t) => setOpenId(t.id)}
          />
        ))}
      </div>

      <footer className="px-4 pb-12 pt-2">
        <p className="text-center text-[12px] leading-relaxed" style={{ color: BONE_FAINT }}>
          The full collection — {totals}. Bonuses apply last, over everything else you earn.
        </p>
      </footer>

      <DetailSheet
        track={openTrack}
        tokens={state.tokens}
        busyTrack={busyTrack}
        onSpend={onSpend}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
};
