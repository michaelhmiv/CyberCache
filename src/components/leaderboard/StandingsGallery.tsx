/**
 * StandingsGallery — PROTOTYPE (design/hunter-subpages-standings-c,
 * 2026-11-05). Variant C "Showcase" for the Standings page: the
 * boards as a gallery. Hunters are exhibited, not listed — the
 * current leader hangs full-bleed on a zone painting with their
 * full figure grounded on it, the runners-up hang as a pair, and
 * the rest of the field is a portrait wall. Captions sit in the
 * quiet below each canvas; the interface is type and air, never
 * plates, stamps, or gauges.
 *
 * Content is the shipped page's, unchanged: all 10 metrics × 3
 * periods from the real payload types, trend read from the real
 * previous_value/trend fields, weekly races + last week's finals,
 * and the earnings room driven by the real deriveWeeklyEarnings.
 * Race rewards auto-pay at settlement — there is NO claim
 * operation anywhere in this surface (DESIGN.md §9), and none is
 * drawn.
 */
import React from 'react';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { resolveLookView } from '@/lib/pixel/lookResolution';
import { getPixelSprite } from '@/lib/pixel/manifest';
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
import {
  deriveWeeklyEarnings,
  type WeeklyEarningRow,
} from '@/components/leaderboard/weeklyEarnings';
import type { HunterLookView } from '@/content/skins';

/* ---------------- shared voice ---------------- */

/** Clean display type — Bebas without the Arena Plates shadow
 *  stack. The gallery's headings carry no chrome at all. */
const display: React.CSSProperties = {
  fontFamily: "'Bebas Neue', 'Chakra Petch', sans-serif",
  letterSpacing: '0.045em',
};

export const ZONE_PAINTING_IDS: Record<string, string> = {
  dustwaste_frontier: 'zone-dustwaste-bg',
  redline_circuit: 'zone-redline-bg',
  ironwood_bastion: 'zone-ironwood-bg',
  blastforge_yards: 'zone-blastforge-bg',
  prismatek_reactor: 'zone-prismatek-bg',
  throwtech_dumpnet: 'zone-throwtech-bg',
  helixworks_labyrinth: 'zone-helixworks-bg',
};

const shortDay = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const weekRangeLabel = (startIso: string, endsAtIso: string): string => {
  const lastDay = new Date(Date.parse(endsAtIso) - 86_400_000).toISOString();
  return `${shortDay(startIso)} – ${shortDay(lastDay)}`;
};

const ordinal = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
};

/** The trend line under a value — percent movement against the
 *  prior reading, from the payload's own fields. No prior prints
 *  as the shipped row prints it. */
const TrendLine: React.FC<{ entry: { previous_value: number | null; trend: number } }> = ({ entry }) =>
  entry.previous_value == null ? (
    <span className="text-text-muted">No prior data</span>
  ) : (
    <span className={entry.trend > 0 ? 'text-green' : entry.trend < 0 ? 'text-red' : 'text-text-muted'}>
      {entry.trend > 0 ? '+' : ''}
      {Math.round(entry.trend * 100)}% vs prior
    </span>
  );

/* ---------------- the canvas ---------------- */

/**
 * One exhibited hunter: a zone painting running edge to edge with
 * the hunter's full figure standing on it. Nothing else is printed
 * on the art — rank, name, and value live in the caption below.
 */
const HunterCanvas: React.FC<{
  look: HunterLookView;
  zone: string;
  heightClass: string;
  isMe?: boolean;
  drained?: boolean;
  testId?: string;
}> = ({ look, zone, heightClass, isMe, drained, testId }) => {
  const painting = getPixelSprite(ZONE_PAINTING_IDS[zone] ?? 'zone-dustwaste-bg');
  return (
    <div
      data-testid={testId}
      className={`relative w-full overflow-hidden bg-[#0d0906] ${heightClass} ${
        isMe ? 'shadow-[0_0_0_1.5px_rgba(255,144,0,0.85),0_10px_36px_rgba(255,144,0,0.16)]' : ''
      } ${drained ? 'opacity-90' : ''}`}
    >
      {painting && (
        <img
          src={painting.url}
          alt=""
          draggable={false}
          className={`absolute inset-0 h-full w-full object-cover ${
            drained ? 'brightness-[0.72] saturate-[0.35]' : ''
          }`}
        />
      )}
      <div className={`absolute inset-0 ${drained ? 'saturate-[0.45]' : ''}`}>
        <HunterPortrait look={resolveLookView(look)} className="h-full w-full" />
      </div>
    </div>
  );
};

/** The caption under a canvas: rank + name on one line, the value
 *  as the hero on the next, trend quiet beside it. */
const BoardCaption: React.FC<{
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
  isMe?: boolean;
  hero?: boolean;
}> = ({ entry, metric, isMe, hero }) => (
  <div className="pt-2.5">
    <div className="flex items-baseline gap-2">
      <span className={`tabular-nums ${hero ? 'text-[15px]' : 'text-[13px]'} font-black text-text-muted`}>
        {entry.rank}
      </span>
      <span
        className={`min-w-0 flex-1 truncate ${hero ? 'text-[26px]' : 'text-[17px]'} leading-none ${
          isMe ? 'text-amber' : 'text-text-primary'
        }`}
        style={display}
      >
        {entry.username ?? 'Vault Runner'}
        {isMe && <span className="text-amber"> · You</span>}
      </span>
    </div>
    <div className="mt-1 flex items-baseline gap-2.5">
      <span className={`font-black tabular-nums text-text-primary ${hero ? 'text-[30px]' : 'text-[19px]'} leading-none`}>
        {formatLeaderboardValue(metric, entry.value)}
      </span>
      <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
        {LEADERBOARD_METRIC_UNITS[metric]}
      </span>
      <span className="text-[11px]">
        <TrendLine entry={entry} />
      </span>
    </div>
  </div>
);

/* ---------------- masthead ---------------- */

export const GalleryMasthead: React.FC<{
  metricLabel: string;
  periodLabel: string;
  myRank: MyLeaderboardRank | null;
  totalPlayers: number;
  week: WeeklyLeaderboards['week'];
}> = ({ metricLabel, periodLabel, myRank, totalPlayers, week }) => (
  <header className="px-4 pt-2" data-testid="gallery-masthead">
    <h1 className="text-[54px] leading-[0.95] text-text-primary" style={display}>
      Standings
    </h1>
    <p className="mt-3 max-w-[34ch] text-[13px] leading-relaxed text-text-secondary">
      {totalPlayers} hunters hang in the hall.
      {myRank
        ? ` By ${metricLabel}, ${periodLabel.toLowerCase()}, you stand ${ordinal(myRank.rank)}.`
        : ' Your own canvas joins the wall once you place.'}
    </p>
    <p className="mt-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
      Week of {weekRangeLabel(week.start, week.ends_at)}
    </p>
  </header>
);

/* ---------------- the switches ---------------- */

const METRIC_LABELS: { value: LeaderboardMetric; label: string }[] = [
  { value: 'level', label: 'Level' },
  { value: 'xp', label: 'XP' },
  { value: 'net_worth', label: 'Net Worth' },
  { value: 'total_kills', label: 'Kills' },
  { value: 'kdr', label: 'K/D' },
  { value: 'highest_boss_tier', label: 'Boss Tier' },
  { value: 'total_mastery_xp', label: 'Mastery XP' },
  { value: 'highest_mastery_level', label: 'Mastery Lv' },
  { value: 'legendary_items', label: 'Legendaries' },
  { value: 'total_items', label: 'Items' },
];

const PERIOD_LABELS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'all_time', label: 'All Time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

export const METRIC_LABEL_OF = (m: LeaderboardMetric): string =>
  METRIC_LABELS.find((x) => x.value === m)?.label ?? m;
export const PERIOD_LABEL_OF = (p: LeaderboardPeriod): string =>
  PERIOD_LABELS.find((x) => x.value === p)?.label ?? p;

/** Quiet text switches: words in a scrolling row (never shrunk),
 *  the active word in bone with an amber rule beneath it. */
export const GallerySwitches: React.FC<{
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  onMetricChange: (m: LeaderboardMetric) => void;
  onPeriodChange: (p: LeaderboardPeriod) => void;
}> = ({ metric, period, onMetricChange, onPeriodChange }) => (
  <div className="mt-6" data-testid="gallery-switches">
    <div className="flex overflow-x-auto px-4" role="tablist" aria-label="Board metric">
      {METRIC_LABELS.map((m) => {
        const active = m.value === metric;
        return (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onMetricChange(m.value)}
            className={`flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-3 text-[12px] font-black uppercase tracking-[0.14em] ${
              active ? 'text-text-primary' : 'text-text-muted'
            }`}
            style={active ? { boxShadow: 'inset 0 -2px 0 #FF9000' } : undefined}
          >
            {m.label}
          </button>
        );
      })}
    </div>
    <div className="mt-1 flex px-4" role="tablist" aria-label="Board period">
      {PERIOD_LABELS.map((p) => {
        const active = p.value === period;
        return (
          <button
            key={p.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onPeriodChange(p.value)}
            className={`flex min-h-[44px] shrink-0 items-center whitespace-nowrap px-3 text-[12px] font-black uppercase tracking-[0.14em] ${
              active ? 'text-amber' : 'text-text-muted'
            }`}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  </div>
);

/* ---------------- the board ---------------- */

export const BoardGallery: React.FC<{
  entries: LeaderboardEntry[];
  metric: LeaderboardMetric;
  myPlayerId: string;
  myRank: MyLeaderboardRank | null;
  myUsername: string;
  looks: Record<string, HunterLookView>;
  zones: Record<string, string>;
  onSelectPlayer: (playerId: string) => void;
}> = ({ entries, metric, myPlayerId, myRank, myUsername, looks, zones, onSelectPlayer }) => {
  const [first, second, third, ...rest] = entries;
  const meShown = entries.some((e) => e.player_id === myPlayerId);

  return (
    <section aria-label="The board" data-testid="gallery-board">
      {first && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => onSelectPlayer(first.player_id)}
            aria-label={`Open ${first.username ?? 'hunter'}'s profile`}
            className="block w-full text-left"
            data-testid="gallery-hero"
          >
            {looks[first.player_id] && (
              <HunterCanvas
                look={looks[first.player_id]}
                zone={zones[first.player_id] ?? 'dustwaste_frontier'}
                heightClass="h-[348px]"
                isMe={first.player_id === myPlayerId}
              />
            )}
            <div className="px-4">
              <BoardCaption entry={first} metric={metric} isMe={first.player_id === myPlayerId} hero />
            </div>
          </button>
        </div>
      )}

      {second && third && (
        <div className="mt-8 grid grid-cols-2 gap-3 px-4">
          {[second, third].map((entry) => {
            const look = looks[entry.player_id];
            if (!look) return null;
            const isMe = entry.player_id === myPlayerId;
            return (
              <button
                key={entry.player_id}
                type="button"
                onClick={() => onSelectPlayer(entry.player_id)}
                aria-label={`Open ${entry.username ?? 'hunter'}'s profile`}
                className="block w-full text-left"
                data-testid={`gallery-piece-${entry.player_id}`}
              >
                <HunterCanvas
                  look={look}
                  zone={zones[entry.player_id] ?? 'dustwaste_frontier'}
                  heightClass="h-[196px]"
                  isMe={isMe}
                />
                <BoardCaption entry={entry} metric={metric} isMe={isMe} />
              </button>
            );
          })}
        </div>
      )}

      {rest.length > 0 && (
        <div className="mt-8 grid grid-cols-2 gap-x-3 gap-y-8 px-4">
          {rest.map((entry) => {
            const look = looks[entry.player_id];
            if (!look) return null;
            const isMe = entry.player_id === myPlayerId;
            return (
              <button
                key={entry.player_id}
                type="button"
                onClick={() => onSelectPlayer(entry.player_id)}
                aria-label={`Open ${entry.username ?? 'hunter'}'s profile`}
                className="block w-full text-left"
                data-testid={`gallery-piece-${entry.player_id}`}
              >
                <HunterCanvas
                  look={look}
                  zone={zones[entry.player_id] ?? 'dustwaste_frontier'}
                  heightClass="h-[148px]"
                  isMe={isMe}
                />
                <BoardCaption entry={entry} metric={metric} isMe={isMe} />
              </button>
            );
          })}
        </div>
      )}

      {!meShown && myRank && looks[myPlayerId] && (
        <div className="mt-12" data-testid="gallery-pinned-me">
          <h2 className="px-4 text-[24px] leading-none text-text-primary" style={display}>
            Your place
          </h2>
          <button
            type="button"
            onClick={() => onSelectPlayer(myPlayerId)}
            aria-label="Open your public profile"
            className="mt-3 block w-full text-left"
          >
            <HunterCanvas
              look={looks[myPlayerId]}
              zone={zones[myPlayerId] ?? 'dustwaste_frontier'}
              heightClass="h-[210px]"
              isMe
            />
            <div className="px-4 pt-2.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[15px] font-black tabular-nums text-text-muted">{myRank.rank}</span>
                <span className="text-[26px] leading-none text-amber" style={display}>
                  {myUsername} · You
                </span>
              </div>
              <div className="mt-1 flex items-baseline gap-2.5">
                <span className="text-[30px] font-black leading-none tabular-nums text-text-primary">
                  {formatLeaderboardValue(metric, myRank.value)}
                </span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                  {LEADERBOARD_METRIC_UNITS[metric]}
                </span>
                <span className="text-[11px]">
                  <TrendLine entry={myRank} />
                </span>
                <span className="text-[11px] text-text-muted">of {myRank.total_players} hunters</span>
              </div>
            </div>
          </button>
        </div>
      )}
    </section>
  );
};

/* ---------------- the earnings room ---------------- */

const EarningExhibit: React.FC<{ row: WeeklyEarningRow }> = ({ row }) => {
  const { reward } = row;
  const buffPct = Math.round(reward.buff_bonus * 100);
  return (
    <div className="flex items-end justify-between gap-4 py-3" data-testid={`gallery-earnings-row-${row.raceId}`}>
      <div className="min-w-0">
        <div className="truncate text-[21px] leading-none text-text-primary" style={display}>
          {row.label}
        </div>
        <div className="mt-1.5 text-[11px] text-text-muted">Finished #{reward.rank}</div>
        {reward.cache_keys > 0 && reward.buff_bonus > 0 && (
          <div className="mt-0.5 text-[11px] font-bold text-green">
            +{buffPct}% drop luck for {reward.buff_hours}h
          </div>
        )}
      </div>
      {reward.cache_keys > 0 ? (
        <div className="shrink-0 text-right">
          <div className="text-[34px] font-black leading-none tabular-nums text-amber">+{reward.cache_keys}</div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Cache {reward.cache_keys === 1 ? 'key' : 'keys'}
          </div>
        </div>
      ) : (
        <div className="shrink-0 text-right">
          <div className="text-[34px] font-black leading-none tabular-nums text-green">+{buffPct}%</div>
          <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Drop luck · {reward.buff_hours}h
          </div>
        </div>
      )}
    </div>
  );
};

export const EarningsRoom: React.FC<{
  data: WeeklyLeaderboards;
  onSeeRaces: () => void;
}> = ({ data, onSeeRaces }) => {
  const state = deriveWeeklyEarnings(data);
  const prev = data.previous_week;
  return (
    <section className="mt-14 px-4" aria-label="Your weekly earnings" data-testid="gallery-earnings">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[30px] leading-none text-text-primary" style={display}>
          Your weekly earnings
        </h2>
        {prev && (
          <span className="whitespace-nowrap text-[11px] text-text-muted">
            {weekRangeLabel(prev.start, prev.ends_at)}
          </span>
        )}
      </div>

      {state.kind === 'earnings' ? (
        <div className="mt-2">
          <p className="max-w-[52ch] text-[12px] leading-relaxed text-text-secondary">
            Race rewards pay out automatically when the week settles — no claim needed.
            These are already in your account.
          </p>
          <div className="mt-2 divide-y divide-white/5">
            {state.rows.map((row) => (
              <EarningExhibit key={row.raceId} row={row} />
            ))}
          </div>
          {state.rows.length > 1 && state.totalCacheKeys > 0 && (
            <div className="mt-2 text-[15px] font-bold text-text-primary">
              Total paid: {state.totalCacheKeys} cache {state.totalCacheKeys === 1 ? 'key' : 'keys'}
            </div>
          )}
        </div>
      ) : state.kind === 'pending' ? (
        <p className="mt-2 max-w-[52ch] text-[12px] leading-relaxed text-text-secondary">
          Last week&apos;s races are final. Your rewards settle at the next daily heartbeat —
          they pay automatically and land right here.
        </p>
      ) : state.kind === 'placed' ? (
        <div className="mt-2">
          <p className="max-w-[52ch] text-[12px] leading-relaxed text-text-secondary">
            You raced last week but finished outside the rewards — paid places are the
            top 10 at each race&apos;s qualifying minimum.
          </p>
          <button
            type="button"
            onClick={onSeeRaces}
            className="mt-2 flex min-h-[44px] items-center text-[12px] font-black uppercase tracking-[0.14em] text-amber"
          >
            See this week&apos;s races
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <p className="max-w-[52ch] text-[12px] leading-relaxed text-text-secondary">
            No weekly earnings yet — your best placements land here Mondays.
          </p>
          <button
            type="button"
            onClick={onSeeRaces}
            className="mt-2 flex min-h-[44px] items-center text-[12px] font-black uppercase tracking-[0.14em] text-amber"
          >
            See this week&apos;s races
          </button>
        </div>
      )}
    </section>
  );
};

/* ---------------- the races ---------------- */

const RaceExhibit: React.FC<{
  race: WeeklyRaceBoard;
  myPlayerId: string;
  looks: Record<string, HunterLookView>;
  raceZones: Record<string, string>;
  final?: boolean;
  onSelectPlayer: (playerId: string) => void;
}> = ({ race, myPlayerId, looks, raceZones, final, onSelectPlayer }) => {
  const leader = race.entries[0];
  const leaderLook = leader ? looks[leader.player_id] : undefined;
  const inTop = race.entries.some((e) => e.player_id === myPlayerId);
  const reward = final ? race.my_reward : null;
  return (
    <article className="mt-9" data-testid={`gallery-race-${race.id}`}>
      {leader && leaderLook && (
        <button
          type="button"
          onClick={() => onSelectPlayer(leader.player_id)}
          aria-label={`Open ${leader.username ?? 'hunter'}'s profile`}
          className="block w-full text-left"
        >
          <HunterCanvas
            look={leaderLook}
            zone={raceZones[race.id] ?? 'dustwaste_frontier'}
            heightClass="h-[168px]"
            drained={final}
          />
        </button>
      )}
      <div className="px-4">
        <div className="flex items-baseline justify-between gap-3 pt-3">
          <h3 className="text-[24px] leading-none text-text-primary" style={display}>
            {race.label}
          </h3>
          <span className="whitespace-nowrap text-[11px] text-text-muted">
            {race.participant_count === 1 ? '1 racer' : `${race.participant_count} racers`}
          </span>
        </div>
        <p className="mt-1.5 max-w-[52ch] text-[12px] leading-relaxed text-text-secondary">{race.blurb}</p>

        {race.entries.length === 0 ? (
          <p className="mt-3 text-[12px] text-text-muted">
            No qualifying runs yet{final ? '' : ' this week'}.
          </p>
        ) : (
          <div className="mt-3">
            {race.entries.map((entry) => {
              const isMe = entry.player_id === myPlayerId;
              return (
                <button
                  key={entry.player_id}
                  type="button"
                  onClick={() => onSelectPlayer(entry.player_id)}
                  aria-label={`Open ${entry.username ?? 'hunter'}'s profile`}
                  className="flex min-h-[44px] w-full items-baseline gap-3 py-1.5 text-left"
                  data-testid={`gallery-race-row-${entry.player_id}`}
                >
                  <span className="w-7 shrink-0 text-right text-[13px] font-black tabular-nums text-text-muted">
                    {entry.rank}
                  </span>
                  <span
                    className={`min-w-0 flex-1 truncate text-[14px] font-bold ${isMe ? 'text-amber' : 'text-text-primary'}`}
                  >
                    {entry.username ?? 'Hunter'}
                    {isMe && ' · You'}
                  </span>
                  <span className="whitespace-nowrap text-[14px] font-black tabular-nums text-text-primary">
                    {entry.value.toLocaleString('en-US')}
                  </span>
                  <span className="whitespace-nowrap text-[11px] text-text-muted">{race.unit}</span>
                </button>
              );
            })}
            {race.me && !inTop && (
              <button
                type="button"
                onClick={() => onSelectPlayer(myPlayerId)}
                aria-label="Open your public profile"
                className="mt-1 flex min-h-[44px] w-full items-baseline gap-3 py-1.5 text-left"
                data-testid="gallery-race-row-me"
              >
                <span className="w-7 shrink-0 text-right text-[13px] font-black tabular-nums text-amber">
                  {race.me.rank}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-amber">You</span>
                <span className="whitespace-nowrap text-[14px] font-black tabular-nums text-text-primary">
                  {race.me.value.toLocaleString('en-US')}
                </span>
                <span className="whitespace-nowrap text-[11px] text-text-muted">{race.unit}</span>
              </button>
            )}
          </div>
        )}

        {reward && (
          <p className="mt-2 text-[12px] font-bold leading-relaxed text-amber">
            You finished #{reward.rank}
            {reward.cache_keys > 0 && (
              <> — {reward.cache_keys} cache {reward.cache_keys === 1 ? 'key' : 'keys'} earned</>
            )}
            {reward.buff_bonus > 0 && (
              <> · +{Math.round(reward.buff_bonus * 100)}% drop luck for {reward.buff_hours}h</>
            )}
          </p>
        )}
      </div>
    </article>
  );
};

export const RacesGallery: React.FC<{
  data: WeeklyLeaderboards;
  myPlayerId: string;
  looks: Record<string, HunterLookView>;
  raceZones: Record<string, string>;
  onSelectPlayer: (playerId: string) => void;
}> = ({ data, myPlayerId, looks, raceZones, onSelectPlayer }) => {
  const prev = data.previous_week;
  const prevPlaced = prev.races.some((r) => r.my_reward !== null || r.me !== null);
  return (
    <section className="mt-14" aria-label="Weekly races" data-testid="gallery-races">
      <div className="px-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[30px] leading-none text-text-primary" style={display}>
            Weekly races
          </h2>
          <span className="whitespace-nowrap text-[11px] text-text-muted">
            {weekRangeLabel(data.week.start, data.week.ends_at)}
          </span>
        </div>
        <p className="mt-2 max-w-[52ch] text-[12px] leading-relaxed text-text-secondary">
          Top finishers win cache keys and drop luck when the week closes Monday 00:00 UTC.
        </p>
        {data.my_drop_buff && (
          <p className="mt-2 text-[12px] font-bold text-amber">
            Drop luck active: +{Math.round(data.my_drop_buff.bonus * 100)}% until{' '}
            {shortDay(data.my_drop_buff.expires_at)}
          </p>
        )}
      </div>

      {data.races.map((race) => (
        <RaceExhibit
          key={race.id}
          race={race}
          myPlayerId={myPlayerId}
          looks={looks}
          raceZones={raceZones}
          onSelectPlayer={onSelectPlayer}
        />
      ))}

      <div className="mt-16 px-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[30px] leading-none text-text-primary" style={display}>
            Last week — final
          </h2>
          <span className="whitespace-nowrap text-[11px] text-text-muted">
            {weekRangeLabel(prev.start, prev.ends_at)}
          </span>
        </div>
        {!prev.settled && (
          <p className="mt-2 text-[12px] text-text-secondary">Rewards settle at the next daily heartbeat.</p>
        )}
      </div>

      {prev.races.map((race) => (
        <RaceExhibit
          key={race.id}
          race={race}
          myPlayerId={myPlayerId}
          looks={looks}
          raceZones={raceZones}
          final
          onSelectPlayer={onSelectPlayer}
        />
      ))}

      {prev.settled && !prevPlaced && (
        <p className="mt-6 px-4 text-[12px] text-text-secondary">
          You didn&apos;t place last week — this week is open.
        </p>
      )}
    </section>
  );
};
