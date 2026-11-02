import React, { useEffect, useState } from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';
import { fetchProfileLifetime, type ProfileLifetimePayload } from '@/lib/api/verifiedOps';
import { NAMED_ELITES } from '@/content/collections';
import { REGION_1_BOSSES } from '@/constants/bosses';
import { ROAMING_AREAS } from '@/constants/roamingAreas';
import { WEAPON_TYPES } from '@/constants/weaponTypes';
import { consumableDisplayName } from '@/lib/market/identityKey';

/**
 * Lifetime Record (Profile, 0034) — the full brag set under the
 * trophy shelf. Every number comes from GET /api/profile/stats,
 * folded server-side from server records only (verified-action
 * ledger, discoveries, endless/dispatch/craft/service rows,
 * consumable events, the 0034 kill record). This panel formats; it
 * computes nothing and invents nothing — a stat with no server
 * record (lifetime deaths, lifetime credits) is not shown rather
 * than estimated. Renders nothing until the Chef answers.
 */

const fmt = (n: number): string => n.toLocaleString('en-US');

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

function sortedEntries(map: Record<string, number>): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
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

  const weaponKills = sortedEntries(data.kills.by_weapon_type);
  const areaKills = sortedEntries(data.kills.by_area).slice(0, 5);
  const legendarySources = sortedEntries(data.legendaries.discoveries_by_source);
  const craftKinds = sortedEntries(data.crafting.units_by_kind).slice(0, 4);

  return (
    <div data-testid="lifetime-stats">
      <MobileCard className="space-y-2" rarityColor="#5AA7FF">
        <div className="flex items-center gap-2">
          <PxIcon name="book" size={17} className="text-blue" />
          <div className="text-xs font-black uppercase tracking-wide text-text-primary">Lifetime Record</div>
          <div className="ml-auto text-[10px] text-text-muted">Server-proven, all-time</div>
        </div>

        <Section icon="skull" title="Combat Record" tone="#FF4B5C">
          <Row label="Roaming kills" value={fmt(data.kills.roaming)} />
          <Row label="Elite kills" value={fmt(data.kills.elites)} />
          <Row label="Named elites downed" value={`${data.kills.named_elites_downed} / ${NAMED_ELITES.length}`} />
          <Row label="Boss victories" value={`${fmt(data.bosses.victories)} of ${fmt(data.bosses.attempts)} attempts`} />
          <Row label="Bosses downed" value={`${data.bosses.downed} / ${REGION_1_BOSSES.length}`} />
          <Row label="Endless best depth" value={fmt(data.endless.best_depth)} />
          <Row label="Endless runs" value={`${fmt(data.endless.runs)} (${fmt(data.endless.banked)} banked · ${fmt(data.endless.deaths)} died)`} />
          <Row label="Resurrections" value={fmt(data.resurrections)} />
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
            Weapon-type kills are recorded from the 0034 trophy record onward; the totals above count every claim ever settled.
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
          <Row label="Legendaries salvaged" value={fmt(data.legendaries.salvaged)} />
          <Row label="Legendary cores minted" value={fmt(data.legendaries.cores_minted)} />
          <Row label="Legendary cores spent" value={fmt(data.legendaries.cores_spent)} />
          <Row label="Core balance" value={fmt(data.legendaries.cores_balance)} />
          <Row label="Caches opened" value={fmt(data.caches.opened)} />
          <Row label="Rewarded keys claimed" value={fmt(data.caches.rewarded_keys)} />
          {legendarySources.map(([source, count]) => (
            <Row key={source} label={`Legendary finds — ${SOURCE_LABELS[source] ?? source}`} value={fmt(count)} />
          ))}
        </Section>

        <Section icon="hammer" title="Trade & Work" tone="#7CFC00">
          <Row label="Market sales" value={`${fmt(data.market.sales)} · ${fmt(data.market.sales_volume)} cr`} />
          <Row label="Market fees paid" value={`${fmt(data.market.fees_paid)} cr`} />
          <Row label="Market purchases" value={`${fmt(data.market.purchases)} · ${fmt(data.market.purchases_volume)} cr`} />
          <Row label="Units crafted" value={fmt(data.crafting.total_units)} />
          {craftKinds.map(([kind, count]) => (
            <Row key={kind} label={`Crafted — ${kind}`} value={fmt(count)} />
          ))}
          {data.consumables.top_used.map((entry) => (
            <Row key={entry.type} label={`Used — ${consumableDisplayName(entry.type)}`} value={fmt(entry.count)} />
          ))}
          <Row label="Repair points (board)" value={`${fmt(data.repair.board_points_restored)} · ${fmt(data.repair.board_jobs_completed)} jobs`} />
          <Row label="Repair points (self)" value={`${fmt(data.repair.self_points_restored)} · ${fmt(data.repair.self_jobs)} jobs`} />
          <Row label="Dispatch completed" value={`${fmt(data.dispatch.completed)} (${fmt(data.dispatch.foot)} foot · ${fmt(data.dispatch.courier)} courier)`} />
          <Row label="Dispatch earnings" value={`${fmt(data.dispatch.credits_earned)} cr`} />
          <Row label="Extraction passes" value={fmt(data.extraction.passes)} />
        </Section>

        <Section icon="recycle" title="Salvage & Reforge" tone="#A855F7">
          <Row label="Items salvaged" value={fmt(data.salvage.items)} />
          <Row label="Scrap from salvage" value={fmt(data.salvage.scrap_earned)} />
          <Row label="Reforges" value={fmt(data.reforges)} />
        </Section>
      </MobileCard>
    </div>
  );
};
