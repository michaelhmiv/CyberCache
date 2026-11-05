/**
 * CacheRankPlatePage — PROTOTYPE (design/hunter-subpages-rank-research,
 * 2026-11-05). NOT shipped UI.
 *
 * Cache Rank reimagined inside the Arena Plates family as a RANK
 * BOARD: the climb is the composition. A standing plate carries the
 * token gauge and the road to the next token; the milestone bundles
 * render as an ascending staircase of steps (claimed steps struck
 * in gold); the seven bonus tracks are a MEDAL RACK — medallion,
 * effect gauge, full-width segment ladder, spend stamp — so the
 * page reads as ascent + medals, not as another settings list.
 *
 * Consumes the real CacheRankStateView (src/content/cacheRank.ts);
 * the demo harness derives the fixture through cacheRankStateView
 * and applies spends through the same cost curve the view prints.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  formatCacheRankPct,
  type CacheRankStateView,
  type CacheRankTrackView,
} from '@/content/cacheRank';
import {
  AMBER,
  BONE,
  BONE_FAINT,
  BONE_MUTED,
  GaugeWell,
  Plate,
  plateTitleStyle,
  RANK_GOLD,
  SegmentLadder,
  Stamp,
  STEEL,
} from './plateKit';

const STEP_HEIGHTS = [30, 42, 54, 66, 78];

const StandingPlate: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const pct =
    state.xpForLevel > 0 ? Math.min(100, Math.round((state.xpIntoLevel / state.xpForLevel) * 100)) : 100;
  const filledSegs = Math.round(pct / 10);
  return (
    <Plate footColor={RANK_GOLD}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[30px] uppercase leading-none" style={{ ...plateTitleStyle, color: BONE }}>
            Cache Rank
          </div>
          <div className="mt-1.5 text-[11px] font-semibold leading-snug" style={{ color: BONE_FAINT }}>
            Permanent bonuses, paid in tokens. Tokens come from levels only — there is no respec.
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>
              Level {state.level}
            </span>
            <span className="text-[11px] font-bold" style={{ color: BONE_FAINT }}>
              {state.tokensEarned} tokens earned all-time
            </span>
          </div>
        </div>
        <GaugeWell value={String(state.tokens)} label={state.tokens === 1 ? 'Token' : 'Tokens'} color={RANK_GOLD} valueSize={34} />
      </div>
      <div className="mt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[11px] font-black uppercase tracking-wide" style={{ color: BONE_MUTED }}>
            {state.nextTokenLevel ? `Next token — Level ${state.nextTokenLevel}` : 'Level cap — every token earned'}
          </span>
          <span className="text-[11px] font-black" style={{ color: BONE }}>
            {state.xpIntoLevel.toLocaleString()} / {state.xpForLevel.toLocaleString()} XP · {pct}%
          </span>
        </div>
        <div className="mt-1.5">
          <SegmentLadder filled={filledSegs} total={10} color={BONE} height={10} />
        </div>
      </div>
    </Plate>
  );
};

/** The milestone staircase: five steps, ascending; claimed struck gold. */
const MilestoneClimb: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const nextIdx = state.milestones.findIndex((m) => !m.claimed);
  return (
    <Plate footColor={STEEL}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>
          The Milestone Climb
        </div>
        <div className="text-[11px] font-bold" style={{ color: BONE_FAINT }}>
          Bundle at every landing
        </div>
      </div>
      <div className="mt-3 flex items-end gap-1.5">
        {state.milestones.map((m, i) => {
          const isNext = i === nextIdx;
          return (
            <div key={m.level} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className="flex w-full flex-col items-center justify-end pb-1.5"
                style={{
                  height: STEP_HEIGHTS[i],
                  border: `2px solid ${m.claimed ? '#000' : isNext ? BONE : STEEL}`,
                  background: m.claimed
                    ? 'linear-gradient(180deg, #F2C063 0%, #C79A3F 100%)'
                    : 'rgba(6,5,4,0.7)',
                  boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.18)',
                }}
              >
                <span
                  className="text-[15px] font-black leading-none"
                  style={{ color: m.claimed ? '#1A1206' : isNext ? BONE : BONE_FAINT }}
                >
                  +{m.bundle}
                </span>
              </div>
              <div
                className="flex items-center gap-1 text-[11px] font-black uppercase leading-none"
                style={{ color: m.claimed ? RANK_GOLD : isNext ? BONE : BONE_FAINT }}
              >
                {m.claimed && <PxIcon name="check" size={11} />}
                Lv {m.level}
              </div>
            </div>
          );
        })}
      </div>
      {nextIdx >= 0 && (
        <div className="mt-2.5 text-[11px] font-semibold" style={{ color: BONE_FAINT }}>
          Next landing: Level {state.milestones[nextIdx].level} pays +{state.milestones[nextIdx].bundle} tokens —{' '}
          {state.milestones[nextIdx].level - state.level} levels to climb.
        </div>
      )}
    </Plate>
  );
};

const TrackMedal: React.FC<{
  track: CacheRankTrackView;
  tokens: number;
  busy: boolean;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ track, tokens, busy, onSpend }) => {
  const affordable = track.nextCost !== null && tokens >= track.nextCost;
  return (
    <Plate footColor={track.color} footHeight={3}>
      <div className="flex items-start gap-3">
        {/* Medallion */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div
            className="flex h-14 w-14 items-center justify-center"
            style={{
              border: '2px solid #000',
              backgroundColor: 'rgba(6,5,4,0.85)',
              boxShadow: `inset 0 0 0 2px ${track.color}55, inset 0 2px 6px rgba(0,0,0,0.85)`,
              color: track.color,
            }}
          >
            <PxIcon name={track.icon} size={26} />
          </div>
          <div className="text-[11px] font-black uppercase leading-none" style={{ color: BONE_FAINT }}>
            Rank {track.ranks}/{track.maxRanks}
          </div>
        </div>
        {/* Identity + effect */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[19px] uppercase leading-none" style={{ ...plateTitleStyle, color: BONE }}>
              {track.name}
            </span>
            <span className="text-[17px] font-black leading-none" style={{ color: track.color }}>
              {track.effect > 0 ? formatCacheRankPct(track.effect) : '—'}
            </span>
          </div>
          <div className="mt-1 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
            {track.summary}
          </div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_MUTED }}>
            {formatCacheRankPct(track.perRank)} per rank
          </div>
        </div>
        {/* Spend control */}
        <div className="flex shrink-0 flex-col items-end justify-start">
          {track.maxed ? (
            <Stamp color={BONE}>
              <PxIcon name="check" size={12} /> Maxed
            </Stamp>
          ) : (
            <button
              type="button"
              data-testid={`rank-spend-${track.id}`}
              onClick={() => onSpend(track)}
              disabled={!affordable || busy}
              className="flex min-h-[44px] flex-col items-center justify-center px-3 transition-transform active:scale-95 disabled:opacity-100"
              style={
                affordable
                  ? {
                      backgroundColor: AMBER,
                      color: '#000',
                      border: '2px solid #000',
                      boxShadow: '3px 3px 0 rgba(0,0,0,0.7)',
                    }
                  : {
                      backgroundColor: 'rgba(6,5,4,0.7)',
                      color: BONE_FAINT,
                      border: `2px solid ${STEEL}`,
                    }
              }
            >
              <span className="flex items-center gap-1 text-[13px] font-black uppercase leading-none">
                <PxIcon name="hex" size={13} />
                {busy ? '…' : track.nextCost}
              </span>
              <span className="mt-1 text-[11px] font-black uppercase leading-none">
                {affordable ? 'Spend' : `Need ${(track.nextCost ?? 0) - tokens} more`}
              </span>
            </button>
          )}
        </div>
      </div>
      <div className="mt-3">
        <SegmentLadder filled={track.ranks} total={track.maxRanks} color={track.color} height={10} />
      </div>
    </Plate>
  );
};

export const CacheRankPlatePage: React.FC<{
  state: CacheRankStateView;
  busyTrack: string | null;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ state, busyTrack, onSpend }) => (
  <div className="space-y-3">
    <StandingPlate state={state} />
    <MilestoneClimb state={state} />
    <div className="px-0.5 pt-1">
      <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE }}>
        The Medal Rack
      </div>
      <div className="mt-0.5 text-[11px] font-bold" style={{ color: BONE_FAINT }}>
        Seven tracks · ten ranks each · maxing one costs 30 tokens
      </div>
    </div>
    {state.tracks.map((track) => (
      <TrackMedal
        key={track.id}
        track={track}
        tokens={state.tokens}
        busy={busyTrack === track.id}
        onSpend={onSpend}
      />
    ))}
    <div className="px-1 pb-1 pt-1 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
      Bonuses are tiny and broad by design — a maxed rack is worth +10% credits, +10% XP, +10% scrap, +5% damage,
      +10% max HP, +20% cache quality, +5% market proceeds, earned across a whole career of levels.
    </div>
  </div>
);
