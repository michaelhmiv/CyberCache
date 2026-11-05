/**
 * ProfileRecordPlates — PROTOTYPE (design/hunter-subpages-profile,
 * 2026-11-05). The Profile stop recomposed as a HALL OF RECORDS:
 * machined plates from the boss-arena family (BossArenaPlate's frame,
 * scrim, bone ink, foot strip) instead of the shipped card list.
 *
 * Composition law for this page:
 *  - One record, one printing: every lifetime number appears ONCE,
 *    as a gauge in an inset well or a stamped row — the shipped page
 *    printed kills/deaths three times (stat grid, Field Stats,
 *    Lifetime) and collection counts twice.
 *  - Numbers are the heroes: gauge numerals at 26–30px in the plate
 *    face; labels ride at the 11px floor in bone-tinted mute.
 *  - Shares are tallies: kills by area / weapon type render as
 *    engraved bars in inset wells, bone-white fill, never a
 *    colored side bar anywhere on the page.
 *  - Amber means action waiting (unspent points) and the one door
 *    strip (Totals & Sources) — nothing decorative.
 *
 * Data discipline: the combat plate reads the /stats/me summary
 * (PlayerPublicStats — the combat_stats display row + profile
 * fields); the career plate reads the same summary's progression
 * fields; the server-folded lifetime record keeps its own panel
 * (LifetimeStatsPanel) below. No number is computed here that the
 * payloads do not carry.
 */
import React from 'react';
import { PxIcon } from '@/components/pixelArt/PxIcon';
import { BOSS_PLATE_FRAME, bossArt } from '@/lib/pixel/bossIdentity';
import { formatDuration } from '@/lib/stats/statsHelpers';

export const BONE = '#F5EFE6';
const BONE_MUTE = '#C9BBA3';
const BONE_DIM = '#9A8A6E';
const PLATE_BG = '#14100B';
const WELL_BG = '#0A0705';
const GROOVE = '#2E2113';
const PLATE_FONT = '"Chakra Petch", sans-serif';
const DISPLAY_FONT = '"Bebas Neue", "Chakra Petch", sans-serif';

const CLIP = 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)';

const Bolt: React.FC<{ style: React.CSSProperties }> = ({ style }) => (
  <span
    aria-hidden="true"
    className="absolute h-[5px] w-[5px]"
    style={{ backgroundColor: '#4A3823', boxShadow: 'inset 0 0 0 1px #0A0705, 0 0 0 1px rgba(245,239,230,0.14)', ...style }}
  />
);

/** The machined plate frame — the page's one container grammar. */
export const Plate: React.FC<{
  children: React.ReactNode;
  footColor?: string;
  testId?: string;
  className?: string;
}> = ({ children, footColor, testId, className = '' }) => (
  <div
    data-testid={testId}
    className={`relative ${className}`}
    style={{
      backgroundColor: PLATE_BG,
      border: `2px solid ${BOSS_PLATE_FRAME}`,
      boxShadow: `inset 0 0 0 1px ${GROOVE}`,
      clipPath: CLIP,
    }}
  >
    <Bolt style={{ top: 5, left: 5 }} />
    <Bolt style={{ top: 5, right: 5 }} />
    <Bolt style={{ bottom: footColor ? 9 : 5, left: 5 }} />
    <Bolt style={{ bottom: footColor ? 9 : 5, right: 5 }} />
    {children}
    {footColor && <div aria-hidden="true" style={{ height: 4, backgroundColor: footColor }} />}
  </div>
);

/** Engraved section band inside a plate — a groove, not a card edge. */
export const PlateBand: React.FC<{ label: string; right?: string }> = ({ label, right }) => (
  <div className="flex items-baseline gap-2 px-3.5 pt-3">
    <div className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: BONE, fontFamily: PLATE_FONT }}>
      {label}
    </div>
    <div aria-hidden="true" className="h-px flex-1" style={{ backgroundColor: GROOVE }} />
    {right && (
      <div className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_DIM }}>
        {right}
      </div>
    )}
  </div>
);

/** A numeral in an inset well — the page's hero unit. */
export const GaugeWell: React.FC<{
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}> = ({ label, value, sub, accent = false }) => (
  <div
    className="min-w-0 flex-1 px-2 py-2 text-center"
    style={{ backgroundColor: WELL_BG, boxShadow: `inset 0 0 0 1px ${GROOVE}, inset 0 2px 6px rgba(0,0,0,0.7)` }}
  >
    <div
      className="truncate text-[26px] font-black leading-none"
      style={{ color: accent ? '#FFA01F' : BONE, fontFamily: PLATE_FONT }}
    >
      {value}
    </div>
    <div className="mt-1 text-[11px] font-bold uppercase leading-tight tracking-wide" style={{ color: BONE_MUTE }}>
      {label}
    </div>
    {sub && (
      <div className="text-[11px] leading-tight" style={{ color: BONE_DIM }}>
        {sub}
      </div>
    )}
  </div>
);

/** A stamped record row — tappable rows keep the detail sheets. */
const RecordRow: React.FC<{
  label: string;
  value: string;
  onClick?: () => void;
  testId?: string;
}> = ({ label, value, onClick, testId }) => {
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate text-[13px] font-bold" style={{ color: BONE_MUTE }}>
        {label}
      </span>
      <span className="shrink-0 text-xl font-black leading-none" style={{ color: BONE, fontFamily: PLATE_FONT }}>
        {value}
      </span>
      {onClick && <PxIcon name="chevR" size={13} style={{ color: BONE_DIM }} />}
    </>
  );
  const cls = 'flex w-full items-center gap-2 px-3.5 py-2 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} data-testid={testId} className={`${cls} transition-transform active:scale-[0.99]`} style={{ minHeight: 44 }}>
      {body}
    </button>
  ) : (
    <div className={cls} style={{ minHeight: 44 }} data-testid={testId}>
      {body}
    </div>
  );
};

export interface CareerRow {
  label: string;
  value: string;
  onClick?: () => void;
  testId?: string;
}
export interface CareerGroup {
  title: string;
  rows: CareerRow[];
}

/** The career record: ONE slab, four engraved groups. */
export const CareerRecordPlate: React.FC<{ groups: CareerGroup[] }> = ({ groups }) => (
  <Plate testId="profile-career-plate">
    <div className="pb-2 pt-1">
      {groups.map((group, gi) => (
        <div key={group.title}>
          {gi > 0 && <div aria-hidden="true" className="mx-3.5 mt-1" style={{ borderTop: `2px groove ${GROOVE}` }} />}
          <PlateBand label={group.title} />
          <div>
            {group.rows.map((row) => (
              <RecordRow key={row.label} {...row} />
            ))}
          </div>
        </div>
      ))}
    </div>
  </Plate>
);

/** Share tally — an engraved bar in an inset well. */
const TallyRow: React.FC<{ name: string; count: number; max: number }> = ({ name, count, max }) => (
  <div className="px-3.5 py-1.5">
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-[13px] font-bold" style={{ color: BONE_MUTE }}>
        {name}
      </span>
      <span className="shrink-0 text-[15px] font-black" style={{ color: BONE, fontFamily: PLATE_FONT }}>
        {count.toLocaleString()}
      </span>
    </div>
    <div className="mt-1 h-2" style={{ backgroundColor: WELL_BG, boxShadow: `inset 0 0 0 1px ${GROOVE}` }}>
      <div
        className="h-full"
        style={{ width: `${max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0}%`, backgroundColor: BONE, opacity: 0.85 }}
      />
    </div>
  </div>
);

export interface CombatRecordData {
  totalKills: number;
  totalDeaths: number;
  kdText: string;
  longestStreak: number;
  highestBossTier: number;
  activeSeconds: number;
  idleSeconds: number;
  topAreas: Array<{ name: string; count: number }>;
  topWeaponTypes: Array<{ name: string; count: number }>;
}

/** The combat record plate — K/D is the hero gauge of the page. */
export const CombatRecordPlate: React.FC<{ data: CombatRecordData }> = ({ data }) => {
  const maxArea = Math.max(1, ...data.topAreas.map((a) => a.count));
  const maxType = Math.max(1, ...data.topWeaponTypes.map((t) => t.count));
  return (
    <Plate testId="profile-combat-plate" footColor="#FF4B5C">
      <PlateBand label="Combat Record" right="Stats summary" />
      <div className="flex gap-2 px-3.5 pb-1 pt-2.5">
        <GaugeWell label="K / D" value={data.kdText} sub={`${data.totalKills.toLocaleString()} kills · ${data.totalDeaths.toLocaleString()} deaths`} />
        <GaugeWell label="Best Streak" value={data.longestStreak.toLocaleString()} />
        <GaugeWell label="Boss Tier" value={String(data.highestBossTier)} sub="highest cleared" />
      </div>
      <div className="flex items-baseline justify-between px-3.5 pb-1 pt-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_DIM }}>
          Time in the field
        </span>
        <span className="text-[13px] font-black" style={{ color: BONE, fontFamily: PLATE_FONT }}>
          {formatDuration(data.activeSeconds)} active · {formatDuration(data.idleSeconds)} idle
        </span>
      </div>
      <div aria-hidden="true" className="mx-3.5" style={{ borderTop: `2px groove ${GROOVE}` }} />
      <PlateBand label="Kills by Area" />
      {data.topAreas.length === 0 ? (
        <div className="px-3.5 py-2 text-[13px]" style={{ color: BONE_MUTE }}>No kills on record yet.</div>
      ) : (
        data.topAreas.map((a) => <TallyRow key={a.name} name={a.name} count={a.count} max={maxArea} />)
      )}
      <PlateBand label="Kills by Weapon" />
      {data.topWeaponTypes.length === 0 ? (
        <div className="px-3.5 py-2 pb-3 text-[13px]" style={{ color: BONE_MUTE }}>No kills on record yet.</div>
      ) : (
        <div className="pb-2">
          {data.topWeaponTypes.map((t) => <TallyRow key={t.name} name={t.name} count={t.count} max={maxType} />)}
        </div>
      )}
    </Plate>
  );
};

/** The identity plate — the boss plate's hero, promoted to a person. */
export const RecordHeroPlate: React.FC<{
  name: string;
  handleLine: React.ReactNode;
  level: number;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  joinedLabel: string;
  unspentPoints: number;
  onOpenTrees: () => void;
  children?: React.ReactNode;
}> = ({ name, handleLine, level, xp, xpToNext, xpProgress, joinedLabel, unspentPoints, onOpenTrees, children }) => {
  const art = bossArt('dune_tyrant');
  return (
    <Plate testId="profile-hero-plate">
      <div className="relative overflow-hidden">
        {art && (
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{ backgroundImage: `url(${art.arenaUrl})`, backgroundSize: 'cover', backgroundPosition: '50% 30%', filter: 'brightness(0.55)' }}
          />
        )}
        {/* Hard scrim — the boss plate's own device: text lives on it. */}
        <div className="relative mr-[26%] px-3.5 py-3" style={{ backgroundColor: 'rgba(10,7,5,0.9)' }}>
          <div
            className="break-words text-[30px] font-black uppercase leading-[0.95]"
            style={{ color: BONE, fontFamily: DISPLAY_FONT, letterSpacing: '0.04em', textShadow: '2px 2px 0 rgba(0,0,0,0.8)' }}
          >
            {name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px]" style={{ color: BONE_MUTE }}>
            {handleLine}
          </div>
          <div className="mt-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_DIM }}>
            {joinedLabel}
          </div>
        </div>
        {/* Level gauge — an inset well riding the painting's edge. */}
        <div
          className="absolute bottom-3 right-3 px-2.5 py-1.5 text-center"
          style={{ backgroundColor: WELL_BG, boxShadow: `inset 0 0 0 1px ${GROOVE}, inset 0 2px 6px rgba(0,0,0,0.7)` }}
        >
          <div className="text-[30px] font-black leading-none" style={{ color: BONE, fontFamily: PLATE_FONT }}>
            {level}
          </div>
          <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_MUTE }}>
            Level
          </div>
        </div>
      </div>
      <div className="px-3.5 pb-3 pt-2.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-black" style={{ color: BONE, fontFamily: PLATE_FONT }}>
            {xp.toLocaleString()} / {xpToNext.toLocaleString()} XP
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: BONE_DIM }}>
            {xpProgress}% to next level
          </span>
        </div>
        <div className="mt-1.5 h-2" style={{ backgroundColor: WELL_BG, boxShadow: `inset 0 0 0 1px ${GROOVE}` }}>
          <div className="h-full" style={{ width: `${Math.min(100, xpProgress)}%`, backgroundColor: '#FFA01F' }} />
        </div>
        {unspentPoints > 0 && (
          <button
            type="button"
            onClick={onOpenTrees}
            data-testid="profile-points-chip"
            className="mt-2.5 flex min-h-[44px] w-full items-center justify-center gap-2 px-3 text-[13px] font-black uppercase tracking-wide transition-transform active:scale-[0.99]"
            style={{ backgroundColor: '#FFA01F', color: '#171008', fontFamily: PLATE_FONT }}
          >
            <PxIcon name="nodes" size={15} />
            {unspentPoints} skill point{unspentPoints === 1 ? '' : 's'} to spend
          </button>
        )}
        {children}
      </div>
    </Plate>
  );
};

/** Totals & Sources as a plate door — foot strip, gauge icon. */
export const TotalsDoorPlate: React.FC<{ onOpen: () => void }> = ({ onOpen }) => (
  <button type="button" onClick={onOpen} data-testid="profile-totals-sources-door" className="block w-full text-left transition-transform active:scale-[0.99]">
    <Plate footColor="#FFA01F">
      <div className="flex min-h-[44px] items-center gap-3 px-3.5 py-3">
        <PxIcon name="chart" size={26} style={{ color: '#FFA01F' }} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-black uppercase tracking-wide" style={{ color: BONE, fontFamily: PLATE_FONT }}>
            Totals &amp; Sources
          </div>
          <div className="text-[11px] leading-snug" style={{ color: BONE_MUTE }}>
            Every effective stat for your current build — and exactly where each number comes from
          </div>
        </div>
        <PxIcon name="chevR" size={17} style={{ color: BONE_DIM }} />
      </div>
    </Plate>
  </button>
);
