/**
 * CacheRankInstrumentPage — PROTOTYPE (design/hunter-subpages-rank-b,
 * 2026-11-05). NOT shipped UI.
 *
 * Cache Rank reimagined as an INSTRUMENT PANEL: the rank is a
 * machine being measured. A console head carries the token balance
 * as a bank of LCD readouts; the road to the next token is a
 * tick-arc charge gauge with a needle and a digital readout; the
 * milestone bundles are markers on a level tape (grants are
 * automatic — the tape shows banked vs next, there is no claim
 * control anywhere in this system); the seven bonus tracks are
 * console channels — LED bar meters, measured outputs, calibration
 * detail on tap, and a physical spend push-button per channel.
 *
 * Consumes the real CacheRankStateView (src/content/cacheRank.ts);
 * the demo harness derives the fixture through cacheRankStateView
 * and applies spends through the same cost curve the view prints.
 * The fixture facts are identical to variant A's ("The Climb").
 */
import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  cacheRankCostForRank,
  cacheRankTrackCost,
  formatCacheRankPct,
  type CacheRankStateView,
  type CacheRankTrackView,
} from '@/content/cacheRank';
import {
  AMBER_GLOW,
  FAINT,
  GOLD,
  headStyle,
  INK,
  LcdWell,
  Led,
  LedMeter,
  monoStyle,
  MUT,
  Panel,
  PanelLabel,
  PushButton,
  STEEL,
  STEEL_DARK,
  TickGauge,
} from './instrumentKit';

/* ─── Console head: the standing readouts ─────────────────────── */

const ConsoleHead: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const spent = state.tokensEarned - state.tokens;
  return (
    <Panel>
      <div className="flex items-start gap-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center"
          style={{
            border: `1px solid ${STEEL_DARK}`,
            backgroundColor: 'rgba(6,5,4,0.85)',
            boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.85)',
            color: GOLD,
          }}
        >
          <PxIcon name="chevs" size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="uppercase leading-none" style={{ ...headStyle, fontSize: 24, color: INK }}>
            Cache Rank
          </div>
          <div className="mt-1.5 text-[11px] font-semibold leading-snug" style={{ color: MUT }}>
            Permanent bonuses, paid in tokens. Tokens come from levels only — there is no respec.
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          <Led lit color={GOLD} size={8} />
          <span
            className="text-[11px] font-bold uppercase leading-none"
            style={{ ...monoStyle, color: FAINT, letterSpacing: '0.1em' }}
          >
            Grants
            <br />
            auto
          </span>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <LcdWell value={String(state.tokens)} label="Tokens" color={GOLD} valueSize={24} />
        <LcdWell value={String(state.level)} label="Level" valueSize={24} />
        <LcdWell value={String(state.tokensEarned)} label="Earned" valueSize={24} />
        <LcdWell value={String(spent)} label="Spent" valueSize={24} />
      </div>
    </Panel>
  );
};

/* ─── Charge gauge: the road to the next token ────────────────── */

const ChargeGauge: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const pct =
    state.xpForLevel > 0 ? Math.min(100, Math.round((state.xpIntoLevel / state.xpForLevel) * 100)) : 100;
  const remaining = Math.max(0, state.xpForLevel - state.xpIntoLevel);
  return (
    <Panel>
      <PanelLabel
        label="Next token — charge meter"
        right={state.nextTokenLevel ? `LV ${state.level} → ${state.nextTokenLevel}` : 'LEVEL CAP'}
        rightColor={INK}
      />
      <TickGauge pct={pct} />
      <div className="mt-1 grid grid-cols-3 gap-1.5">
        <LcdWell value={state.xpIntoLevel.toLocaleString()} label="XP in" valueSize={15} />
        <LcdWell value={state.xpForLevel.toLocaleString()} label="XP span" valueSize={15} />
        <LcdWell value={`${pct}%`} label="Charge" color={GOLD} valueSize={15} />
      </div>
      <div className="mt-2.5 text-[11px] font-bold" style={{ ...monoStyle, color: MUT }}>
        {state.nextTokenLevel
          ? `NEXT TOKEN AT LEVEL ${state.nextTokenLevel} · ${remaining.toLocaleString()} XP REMAINING`
          : 'EVERY TOKEN EARNED — THE METER RESTS AT FULL'}
      </div>
    </Panel>
  );
};

/* ─── Milestone tape: bundles as markers on a level ruler ─────── */

const MilestoneTape: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const nextIdx = state.milestones.findIndex((m) => !m.claimed);
  const banked = state.milestones.filter((m) => m.claimed);
  const bankedTokens = banked.reduce((sum, m) => sum + m.bundle, 0);
  const next = nextIdx >= 0 ? state.milestones[nextIdx] : null;
  return (
    <Panel>
      <PanelLabel label="Milestone markers" right="PAID ON LEVEL — NO CLAIM" />
      <div className="relative mx-[15px]" style={{ height: 96 }}>
        {/* YOU tag */}
        <div
          className="absolute z-10 -translate-x-1/2 px-1.5 py-0.5"
          style={{
            left: `${state.level}%`,
            top: 0,
            backgroundColor: 'rgba(6,5,4,0.9)',
            border: `1px solid ${STEEL_DARK}`,
          }}
        >
          <span className="whitespace-nowrap text-[11px] font-black" style={{ ...monoStyle, color: GOLD }}>
            YOU · LV {state.level}
          </span>
        </div>
        {/* tape */}
        <div
          aria-hidden="true"
          className="absolute"
          style={{
            left: 0,
            right: 0,
            top: 32,
            height: 7,
            backgroundColor: '#241C12',
            border: '1px solid rgba(0,0,0,0.8)',
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(245,239,230,0.16) 0px, rgba(245,239,230,0.16) 1px, transparent 1px, transparent 10px)',
          }}
        />
        {/* consumed tape up to the player's level */}
        <div
          aria-hidden="true"
          className="absolute"
          style={{ left: 0, top: 32, height: 7, width: `${state.level}%`, backgroundColor: `${GOLD}D9` }}
        />
        {/* YOU diamond on the tape */}
        <span
          aria-hidden="true"
          className="absolute"
          style={{
            left: `${state.level}%`,
            top: 31,
            width: 9,
            height: 9,
            transform: 'translateX(-50%) rotate(45deg)',
            backgroundColor: AMBER_GLOW,
            border: '1px solid #000',
            boxShadow: `0 0 6px ${AMBER_GLOW}88`,
          }}
        />
        {/* markers */}
        {state.milestones.map((m, i) => {
          const isNext = i === nextIdx;
          return (
            <div
              key={m.level}
              className="absolute flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${m.level}%`, top: 28, width: 58 }}
            >
              <span
                aria-hidden="true"
                style={{ width: 2, height: 15, backgroundColor: m.claimed ? GOLD : STEEL }}
              />
              <span
                aria-hidden="true"
                style={{
                  marginTop: 2,
                  width: 10,
                  height: 10,
                  backgroundColor: m.claimed ? GOLD : 'transparent',
                  border: `2px solid ${m.claimed ? GOLD : isNext ? AMBER_GLOW : STEEL}`,
                  boxShadow: m.claimed ? `0 0 6px ${GOLD}77` : isNext ? `0 0 6px ${AMBER_GLOW}66` : undefined,
                }}
              />
              <span
                className="mt-1.5 text-[11px] font-black leading-none"
                style={{ ...monoStyle, color: m.claimed ? INK : isNext ? INK : FAINT }}
              >
                LV {m.level}
              </span>
              <span
                className="mt-0.5 text-[11px] font-bold leading-none"
                style={{ ...monoStyle, color: m.claimed ? GOLD : FAINT }}
              >
                +{m.bundle} TOK
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold" style={{ ...monoStyle, color: MUT }}>
          {next
            ? `NEXT: LV ${next.level} · +${next.bundle} TOKENS · ${next.level - state.level} LV OUT`
            : 'ALL MARKERS BANKED'}
        </span>
        <span className="shrink-0 text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
          BANKED {banked.length}/5 · +{bankedTokens}
        </span>
      </div>
    </Panel>
  );
};

/* ─── One console channel per bonus track ─────────────────────── */

const ChannelStrip: React.FC<{
  track: CacheRankTrackView;
  index: number;
  tokens: number;
  busy: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ track, index, tokens, busy, expanded, onToggle, onSpend }) => {
  const affordable = track.nextCost !== null && tokens >= track.nextCost;
  const spentOnTrack = cacheRankTrackCost(track.ranks);
  const trackTotal = cacheRankTrackCost(track.maxRanks);
  return (
    <Panel testId={`rank-channel-${track.id}`}>
      <button
        type="button"
        onClick={() => onToggle(track.id)}
        aria-expanded={expanded}
        className="flex min-h-[44px] w-full items-center gap-2.5 text-left"
      >
        <span
          className="shrink-0 text-[11px] font-black"
          style={{ ...monoStyle, color: FAINT, letterSpacing: '0.08em' }}
        >
          CH {String(index + 1).padStart(2, '0')}
        </span>
        <span
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center"
          style={{
            border: `1px solid ${STEEL_DARK}`,
            backgroundColor: 'rgba(6,5,4,0.85)',
            boxShadow: 'inset 0 2px 5px rgba(0,0,0,0.85)',
            color: track.color,
          }}
        >
          <PxIcon name={track.icon} size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate uppercase leading-tight" style={{ ...headStyle, fontSize: 15, color: INK }}>
            {track.name}
          </span>
          <span className="mt-0.5 block text-[11px] font-bold leading-none" style={{ ...monoStyle, color: FAINT }}>
            RANK {track.ranks}/{track.maxRanks} · {formatCacheRankPct(track.perRank)} PER RANK
          </span>
        </span>
        <span className="shrink-0 font-bold leading-none" style={{ ...monoStyle, fontSize: 17, color: track.color }}>
          {track.effect > 0 ? formatCacheRankPct(track.effect) : '+0%'}
        </span>
        <span
          className="shrink-0"
          style={{ color: FAINT, transform: expanded ? 'rotate(180deg)' : undefined, transition: 'transform 150ms' }}
        >
          <PxIcon name="chevD" size={14} />
        </span>
      </button>

      <div className="mt-2.5">
        <LedMeter filled={track.ranks} total={track.maxRanks} color={track.color} />
      </div>

      <div className="mt-2 text-[11px] leading-snug" style={{ color: MUT }}>
        {track.summary}
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
          SPENT {spentOnTrack} TOK
        </span>
        <span className="text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
          {track.maxed ? 'CHANNEL AT CAP' : `NEXT RANK ${track.nextCost} TOK`}
        </span>
      </div>

      {expanded && (
        <div className="mt-3 pt-2.5" style={{ borderTop: `1px solid ${STEEL_DARK}` }} data-testid="rank-channel-detail">
          <div
            className="text-[11px] font-black uppercase"
            style={{ ...monoStyle, color: FAINT, letterSpacing: '0.12em' }}
          >
            Calibration — token cost per rank
          </div>
          <div className="mt-1.5 grid grid-cols-10 gap-1">
            {Array.from({ length: track.maxRanks }, (_, i) => {
              const bought = i < track.ranks;
              const isNext = i === track.ranks && !track.maxed;
              return (
                <span
                  key={i}
                  className="flex h-[30px] items-center justify-center text-[11px] font-bold"
                  style={{
                    ...monoStyle,
                    color: bought ? INK : isNext ? GOLD : FAINT,
                    backgroundColor: bought ? `${track.color}40` : 'rgba(6,5,4,0.6)',
                    border: `1px solid ${isNext ? GOLD : 'rgba(0,0,0,0.7)'}`,
                  }}
                >
                  {cacheRankCostForRank(i)}
                </span>
              );
            })}
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
              TO MAX {trackTotal - spentOnTrack} TOK
            </span>
            <span className="text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
              MAX OUTPUT {formatCacheRankPct(track.perRank * track.maxRanks)}
            </span>
          </div>
        </div>
      )}

      <div className="mt-3">
        {track.maxed ? (
          <div
            className="flex min-h-[44px] items-center gap-2 px-3"
            style={{
              border: `1px solid ${STEEL_DARK}`,
              background: 'linear-gradient(180deg, #050403 0%, #0A0806 100%)',
              boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.85)',
            }}
          >
            <Led lit color={track.color} size={8} />
            <span className="flex-1 text-[11px] font-black uppercase" style={{ ...monoStyle, color: INK, letterSpacing: '0.1em' }}>
              Maxed — output at rating
            </span>
            <span className="text-[11px] font-bold" style={{ ...monoStyle, color: FAINT }}>
              {trackTotal} TOK IN
            </span>
          </div>
        ) : (
          <PushButton
            armed={affordable}
            disabled={!affordable || busy}
            onClick={() => onSpend(track)}
            testId={`rank-spend-${track.id}`}
          >
            {busy
              ? 'Spending…'
              : affordable
                ? `Spend ${track.nextCost} tokens`
                : `Need ${(track.nextCost ?? 0) - tokens} more tokens`}
          </PushButton>
        )}
      </div>
    </Panel>
  );
};

/* ─── Combined output bank ────────────────────────────────────── */

const OutputBank: React.FC<{ state: CacheRankStateView }> = ({ state }) => (
  <Panel>
    <PanelLabel label="Combined output" right="ALL CHANNELS" />
    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
      {state.tracks.map((track) => (
        <div key={track.id} className="flex items-center gap-1.5">
          <span style={{ color: track.color }}>
            <PxIcon name={track.icon} size={13} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] font-bold uppercase" style={{ ...monoStyle, color: MUT }}>
            {track.name}
          </span>
          <span className="shrink-0 text-[11px] font-bold" style={{ ...monoStyle, color: INK }}>
            {track.effect > 0 ? formatCacheRankPct(track.effect) : '+0%'}
          </span>
        </div>
      ))}
    </div>
    <div className="mt-3 pt-2.5 text-[11px] leading-snug" style={{ borderTop: `1px solid ${STEEL_DARK}`, color: FAINT }}>
      Rated max output — +10% credits, +10% XP, +10% scrap, +5% damage, +10% max HP, +20% cache quality, +5%
      market proceeds. Bonuses are tiny and broad by design, earned across a whole career of levels.
    </div>
  </Panel>
);

/* ─── Page ────────────────────────────────────────────────────── */

export const CacheRankInstrumentPage: React.FC<{
  state: CacheRankStateView;
  busyTrack: string | null;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ state, busyTrack, onSpend }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ConsoleHead state={state} />
      <ChargeGauge state={state} />
      <MilestoneTape state={state} />
      <div className="px-0.5 pt-1">
        <PanelLabel label="Bonus channels" right="7 TRACKS · 30 TOK TO MAX ONE" />
      </div>
      {state.tracks.map((track, i) => (
        <ChannelStrip
          key={track.id}
          track={track}
          index={i}
          tokens={state.tokens}
          busy={busyTrack === track.id}
          expanded={expandedId === track.id}
          onToggle={(id) => setExpandedId((prev) => (prev === id ? null : id))}
          onSpend={onSpend}
        />
      ))}
      <OutputBank state={state} />
    </div>
  );
};
