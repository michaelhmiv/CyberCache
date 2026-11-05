/**
 * HunterPlates — the Hunter tab's Arena Plates register (owner pick
 * A, 2026-11-05; pass-2 look memo
 * design-briefs/hunter-menu-look-2026-11-04.md, anchor capture
 * hunter-menu-captures-2/look-plates/01-first-screen.png).
 *
 * The boss-arena plate register promoted to a menu: clipped corners,
 * machined frame + steel inset line, corner bolts, bone-white scrim
 * type, foot strips, numbers as gauges. Color lives in numerals,
 * chips, foot strips, and light — ZERO colored side bars anywhere
 * (owner law, 2026-11-04). The hero plate carries a real arena
 * painting (the Dune Tyrant's) behind its scrim.
 *
 * Every value these components print is derived by the caller from
 * the real profile — no fixture numbers live here.
 */
import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { bossArt } from '@/lib/pixel/bossIdentity';
import { AMBER, AMBER_GLOW, BONE, BONE_FAINT, BONE_MUTED, STEEL, plateShell } from './hunterPlateTheme';

/** Machined corner bolts — 5px squares, black with a steel top edge. */
export const Bolts: React.FC = () => (
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

export const PlateFootStrip: React.FC<{ color: string; height?: number }> = ({ color, height = 4 }) => (
  <div aria-hidden="true" className="absolute inset-x-0 bottom-0" style={{ height, backgroundColor: color }} />
);

/** The hub research line: the active course + its progress fraction
 *  (0..1), from the Chef research state — null when nothing is
 *  enrolled or the state has not loaded. */
export interface ResearchStatusLine {
  courseLabel: string;
  progress: number;
}

const pct = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;

export interface HubDoorDatum {
  testId: string;
  icon: PxIconName;
  label: string;
  status: string;
  hero?: string;
  badge?: number;
  /** Testid carried by the badge chip itself (the standings
   *  earnings notice has a pinned test contract). */
  badgeTestId?: string;
  /** Tail doors (wardrobe / account / profile) render quieter. */
  quiet?: boolean;
  onClick: () => void;
}

/**
 * The hero plate — identity as a boss-arena plate: the Dune Tyrant
 * arena painting behind the scrim, the level in its steel well, and
 * the announcements row (only what exists): unspent points get the
 * amber fill — the tab's one primary action; settled earnings and
 * the research clock ride quiet. Every chip is a door.
 */
export const HunterPlateHero: React.FC<{
  level: number;
  name: string;
  handleLine: React.ReactNode;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  availableSkillPoints: number;
  earningsCount: number;
  research: ResearchStatusLine | null;
  onOpenTrees: () => void;
  onOpenStandings: () => void;
  onOpenResearch: () => void;
}> = (p) => {
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
                className="flex min-h-[44px] items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-black"
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
                className="flex min-h-[44px] items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide"
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
                className="flex min-h-[44px] items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide"
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

/**
 * The Skill Trees door — the menu's lead plate: the build itself,
 * one segment ladder per tree (10 pips, lit = spent), and the
 * unspent count as a gauge numeral when points wait. The foot strip
 * goes amber only while an action waits.
 */
export const PlatesTreesDoor: React.FC<{
  door: HubDoorDatum;
  treeSpent: { label: string; spent: number }[];
  points: number;
}> = ({ door, treeSpent, points }) => (
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
        <div className="bl-well flex h-10 w-10 shrink-0 items-center justify-center" style={{ color: BONE }}>
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

/** A 2-up menu door: icon well, one hero numeral when the stop has
 *  a number worth printing, the live badge when news waits. */
export const PlatesDoor: React.FC<{ door: HubDoorDatum }> = ({ door }) => (
  <button
    type="button"
    data-testid={door.testId}
    onClick={door.onClick}
    className="relative block min-h-[44px] w-full overflow-hidden text-left transition-transform active:scale-[0.98]"
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
            data-testid={door.badgeTestId}
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

/** The wide tail door (Profile & Record): a horizontal plate — the
 *  record is one tap, printed last and quiet. */
export const PlatesWideDoor: React.FC<{ door: HubDoorDatum }> = ({ door }) => (
  <button
    type="button"
    data-testid={door.testId}
    onClick={door.onClick}
    className="relative block min-h-[44px] w-full overflow-hidden text-left transition-transform active:scale-[0.99]"
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

/**
 * The back row atop every opened stop: a plate bar — "Hunter Menu"
 * returns to the hub; the stop's name prints at the right in the
 * plate register. This row is the stop's header (each header prints
 * exactly once).
 */
export const PlatesBackRow: React.FC<{ stopLabel: string; onBack: () => void }> = ({ stopLabel, onBack }) => (
  <div className="relative overflow-hidden" style={plateShell}>
    <div className="relative flex items-center justify-between px-3 py-2">
      <button
        type="button"
        data-testid="hunter-back-menu"
        onClick={onBack}
        className="flex min-h-[44px] items-center gap-1.5 py-1 text-xs font-black uppercase tracking-wide"
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
