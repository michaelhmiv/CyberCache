/**
 * StandingsConsole — the Standings page in the "Instrument panel"
 * register (owner pick B, "The Telemetry Deck", 2026-11-05).
 *
 * The page as a telemetry deck: the standings are instruments being
 * read. A console head with an LCD status bank; the global board as
 * a measurement table whose channel selector cells carry the
 * viewer's own rank per channel; and the weekly races as numbered
 * telemetry channels, current and archived. The settlement record
 * (race rewards auto-pay — a record, never a claim) lives in
 * WeeklyEarningsPanel, restyled to this same kit.
 *
 * Presentation only: every value folds from the real payloads
 * (WeeklyLeaderboards, LeaderboardEntry, MyLeaderboardRank,
 * HunterLookView) fetched by LeaderboardsScreen. Race earnings
 * auto-pay by settlement — no claim affordance exists here.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import {
  LEADERBOARD_METRIC_UNITS,
  formatLeaderboardValue,
  type LeaderboardEntry,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type MyLeaderboardRank,
  type WeeklyLeaderboards,
  type WeeklyRaceBoard,
} from '@/lib/api/leaderboardService';
import type { HunterLookView } from '@/content/skins';
import { LcdWell, Led, LedMeter, Panel, PanelLabel, RankWell } from './StandingsConsoleKit';
import {
  AMBER,
  FAINT,
  GOLD,
  GREEN,
  INK,
  METRIC_SHORT,
  MUT,
  RED,
  STEEL_DARK,
  headStyle,
  monoStyle,
} from './standingsConsoleTokens';

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const weekRangeLabel = (startIso: string, endsAtIso: string): string => {
  const lastDay = new Date(Date.parse(endsAtIso) - 86_400_000).toISOString();
  return `${shortDay(startIso)} – ${shortDay(lastDay)}`;
};

const METRICS = Object.keys(METRIC_SHORT) as LeaderboardMetric[];

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'all_time', label: 'ALL TIME' },
  { id: 'weekly', label: 'WEEK' },
  { id: 'daily', label: 'DAY' },
];

/** Trend as an instrument delta: LED state + signed percent of the
 *  real previous_value/trend payload fields. Never a rank delta. */
const DeltaReadout: React.FC<{ trend: number; hasPrior: boolean }> = ({ trend, hasPrior }) => {
  if (!hasPrior) {
    return (
      <span className="flex items-center gap-1.5" style={{ ...monoStyle, color: FAINT, fontSize: 11 }}>
        <Led lit={false} size={7} />
        NO PRIOR
      </span>
    );
  }
  const pct = Math.round(trend * 100);
  const color = trend > 0 ? GREEN : trend < 0 ? RED : FAINT;
  return (
    <span className="flex items-center gap-1.5" style={{ ...monoStyle, color, fontSize: 11 }}>
      <Led lit={trend !== 0} color={color} size={7} />
      {pct > 0 ? `+${pct}%` : `${pct}%`} VS PRIOR
    </span>
  );
};

/* ---------------- console head ---------------- */

export const ConsoleHead: React.FC<{
  week: WeeklyLeaderboards['week'] | null;
  /** Field size from the /leaderboard/me payload; null until known. */
  totalPlayers: number | null;
  bestRank: number | null;
  dropBuff: WeeklyLeaderboards['my_drop_buff'];
  /** Embedded in the Hunter Standings stop: the plate back row
   *  already prints the stop's name, so the head drops its own
   *  title row (every header prints once) and keeps the LCD bank. */
  bare?: boolean;
}> = ({ week, totalPlayers, bestRank, dropBuff, bare = false }) => (
  <Panel testId="standings-console-head">
    {!bare && (
      <>
        <div className="flex items-center gap-2">
          <PxIcon name="crown" size={17} className="text-amber" />
          <h1
            className="text-[24px] uppercase leading-none"
            style={{ ...headStyle, color: INK, letterSpacing: '0.1em' }}
          >
            Standings
          </h1>
          <span className="ml-auto flex items-center gap-1.5" style={{ ...monoStyle, color: GREEN, fontSize: 11 }}>
            <Led lit color={GREEN} size={8} />
            LIVE
          </span>
        </div>
        <div className="mt-1.5" style={{ ...monoStyle, color: FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
          FIELD TELEMETRY — EVERY HUNTER, MEASURED
        </div>
      </>
    )}
    <div className={bare ? 'grid grid-cols-4 gap-1.5' : 'mt-3 grid grid-cols-4 gap-1.5'}>
      <LcdWell value={totalPlayers != null ? String(totalPlayers) : '—'} label="Hunters" valueSize={19} />
      <LcdWell value={week ? week.key.replace(/^\d{4}-/, '') : '—'} label="Week" valueSize={19} />
      <LcdWell value={bestRank != null ? `#${bestRank}` : '—'} label="My best rk" valueSize={19} color={GOLD} />
      <LcdWell
        value={dropBuff ? `+${Math.round(dropBuff.bonus * 100)}%` : 'OFF'}
        label="Drop luck"
        valueSize={19}
        color={dropBuff ? GOLD : FAINT}
      />
    </div>
    {week && (
      <div className="mt-2 flex items-baseline justify-between" style={{ ...monoStyle, fontSize: 11, color: FAINT }}>
        <span>WEEK WINDOW</span>
        <span style={{ color: MUT }}>{weekRangeLabel(week.start, week.ends_at).toUpperCase()}</span>
      </div>
    )}
  </Panel>
);

/* ---------------- the global board ---------------- */

const BoardRow: React.FC<{
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
  leaderValue: number;
  isMe: boolean;
  look?: HunterLookView | null;
  onRowClick?: (playerId: string) => void;
}> = ({ entry, metric, leaderValue, isMe, look, onRowClick }) => {
  const ratio = leaderValue > 0 ? entry.value / leaderValue : 0;
  return (
    <button
      type="button"
      data-testid={`standings-row-${entry.player_id}`}
      aria-label={`Open ${entry.username ?? 'Hunter'}'s profile`}
      onClick={() => onRowClick?.(entry.player_id)}
      className="flex w-full items-center gap-2 px-1.5 py-1.5 text-left"
      style={{
        minHeight: 52,
        background: isMe ? 'rgba(255,144,0,0.10)' : 'transparent',
        boxShadow: isMe ? 'inset 0 0 0 1px rgba(255,144,0,0.45)' : undefined,
      }}
    >
      <RankWell rank={entry.rank} gold={entry.rank <= 3} mine={isMe} />
      {look && (
        <span className="w-7 shrink-0" data-testid={`standings-portrait-${entry.player_id}`}>
          <HunterPortrait look={resolveLookView(look)} className="h-9" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span
            className="truncate text-[13px] font-bold"
            style={{ ...headStyle, color: isMe ? '#FFB03A' : INK }}
          >
            {entry.username ?? 'Vault Runner'}
          </span>
          {isMe && (
            <span
              className="shrink-0 px-1 py-px font-black"
              style={{ ...monoStyle, fontSize: 11, color: '#0B0906', backgroundColor: AMBER }}
            >
              ME
            </span>
          )}
        </span>
        <span className="mt-0.5 block">
          <DeltaReadout trend={entry.trend} hasPrior={entry.previous_value != null} />
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="font-bold leading-none" style={{ ...monoStyle, fontSize: 16, color: INK }}>
          {formatLeaderboardValue(metric, entry.value)}{' '}
          <span style={{ fontSize: 11, color: FAINT }}>{LEADERBOARD_METRIC_UNITS[metric]}</span>
        </span>
        <LedMeter
          ratio={ratio}
          color={isMe ? AMBER : GOLD}
          label={`${entry.username ?? 'Hunter'} at ${Math.round(ratio * 100)}% of the leader's value`}
        />
      </span>
    </button>
  );
};

export const BoardConsole: React.FC<{
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  onMetricChange: (metric: LeaderboardMetric) => void;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  entries: LeaderboardEntry[];
  loading: boolean;
  myPlayerId?: string | null;
  myRank: MyLeaderboardRank | null;
  /** The viewer's rank on every channel, for the selected period. */
  myRanks: Partial<Record<LeaderboardMetric, number | null>>;
  looks: Record<string, HunterLookView>;
  totalPlayers: number | null;
  onRowClick?: (playerId: string) => void;
}> = ({
  metric,
  period,
  onMetricChange,
  onPeriodChange,
  entries,
  loading,
  myPlayerId,
  myRank,
  myRanks,
  looks,
  totalPlayers,
  onRowClick,
}) => {
  const leaderValue = entries.length > 0 ? entries[0].value : 0;
  const meInEntries = myPlayerId != null && entries.some((e) => e.player_id === myPlayerId);
  return (
    <Panel testId="standings-board-console">
      <PanelLabel label="Global board" right={totalPlayers != null ? `FIELD ${totalPlayers}` : undefined} />
      {/* Channel selector bank: each cell is a channel push-button
          whose readout is the viewer's own rank on that channel. */}
      <div
        className="mb-1 flex items-baseline justify-between"
        style={{ ...monoStyle, fontSize: 11, color: FAINT, letterSpacing: '0.12em' }}
      >
        <span>CHANNEL SELECT</span>
        <span>READOUT = MY RK · {PERIODS.find((p) => p.id === period)?.label}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5" role="tablist" aria-label="Leaderboard metric">
        {METRICS.map((m) => {
          const active = m === metric;
          const rk = myRanks[m];
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onMetricChange(m)}
              className="flex flex-col items-center justify-center gap-0.5 px-1 py-1.5"
              style={{
                minHeight: 48,
                border: `1px solid ${active ? GOLD : STEEL_DARK}`,
                background: active
                  ? 'linear-gradient(180deg, rgba(242,192,99,0.16) 0%, rgba(242,192,99,0.05) 100%)'
                  : 'linear-gradient(180deg, #050403 0%, #0A0806 100%)',
                boxShadow: 'inset 0 2px 6px rgba(0,0,0,0.85)',
              }}
            >
              <span className="flex items-center gap-1" style={{ ...monoStyle, fontSize: 11, color: active ? GOLD : FAINT }}>
                <Led lit={active} color={GOLD} size={6} />
                {METRIC_SHORT[m]}
              </span>
              <span className="font-bold leading-none" style={{ ...monoStyle, fontSize: 16, color: active ? INK : MUT }}>
                {rk != null ? `#${rk}` : '—'}
              </span>
            </button>
          );
        })}
      </div>
      {/* Period switch: one machined segmented frame. */}
      <div
        className="mt-2 flex p-1"
        style={{ border: `1px solid ${STEEL_DARK}`, background: 'rgba(0,0,0,0.4)' }}
        role="tablist"
        aria-label="Leaderboard period"
      >
        {PERIODS.map((p) => {
          const active = p.id === period;
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onPeriodChange(p.id)}
              className="flex-1 py-2 font-black"
              style={{
                ...monoStyle,
                fontSize: 11,
                letterSpacing: '0.1em',
                minHeight: 36,
                color: active ? '#0B0906' : MUT,
                backgroundColor: active ? GOLD : 'transparent',
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {/* Column datum line. */}
      <div
        className="mt-2.5 flex items-baseline justify-between pb-1"
        style={{
          ...monoStyle,
          fontSize: 11,
          color: FAINT,
          letterSpacing: '0.1em',
          borderBottom: `1px solid ${STEEL_DARK}`,
        }}
      >
        <span>RK · HUNTER · Δ</span>
        <span>
          OUTPUT · {LEADERBOARD_METRIC_UNITS[metric].toUpperCase()} · VS LEADER
        </span>
      </div>
      <div>
        {loading ? (
          <div className="space-y-2 py-2" data-testid="standings-board-loading">
            <div className="h-4 w-1/3 animate-pulse rounded bg-bg" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-bg" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="py-5 text-center">
            <div className="text-sm font-bold" style={{ color: MUT }}>No leaderboard data yet.</div>
            <div className="mt-1 text-[11px]" style={{ color: FAINT }}>
              Rankings fill in from hunters&apos; play — check back after the next snapshot.
            </div>
          </div>
        ) : (
          entries.map((entry, i) => (
            <div key={entry.player_id} style={i > 0 ? { borderTop: '1px solid rgba(58,52,43,0.55)' } : undefined}>
              <BoardRow
                entry={entry}
                metric={metric}
                leaderValue={leaderValue}
                isMe={myPlayerId != null && entry.player_id === myPlayerId}
                look={looks[entry.player_id]}
                onRowClick={onRowClick}
              />
            </div>
          ))
        )}
      </div>
      {/* My reading, pinned at the foot when the shown entries
          exclude the viewer — the real /leaderboard/me payload. */}
      {myRank && !meInEntries && (
        <div
          data-testid="standings-board-my-reading"
          className="mt-2 px-2 py-2"
          style={{
            border: `1px solid rgba(255,144,0,0.55)`,
            background: 'linear-gradient(180deg, #0A0703 0%, #070503 100%)',
            boxShadow: 'inset 0 2px 7px rgba(0,0,0,0.9)',
          }}
        >
          <div className="flex items-center gap-2">
            <Led lit color={AMBER} size={8} />
            <span style={{ ...monoStyle, fontSize: 11, color: '#FFB03A', letterSpacing: '0.1em' }}>MY READING</span>
            <span className="ml-auto font-bold" style={{ ...monoStyle, fontSize: 19, color: INK }}>
              RK {myRank.rank}
              <span style={{ fontSize: 11, color: FAINT }}> OF {myRank.total_players}</span>
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-bold" style={{ ...monoStyle, fontSize: 14, color: MUT }}>
              {formatLeaderboardValue(metric, myRank.value)} {LEADERBOARD_METRIC_UNITS[metric]}
            </span>
            <span className="ml-auto">
              <DeltaReadout trend={myRank.trend} hasPrior={myRank.previous_value != null} />
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
};

/* ---------------- race channels ---------------- */

const RaceChannel: React.FC<{
  race: WeeklyRaceBoard;
  channel: number;
  final?: boolean;
  myPlayerId?: string | null;
  looks: Record<string, HunterLookView>;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ race, channel, final = false, myPlayerId, looks, onSelectPlayer }) => {
  const inTop = race.entries.some((e) => e.player_id === myPlayerId);
  const reward = final ? race.my_reward : null;
  return (
    <div data-testid={`standings-race-${race.id}`}>
      <div className="flex items-center gap-2">
        <Led lit={!final} color={final ? FAINT : GREEN} size={8} />
        <span style={{ ...monoStyle, fontSize: 11, color: FAINT }}>CH-{String(channel).padStart(2, '0')}</span>
        <span className="text-[15px] uppercase" style={{ ...headStyle, color: INK }}>
          {race.label}
        </span>
        <span className="ml-auto whitespace-nowrap" style={{ ...monoStyle, fontSize: 11, color: FAINT }}>
          {race.participant_count === 1 ? '1 RACER' : `${race.participant_count} RACERS`}
        </span>
      </div>
      <div className="mt-0.5 flex items-baseline justify-between gap-2">
        <span className="text-[11px]" style={{ color: MUT }}>{race.blurb}</span>
        <span className="shrink-0" style={{ ...monoStyle, fontSize: 11, color: FAINT }}>
          MIN QUAL {race.min_qualifying_value.toLocaleString()} {race.unit.toUpperCase()}
        </span>
      </div>
      <div className="mt-1.5">
        {race.entries.length === 0 ? (
          <div className="py-1 text-[11px]" style={{ color: FAINT }}>
            No qualifying runs yet{final ? '' : ' this week'}.
          </div>
        ) : (
          race.entries.map((entry, i) => {
            const isMe = entry.player_id === myPlayerId;
            return (
              <button
                key={entry.player_id}
                type="button"
                data-testid={`standings-row-${entry.player_id}`}
                aria-label={`Open ${entry.username ?? 'Hunter'}'s profile`}
                onClick={() => onSelectPlayer?.(entry.player_id)}
                className="flex w-full items-center gap-2 px-1.5 py-1 text-left"
                style={{
                  minHeight: 44,
                  borderTop: i > 0 ? '1px solid rgba(58,52,43,0.55)' : undefined,
                  background: isMe ? 'rgba(255,144,0,0.10)' : 'transparent',
                  boxShadow: isMe ? 'inset 0 0 0 1px rgba(255,144,0,0.45)' : undefined,
                }}
              >
                <RankWell rank={entry.rank} gold={entry.rank <= 3} mine={isMe} />
                {looks[entry.player_id] && (
                  <span className="w-7 shrink-0" data-testid={`standings-portrait-${entry.player_id}`}>
                    <HunterPortrait look={resolveLookView(looks[entry.player_id])} className="h-8" />
                  </span>
                )}
                <span
                  className="min-w-0 flex-1 truncate text-[13px] font-bold"
                  style={{ ...headStyle, color: isMe ? '#FFB03A' : INK }}
                >
                  {entry.username ?? 'Hunter'}
                </span>
                <span className="whitespace-nowrap font-bold" style={{ ...monoStyle, fontSize: 14, color: INK }}>
                  {entry.value.toLocaleString('en-US')}{' '}
                  <span style={{ fontSize: 11, color: FAINT }}>{race.unit}</span>
                </span>
              </button>
            );
          })
        )}
      </div>
      {race.me && !inTop && myPlayerId && (
        <button
          type="button"
          data-testid="standings-row-me"
          aria-label="Open your public profile"
          onClick={() => onSelectPlayer?.(myPlayerId)}
          className="mt-1 flex w-full items-center gap-2 px-2 py-1.5 text-left"
          style={{
            minHeight: 44,
            border: `1px solid rgba(255,144,0,0.55)`,
            background: 'linear-gradient(180deg, #0A0703 0%, #070503 100%)',
            boxShadow: 'inset 0 2px 7px rgba(0,0,0,0.9)',
          }}
        >
          <Led lit color={AMBER} size={8} />
          <span style={{ ...monoStyle, fontSize: 11, color: '#FFB03A', letterSpacing: '0.1em' }}>ME</span>
          <span className="font-bold" style={{ ...monoStyle, fontSize: 15, color: INK }}>RK {race.me.rank}</span>
          {looks[myPlayerId] && (
            <span className="w-7 shrink-0" data-testid="standings-portrait-me">
              <HunterPortrait look={resolveLookView(looks[myPlayerId])} className="h-8" />
            </span>
          )}
          <span className="ml-auto whitespace-nowrap font-bold" style={{ ...monoStyle, fontSize: 14, color: INK }}>
            {race.me.value.toLocaleString('en-US')}{' '}
            <span style={{ fontSize: 11, color: FAINT }}>{race.unit}</span>
          </span>
        </button>
      )}
      {reward && (
        <div
          className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5"
          style={{ border: `1px solid ${STEEL_DARK}`, background: 'rgba(0,0,0,0.35)' }}
        >
          <span style={{ ...monoStyle, fontSize: 11, color: FAINT, letterSpacing: '0.1em' }}>MY PAYOUT · FIN #{reward.rank}</span>
          {reward.cache_keys > 0 && (
            <span className="font-bold" style={{ ...monoStyle, fontSize: 14, color: GOLD }}>
              +{reward.cache_keys} {reward.cache_keys === 1 ? 'KEY' : 'KEYS'}
            </span>
          )}
          {reward.buff_bonus > 0 && (
            <span className="font-bold" style={{ ...monoStyle, fontSize: 12, color: GREEN }}>
              +{Math.round(reward.buff_bonus * 100)}% DROP LUCK · {reward.buff_hours}H
            </span>
          )}
        </div>
      )}
    </div>
  );
};

const channelSeparator: React.CSSProperties = {
  borderTop: `1px solid ${STEEL_DARK}`,
  marginTop: 12,
  paddingTop: 12,
};

export const RaceChannels: React.FC<{
  data: WeeklyLeaderboards | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  myPlayerId?: string | null;
  looks: Record<string, HunterLookView>;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ data, loading, error, onRetry, myPlayerId, looks, onSelectPlayer }) => (
  <div id="weekly-races-card" className="scroll-mt-2">
    <Panel>
      <PanelLabel
        label="Weekly race channels"
        right={data ? weekRangeLabel(data.week.start, data.week.ends_at).toUpperCase() : undefined}
      />
      {loading ? (
        <div className="space-y-2">
          <div className="h-4 w-1/3 animate-pulse rounded bg-bg" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-bg" />
          ))}
        </div>
      ) : error || !data ? (
        <div className="py-2 text-center">
          <div className="text-sm font-black" style={{ color: RED }}>Weekly races unavailable</div>
          <div className="mt-1 text-xs" style={{ color: MUT }}>{error ?? 'Weekly races could not be loaded.'}</div>
          <button type="button" onClick={onRetry} className="bl-primary mt-3 px-4 py-2 text-xs font-black">
            Retry
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2">
            <PxIcon name="flag" size={13} className="text-amber" />
            <span className="text-[11px]" style={{ color: MUT }}>
              Top finishers win cache keys and drop luck when the week closes Monday 00:00 UTC.
            </span>
          </div>
          {data.my_drop_buff && (
            <div
              className="mt-2 flex items-center gap-2 px-2 py-1.5"
              style={{ border: `1px solid rgba(242,192,99,0.5)`, background: 'rgba(242,192,99,0.08)' }}
            >
              <Led lit color={GOLD} size={8} />
              <span className="font-bold" style={{ ...monoStyle, fontSize: 12, color: GOLD }}>
                DROP LUCK +{Math.round(data.my_drop_buff.bonus * 100)}% · UNTIL {shortDay(data.my_drop_buff.expires_at).toUpperCase()}
              </span>
            </div>
          )}
          {data.races.map((race, i) => (
            <div key={race.id} style={i > 0 ? channelSeparator : { marginTop: 12 }}>
              <RaceChannel
                race={race}
                channel={i + 1}
                myPlayerId={myPlayerId}
                looks={looks}
                onSelectPlayer={onSelectPlayer}
              />
            </div>
          ))}
        </div>
      )}
    </Panel>
  </div>
);

export const FinalsArchive: React.FC<{
  data: WeeklyLeaderboards | null;
  loading: boolean;
  myPlayerId?: string | null;
  looks: Record<string, HunterLookView>;
  onSelectPlayer?: (playerId: string) => void;
}> = ({ data, loading, myPlayerId, looks, onSelectPlayer }) => {
  if (loading || !data) return null;
  const prev = data.previous_week;
  const prevPlaced = prev.races.some((r) => r.my_reward !== null || r.me !== null);
  return (
    <Panel testId="standings-finals-archive">
      <PanelLabel
        label="Last week — finals archive"
        right={weekRangeLabel(prev.start, prev.ends_at).toUpperCase()}
      />
      <div className="flex items-center gap-1.5" style={{ ...monoStyle, fontSize: 11, color: prev.settled ? GREEN : FAINT }}>
        <Led lit={prev.settled} color={GREEN} size={8} />
        {prev.settled ? 'SETTLED — PAYOUTS POSTED' : 'AWAITING SETTLEMENT'}
      </div>
      {!prev.settled && (
        <div className="mt-1 text-[11px]" style={{ color: MUT }}>
          Rewards settle at the next daily heartbeat.
        </div>
      )}
      {prev.races.map((race, i) => (
        <div key={race.id} style={i > 0 ? channelSeparator : { marginTop: 12 }}>
          <RaceChannel
            race={race}
            channel={i + 1}
            final
            myPlayerId={myPlayerId}
            looks={looks}
            onSelectPlayer={onSelectPlayer}
          />
        </div>
      ))}
      {prev.settled && !prevPlaced && (
        <div className="mt-3 text-[11px]" style={{ color: MUT }}>
          You didn&apos;t place last week — this week is open.
        </div>
      )}
    </Panel>
  );
};
