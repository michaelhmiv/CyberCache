/**
 * ProfileLedgerPage — PROTOTYPE (design/hunter-subpages-profile-e,
 * 2026-11-05). NOT shipped UI.
 *
 * Variant E — "Quiet plates". Profile at rest: where variant A built
 * the career as a machined Record Plate (painted hero, gauge wells,
 * engraved slabs, tally bars, bolts), this page keeps the same record
 * as a ledger — oversized type is the only furniture, hairlines and
 * air do all the separating, and every number the shipped page prints
 * prints exactly once, as a line of type. No plates, no gauges, no
 * stamps, no sparklines; the art is small and frameless at the row's
 * edge, and the page's one thread of progress belongs to XP.
 *
 * Content is the shipped Profile & Record stop's content, read from
 * payload-shaped fixtures (see profileLedgerFixtures.ts): the combat
 * summary (PlayerPublicStats), the server-folded lifetime record
 * (ProfileLifetimePayload), the trophy shelf's showcase, the death
 * log, and a Totals & Sources summary built by the real stat chain.
 * Labels mirror the shipped panels' own words.
 */
import React, { useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { NAMED_ELITES, COLLECTION_TOTAL } from '@/content/collections';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import { ELEMENTS } from '@/constants/elements';
import { resolveSceneLabel } from '@/lib/dashboard/sceneLabel';
import { consumableDisplayName } from '@/lib/market/identityKey';
import { showcaseWeaponInput } from '@/lib/pixel/showcaseWeaponInput';
import { formatDuration, formatKillDeathRatio, topBreakdown } from '@/lib/stats/statsHelpers';
import {
  DEATH_LOG_FIXTURE,
  LIFETIME_FIXTURE,
  STATS_FIXTURE,
  TOTALS_SUMMARY,
  UNSPENT_POINTS,
  XP_FOR_NEXT,
  XP_INTO_LEVEL,
} from './profileLedgerFixtures';

const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
/** Secondary ink at body sizes (clears 4.5:1 on the page ground). */
const BONE_SOFT = '#B3A488';
/** Faint ink — short labels and state words only. */
const BONE_FAINT = '#9A8B72';
const HAIRLINE = 'rgba(245,239,230,0.09)';
const HAIRLINE_STRONG = 'rgba(245,239,230,0.22)';

const display: React.CSSProperties = {
  fontFamily: "'Bebas Neue', sans-serif",
  letterSpacing: '0.04em',
  fontWeight: 400,
};

const numeral: React.CSSProperties = {
  fontFamily: "'Chakra Petch', sans-serif",
  fontVariantNumeric: 'tabular-nums',
};

const fmt = (n: number): string => (n ?? 0).toLocaleString('en-US');

const AREA_NAMES = new Map(ROAMING_AREAS.map((a) => [a.id, a.name]));
const WEAPON_TYPE_NAMES = new Map<string, string>(Object.values(WEAPON_TYPES).map((t) => [t.id as string, t.name]));
const ELEMENT_NAMES = new Map<string, string>(Object.values(ELEMENTS).map((e) => [e.id as string, e.name]));

/** Legendary discovery source labels — the shipped panel's own words. */
const SOURCE_LABELS: Record<string, string> = {
  roaming_drop: 'Roaming drops',
  offline_drop: 'Offline hauls',
  boss_loot: 'Boss loot',
  cache_forge: 'Cache-forged',
  market_purchase: 'Market finds',
  endless_milestone: 'Endless milestones',
  salvage: 'Proven by salvage',
};

const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/* ─── Ledger primitives ────────────────────────────────────────────── */

const Row: React.FC<{ label: string; value: string; first?: boolean }> = ({ label, value, first = false }) => (
  <div
    className="flex items-baseline justify-between gap-4 py-[11px]"
    style={{ borderTop: first ? undefined : `1px solid ${HAIRLINE}` }}
  >
    <span className="text-[13px] leading-snug" style={{ color: BONE_MUTED }}>
      {label}
    </span>
    <span className="shrink-0 text-[14px] font-semibold leading-snug" style={{ ...numeral, color: BONE }}>
      {value}
    </span>
  </div>
);

const GroupLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`text-[11px] font-bold uppercase tracking-[0.18em] ${className}`} style={{ color: BONE_FAINT }}>
    {children}
  </div>
);

const Chapter: React.FC<{ title: string; line?: string; children: React.ReactNode }> = ({ title, line, children }) => (
  <section className="mt-20">
    <div style={{ borderTop: `1px solid ${HAIRLINE_STRONG}`, paddingTop: 28 }}>
      <h2 className="leading-none" style={{ ...display, fontSize: 40, color: BONE }}>
        {title}
      </h2>
      {line && (
        <p className="mt-2 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
          {line}
        </p>
      )}
    </div>
    <div className="mt-4">{children}</div>
  </section>
);

const Note: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="mt-3 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
    {children}
  </p>
);

const Door: React.FC<{ label: string; status: string }> = ({ label, status }) => (
  <button
    type="button"
    className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left"
    style={{ borderTop: `1px solid ${HAIRLINE}` }}
  >
    <span className="min-w-0 flex-1">
      <span className="block text-[15px] font-semibold leading-snug" style={{ color: BONE }}>
        {label}
      </span>
      <span className="block text-[12px] leading-snug" style={{ color: BONE_SOFT }}>
        {status}
      </span>
    </span>
    <PxIcon name="chevR" size={15} style={{ color: BONE_FAINT }} />
  </button>
);

/* ─── Opening: identity + standing ─────────────────────────────────── */

const Opening: React.FC = () => {
  const stats = STATS_FIXTURE;
  const xpPct = Math.round((XP_INTO_LEVEL / XP_FOR_NEXT) * 100);
  return (
    <div>
      <div className="mt-10">
        <h1 className="leading-none" style={{ ...display, fontSize: 64, color: BONE }}>
          {stats.display_name}
        </h1>
        <div className="mt-3 text-[13px]" style={{ color: BONE_MUTED }}>
          @{stats.username} · Verified account
        </div>
        <p className="mt-3 max-w-[34ch] text-[13px] leading-relaxed" style={{ color: BONE_SOFT }}>
          On the record since {longDate(stats.joined_at)}. Every number on this page is folded from server
          records — nothing here is estimated.
        </p>
      </div>

      <div className="mt-14 flex items-baseline gap-4">
        <span className="leading-none" style={{ ...display, fontSize: 96, color: BONE }}>
          {stats.player_level}
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
          hunter level
        </span>
      </div>

      <div className="mt-6">
        <div className="h-[2px] w-full" style={{ backgroundColor: HAIRLINE }}>
          <div className="h-full" style={{ width: `${xpPct}%`, backgroundColor: BONE }} />
        </div>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <span className="text-[12px]" style={{ color: BONE_SOFT }}>
            {fmt(XP_INTO_LEVEL)} of {fmt(XP_FOR_NEXT)} XP to level {stats.player_level + 1}
          </span>
          <span className="text-[12px]" style={{ ...numeral, color: BONE_MUTED }}>
            {xpPct}%
          </span>
        </div>
      </div>

      <div className="mt-12">
        <p className="text-[13px] leading-relaxed" style={{ color: BONE_MUTED }}>
          {UNSPENT_POINTS} skill points are unspent. The trees are where they land — four of them, and the
          points do not spend themselves.
        </p>
        <button
          type="button"
          className="mt-4 flex min-h-[48px] w-full items-center justify-between px-4"
          style={{ border: `1px solid ${HAIRLINE_STRONG}`, color: BONE }}
        >
          <span className="text-[13px] font-bold uppercase tracking-[0.14em]">Open Skill Trees</span>
          <PxIcon name="chevR" size={15} style={{ color: BONE_FAINT }} />
        </button>
      </div>
    </div>
  );
};

/* ─── Combat ───────────────────────────────────────────────────────── */

const Breakdown: React.FC<{
  title: string;
  entries: Record<string, number>;
  names: Map<string, string>;
  limit?: number;
  note?: string;
}> = ({ title, entries, names, limit, note }) => {
  const rows = topBreakdown(entries, limit ?? Number.MAX_SAFE_INTEGER);
  if (rows.length === 0) return null;
  return (
    <div className="mt-8">
      <GroupLabel>{title}</GroupLabel>
      <div className="mt-1">
        {rows.map((row, i) => (
          <Row key={row.name} first={i === 0} label={names.get(row.name) ?? row.name} value={fmt(row.count)} />
        ))}
      </div>
      {note && <Note>{note}</Note>}
    </div>
  );
};

const Combat: React.FC = () => {
  const stats = STATS_FIXTURE;
  const life = LIFETIME_FIXTURE;
  return (
    <Chapter title="Combat">
      <div className="mt-2 flex items-baseline gap-4">
        <span className="leading-none" style={{ ...display, fontSize: 56, color: BONE }}>
          {formatKillDeathRatio(stats.total_kills, stats.total_deaths)}
        </span>
        <span className="text-[12px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_FAINT }}>
          kill / death
        </span>
      </div>
      <p className="mt-3 text-[13px]" style={{ color: BONE_MUTED }}>
        {fmt(stats.total_kills)} kills · {fmt(stats.total_deaths)} deaths
      </p>

      <div className="mt-6">
        <Row first label="Best streak" value={fmt(stats.longest_kill_streak)} />
        <Row label="Highest boss tier" value={fmt(stats.highest_boss_tier)} />
        <Row label="Active field time" value={formatDuration(stats.active_play_seconds)} />
        <Row label="Idle time" value={formatDuration(stats.idle_play_seconds)} />
      </div>

      <Breakdown title="Kills by area" entries={life.kills.by_area} names={AREA_NAMES} limit={5} />
      <Breakdown
        title="Kills by weapon"
        entries={life.kills.by_weapon_type}
        names={WEAPON_TYPE_NAMES}
        note="Weapon-type kills come from your trophy record; the totals above count every claim ever settled."
      />
      <Breakdown
        title="Kills by element"
        entries={life.kills.by_element}
        names={ELEMENT_NAMES}
        note="Element kills are recorded from the current trophy record forward; earlier kills carry no element attribution."
      />

      <div className="mt-8">
        <GroupLabel>Killed by · {DEATH_LOG_FIXTURE.length} recorded</GroupLabel>
        <div className="mt-1">
          {DEATH_LOG_FIXTURE.map((entry, i) => (
            <div
              key={`${entry.monsterId}-${entry.at}`}
              className="flex items-baseline justify-between gap-4 py-[11px]"
              style={{ borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}` }}
            >
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold leading-snug" style={{ color: BONE }}>
                  {entry.monsterName}
                </span>
                <span className="block text-[12px] leading-snug" style={{ color: BONE_SOFT }}>
                  {resolveSceneLabel(entry.areaId)}
                </span>
              </span>
              <span className="shrink-0 text-[12px]" style={{ ...numeral, color: BONE_MUTED }}>
                {new Date(entry.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Chapter>
  );
};

/* ─── The lifetime record ──────────────────────────────────────────── */

const Record: React.FC = () => {
  const life = LIFETIME_FIXTURE;
  const stats = STATS_FIXTURE;
  const since = life.credits.since
    ? new Date(life.credits.since).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : null;
  const craftKinds = topBreakdown(life.crafting.units_by_kind, 4);
  const legendarySources = topBreakdown(life.legendaries.discoveries_by_source, Number.MAX_SAFE_INTEGER);
  return (
    <Chapter title="The Record" line={`Folded from server records since ${longDate(stats.joined_at)} — the lifetime ledger, all-time.`}>
      <Row first label="Roaming kills" value={fmt(life.kills.roaming)} />
      <Row label="Elite kills" value={fmt(life.kills.elites)} />
      <Row label="Named elites downed" value={`${fmt(life.kills.named_elites_downed)} / ${NAMED_ELITES.length}`} />
      <Row label="Boss victories" value={`${fmt(life.bosses.victories)} of ${fmt(life.bosses.attempts)} attempts`} />
      <Row label="Bosses downed" value={`${fmt(life.bosses.downed)} / ${REGION_1_BOSSES.length}`} />
      <Row label="Endless runs" value={`${fmt(life.endless.runs)} (${fmt(life.endless.banked)} banked · ${fmt(life.endless.deaths)} died)`} />
      <Row label="Resurrections" value={fmt(life.resurrections)} />
      <Row label="Mastery XP (all tracks)" value={fmt(stats.total_mastery_xp)} />
      <Row label="Highest mastery level" value={fmt(stats.highest_mastery_level)} />

      <GroupLabel className="mt-10">Work &amp; trade</GroupLabel>
      <div className="mt-1">
        <Row first label="Credits earned" value={`${fmt(life.credits.earned)} cr`} />
        <Row label="Credits spent" value={`${fmt(life.credits.spent)} cr`} />
      </div>
      {since && (
        <Note>
          Credit totals count every credit change since {since}; earlier credit history was never recorded
          server-side.
        </Note>
      )}
      <div className="mt-2">
        <Row label="Market sales" value={`${fmt(life.market.sales)} · ${fmt(life.market.sales_volume)} cr`} />
        <Row label="Market fees paid" value={`${fmt(life.market.fees_paid)} cr`} />
        <Row label="Market purchases" value={`${fmt(life.market.purchases)} · ${fmt(life.market.purchases_volume)} cr`} />
        <Row label="Units crafted" value={fmt(life.crafting.total_units)} />
        {craftKinds.map((kind) => (
          <Row key={kind.name} label={`Crafted — ${kind.name}`} value={fmt(kind.count)} />
        ))}
        <Row label="Consumables used" value={fmt(life.consumables.used_total)} />
        {life.consumables.top_used.map((entry) => (
          <Row key={entry.type} label={`Used — ${consumableDisplayName(entry.type)}`} value={fmt(entry.count)} />
        ))}
        <Row
          label="Repair points (board)"
          value={`${fmt(life.repair.board_points_restored)} · ${fmt(life.repair.board_jobs_completed)} jobs`}
        />
        <Row
          label="Repair points (self)"
          value={`${fmt(life.repair.self_points_restored)} · ${fmt(life.repair.self_jobs)} jobs`}
        />
        <Row
          label="Dispatch completed"
          value={`${fmt(life.dispatch.completed)} (${fmt(life.dispatch.foot)} foot · ${fmt(life.dispatch.courier)} courier)`}
        />
        <Row label="Dispatch earnings" value={`${fmt(life.dispatch.credits_earned)} cr`} />
        <Row label="Extraction passes" value={fmt(life.extraction.passes)} />
      </div>

      <GroupLabel className="mt-10">Loot &amp; salvage</GroupLabel>
      <div className="mt-1">
        <Row first label="Caches opened" value={fmt(life.caches.opened)} />
        <Row label="Rewarded keys claimed" value={fmt(life.caches.rewarded_keys)} />
        <Row label="Legendaries salvaged" value={fmt(life.legendaries.salvaged)} />
        <Row label="Legendary cores minted" value={fmt(life.legendaries.cores_minted)} />
        <Row label="Legendary cores spent" value={fmt(life.legendaries.cores_spent)} />
        <Row label="Core balance" value={fmt(life.legendaries.cores_balance)} />
        {legendarySources.map((source) => (
          <Row
            key={source.name}
            label={`Legendary finds — ${SOURCE_LABELS[source.name] ?? source.name}`}
            value={fmt(source.count)}
          />
        ))}
        <Row label="Items salvaged" value={fmt(life.salvage.items)} />
        <Row label="Scrap from salvage" value={fmt(life.salvage.scrap_earned)} />
        <Row label="Reforges" value={fmt(life.reforges)} />
      </div>
    </Chapter>
  );
};

/* ─── Trophy shelf ─────────────────────────────────────────────────── */

const TrophyShelf: React.FC = () => {
  const showcase = LIFETIME_FIXTURE.showcase;
  const pins = showcase.pinned_item_ids ?? [];
  return (
    <Chapter title="Trophy Shelf" line="Best gear, server-ranked — one pinned by hand, the rest earned their place.">
      <div>
        {showcase.top_weapons.map((item, i) => {
          const payload = item.payload as { name?: string };
          const pinned = pins.includes(item.id);
          return (
            <div
              key={item.id}
              className="flex items-center gap-4 py-4"
              style={{ borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}` }}
            >
              <div className="min-w-0 flex-1">
                <div className="break-words text-[21px] font-semibold leading-tight" style={{ color: BONE }}>
                  {payload.name ?? 'Weapon'}
                </div>
                <div className="mt-1 text-[12px] leading-snug" style={{ color: BONE_SOFT }}>
                  {item.rarity} · Lv {item.item_level}
                  {item.equipped_slot != null ? ' · Equipped' : ''}
                </div>
                {pinned && (
                  <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: BONE_MUTED }}>
                    Pinned
                  </div>
                )}
              </div>
              <div className="flex w-[76px] shrink-0 items-center justify-center">
                <PixelWeapon input={showcaseWeaponInput(item)} size={76} density="card" />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <Row first label="Best endless depth" value={fmt(showcase.best_endless_depth)} />
        <Row
          label="Cache Rank"
          value={`${fmt(showcase.cache_rank_total_ranks)} ranks · ${fmt(showcase.cache_rank_tokens)} tokens`}
        />
      </div>
      <button
        type="button"
        className="mt-2 flex min-h-[52px] w-full items-center gap-3 py-2 text-left"
        style={{ borderTop: `1px solid ${HAIRLINE}` }}
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold leading-snug" style={{ color: BONE }}>
            Collections
          </span>
          <span className="block text-[12px] leading-snug" style={{ color: BONE_SOFT }}>
            {fmt(showcase.collections_discovered)} of {COLLECTION_TOTAL} discovered
          </span>
        </span>
        <PxIcon name="chevR" size={15} style={{ color: BONE_FAINT }} />
      </button>
    </Chapter>
  );
};

/* ─── Holdings ─────────────────────────────────────────────────────── */

const Holdings: React.FC = () => {
  const stats = STATS_FIXTURE;
  return (
    <Chapter title="Holdings" line="What the hunter holds now — balances and the strongbox, as of the last settled claim.">
      <Row first label="Net worth" value={`${fmt(stats.net_worth)} cr`} />
      <Row label="Credits on hand" value={fmt(stats.credits)} />
      <Row label="Scrap" value={fmt(stats.scrap)} />
      <Row label="Cache keys" value={fmt(stats.cache_tokens)} />
      <Row label="Items" value={fmt(stats.total_items)} />
      <Row label="Weapons" value={fmt(stats.weapons_owned)} />
      <Row label="Legendaries owned" value={fmt(stats.legendary_items)} />
      <Row label="Highest item level" value={fmt(stats.highest_item_level)} />
    </Chapter>
  );
};

/* ─── Totals & Sources ─────────────────────────────────────────────── */

const Totals: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-20">
      <div style={{ borderTop: `1px solid ${HAIRLINE_STRONG}`, paddingTop: 28 }}>
        <button type="button" onClick={() => setOpen((v) => !v)} className="block w-full text-left" aria-expanded={open}>
          <span className="flex items-baseline justify-between gap-3">
            <span className="leading-none" style={{ ...display, fontSize: 40, color: BONE }}>
              Totals &amp; Sources
            </span>
            <PxIcon name={open ? 'chevD' : 'chevR'} size={17} style={{ color: BONE_FAINT }} />
          </span>
          <span className="mt-2 block text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
            Every effective stat for your current build — and exactly where each number comes from.
          </span>
        </button>

        {open && (
          <div className="mt-4">
            {TOTALS_SUMMARY.headline.map((metric, i) => (
              <div key={metric.key} className="py-4" style={{ borderTop: i === 0 ? undefined : `1px solid ${HAIRLINE}` }}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[14px] font-semibold leading-snug" style={{ color: BONE }}>
                    {metric.label}
                  </span>
                  <span className="shrink-0 text-[16px] font-bold" style={{ ...numeral, color: BONE }}>
                    {metric.display}
                  </span>
                </div>
                {metric.detail && (
                  <p className="mt-1 text-[12px] leading-relaxed" style={{ color: BONE_SOFT }}>
                    {metric.detail}
                  </p>
                )}
                <div className="mt-2">
                  {metric.contributions.map((c, j) => (
                    <div key={`${metric.key}-${j}`} className="flex items-baseline justify-between gap-4 py-[5px]">
                      <span className="min-w-0 text-[12px] leading-snug" style={{ color: BONE_MUTED }}>
                        {c.source}
                        {c.detail ? <span style={{ color: BONE_FAINT }}> · {c.detail}</span> : null}
                      </span>
                      <span className="shrink-0 text-[12px] font-semibold" style={{ ...numeral, color: BONE_MUTED }}>
                        {c.display}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <Note>
              In the shipped page this door opens the full breakdown — every metric, every source. These are
              its headline four.
            </Note>
          </div>
        )}
      </div>
    </section>
  );
};

/* ─── The page ─────────────────────────────────────────────────────── */

export const ProfileLedgerPage: React.FC = () => (
  <div className="px-2 pt-4">
    <Opening />
    <Combat />
    <Record />
    <TrophyShelf />
    <Holdings />
    <Totals />

    <div className="mt-20">
      <Door label="Standings" status="Weekly races · rewards auto-pay at settlement" />
      <Door label="Activity Log" status="The totals say what you have — the log says how it happened" />
      <Door label="Account" status="Verified account · rook@example.com" />
      <Door label="Settings" status="Preferences, display, and local save controls" />
      <Door label="Field Manual" status="Mechanics, progression, caches, combat, and economy rules" />
    </div>

    <button type="button" className="mt-10 min-h-[44px] text-[13px] font-semibold" style={{ color: BONE_SOFT }}>
      Sign out
    </button>

    <p className="mt-8 pb-10 text-[12px] leading-relaxed" style={{ color: BONE_FAINT }}>
      What is not on this page has not happened yet.
    </p>
  </div>
);
