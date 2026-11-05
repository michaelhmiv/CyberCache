/**
 * ProfileTelemetryPage — PROTOTYPE (design/hunter-subpages-profile-b,
 * 2026-11-05). NOT shipped UI: the Profile page rebuilt in the
 * "Instrument panel" register for the Hunter-subpage design pass.
 *
 * The idea: where variant A engraves a record, B *measures* one.
 * The career is service telemetry from a machine that has been
 * running since enlistment — balances in LCD wells, level progress
 * as an LED channel, combat output as distribution channels with
 * exact counts, lifetime totals as a dense readout bank, and the
 * trophy shelf as pinned units with spec readouts. Every number
 * prints exactly once.
 *
 * Fixtures are the SAME hunter as every other variant in the pass
 * ("Rook Sandoval", Level 24) and are shaped exactly like the real
 * payloads: a PlayerPublicStats object (the /stats/me summary) and
 * the /profile/stats lifetime record. Showcase weapons are produced
 * by the game's own generator with the same seeds variant A used;
 * the Totals & Sources figures are computed from the pinned
 * weapon's real fields plus declared tree contributions, and each
 * metric's printed total is the sum of its printed contributions.
 */
import React, { useMemo, useState } from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { xpToNextLevel } from '@/content/simulation';
import { ELEMENTS } from '@/constants/elements';
import { RARITY_FRAME_STYLES } from '@/constants/weaponVisuals';
import { Element, DropSource, Rarity } from '@/types/game';
import type { PlayerPublicStats } from '@/lib/api/statsService';
import type { Weapon } from '@/types/items';
import { generateWeapon } from '@/server/lib/generators/weaponGenerator';
import { createTickRng } from '@/lib/rng/tickRng';
import {
  ChannelRow,
  GroupDatum,
  LcdWell,
  Led,
  LedMeter,
  Panel,
  PanelLabel,
  PushButton,
  ReadoutRow,
} from './telemetryKit';
import {
  AMBER,
  CYAN,
  displayStyle,
  FAINT,
  GOLD,
  GREEN,
  headStyle,
  INK,
  monoStyle,
  MUT,
  RED,
  STEEL,
} from './telemetryTokens';

/* ─── Fixtures — identical facts to variant A ─────────────────── */

const STATS: PlayerPublicStats = {
  user_id: 'fixture-rook',
  username: 'rook_sandoval',
  display_name: 'Rook Sandoval',
  player_level: 24,
  player_xp: Math.floor(xpToNextLevel(24) * 0.62),
  credits: 24100,
  scrap: 31600,
  cache_tokens: 15,
  total_kills: 12847,
  total_deaths: 312,
  kill_death_ratio: 41.18,
  highest_boss_tier: 7,
  longest_kill_streak: 46,
  active_play_seconds: 219600,
  idle_play_seconds: 1296000,
  kills_by_area: { dustwaste: 4213, scrapyard: 3087, sunken_relay: 2411, ashfall: 1736, helix_works: 1400 },
  kills_by_weapon_type: { pistol: 3912, smg: 3304, shotgun: 2618, rifle: 1905, sniper: 1108 },
  kills_by_element: { kinetic: 5200, incendiary: 2900, cryo: 2100, shock: 1600, void: 1047 },
  net_worth: 486200,
  total_items: 212,
  weapons_owned: 148,
  legendary_items: 9,
  highest_item_level: 31,
  total_mastery_xp: 182340,
  highest_mastery_level: 14,
  last_active_at: new Date().toISOString(),
  joined_at: '2026-06-14T00:00:00.000Z',
};

/** The /profile/stats lifetime record, trimmed to what this page prints. */
const LIFETIME = {
  credits: { earned: 894000, spent: 652000 },
  bosses: { attempts: 96, victories: 61 },
  endless: { runs: 31, best_depth: 23, deaths: 19 },
  caches_opened: 57,
  crafting_total: 342,
  dispatch: { completed: 44, foot: 30, courier: 14, credits_earned: 38600 },
  extraction: { passes: 26, xp_awarded: 19200 },
  market: { sales: 23, sales_volume: 96400, fees_paid: 4820 },
  salvage: { items: 1218, scrap_earned: 40200 },
  legendaries: { salvaged: 4, cores_minted: 3 },
  resurrections: 5,
  collections_discovered: 34,
  cache_rank_tokens: 140,
  cache_rank_total_ranks: 12,
};

const UNSPENT_POINTS = 5;
const RESEARCH_COURSE = 'Advanced Ballistics';
const RESEARCH_PCT = 62;
const DEATH_LOG = [
  { monsterName: 'Dune Tyrant', area: 'Dustwaste', when: '2D AGO' },
  { monsterName: 'Rust Prophet', area: 'Scrapyard', when: '5D AGO' },
];

/* ─── Small helpers ───────────────────────────────────────────── */

const fmt = (n: number) => n.toLocaleString('en-US');
const pct1 = (fraction: number) => `${(fraction * 100).toFixed(1)}%`;
const shareSegs = (value: number, total: number, segs = 20) =>
  value <= 0 ? 0 : Math.max(1, Math.round((value / total) * segs));

const AREA_NAMES: Record<string, string> = {
  dustwaste: 'Dustwaste',
  scrapyard: 'Scrapyard',
  sunken_relay: 'Sunken Relay',
  ashfall: 'Ashfall',
  helix_works: 'Helix Works',
};

const ELEMENT_OF_KEY: Record<string, Element> = {
  kinetic: Element.Kinetic,
  incendiary: Element.Fire,
  cryo: Element.Cryo,
  shock: Element.Shock,
  void: Element.Void,
};

/* ─── Page ────────────────────────────────────────────────────── */

export const ProfileTelemetryPage: React.FC = () => {
  const [view, setView] = useState<'record' | 'totals'>('record');

  const weapons = useMemo<Weapon[]>(() => {
    try {
      return [
        generateWeapon({ source: DropSource.BossDrop, level: 24, forcedRarity: Rarity.Legendary }, createTickRng('profile-demo', 'boss-a', 1)),
        generateWeapon({ source: DropSource.BossDrop, level: 22, forcedRarity: Rarity.Legendary }, createTickRng('profile-demo', 'boss-b', 2)),
        generateWeapon({ source: DropSource.RoamingDrop, level: 26, forcedRarity: Rarity.Epic }, createTickRng('profile-demo', 'roam-a', 3)),
      ];
    } catch {
      return [];
    }
  }, []);

  if (view === 'totals') {
    return <TotalsTelemetry weapons={weapons} onBack={() => setView('record')} />;
  }

  const xpNext = xpToNextLevel(STATS.player_level);
  const xpPct = Math.round((STATS.player_xp / xpNext) * 100);

  return (
    <div className="flex flex-col gap-3">
      {/* ── UNIT IDENTIFICATION ─────────────────────────────── */}
      <Panel testId="profile-unit-panel">
        <PanelLabel label="Unit Identification" right="SERVICE RECORD · LIVE" rightColor={GREEN} />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate leading-none" style={{ ...displayStyle, color: INK, fontSize: 34 }}>
              {STATS.display_name}
            </div>
            <div className="mt-1.5 text-[12px]" style={{ ...monoStyle, color: MUT }}>
              @{STATS.username} · ENLISTED 2026-06-14
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 pt-1">
            <span className="flex items-center gap-1.5">
              <Led lit color={GREEN} size={8} />
              <span className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: MUT }}>
                Verified
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <Led lit color={CYAN} size={8} />
              <span className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: MUT }}>
                Research {RESEARCH_PCT}%
              </span>
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <LcdWell value={String(STATS.player_level)} label="Level" valueSize={20} />
          <LcdWell value={fmt(STATS.credits)} label="Credits" valueSize={15} />
          <LcdWell value={fmt(STATS.scrap)} label="Scrap" valueSize={15} />
          <LcdWell value={String(STATS.cache_tokens)} label="Cache Keys" valueSize={20} color={GOLD} />
        </div>

        <div className="mt-3">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT, letterSpacing: '0.12em' }}>
              Level Progress
            </span>
            <span className="text-[12px] font-bold" style={{ ...monoStyle, color: INK }}>
              {fmt(STATS.player_xp)} / {fmt(xpNext)} XP · {xpPct}%
            </span>
          </div>
          <LedMeter filled={shareSegs(STATS.player_xp, xpNext)} total={20} color={GOLD} height={13} />
          <div className="mt-1.5 text-[11px]" style={{ ...monoStyle, color: FAINT }}>
            RESEARCH IN SESSION — {RESEARCH_COURSE.toUpperCase()} · {RESEARCH_PCT}% STUDIED
          </div>
        </div>

        <div className="mt-3">
          <PushButton
            label={`Spend ${UNSPENT_POINTS} Skill Points`}
            sub="Gunslinger 8 · Demolition 5 · Scavenger 5 · Fixer 0"
            ledColor={AMBER}
            accent={AMBER}
            testId="profile-points-door"
          />
        </div>
      </Panel>

      {/* ── COMBAT TELEMETRY ────────────────────────────────── */}
      <Panel testId="profile-combat-panel">
        <PanelLabel label="Combat Telemetry" right="ALL-TIME OUTPUT" />
        <LcdWell value={STATS.kill_death_ratio.toFixed(2)} label="Kill / Death Ratio" valueSize={36} color={GOLD} />
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          <LcdWell value={fmt(STATS.total_kills)} label="Kills" valueSize={15} />
          <LcdWell value={fmt(STATS.total_deaths)} label="Deaths" valueSize={15} />
          <LcdWell value={String(STATS.longest_kill_streak)} label="Best Streak" valueSize={20} />
          <LcdWell value={String(STATS.highest_boss_tier)} label="Boss Tier" valueSize={20} />
        </div>

        <GroupDatum label="Kills by Weapon" />
        {Object.entries(STATS.kills_by_weapon_type).map(([key, value]) => (
          <ChannelRow
            key={key}
            name={key}
            value={fmt(value)}
            filled={shareSegs(value, STATS.total_kills)}
            color={GOLD}
          />
        ))}

        <GroupDatum label="Kills by Element" />
        {Object.entries(STATS.kills_by_element).map(([key, value]) => (
          <ChannelRow
            key={key}
            name={key === 'incendiary' ? 'Fire' : key}
            value={fmt(value)}
            filled={shareSegs(value, STATS.total_kills)}
            color={ELEMENTS[ELEMENT_OF_KEY[key]].color}
          />
        ))}

        <GroupDatum label="Kills by Area" />
        {Object.entries(STATS.kills_by_area).map(([key, value]) => (
          <ChannelRow
            key={key}
            name={AREA_NAMES[key] ?? key}
            value={fmt(value)}
            filled={shareSegs(value, STATS.total_kills)}
            color={INK}
          />
        ))}

        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <LcdWell value={`${Math.round(STATS.active_play_seconds / 3600)} H`} label="Active Field Time" valueSize={18} />
          <LcdWell value={`${Math.round(STATS.idle_play_seconds / 3600)} H`} label="Idle Field Time" valueSize={18} />
        </div>
        <div className="mt-2.5 flex items-center gap-2">
          <Led lit color={RED} size={8} />
          <span className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: MUT, letterSpacing: '0.08em' }}>
            Last death — {DEATH_LOG[0].monsterName} · {DEATH_LOG[0].area} · {DEATH_LOG[0].when}
          </span>
        </div>
      </Panel>

      {/* ── CAREER TOTALS ───────────────────────────────────── */}
      <Panel testId="profile-career-panel">
        <PanelLabel label="Career Totals" right="SERVER-FOLDED RECORD" />
        <GroupDatum label="Economy" />
        <ReadoutRow label="Net Worth" value={fmt(STATS.net_worth)} detail="Credits, gear + stock at market" />
        <ReadoutRow label="Credits Earned" value={fmt(LIFETIME.credits.earned)} detail="Lifetime, all sources" />
        <ReadoutRow label="Credits Spent" value={fmt(LIFETIME.credits.spent)} detail="Lifetime, all sinks" />
        <ReadoutRow
          label="Market Sales"
          value={`${LIFETIME.market.sales} · ${fmt(LIFETIME.market.sales_volume)} CR`}
          detail={`Fees paid ${fmt(LIFETIME.market.fees_paid)} cr`}
        />
        <ReadoutRow
          label="Salvage"
          value={`${fmt(LIFETIME.salvage.items)} ITEMS`}
          detail={`${fmt(LIFETIME.salvage.scrap_earned)} scrap recovered`}
        />

        <GroupDatum label="Operations" />
        <ReadoutRow label="Boss Attempts" value={String(LIFETIME.bosses.attempts)} detail={`${LIFETIME.bosses.victories} victories`} />
        <ReadoutRow label="Endless Best Depth" value={String(LIFETIME.endless.best_depth)} detail={`${LIFETIME.endless.runs} runs · ${LIFETIME.endless.deaths} deaths`} />
        <ReadoutRow label="Caches Opened" value={String(LIFETIME.caches_opened)} />
        <ReadoutRow label="Units Crafted" value={String(LIFETIME.crafting_total)} detail="Consumable · material · tint" />
        <ReadoutRow
          label="Dispatch Jobs"
          value={String(LIFETIME.dispatch.completed)}
          detail={`${LIFETIME.dispatch.foot} foot · ${LIFETIME.dispatch.courier} courier · ${fmt(LIFETIME.dispatch.credits_earned)} cr earned`}
        />
        <ReadoutRow label="Extraction Passes" value={String(LIFETIME.extraction.passes)} detail={`${fmt(LIFETIME.extraction.xp_awarded)} XP awarded`} />
        <ReadoutRow label="Resurrections" value={String(LIFETIME.resurrections)} />

        <GroupDatum label="Mastery" />
        <ReadoutRow label="Total Mastery XP" value={fmt(STATS.total_mastery_xp)} />
        <ReadoutRow label="Highest Mastery" value={`LV ${STATS.highest_mastery_level}`} />

        <GroupDatum label="Collection" />
        <div className="flex min-h-[36px] items-center gap-2.5" style={{ borderBottom: '1px solid rgba(58,52,43,0.55)' }}>
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-bold uppercase leading-tight" style={{ ...monoStyle, color: MUT, letterSpacing: '0.1em' }}>
              Collection Logged
            </span>
            <span className="block text-[11px] leading-tight" style={{ ...monoStyle, color: FAINT }}>
              Effects · bosses · frames · elites
            </span>
          </span>
          <span className="w-[110px] shrink-0">
            <LedMeter filled={shareSegs(LIFETIME.collections_discovered, 81)} total={20} color={CYAN} height={11} />
          </span>
          <span className="shrink-0 text-[15px] font-bold" style={{ ...monoStyle, color: INK }}>
            {LIFETIME.collections_discovered} / 81
          </span>
        </div>
        <ReadoutRow
          label="Legendaries Found"
          value={String(STATS.legendary_items)}
          detail={`${LIFETIME.legendaries.salvaged} salvaged · ${LIFETIME.legendaries.cores_minted} cores minted`}
        />
        <ReadoutRow label="Items Held" value={fmt(STATS.total_items)} detail={`${STATS.weapons_owned} weapons`} />
        <ReadoutRow label="Highest Item Level" value={String(STATS.highest_item_level)} />
      </Panel>

      {/* ── PINNED UNITS (trophy shelf) ─────────────────────── */}
      <Panel testId="profile-showcase-panel">
        <PanelLabel label="Pinned Units" right="TROPHY SHELF · TOP 3" />
        <div className="flex flex-col">
          {weapons.map((w, i) => (
            <div
              key={w.id}
              className="flex items-start gap-2.5 py-2"
              style={{ borderBottom: i < weapons.length - 1 ? '1px solid rgba(58,52,43,0.55)' : undefined }}
            >
              <span className="pt-1">
                <Led lit color={RARITY_FRAME_STYLES[w.rarity].color} size={10} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[14px] font-bold leading-tight" style={{ ...headStyle, color: INK }}>
                    {w.name}
                  </span>
                  {i === 0 && (
                    <span className="shrink-0 text-[11px] font-black uppercase" style={{ ...monoStyle, color: GOLD, letterSpacing: '0.12em' }}>
                      Pinned
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] leading-tight" style={{ ...monoStyle, color: MUT }}>
                  LV {w.level} · {String(w.weaponType).toUpperCase()} · {String(w.manufacturer).toUpperCase()} ·{' '}
                  {RARITY_FRAME_STYLES[w.rarity].stamp}
                </span>
                <span className="block truncate text-[11px] leading-tight" style={{ ...monoStyle, color: FAINT }}>
                  DMG {Math.round(w.baseDamage)} · SPD {w.attackSpeed.toFixed(1)}/S · CRIT {pct1(w.critChance)} · ROLL Q
                  {Math.round(w.rollQuality)}
                </span>
              </span>
            </div>
          ))}
        </div>
        <ReadoutRow
          label="Cache Rank"
          value={`${LIFETIME.cache_rank_tokens} TOKENS`}
          detail={`${LIFETIME.cache_rank_total_ranks} ranks bought`}
        />
      </Panel>

      {/* ── TOTALS & SOURCES DOOR ───────────────────────────── */}
      <PushButton
        label="Totals & Sources"
        sub="Channel breakdown — where every number comes from"
        ledColor={AMBER}
        onClick={() => setView('totals')}
        testId="profile-totals-door"
      />

      {/* ── DOORS ───────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: 'Standings', icon: 'flag' as const },
          { label: 'Activity', icon: 'book' as const },
          { label: 'Account', icon: 'cog' as const },
        ].map((door) => (
          <button
            key={door.label}
            type="button"
            className="flex min-h-[52px] flex-col items-center justify-center gap-1 px-1 active:translate-y-[2px]"
            style={{
              border: '2px solid #000',
              background: 'linear-gradient(180deg, #241D15 0%, #171310 70%)',
              boxShadow: 'inset 0 0 0 1px rgba(163,152,134,0.35), 0 3px 0 #000',
              color: MUT,
            }}
          >
            <PxIcon name={door.icon} size={17} />
            <span className="text-[11px] font-black uppercase" style={{ ...headStyle, letterSpacing: '0.1em' }}>
              {door.label}
            </span>
          </button>
        ))}
      </div>
      <div className="pb-1 text-center text-[11px]" style={{ ...monoStyle, color: STEEL }}>
        END OF RECORD — {fmt(STATS.total_kills)} KILLS ON FILE
      </div>
    </div>
  );
};

/* ─── Totals & Sources — the detail state ─────────────────────── */

type Contribution = { source: string; detail: string; value: number; display: string; bucket: 'base' | 'gear' | 'tree' };
type Metric = { name: string; unit: string; contributions: Contribution[] };

const BUCKET_COLORS: Record<Contribution['bucket'], string> = {
  base: STEEL,
  gear: GOLD,
  tree: GREEN,
};

const CompositionMeter: React.FC<{ metric: Metric }> = ({ metric }) => {
  const total = metric.contributions.reduce((s, c) => s + Math.abs(c.value), 0) || 1;
  const SEGS = 24;
  const cells: string[] = [];
  for (const c of metric.contributions) {
    const n = Math.round((Math.abs(c.value) / total) * SEGS);
    for (let i = 0; i < n; i += 1) cells.push(BUCKET_COLORS[c.bucket]);
  }
  while (cells.length < SEGS) cells.push('#241C12');
  return (
    <div className="flex gap-[2px]" role="img" aria-label="Source composition">
      {cells.slice(0, SEGS).map((color, i) => (
        <span
          key={i}
          className="flex-1"
          style={{ height: 11, backgroundColor: color, border: '1px solid rgba(0,0,0,0.65)' }}
        />
      ))}
    </div>
  );
};

const TotalsTelemetry: React.FC<{ weapons: Weapon[]; onBack: () => void }> = ({ weapons, onBack }) => {
  const pinned = weapons[0];
  const metrics: Metric[] = useMemo(() => {
    if (!pinned) return [];
    const weaponDps = Math.round(pinned.baseDamage * pinned.attackSpeed);
    const treeDps = Math.round(weaponDps * 0.12);
    const critTree = 4;
    const critDmgTree = 25;
    const bossTree = 10;
    return [
      {
        name: 'Damage / Second',
        unit: 'DPS',
        contributions: [
          { source: pinned.name, detail: `Equipped primary · DMG ${Math.round(pinned.baseDamage)} × SPD ${pinned.attackSpeed.toFixed(1)}`, value: weaponDps, display: fmt(weaponDps), bucket: 'gear' },
          { source: 'Skill Trees', detail: 'Gunslinger damage nodes', value: treeDps, display: fmt(treeDps), bucket: 'tree' },
          { source: 'Base', detail: 'Unarmed baseline', value: 0, display: '0', bucket: 'base' },
        ],
      },
      {
        name: 'Crit Chance',
        unit: '%',
        contributions: [
          { source: pinned.name, detail: 'Weapon roll', value: pinned.critChance * 100, display: pct1(pinned.critChance), bucket: 'gear' },
          { source: 'Skill Trees', detail: 'Gunslinger crit nodes', value: critTree, display: `${critTree.toFixed(1)}%`, bucket: 'tree' },
        ],
      },
      {
        name: 'Crit Damage',
        unit: '%',
        contributions: [
          { source: pinned.name, detail: 'Weapon roll', value: pinned.critDamage * 100, display: pct1(pinned.critDamage), bucket: 'gear' },
          { source: 'Skill Trees', detail: 'Gunslinger crit nodes', value: critDmgTree, display: `${critDmgTree.toFixed(1)}%`, bucket: 'tree' },
        ],
      },
      {
        name: 'Boss Damage',
        unit: '%',
        contributions: [
          { source: pinned.name, detail: 'Weapon modifier', value: pinned.bossDamageMod * 100, display: pct1(pinned.bossDamageMod), bucket: 'gear' },
          { source: 'Skill Trees', detail: 'Demolition boss nodes', value: bossTree, display: `${bossTree.toFixed(1)}%`, bucket: 'tree' },
        ],
      },
    ];
  }, [pinned]);

  return (
    <div className="flex flex-col gap-3">
      <PushButton label="Back — Service Record" sub="Return to the career readout" onClick={onBack} testId="profile-totals-back" />
      <Panel testId="profile-totals-panel">
        <PanelLabel label="Totals & Sources" right="GENERAL · EQUIPPED BUILD" />
        <div className="mb-1 text-[12px] leading-snug" style={{ ...monoStyle, color: MUT }}>
          Every headline number on the record, opened into the channels that feed it. The total is the sum of its
          sources — nothing is counted twice.
        </div>
        {metrics.map((metric) => {
          const total = metric.contributions.reduce((s, c) => s + c.value, 0);
          return (
            <div key={metric.name} className="mt-4">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px] font-black uppercase" style={{ ...headStyle, color: INK, letterSpacing: '0.1em' }}>
                  {metric.name}
                </span>
                <span className="text-[19px] font-bold" style={{ ...monoStyle, color: GOLD }}>
                  {metric.unit === '%' ? `${total.toFixed(1)}%` : fmt(Math.round(total))}
                </span>
              </div>
              <div className="mt-1.5">
                <CompositionMeter metric={metric} />
              </div>
              {metric.contributions.map((c) => (
                <ReadoutRow
                  key={c.source}
                  label={c.source}
                  detail={c.detail}
                  value={c.display}
                  ledColor={BUCKET_COLORS[c.bucket]}
                  valueColor={c.value === 0 ? FAINT : INK}
                />
              ))}
            </div>
          );
        })}
        <div className="mt-4 flex items-center gap-4">
          {(['gear', 'tree', 'base'] as const).map((b) => (
            <span key={b} className="flex items-center gap-1.5">
              <Led lit color={BUCKET_COLORS[b]} size={8} />
              <span className="text-[11px] font-bold uppercase" style={{ ...monoStyle, color: FAINT }}>
                {b === 'gear' ? 'Gear' : b === 'tree' ? 'Trees' : 'Base'}
              </span>
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
};
