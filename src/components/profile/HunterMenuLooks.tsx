/**
 * HunterMenuLooks — PROTOTYPE chrome, pass 2 (branch
 * design/hunter-menu-prototype, 2026-11-04; NEVER shipped from this
 * branch). Pass 1 proved the Hub skeleton (hero + live-status doors,
 * cosmetics at the tail) and failed on LOOK: every door was the
 * shipped MobileCard grammar — dark card, rarity-colored LEFT BAR —
 * rearranged. The owner called the side bars "ai slop" and ordered
 * the design skill unrestrained.
 *
 * This file is three complete visual LANGUAGES for the same skeleton.
 * Shared laws in all three: NO colored side bar anywhere (color lives
 * in numerals, chips, foot strips, or light), PxIcon only, 11px type
 * floor, ≥44dp doors, numbers as heroes, amber means "action waiting"
 * and nothing else decorative.
 *
 *  A · ARENA PLATES — the boss-arena plate register promoted to a
 *     menu: clipped corners, machined frame + steel inset line,
 *     corner bolts, hard-scrim text, foot strips, gauge numerals.
 *     The hero plate carries a real arena painting behind its scrim.
 *  B · THE MANIFEST — no containers at all: a stamped field ledger.
 *     Bebas display names, hairline rules, tabular data lines, hero
 *     numerals in bone white; the points announcement is a rotated
 *     rubber-stamp tag, the page's one loud object.
 *  C · LID & LATCH — the menu as the inside of the cache lid: rust-
 *     brown plank ground, doors as banded crate faces with stenciled
 *     labels and packing-list contents lines, latch blocks on the
 *     right edge. The Skill Trees crate's lid is ajar — an amber-glow
 *     seam — because points are waiting; every other crate sits shut.
 */
import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { bossArt } from '@/lib/pixel/bossIdentity';
import type { ResearchStatusLine } from './HunterMenuChrome';

export type HunterMenuLook = 'plates' | 'manifest' | 'crate';

export interface HubDoorDatum {
  testId: string;
  icon: PxIconName;
  label: string;
  status: string;
  hero?: string;
  badge?: number;
  /** Tail doors (wardrobe / account / profile) render quieter. */
  quiet?: boolean;
  onClick: () => void;
}

export interface HubLookProps {
  level: number;
  name: string;
  handleLine: React.ReactNode;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  availableSkillPoints: number;
  earningsCount: number;
  research: ResearchStatusLine | null;
  treeSpent: { label: string; spent: number }[];
  /** Hub order: trees, research, cacheRank, standings, collections,
   *  wardrobe, account, profile. */
  doors: HubDoorDatum[];
  onOpenTrees: () => void;
  onOpenStandings: () => void;
  onOpenResearch: () => void;
}

const pct = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;
const BONE = '#F5EFE6';
const BONE_MUTED = '#C9BBA6';
const BONE_FAINT = '#968A78';
const STEEL = '#6B6257';
const AMBER = '#FF9000';
const AMBER_GLOW = '#FFEA3A';

const treeLine = (treeSpent: HubLookProps['treeSpent']) =>
  treeSpent.map((t) => `${t.label} ${t.spent}`).join(' · ');

/* ================================================================
 * A · ARENA PLATES
 * ================================================================ */

const PLATE_CLIP =
  'polygon(12px 0, 100% 0, 100% calc(100% - 12px), calc(100% - 12px) 100%, 0 100%, 0 12px)';

const plateShell: React.CSSProperties = {
  clipPath: PLATE_CLIP,
  border: '2px solid #000',
  background: 'linear-gradient(158deg, #1D1811 0%, #12100C 58%, #0C0A08 100%)',
  boxShadow: '5px 5px 0 rgba(0,0,0,0.75), inset 0 0 0 1px rgba(163,152,134,0.28)',
};

/** Machined corner bolts — 5px squares, black with a steel top edge. */
const Bolts: React.FC = () => (
  <>
    {['left-[7px] top-[7px]', 'right-[7px] top-[7px]', 'bottom-[7px] left-[7px]', 'bottom-[7px] right-[7px]'].map(
      (pos) => (
        <span
          key={pos}
          aria-hidden="true"
          className={`absolute ${pos} h-[5px] w-[5px]`}
          style={{ backgroundColor: '#060504', boxShadow: 'inset 0 1px 0 rgba(201,187,166,0.5)' }}
        />
      ),
    )}
  </>
);

const PlateFootStrip: React.FC<{ color: string; height?: number }> = ({ color, height = 4 }) => (
  <div aria-hidden="true" className="absolute inset-x-0 bottom-0" style={{ height, backgroundColor: color }} />
);

const PlatesHero: React.FC<HubLookProps> = (p) => {
  const art = bossArt('dune_tyrant');
  return (
    <div className="relative overflow-hidden" style={plateShell}>
      {art && (
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            backgroundImage: `url(${art.arenaUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: '50% 32%',
            filter: 'brightness(0.62)',
          }}
        />
      )}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg, rgba(10,7,5,0.94) 52%, rgba(10,7,5,0.45) 100%)' }}
      />
      <Bolts />
      <div className="relative px-4 pb-4 pt-3.5">
        <div className="flex items-start gap-3">
          <div
            className="flex h-[54px] w-[54px] shrink-0 flex-col items-center justify-center"
            style={{ border: `2px solid ${STEEL}`, backgroundColor: 'rgba(6,5,4,0.82)' }}
          >
            <span className="text-[19px] font-black leading-none" style={{ color: BONE }}>
              {p.level}
            </span>
            <span className="mt-0.5 text-[11px] font-bold uppercase leading-none" style={{ color: BONE_FAINT }}>
              Level
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div
              className="break-words text-[21px] font-black uppercase leading-tight tracking-wide"
              style={{ color: BONE }}
            >
              {p.name}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-xs" style={{ color: BONE_MUTED }}>
              {p.handleLine}
            </div>
            <div className="mt-1 text-[11px] font-semibold" style={{ color: BONE_FAINT }}>
              {p.xp.toLocaleString()} / {p.xpToNext.toLocaleString()} XP · {p.xpProgress}% to Level {p.level + 1}
            </div>
          </div>
        </div>
        {(p.availableSkillPoints > 0 || p.earningsCount > 0 || p.research) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {p.availableSkillPoints > 0 && (
              <button
                type="button"
                data-testid="hunter-announce-points"
                onClick={p.onOpenTrees}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-black"
                style={{ backgroundColor: AMBER, border: '2px solid #000', boxShadow: '3px 3px 0 rgba(0,0,0,0.7)' }}
              >
                <PxIcon name="nodes" size={13} />
                {p.availableSkillPoints} skill points to spend
              </button>
            )}
            {p.earningsCount > 0 && (
              <button
                type="button"
                data-testid="hunter-announce-earnings"
                onClick={p.onOpenStandings}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide"
                style={{ border: `2px solid ${AMBER}`, color: AMBER, backgroundColor: 'rgba(6,5,4,0.7)' }}
              >
                <PxIcon name="flag" size={13} />
                {p.earningsCount} race rewards banked
              </button>
            )}
            {p.research && (
              <button
                type="button"
                data-testid="hunter-announce-research"
                onClick={p.onOpenResearch}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide"
                style={{ border: `2px solid ${STEEL}`, color: BONE_MUTED, backgroundColor: 'rgba(6,5,4,0.7)' }}
              >
                <PxIcon name="book" size={13} />
                {p.research.courseLabel} · {pct(p.research.progress)}
              </button>
            )}
          </div>
        )}
      </div>
      <PlateFootStrip color={STEEL} />
    </div>
  );
};

const PlatesTreesDoor: React.FC<{ door: HubDoorDatum; treeSpent: HubLookProps['treeSpent']; points: number }> = ({
  door,
  treeSpent,
  points,
}) => (
  <button
    type="button"
    data-testid={door.testId}
    onClick={door.onClick}
    className="relative block w-full overflow-hidden text-left transition-transform active:scale-[0.99]"
    style={plateShell}
  >
    <Bolts />
    <div className="relative px-4 pb-4 pt-3">
      <div className="flex items-start gap-3">
        <div
          className="bl-well flex h-10 w-10 shrink-0 items-center justify-center"
          style={{ color: BONE }}
        >
          <PxIcon name={door.icon} size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-black uppercase tracking-wide" style={{ color: BONE }}>
            {door.label}
          </div>
          <div className="text-[11px] font-semibold" style={{ color: points > 0 ? AMBER : BONE_FAINT }}>
            {points > 0 ? `${points} points unspent` : 'All points spent'}
          </div>
        </div>
        {points > 0 && (
          <div className="shrink-0 text-right">
            <div className="text-[26px] font-black leading-none" style={{ color: AMBER_GLOW }}>
              {points}
            </div>
            <div className="mt-0.5 text-[11px] font-bold uppercase leading-none" style={{ color: BONE_FAINT }}>
              Unspent
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 space-y-1.5">
        {treeSpent.map((t) => (
          <div key={t.label} className="flex items-center gap-2">
            <span className="w-[74px] shrink-0 truncate text-[11px] font-bold uppercase" style={{ color: BONE_MUTED }}>
              {t.label}
            </span>
            <span className="flex gap-[3px]" aria-hidden="true">
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={i}
                  className="h-[7px] w-[7px]"
                  style={{ backgroundColor: i < t.spent ? BONE : '#2C2620' }}
                />
              ))}
            </span>
            <span className="text-[11px] font-black" style={{ color: BONE }}>
              {t.spent}
            </span>
          </div>
        ))}
      </div>
    </div>
    <PlateFootStrip color={points > 0 ? AMBER : STEEL} />
  </button>
);

const PlatesDoor: React.FC<{ door: HubDoorDatum }> = ({ door }) => (
  <button
    type="button"
    data-testid={door.testId}
    onClick={door.onClick}
    className="relative block w-full overflow-hidden text-left transition-transform active:scale-[0.98]"
    style={plateShell}
  >
    <Bolts />
    <div className="relative px-3 pb-3.5 pt-2.5">
      <div className="flex items-start justify-between gap-2">
        <div
          className="bl-well flex h-9 w-9 shrink-0 items-center justify-center"
          style={{ color: door.quiet ? BONE_FAINT : BONE }}
        >
          <PxIcon name={door.icon} size={15} />
        </div>
        {door.hero && (
          <div className="text-[19px] font-black leading-none" style={{ color: BONE }}>
            {door.hero}
          </div>
        )}
        {door.badge !== undefined && door.badge > 0 && (
          <span
            className="px-1.5 py-0.5 text-[11px] font-black leading-none text-black"
            style={{ backgroundColor: AMBER, border: '1.5px solid #000' }}
          >
            {door.badge}
          </span>
        )}
      </div>
      <div
        className="mt-2 text-[13px] font-black uppercase leading-tight tracking-wide"
        style={{ color: door.quiet ? BONE_MUTED : BONE }}
      >
        {door.label}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
        {door.status}
      </div>
    </div>
    <PlateFootStrip color={door.badge ? AMBER : '#3A342B'} height={3} />
  </button>
);

const PlatesWideDoor: React.FC<{ door: HubDoorDatum }> = ({ door }) => (
  <button
    type="button"
    data-testid={door.testId}
    onClick={door.onClick}
    className="relative block w-full overflow-hidden text-left transition-transform active:scale-[0.99]"
    style={plateShell}
  >
    <Bolts />
    <div className="relative flex items-center gap-3 px-4 py-3">
      <div className="bl-well flex h-9 w-9 shrink-0 items-center justify-center" style={{ color: BONE_FAINT }}>
        <PxIcon name={door.icon} size={15} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-black uppercase tracking-wide" style={{ color: BONE_MUTED }}>
          {door.label}
        </div>
        <div className="truncate text-[11px]" style={{ color: BONE_FAINT }}>
          {door.status}
        </div>
      </div>
      <PxIcon name="chevs" size={14} className="shrink-0" />
    </div>
    <PlateFootStrip color="#3A342B" height={3} />
  </button>
);

const PlatesLanding: React.FC<HubLookProps> = (p) => {
  const [trees, research, cacheRank, standings, collections, wardrobe, account, profile] = p.doors;
  return (
    <>
      <PlatesHero {...p} />
      <PlatesTreesDoor door={trees} treeSpent={p.treeSpent} points={p.availableSkillPoints} />
      <div className="grid grid-cols-2 gap-2">
        <PlatesDoor door={research} />
        <PlatesDoor door={cacheRank} />
        <PlatesDoor door={standings} />
        <PlatesDoor door={collections} />
        <PlatesDoor door={wardrobe} />
        <PlatesDoor door={account} />
      </div>
      <PlatesWideDoor door={profile} />
    </>
  );
};

/* ================================================================
 * B · THE MANIFEST — a stamped field ledger. No containers.
 * ================================================================ */

const RULE = '#2C2620';

const ManifestHero: React.FC<HubLookProps> = (p) => (
  <div>
    <div aria-hidden="true" style={{ height: 2, backgroundColor: BONE }} />
    <div className="bl-title mt-3 text-[40px] leading-[0.95]" style={{ color: BONE }}>
      {p.name}
    </div>
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: BONE_FAINT }}>
      {p.handleLine}
    </div>
    <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 text-[12px] font-bold" style={{ color: BONE_MUTED }}>
      <span>
        LV <span style={{ color: BONE }}>{p.level}</span>
      </span>
      <span aria-hidden="true" style={{ color: BONE_FAINT }}>/</span>
      <span>
        <span style={{ color: BONE }}>{p.xp.toLocaleString()}</span> / {p.xpToNext.toLocaleString()} XP
      </span>
      <span aria-hidden="true" style={{ color: BONE_FAINT }}>/</span>
      <span>
        <span style={{ color: BONE }}>{p.xpProgress}%</span> TO NEXT
      </span>
    </div>
    <div aria-hidden="true" className="mt-2" style={{ height: 3, backgroundColor: '#241F19' }}>
      <div style={{ height: '100%', width: `${Math.min(100, p.xpProgress)}%`, backgroundColor: AMBER }} />
    </div>

    {(p.availableSkillPoints > 0 || p.earningsCount > 0 || p.research) && (
      <div className="mt-3.5 flex flex-col items-start gap-2.5">
        {p.availableSkillPoints > 0 && (
          <button
            type="button"
            data-testid="hunter-announce-points"
            onClick={p.onOpenTrees}
            className="bl-title inline-block px-3 py-1.5 text-[17px]"
            style={{
              color: AMBER,
              border: `2.5px solid ${AMBER}`,
              transform: 'rotate(-2deg)',
              boxShadow: '3px 3px 0 rgba(0,0,0,0.85)',
              backgroundColor: 'rgba(255,144,0,0.07)',
            }}
          >
            {p.availableSkillPoints} skill points unassigned
          </button>
        )}
        {p.earningsCount > 0 && (
          <button
            type="button"
            data-testid="hunter-announce-earnings"
            onClick={p.onOpenStandings}
            className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wide"
            style={{ color: BONE }}
          >
            <span aria-hidden="true" className="inline-block h-[7px] w-[7px]" style={{ backgroundColor: '#7CFC00' }} />
            {p.earningsCount} race rewards banked — Standings
          </button>
        )}
        {p.research && (
          <button
            type="button"
            data-testid="hunter-announce-research"
            onClick={p.onOpenResearch}
            className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide"
            style={{ color: BONE_MUTED }}
          >
            <span aria-hidden="true" className="inline-block h-[7px] w-[7px]" style={{ backgroundColor: BONE_MUTED }} />
            Research — {p.research.courseLabel} · {pct(p.research.progress)}
          </button>
        )}
      </div>
    )}
  </div>
);

const ManifestRow: React.FC<{ door: HubDoorDatum; big?: boolean; sub?: string }> = ({ door, big, sub }) => (
  <button
    type="button"
    data-testid={door.testId}
    onClick={door.onClick}
    className="flex w-full items-center gap-3 py-3 text-left"
    style={{ borderTop: `1px solid ${RULE}`, minHeight: 52 }}
  >
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
      style={{
        width: 30,
        height: 30,
        border: `1.5px solid ${door.quiet ? '#38322A' : STEEL}`,
        color: door.quiet ? BONE_FAINT : BONE,
      }}
    >
      <PxIcon name={door.icon} size={14} />
    </span>
    <span className="min-w-0 flex-1">
      <span
        className="bl-title block leading-none"
        style={{
          fontSize: big ? 27 : door.quiet ? 19 : 22,
          color: door.quiet ? BONE_MUTED : BONE,
        }}
      >
        {door.label}
      </span>
      {sub && (
        <span className="mt-1 block text-[11px] font-black uppercase tracking-wide" style={{ color: AMBER }}>
          {sub}
        </span>
      )}
      <span className="mt-1 block text-[11px] leading-snug" style={{ color: BONE_FAINT }}>
        {door.status}
      </span>
    </span>
    {door.badge !== undefined && door.badge > 0 && (
      <span
        className="shrink-0 px-1.5 py-0.5 text-[11px] font-black leading-none text-black"
        style={{ backgroundColor: AMBER }}
      >
        {door.badge}
      </span>
    )}
    {door.hero && (
      <span className="bl-title shrink-0 leading-none" style={{ fontSize: big ? 36 : 28, color: big ? AMBER_GLOW : BONE }}>
        {door.hero}
      </span>
    )}
    <PxIcon name="chevs" size={12} className="shrink-0 opacity-50" />
  </button>
);

const ManifestLanding: React.FC<HubLookProps> = (p) => {
  const [trees, research, cacheRank, standings, collections, wardrobe, account, profile] = p.doors;
  return (
    <div>
      <ManifestHero {...p} />
      <div className="mt-4">
        <ManifestRow
          door={{ ...trees, status: treeLine(p.treeSpent) }}
          big
          sub={p.availableSkillPoints > 0 ? `${p.availableSkillPoints} points unspent` : undefined}
        />
        <ManifestRow door={research} />
        <ManifestRow door={cacheRank} />
        <ManifestRow door={standings} />
        <ManifestRow door={collections} />
        <ManifestRow door={{ ...wardrobe, quiet: true }} />
        <ManifestRow door={{ ...account, quiet: true }} />
        <ManifestRow door={{ ...profile, quiet: true }} />
      </div>
      <div aria-hidden="true" style={{ height: 2, backgroundColor: BONE }} />
    </div>
  );
};

/* ================================================================
 * C · LID & LATCH — the inside of the cache lid.
 * ================================================================ */

const LID_BG = '#1D1109';
const CRATE_FACE = 'linear-gradient(180deg, #2C1B0F 0%, #221407 100%)';
const BAND = '#130B05';
const STENCIL = '#E9DCC3';
const STENCIL_MUTED = '#B49B78';
const STENCIL_FAINT = '#8A7154';

const CrateBolts: React.FC = () => (
  <>
    {['left-1.5', 'right-1.5'].map((pos) => (
      <span
        key={pos}
        aria-hidden="true"
        className={`absolute ${pos} top-1/2 h-[5px] w-[5px] -translate-y-1/2`}
        style={{ backgroundColor: '#050403', boxShadow: 'inset 0 1px 0 rgba(233,220,195,0.35)' }}
      />
    ))}
  </>
);

/** One crate face: metal bands top and bottom, stenciled label,
 *  packing-list contents line, latch blocks on the right when wide. */
const CrateFace: React.FC<{
  door: HubDoorDatum;
  contents: string;
  wide?: boolean;
  ajar?: boolean;
}> = ({ door, contents, wide, ajar }) => (
  <button
    type="button"
    data-testid={door.testId}
    onClick={door.onClick}
    className="relative block w-full overflow-hidden text-left transition-transform active:scale-[0.99]"
    style={{
      border: '2px solid #000',
      background: CRATE_FACE,
      boxShadow: ajar
        ? '5px 5px 0 rgba(0,0,0,0.75), 0 -6px 18px -2px rgba(255,144,0,0.4)'
        : '5px 5px 0 rgba(0,0,0,0.75)',
    }}
  >
    <div aria-hidden="true" className="relative" style={{ height: wide ? 10 : 7, backgroundColor: BAND }}>
      <CrateBolts />
    </div>
    {ajar && (
      <div
        aria-hidden="true"
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${AMBER} 0%, ${AMBER_GLOW} 50%, ${AMBER} 100%)`,
          boxShadow: '0 0 12px 2px rgba(255,144,0,0.55)',
        }}
      />
    )}
    <div className={`relative flex items-center gap-3 px-3 ${wide ? 'py-3' : 'py-2'}`}>
      <span
        aria-hidden="true"
        className="flex shrink-0 items-center justify-center"
        style={{
          width: wide ? 38 : 30,
          height: wide ? 38 : 30,
          backgroundColor: '#170E06',
          border: '2px solid #000',
          boxShadow: 'inset 0 0 0 1px rgba(233,220,195,0.14)',
          color: '#D8A24A',
        }}
      >
        <PxIcon name={door.icon} size={wide ? 16 : 13} />
      </span>
      <span className="min-w-0 flex-1">
        <span
          className="bl-title block leading-none"
          style={{ fontSize: wide ? 21 : 15, color: door.quiet ? STENCIL_MUTED : STENCIL }}
        >
          {door.label}
        </span>
        <span
          className="mt-1 block truncate text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: ajar ? AMBER : STENCIL_FAINT }}
        >
          {contents}
        </span>
      </span>
      {door.badge !== undefined && door.badge > 0 && (
        <span
          className="shrink-0 px-1.5 py-0.5 text-[11px] font-black leading-none text-black"
          style={{ backgroundColor: AMBER, border: '1.5px solid #000' }}
        >
          {door.badge}
        </span>
      )}
      {door.hero && (
        <span
          className="bl-title shrink-0 leading-none"
          style={{ fontSize: wide ? 30 : 20, color: ajar ? AMBER_GLOW : STENCIL }}
        >
          {door.hero}
        </span>
      )}
      {wide && (
        <span aria-hidden="true" className="relative ml-1 hidden h-9 w-[9px] shrink-0 min-[380px]:block">
          <span className="absolute inset-x-0 top-0 h-[13px]" style={{ backgroundColor: '#0D0803', boxShadow: 'inset 0 0 0 1px rgba(233,220,195,0.22)' }} />
          <span className="absolute inset-x-0 bottom-0 h-[13px]" style={{ backgroundColor: '#0D0803', boxShadow: 'inset 0 0 0 1px rgba(233,220,195,0.22)' }} />
        </span>
      )}
    </div>
    <div aria-hidden="true" className="relative" style={{ height: wide ? 10 : 7, backgroundColor: BAND }}>
      <CrateBolts />
    </div>
  </button>
);

const CrateHero: React.FC<HubLookProps> = (p) => (
  <div className="relative px-1 pb-1 pt-1">
    <div
      aria-hidden="true"
      className="bl-title absolute right-1 top-0 flex h-[52px] w-[52px] items-center justify-center rounded-full text-[15px]"
      style={{
        color: AMBER_GLOW,
        border: `2px solid ${AMBER}`,
        outline: '1.5px solid rgba(255,144,0,0.5)',
        outlineOffset: 2.5,
        transform: 'rotate(-4deg)',
        backgroundColor: 'rgba(255,144,0,0.06)',
      }}
    >
      LV {p.level}
    </div>
    <div className="bl-title pr-16 text-[31px] leading-[0.95]" style={{ color: STENCIL }}>
      {p.name}
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs" style={{ color: STENCIL_MUTED }}>
      {p.handleLine}
    </div>
    <div className="mt-3 flex items-center gap-2.5">
      <div
        aria-hidden="true"
        className="h-[9px] flex-1"
        style={{ backgroundColor: '#0F0803', border: '2px solid #000', boxShadow: 'inset 0 0 0 1px rgba(233,220,195,0.12)' }}
      >
        <div style={{ height: '100%', width: `${Math.min(100, p.xpProgress)}%`, backgroundColor: AMBER }} />
      </div>
      <span className="text-[11px] font-bold" style={{ color: STENCIL_MUTED }}>
        {p.xp.toLocaleString()} / {p.xpToNext.toLocaleString()} XP
      </span>
    </div>
    {(p.availableSkillPoints > 0 || p.earningsCount > 0 || p.research) && (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.availableSkillPoints > 0 && (
          <button
            type="button"
            data-testid="hunter-announce-points"
            onClick={p.onOpenTrees}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide"
            style={{ backgroundColor: '#150D05', border: `2px solid ${AMBER}`, color: AMBER }}
          >
            <PxIcon name="nodes" size={13} />
            {p.availableSkillPoints} skill points — unassigned
          </button>
        )}
        {p.earningsCount > 0 && (
          <button
            type="button"
            data-testid="hunter-announce-earnings"
            onClick={p.onOpenStandings}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide"
            style={{ backgroundColor: '#150D05', border: '2px solid #4A3826', color: STENCIL }}
          >
            <PxIcon name="flag" size={13} />
            {p.earningsCount} race rewards banked
          </button>
        )}
        {p.research && (
          <button
            type="button"
            data-testid="hunter-announce-research"
            onClick={p.onOpenResearch}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide"
            style={{ backgroundColor: '#150D05', border: '2px solid #4A3826', color: STENCIL_MUTED }}
          >
            <PxIcon name="book" size={13} />
            {p.research.courseLabel} · {pct(p.research.progress)}
          </button>
        )}
      </div>
    )}
  </div>
);

const CrateLanding: React.FC<HubLookProps> = (p) => {
  const [trees, research, cacheRank, standings, collections, wardrobe, account, profile] = p.doors;
  return (
    <div
      className="relative"
      style={{
        backgroundColor: LID_BG,
        border: '2px solid #000',
        boxShadow: 'inset 0 0 0 1px rgba(233,220,195,0.07)',
        backgroundImage:
          'repeating-linear-gradient(0deg, transparent 0px, transparent 118px, rgba(0,0,0,0.45) 118px, rgba(0,0,0,0.45) 120px)',
        padding: 12,
      }}
    >
      <div className="flex flex-col gap-3">
        <CrateHero {...p} />
        <CrateFace
          door={trees}
          wide
          ajar={p.availableSkillPoints > 0}
          contents={`Contents — ${p.treeSpent.length} trees · ${treeLine(p.treeSpent)}`}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <CrateFace door={research} contents={research.status} />
          <CrateFace door={cacheRank} contents={cacheRank.status} />
          <CrateFace door={standings} contents={standings.status} />
          <CrateFace door={collections} contents={collections.status} />
          <CrateFace door={{ ...wardrobe, quiet: true }} contents={wardrobe.status} />
          <CrateFace door={{ ...account, quiet: true }} contents={account.status} />
        </div>
        <CrateFace door={{ ...profile, quiet: true }} wide contents={profile.status} />
      </div>
    </div>
  );
};

/* ================================================================
 * Dispatcher + look back-rows (the trees-reached frame's chrome)
 * ================================================================ */

export const HubLookLanding: React.FC<HubLookProps & { look: HunterMenuLook }> = ({ look, ...p }) => {
  if (look === 'plates') return <PlatesLanding {...p} />;
  if (look === 'manifest') return <ManifestLanding {...p} />;
  return <CrateLanding {...p} />;
};

export const LookBackRow: React.FC<{ look: HunterMenuLook; stopLabel: string; onBack: () => void }> = ({
  look,
  stopLabel,
  onBack,
}) => {
  if (look === 'plates') {
    return (
      <div className="relative overflow-hidden" style={plateShell}>
        <div className="relative flex items-center justify-between px-3 py-2">
          <button
            type="button"
            data-testid="hunter-back-menu"
            onClick={onBack}
            className="flex items-center gap-1.5 py-1 text-xs font-black uppercase tracking-wide"
            style={{ color: BONE }}
          >
            <PxIcon name="chevs" size={13} className="-scale-x-100" />
            Hunter Menu
          </button>
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: BONE_FAINT }}>
            {stopLabel}
          </span>
        </div>
        <PlateFootStrip color={STEEL} height={3} />
      </div>
    );
  }
  if (look === 'manifest') {
    return (
      <div>
        <div className="flex items-center justify-between">
          <button
            type="button"
            data-testid="hunter-back-menu"
            onClick={onBack}
            className="flex items-center gap-1.5 py-1 text-xs font-black uppercase tracking-wide"
            style={{ color: BONE }}
          >
            <PxIcon name="chevs" size={13} className="-scale-x-100" />
            Hunter
          </button>
          <span className="bl-title text-[19px] leading-none" style={{ color: BONE }}>
            {stopLabel}
          </span>
        </div>
        <div aria-hidden="true" className="mt-1.5" style={{ height: 1, backgroundColor: RULE }} />
      </div>
    );
  }
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{ backgroundColor: BAND, border: '2px solid #000', boxShadow: 'inset 0 0 0 1px rgba(233,220,195,0.1)' }}
    >
      <button
        type="button"
        data-testid="hunter-back-menu"
        onClick={onBack}
        className="flex items-center gap-1.5 py-1 text-xs font-black uppercase tracking-wide"
        style={{ color: STENCIL }}
      >
        <PxIcon name="chevs" size={13} className="-scale-x-100" />
        Hunter Menu
      </button>
      <span className="bl-title text-[16px] leading-none" style={{ color: STENCIL_MUTED }}>
        {stopLabel}
      </span>
    </div>
  );
};
