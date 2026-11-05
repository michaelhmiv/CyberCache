/**
 * HunterMenuChrome — PROTOTYPE chrome for the Hunter-menu design pass
 * (branch design/hunter-menu-prototype, 2026-11-04; NEVER shipped from
 * this branch). Three directions for bringing the Hunter tab's
 * substantive systems forward share these pieces:
 *
 *  - HunterHero      (Deck + Hub): identity plate with the tab's
 *                    announcements row — unspent skill points (the one
 *                    amber action), settled race earnings, the active
 *                    research course. Claims/announcements never hide.
 *  - ProgressionStrip (Strip): a persistent one-row summary that stays
 *                    mounted above the rail on every stop — level/XP,
 *                    unspent points, research progress.
 *  - HubDoor         (Hub): a menu door carrying LIVE status, not just
 *                    a label — the menu itself reports each system's
 *                    state before the player commits a tap.
 *  - DeckHeader      (Deck): section header for the one-scroll deck.
 *
 * Grammar follows DESIGN.md: PxIcon only, 11px type floor,
 * numbers are the heroes, amber marks the single primary action
 * (spending points) and nothing else decorative.
 */
import React from 'react';
import { PxIcon, type PxIconName } from '@/components/pixelArt/PxIcon';
import { MobileCard } from '@/components/layout/MobileCard';

export interface ResearchStatusLine {
  courseLabel: string;
  /** 0..1 */
  progress: number;
}

const pct = (fraction: number) => `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;

/** The announcements row shared by the hero (Deck/Hub): every line is
 *  a door. Unspent points get the amber fill — the tab's one primary
 *  action. Settled earnings and the research clock ride quiet. */
export const HunterAnnouncements: React.FC<{
  availableSkillPoints: number;
  earningsCount: number;
  research: ResearchStatusLine | null;
  onOpenTrees: () => void;
  onOpenStandings: () => void;
  onOpenResearch: () => void;
}> = ({ availableSkillPoints, earningsCount, research, onOpenTrees, onOpenStandings, onOpenResearch }) => {
  if (availableSkillPoints <= 0 && earningsCount <= 0 && !research) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {availableSkillPoints > 0 && (
        <button
          type="button"
          data-testid="hunter-announce-points"
          onClick={onOpenTrees}
          className="bl-primary flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide"
        >
          <PxIcon name="nodes" size={13} />
          {availableSkillPoints} skill point{availableSkillPoints === 1 ? '' : 's'} to spend
        </button>
      )}
      {earningsCount > 0 && (
        <button
          type="button"
          data-testid="hunter-announce-earnings"
          onClick={onOpenStandings}
          className="flex items-center gap-1.5 border-2 border-amber/60 bg-amber/15 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-amber"
        >
          <PxIcon name="flag" size={13} />
          {earningsCount} race reward{earningsCount === 1 ? '' : 's'} banked
        </button>
      )}
      {research && (
        <button
          type="button"
          data-testid="hunter-announce-research"
          onClick={onOpenResearch}
          className="flex items-center gap-1.5 border-2 border-border bg-surface px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-text-secondary"
        >
          <PxIcon name="book" size={13} className="text-blue" />
          {research.courseLabel} · {pct(research.progress)}
        </button>
      )}
    </div>
  );
};

/** Identity hero for the Deck and Hub directions: level plate, name,
 *  handle, XP numbers (the bar itself lives in the Strip, per the
 *  tab's standing discipline), then the announcements row. */
export const HunterHero: React.FC<{
  level: number;
  name: string;
  handleLine: React.ReactNode;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  announcements: React.ReactNode;
}> = ({ level, name, handleLine, xp, xpToNext, xpProgress, announcements }) => (
  <MobileCard className="space-y-3" rarityColor="#FF9000">
    <div className="flex items-center gap-3">
      <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center border-2 border-amber bg-amber/15 text-xl font-black text-amber">
        {level}
      </div>
      <div className="min-w-0 flex-1">
        <div className="break-words text-[19px] font-black uppercase leading-tight tracking-wide text-text-primary">{name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">{handleLine}</div>
        <div className="mt-0.5 text-[11px] text-text-muted">
          {xp.toLocaleString()} / {xpToNext.toLocaleString()} XP ({xpProgress}%) · Level {level}
        </div>
      </div>
    </div>
    {announcements}
  </MobileCard>
);

/** Direction B's persistent strip: mounted above the rail, identical
 *  on every stop, so progression state is never more than a glance
 *  away and unspent points announce on all seven stops. */
export const ProgressionStrip: React.FC<{
  level: number;
  xp: number;
  xpToNext: number;
  xpProgress: number;
  availableSkillPoints: number;
  research: ResearchStatusLine | null;
  onOpenTrees: () => void;
  onOpenResearch: () => void;
}> = ({ level, xp, xpToNext, xpProgress, availableSkillPoints, research, onOpenTrees, onOpenResearch }) => (
  <div
    data-testid="hunter-progression-strip"
    className="bl-card flex items-center gap-3 px-3 py-2"
    style={{ borderLeftColor: '#FF9000', borderLeftWidth: 5 }}
  >
    <div className="shrink-0 text-center">
      <div className="text-base font-black leading-none text-amber">{level}</div>
      <div className="mt-0.5 text-[11px] font-bold uppercase text-text-muted">Level</div>
    </div>
    <div className="min-w-0 flex-1">
      <div className="h-2 overflow-hidden border-2 border-border bg-bg" style={{ clipPath: 'polygon(7px 0,100% 0,calc(100% - 7px) 100%,0 100%)' }}>
        <div className="h-full bg-amber transition-all" style={{ width: `${Math.min(100, xpProgress)}%` }} />
      </div>
      <div className="mt-0.5 truncate text-[11px] text-text-muted">
        {xp.toLocaleString()} / {xpToNext.toLocaleString()} XP
      </div>
    </div>
    {research && (
      <button
        type="button"
        onClick={onOpenResearch}
        className="hidden shrink-0 items-center gap-1.5 text-[11px] font-bold uppercase text-text-secondary min-[380px]:flex"
      >
        <PxIcon name="book" size={13} className="text-blue" />
        {pct(research.progress)}
      </button>
    )}
    <button
      type="button"
      data-testid="hunter-strip-points"
      onClick={onOpenTrees}
      className={availableSkillPoints > 0
        ? 'bl-primary shrink-0 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide'
        : 'shrink-0 border-2 border-border bg-surface px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wide text-text-muted'}
    >
      {availableSkillPoints} pts
    </button>
  </div>
);

/** Direction C's door: label + LIVE status. The hero number is the
 *  system's headline fact (points unspent, proofs banked, parts
 *  worn) — numbers-emphasis law applied to a menu. */
export const HubDoor: React.FC<{
  icon: PxIconName;
  label: string;
  status: string;
  hero?: string;
  tone?: string;
  badge?: number;
  testId?: string;
  onClick: () => void;
}> = ({ icon, label, status, hero, tone = '#FF9000', badge, testId, onClick }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    className="bl-card flex w-full items-center gap-3 p-3 text-left transition-transform active:scale-[0.98]"
    style={{ borderLeftColor: tone, borderLeftWidth: 5 }}
  >
    <div className="bl-icon-plate flex h-10 w-10 shrink-0 items-center justify-center" style={{ backgroundColor: `${tone}18`, color: tone }}>
      <PxIcon name={icon} size={17} />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <div className="text-sm font-black uppercase tracking-wide text-text-primary">{label}</div>
        {badge !== undefined && badge > 0 && (
          <span className="border border-amber/60 bg-amber/25 px-1 text-[11px] font-black leading-tight text-amber">{badge}</span>
        )}
      </div>
      <div className="text-[11px] leading-snug text-text-muted [overflow-wrap:anywhere]">{status}</div>
    </div>
    {hero && <div className="shrink-0 text-xl font-black" style={{ color: tone }}>{hero}</div>}
  </button>
);

/** Direction A's section header: the deck's sections are destinations
 *  in a scroll; the header carries the section's headline fact on the
 *  right (points available, course progress) so the scroll itself
 *  reports state. */
export const DeckHeader: React.FC<{ label: string; right?: string }> = ({ label, right }) => (
  <div className="flex items-baseline gap-3 pt-2">
    <div className="text-xs font-black uppercase tracking-widest text-text-primary">{label}</div>
    <div className="h-px flex-1 bg-border" />
    {right && <div className="text-[11px] font-bold text-text-muted">{right}</div>}
  </div>
);
