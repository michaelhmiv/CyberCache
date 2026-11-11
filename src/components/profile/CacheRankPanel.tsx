import React, { useCallback, useEffect, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import {
  getCacheRankState,
  newCacheRankNonce,
  spendCacheRankBonus,
} from '@/lib/chef/chefClient';
import {
  cacheRankCostForRank,
  cacheRankTrackCost,
  formatCacheRankPct,
  type CacheRankBonusId,
  type CacheRankStateView,
  type CacheRankTrackView,
} from '@/content/cacheRank';
import { usePlayerStore } from '@/store';
import {
  AMBER_GLOW,
  FAINT,
  GOLD,
  headStyle,
  INK,
  monoStyle,
  MUT,
  STEEL,
  STEEL_DARK,
} from './cacheRankConsoleTokens';
import {
  LcdWell,
  Led,
  LedMeter,
  Panel,
  PanelLabel,
  PushButton,
  TickGauge,
} from './cacheRankConsoleKit';

/**
 * Cache Rank panel (Profile → Hunter Cache Rank door) — the
 * Badass-rank analogue (0031), wearing the console register
 * (Instrument Panel — owner pick B for this page, 2026-11-05).
 *
 * Tokens come from LEVELS only (1 per level + milestone bundles at
 * 10/25/50/75/100), granted server-side from the server's own level
 * record; this panel only renders the Chef's state view and sends
 * spend intent (a nonce + a bonus id). The balance, ranks, and
 * effects it shows are the server's — after a spend it re-renders
 * from the spend response's state and syncs the player store from
 * the same server values. Renders nothing until the Chef answers,
 * so an unreachable Chef simply omits the panel.
 *
 * The console presentation: a head bank of LCD readouts (tokens /
 * level / earned / spent), a tick-arc charge gauge for the road to
 * the next token, the milestone bundles as markers on a level tape
 * (grants are automatic — there is no claim control anywhere in
 * this system, and the tape says so), the seven bonus tracks as
 * metered console channels with a calibration readout of the full
 * cost curve, and a combined-output bank. Every figure derives
 * from the Chef state view or the content cost functions — the
 * panel computes no gameplay outcome.
 *
 * `readOnly` renders the same Chef state without the spend
 * controls — the guest preview (audit GUEST-01), where the panel
 * is a look at progress the guest already owns, not a spend
 * surface (spending stays on the Hunter profile door).
 */

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
          <PxIcon name="chevs" size={26} />
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
        {/* YOU tag — clamped inside the tape at the level extremes so
            the tag never rides over the bezel at LV 1 / LV 100. */}
        <div
          className="absolute z-10 -translate-x-1/2 px-1.5 py-0.5"
          style={{
            left: `clamp(48px, ${state.level}%, calc(100% - 48px))`,
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
  readOnly: boolean;
  busy: boolean;
  anyBusy: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
  onSpend: (track: CacheRankTrackView) => void;
}> = ({ track, index, tokens, readOnly, busy, anyBusy, expanded, onToggle, onSpend }) => {
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
          <PxIcon name={track.icon} size={17} color={track.color} />
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
          <PxIcon name="chevD" size={13} />
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

      {!readOnly && (
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
              disabled={!affordable || anyBusy}
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
      )}
    </Panel>
  );
};

/* ─── Combined output bank ────────────────────────────────────── */

/** Stat names for the rated-max law line, keyed by track id. */
const RATED_MAX_LABELS: Record<CacheRankBonusId, string> = {
  credits: 'credits',
  xp: 'XP',
  scrap: 'scrap',
  damage: 'damage',
  maxHp: 'max HP',
  cacheQuality: 'cache quality',
  marketProceeds: 'market proceeds',
};

const OutputBank: React.FC<{ state: CacheRankStateView }> = ({ state }) => {
  const ratedMax = state.tracks
    .map((track) => `${formatCacheRankPct(track.perRank * track.maxRanks)} ${RATED_MAX_LABELS[track.id]}`)
    .join(', ');
  return (
    <Panel>
      <PanelLabel label="Combined output" right="ALL CHANNELS" />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        {state.tracks.map((track) => (
          <div key={track.id} className="flex items-center gap-1.5">
            <span style={{ color: track.color }}>
              <PxIcon name={track.icon} size={13} color={track.color} />
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
        Rated max output — {ratedMax}. Bonuses are tiny and broad by design, earned across a whole career of
        levels.
      </div>
    </Panel>
  );
};

/* ─── Panel ───────────────────────────────────────────────────── */

export const CacheRankPanel: React.FC<{ readOnly?: boolean }> = ({ readOnly = false }) => {
  const [state, setState] = useState<CacheRankStateView | null>(null);
  const [busyTrack, setBusyTrack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const applyState = useCallback((next: CacheRankStateView) => {
    setState(next);
    const spends: Record<string, number> = {};
    for (const track of next.tracks) spends[track.id] = track.ranks;
    usePlayerStore.getState().syncFromServer({
      cacheRankTokens: next.tokens,
      cacheRankSpends: spends,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getCacheRankState()
      .then((result) => {
        if (!cancelled) applyState(result.cacheRank);
      })
      .catch(() => {
        // Chef unreachable: the panel stays hidden (Profile renders
        // the rest from its own services).
      });
    return () => {
      cancelled = true;
    };
  }, [applyState]);

  const spend = useCallback(
    async (track: CacheRankTrackView) => {
      if (busyTrack || track.maxed || track.nextCost === null || !state || state.tokens < track.nextCost) {
        return;
      }
      setBusyTrack(track.id);
      setError(null);
      try {
        const result = await spendCacheRankBonus({ nonce: newCacheRankNonce(), bonusId: track.id });
        if (result.cacheRank) {
          applyState(result.cacheRank);
        } else {
          const fresh = await getCacheRankState();
          applyState(fresh.cacheRank);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Spend failed');
      } finally {
        setBusyTrack(null);
      }
    },
    [applyState, busyTrack, state],
  );

  if (!state) return null;

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
          readOnly={readOnly}
          busy={busyTrack === track.id}
          anyBusy={busyTrack !== null}
          expanded={expandedId === track.id}
          onToggle={(id) => setExpandedId((prev) => (prev === id ? null : id))}
          onSpend={(t) => void spend(t)}
        />
      ))}
      {error && <div className="text-[11px] font-bold text-red">{error}</div>}
      <OutputBank state={state} />
      {readOnly && (
        <div className="px-0.5 text-[11px] leading-snug" style={{ color: MUT }}>
          Spend tokens from the Cache Rank panel on your Hunter profile.
        </div>
      )}
    </div>
  );
};
