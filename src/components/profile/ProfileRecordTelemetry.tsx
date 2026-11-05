/**
 * ProfileRecordTelemetry — the Profile & Record stop rebuilt in
 * Register B, "Service Telemetry" (Instrument Panel; owner pick
 * from the Hunter sub-page review PDF, 2026-11-05; prototype:
 * design/hunter-subpages-profile-b).
 *
 * The career as a machine's service telemetry: identity on flat
 * console glass with status lamps and an LCD bank, combat output
 * as distribution channels with exact counts, and the lifetime
 * record as one grouped readout bank. Every number prints exactly
 * once — the retired stat-card grid, Field Stats, Combat Breakdown
 * and Collection Patch cards all re-printed numbers that live here
 * now (kills/deaths printed three times on the old stop). The
 * per-metric Totals drill-down those cards carried rides the
 * wells and readout rows instead (same StatDetailPanel payloads).
 *
 * Data is the shipped page's own: the /stats/me summary
 * (PlayerPublicStats) for the combat head and economy wells, the
 * player store for the live balances, and GET /api/profile/stats
 * (fetchProfileLifetime) folded server-side for the channels and
 * the career bank — this component formats; it computes nothing
 * and invents nothing, and a stat with no server record is not
 * shown rather than estimated (the LifetimeStatsPanel discipline).
 */
import React, { useEffect, useState } from 'react';
import { fetchProfileLifetime, type ProfileLifetimePayload } from '@/lib/api/verifiedOps';
import type { PlayerPublicStats } from '@/lib/api/statsService';
import type { ProgressionMetric } from '@/lib/api/progressionService';
import type { LeaderboardMetric } from '@/lib/api/leaderboardService';
import { NAMED_ELITES, COLLECTION_TOTAL } from '@/content/collections';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import { ELEMENTS } from '@/constants/elements';
import { Element } from '@/types/game';
import { consumableDisplayName } from '@/lib/market/identityKey';
import { resolveSceneLabel } from '@/lib/dashboard/sceneLabel';
import {
  TM_AMBER,
  TM_CYAN,
  TM_FAINT,
  TM_GOLD,
  TM_GREEN,
  TM_INK,
  TM_MUT,
  TM_RED,
  TM_STEEL,
  tmDisplayStyle,
  tmMonoStyle,
} from './profileTelemetryTheme';
import {
  TmChannelRow,
  TmGroupDatum,
  TmLcdWell,
  TmLed,
  TmLedMeter,
  TmPanel,
  TmPanelLabel,
  TmPushButton,
  TmReadoutRow,
} from './profileTelemetry';

export interface ProfileDetailRequest {
  metric: ProgressionMetric;
  leaderboardMetric?: LeaderboardMetric;
  label: string;
  value: number;
  color: string;
}

export interface ProfileRecordTelemetryProps {
  /** Identity (player store — the same source the old identity panel read). */
  name: string;
  level: number;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  credits: number;
  scrap: number;
  cacheKeys: number;
  /** '@handle' when set, null when the hunter has no handle yet. */
  handle: string | null;
  canRename: boolean;
  canSetUsername: boolean;
  onRename: () => void;
  onSetUsername: () => void;
  /** Account status line ('Verified account' / 'Guest account' / …). */
  verifiedLabel: string;
  accountVerified: boolean;
  /** Overall research studied percent (completed / total courses), null until the Chef state loads. */
  researchStudiedPct: number | null;
  /** The active enrollment for the channel note, null when not enrolled. */
  researchActive: { courseLabel: string; progressPct: number } | null;
  treeSpent: Array<{ label: string; spent: number }>;
  availableSkillPoints: number;
  onOpenTrees: () => void;
  /** The /stats/me summary; null until it answers. */
  stats: PlayerPublicStats | null;
  kdText: string;
  kdRatio: number | null;
  deathLog: Array<{ monsterName: string; areaId: string; at: string }>;
  /** Collection facts the old Collection Patch card derived from the live inventory. */
  totalItemsFallback: number;
  weaponsCountFallback: number;
  uniqueAffixes: number;
  favoriteType: string | null;
  openDetail: (payload: ProfileDetailRequest) => void;
}

/* ─── Lifetime payload shaping (the LifetimeStatsPanel discipline) ── */

const fmt = (n: number): string => (n ?? 0).toLocaleString('en-US');

const SOURCE_LABELS: Record<string, string> = {
  roaming_drop: 'Roaming drops',
  offline_drop: 'Offline hauls',
  boss_loot: 'Boss loot',
  cache_forge: 'Cache-forged',
  market_purchase: 'Market finds',
  endless_milestone: 'Endless milestones',
  salvage: 'Proven by salvage',
};

const AREA_NAMES = new Map(ROAMING_AREAS.map((a) => [a.id, a.name]));
const WEAPON_TYPE_NAMES = new Map<string, string>(Object.values(WEAPON_TYPES).map((t) => [t.id as string, t.name]));
const ELEMENT_NAMES = new Map<string, string>(Object.values(ELEMENTS).map((e) => [e.id as string, e.name]));
const ELEMENT_COLORS = new Map<string, string>(Object.values(ELEMENTS).map((e) => [e.id as string, e.color]));

/** Kill maps key Fire as 'incendiary'; the element table keys it by its enum id. */
const ELEMENT_KEY_ALIAS: Record<string, string> = {
  incendiary: String(Element.Fire),
};

function sortedEntries(map: Record<string, number> | null | undefined): Array<[string, number]> {
  return Object.entries(map ?? {})
    .map(([key, count]) => [key, count ?? 0] as [string, number])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * A partial payload must render a partial record, never blank the
 * screen: older Chef builds omit whole blocks — every section is
 * filled with its empty shape before anything reads it.
 */
function withLifetimeDefaults(data: ProfileLifetimePayload): ProfileLifetimePayload {
  return {
    kills: {
      roaming: 0, elites: 0, named_elites_downed: 0,
      by_area: {}, by_weapon_type: {}, by_element: {},
      ...(data.kills ?? {}),
    },
    deaths: data.deaths ?? 0,
    credits: { earned: 0, spent: 0, since: null, ...(data.credits ?? {}) },
    bosses: { attempts: 0, victories: 0, downed: 0, by_boss: {}, ...(data.bosses ?? {}) },
    endless: { runs: 0, best_depth: 0, deaths: 0, banked: 0, abandoned: 0, ...(data.endless ?? {}) },
    legendaries: {
      salvaged: 0, cores_minted: 0, cores_spent: 0, cores_balance: 0,
      discoveries_by_source: {}, ...(data.legendaries ?? {}),
    },
    caches: { opened: 0, rewarded_keys: 0, ...(data.caches ?? {}) },
    crafting: { total_units: 0, units_by_kind: {}, ...(data.crafting ?? {}) },
    consumables: {
      used_total: 0, ...(data.consumables ?? {}),
      top_used: data.consumables?.top_used ?? [],
    },
    repair: {
      board_points_restored: 0, board_jobs_completed: 0, board_credits_earned: 0,
      self_points_restored: 0, self_jobs: 0, ...(data.repair ?? {}),
    },
    dispatch: { completed: 0, foot: 0, courier: 0, credits_earned: 0, ...(data.dispatch ?? {}) },
    extraction: { passes: 0, xp_awarded: 0, ...(data.extraction ?? {}) },
    market: {
      sales: 0, sales_volume: 0, fees_paid: 0, purchases: 0, purchases_volume: 0,
      ...(data.market ?? {}),
    },
    salvage: { items: 0, scrap_earned: 0, ...(data.salvage ?? {}) },
    reforges: data.reforges ?? 0,
    resurrections: data.resurrections ?? 0,
    collections: { discovered: 0, by_family: {}, ...(data.collections ?? {}) },
    showcase: {
      top_weapons: [], best_endless_depth: 0, cache_rank_tokens: 0,
      cache_rank_total_ranks: 0, collections_discovered: 0, ...(data.showcase ?? {}),
    },
  };
}

const shareSegs = (value: number, total: number, segs = 20): number =>
  value <= 0 || total <= 0 ? 0 : Math.max(1, Math.min(segs, Math.round((value / total) * segs)));

const channelTotal = (entries: Array<[string, number]>): number => entries.reduce((s, [, v]) => s + v, 0);

const hours = (seconds: number): string => `${Math.round((seconds ?? 0) / 3600)} H`;

const daysAgo = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  return days === 0 ? 'TODAY' : days === 1 ? '1D AGO' : `${days}D AGO`;
};

/* ─── The record ──────────────────────────────────────────────── */

export const ProfileRecordTelemetry: React.FC<ProfileRecordTelemetryProps> = (props) => {
  const { stats, openDetail } = props;
  const [lifetime, setLifetime] = useState<ProfileLifetimePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProfileLifetime()
      .then((payload) => {
        if (!cancelled) setLifetime(payload);
      })
      .catch(() => {
        // Chef unreachable: the channels and career bank stay hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const safe = lifetime ? withLifetimeDefaults(lifetime) : null;
  const weaponKills = safe ? sortedEntries(safe.kills.by_weapon_type) : [];
  const elementKills = safe ? sortedEntries(safe.kills.by_element) : [];
  const areaKills = safe ? sortedEntries(safe.kills.by_area) : [];
  const legendarySources = safe ? sortedEntries(safe.legendaries.discoveries_by_source) : [];
  const craftKinds = safe ? sortedEntries(safe.crafting.units_by_kind).slice(0, 4) : [];
  const creditsSinceDate = safe?.credits.since ? new Date(safe.credits.since) : null;
  const creditsSince = creditsSinceDate && !Number.isNaN(creditsSinceDate.getTime())
    ? creditsSinceDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const lastDeath = props.deathLog[0] ?? null;
  const enlisted = stats?.joined_at ? stats.joined_at.slice(0, 10) : null;

  return (
    <>
      {/* ── UNIT IDENTIFICATION ─────────────────────────────── */}
      <TmPanel testId="profile-unit-panel">
        <TmPanelLabel label="Unit Identification" right="Service Record · Live" rightColor={TM_GREEN} />
        <div className="truncate leading-none" style={{ ...tmDisplayStyle, color: TM_INK, fontSize: 34 }}>
          {props.name}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[12px]" style={{ ...tmMonoStyle, color: TM_MUT }}>
          {props.handle ? (
            <>
              <span className="font-bold">{props.handle}</span>
              {props.canRename && (
                <button type="button" onClick={props.onRename} className="text-[11px] underline hover:text-amber">
                  Rename
                </button>
              )}
            </>
          ) : (
            <>
              <span>No handle set</span>
              {props.canSetUsername && (
                <button type="button" onClick={props.onSetUsername} className="underline hover:text-amber" style={{ color: TM_AMBER }}>
                  Set username
                </button>
              )}
            </>
          )}
          {enlisted && (
            <>
              <span aria-hidden="true">·</span>
              <span>ENLISTED {enlisted}</span>
            </>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5">
          <span className="flex items-center gap-1.5">
            <TmLed lit={props.accountVerified} color={props.accountVerified ? TM_GREEN : TM_AMBER} size={8} />
            <span className="text-[11px] font-bold uppercase" style={{ ...tmMonoStyle, color: TM_MUT }}>
              {props.verifiedLabel}
            </span>
          </span>
          {props.researchStudiedPct !== null && (
            <span className="flex items-center gap-1.5">
              <TmLed lit color={TM_CYAN} size={8} />
              <span className="text-[11px] font-bold uppercase" style={{ ...tmMonoStyle, color: TM_MUT }}>
                Research {props.researchStudiedPct}% Studied
              </span>
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <TmLcdWell
            value={String(props.level)}
            label="Level"
            valueSize={20}
            onClick={() => openDetail({ metric: 'level', leaderboardMetric: 'level', label: 'Hunter Level', value: stats?.player_level ?? props.level, color: '#FF9000' })}
          />
          <TmLcdWell
            value={fmt(props.credits)}
            label="Credits"
            valueSize={15}
            onClick={() => openDetail({ metric: 'credits', label: 'Credits', value: props.credits, color: '#5AA7FF' })}
          />
          <TmLcdWell
            value={fmt(props.scrap)}
            label="Scrap"
            valueSize={15}
            onClick={() => openDetail({ metric: 'scrap', label: 'Scrap', value: props.scrap, color: '#A855F7' })}
          />
          <TmLcdWell value={String(props.cacheKeys)} label="Cache Keys" valueSize={20} color={TM_GOLD} />
        </div>

        <div className="mt-3">
          <button
            type="button"
            aria-label="Hunter XP: open the breakdown"
            onClick={() => openDetail({ metric: 'xp', leaderboardMetric: 'xp', label: 'Hunter XP', value: stats?.player_xp ?? props.xp, color: '#FF9000' })}
            className="block w-full text-left"
          >
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[11px] font-bold uppercase" style={{ ...tmMonoStyle, color: TM_FAINT, letterSpacing: '0.12em' }}>
                Level Progress
              </span>
              <span className="text-[12px] font-bold" style={{ ...tmMonoStyle, color: TM_INK }}>
                {fmt(props.xp)} / {fmt(props.xpToNext)} XP · {props.xpProgress}%
              </span>
            </div>
            <TmLedMeter filled={shareSegs(props.xp, props.xpToNext)} total={20} color={TM_GOLD} height={13} label={`Level progress ${props.xpProgress}%`} />
          </button>
          {props.researchActive && (
            <div className="mt-1.5 text-[11px] uppercase" style={{ ...tmMonoStyle, color: TM_FAINT }}>
              Research in session — {props.researchActive.courseLabel} · {props.researchActive.progressPct}% studied
            </div>
          )}
        </div>

        <div className="mt-3">
          <TmPushButton
            label={props.availableSkillPoints > 0 ? `Spend ${props.availableSkillPoints} Skill Points` : 'Skill Trees'}
            sub={props.treeSpent.map((t) => `${t.label} ${t.spent}`).join(' · ')}
            ledColor={TM_AMBER}
            accent={TM_AMBER}
            onClick={props.onOpenTrees}
            testId="profile-points-door"
          />
        </div>
      </TmPanel>

      {/* The lifetime wrapper keeps the record's historic testid:
          combat channels + career bank are one server-folded
          record, rendered only when the Chef answers. */}
      <div data-testid="lifetime-stats" className="space-y-4">
        {/* ── COMBAT TELEMETRY ──────────────────────────────── */}
        <TmPanel testId="profile-combat-panel">
          <TmPanelLabel label="Combat Telemetry" right="All-Time Output" />
          <TmLcdWell
            value={props.kdText}
            label="Kill / Death Ratio"
            valueSize={36}
            color={TM_GOLD}
            onClick={() => openDetail({ metric: 'total_kills', leaderboardMetric: 'kdr', label: 'Kill / Death Ratio', value: props.kdRatio ?? 0, color: '#FF4B5C' })}
          />
          <div className="mt-1.5 grid grid-cols-4 gap-1.5">
            <TmLcdWell
              value={fmt(stats?.total_kills ?? 0)}
              label="Kills"
              valueSize={15}
              onClick={() => openDetail({ metric: 'total_kills', leaderboardMetric: 'total_kills', label: 'Kills', value: stats?.total_kills ?? 0, color: '#FF4B5C' })}
            />
            <TmLcdWell value={fmt(stats?.total_deaths ?? 0)} label="Deaths" valueSize={15} />
            <TmLcdWell value={fmt(stats?.longest_kill_streak ?? 0)} label="Best Streak" valueSize={20} />
            <TmLcdWell
              value={String(stats?.highest_boss_tier ?? 0)}
              label="Boss Tier"
              valueSize={20}
              onClick={() => openDetail({ metric: 'highest_boss_tier', leaderboardMetric: 'highest_boss_tier', label: 'Highest Boss Tier', value: stats?.highest_boss_tier ?? 0, color: '#FF4B5C' })}
            />
          </div>

          {safe && (
            <>
              <TmGroupDatum label="Kills by Weapon" />
              {weaponKills.length === 0 ? (
                <div className="py-1 text-[11px]" style={{ ...tmMonoStyle, color: TM_FAINT }}>No weapon kills on record yet.</div>
              ) : (
                weaponKills.map(([type, count]) => (
                  <TmChannelRow
                    key={type}
                    name={WEAPON_TYPE_NAMES.get(type) ?? type}
                    value={fmt(count)}
                    filled={shareSegs(count, channelTotal(weaponKills))}
                    color={TM_GOLD}
                  />
                ))
              )}
              <div className="mt-1 text-[11px] leading-snug" style={{ ...tmMonoStyle, color: TM_FAINT }}>
                Weapon-type kills come from your trophy record; the totals above count every claim ever settled.
              </div>

              <TmGroupDatum label="Kills by Element" />
              {elementKills.length === 0 ? (
                <div className="py-1 text-[11px]" style={{ ...tmMonoStyle, color: TM_FAINT }}>No element kills on record yet.</div>
              ) : (
                elementKills.map(([element, count]) => {
                  const elementId = ELEMENT_KEY_ALIAS[element] ?? element;
                  return (
                    <TmChannelRow
                      key={element}
                      name={element === 'unarmed' ? 'Unarmed' : (ELEMENT_NAMES.get(elementId) ?? element)}
                      value={fmt(count)}
                      filled={shareSegs(count, channelTotal(elementKills))}
                      color={ELEMENT_COLORS.get(elementId) ?? TM_STEEL}
                    />
                  );
                })
              )}
              <div className="mt-1 text-[11px] leading-snug" style={{ ...tmMonoStyle, color: TM_FAINT }}>
                Element kills are recorded from the current trophy record forward; earlier kills carry no element attribution.
              </div>

              {areaKills.length > 0 && (
                <>
                  <TmGroupDatum label="Kills by Area" />
                  {areaKills.map(([areaId, count]) => (
                    <TmChannelRow
                      key={areaId}
                      name={AREA_NAMES.get(areaId) ?? areaId}
                      value={fmt(count)}
                      filled={shareSegs(count, channelTotal(areaKills))}
                      color={TM_INK}
                    />
                  ))}
                </>
              )}
            </>
          )}

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <TmLcdWell value={hours(stats?.active_play_seconds ?? 0)} label="Active Field Time" valueSize={18} />
            <TmLcdWell value={hours(stats?.idle_play_seconds ?? 0)} label="Idle Field Time" valueSize={18} />
          </div>
          {lastDeath && (
            <div className="mt-2.5 flex items-center gap-2">
              <TmLed lit color={TM_RED} size={8} />
              <span className="text-[11px] font-bold uppercase" style={{ ...tmMonoStyle, color: TM_MUT, letterSpacing: '0.08em' }}>
                Last death — {lastDeath.monsterName} · {resolveSceneLabel(lastDeath.areaId)} · {daysAgo(lastDeath.at)}
              </span>
            </div>
          )}
        </TmPanel>

        {/* ── CAREER TOTALS ─────────────────────────────────── */}
        {safe && (
          <TmPanel testId="profile-career-panel">
            <TmPanelLabel label="Career Totals" right="Lifetime Record · Server-Folded" />
            <TmGroupDatum label="Economy" />
            <TmReadoutRow
              label="Net Worth"
              value={fmt(stats?.net_worth ?? 0)}
              detail="Credits, gear + stock at market"
              onClick={() => openDetail({ metric: 'net_worth', leaderboardMetric: 'net_worth', label: 'Net Worth', value: stats?.net_worth ?? 0, color: '#7CFC00' })}
            />
            <TmReadoutRow label="Credits Earned" value={`${fmt(safe.credits.earned)} CR`} detail="Lifetime, all sources" />
            <TmReadoutRow label="Credits Spent" value={`${fmt(safe.credits.spent)} CR`} detail="Lifetime, all sinks" />
            <div className="py-1 text-[11px] leading-snug" style={{ ...tmMonoStyle, color: TM_FAINT }}>
              {creditsSince
                ? `Credit totals count every credit change since ${creditsSince}; earlier credit history was never recorded server-side.`
                : 'Credit totals start counting with your next credit change; earlier credit history was never recorded server-side.'}
            </div>
            <TmReadoutRow
              label="Market Sales"
              value={`${fmt(safe.market.sales)} · ${fmt(safe.market.sales_volume)} CR`}
              detail={`Fees paid ${fmt(safe.market.fees_paid)} cr`}
            />
            <TmReadoutRow
              label="Market Purchases"
              value={`${fmt(safe.market.purchases)} · ${fmt(safe.market.purchases_volume)} CR`}
            />
            <TmReadoutRow
              label="Salvage"
              value={`${fmt(safe.salvage.items)} ITEMS`}
              detail={`${fmt(safe.salvage.scrap_earned)} scrap recovered`}
            />
            <TmReadoutRow
              label="Repair Points (Board)"
              value={fmt(safe.repair.board_points_restored)}
              detail={`${fmt(safe.repair.board_jobs_completed)} jobs · ${fmt(safe.repair.board_credits_earned)} cr earned`}
            />
            <TmReadoutRow
              label="Repair Points (Self)"
              value={fmt(safe.repair.self_points_restored)}
              detail={`${fmt(safe.repair.self_jobs)} jobs`}
            />

            <TmGroupDatum label="Operations" />
            <TmReadoutRow label="Boss Attempts" value={fmt(safe.bosses.attempts)} detail={`${fmt(safe.bosses.victories)} victories`} />
            <TmReadoutRow label="Bosses Downed" value={`${fmt(safe.bosses.downed)} / ${REGION_1_BOSSES.length}`} />
            <TmReadoutRow
              label="Endless Best Depth"
              value={fmt(safe.endless.best_depth)}
              detail={`${fmt(safe.endless.runs)} runs · ${fmt(safe.endless.banked)} banked · ${fmt(safe.endless.deaths)} deaths`}
            />
            <TmReadoutRow label="Caches Opened" value={fmt(safe.caches.opened)} detail={`${fmt(safe.caches.rewarded_keys)} rewarded keys claimed`} />
            <TmReadoutRow label="Units Crafted" value={fmt(safe.crafting.total_units)} detail="Consumable · material · tint" />
            {craftKinds.map(([kind, count]) => (
              <TmReadoutRow key={kind} label={`Crafted — ${kind}`} value={fmt(count)} />
            ))}
            <TmReadoutRow
              label="Dispatch Jobs"
              value={fmt(safe.dispatch.completed)}
              detail={`${fmt(safe.dispatch.foot)} foot · ${fmt(safe.dispatch.courier)} courier · ${fmt(safe.dispatch.credits_earned)} cr earned`}
            />
            <TmReadoutRow label="Extraction Passes" value={fmt(safe.extraction.passes)} detail={`${fmt(safe.extraction.xp_awarded)} XP awarded`} />
            <TmReadoutRow label="Roaming Kills" value={fmt(safe.kills.roaming)} />
            <TmReadoutRow label="Elite Kills" value={fmt(safe.kills.elites)} />
            <TmReadoutRow label="Named Elites Downed" value={`${fmt(safe.kills.named_elites_downed)} / ${NAMED_ELITES.length}`} />
            <TmReadoutRow label="Lifetime deaths" value={fmt(safe.deaths)} detail="The lifetime counter (0051) — the combat head reads the stats summary" />
            <TmReadoutRow label="Resurrections" value={fmt(safe.resurrections)} />
            <TmReadoutRow label="Reforges" value={fmt(safe.reforges)} />
            {safe.consumables.top_used.map((entry) => (
              <TmReadoutRow key={entry.type} label={`Used — ${consumableDisplayName(entry.type)}`} value={fmt(entry.count)} />
            ))}

            <TmGroupDatum label="Mastery" />
            <TmReadoutRow
              label="Total Mastery XP"
              value={fmt(stats?.total_mastery_xp ?? 0)}
              onClick={() => openDetail({ metric: 'total_mastery_xp', leaderboardMetric: 'total_mastery_xp', label: 'Mastery XP (all tracks)', value: stats?.total_mastery_xp ?? 0, color: '#7CFC00' })}
            />
            <TmReadoutRow
              label="Highest Mastery"
              value={`LV ${stats?.highest_mastery_level ?? 0}`}
              onClick={() => openDetail({ metric: 'highest_mastery_level', leaderboardMetric: 'highest_mastery_level', label: 'Highest Mastery Level', value: stats?.highest_mastery_level ?? 0, color: '#7CFC00' })}
            />

            <TmGroupDatum label="Collection" />
            <div className="flex min-h-[36px] items-center gap-2.5" style={{ borderBottom: '1px solid rgba(58,52,43,0.55)' }}>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold uppercase leading-tight" style={{ ...tmMonoStyle, color: TM_MUT, letterSpacing: '0.1em' }}>
                  Collection Logged
                </span>
                <span className="block text-[11px] leading-tight" style={{ ...tmMonoStyle, color: TM_FAINT }}>
                  Across all four families
                </span>
              </span>
              <span className="w-[110px] shrink-0">
                <TmLedMeter filled={shareSegs(safe.collections.discovered, COLLECTION_TOTAL)} total={20} color={TM_CYAN} height={11} label={`Collection: ${safe.collections.discovered} of ${COLLECTION_TOTAL}`} />
              </span>
              <span className="shrink-0 text-[15px] font-bold" style={{ ...tmMonoStyle, color: TM_INK }}>
                {safe.collections.discovered} / {COLLECTION_TOTAL}
              </span>
            </div>
            <TmReadoutRow
              label="Legendaries Found"
              value={fmt(stats?.legendary_items ?? 0)}
              detail={`${fmt(safe.legendaries.salvaged)} salvaged · ${fmt(safe.legendaries.cores_minted)} cores minted`}
              onClick={() => openDetail({ metric: 'legendary_items', leaderboardMetric: 'legendary_items', label: 'Legendary Items', value: stats?.legendary_items ?? 0, color: '#FFEA3A' })}
            />
            <TmReadoutRow
              label="Legendary Cores"
              value={fmt(safe.legendaries.cores_balance)}
              detail={`${fmt(safe.legendaries.cores_minted)} minted · ${fmt(safe.legendaries.cores_spent)} spent`}
            />
            {legendarySources.map(([source, count]) => (
              <TmReadoutRow key={source} label={`Legendary Finds — ${SOURCE_LABELS[source] ?? source}`} value={fmt(count)} />
            ))}
            <TmReadoutRow
              label="Items Held"
              value={fmt(stats?.total_items ?? props.totalItemsFallback)}
              detail={`${fmt(stats?.weapons_owned ?? props.weaponsCountFallback)} weapons`}
              onClick={() => openDetail({ metric: 'total_items', leaderboardMetric: 'total_items', label: 'Total Items', value: stats?.total_items ?? props.totalItemsFallback, color: '#FFEA3A' })}
            />
            <TmReadoutRow label="Highest Item Level" value={String(stats?.highest_item_level ?? 0)} />
            <TmReadoutRow label="Unique Affixes" value={fmt(props.uniqueAffixes)} />
            <TmReadoutRow label="Favorite Type" value={props.favoriteType ?? 'None'} />
          </TmPanel>
        )}
      </div>
    </>
  );
};
