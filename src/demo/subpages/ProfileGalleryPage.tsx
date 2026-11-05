/**
 * Profile — variant C: "The Retrospective" (Showcase register).
 *
 * PROTOTYPE ONLY — a design-pass rendering, never merged. The
 * hunter's career record hung as a one-person gallery exhibition:
 * the portrait under a spotlight, the trophy weapons as pieces, the
 * combat record as a hero numeral with an index wall, the boss
 * paintings full-bleed, and the lifetime ledger as a quiet index —
 * every lifetime number printed exactly once, as variant A's record
 * discipline established. Art carries the page; chrome is a wall
 * label, a caption, a hairline.
 *
 * Facts are the variant A fixtures (identical hunter, identical
 * numbers), shaped like the real /stats/me and /profile/stats
 * payloads. The Totals & Sources door opens the SHIPPED
 * CharacterStatBreakdownModal, assembled from the seeded stores —
 * its contents are the game's real output for this hunter.
 */
import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { PlayerPublicStats } from '@/lib/api/statsService';
import type { ProfileLifetimePayload } from '@/lib/api/verifiedOps';
import type { Weapon } from '@/types/items';
import { HunterPortrait } from '@/components/pixelArt/HunterPortrait';
import { PixelWeapon } from '@/components/pixelArt/PixelWeapon';
import { CharacterStatBreakdownModal } from '@/components/stats/CharacterStatBreakdownModal';
import { useCharacterStatSummary } from '@/hooks/useCharacterStatSummary';
import { useActivityStore } from '@/store/slices/activitySlice';
import { useOwnLook } from '@/store/slices/cosmeticsSlice';
import { pixelWeaponInputFromWeapon } from '@/lib/pixel/weaponCompositor';
import { showcaseWeaponInput, showcaseRarityColor } from '@/lib/pixel/showcaseWeaponInput';
import { bossArt } from '@/lib/pixel/bossIdentity';
import { formatDuration, formatKillDeathRatio } from '@/lib/stats/statsHelpers';
import { consumableDisplayName } from '@/lib/market/identityKey';
import { xpToNextLevel } from '@/content/simulation';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import { ELEMENTS } from '@/constants/elements';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { LEGENDARY_EFFECTS } from '@/constants/legendaryEffects';
import { NAMED_ELITES } from '@/content/collections';
import {
  FIXTURE_EMAIL,
  FIXTURE_UNSPENT_POINTS,
  fixtureWornSetName,
  type DeathLogFixture,
  type ProgressionSnapshotFixture,
} from '../profileFixtures';

/* ── Gallery tokens ─────────────────────────────────────────────── */
const WALL = '#0B0908';
const GROUND = '#171008';
const BONE = '#F5EFE6';
const MUTE = '#C9BBA3';
const FAINT = '#A2957F';
const HAIR = 'rgba(245,239,230,0.14)';
const AMBER = '#FF9000';
const DISPLAY = '"Bebas Neue", "Chakra Petch", sans-serif';

const fmt = (n: number) => n.toLocaleString('en-US');

const AREA_NAMES = new Map(ROAMING_AREAS.map((a) => [a.id as string, a.name]));
const WEAPON_TYPE_NAMES = new Map(Object.values(WEAPON_TYPES).map((t) => [t.id as string, t.name]));
const ELEMENT_NAMES = new Map(Object.values(ELEMENTS).map((e) => [e.id as string, e.name]));
const BOSS_NAMES = new Map(REGION_1_BOSSES.map((b) => [b.id as string, b.name]));

/**
 * The lifetime fixture's by_boss keys are ledger keys; one of them
 * predates the boss's canonical id. Art and display name resolve
 * through the canonical id (the game's own boss record), the
 * victory count stays the fixture's.
 */
const BOSS_ART_KEYS: Record<string, string> = { choir_of_teeth: 'static_choir' };

function prettifyKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
const areaLabel = (key: string) => AREA_NAMES.get(key) ?? prettifyKey(key);
const bossLabel = (key: string) => BOSS_NAMES.get(key) ?? prettifyKey(key);

const SOURCE_LABELS: Record<string, string> = {
  roaming_drop: 'Roaming drops',
  offline_drop: 'Offline hauls',
  boss_loot: 'Boss loot',
  cache_forge: 'Cache-forged',
  market_purchase: 'Market finds',
  endless_milestone: 'Endless milestones',
};

/* ── Small pieces ───────────────────────────────────────────────── */

function RoomTitle({ children, testId }: { children: string; testId: string }) {
  return (
    <h2
      data-testid={testId}
      style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.06em' }}
      className="text-[26px] leading-none"
    >
      {children}
    </h2>
  );
}

function Caption({ children, center = false }: { children: React.ReactNode; center?: boolean }) {
  return (
    <p className={`text-xs leading-relaxed ${center ? 'text-center' : ''}`} style={{ color: FAINT }}>
      {children}
    </p>
  );
}

/** One numbered line of an index wall: name, numeral, hairline share. */
function IndexRow({ name, count, total }: { name: string; count: number; total: number }) {
  const share = total > 0 ? Math.max(1.5, (count / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold" style={{ color: BONE }}>
          {name}
        </span>
        <span className="text-[15px] font-bold tabular-nums" style={{ color: BONE }}>
          {fmt(count)}
        </span>
      </div>
      <div className="mt-1.5 h-[2px] w-full" style={{ background: 'rgba(245,239,230,0.08)' }}>
        <div className="h-full" style={{ width: `${share}%`, background: 'rgba(245,239,230,0.75)' }} />
      </div>
    </div>
  );
}

function IndexWall({
  rows,
  total,
  label,
}: {
  rows: Array<{ name: string; count: number }>;
  total: number;
  label?: string;
}) {
  return (
    <div>
      {label ? (
        <h3
          style={{ fontFamily: DISPLAY, color: MUTE, letterSpacing: '0.08em' }}
          className="mb-3 text-[16px]"
        >
          {label}
        </h3>
      ) : null}
      <div className="flex flex-col gap-4">
        {rows.map((r) => (
          <IndexRow key={r.name} name={r.name} count={r.count} total={total} />
        ))}
      </div>
    </div>
  );
}

/** One line of the ledger index — label left, fact right, hairline under. */
function LedgerRow({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 py-2"
      style={{ borderBottom: `1px solid rgba(245,239,230,0.07)` }}
    >
      <span className="text-xs" style={{ color: MUTE }}>
        {label}
      </span>
      <span className="text-right text-[13px] font-semibold tabular-nums" style={{ color: BONE }}>
        {value}
      </span>
    </div>
  );
}

function LedgerGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3
        style={{ fontFamily: DISPLAY, color: MUTE, letterSpacing: '0.08em' }}
        className="mb-1 text-[16px]"
      >
        {label}
      </h3>
      <div>{children}</div>
    </div>
  );
}

/* ── The page ───────────────────────────────────────────────────── */

export const ProfileGalleryPage: React.FC<{
  stats: PlayerPublicStats;
  lifetime: ProfileLifetimePayload;
  snapshots: ProgressionSnapshotFixture[];
  deathLog: DeathLogFixture[];
  weapons: Weapon[];
}> = ({ stats, lifetime, snapshots, deathLog, weapons }) => {
  const look = useOwnLook();
  const { summary } = useCharacterStatSummary();
  const activityKind = useActivityStore((s) => s.current.kind);
  const reduceMotion = useReducedMotion();
  const [totalsOpen, setTotalsOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  const level = stats.player_level;
  const xpNeeded = xpToNextLevel(level);
  const xpPct = xpNeeded > 0 ? Math.min(100, Math.round((stats.player_xp / xpNeeded) * 100)) : 0;
  const joinedLabel = new Date(stats.joined_at).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  const wornSetName = fixtureWornSetName();

  const primaryWeapon = weapons[0];
  const portraitWeaponInput = primaryWeapon ? pixelWeaponInputFromWeapon(primaryWeapon) : undefined;

  const pinnedIds = new Set(lifetime.showcase.pinned_item_ids ?? []);
  const trophies = lifetime.showcase.top_weapons
    .map((item) => ({ item, weapon: weapons.find((w) => w.id === item.id) }))
    .filter((t): t is { item: (typeof lifetime.showcase.top_weapons)[number]; weapon: Weapon } => !!t.weapon);

  const viewing = viewingId ? weapons.find((w) => w.id === viewingId) : undefined;

  const areaRows = Object.entries(stats.kills_by_area)
    .map(([key, count]) => ({ name: areaLabel(key), count }))
    .sort((a, b) => b.count - a.count);
  const weaponRows = Object.entries(stats.kills_by_weapon_type)
    .map(([key, count]) => ({ name: WEAPON_TYPE_NAMES.get(key) ?? prettifyKey(key), count }))
    .sort((a, b) => b.count - a.count);
  const elementRows = Object.entries(stats.kills_by_element)
    .map(([key, count]) => ({
      name: key === 'unarmed' ? 'Unarmed' : (ELEMENT_NAMES.get(key) ?? prettifyKey(key)),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const bossRows = Object.entries(lifetime.bosses.by_boss).sort((a, b) => b[1] - a[1]);

  const firstSnap = snapshots[0];
  const lastSnap = snapshots[snapshots.length - 1];
  const maxWorth = Math.max(...snapshots.map((s) => s.net_worth), 1);
  const startDateLabel = firstSnap
    ? new Date(`${firstSnap.snapshot_date}T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })
    : '';

  const rise = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.55, delay, ease: 'easeOut' as const },
        };

  return (
    <div style={{ background: WALL, color: BONE }} data-testid="profile-gallery">
      {/* ── The Portrait ─────────────────────────────────────────── */}
      <motion.div {...rise(0)}>
        <div
          className="relative overflow-hidden"
          style={{
            background: `radial-gradient(ellipse 95% 62% at 50% 36%, ${GROUND} 0%, ${WALL} 72%)`,
          }}
        >
          <HunterPortrait look={look} weaponInput={portraitWeaponInput} className="h-[348px]" />
          <div
            className="pointer-events-none absolute inset-x-10 bottom-0 h-px"
            style={{ background: HAIR }}
          />
        </div>

        {/* The wall label */}
        <div className="px-5 pt-5">
          <h1
            className="text-center text-[46px] leading-none"
            style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.05em' }}
          >
            {stats.display_name ?? 'Hunter'}
          </h1>
          <p className="mt-2 text-center text-[13px]" style={{ color: MUTE }}>
            @{stats.username} · Level {level}
          </p>
          <p className="mt-1 text-center text-xs" style={{ color: FAINT }}>
            On the frontier since {joinedLabel}
            {wornSetName ? ` · wearing the ${wornSetName} set` : ''}
          </p>

          {/* XP as a thread of light under the label */}
          <div className="mx-auto mt-5 w-[68%]">
            <div className="h-[3px] w-full" style={{ background: 'rgba(245,239,230,0.12)' }}>
              <div className="h-full" style={{ width: `${xpPct}%`, background: AMBER }} />
            </div>
            <p className="mt-2 text-center text-xs tabular-nums" style={{ color: MUTE }}>
              {fmt(stats.player_xp)} / {fmt(xpNeeded)} XP · {xpPct}% to Level {level + 1}
            </p>
          </div>

          {/* The one door where action waits */}
          <button
            type="button"
            data-testid="gallery-points-door"
            className="mt-5 flex min-h-[52px] w-full flex-col items-center justify-center gap-0.5 px-4 py-2"
            style={{ border: `1px solid rgba(255,144,0,0.45)` }}
          >
            <span className="text-[13px] font-bold uppercase tracking-wide" style={{ color: AMBER }}>
              {FIXTURE_UNSPENT_POINTS} skill points unspent
            </span>
            <span className="text-[11px]" style={{ color: FAINT }}>
              Spend them in Skill Trees
            </span>
          </button>
        </div>
      </motion.div>

      {/* ── The Trophies ─────────────────────────────────────────── */}
      <section className="px-5 pt-12">
        <RoomTitle testId="gallery-trophies-title">The Trophies</RoomTitle>
        <div className="mt-2">
          <Caption>The shelf, as pinned. Tap a piece to view it.</Caption>
        </div>
        <div>
          {trophies.map(({ item, weapon }, i) => (
            <div key={item.id} style={i > 0 ? { borderTop: `1px solid ${HAIR}` } : undefined}>
              <button
                type="button"
                data-testid={`gallery-trophy-${i}`}
                onClick={() => setViewingId(weapon.id)}
                className="flex w-full flex-col items-center px-2 py-6"
                aria-label={`${weapon.name} — view the piece`}
              >
                <PixelWeapon input={showcaseWeaponInput(item)} size={216} density="card" />
                <span
                  className="mt-4 text-center text-[21px] leading-tight"
                  style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.04em' }}
                >
                  {weapon.name}
                </span>
                <span
                  className="mt-1.5 text-xs font-bold uppercase tracking-wide"
                  style={{ color: showcaseRarityColor(item.rarity) }}
                >
                  {item.rarity} · Level {item.item_level}
                  {pinnedIds.has(item.id) ? (
                    <span style={{ color: FAINT }}> · Pinned</span>
                  ) : null}
                </span>
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* ── The Combat Record ────────────────────────────────────── */}
      <section className="px-5 pt-12">
        <RoomTitle testId="gallery-combat-title">The Combat Record</RoomTitle>
        <div className="mt-6 text-center">
          <div className="text-[64px] font-bold leading-none tabular-nums" style={{ color: BONE }}>
            {formatKillDeathRatio(stats.total_kills, stats.total_deaths)}
          </div>
          <p className="mt-2 text-xs" style={{ color: MUTE }}>
            Kill / death — {fmt(stats.total_kills)} kills · {fmt(stats.total_deaths)} deaths
          </p>
        </div>
        <div className="mx-auto mt-8 grid max-w-[320px] grid-cols-2 gap-x-6 gap-y-6">
          {[
            { value: fmt(stats.longest_kill_streak), label: 'Best streak' },
            { value: String(stats.highest_boss_tier), label: 'Highest boss tier' },
            { value: formatDuration(stats.active_play_seconds), label: 'Active field time' },
            { value: formatDuration(stats.idle_play_seconds), label: 'Idle field time' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div className="text-[26px] font-bold leading-none tabular-nums" style={{ color: BONE }}>
                {s.value}
              </div>
              <div className="mt-1.5 text-[11px] uppercase tracking-wide" style={{ color: FAINT }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10">
          <h3
            style={{ fontFamily: DISPLAY, color: MUTE, letterSpacing: '0.08em' }}
            className="mb-1 text-[16px]"
          >
            Killed By
          </h3>
          {deathLog.map((d, i) => (
            <div
              key={`${d.monsterId}-${d.at}`}
              className="flex items-baseline justify-between gap-4 py-2.5"
              style={i > 0 ? { borderTop: `1px solid rgba(245,239,230,0.07)` } : undefined}
            >
              <span className="text-[13px] font-semibold" style={{ color: BONE }}>
                {d.monsterName}
              </span>
              <span className="text-[11px]" style={{ color: FAINT }}>
                {areaLabel(d.areaId)} ·{' '}
                {new Date(d.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── The Grounds ──────────────────────────────────────────── */}
      <section className="px-5 pt-12">
        <RoomTitle testId="gallery-grounds-title">The Grounds</RoomTitle>
        <div className="mt-4">
          <IndexWall rows={areaRows} total={stats.total_kills} />
        </div>
        <div className="mt-9">
          <IndexWall rows={weaponRows} total={stats.total_kills} label="The Instruments" />
        </div>
        <div className="mt-9">
          <IndexWall rows={elementRows} total={stats.total_kills} label="The Elements" />
        </div>
        <div className="mt-3">
          <Caption>Shares of {fmt(stats.total_kills)} recorded kills.</Caption>
        </div>
      </section>

      {/* ── The Boss Wall ────────────────────────────────────────── */}
      <section className="pt-12">
        <div className="px-5">
          <RoomTitle testId="gallery-boss-title">The Boss Wall</RoomTitle>
        </div>
        <div className="mt-4 flex flex-col gap-7">
          {bossRows.map(([bossId, victories]) => {
            const artKey = BOSS_ART_KEYS[bossId] ?? bossId;
            const art = bossArt(artKey);
            if (!art) return null;
            const label = BOSS_NAMES.get(artKey) ?? bossLabel(bossId);
            return (
              <figure key={bossId} className="px-5">
                <div
                  className="relative h-[188px] overflow-hidden"
                  style={{ border: `1px solid ${HAIR}`, background: GROUND }}
                >
                  <img
                    src={art.arenaUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                    style={{ imageRendering: 'pixelated' }}
                    draggable={false}
                  />
                  <img
                    src={art.spriteUrl}
                    alt={label}
                    className="absolute bottom-0 left-1/2 h-[148px] -translate-x-1/2"
                    style={{ imageRendering: 'pixelated' }}
                    draggable={false}
                  />
                </div>
                <figcaption className="mt-2.5 flex items-baseline justify-between gap-3">
                  <span
                    className="text-[19px]"
                    style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.05em' }}
                  >
                    {label}
                  </span>
                  <span className="text-[13px] font-bold tabular-nums" style={{ color: BONE }}>
                    {fmt(victories)} victories
                  </span>
                </figcaption>
              </figure>
            );
          })}
        </div>
        <div className="px-5 pt-4">
          <Caption center>
            {fmt(lifetime.bosses.victories)} victories across {fmt(lifetime.bosses.attempts)}{' '}
            attempts · {lifetime.bosses.downed} of {REGION_1_BOSSES.length} bosses downed
          </Caption>
        </div>
      </section>

      {/* ── The Lifetime Ledger ──────────────────────────────────── */}
      <section className="px-5 pt-12">
        <RoomTitle testId="gallery-ledger-title">The Lifetime Ledger</RoomTitle>
        <div className="mt-2">
          <Caption>From the lifetime ledger — server-folded, all-time.</Caption>
        </div>

        <div className="mt-5">
          <div className="text-[42px] font-bold leading-none tabular-nums" style={{ color: BONE }}>
            {fmt(stats.net_worth)}
          </div>
          <p className="mt-1.5 text-xs" style={{ color: FAINT }}>
            Net worth — credits, gear, and stock, folded
          </p>
        </div>

        <div className="mt-7 flex flex-col gap-7">
          <LedgerGroup label="Standing">
            <LedgerRow label="Credits on hand" value={fmt(stats.credits)} />
            <LedgerRow label="Scrap" value={fmt(stats.scrap)} />
            <LedgerRow label="Cache keys" value={fmt(stats.cache_tokens)} />
            <LedgerRow label="Legendary cores" value={fmt(lifetime.legendaries.cores_balance)} />
            <LedgerRow
              label="Cache Rank"
              value={`${lifetime.showcase.cache_rank_total_ranks} ranks · ${fmt(lifetime.showcase.cache_rank_tokens)} tokens`}
            />
            <LedgerRow label="Mastery XP" value={fmt(stats.total_mastery_xp)} />
            <LedgerRow label="Highest mastery" value={`Lv ${stats.highest_mastery_level}`} />
          </LedgerGroup>

          <LedgerGroup label="The Arsenal">
            <LedgerRow label="Items" value={fmt(stats.total_items)} />
            <LedgerRow label="Weapons owned" value={fmt(stats.weapons_owned)} />
            <LedgerRow label="Legendary items" value={fmt(stats.legendary_items)} />
            <LedgerRow label="Highest item level" value={fmt(stats.highest_item_level)} />
            <LedgerRow
              label="Collections discovered"
              value={`${lifetime.showcase.collections_discovered} of 81`}
            />
          </LedgerGroup>

          <LedgerGroup label="Loot & Legend">
            <LedgerRow label="Legendaries salvaged" value={fmt(lifetime.legendaries.salvaged)} />
            <LedgerRow label="Cores minted" value={fmt(lifetime.legendaries.cores_minted)} />
            <LedgerRow label="Cores spent" value={fmt(lifetime.legendaries.cores_spent)} />
            <LedgerRow label="Caches opened" value={fmt(lifetime.caches.opened)} />
            <LedgerRow label="Rewarded keys claimed" value={fmt(lifetime.caches.rewarded_keys)} />
            {Object.entries(lifetime.legendaries.discoveries_by_source).map(([source, count]) => (
              <LedgerRow
                key={source}
                label={`Legendary finds — ${SOURCE_LABELS[source] ?? prettifyKey(source)}`}
                value={fmt(count)}
              />
            ))}
          </LedgerGroup>

          <LedgerGroup label="Trade & Work">
            <LedgerRow label="Credits earned" value={`${fmt(lifetime.credits.earned)} cr`} />
            <LedgerRow label="Credits spent" value={`${fmt(lifetime.credits.spent)} cr`} />
            <LedgerRow
              label="Market sales"
              value={`${fmt(lifetime.market.sales)} · ${fmt(lifetime.market.sales_volume)} cr`}
            />
            <LedgerRow label="Market fees paid" value={`${fmt(lifetime.market.fees_paid)} cr`} />
            <LedgerRow
              label="Market purchases"
              value={`${fmt(lifetime.market.purchases)} · ${fmt(lifetime.market.purchases_volume)} cr`}
            />
            <LedgerRow label="Units crafted" value={fmt(lifetime.crafting.total_units)} />
            {Object.entries(lifetime.crafting.units_by_kind).map(([kind, count]) => (
              <LedgerRow key={kind} label={`Crafted — ${prettifyKey(kind)}`} value={fmt(count)} />
            ))}
            <LedgerRow label="Consumables used" value={fmt(lifetime.consumables.used_total)} />
            {lifetime.consumables.top_used.map((u) => (
              <LedgerRow
                key={u.type}
                label={`Used — ${consumableDisplayName(u.type)}`}
                value={fmt(u.count)}
              />
            ))}
            <LedgerRow
              label="Repair points — board jobs"
              value={`${fmt(lifetime.repair.board_points_restored)} · ${fmt(lifetime.repair.board_jobs_completed)} jobs`}
            />
            <LedgerRow
              label="Repair points — self"
              value={`${fmt(lifetime.repair.self_points_restored)} · ${fmt(lifetime.repair.self_jobs)} jobs`}
            />
            <LedgerRow
              label="Dispatch completed"
              value={`${fmt(lifetime.dispatch.completed)} (${fmt(lifetime.dispatch.foot)} foot · ${fmt(lifetime.dispatch.courier)} courier)`}
            />
            <LedgerRow
              label="Dispatch earnings"
              value={`${fmt(lifetime.dispatch.credits_earned)} cr`}
            />
            <LedgerRow label="Extraction passes" value={fmt(lifetime.extraction.passes)} />
          </LedgerGroup>

          <LedgerGroup label="Salvage & Reforge">
            <LedgerRow label="Items salvaged" value={fmt(lifetime.salvage.items)} />
            <LedgerRow label="Scrap from salvage" value={fmt(lifetime.salvage.scrap_earned)} />
            <LedgerRow label="Reforges" value={fmt(lifetime.reforges)} />
          </LedgerGroup>

          <LedgerGroup label="The Long Game">
            <LedgerRow label="Roaming kills" value={fmt(lifetime.kills.roaming)} />
            <LedgerRow label="Elite kills" value={fmt(lifetime.kills.elites)} />
            <LedgerRow
              label="Named elites downed"
              value={`${fmt(lifetime.kills.named_elites_downed)} / ${NAMED_ELITES.length}`}
            />
            <LedgerRow label="Endless best depth" value={fmt(lifetime.endless.best_depth)} />
            <LedgerRow
              label="Endless runs"
              value={`${fmt(lifetime.endless.runs)} (${fmt(lifetime.endless.banked)} banked · ${fmt(lifetime.endless.deaths)} died)`}
            />
            <LedgerRow label="Resurrections" value={fmt(lifetime.resurrections)} />
          </LedgerGroup>
        </div>
        <div className="mt-4">
          <Caption>
            Credit counting began {joinedLabel}. The combat record above is the server kill
            record; the roaming figure here is the ledger's own count.
          </Caption>
        </div>
      </section>

      {/* ── Thirty Days ──────────────────────────────────────────── */}
      <section className="px-5 pt-12">
        <RoomTitle testId="gallery-thirty-title">Thirty Days</RoomTitle>
        <div className="mt-5 flex h-[118px] items-end gap-[2px]" aria-hidden="true">
          {snapshots.map((s) => (
            <div
              key={s.snapshot_date}
              className="flex-1"
              style={{
                height: `${Math.max(4, (s.net_worth / maxWorth) * 100)}%`,
                background: 'rgba(245,239,230,0.72)',
              }}
            />
          ))}
        </div>
        <div style={{ borderTop: `1px solid ${HAIR}` }} className="pt-3">
          <Caption>
            Net worth — {fmt(firstSnap?.net_worth ?? 0)} cr on {startDateLabel} to{' '}
            {fmt(lastSnap?.net_worth ?? 0)} cr today.
          </Caption>
          <div className="mt-1">
            <Caption>
              Level {firstSnap?.player_level} → {lastSnap?.player_level} · Kills{' '}
              {fmt(firstSnap?.total_kills ?? 0)} → {fmt(lastSnap?.total_kills ?? 0)} over the same
              thirty days.
            </Caption>
          </div>
        </div>
      </section>

      {/* ── The doors (colophon) ─────────────────────────────────── */}
      <nav className="px-5 pb-10 pt-12" aria-label="Profile doors">
        {[
          {
            label: 'Totals & Sources',
            caption: 'Every effective stat — and where each number comes from',
            onClick: () => setTotalsOpen(true),
            testId: 'gallery-door-totals',
          },
          {
            label: 'Standings',
            caption: 'The boards, and the weekly races',
            testId: 'gallery-door-standings',
          },
          {
            label: 'Activity Log',
            caption: 'The career as it happened, in order',
            testId: 'gallery-door-activity',
          },
          {
            label: 'Account & Settings',
            caption: `Verified account · ${FIXTURE_EMAIL}`,
            testId: 'gallery-door-account',
          },
        ].map((door) => (
          <button
            key={door.label}
            type="button"
            data-testid={door.testId}
            onClick={door.onClick}
            className="flex min-h-[56px] w-full flex-col justify-center py-3 text-left"
            style={{ borderTop: `1px solid ${HAIR}` }}
            aria-label={door.label}
          >
            <span
              className="text-[18px]"
              style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.05em' }}
            >
              {door.label}
            </span>
            <span className="mt-0.5 text-[11px]" style={{ color: FAINT }}>
              {door.caption}
            </span>
          </button>
        ))}
      </nav>

      {/* ── The viewing room (trophy detail) ─────────────────────── */}
      <AnimatePresence>
        {viewing ? (
          <motion.div
            key="viewing-room"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-end justify-center"
            style={{ background: 'rgba(0,0,0,0.62)' }}
            onClick={() => setViewingId(null)}
          >
            <motion.div
              initial={reduceMotion ? false : { y: 26 }}
              animate={{ y: 0 }}
              exit={reduceMotion ? undefined : { y: 26 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
              className="w-full max-w-md px-5 pb-8 pt-5"
              style={{ background: '#14100C', borderTop: `1px solid ${HAIR}` }}
              onClick={(e) => e.stopPropagation()}
              data-testid="gallery-viewing-room"
            >
              <div className="flex justify-center">
                <PixelWeapon weapon={viewing} size={248} density="card" />
              </div>
              <h3
                className="mt-4 text-center text-[26px] leading-tight"
                style={{ fontFamily: DISPLAY, color: BONE, letterSpacing: '0.04em' }}
              >
                {viewing.name}
              </h3>
              <p
                className="mt-1.5 text-center text-xs font-bold uppercase tracking-wide"
                style={{ color: showcaseRarityColor(viewing.rarity) }}
              >
                {viewing.rarity} · Level {viewing.level}
              </p>
              <p className="mt-2 text-center text-xs" style={{ color: MUTE }}>
                {WEAPON_TYPE_NAMES.get(viewing.weaponType) ?? prettifyKey(viewing.weaponType)} ·{' '}
                {ELEMENT_NAMES.get(viewing.element) ?? prettifyKey(viewing.element)} ·{' '}
                {String(viewing.manufacturer)}
              </p>
              {(() => {
                const effect = viewing.legendaryEffectId
                  ? LEGENDARY_EFFECTS.find((e) => e.id === viewing.legendaryEffectId)
                  : undefined;
                return effect ? (
                  <div className="mt-3">
                    <p
                      className="text-center text-[13px] font-bold"
                      style={{ color: showcaseRarityColor(viewing.rarity) }}
                    >
                      {effect.name}
                    </p>
                    <p className="mt-1 text-center text-xs leading-relaxed" style={{ color: FAINT }}>
                      {effect.description}
                    </p>
                  </div>
                ) : null;
              })()}
              {viewing.affixes.length > 0 ? (
                <div className="mt-3 flex flex-col items-center gap-1">
                  {viewing.affixes.map((a) => (
                    <p key={a.id} className="text-center text-xs" style={{ color: FAINT }}>
                      {a.displayText}
                    </p>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => setViewingId(null)}
                className="mt-5 min-h-[48px] w-full text-[13px] font-bold uppercase tracking-wide"
                style={{ color: BONE, border: `1px solid ${HAIR}` }}
              >
                Back to the wall
              </button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ── Totals & Sources: the shipped sheet, real output ─────── */}
      {totalsOpen ? (
        <CharacterStatBreakdownModal
          summary={summary}
          open={totalsOpen}
          onClose={() => setTotalsOpen(false)}
          activityKind={activityKind}
        />
      ) : null}
    </div>
  );
};
