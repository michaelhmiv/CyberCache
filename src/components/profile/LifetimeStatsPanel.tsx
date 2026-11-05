import React, { useEffect, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import { fetchProfileLifetime, type PartialProfileLifetimePayload, type ProfileLifetimePayload } from '@/lib/api/verifiedOps';
import { NAMED_ELITES } from '@/content/collections';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import { ELEMENTS } from '@/constants/elements';
import { consumableDisplayName } from '@/lib/market/identityKey';

/**
 * Lifetime Record (Profile, 0034; gaps closed 0051) — the full
 * brag set under the trophy shelf. Every number comes from
 * GET /api/profile/stats, folded server-side from server records
 * only (verified-action ledger, discoveries, endless/dispatch/
 * craft/service rows, consumable events, the kill records and the
 * lifetime counters). This panel formats; it computes nothing and
 * invents nothing — a stat with no server record is not shown
 * rather than estimated, and a stat whose record starts later
 * (credits, kills by element) says so on its face. Renders nothing
 * until the Chef answers.
 */

const fmt = (n: number): string => (n ?? 0).toLocaleString('en-US');

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex justify-between gap-3">
    <span className="text-text-secondary">{label}</span>
    <span className="text-right font-bold text-text-primary">{value}</span>
  </div>
);

const Section: React.FC<{ icon: PxIconName; title: string; tone: string; children: React.ReactNode }> = ({ icon, title, tone, children }) => (
  <div className="space-y-1">
    <div className="flex items-center gap-2 pt-1">
      <PxIcon name={icon} size={13} style={{ color: tone }} />
      <div className="text-[10px] font-black uppercase tracking-wide text-text-muted">{title}</div>
    </div>
    {children}
  </div>
);

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

function sortedEntries(map: Record<string, number> | null | undefined): Array<[string, number]> {
  return Object.entries(map ?? {})
    .map(([key, count]) => [key, count ?? 0] as [string, number])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * A partial payload must render a partial record, never blank the
 * screen: older Chef builds (and any read that predates a section)
 * omit whole blocks — kills.by_element, deaths and credits arrived
 * with 0051, and more sections will follow. Every section is filled
 * with its empty shape before anything reads it, so a missing map
 * or scalar degrades to that section's empty state.
 */
function withLifetimeDefaults(data: PartialProfileLifetimePayload): ProfileLifetimePayload {
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

export const LifetimeStatsPanel: React.FC = () => {
  const [data, setData] = useState<ProfileLifetimePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchProfileLifetime()
      .then((payload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        // Chef unreachable: the record stays hidden.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) return null;

  const safe = withLifetimeDefaults(data);
  const weaponKills = sortedEntries(safe.kills.by_weapon_type);
  const elementKills = sortedEntries(safe.kills.by_element);
  const areaKills = sortedEntries(safe.kills.by_area).slice(0, 5);
  const legendarySources = sortedEntries(safe.legendaries.discoveries_by_source);
  const craftKinds = sortedEntries(safe.crafting.units_by_kind).slice(0, 4);
  const creditsSinceDate = safe.credits.since ? new Date(safe.credits.since) : null;
  const creditsSince = creditsSinceDate && !Number.isNaN(creditsSinceDate.getTime())
    ? creditsSinceDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  return (
    <div data-testid="lifetime-stats">
      <MobileCard className="space-y-2" rarityColor="#5AA7FF">
        <div className="flex items-center gap-2">
          <PxIcon name="book" size={17} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Lifetime Record</div>
          <div className="ml-auto text-[10px] text-text-muted">Server-proven, all-time</div>
        </div>

        <Section icon="skull" title="Combat Record" tone="#FF4B5C">
          <Row label="Roaming kills" value={fmt(safe.kills.roaming)} />
          <Row label="Elite kills" value={fmt(safe.kills.elites)} />
          <Row label="Named elites downed" value={`${fmt(safe.kills.named_elites_downed)} / ${NAMED_ELITES.length}`} />
          <Row label="Boss victories" value={`${fmt(safe.bosses.victories)} of ${fmt(safe.bosses.attempts)} attempts`} />
          <Row label="Bosses downed" value={`${fmt(safe.bosses.downed)} / ${REGION_1_BOSSES.length}`} />
          <Row label="Endless best depth" value={fmt(safe.endless.best_depth)} />
          <Row label="Endless runs" value={`${fmt(safe.endless.runs)} (${fmt(safe.endless.banked)} banked · ${fmt(safe.endless.deaths)} died)`} />

          <Row label="Lifetime deaths" value={fmt(safe.deaths)} />
          <Row label="Resurrections" value={fmt(safe.resurrections)} />
        </Section>

        <Section icon="crosshair" title="Kills by Weapon" tone="#FF4B5C">
          {weaponKills.length === 0 ? (
            <div className="text-[11px] text-text-muted">No weapon kills on record yet.</div>
          ) : (
            weaponKills.map(([type, count]) => (
              <Row key={type} label={WEAPON_TYPE_NAMES.get(type) ?? type} value={fmt(count)} />
            ))
          )}
          <div className="text-[10px] text-text-muted">
            Weapon-type kills come from your trophy record; the totals above count every claim ever settled.
          </div>
        </Section>

        <Section icon="burst" title="Kills by Element" tone="#FF4B5C">
          {elementKills.length === 0 ? (
            <div className="text-[11px] text-text-muted">No element kills on record yet.</div>
          ) : (
            elementKills.map(([element, count]) => (
              <Row key={element} label={element === 'unarmed' ? 'Unarmed' : (ELEMENT_NAMES.get(element) ?? element)} value={fmt(count)} />
            ))
          )}
          <div className="text-[10px] text-text-muted">
            Element kills are recorded from the current trophy record forward; earlier kills carry no element attribution.
          </div>
        </Section>

        {areaKills.length > 0 && (
          <Section icon="rings" title="Top Hunting Grounds" tone="#FF4B5C">
            {areaKills.map(([areaId, count]) => (
              <Row key={areaId} label={AREA_NAMES.get(areaId) ?? areaId} value={fmt(count)} />
            ))}
          </Section>
        )}

        <Section icon="star" title="Loot & Legend" tone="#FFD166">
          <Row label="Legendaries salvaged" value={fmt(safe.legendaries.salvaged)} />
          <Row label="Legendary cores minted" value={fmt(safe.legendaries.cores_minted)} />
          <Row label="Legendary cores spent" value={fmt(safe.legendaries.cores_spent)} />
          <Row label="Core balance" value={fmt(safe.legendaries.cores_balance)} />
          <Row label="Caches opened" value={fmt(safe.caches.opened)} />
          <Row label="Rewarded keys claimed" value={fmt(safe.caches.rewarded_keys)} />
          {legendarySources.map(([source, count]) => (
            <Row key={source} label={`Legendary finds — ${SOURCE_LABELS[source] ?? source}`} value={fmt(count)} />
          ))}
        </Section>

        <Section icon="hammer" title="Trade & Work" tone="#7CFC00">
          <Row label="Credits earned" value={`${fmt(safe.credits.earned)} cr`} />
          <Row label="Credits spent" value={`${fmt(safe.credits.spent)} cr`} />
          <div className="text-[10px] text-text-muted">
            {creditsSince
              ? `Credit totals count every credit change since ${creditsSince}; earlier credit history was never recorded server-side.`
              : 'Credit totals start counting with your next credit change; earlier credit history was never recorded server-side.'}
          </div>
          <Row label="Market sales" value={`${fmt(safe.market.sales)} · ${fmt(safe.market.sales_volume)} cr`} />
          <Row label="Market fees paid" value={`${fmt(safe.market.fees_paid)} cr`} />
          <Row label="Market purchases" value={`${fmt(safe.market.purchases)} · ${fmt(safe.market.purchases_volume)} cr`} />
          <Row label="Units crafted" value={fmt(safe.crafting.total_units)} />
          {craftKinds.map(([kind, count]) => (
            <Row key={kind} label={`Crafted — ${kind}`} value={fmt(count)} />
          ))}
          {safe.consumables.top_used.map((entry) => (
            <Row key={entry.type} label={`Used — ${consumableDisplayName(entry.type)}`} value={fmt(entry.count)} />
          ))}
          <Row label="Repair points (board)" value={`${fmt(safe.repair.board_points_restored)} · ${fmt(safe.repair.board_jobs_completed)} jobs`} />
          <Row label="Repair points (self)" value={`${fmt(safe.repair.self_points_restored)} · ${fmt(safe.repair.self_jobs)} jobs`} />
          <Row label="Dispatch completed" value={`${fmt(safe.dispatch.completed)} (${fmt(safe.dispatch.foot)} foot · ${fmt(safe.dispatch.courier)} courier)`} />
          <Row label="Dispatch earnings" value={`${fmt(safe.dispatch.credits_earned)} cr`} />
          <Row label="Extraction passes" value={fmt(safe.extraction.passes)} />
        </Section>

        <Section icon="recycle" title="Salvage & Reforge" tone="#A855F7">
          <Row label="Items salvaged" value={fmt(safe.salvage.items)} />
          <Row label="Scrap from salvage" value={fmt(safe.salvage.scrap_earned)} />
          <Row label="Reforges" value={fmt(safe.reforges)} />
        </Section>
      </MobileCard>
    </div>
  );
};
