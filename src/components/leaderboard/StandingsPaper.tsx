/**
 * StandingsPaper — PROTOTYPE presentation (design/hunter-subpages-
 * standings-d, 2026-11-05). Variant D: "Field paperwork."
 *
 * The Standings page re-composed as the frontier records office's
 * paperwork: a filed standings RETURN (masthead form), the weekly
 * earnings as a perforated PAY VOUCHER stamped PAID BY SETTLEMENT,
 * the races as ruled HEAT SHEETS, and the global board as a LEDGER
 * whose metric switch is a row of file-folder tabs and whose period
 * switch is a clerk's checkbox line. Stamps are the verb system;
 * a red pencil annotates the reader's own lines.
 *
 * Presentation only: it consumes the REAL payload types
 * (WeeklyLeaderboards, LeaderboardEntry, MyLeaderboardRank,
 * HunterLookView) and the shipped deriveWeeklyEarnings fold, so a
 * production slice swaps fixtures for the screen's service calls
 * without touching a line of this file. No claim operation exists
 * for race rewards — settlement pays automatically, and the voucher
 * says so in the shipped words.
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
import { deriveWeeklyEarnings } from './weeklyEarnings';
import type { HunterLookView } from '@/content/skins';

/* ---------------- the paper register ---------------- */

const STOCK = '#1E1811'; // sheet stock — dark desk paper
const STOCK_DEEP = '#171208'; // folder tabs, recesses
const INK = '#EDE3CE'; // bone ink
const INK_SOFT = '#C9BBA0'; // typed secondary
const INK_FAINT = '#A2957F'; // clerk's small print (4.5:1 on stock)
const RULE = 'rgba(237,227,206,0.14)'; // ruled hairline
const RULE_STRONG = 'rgba(237,227,206,0.34)';
const STAMP_RED = '#CE6A4E'; // faded brick stamp ink
const PENCIL = '#E0784F'; // red-pencil annotation
const AMBER = '#FF9000'; // paid money only
const CLERK_GREEN = '#A8C686';
const CLERK_RED = '#D98E73';

const DISPLAY: React.CSSProperties = {
  fontFamily: "'Bebas Neue', 'Chakra Petch', sans-serif",
  letterSpacing: '0.05em',
};
const MONO: React.CSSProperties = {
  fontFamily: "Consolas, 'SF Mono', ui-monospace, monospace",
};

/* ---------------- furniture ---------------- */

/** A filed sheet: dark stock, hairline frame, two staples, a soft
 *  desk shadow. Everything in this register is one of these. */
const Sheet: React.FC<{
  children: React.ReactNode;
  testId?: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, testId, className, style }) => (
  <section
    data-testid={testId}
    className={`relative ${className ?? ''}`}
    style={{
      backgroundColor: STOCK,
      border: `1px solid ${RULE_STRONG}`,
      boxShadow: '0 10px 22px rgba(0,0,0,0.45), 0 2px 5px rgba(0,0,0,0.5)',
      ...style,
    }}
  >
    <span
      aria-hidden="true"
      className="absolute -top-[3px] left-6 h-[5px] w-6"
      style={{ background: 'linear-gradient(180deg,#8A8172,#5B554B)', transform: 'rotate(-2deg)', borderRadius: 1 }}
    />
    <span
      aria-hidden="true"
      className="absolute -top-[3px] right-6 h-[5px] w-6"
      style={{ background: 'linear-gradient(180deg,#8A8172,#5B554B)', transform: 'rotate(2deg)', borderRadius: 1 }}
    />
    {children}
  </section>
);

/** The register's verb: a rubber stamp, struck once, slightly off
 *  square, ink never quite solid. */
const Stamp: React.FC<{
  children: React.ReactNode;
  ink?: string;
  rotate?: number;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, ink = STAMP_RED, rotate = -6, size = 13, className, style }) => (
  <span
    aria-hidden="true"
    className={`pointer-events-none inline-block font-extrabold uppercase ${className ?? ''}`}
    style={{
      color: ink,
      border: `2px solid ${ink}`,
      borderRadius: 2,
      padding: '3px 8px 2px',
      fontSize: size,
      letterSpacing: '0.16em',
      lineHeight: 1.25,
      opacity: 0.85,
      transform: `rotate(${rotate}deg)`,
      backgroundColor: 'rgba(0,0,0,0.12)',
      ...style,
    }}
  >
    {children}
  </span>
);

/** A form field: label in small print, value typed on a dotted rule. */
const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({
  label,
  children,
  className,
}) => (
  <div className={className}>
    <div className="text-[11px] font-bold uppercase" style={{ color: INK_FAINT, letterSpacing: '0.14em' }}>
      {label}
    </div>
    <div
      className="mt-0.5 pb-1 text-[13px]"
      style={{ ...MONO, color: INK, borderBottom: `1px dotted ${RULE_STRONG}` }}
    >
      {children}
    </div>
  </div>
);

const fmtDay = (iso: string): string =>
  new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    .toUpperCase();

/* ---------------- 1 · the return (title sheet) ---------------- */

export const PaperTitleSheet: React.FC<{
  week: WeeklyLeaderboards['week'];
  totalPlayers: number;
  filedFor: { name: string; level: number };
}> = ({ week, totalPlayers, filedFor }) => (
  <Sheet testId="paper-title">
    <div className="px-4 pb-4 pt-4">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-extrabold uppercase" style={{ color: INK_SOFT, letterSpacing: '0.2em' }}>
          Frontier Records Office
        </span>
        <span className="text-[11px]" style={{ ...MONO, color: INK_FAINT }}>
          FORM ST-7
        </span>
      </div>
      <div className="mt-2" style={{ borderTop: `3px double ${RULE_STRONG}` }} />
      <h1 className="mt-3 text-[44px] leading-none" style={{ ...DISPLAY, color: INK }}>
        Standings Return
      </h1>
      <p className="mt-1.5 text-[12px] leading-snug" style={{ color: INK_SOFT }}>
        The week's results, filed as they stand. Compiled from verified records only — nothing here is
        estimated, and nothing is owed that is not written down.
      </p>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Week filed">
          {week.key} · {fmtDay(week.start)} – {fmtDay(week.ends_at)}
        </Field>
        <Field label="Names on register">{totalPlayers} hunters</Field>
        <Field label="Prepared for">
          {filedFor.name} · Lv {filedFor.level}
        </Field>
        <Field label="Sheets enclosed">Voucher · Heats · Ledger</Field>
      </div>
    </div>
  </Sheet>
);

/* ---------------- 2 · the pay voucher (earnings) ---------------- */

export const PayVoucher: React.FC<{
  data: WeeklyLeaderboards | null;
  onSeeRaces?: () => void;
}> = ({ data, onSeeRaces }) => {
  const state = deriveWeeklyEarnings(data);
  const prev = data?.previous_week;
  return (
    <Sheet testId="paper-voucher">
      {/* perforated tear line */}
      <div
        aria-hidden="true"
        className="flex items-center gap-2 px-4 pt-2.5"
        style={{ borderBottom: `2px dashed ${RULE}` }}
      >
        <span className="pb-2 text-[11px] font-bold uppercase" style={{ color: INK_FAINT, letterSpacing: '0.18em' }}>
          Perforated copy — settlement office
        </span>
      </div>
      <div className="relative px-4 pb-4 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[26px] leading-none" style={{ ...DISPLAY, color: INK }}>
              Pay Voucher
            </h2>
            <div className="mt-1 text-[11px] uppercase" style={{ ...MONO, color: INK_FAINT }}>
              {prev
                ? `Settlement of week ${prev.key}${prev.settled_at ? ` · settled ${fmtDay(prev.settled_at)}` : ''}`
                : 'Weekly race settlement'}
            </div>
          </div>
          <span className="text-[12px]" style={{ ...MONO, color: INK_FAINT }}>
            № {prev ? prev.key.replace('-', '') : '——'}
          </span>
        </div>

        {state.kind === 'earnings' && (
          <>
            <div className="mt-3">
              {state.rows.map((row) => (
                <div
                  key={row.raceId}
                  className="flex min-h-[44px] items-center gap-3 py-1.5"
                  style={{ borderBottom: `1px solid ${RULE}` }}
                >
                  <span className="w-10 shrink-0 text-[12px]" style={{ ...MONO, color: INK_FAINT }}>
                    № {row.reward.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold uppercase" style={{ color: INK, letterSpacing: '0.06em' }}>
                      {row.label}
                    </span>
                    {row.reward.buff_bonus > 0 && (
                      <span className="block text-[11px]" style={{ ...MONO, color: INK_SOFT }}>
                        + drop luck {Math.round(row.reward.buff_bonus * 100)}% · {row.reward.buff_hours}h endorsed
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[15px] font-bold" style={{ ...MONO, color: AMBER }}>
                    +{row.reward.cache_keys} KEYS
                  </span>
                </div>
              ))}
              <div
                className="mt-1 flex items-baseline justify-between pt-2"
                style={{ borderTop: `3px double ${RULE_STRONG}` }}
              >
                <span className="text-[11px] font-extrabold uppercase" style={{ color: INK_SOFT, letterSpacing: '0.18em' }}>
                  Total paid
                </span>
                <span className="text-[19px] font-bold" style={{ ...MONO, color: AMBER }}>
                  {state.totalCacheKeys} CACHE KEYS
                </span>
              </div>
            </div>
            <Stamp className="absolute right-4 top-[86px]" rotate={-7} size={14}>
              Paid by settlement
            </Stamp>
          </>
        )}

        {state.kind === 'placed' && (
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: INK_SOFT }}>
            No payment due on this voucher. You raced last week and finished outside the paid places —
            the sheet is filed as a record, and this week's heats are open below.
          </p>
        )}
        {state.kind === 'pending' && (
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: INK_SOFT }}>
            Last week is not yet settled. When it closes, any payment due files itself on this voucher —
            automatically, in full.
          </p>
        )}
        {state.kind === 'empty' && (
          <p className="mt-3 text-[13px] leading-relaxed" style={{ color: INK_SOFT }}>
            No races stand under your name from last week, so no voucher was drawn. This week's heat
            sheets are open below.
          </p>
        )}

        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: INK_FAINT }}>
          Race rewards pay out automatically when the week settles — no claim needed.
        </p>
        {onSeeRaces && (
          <button
            type="button"
            onClick={onSeeRaces}
            className="mt-1 flex min-h-[44px] items-center gap-2 text-[12px] font-bold uppercase"
            style={{ color: INK, letterSpacing: '0.1em' }}
          >
            This week's heat sheets
            <PxIcon name="chevD" size={13} />
          </button>
        )}
      </div>
    </Sheet>
  );
};

/* ---------------- 3 · heat sheets (races) ---------------- */

const RaceEntryLine: React.FC<{
  entry: WeeklyRaceBoard['entries'][number];
  unit: string;
  isMe: boolean;
  look?: HunterLookView | null;
  onSelect?: (playerId: string) => void;
}> = ({ entry, unit, isMe, look, onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect?.(entry.player_id)}
    className="flex min-h-[44px] w-full items-center gap-2.5 py-1 text-left"
    style={{ borderBottom: `1px solid ${RULE}` }}
  >
    <span className="w-7 shrink-0 text-right text-[13px]" style={{ ...MONO, color: INK_FAINT }}>
      {entry.rank}
    </span>
    {look && (
      <span
        className="shrink-0 p-[2px]"
        style={{ border: `1px solid ${RULE_STRONG}`, backgroundColor: '#0D0A06' }}
        data-testid={`paper-portrait-${entry.player_id}`}
      >
        <HunterPortrait look={resolveLookView(look)} className="h-8" />
      </span>
    )}
    <span className="relative min-w-0 flex-1">
      <span
        className="block truncate text-[13px] font-bold uppercase"
        style={{
          ...MONO,
          color: isMe ? INK : INK_SOFT,
          letterSpacing: '0.04em',
          ...(isMe
            ? { textDecoration: 'underline', textDecorationColor: PENCIL, textDecorationThickness: 2, textUnderlineOffset: 4 }
            : {}),
        }}
      >
        {entry.username ?? 'Vault Runner'}
      </span>
    </span>
    {isMe && (
      <span className="flex shrink-0 items-center gap-1" style={{ color: PENCIL }}>
        <PxIcon name="check" size={13} />
        <span className="text-[11px] font-extrabold uppercase" style={{ letterSpacing: '0.14em' }}>
          You
        </span>
      </span>
    )}
    <span className="shrink-0 text-[13px]" style={{ ...MONO, color: INK }}>
      {entry.value.toLocaleString()}{' '}
      <span className="text-[11px]" style={{ color: INK_FAINT }}>
        {unit}
      </span>
    </span>
  </button>
);

const HeatSheet: React.FC<{
  race: WeeklyRaceBoard;
  closed: boolean;
  myPlayerId: string;
  looks: Record<string, HunterLookView>;
  onSelectPlayer: (playerId: string) => void;
}> = ({ race, closed, myPlayerId, looks, onSelectPlayer }) => (
  <Sheet testId={`paper-race-${race.id}`}>
    <div className="relative px-4 pb-3 pt-3">
      <div className="flex items-baseline justify-between gap-3 pr-16">
        <h3 className="text-[22px] leading-none" style={{ ...DISPLAY, color: INK }}>
          {race.label}
        </h3>
        <span className="shrink-0 text-[11px] uppercase" style={{ ...MONO, color: INK_FAINT }}>
          Entries {race.participant_count}
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-snug" style={{ color: INK_SOFT }}>
        {race.blurb}
      </p>
      <div className="mt-0.5 text-[11px] uppercase" style={{ ...MONO, color: INK_FAINT }}>
        Qualifying — {race.min_qualifying_value}+ {race.unit}
      </div>
      {closed && (
        <Stamp className="absolute right-3 top-3" rotate={5} size={11} ink={INK_SOFT}>
          Final
        </Stamp>
      )}
      <div className="mt-2">
        {race.entries.map((entry) => (
          <RaceEntryLine
            key={entry.player_id}
            entry={entry}
            unit={race.unit}
            isMe={entry.player_id === myPlayerId}
            look={looks[entry.player_id]}
            onSelect={onSelectPlayer}
          />
        ))}
      </div>
      {race.me && !race.entries.some((e) => e.player_id === myPlayerId) && (
        <div
          className="flex min-h-[44px] items-center gap-2 pt-1.5 text-[12px]"
          style={{ ...MONO, color: INK_SOFT }}
        >
          <span style={{ color: PENCIL }}>
            <PxIcon name="check" size={13} />
          </span>
          Your finish — № {race.me.rank} · {race.me.value.toLocaleString()} {race.unit}, below the
          printed sheet.
        </div>
      )}
      {race.my_reward && (
        <div
          className="mt-1 flex flex-wrap items-baseline gap-x-3 pt-2 text-[12px]"
          style={{ borderTop: `3px double ${RULE_STRONG}`, ...MONO }}
        >
          <span className="font-extrabold uppercase" style={{ color: INK_FAINT, letterSpacing: '0.14em', fontFamily: "'Chakra Petch', sans-serif", fontSize: 11 }}>
            Paid on this sheet
          </span>
          <span className="font-bold" style={{ color: AMBER }}>
            {race.my_reward.cache_keys} KEYS
          </span>
          {race.my_reward.buff_bonus > 0 && (
            <span style={{ color: INK_SOFT }}>
              + drop luck {Math.round(race.my_reward.buff_bonus * 100)}% · {race.my_reward.buff_hours}h
            </span>
          )}
        </div>
      )}
    </div>
  </Sheet>
);

export const RaceSheets: React.FC<{
  data: WeeklyLeaderboards;
  myPlayerId: string;
  looks: Record<string, HunterLookView>;
  onSelectPlayer: (playerId: string) => void;
}> = ({ data, myPlayerId, looks, onSelectPlayer }) => (
  <div className="space-y-3" data-testid="paper-races">
    {data.my_drop_buff && (
      <div
        className="flex min-h-[44px] items-center px-3"
        style={{ border: `1.5px dashed ${RULE_STRONG}`, backgroundColor: 'rgba(0,0,0,0.18)' }}
        data-testid="paper-buff"
      >
        <Stamp ink={AMBER} rotate={-2} size={11}>
          Endorsement — drop luck +{Math.round(data.my_drop_buff.bonus * 100)}% in effect · expires{' '}
          {fmtDay(data.my_drop_buff.expires_at)}
        </Stamp>
      </div>
    )}
    {data.races.map((race) => (
      <HeatSheet
        key={race.id}
        race={race}
        closed={false}
        myPlayerId={myPlayerId}
        looks={looks}
        onSelectPlayer={onSelectPlayer}
      />
    ))}
    <div className="flex items-center gap-3 px-1 pt-1" aria-hidden="true">
      <span className="h-px flex-1" style={{ backgroundColor: RULE_STRONG }} />
      <span className="text-[11px] font-extrabold uppercase" style={{ color: INK_FAINT, letterSpacing: '0.18em' }}>
        Last week — closed &amp; filed · {data.previous_week.key}
        {data.previous_week.settled_at ? ` · settled ${fmtDay(data.previous_week.settled_at)}` : ''}
      </span>
      <span className="h-px flex-1" style={{ backgroundColor: RULE_STRONG }} />
    </div>
    {data.previous_week.races.map((race) => (
      <HeatSheet
        key={`prev-${race.id}`}
        race={race}
        closed
        myPlayerId={myPlayerId}
        looks={looks}
        onSelectPlayer={onSelectPlayer}
      />
    ))}
  </div>
);

/* ---------------- 4 · the ledger (global board) ---------------- */

const METRICS: { value: LeaderboardMetric; label: string }[] = [
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

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'all_time', label: 'All time' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'daily', label: 'Daily' },
];

const PLACE_STAMPS = ['1st', '2nd', '3rd'];

const LedgerRow: React.FC<{
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
  isMe: boolean;
  look?: HunterLookView | null;
  onClick?: (playerId: string) => void;
}> = ({ entry, metric, isMe, look, onClick }) => {
  const movement =
    entry.previous_value == null
      ? null
      : `${entry.trend > 0 ? '+' : ''}${Math.round(entry.trend * 100)}%`;
  const movementInk = entry.trend > 0 ? CLERK_GREEN : entry.trend < 0 ? CLERK_RED : INK_FAINT;
  return (
    <button
      type="button"
      onClick={() => onClick?.(entry.player_id)}
      className="flex min-h-[46px] w-full items-center gap-2.5 px-3 py-1 text-left"
      style={{
        borderBottom: `1px solid ${RULE}`,
        backgroundColor: isMe ? 'rgba(255,144,0,0.05)' : undefined,
      }}
    >
      <span
        className="w-8 shrink-0 self-stretch text-right text-[14px] leading-[46px]"
        style={{ ...MONO, color: entry.rank <= 3 ? INK : INK_FAINT, borderRight: `1px solid ${RULE}`, paddingRight: 10 }}
      >
        {entry.rank}
      </span>
      {look && (
        <span
          className="shrink-0 p-[2px]"
          style={{ border: `1px solid ${RULE_STRONG}`, backgroundColor: '#0D0A06' }}
          data-testid={`paper-portrait-${entry.player_id}`}
        >
          <HunterPortrait look={resolveLookView(look)} className="h-8" />
        </span>
      )}
      <span className="relative min-w-0 flex-1">
        <span
          className="block truncate text-[13px] font-bold uppercase"
          style={{
            ...MONO,
            color: isMe ? INK : INK_SOFT,
            letterSpacing: '0.04em',
            ...(isMe
              ? { textDecoration: 'underline', textDecorationColor: PENCIL, textDecorationThickness: 2, textUnderlineOffset: 4 }
              : {}),
          }}
        >
          {entry.username ?? 'Vault Runner'}
        </span>
        <span className="block text-[11px]" style={{ ...MONO, color: INK_FAINT }}>
          {movement == null ? (
            'No prior filing'
          ) : (
            <>
              <span style={{ color: movementInk }}>{movement}</span> vs prior filing
            </>
          )}
        </span>
      </span>
      {isMe && (
        <span className="flex shrink-0 items-center gap-1" style={{ color: PENCIL }}>
          <PxIcon name="check" size={13} />
          <span className="text-[11px] font-extrabold uppercase" style={{ letterSpacing: '0.14em' }}>
            You
          </span>
        </span>
      )}
      {entry.rank <= 3 && (
        <Stamp size={11} rotate={-8} className="shrink-0">
          {PLACE_STAMPS[entry.rank - 1]}
        </Stamp>
      )}
      <span className="shrink-0 text-right">
        <span className="block text-[15px] font-bold leading-tight" style={{ ...MONO, color: INK }}>
          {formatLeaderboardValue(metric, entry.value)}
        </span>
        <span className="block text-[11px] uppercase" style={{ color: INK_FAINT }}>
          {LEADERBOARD_METRIC_UNITS[metric]}
        </span>
      </span>
    </button>
  );
};

export const LedgerBoard: React.FC<{
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  onMetricChange: (metric: LeaderboardMetric) => void;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  entries: LeaderboardEntry[];
  myPlayerId: string;
  myRank: MyLeaderboardRank | null;
  myUsername: string;
  looks: Record<string, HunterLookView>;
  totalPlayers: number;
  onRowClick: (playerId: string) => void;
}> = ({
  metric,
  period,
  onMetricChange,
  onPeriodChange,
  entries,
  myPlayerId,
  myRank,
  myUsername,
  looks,
  totalPlayers,
  onRowClick,
}) => {
  const metricLabel = METRICS.find((m) => m.value === metric)?.label ?? '';
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? '';
  const mineShown = entries.some((e) => e.player_id === myPlayerId);
  return (
    <div data-testid="paper-ledger">
      {/* file-folder tabs: the metric IS the folder this sheet lives in */}
      <div className="flex overflow-x-auto px-2" role="tablist" aria-label="Ledger metric">
        {METRICS.map((m) => {
          const active = m.value === metric;
          return (
            <button
              key={m.value}
              role="tab"
              aria-selected={active}
              onClick={() => onMetricChange(m.value)}
              className="min-h-[44px] shrink-0 whitespace-nowrap px-3.5 text-[12px] font-extrabold uppercase"
              style={{
                letterSpacing: '0.1em',
                color: active ? INK : INK_FAINT,
                backgroundColor: active ? STOCK : STOCK_DEEP,
                border: `1px solid ${RULE_STRONG}`,
                borderBottom: 'none',
                borderRadius: '7px 7px 0 0',
                marginRight: 3,
                transform: 'translateY(1px)',
                zIndex: active ? 2 : 1,
              }}
            >
              {m.label}
            </button>
          );
        })}
      </div>
      <Sheet testId="paper-ledger-sheet" style={{ borderRadius: 0 }}>
        <div className="px-4 pb-2 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[26px] leading-none" style={{ ...DISPLAY, color: INK }}>
              The Ledger — {metricLabel}
            </h2>
            <span className="text-[11px] uppercase" style={{ ...MONO, color: INK_FAINT }}>
              Register of {totalPlayers}
            </span>
          </div>
          {/* the clerk's period line: tick one box */}
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1" role="radiogroup" aria-label="Ledger period">
            <span className="text-[11px] font-bold uppercase" style={{ color: INK_FAINT, letterSpacing: '0.14em' }}>
              Period —
            </span>
            {PERIODS.map((p) => {
              const active = p.value === period;
              return (
                <button
                  key={p.value}
                  role="radio"
                  aria-checked={active}
                  onClick={() => onPeriodChange(p.value)}
                  className="flex min-h-[44px] items-center gap-2 text-[12px] font-bold uppercase"
                  style={{ ...MONO, color: active ? INK : INK_FAINT, letterSpacing: '0.06em' }}
                >
                  <span
                    className="flex h-[15px] w-[15px] items-center justify-center"
                    style={{ border: `1.5px solid ${active ? INK : INK_FAINT}`, color: PENCIL }}
                  >
                    {active && <PxIcon name="check" size={13} />}
                  </span>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div
            className="mt-1 flex items-center gap-2.5 px-0 text-[11px] font-bold uppercase"
            style={{ ...MONO, color: INK_FAINT, letterSpacing: '0.12em' }}
            aria-hidden="true"
          >
            <span className="w-8 text-right">№</span>
            <span className="flex-1">Hunter, as filed</span>
            <span>{LEADERBOARD_METRIC_UNITS[metric]}</span>
          </div>
        </div>
        <div>
          {entries.map((entry) => (
            <LedgerRow
              key={entry.player_id}
              entry={entry}
              metric={metric}
              isMe={entry.player_id === myPlayerId}
              look={looks[entry.player_id]}
              onClick={onRowClick}
            />
          ))}
          {entries.length === 0 && (
            <p className="px-4 py-6 text-[13px]" style={{ color: INK_SOFT }}>
              No filings under this heading yet. The page stays blank until the first record lands.
            </p>
          )}
        </div>
        <div className="px-4 py-3 text-[11px]" style={{ color: INK_FAINT }}>
          Filed under {metricLabel} · {periodLabel}. Movement is measured against the prior filing of
          the same book — never estimated.
        </div>
      </Sheet>
      {/* appended slip: my standing when the printed page runs out
          before it reaches me — the same record, pinned to the foot */}
      {myRank && !mineShown && (
        <div
          className="relative mx-2 mt-3 px-4 py-3"
          data-testid="paper-appended-slip"
          style={{
            backgroundColor: STOCK,
            border: `1px solid ${RULE_STRONG}`,
            borderTop: `2px dashed ${RULE_STRONG}`,
            boxShadow: '0 8px 18px rgba(0,0,0,0.45)',
            transform: 'rotate(-0.6deg)',
          }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[11px] font-extrabold uppercase" style={{ color: INK_FAINT, letterSpacing: '0.16em' }}>
              Appended slip — your standing
            </span>
            <Stamp size={11} rotate={4} ink={INK_SOFT}>
              Filed
            </Stamp>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3" style={MONO}>
            <span className="text-[17px] font-bold" style={{ color: INK }}>
              № {myRank.rank}
            </span>
            <span
              className="text-[13px] font-bold uppercase"
              style={{
                color: INK,
                textDecoration: 'underline',
                textDecorationColor: PENCIL,
                textDecorationThickness: 2,
                textUnderlineOffset: 4,
              }}
            >
              {myUsername}
            </span>
            <span className="text-[13px]" style={{ color: INK_SOFT }}>
              {formatLeaderboardValue(metric, myRank.value)} {LEADERBOARD_METRIC_UNITS[metric]} · of{' '}
              {myRank.total_players} hunters
            </span>
          </div>
          <p className="mt-1 text-[11px]" style={{ color: INK_FAINT }}>
            The printed page ends above; the register does not. This slip is the same record, appended
            so your line is never lost.
          </p>
        </div>
      )}
    </div>
  );
};
