/**
 * ProfilePaperwork — PROTOTYPE (design/hunter-subpages-profile-d,
 * 2026-11-05). NOT shipped UI: Variant D ("Field paperwork") for the
 * Profile & Record stop, built under the `impeccable` skill with
 * full design authority inside the D register.
 *
 * Where Variant A engraved the career onto machined plates, D files
 * it: the Profile stop becomes the hunter's PERSONNEL FILE in a
 * frontier registry office. The identity panel is the file's COVER
 * SHEET (Form PF-24) — name typed on the form, handle and level as
 * filed lines, experience as twenty ruled boxes inked one by one,
 * the Trophy Shelf filed inside as Exhibit 1. Totals & Sources is
 * Schedule T, a requisition line the clerk examines. The career
 * record is Schedule A, a ledger of ruled lines in four
 * sub-schedules; the combat record is Schedule B, its ratio typed
 * large and its shares punched as tallies in red ink.
 *
 * Content discipline matches A's audit of the shipped page: every
 * lifetime number prints exactly once (the shipped page printed
 * kills/deaths/K-D three times and the collection counts twice —
 * the Collection Patch and Field Stats cards are folded into the
 * schedules and die), and every row keeps the shipped page's exact
 * StatDetailPanel payload, tappability, and null conventions. The
 * two stat sources are never mixed: Schedules A/B read the
 * /stats/me summary, exactly as the StatCards they replace did;
 * the server-folded LifetimeStatsPanel below stays untouched.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import type { PlayerPublicStats } from '@/lib/api/statsService';
import type { ProgressionMetric } from '@/lib/api/progressionService';
import type { LeaderboardMetric } from '@/lib/api/leaderboardService';
import { formatDuration, type NamedCount } from '@/lib/stats/statsHelpers';
import {
  CheckStrip,
  DoubleRule,
  FormLine,
  GroupHead,
  HairRule,
  InkStamp,
  LedgerRow,
  PaperSheet,
  RecordNo,
  ScheduleHead,
  TallyRow,
} from './profilePaperwork/paperKit';
import {
  AMBER,
  clerkDay,
  displayStyle,
  INK,
  INK_FAINT,
  INK_MUTED,
  monoStyle,
  paperSheet,
  STAMP_RED,
} from './profilePaperwork/paperTokens';

export interface ProfileDetailPayload {
  metric: ProgressionMetric;
  leaderboardMetric?: LeaderboardMetric;
  label: string;
  value: number;
  color: string;
}

const num = (n: number) => n.toLocaleString('en-US');

/* ── The cover sheet ──────────────────────────────────────────── */

export const ProfileFileCover: React.FC<{
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  handle: string | null;
  canEditHandle: boolean;
  onRename: () => void;
  onSetup: () => void;
  joinedAt?: string | null;
  children: React.ReactNode;
}> = ({ name, level, xp, xpToNext, xpProgress, handle, canEditHandle, onRename, onSetup, joinedAt, children }) => (
  <PaperSheet testId="profile-file-cover">
    <div
      className="flex items-baseline justify-between gap-2 font-bold uppercase"
      style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.12em' }}
    >
      <span>Frontier Registry · Personnel File</span>
      <span>Form PF-24</span>
    </div>
    <DoubleRule className="mt-2" />

    <div className="relative mt-3">
      <div
        className="font-bold uppercase"
        style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}
      >
        Name of Hunter
      </div>
      <div
        className="break-words uppercase"
        style={{ ...displayStyle, color: INK, fontSize: 34, lineHeight: 1.08, paddingRight: 118 }}
      >
        {name}
      </div>
      <div className="absolute right-0 top-4">
        <InkStamp color={INK} rotate={-4}>
          Record Current
        </InkStamp>
      </div>
    </div>

    <div className="mt-1.5 flex flex-wrap items-center gap-x-2">
      {handle ? (
        <>
          <span className="font-bold" style={{ ...monoStyle, color: AMBER, fontSize: 13 }}>
            @{handle}
          </span>
          {canEditHandle && (
            <button
              type="button"
              onClick={onRename}
              className="-my-2 px-1 py-2 underline"
              style={{ ...monoStyle, color: INK_FAINT, fontSize: 11 }}
            >
              Rename
            </button>
          )}
        </>
      ) : (
        <>
          <span style={{ ...monoStyle, color: INK_MUTED, fontSize: 12 }}>No handle set</span>
          {canEditHandle && (
            <button
              type="button"
              onClick={onSetup}
              className="-my-2 px-1 py-2 underline"
              style={{ ...monoStyle, color: AMBER, fontSize: 11 }}
            >
              Set username
            </button>
          )}
        </>
      )}
      <span aria-hidden="true" className="min-w-[12px] flex-1" style={{ borderBottom: `1px dotted ${INK_FAINT}` }} />
      <span className="font-bold" style={{ ...monoStyle, color: INK_MUTED, fontSize: 12 }}>
        LEVEL {level}
      </span>
    </div>

    <div className="mt-3 space-y-1.5">
      {joinedAt && <FormLine label="File Opened" value={clerkDay(joinedAt)} />}
      <FormLine label="Experience" value={`${num(xp)} / ${num(xpToNext)} XP · ${xpProgress}%`} />
    </div>
    <div className="mt-2">
      <CheckStrip fraction={xpProgress / 100} color={INK} />
      <div className="mt-1 font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.08em' }}>
        Twenty boxes to the next level — inked as earned
      </div>
    </div>

    <DoubleRule className="mt-3.5" />
    <div className="mt-2.5 flex items-baseline gap-2">
      <RecordNo>EXHIBIT 1</RecordNo>
      <span className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.08em' }}>
        Filed with this record
      </span>
    </div>
    <div className="mt-2">{children}</div>
  </PaperSheet>
);

/* ── The unspent-points endorsement slip ──────────────────────── */

export const PointsFilingSlip: React.FC<{
  points: number;
  onOpenTrees: () => void;
}> = ({ points, onOpenTrees }) => (
  <button
    type="button"
    onClick={onOpenTrees}
    data-testid="profile-points-slip"
    className="block w-full text-left transition-transform active:scale-[0.99]"
    style={{
      ...paperSheet,
      background: 'linear-gradient(172deg, #241A0E 0%, #1B130A 58%, #140E07 100%)',
    }}
  >
    <div className="flex items-center gap-3 px-3.5 py-3">
      <InkStamp color={AMBER} rotate={-3}>
        Unfiled
      </InkStamp>
      <div className="min-w-0 flex-1">
        <div className="font-bold" style={{ ...monoStyle, color: INK, fontSize: 13 }}>
          {points} skill {points === 1 ? 'point' : 'points'} await filing
        </div>
        <div style={{ ...monoStyle, color: INK_MUTED, fontSize: 11 }}>
          Earned with your levels — unspent until filed
        </div>
      </div>
      <span className="font-bold uppercase" style={{ ...monoStyle, color: AMBER, fontSize: 11, letterSpacing: '0.1em' }}>
        File
      </span>
      <PxIcon name="chevR" size={13} className="shrink-0 text-amber" />
    </div>
  </button>
);

/* ── Schedule T — the Totals & Sources door ───────────────────── */

export const TotalsScheduleDoor: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    data-testid="profile-totals-sources-door"
    className="block w-full text-left transition-transform active:scale-[0.99]"
    style={paperSheet}
  >
    <div className="px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <RecordNo>SCHEDULE T</RecordNo>
        <span className="shrink-0 uppercase" style={{ ...displayStyle, color: INK, fontSize: 19, lineHeight: 1 }}>
          Totals &amp; Sources
        </span>
        <span aria-hidden="true" className="min-w-[10px] flex-1" style={{ borderTop: '1px solid #7A7060' }} />
        <span className="font-bold uppercase" style={{ ...monoStyle, color: AMBER, fontSize: 11, letterSpacing: '0.1em' }}>
          Examine
        </span>
        <PxIcon name="chevR" size={13} className="shrink-0 text-amber" />
      </div>
      <div className="mt-1" style={{ ...monoStyle, color: INK_MUTED, fontSize: 11, lineHeight: 1.45 }}>
        Every effective stat for your current build — and exactly where each number comes from
      </div>
    </div>
  </button>
);

/* ── Schedule A — the service record ──────────────────────────── */

export const CareerSchedule: React.FC<{
  stats: PlayerPublicStats | null;
  playerLevel: number;
  playerXp: number;
  credits: number;
  scrap: number;
  totalItems: number;
  weaponsCount: number;
  uniqueAffixes: number;
  favoriteType: string | null;
  onDetail: (payload: ProfileDetailPayload) => void;
}> = ({ stats, playerLevel, playerXp, credits, scrap, totalItems, weaponsCount, uniqueAffixes, favoriteType, onDetail }) => {
  const level = stats?.player_level ?? playerLevel;
  const xp = stats?.player_xp ?? playerXp;
  const masteryXp = stats?.total_mastery_xp ?? 0;
  const highestMastery = stats?.highest_mastery_level ?? 0;
  const netWorth = stats?.net_worth ?? 0;
  const items = stats?.total_items ?? totalItems;
  const weapons = stats?.weapons_owned ?? weaponsCount;
  const legendaries = stats?.legendary_items ?? 0;
  return (
    <PaperSheet testId="profile-schedule-career">
      <ScheduleHead
        no="SCHEDULE A"
        title="Service Record"
        right={
          <span className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.08em' }}>
            Lifetime figures
          </span>
        }
      />
      <DoubleRule className="mt-2" />

      <GroupHead className="mt-3">A-1 · Hunter</GroupHead>
      <div>
        <LedgerRow
          label="Hunter Level"
          value={num(level)}
          onClick={() => onDetail({ metric: 'level', leaderboardMetric: 'level', label: 'Hunter Level', value: level, color: '#FF9000' })}
        />
        <HairRule />
        <LedgerRow
          label="Hunter XP"
          value={num(xp)}
          onClick={() => onDetail({ metric: 'xp', leaderboardMetric: 'xp', label: 'Hunter XP', value: xp, color: '#FF9000' })}
        />
      </div>

      <GroupHead className="mt-3.5">A-2 · Masteries</GroupHead>
      <div>
        <LedgerRow
          label="Mastery XP (all tracks)"
          value={num(masteryXp)}
          onClick={() => onDetail({ metric: 'total_mastery_xp', leaderboardMetric: 'total_mastery_xp', label: 'Mastery XP (all tracks)', value: masteryXp, color: '#7CFC00' })}
        />
        <HairRule />
        <LedgerRow
          label="Highest Mastery Lv"
          value={num(highestMastery)}
          onClick={() => onDetail({ metric: 'highest_mastery_level', leaderboardMetric: 'highest_mastery_level', label: 'Highest Mastery Level', value: highestMastery, color: '#7CFC00' })}
        />
      </div>

      <GroupHead className="mt-3.5">A-3 · Economy</GroupHead>
      <div>
        <LedgerRow
          label="Net Worth"
          value={num(netWorth)}
          onClick={() => onDetail({ metric: 'net_worth', leaderboardMetric: 'net_worth', label: 'Net Worth', value: netWorth, color: '#7CFC00' })}
        />
        <HairRule />
        <LedgerRow
          label="Credits"
          value={num(credits)}
          onClick={() => onDetail({ metric: 'credits', label: 'Credits', value: credits, color: '#5AA7FF' })}
        />
        <HairRule />
        <LedgerRow
          label="Scrap"
          value={num(scrap)}
          onClick={() => onDetail({ metric: 'scrap', label: 'Scrap', value: scrap, color: '#A855F7' })}
        />
      </div>

      <GroupHead className="mt-3.5">A-4 · Collection</GroupHead>
      <div>
        <LedgerRow
          label="Items"
          value={num(items)}
          onClick={() => onDetail({ metric: 'total_items', leaderboardMetric: 'total_items', label: 'Total Items', value: items, color: '#FFEA3A' })}
        />
        <HairRule />
        <LedgerRow label="Weapons" value={num(weapons)} />
        <HairRule />
        <LedgerRow
          label="Legendaries"
          value={num(legendaries)}
          valueColor={AMBER}
          onClick={() => onDetail({ metric: 'legendary_items', leaderboardMetric: 'legendary_items', label: 'Legendary Items', value: legendaries, color: '#FFEA3A' })}
        />
        <HairRule />
        <LedgerRow label="Highest Item Level" value={stats ? num(stats.highest_item_level) : '—'} />
        <HairRule />
        <LedgerRow label="Unique Affixes" value={num(uniqueAffixes)} />
        <HairRule />
        <LedgerRow label="Favorite Type" value={favoriteType ?? 'None'} valueColor={AMBER} />
      </div>
    </PaperSheet>
  );
};

/* ── Schedule B — the combat record ───────────────────────────── */

export const CombatSchedule: React.FC<{
  stats: PlayerPublicStats | null;
  kdText: string;
  kdRatio: number | null;
  topAreas: NamedCount[];
  topWeaponTypes: NamedCount[];
  onDetail: (payload: ProfileDetailPayload) => void;
}> = ({ stats, kdText, kdRatio, topAreas, topWeaponTypes, onDetail }) => {
  const kills = stats?.total_kills ?? 0;
  const deaths = stats?.total_deaths ?? 0;
  const bossTier = stats?.highest_boss_tier ?? 0;
  const share = (count: number) => (kills > 0 ? count / kills : 0);
  return (
    <PaperSheet testId="profile-schedule-combat">
      <ScheduleHead
        no="SCHEDULE B"
        title="Combat Record"
        stamp={
          <InkStamp color={STAMP_RED} rotate={-4}>
            Field Verified
          </InkStamp>
        }
      />
      <DoubleRule className="mt-2" />

      {/* The ratio is the schedule's headline figure — typed large
          ONCE (the shipped page printed it three times). The
          headline itself carries the shipped K/D card's detail
          payload, so the tap survives the filing. */}
      <button
        type="button"
        onClick={() => onDetail({ metric: 'total_kills', leaderboardMetric: 'kdr', label: 'Kill / Death Ratio', value: kdRatio ?? 0, color: '#FF4B5C' })}
        className="mt-1 flex min-h-[44px] w-full items-end justify-between gap-3 text-left"
      >
        <div className="pb-0.5">
          <div className="font-bold uppercase" style={{ ...monoStyle, color: INK_FAINT, fontSize: 11, letterSpacing: '0.1em' }}>
            Kill / Death Ratio
          </div>
          <div className="mt-0.5" style={{ ...monoStyle, color: INK_MUTED, fontSize: 11 }}>
            Kills ÷ deaths, as filed in the lines below
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span style={{ ...displayStyle, color: INK, fontSize: 42, lineHeight: 0.95 }}>{kdText}</span>
          <PxIcon name="chevR" size={12} className="shrink-0 self-center opacity-50" />
        </div>
      </button>
      <HairRule className="mt-2" />

      <div>
        <LedgerRow
          label="Kills"
          value={num(kills)}
          onClick={() => onDetail({ metric: 'total_kills', leaderboardMetric: 'total_kills', label: 'Kills', value: kills, color: '#FF4B5C' })}
        />
        <HairRule />
        <LedgerRow label="Deaths" value={num(deaths)} />
        <HairRule />
        <LedgerRow label="Best Streak" value={num(stats?.longest_kill_streak ?? 0)} />
        <HairRule />
        <LedgerRow
          label="Highest Boss Tier"
          value={num(bossTier)}
          onClick={() => onDetail({ metric: 'highest_boss_tier', leaderboardMetric: 'highest_boss_tier', label: 'Highest Boss Tier', value: bossTier, color: '#FF4B5C' })}
        />
        <HairRule />
        <LedgerRow label="Active Field Time" value={formatDuration(stats?.active_play_seconds ?? 0)} />
        <HairRule />
        <LedgerRow label="Idle Time" value={formatDuration(stats?.idle_play_seconds ?? 0)} />
      </div>

      <GroupHead className="mt-3.5">B-1 · Kills by Area — Top Three</GroupHead>
      {topAreas.length === 0 ? (
        <div className="py-2" style={{ ...monoStyle, color: INK_MUTED, fontSize: 11 }}>
          No data yet.
        </div>
      ) : (
        <div className="mt-2 space-y-2.5">
          {topAreas.map((a) => (
            <TallyRow key={a.name} name={a.name} count={a.count} fraction={share(a.count)} color={STAMP_RED} />
          ))}
        </div>
      )}

      <GroupHead className="mt-3.5">B-2 · Kills by Weapon — Top Three</GroupHead>
      {topWeaponTypes.length === 0 ? (
        <div className="py-2" style={{ ...monoStyle, color: INK_MUTED, fontSize: 11 }}>
          No data yet.
        </div>
      ) : (
        <div className="mt-2 space-y-2.5">
          {topWeaponTypes.map((t) => (
            <TallyRow key={t.name} name={t.name} count={t.count} fraction={share(t.count)} color={STAMP_RED} />
          ))}
        </div>
      )}
    </PaperSheet>
  );
};
