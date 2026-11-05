/**
 * CacheRankQuietPage — PROTOTYPE (design/hunter-subpages-rank-e,
 * 2026-11-05). NOT shipped UI.
 *
 * Variant E — "Quiet plates". Cache Rank at rest: the same record
 * variant A built as a rank board ("The Climb" — plates, medallions,
 * a staircase, segment ladders, stamps) is here typeset as an open
 * ledger page. No shells, no bolts, no clip-paths, no foot strips,
 * no stamps: type is the hero and space does the work. The token
 * balance is one oversized numeral; progress is a single hairline,
 * never a ladder; each track is an unboxed row whose only color is
 * its effect figure; milestones are five numerals resting on one
 * baseline rule. Separation is air and 1px rules, nothing else.
 *
 * Consumes the real CacheRankStateView (src/content/cacheRank.ts);
 * the demo harness derives the fixture through cacheRankStateView
 * and applies spends through the same cost curve the view prints.
 * There is no manual tier claim in this system — milestone grants
 * are automatic server-side — and the page says so, quietly.
 */
import React from 'react';
import {
  formatCacheRankPct,
  type CacheRankStateView,
  type CacheRankTrackView,
} from '@/content/cacheRank';

const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
/** Secondary ink at body sizes (clears 4.5:1 on the page ground). */
const BONE_SOFT = '#B3A488';
/** Faint ink — display numerals and short state words only. */
const BONE_FAINT = '#9A8B72';
const RANK_GOLD = '#F2C063';
const HAIRLINE = 'rgba(245,239,230,0.09)';

const display: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.04em',
  fontWeight: 400,
};

/* ─── Standing ─────────────────────────────────────────────────────── */

const Standing: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const pct =
    state.xpForLevel > 0 ? Math.min(100, Math.round((state.xpIntoLevel / state.xpForLevel) * 100)) : 100;
  return (
    <div>
      <h1 className="leading-none" style={{ ...display, fontSize: 48, color: BONE }}>
        Cache Rank
      </h1>
      <p className="mt-3 text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
        Permanent bonuses, paid in tokens. Tokens come from levels only — there is no respec.
      </p>

      <div className="mt-12 flex items-baseline gap-4">
        <span className="leading-none" style={{ ...display, fontSize: 118, color: BONE }}>
          {state.tokens}
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
          {state.tokens === 1 ? 'Token held' : 'Tokens held'}
        </span>
      </div>

      <div className="mt-4 text-[13px]" style={{ color: BONE_MUTED }}>
        Level {state.level}
        <span style={{ color: BONE_FAINT }}> · {state.tokensEarned} tokens earned all-time</span>
      </div>

      <div className="mt-10">
        <div className="h-[2px] w-full" style={{ backgroundColor: HAIRLINE }}>
          <div className="h-full" style={{ width: `${pct}%`, backgroundColor: BONE }} />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <span className="text-[12px]" style={{ color: BONE_SOFT }}>
            {state.nextTokenLevel ? `Next token at Level ${state.nextTokenLevel}` : 'Level cap — every token earned'}
          </span>
          <span className="text-[12px]" style={{ color: BONE_MUTED }}>
            {state.xpIntoLevel.toLocaleString()} / {state.xpForLevel.toLocaleString()} XP · {pct}%
          </span>
        </div>
      </div>
    </div>
  );
};

/* ─── Milestones ───────────────────────────────────────────────────── */

const Milestones: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const nextIdx = state.milestones.findIndex((m) => !m.claimed);
  return (
    <div className="mt-16">
      <h2 className="leading-none" style={{ ...display, fontSize: 24, color: BONE }}>
        Milestones
      </h2>
      <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_FAINT }}>
        A bundle lands on its own when the level does — nothing to claim.
      </p>
      <div
        className="mt-7 flex pb-4"
        style={{ borderBottom: `1px solid ${HAIRLINE}` }}
      >
        {state.milestones.map((m, i) => {
          const isNext = i === nextIdx;
          return (
            <div key={m.level} className="flex-1 text-center">
              <div
                className="leading-none"
                style={{
                  ...display,
                  fontSize: 32,
                  color: m.claimed ? BONE : isNext ? RANK_GOLD : BONE_FAINT,
                }}
              >
                {m.level}
              </div>
              <div
                className="mt-2 text-[12px] font-bold"
                style={{ color: m.claimed ? BONE_MUTED : isNext ? RANK_GOLD : BONE_FAINT }}
              >
                +{m.bundle}
              </div>
            </div>
          );
        })}
      </div>
      {nextIdx >= 0 && (
        <p className="mt-4 text-[12px]" style={{ color: BONE_SOFT }}>
          Next landing — Level {state.milestones[nextIdx].level} pays +{state.milestones[nextIdx].bundle} tokens,{' '}
          {state.milestones[nextIdx].level - state.level} levels to climb.
        </p>
      )}
    </div>
  );
};

/* ─── Tracks ───────────────────────────────────────────────────────── */

const TrackRow: React.FC<{
  track: CacheRankTrackView;
  tokens: number;
  busy: boolean;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ track, tokens, busy, onSpend }) => {
  const affordable = track.nextCost !== null && tokens >= track.nextCost;
  return (
    <div className="py-8" style={{ borderTop: `1px solid ${HAIRLINE}` }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="leading-none" style={{ ...display, fontSize: 27, color: BONE }}>
          {track.name}
        </span>
        <span className="leading-none" style={{ ...display, fontSize: 32, color: track.color }}>
          {track.effect > 0 ? formatCacheRankPct(track.effect) : '—'}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
        {track.summary}
      </p>
      <div className="mt-5 flex min-h-[44px] items-center justify-between gap-3">
        <span className="text-[12px]" style={{ color: BONE_MUTED }}>
          Rank {track.ranks} of {track.maxRanks}
          <span style={{ color: BONE_FAINT }}> · {formatCacheRankPct(track.perRank)} per rank</span>
        </span>
        {track.maxed ? (
          <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
            Maxed
          </span>
        ) : affordable ? (
          <button
            type="button"
            data-testid={`rank-spend-${track.id}`}
            onClick={() => onSpend(track)}
            disabled={busy}
            className="min-h-[44px] px-5 text-[13px] font-bold uppercase tracking-[0.14em] transition-opacity active:opacity-60"
            style={{ border: `1px solid ${BONE_MUTED}`, color: BONE, backgroundColor: 'transparent' }}
          >
            {busy ? '…' : `Spend ${track.nextCost}`}
          </button>
        ) : (
          <span className="text-[12px]" style={{ color: BONE_FAINT }}>
            Need {(track.nextCost ?? 0) - tokens} more
          </span>
        )}
      </div>
      <div className="mt-4 h-[2px] w-full" style={{ backgroundColor: HAIRLINE }}>
        <div
          className="h-full"
          style={{ width: `${(track.ranks / track.maxRanks) * 100}%`, backgroundColor: track.color }}
        />
      </div>
    </div>
  );
};

/* ─── Page ─────────────────────────────────────────────────────────── */

export const CacheRankQuietPage: React.FC<{
  state: CacheRankStateView;
  busyTrack: string | null;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ state, busyTrack, onSpend }) => (
  <div className="px-2 pt-4">
    <Standing state={state} />
    <Milestones state={state} />
    <div className="mt-16">
      <h2 className="leading-none" style={{ ...display, fontSize: 24, color: BONE }}>
        Bonuses
      </h2>
      <p className="mt-2 text-[12px]" style={{ color: BONE_FAINT }}>
        Seven tracks · ten ranks each · maxing one costs 30 tokens
      </p>
      <div className="mt-3">
        {state.tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            tokens={state.tokens}
            busy={busyTrack === track.id}
            onSpend={onSpend}
          />
        ))}
      </div>
    </div>
    <p className="pb-10 pt-4 text-[12px] leading-relaxed" style={{ color: BONE_FAINT }}>
      Bonuses are tiny and broad by design — a maxed rack is worth +10% credits, +10% XP, +10% scrap, +5% damage,
      +10% max HP, +20% cache quality, +5% market proceeds, earned across a whole career of levels.
    </p>
  </div>
);
